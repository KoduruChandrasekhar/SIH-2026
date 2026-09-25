"""
TraceNet — live pipeline over RabbitMQ q.fusion + Redis (completion plan 2.1).

Needs `docker compose up -d` (PostGIS + Redis + RabbitMQ); skipped otherwise. Uses its own database
`tracenet_test_bus` and the per-run test namespace from conftest (its own exchange, queue and keys).

    python -m pytest backend/tests/test_pipeline_broker.py -v
"""

from __future__ import annotations

import base64
import json
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cv2
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

psycopg = pytest.importorskip("psycopg")
pika = pytest.importorskip("pika")

from backend.db.config import database_url  # noqa: E402
from backend.db.migrate import apply_schema  # noqa: E402
from backend.fusion.broker import broker_available  # noqa: E402
from backend.fusion.runtime import redis_available, runtime  # noqa: E402

TEST_DB = "tracenet_test_bus"
TEST_URL = database_url(TEST_DB)


def _infra_up() -> bool:
    try:
        with psycopg.connect(database_url("postgres"), connect_timeout=2) as conn:
            conn.execute("SELECT 1")
    except Exception:
        return False
    rt = runtime()
    return broker_available(rt.amqp_url) and redis_available(rt.redis_url)


pytestmark = pytest.mark.skipif(not _infra_up(), reason="needs `docker compose up -d` (PostGIS, Redis, RabbitMQ)")


@pytest.fixture(scope="module")
def db():
    with psycopg.connect(database_url("postgres"), autocommit=True) as admin:
        admin.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        admin.execute(f'CREATE DATABASE "{TEST_DB}"')
    apply_schema(TEST_URL)
    sys.path.insert(0, str(PROJECT_ROOT / "backend" / "scripts"))
    import seed_db

    assert seed_db.main(["--database-url", TEST_URL]) == 0
    conn = psycopg.connect(TEST_URL, autocommit=True)
    yield conn
    conn.close()


def _app_client(monkeypatch, headers, **env):
    from fastapi.testclient import TestClient

    from backend.api.db import use_database
    from backend.main import app

    for k, v in env.items():
        monkeypatch.setenv(k, v)
    use_database(TEST_URL)
    return TestClient(app, headers=headers)


@pytest.fixture()
def admin_client(db, monkeypatch, admin_headers):
    with _app_client(monkeypatch, admin_headers, TRACENET_FUSION_TRANSPORT="auto") as c:
        yield c
    from backend.api.db import use_database

    use_database(None)


def _crop(vehicle: str, view: int) -> str:
    from backend.fusion.scenarios import render_vehicle

    ok, buf = cv2.imencode(".png", render_vehicle(vehicle, view))
    return base64.b64encode(buf.tobytes()).decode()


def sighting(cam, minutes_ago, plate, conf, vehicle, view, flag="VALID"):
    ts = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    return {"sighting_id": f"bus:{uuid.uuid4().hex[:12]}", "camera_id": cam, "timestamp": ts.isoformat(),
            "plate_text": plate, "ocr_confidence": conf, "integrity_flag": flag, "vehicle_bbox": [0, 0, 160, 120],
            "vehicle_class": "car", "source": "simulated", "vehicle_crop_b64": _crop(vehicle, view)}


def _status(client):
    return client.get("/api/v1/pipeline/status").json()


# ─── transport ───────────────────────────────────────────────────────────────

def test_broker_transport_is_used_when_rabbitmq_and_redis_are_up(admin_client, officer_headers):
    st = _status(admin_client)
    rt = runtime()
    assert st["transport"] == "broker" and st["queue"] == rt.queue and rt.queue.startswith("q.fusion.pytest")
    assert st["worker_status"]["state"] in ("connecting", "consuming")
    assert admin_client.get("/api/v1/pipeline/status", headers=officer_headers).status_code == 403


def test_hero_trace_through_q_fusion_keeps_order_and_one_identity(admin_client, db):
    assert admin_client.post("/api/v1/ingest/reset", json={"source": "simulated"}).json()["reset"] == "simulated"
    batch = [sighting("CAM-410", 40, "TS09EA1234", 0.94, "hero", 0),
             sighting("CAM-406", 29, "TS09EA1234", 0.91, "hero", 1),
             sighting("CAM-411", 18, "TS09EA1284", 0.88, "hero", 2),     # misread linked by fusion
             sighting("CAM-401", 13, "TS09EA1234", 0.93, "hero", 3)]
    body = admin_client.post("/api/v1/ingest/sightings", json={"sightings": batch}).json()
    assert body["transport"] == "broker" and body["processed"] == 4
    ids = {r["decision"]["global_vehicle_id"] for r in body["results"]}
    assert len(ids) == 1
    route = [r[0] for r in db.execute(
        "SELECT c.camera_code FROM vehicle_observations o JOIN cameras c ON c.id = o.camera_id "
        "WHERE o.sighting_id = ANY(%s) ORDER BY o.observed_at",
        ([s["sighting_id"] for s in batch],)).fetchall()]
    assert route == ["CAM-410", "CAM-406", "CAM-411", "CAM-401"]
    st = _status(admin_client)
    assert st["worker_status"]["sightings"] >= 4 and st["queue_stats"]["consumers"] >= 1


