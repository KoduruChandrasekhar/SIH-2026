"""
TraceNet Phase 5 — Polars macro analytics, summary tables, scheduler and API.

Pure-Polars unit tests always run; the database tests need the PostGIS container and use a
separate database `tracenet_test5` (recreated here), so development data is untouched.

    python -m pytest backend/tests/test_phase5_analytics.py -v
"""

from __future__ import annotations

import asyncio
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import polars as pl
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.analytics.polars_jobs import (  # noqa: E402
    BCI_SEVERE,
    compute,
    compute_legs,
    corridor_stats,
    od_matrix,
    read_frame,
    road_distances,
    run_job,
    write_results,
)
from backend.db.config import database_url  # noqa: E402

IST = timezone(timedelta(hours=5, minutes=30))
T0 = datetime(2026, 9, 24, 8, 0, tzinfo=IST)
HERO_NOW = datetime(2026, 9, 24, 11, 30, tzinfo=IST)       # 24 h window that contains the golden runs
TEST_DB = "tracenet_test5"
TEST_URL = database_url(TEST_DB)


# ─── pure Polars (no database) ───────────────────────────────────────────────

def _obs(rows):
    """rows: (id, camera, minutes after T0, confidence, integrity, trajectory_id)."""
    return pl.DataFrame(
        [{"id": r[0], "camera_code": r[1], "observed_at": T0 + timedelta(minutes=r[2]), "confidence": r[3],
          "integrity_flags": r[4], "trajectory_id": r[5], "source": "test"} for r in rows],
        schema={"id": pl.String, "camera_code": pl.String, "observed_at": pl.Datetime("us", "UTC"),
                "confidence": pl.Float64, "integrity_flags": pl.String, "trajectory_id": pl.String, "source": pl.String},
    )


@pytest.fixture
def toy():
    # CAM-401 → CAM-402 is 1.699 km. Trip A: 8.5 min → 12 km/h (severe). Trip B: 3.4 min → 30 km/h.
    # Trip C: same-camera fragment. Trip D: cloned (excluded). Trip E: 0.2 s → impossible speed.
    obs = _obs([
        ("a1", "CAM-401", 0, 0.95, "VALID", "A"), ("a2", "CAM-402", 8.495, 0.91, "VALID", "A"),
        ("b1", "CAM-401", 20, 0.88, "VALID", "B"), ("b2", "CAM-402", 23.398, 0.60, "VALID", "B"),
        ("c1", "CAM-403", 30, 0.90, "VALID", "C"), ("c2", "CAM-403", 31, 0.90, "VALID", "C"),
        ("d1", "CAM-401", 40, 0.97, "VALID", "D"), ("d2", "CAM-402", 45, 0.97, "VALID", "D"),
        ("e1", "CAM-401", 50, 0.97, "VALID", "E"), ("e2", "CAM-402", 50.003, 0.97, "VALID", "E"),
        ("n1", "CAM-406", 10, 0.0, "NO_PLATE_DETECTED", None),          # plate-less chassis
        ("n2", "CAM-406", 11, 0.85, "VALID", None),
    ])
    legs = compute_legs(obs, road_distances(), cloned={"D"})
    cams = ["CAM-401", "CAM-402", "CAM-403", "CAM-406", "CAM-410"]
    hourly, rollup = corridor_stats(obs, legs, cams, T0 - timedelta(hours=1), T0 + timedelta(hours=2))
    return obs, legs, hourly, rollup


def test_legs_speed_and_exclusions(toy):
    _, legs, _, _ = toy
    by = {r["trajectory_id"]: r for r in legs.iter_rows(named=True)}
    assert by["A"]["speed_kmh"] == pytest.approx(12.0, abs=0.05) and by["A"]["valid"]
    assert by["B"]["speed_kmh"] == pytest.approx(30.0, abs=0.05) and by["B"]["valid"]
    assert not by["C"]["valid"]                         # same camera: tracker fragment, not travel
    assert not by["D"]["valid"]                         # cloned-plate trajectory
    assert not by["E"]["valid"] and by["E"]["speed_kmh"] > 150


