"""
TraceNet Phase 6 — JWT/RBAC, watchlist, live fusion ingest and the WebSocket alert feed.

Needs the PostGIS container (`docker compose up -d postgis`); the whole module is skipped when it
is unreachable. Runs against its own database `tracenet_test_rt`, recreated at the start.

    python -m pytest backend/tests/test_phase6_realtime.py -v
"""

from __future__ import annotations

import base64
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

from backend.db.config import database_url  # noqa: E402
from backend.db.migrate import apply_schema  # noqa: E402

TEST_DB = "tracenet_test_rt"
TEST_URL = database_url(TEST_DB)


def _postgres_up() -> bool:
    try:
        with psycopg.connect(database_url("postgres"), connect_timeout=2) as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _postgres_up(), reason="PostGIS not running (docker compose up -d postgis)")


@pytest.fixture(scope="module")
def db():
    """Fresh tracenet_test_rt: schema (incl. the seeded watchlist) + cameras/backdrop seed."""
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


@pytest.fixture(scope="module")
def client(db):
    from fastapi.testclient import TestClient

    from backend.api.db import use_database
    from backend.main import app

    use_database(TEST_URL)
    with TestClient(app) as c:
        yield c
    use_database(None)


def _crop(vehicle: str, view: int) -> str:
    from backend.fusion.scenarios import render_vehicle

    ok, buf = cv2.imencode(".png", render_vehicle(vehicle, view))
    return base64.b64encode(buf.tobytes()).decode()


def sighting(cam: str, minutes_ago: float, plate: str, conf: float, vehicle: str, view: int,
             flag: str = "VALID", raw: str | None = None) -> dict:
    ts = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    return {
        "sighting_id": f"pytest:{uuid.uuid4().hex[:12]}", "camera_id": cam, "timestamp": ts.isoformat(),
        "plate_text": plate, "ocr_confidence": conf, "integrity_flag": flag, "vehicle_bbox": [0, 0, 160, 120],
        "vehicle_class": "car", "source": "simulated", "vehicle_crop_b64": _crop(vehicle, view),
        "meta": {"raw_text": raw} if raw else {},
    }


