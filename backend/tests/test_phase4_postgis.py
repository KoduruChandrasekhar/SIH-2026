"""
TraceNet Phase 4 — PostgreSQL + PostGIS persistence, spatial API and audit chain.

Needs the PostGIS container (`docker compose up -d postgis`); the whole module is skipped
when it is unreachable. Runs against a SEPARATE database `tracenet_test`, recreated at
the start, so the development data is never touched.

    python -m pytest backend/tests/test_phase4_postgis.py -v
"""

from __future__ import annotations

import hashlib
import json
import statistics
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

psycopg = pytest.importorskip("psycopg")

from backend.db.config import database_url  # noqa: E402
from backend.db.migrate import apply_schema  # noqa: E402

TEST_DB = "tracenet_test"
TEST_URL = database_url(TEST_DB)
IST = timezone(timedelta(hours=5, minutes=30))


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
    """Fresh tracenet_test database: schema + seed + golden scenarios through the PostGIS writer."""
    with psycopg.connect(database_url("postgres"), autocommit=True) as admin:
        admin.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        admin.execute(f'CREATE DATABASE "{TEST_DB}"')
    tables = apply_schema(TEST_URL)

    sys.path.insert(0, str(PROJECT_ROOT / "backend" / "scripts"))
    import seed_db

    assert seed_db.main(["--database-url", TEST_URL]) == 0

    from backend.fusion.config import FusionConfig
    from backend.fusion.postgres_writer import PostgresTrajectoryWriter
    from backend.fusion.reid_matcher import HandcraftedExtractor
    from backend.fusion.scenarios import run_scenarios

    scenarios = run_scenarios(FusionConfig(), use_redis=False, reid=HandcraftedExtractor(),
                              store=PostgresTrajectoryWriter(TEST_URL))
    conn = psycopg.connect(TEST_URL, autocommit=True)
    yield {"conn": conn, "tables": tables, "scenarios": scenarios}
    conn.close()


@pytest.fixture(scope="module")
def client(db, officer_headers):
    from fastapi.testclient import TestClient

    from backend.api.db import use_database
    from backend.main import app

    use_database(TEST_URL)
    with TestClient(app, headers=officer_headers) as c:      # Phase 6: law_enforcement JWT
        yield c
    use_database(None)


def one(conn, sql, *args):
    return conn.execute(sql, args).fetchone()


# ─── TEST 1: database bootstrap & DDL ────────────────────────────────────────

def test_ddl_tables_extensions_and_spatial_indexes(db):
    conn = db["conn"]
    assert set(db["tables"]) >= {"cameras", "vehicle_observations", "global_trajectories", "query_audit_log"}
    ext = {r[0] for r in conn.execute("SELECT extname FROM pg_extension")}
    assert {"postgis", "pg_trgm", "fuzzystrmatch"} <= ext
    idx = {r[0]: r[1] for r in conn.execute("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public'")}
    for name in ("idx_cameras_location_gist", "idx_obs_location_gist", "idx_trajectories_line_gist"):
        assert "USING gist" in idx[name], name
    assert "gin_trgm_ops" in idx["idx_obs_plate_trgm"]
    geom = {r[0]: r[1] for r in conn.execute(
        "SELECT f_table_name || '.' || f_geometry_column, type FROM geometry_columns")}
    assert geom["cameras.location"] == "POINT" and geom["global_trajectories.trajectory_line"] == "LINESTRING"
    assert geom["global_trajectories.trajectory_line_m"] == "LINESTRINGM"
    apply_schema(TEST_URL)                                   # idempotent re-run


# ─── TEST 2: seed verification ───────────────────────────────────────────────