def test_corridor_kpis_bci_and_no_nan(toy):
    _, _, hourly, rollup = toy
    r = {row["camera_code"]: row for row in rollup.iter_rows(named=True)}
    # CAM-401 & 402: mean of valid legs (12, 30) = 21 km/h → BCI 0.65 (moderate)
    assert r["CAM-401"]["avg_speed_kmh"] == pytest.approx(21.0, abs=0.05)
    assert r["CAM-401"]["bci_score"] == pytest.approx(1 - 21 / 60, abs=0.001) and r["CAM-401"]["status"] == "STATUS_MODERATE"
    # density counts every chassis, including the plate-less one
    assert r["CAM-406"]["vehicle_count"] == 2 and r["CAM-406"]["plated_count"] == 1
    assert r["CAM-406"]["ocr_yield"] == pytest.approx(0.5)
    # no speed evidence → NULL BCI and STATUS_NO_DATA, never a guess
    assert r["CAM-406"]["bci_score"] is None and r["CAM-406"]["status"] == "STATUS_NO_DATA"
    assert r["CAM-403"]["avg_speed_kmh"] is None       # only a same-camera fragment there
    assert r["CAM-410"]["vehicle_count"] == 0 and r["CAM-410"]["status"] == "STATUS_NO_DATA"
    # hourly buckets are IST clock hours: both valid legs arrive at CAM-402 in the 08:00 hour
    h = hourly.filter((pl.col("camera_code") == "CAM-402") & (pl.col("speed_samples") > 0)).sort("bucket_start")
    first = h.row(0, named=True)
    assert first["avg_speed_kmh"] == pytest.approx(21.0, abs=0.05)  # both legs arrive in the 08:00 IST hour
    for frame in (hourly, rollup):
        for col, dtype in frame.schema.items():
            if dtype.is_float():
                assert not frame[col].is_nan().any(), col
        assert frame.filter(pl.col("bci_score").is_not_null())["bci_score"].is_between(0, 1).all()


def test_bci_formula_and_severe_flag():
    obs = _obs([("a1", "CAM-401", 0, 0.9, "VALID", "A"), ("a2", "CAM-402", 8.495, 0.9, "VALID", "A"),
                ("f1", "CAM-401", 30, 0.9, "VALID", "F"), ("f2", "CAM-402", 31.2, 0.9, "VALID", "F")])
    legs = compute_legs(obs, road_distances(), set())
    _, rollup = corridor_stats(obs.filter(pl.col("trajectory_id") == "A"), legs.filter(pl.col("trajectory_id") == "A"),
                               ["CAM-401"], T0 - timedelta(hours=1), T0 + timedelta(hours=1))
    row = rollup.row(0, named=True)
    assert row["bci_score"] == pytest.approx(0.8, abs=0.002) and row["status"] == "STATUS_SEVERE" and row["is_severe"]
    # faster than free-flow (1.699 km in 1.2 min ≈ 85 km/h) clips to BCI 0 → free flow
    _, fast = corridor_stats(obs.filter(pl.col("trajectory_id") == "F"), legs.filter(pl.col("trajectory_id") == "F"),
                             ["CAM-401"], T0, T0 + timedelta(hours=1))
    assert fast.row(0, named=True)["bci_score"] == 0.0 and fast.row(0, named=True)["status"] == "STATUS_FREE"


def test_od_matrix_counts(toy):
    _, legs, _, _ = toy
    od = od_matrix(legs, T0 - timedelta(hours=1), T0 + timedelta(hours=2))
    assert od.to_dicts() == [{"source_camera": "CAM-401", "destination_camera": "CAM-402", "trip_count": 2,
                              "unique_vehicles": 2, "avg_travel_minutes": pytest.approx(5.9465, abs=0.01),
                              "avg_speed_kmh": pytest.approx(21.0, abs=0.05)}]


# ─── database ────────────────────────────────────────────────────────────────

def _postgres_up() -> bool:
    try:
        import psycopg

        with psycopg.connect(database_url("postgres"), connect_timeout=2) as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False


needs_db = pytest.mark.skipif(not _postgres_up(), reason="PostGIS not running (docker compose up -d postgis)")