def ingest(client, headers, *items):
    r = client.post("/api/v1/ingest/sightings", json={"sightings": list(items)}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def collect_alerts(ws, expected: int, max_heartbeats: int = 1) -> list[dict]:
    """Read WS messages until `expected` alerts arrived (a heartbeat = 25 s of silence → give up)."""
    alerts, beats = [], 0
    while len(alerts) < expected and beats < max_heartbeats:
        msg = ws.receive_json()
        if msg["event"] == "alert":
            alerts.append(msg)
        elif msg["event"] == "heartbeat":
            beats += 1
    return alerts


# ─── JWT / mock identity provider ────────────────────────────────────────────

def test_login_issues_role_scoped_jwt(client):
    officer = client.post("/api/v1/auth/login", json={"username": "officer", "password": "police123"})
    admin = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert officer.status_code == admin.status_code == 200
    assert officer.json()["role"] == "law_enforcement" and admin.json()["role"] == "camera_admin"
    assert officer.json()["token_type"] == "bearer" and officer.json()["expires_in"] > 0
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {officer.json()['access_token']}"})
    assert me.json()["username"] == "officer"
    assert client.post("/api/v1/auth/login", json={"username": "officer", "password": "nope"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"username": "mallory", "password": "x"}).status_code == 401


def test_trajectory_requires_jwt_and_law_enforcement(client, officer_headers, admin_headers):
    from backend.api.auth import User, create_token

    url = "/api/v1/vehicles/KA05MN8123/trajectory"
    assert client.get(url).status_code == 401
    assert client.get(url, headers={"Authorization": "Bearer not-a-jwt"}).status_code == 401
    expired = create_token(User("officer", "law_enforcement", "x"), ttl=-5)
    assert client.get(url, headers={"Authorization": f"Bearer {expired}"}).status_code == 401
    forged = create_token(User("officer", "camera_admin", "x"))                # role does not match the IdP
    assert client.get(url, headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    assert client.get(url, headers=admin_headers).status_code == 403
    assert client.get(url, headers=officer_headers).status_code in (200, 404)
    assert client.get("/api/v1/search", params={"q": "KA05"}).status_code == 401


def test_camera_configuration_requires_camera_admin(client, officer_headers, admin_headers):
    for path in ("/api/ingestion/start", "/api/ingestion/cameras/CAM-401/start"):
        assert client.post(path).status_code == 401
        assert client.post(path, headers=officer_headers).status_code == 403
    assert client.post("/api/v1/ingest/sightings", json={"sightings": []}, headers=officer_headers).status_code == 403
    assert client.post("/api/v1/ingest/reset", json={"source": "simulated"}, headers=admin_headers).status_code == 200


def test_audit_log_records_the_jwt_user(db, client, officer_headers):
    r = client.get("/api/v1/vehicles/KA05MN8123/trajectory",
                   params={"user_id": "mallory", "reason": "phase6 audit"}, headers=officer_headers)
    assert r.status_code in (200, 404)
    user_id, plate, reason = db.execute(
        "SELECT user_id, queried_plate, reason FROM query_audit_log ORDER BY id DESC LIMIT 1").fetchone()
    assert (user_id, plate, reason) == ("officer", "KA05MN8123", "phase6 audit")   # never the query param
    assert client.get("/api/v1/audit/verify", headers=officer_headers).json()["valid"]


# ─── watchlist ───────────────────────────────────────────────────────────────

def test_watchlist_seeded_and_cached(db, client, officer_headers):
    from backend.alerts.watchlist import WatchlistCache

    row = db.execute("SELECT threat_level, active FROM watchlist WHERE plate = 'DL01XY0001'").fetchone()
    assert row == ("HIGH", True)
    cache = WatchlistCache(TEST_URL)
    assert cache.lookup("dl 01 xy 0001")["threat_level"] == "HIGH"       # canonicalised, dict lookup
    assert cache.lookup("TS09EA1234") is None and cache.lookup(None) is None
    entries = client.get("/api/v1/watchlist", headers=officer_headers).json()["entries"]
    assert any(e["plate"] == "DL01XY0001" for e in entries)


# ─── WebSocket feed ──────────────────────────────────────────────────────────

def test_ws_rejects_missing_token_and_wrong_role(client, admin_headers):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect) as bad:
        with client.websocket_connect("/ws/alerts?token=garbage") as ws:
            ws.receive_json()
    assert bad.value.code == 4401
    with pytest.raises(WebSocketDisconnect) as none:
        with client.websocket_connect("/ws/alerts") as ws:
            ws.receive_json()
    assert none.value.code == 4401
    admin_token = admin_headers["Authorization"].split()[1]
    with pytest.raises(WebSocketDisconnect) as role:
        with client.websocket_connect(f"/ws/alerts?token={admin_token}") as ws:
            ws.receive_json()
    assert role.value.code == 4403


def test_ws_pushes_cloned_blacklist_and_invalid_format(client, officer_headers, admin_headers):
    token = officer_headers["Authorization"].split()[1]
    with client.websocket_connect(f"/ws/alerts?token={token}") as ws:
        hello = ws.receive_json()
        assert hello["event"] == "hello" and hello["user"] == "officer" and hello["role"] == "law_enforcement"
        t0 = time.perf_counter()
        body = ingest(client, admin_headers,
                      sighting("CAM-410", 10.5, "MH12AB9999", 0.95, "clone_a", 0),
                      sighting("CAM-401", 10.0, "MH12AB9999", 0.96, "clone_b", 1),      # 30 s, 11.7 km
                      sighting("CAM-402", 8.0, "DL01XY0001", 0.95, "traffic_2", 2),
                      sighting("CAM-403", 6.0, "", 0.41, "traffic_1", 3, "INVALID_FORMAT", raw="TS0?XX12"))
        assert body["alerts"] == 3 and body["ingested_by"] == "admin"
        alerts = {a["alert_type"]: a for a in collect_alerts(ws, 3)}
        latency = time.perf_counter() - t0

    assert set(alerts) == {"CLONED_PLATE", "BLACKLIST_HIT", "INVALID_FORMAT"}
    assert latency < 5.0

    clone = alerts["CLONED_PLATE"]
    assert clone["plate_number"] == "MH12AB9999" and clone["implied_speed_kmh"] > 150
    assert {clone["camera_a"], clone["camera_b"]} == {"CAM-410", "CAM-401"}
    assert clone["ui"]["category"] == "Cloned Plate" and clone["ui"]["isNew"] is True

    hit = alerts["BLACKLIST_HIT"]
    assert hit["plate_number"] == "DL01XY0001" and hit["threat_level"] == "HIGH" and hit["severity"] == "CRITICAL"
    assert hit["camera_id"] == "CAM-402" and hit["lat"] and hit["lng"]
    assert hit["ui"]["cameraId"] == "CAM #402" and hit["ui"]["category"] == "Blacklisted Vehicle"

    bad = alerts["INVALID_FORMAT"]
    assert bad["raw_text"] == "TS0?XX12" and bad["ui"]["category"] == "Invalid / Tampered Plate"

    # persisted: the next connection's hello snapshot and /alerts/live include them
    live = client.get("/api/v1/alerts/live", headers=officer_headers).json()
    kinds = {a["alert_type"] for a in live["alerts"]}
    assert {"CLONED_PLATE", "BLACKLIST_HIT", "INVALID_FORMAT"} <= kinds


def test_watchlist_add_is_enforced_on_the_next_sighting(client, officer_headers, admin_headers):
    plate = "KA01AB4321"
    ingest(client, admin_headers, sighting("CAM-406", 20.0, plate, 0.94, "traffic_1", 0))
    added = client.post("/api/v1/watchlist", json={"plate": plate, "reason": "pytest BOLO", "threat_level": "MEDIUM"},
                        headers=officer_headers)
    assert added.status_code == 200 and added.json()["added"]["added_by"] == "officer"

    token = officer_headers["Authorization"].split()[1]
    with client.websocket_connect(f"/ws/alerts?token={token}") as ws:
        ws.receive_json()                                                   # hello
        ingest(client, admin_headers, sighting("CAM-411", 5.0, plate, 0.93, "traffic_1", 1))
        (hit,) = collect_alerts(ws, 1)
    assert hit["alert_type"] == "BLACKLIST_HIT" and hit["plate_number"] == plate and hit["severity"] == "HIGH"

    assert client.delete(f"/api/v1/watchlist/{plate}", headers=officer_headers).status_code == 200
    assert ingest(client, admin_headers, sighting("CAM-401", 1.0, plate, 0.93, "traffic_1", 2))["alerts"] == 0
    assert client.delete(f"/api/v1/watchlist/{plate}", headers=officer_headers).status_code == 404


def test_low_confidence_or_plate_less_sightings_raise_no_alerts(client, admin_headers):
    body = ingest(client, admin_headers,
                  sighting("CAM-410", 30.0, "", 0.0, "ghost", 0, "NO_PLATE_DETECTED"),
                  sighting("CAM-406", 25.0, "TS07GH1111", 0.93, "hero", 0))
    assert body["alerts"] == 0


def test_bad_sightings_are_rejected(client, admin_headers):
    bad = sighting("CAM-999", 1.0, "TS07GH2222", 0.9, "hero", 0)
    assert client.post("/api/v1/ingest/sightings", json={"sightings": [bad]}, headers=admin_headers).status_code == 422
    assert client.post("/api/v1/ingest/sightings", json={"sightings": []}, headers=admin_headers).status_code == 422