def test_seed_cameras_and_backdrop(db):
    conn = db["conn"]
    cams = {r[0]: (r[1], r[2]) for r in conn.execute("SELECT camera_code, latitude, longitude FROM cameras")}
    assert {"CAM-401", "CAM-402", "CAM-403", "CAM-406"} <= set(cams)
    assert cams["CAM-401"] == (17.4947, 78.3996) and cams["CAM-406"] == (17.4485, 78.3742)
    assert one(conn, "SELECT ST_AsText(location) FROM cameras WHERE camera_code='CAM-403'")[0] == "POINT(78.4357 17.4682)"

    n, plates, outside, max_ts = one(conn, """
        SELECT count(*), count(DISTINCT plate_number),
               count(*) FILTER (WHERE c.camera_code NOT IN ('CAM-401','CAM-402','CAM-403','CAM-406')),
               max(observed_at)
        FROM vehicle_observations o JOIN cameras c ON c.id = o.camera_id WHERE o.source = 'seed_backdrop'""")
    assert n == 1500 and plates > 800 and outside == 0
    assert max_ts < datetime.now(timezone.utc)
    reserved = one(conn, "SELECT count(*) FROM vehicle_observations WHERE source='seed_backdrop' AND plate_number = ANY(%s)",
                   ["TS09EA1234", "TS08UB5678", "MH12AB9999", "AP09AZ6596"])[0]
    assert reserved == 0
    bad = one(conn, r"""SELECT count(*) FROM vehicle_observations WHERE source='seed_backdrop' AND NOT
                (plate_number ~ '^[A-Z]{2}[0-9]{2}[A-Z]{1,3}[0-9]{4}$' OR plate_number ~ '^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$')""")[0]
    assert bad == 0
    assert one(conn, "SELECT count(*) FROM vehicle_observations WHERE source='seed_backdrop' "
                     "AND appearance_embedding IS NOT NULL")[0] == 0
    # Phase 5: part of the backdrop forms synthetic journeys (labelled seed_backdrop, with real PostGIS lines)
    journeys, lines, bad_links = one(conn, """
        SELECT count(*), count(trajectory_line),
               (SELECT count(*) FROM vehicle_observations o WHERE o.source='seed_backdrop' AND o.trajectory_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM global_trajectories t WHERE t.id = o.trajectory_id))
        FROM global_trajectories WHERE source='seed_backdrop'""")
    assert journeys > 100 and lines == journeys and bad_links == 0


# ─── TEST 3: trajectory storage & GeoJSON ────────────────────────────────────

def test_hero_trajectory_linestring_and_linestringm(db):
    conn = db["conn"]
    assert db["scenarios"]["all_passed"]
    row = one(conn, """
        SELECT ST_AsGeoJSON(trajectory_line), ST_IsValid(trajectory_line), ST_NPoints(trajectory_line_m),
               ST_AsText(trajectory_line_m), observation_count, total_distance_km, global_vehicle_id, source
        FROM global_trajectories WHERE canonical_plate = 'TS09EA1234'""")
    gj = json.loads(row[0])
    assert gj["type"] == "LineString" and row[1] is True
    assert gj["coordinates"] == [[78.3489, 17.4401], [78.3742, 17.4485], [78.391, 17.4849], [78.3996, 17.4947]]
    assert row[2] == 4 and row[3].startswith("LINESTRING M") and row[4] == 4
    assert row[5] == pytest.approx(13.113, abs=0.01) and row[7] == "simulated"
    # M dimension = UNIX epoch of each observation, strictly increasing
    ms = [r[0] for r in conn.execute("SELECT ST_M(geom) FROM ST_DumpPoints((SELECT trajectory_line_m FROM "
                                     "global_trajectories WHERE canonical_plate='TS09EA1234')) ORDER BY path")]
    obs = [r[0].timestamp() for r in conn.execute("SELECT observed_at FROM vehicle_observations WHERE "
                                                  "canonical_plate='TS09EA1234' ORDER BY observed_at")]
    assert ms == obs and ms == sorted(ms)
    assert datetime.fromtimestamp(ms[0], IST).strftime("%H:%M") == "10:00"
    # every observation of the journey carries the resolved identity (incl. the 1-char OCR misread)
    reads = [r[0] for r in conn.execute("SELECT plate_number FROM vehicle_observations WHERE "
                                        "canonical_plate='TS09EA1234' ORDER BY observed_at")]
    assert reads == ["TS09EA1234", "TS09EA1234", "TS09EA1284", "TS09EA1234"]
    assert len({r[0] for r in conn.execute("SELECT global_vehicle_id FROM vehicle_observations "
                                           "WHERE canonical_plate='TS09EA1234'")}) == 1


def test_single_sighting_journeys_have_no_line_and_ghost_is_included(db):
    conn = db["conn"]
    assert one(conn, "SELECT count(*) FROM global_trajectories WHERE observation_count = 1 "
                     "AND trajectory_line IS NOT NULL")[0] == 0
    ghost = conn.execute("SELECT c.camera_code, o.plate_number, o.integrity_flags FROM vehicle_observations o "
                         "JOIN cameras c ON c.id=o.camera_id WHERE o.canonical_plate='TS08UB5678' ORDER BY observed_at").fetchall()
    assert ghost == [("CAM-410", "TS08UB5678", "VALID"), ("CAM-406", None, "NO_PLATE_DETECTED")]