def test_alerts_from_the_worker_reach_the_websocket(admin_client, officer_headers):
    token = officer_headers["Authorization"].split()[1]
    with admin_client.websocket_connect(f"/ws/alerts?token={token}") as ws:
        assert ws.receive_json()["event"] == "hello"
        admin_client.post("/api/v1/ingest/sightings", json={"sightings": [
            sighting("CAM-410", 9.5, "MH12AB9999", 0.95, "clone_a", 0),
            sighting("CAM-401", 9.0, "MH12AB9999", 0.96, "clone_b", 1)]})
        msg = ws.receive_json()
        while msg["event"] != "alert":
            msg = ws.receive_json()
    assert msg["alert_type"] == "CLONED_PLATE" and msg["implied_speed_kmh"] > 150
    assert _status(admin_client)["worker_status"]["alerts_published"] >= 1


def test_queue_without_waiting_then_processed(admin_client, db):
    s = sighting("CAM-402", 3, "KA05MN7777", 0.93, "traffic_1", 0)
    body = admin_client.post("/api/v1/ingest/sightings", params={"wait": "false"}, json={"sightings": [s]}).json()
    assert body == {"queued": 1, "ingested_by": "admin", "transport": "broker"}
    for _ in range(50):
        if db.execute("SELECT 1 FROM vehicle_observations WHERE sighting_id = %s", (s["sighting_id"],)).fetchone():
            break
        time.sleep(0.1)
    else:
        pytest.fail("queued sighting was never fused")


def test_invalid_sighting_is_reported_not_retried(admin_client):
    r = admin_client.post("/api/v1/ingest/sightings", json={"sightings": [sighting("CAM-999", 1, "TS07GH2222", 0.9, "hero", 0)]})
    assert r.status_code == 422 and "unknown camera" in r.json()["detail"]
    assert _status(admin_client)["queue_stats"]["ready"] == 0


def test_malformed_message_goes_to_the_dead_letter_queue(admin_client):
    rt = runtime()
    before = _status(admin_client)["queue_stats"]["dead_letters"]
    conn = pika.BlockingConnection(pika.URLParameters(rt.amqp_url))
    conn.channel().basic_publish(exchange=rt.exchange, routing_key="sighting", body=b"{not json")
    conn.close()
    for _ in range(50):
        if _status(admin_client)["queue_stats"]["dead_letters"] == before + 1:
            break
        time.sleep(0.1)
    else:
        pytest.fail("malformed message was not dead-lettered")
    # the worker keeps consuming afterwards
    ok = admin_client.post("/api/v1/ingest/sightings", json={"sightings": [sighting("CAM-403", 1, "KA05MN8888", 0.92, "traffic_2", 0)]})
    assert ok.status_code == 200


def test_watchlist_change_reaches_the_worker_in_order(admin_client, officer_headers):
    plate = "KA01AB5555"
    added = admin_client.post("/api/v1/watchlist", json={"plate": plate, "reason": "broker BOLO", "threat_level": "LOW"},
                              headers=officer_headers)
    assert added.status_code == 200
    hit = admin_client.post("/api/v1/ingest/sightings", json={"sightings": [sighting("CAM-406", 2, plate, 0.93, "traffic_1", 2)]}).json()
    assert [a["alert_type"] for a in hit["results"][0]["alerts"]] == ["BLACKLIST_HIT"]
    admin_client.delete(f"/api/v1/watchlist/{plate}", headers=officer_headers)


# ─── worker modes / fallback ─────────────────────────────────────────────────

def test_external_worker_process_mode(db, monkeypatch, admin_headers):
    """API publishes only; a separate FusionWorker (as `python -m backend.fusion.worker` runs it) consumes."""
    from backend.api.db import use_database
    from backend.fusion.worker import FusionWorker

    with _app_client(monkeypatch, admin_headers, TRACENET_FUSION_TRANSPORT="broker", TRACENET_FUSION_WORKER="external") as c:
        st = _status(c)
        assert st["transport"] == "broker" and st["worker_status"] == "external"
        pending = c.post("/api/v1/ingest/sightings", params={"wait": "false"},
                         json={"sightings": [sighting("CAM-401", 1, "KA05MN9999", 0.93, "traffic_1", 1)]}).json()
        assert pending["queued"] == 1
        assert _status(c)["queue_stats"]["ready"] == 1                    # nobody consumes yet
        worker = FusionWorker().start()
        try:
            for _ in range(50):
                if worker.stats["sightings"] == 1:
                    break
                time.sleep(0.1)
            assert worker.stats["sightings"] == 1 and _status(c)["queue_stats"]["ready"] == 0
        finally:
            worker.stop()
    use_database(None)