@pytest.fixture(scope="module")
def db():
    import psycopg

    from backend.db.migrate import apply_schema
    from backend.fusion.config import FusionConfig
    from backend.fusion.postgres_writer import PostgresTrajectoryWriter
    from backend.fusion.reid_matcher import HandcraftedExtractor
    from backend.fusion.scenarios import run_scenarios

    with psycopg.connect(database_url("postgres"), autocommit=True) as admin:
        admin.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        admin.execute(f'CREATE DATABASE "{TEST_DB}"')
    apply_schema(TEST_URL)
    sys.path.insert(0, str(PROJECT_ROOT / "backend" / "scripts"))
    import seed_db

    assert seed_db.main(["--database-url", TEST_URL]) == 0
    run_scenarios(FusionConfig(), use_redis=False, reid=HandcraftedExtractor(), store=PostgresTrajectoryWriter(TEST_URL))
    conn = psycopg.connect(TEST_URL, autocommit=True)
    yield conn
    conn.close()


@pytest.fixture(scope="module")
def client(db, officer_headers):
    from fastapi.testclient import TestClient

    from backend.api.db import use_database
    from backend.main import app

    use_database(TEST_URL)
    assert run_job(TEST_URL)["status"] == "ok"             # live window: the seeded backdrop
    with TestClient(app, headers=officer_headers) as c:      # Phase 6: law_enforcement JWT
        yield c
    use_database(None)


@needs_db
def test_read_engines(db):
    df, engine = read_frame("SELECT camera_code, latitude FROM cameras ORDER BY 1", TEST_URL)
    assert engine == "connectorx" and df.height == 6
    df2, engine2 = read_frame("SELECT camera_code FROM cameras", TEST_URL, engines=("not-an-engine", "psycopg"))
    assert engine2 == "psycopg" and df2.height == 6


@needs_db
def test_polars_job_on_database(db):
    res = compute(TEST_URL)
    r = res.rollup
    assert set(r["camera_code"]) == {"CAM-401", "CAM-402", "CAM-403", "CAM-406", "CAM-410", "CAM-411"}
    demo = r.filter(pl.col("camera_code").is_in(["CAM-401", "CAM-402", "CAM-403", "CAM-406"]))
    assert (demo["vehicle_count"] > 100).all() and demo["avg_speed_kmh"].is_not_null().all()
    assert demo["bci_score"].is_between(0, 1).all()
    for col, dtype in r.schema.items():
        if dtype.is_float():
            assert not r[col].is_nan().any(), col
    # density counts all chassis in the window (plate-less included) — cross-check with SQL
    sql_total = db.execute("SELECT count(*) FROM vehicle_observations WHERE observed_at >= %s AND observed_at < %s",
                           (res.window_start, res.window_end)).fetchone()[0]
    assert int(r["vehicle_count"].sum()) == sql_total
    assert int(r["plated_count"].sum()) < sql_total
    # peak-hour congestion reaches the severe band somewhere in the hourly buckets
    assert res.hourly.filter(pl.col("is_severe")).height > 0
    assert res.hourly.filter(pl.col("is_severe"))["bci_score"].min() >= BCI_SEVERE


@needs_db
def test_od_matrix_contains_hero_leg(db):
    res = compute(TEST_URL, now=HERO_NOW)
    pairs = {(r["source_camera"], r["destination_camera"]): r for r in res.od.iter_rows(named=True)}
    hero = pairs[("CAM-410", "CAM-406")]
    assert hero["trip_count"] >= 1 and hero["avg_speed_kmh"] == pytest.approx(27.1, abs=1.0)
    assert ("CAM-406", "CAM-411") in pairs and ("CAM-411", "CAM-401") in pairs
    assert ("CAM-410", "CAM-401") not in pairs              # the cloned-plate "trip" is excluded


@needs_db
def test_summary_tables_upsert_and_replace(db):
    res = compute(TEST_URL)
    first = write_results(res, TEST_URL)
    second = write_results(compute(TEST_URL), TEST_URL)
    assert first == second
    n = db.execute("SELECT count(*) FROM corridor_stats").fetchone()[0]
    assert n == first["corridor_rows"]                       # re-running replaces, never duplicates
    assert db.execute("SELECT count(*) FROM od_matrix").fetchone()[0] == first["od_rows"]