def test_writer_is_idempotent(db):
    from backend.fusion.config import FusionConfig
    from backend.fusion.postgres_writer import PostgresTrajectoryWriter
    from backend.fusion.reid_matcher import HandcraftedExtractor
    from backend.fusion.scenarios import run_scenarios

    conn = db["conn"]
    before = one(conn, "SELECT count(*) FROM vehicle_observations")[0], one(conn, "SELECT count(*) FROM global_trajectories")[0]
    run_scenarios(FusionConfig(), use_redis=False, reid=HandcraftedExtractor(), store=PostgresTrajectoryWriter(TEST_URL))
    after = one(conn, "SELECT count(*) FROM vehicle_observations")[0], one(conn, "SELECT count(*) FROM global_trajectories")[0]
    assert before == after


def test_real_phase2_sightings_persist(db):
    """Real CAM-401 Phase 2 sightings → PostGIS (skipped if the dumps were never extracted)."""
    from backend.fusion.config import FusionConfig
    from backend.fusion.fusion_engine import FusionEngine
    from backend.fusion.postgres_writer import PostgresTrajectoryWriter
    from backend.fusion.redis_state import InMemoryActiveState
    from backend.fusion.road_network import RoadNetwork
    from backend.fusion.sources import SIGHTINGS_DIR, load_sighting_dumps

    dump = SIGHTINGS_DIR / "CAM-401_sightings.json"
    if not dump.exists():
        pytest.skip("run `python -m backend.fusion.cli --extract` first")
    writer = PostgresTrajectoryWriter(TEST_URL)
    writer.reset("phase2")
    engine = FusionEngine(FusionConfig(), InMemoryActiveState(), RoadNetwork(), writer)
    sightings = load_sighting_dumps([dump])
    for s in sightings:
        engine.process(s)
    engine.flush()
    conn = db["conn"]
    assert one(conn, "SELECT count(*) FROM vehicle_observations WHERE source='phase2'")[0] == len(sightings)
    row = one(conn, "SELECT observation_count, ST_GeometryType(trajectory_line) FROM global_trajectories "
                    "WHERE canonical_plate='AP09AZ6596'")
    assert row == (2, "ST_LineString")                 # two tracks of the same motorcycle at CAM-401
    crops = [r[0] for r in conn.execute("SELECT crop_path FROM vehicle_observations WHERE canonical_plate='AP09AZ6596'")]
    assert all(c and c.startswith("/api/anpr/evidence/CAM-401/") for c in crops)
    writer.close()


# ─── API: trajectory endpoint (+ latency) ────────────────────────────────────

def test_trajectory_endpoint_geojson_and_waypoints(client):
    r = client.get("/api/v1/vehicles/ts09ea1234/trajectory", params={"reason": "hero trace"})
    assert r.status_code == 200 and r.headers["server-timing"].startswith("db;dur=")
    d = r.json()
    t = d["trajectories"][0]
    assert d["plate"] == "TS09EA1234" and t["geojson"]["type"] == "LineString"
    assert len(t["geojson"]["coordinates"]) == 4 and len(t["line_m"]) == 4
    assert [w["camera_code"] for w in d["waypoints"]] == ["CAM-410", "CAM-406", "CAM-411", "CAM-401"]
    times = [w["observed_at"] for w in d["waypoints"]]
    assert times == sorted(times) and times[0].startswith("2026-09-24T10:00:00")
    assert d["waypoints"][2]["speed_from_prev_kmh"] == pytest.approx(29.47, abs=0.05)
    assert d["geojson"]["type"] == "FeatureCollection" and d["geojson"]["features"][0]["geometry"] == t["geojson"]
    assert client.get("/api/v1/vehicles/MH12AB9999/trajectory").json()["alerts"][0]["implied_speed_kmh"] > 500
    assert client.get("/api/v1/vehicles/ZZ00ZZ0000/trajectory").status_code == 404
    assert client.get("/api/v1/vehicles/X/trajectory").status_code == 400


def test_trajectory_query_under_50ms(client):
    client.get("/api/v1/vehicles/TS09EA1234/trajectory")                 # warm the pool
    ms = [client.get("/api/v1/vehicles/TS09EA1234/trajectory").json()["query_ms"] for _ in range(15)]
    assert statistics.median(ms) < 50, ms


# ─── TEST 4: fuzzy search, case-insensitive ──────────────────────────────────

def test_fuzzy_search_lowercase_ocr_confusion(client):
    d = client.get("/api/v1/search", params={"q": "ts09ea1284"}).json()
    assert d["normalized"] == "TS09EA1284"
    by_plate = {r["plate_number"]: r for r in d["results"]}
    hero = by_plate["TS09EA1234"]
    assert hero["edit_dist"] == 1 and hero["trgm_score"] > 0.5 and hero["canonical_plate"] == "TS09EA1234"
    # the stored OCR misread itself resolves to the hero vehicle as well
    assert by_plate["TS09EA1284"]["canonical_plate"] == "TS09EA1234" and by_plate["TS09EA1284"]["edit_dist"] == 0
    # confusable B↔8 / O↔0 folding and case/spacing noise
    d2 = client.get("/api/v1/search", params={"q": "mh 12 a8 9999"}).json()
    top = d2["results"][0]
    assert top["plate_number"] == "MH12AB9999" and top["edit_dist"] == 1 and top["confusable_dist"] == 0
    # partial read
    assert any(r["plate_number"] == "TS08UB5678" for r in client.get("/api/v1/search", params={"q": "ub5678"}).json()["results"])