def test_direct_fallback_when_forced(db, monkeypatch, admin_headers):
    from backend.api.db import use_database

    with _app_client(monkeypatch, admin_headers, TRACENET_FUSION_TRANSPORT="direct") as c:
        assert _status(c)["transport"] == "direct"
        body = c.post("/api/v1/ingest/sightings", json={"sightings": [sighting("CAM-402", 1, "KA05MN1212", 0.93, "traffic_2", 0)]}).json()
        assert body["transport"] == "direct" and body["processed"] == 1
    use_database(None)


def test_broker_required_but_unreachable_answers_503(db, monkeypatch, admin_headers):
    from backend.api.db import use_database

    with _app_client(monkeypatch, admin_headers, TRACENET_FUSION_TRANSPORT="broker",
                     TRACENET_AMQP_URL="amqp://guest:guest@localhost:5999/%2F") as c:
        assert _status(c)["transport"] == "unavailable"
        r = c.post("/api/v1/ingest/sightings", json={"sightings": [sighting("CAM-402", 1, "KA05MN1313", 0.93, "hero", 0)]})
        assert r.status_code == 503
    use_database(None)


def test_result_json_is_exact(admin_client):
    """Results travel through Redis as JSON - the decision survives the round trip unchanged in shape."""
    body = admin_client.post("/api/v1/ingest/sightings", json={"sightings": [sighting("CAM-411", 1, "TS10ZZ4444", 0.95, "hero", 2)]}).json()
    r = body["results"][0]
    assert set(r) >= {"sighting_id", "decision", "alerts", "canonical_plate"}
    assert json.loads(json.dumps(r)) == r and r["canonical_plate"] == "TS10ZZ4444"


# ─── ANPR → q.fusion bridge ──────────────────────────────────────────────────

def _observation(camera, plate, status, minutes_ago, raw=None):
    ts = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
    return {"observation_id": f"{camera}:bridge:{uuid.uuid4().hex[:8]}", "camera_id": camera, "track_id": 7,
            "timestamp": ts, "first_seen": ts, "last_seen": ts, "vehicle_class": "car",
            "vehicle_bbox": [10, 10, 170, 130], "plate_status": status, "plate": plate if status == "DETECTED" else None,
            "consensus_text": raw or plate, "raw_ocr": raw, "ocr_confidence": 0.93, "q_score": 0.8,
            "best_frame": 12, "best_crop_file": None}


def test_anpr_observation_message_contract():
    from backend.anpr.fusion_bridge import observation_message
    from backend.fusion.scenarios import render_vehicle

    crop = render_vehicle("hero", 0)
    msg = observation_message(_observation("CAM-401", "TS09EA1234", "DETECTED", 1), crop)
    assert msg["plate_text"] == "TS09EA1234" and msg["integrity_flag"] == "VALID" and msg["source"] == "phase2"
    assert msg["vehicle_crop_b64"] and msg["camera_id"] == "CAM-401"
    bad = observation_message(_observation("CAM-403", None, "INVALID_FORMAT", 1, raw="TS0?XX12"), None)
    assert bad["plate_text"] == "" and bad["integrity_flag"] == "INVALID_FORMAT"
    assert bad["meta"]["raw_text"] == "TS0?XX12" and "vehicle_crop_b64" not in bad
    blind = observation_message(_observation("CAM-406", None, "NOT_VISIBLE", 1), None)
    assert blind["plate_text"] == "" and blind["integrity_flag"] == "NO_PLATE_DETECTED"


def test_anpr_publisher_feeds_the_fusion_worker(admin_client, db):
    """Camera process → FusionPublisher → q.fusion → worker → PostGIS (no HTTP in between)."""
    from backend.anpr.fusion_bridge import FusionPublisher
    from backend.fusion.scenarios import render_vehicle

    sink = FusionPublisher()
    obs = _observation("CAM-410", "TS11BB2468", "DETECTED", 2)
    sink(type("Obs", (), {"to_dict": lambda self: obs})(), render_vehicle("traffic_1", 0))
    sink.close()
    assert sink.stats()["published"] == 1 and sink.stats()["pending"] == 0
    for _ in range(50):
        row = db.execute("SELECT plate_number, source, appearance_embedding IS NOT NULL FROM vehicle_observations "
                         "WHERE sighting_id = %s", (obs["observation_id"],)).fetchone()
        if row:
            break
        time.sleep(0.1)
    assert row == ("TS11BB2468", "phase2", True)


def test_anpr_publisher_keeps_a_backlog_while_the_broker_is_down():
    from dataclasses import replace

    from backend.anpr.fusion_bridge import FusionPublisher

    sink = FusionPublisher(rt=replace(runtime(), amqp_url="amqp://guest:guest@localhost:5999/%2F"))
    sink(type("Obs", (), {"to_dict": lambda self: _observation("CAM-402", "KA01AA1111", "DETECTED", 1)})(), None)
    assert sink.stats()["pending"] == 1 and sink.stats()["published"] == 0 and sink.stats()["failed_attempts"] == 1