@needs_db
def test_heatmap_geojson(client):
    fc = client.get("/api/v1/geo/heatmap").json()
    assert fc["type"] == "FeatureCollection" and len(fc["features"]) == 6
    for f in fc["features"]:
        assert f["geometry"]["type"] == "Point" and len(f["geometry"]["coordinates"]) == 2
        p = f["properties"]
        assert {"camera_id", "vehicle_count", "avg_speed", "bci_score", "alert", "status"} <= set(p)
        assert p["alert"] == (p["bci_score"] is not None and p["bci_score"] >= 0.70)
    by = {f["properties"]["camera_id"]: f["properties"] for f in fc["features"]}
    assert by["CAM-401"]["vehicle_count"] > 100 and 0 <= by["CAM-401"]["bci_score"] <= 1
    peak = client.get("/api/v1/geo/heatmap", params={"window": "peak"}).json()
    assert any(f["properties"]["alert"] for f in peak["features"])
    assert client.get("/api/v1/geo/heatmap", params={"window": "bogus"}).status_code == 422


def db_conn():
    import psycopg

    return psycopg.connect(TEST_URL, autocommit=True)


@needs_db
def test_od_matrix_endpoint_and_summary(client):
    run_job(TEST_URL, now=HERO_NOW)
    od = client.get("/api/v1/analytics/od-matrix").json()
    flows = {(f["source"], f["destination"]): f["vehicle_volume"] for f in od["flows"]}
    assert flows[("CAM-410", "CAM-406")] >= 1
    assert od["total_trips"] == sum(flows.values())
    i, j = od["cameras"].index("CAM-410"), od["cameras"].index("CAM-406")
    assert od["matrix"][i][j] == flows[("CAM-410", "CAM-406")]

    run_job(TEST_URL)                                        # back to the live window
    s = client.get("/api/v1/analytics/summary").json()
    assert s["vehicles_24h"] > 0 and 0 < s["average_city_speed"] < 60
    # "today" = since IST midnight (0 right after midnight) — cross-check against the raw table
    midnight = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0)
    raw_today = db_conn().execute("SELECT count(*) FROM vehicle_observations WHERE observed_at >= %s", (midnight,)).fetchone()[0]
    assert s["total_vehicles_today"] == raw_today
    assert s["top_congested_junction"]["camera_id"].startswith("CAM-")
    assert s["peak_congestion"]["bci_score"] >= 0.7
    assert s["cloned_alerts"]["total"] == 1 and s["blacklist_alerts"]["total"] >= 0
    assert s["last_run"]["status"] == "ok" and s["last_run"]["engine"] == "connectorx"
    assert "seed_backdrop" in s["data_sources"]
    hourly = client.get("/api/v1/analytics/hourly").json()["series"]
    assert hourly and all(h["hour"].endswith(":00") for h in hourly)
    assert client.get("/api/v1/analytics/hourly", params={"camera": "CAM-401"}).json()["series"]


@needs_db
def test_refresh_endpoint_and_run_log(client, admin_headers):
    assert client.post("/api/v1/analytics/refresh").status_code == 403    # officer may not trigger jobs
    r = client.post("/api/v1/analytics/refresh", headers=admin_headers).json()
    assert r["status"] == "ok" and r["corridor_rows"] > 0
    runs = client.get("/api/v1/analytics/runs").json()
    assert runs["runs"][0]["status"] == "ok" and runs["runs"][0]["read_engine"] == "connectorx"


@needs_db
def test_scheduler_runs_in_background_without_blocking(db):
    from backend.analytics.scheduler import AnalyticsScheduler

    async def scenario():
        sch = AnalyticsScheduler(interval=0.3, url_provider=lambda: TEST_URL)
        sch.start()
        worst = 0.0
        deadline = time.perf_counter() + 4
        while time.perf_counter() < deadline and sch.runs < 3:
            t = time.perf_counter()
            await asyncio.sleep(0.02)                           # event-loop responsiveness probe
            worst = max(worst, time.perf_counter() - t)
        await sch.stop()
        return sch, worst

    sch, worst = asyncio.run(scenario())
    assert sch.runs >= 2 and sch.last["status"] == "ok" and not sch.running
    assert worst < 0.2, f"event loop blocked for {worst:.3f}s"


@needs_db
def test_job_failure_is_recorded_not_raised():
    out = run_job("postgresql://nobody:nothing@localhost:5999/none")
    assert out["status"] == "error" and "error" in out