def test_geo_observations_featurecollection(client):
    fc = client.get("/api/v1/geo/observations", params={"hours": 0, "limit": 5000}).json()
    assert fc["type"] == "FeatureCollection" and len(fc["features"]) >= 1500
    f = fc["features"][0]
    assert f["geometry"]["type"] == "Point" and {"camera_code", "plate", "source"} <= set(f["properties"])
    sim = client.get("/api/v1/geo/observations", params={"hours": 0, "source": "simulated"}).json()["features"]
    assert sim and all(x["properties"]["source"] == "simulated" for x in sim)


def test_trajectory_list_and_anomalies(client):
    d = client.get("/api/v1/trajectories", params={"min_sightings": 2}).json()
    assert d["count"] >= 3 and all(t["observation_count"] >= 2 for t in d["trajectories"])
    assert client.get("/api/v1/trajectories/TS08UB5678").json()["trajectories"][0]["observation_count"] == 2
    assert client.get("/api/v1/alerts/anomalies").json()["anomalies"][0]["alert_type"] == "CLONED_PLATE"


# ─── TEST 5: audit hash chaining ─────────────────────────────────────────────

def test_audit_log_hash_chain(db, client):
    conn = db["conn"]
    client.get("/api/v1/vehicles/TS09EA1234/trajectory", params={"reason": "case 42"})
    client.get("/api/v1/vehicles/TS08UB5678/trajectory", params={"reason": "case 42"})
    r1, r2 = conn.execute("SELECT id, user_id, queried_plate, reason, executed_at, prev_hash, row_hash "
                          "FROM query_audit_log ORDER BY id DESC LIMIT 2").fetchall()[::-1]
    assert r1[1] == r2[1] == "officer"                                       # user_id comes from the JWT
    assert r2[5] == r1[6]                                                    # row 2's prev_hash == row 1's row_hash
    ts = r2[4].astimezone(timezone.utc).isoformat(timespec="microseconds")
    assert r2[6] == hashlib.sha256(f"{r2[5]}|{r2[1]}|{r2[2]}|{ts}|{r2[3]}".encode()).hexdigest()
    first = one(conn, "SELECT prev_hash FROM query_audit_log ORDER BY id LIMIT 1")[0]
    assert first == "0" * 64
    ok = client.get("/api/v1/audit/verify").json()
    assert ok["valid"] and ok["rows_checked"] >= 2

    # tampering with any past row is detected
    conn.execute("UPDATE query_audit_log SET reason = 'edited' WHERE id = %s", (r1[0],))
    bad = client.get("/api/v1/audit/verify").json()
    assert bad == {"valid": False, "rows_checked": bad["rows_checked"], "broken_at_id": r1[0], "reason": "row_hash mismatch"}
    conn.execute("UPDATE query_audit_log SET reason = %s WHERE id = %s", (r1[3], r1[0]))
    assert client.get("/api/v1/audit/verify").json()["valid"]


def test_every_lookup_is_audited(db, client):
    conn = db["conn"]
    before = one(conn, "SELECT count(*) FROM query_audit_log")[0]
    client.get("/api/v1/vehicles/TS09EA1234/trajectory")
    client.get("/api/v1/vehicles/ZZ00ZZ0000/trajectory")                 # misses are audited too
    client.get("/api/v1/search", params={"q": "ts09"})
    assert one(conn, "SELECT count(*) FROM query_audit_log")[0] == before + 3


# ─── resilience / regression ─────────────────────────────────────────────────

def test_database_down_only_affects_phase4_routes(officer_headers):
    from fastapi.testclient import TestClient

    from backend.api.db import use_database
    from backend.main import app

    use_database("postgresql://nobody:nothing@localhost:5999/none")
    try:
        with TestClient(app, headers=officer_headers) as c:
            assert c.get("/api/v1/vehicles/TS09EA1234/trajectory").status_code == 503
            assert c.get("/api/v1/db/health").json()["database"] == "unavailable"
            for path in ("/api/health", "/api/cameras", "/api/anpr", "/api/ingestion/cameras"):
                assert c.get(path).status_code == 200, path
    finally:
        use_database(TEST_URL)
