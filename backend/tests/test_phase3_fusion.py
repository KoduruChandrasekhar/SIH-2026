"""
TraceNet Phase 3 — cross-camera fusion tests.

Run from the repository root:

    python -m pytest backend/tests/test_phase3_fusion.py -v

Covers the scoring primitives, road-network distances, deterministic Re-ID, the
active-state cache (in-memory; Redis when reachable), every link guard, ghost-car
weight redistribution, cloned-plate alerts, UUIDv5 identity, trajectory ordering and
expiry, the Phase 2 adapter, broker fallback, the API, and the 4 golden scenarios.
"""

from __future__ import annotations

import math
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.fusion import (  # noqa: E402
    FusionConfig,
    FusionEngine,
    HandcraftedExtractor,
    InMemoryActiveState,
    IntegrityFlag,
    RoadNetwork,
    Sighting,
    TrajectoryStore,
    cosine_similarity,
    create_state,
    fusion_weights,
    physics_score,
    text_similarity,
    vehicle_id_for_plate,
)
from backend.fusion.fusion_engine import implied_speed_kmh  # noqa: E402
from backend.fusion.road_network import haversine_km  # noqa: E402
from backend.fusion.scenarios import render_vehicle, run_scenarios  # noqa: E402

T0 = datetime.fromisoformat("2026-09-24T09:00:00+05:30")
REID = HandcraftedExtractor()


def sighting(sid, cam, minutes, plate="", conf=0.0, vehicle="hero", view=0,
             flag=None, emb="auto", span_s=2.0) -> Sighting:
    ts = T0 + timedelta(minutes=minutes)
    flag = flag or (IntegrityFlag.VALID if plate else IntegrityFlag.NO_PLATE_DETECTED)
    return Sighting(sid, cam, ts, plate, conf,
                    REID.extract_embedding(render_vehicle(vehicle, view)) if isinstance(emb, str) else emb,
                    [0, 0, 160, 120], flag, "car", ts - timedelta(seconds=span_s), ts + timedelta(seconds=span_s),
                    source="simulated")


@pytest.fixture
def engine(tmp_path):
    store = TrajectoryStore(tmp_path / "t.db")
    eng = FusionEngine(FusionConfig(), InMemoryActiveState(), RoadNetwork(), store, source="simulated")
    yield eng
    store.close()


# ─── primitives ──────────────────────────────────────────────────────────────

def test_text_similarity_is_normalised_levenshtein():
    assert text_similarity("TS09EA1234", "TS09EA1234") == 1.0
    assert text_similarity("TS09EA1234", "TS09EA1284") == pytest.approx(0.9)
    assert text_similarity("TS09EA1234", "") == 0.0 and text_similarity(None, "X") == 0.0


def test_cosine_zero_vector_guard_never_nans():
    real = REID.extract_embedding(render_vehicle("hero"))
    zero = np.zeros(512, np.float32)
    for a, b in ((zero, real), (real, zero), (zero, zero), (None, real),
                 (np.full(512, np.nan, np.float32), real), (real[:10], real)):
        value = cosine_similarity(a, b)
        assert value == 0.0 and not math.isnan(value)
    assert cosine_similarity(real, real) == pytest.approx(1.0)


def test_kinematic_feasibility_thresholds():
    assert physics_score(0) == physics_score(120) == 1.0
    assert physics_score(135) == pytest.approx(0.5)
    assert physics_score(150) == pytest.approx(0.0) and physics_score(151) == 0.0
    assert implied_speed_kmh(10, 0) == math.inf and implied_speed_kmh(10, -5) == math.inf
    assert implied_speed_kmh(5, 600) == pytest.approx(30.0)
    assert physics_score(math.inf) == 0.0


def test_ghost_car_weight_redistribution():
    cfg = FusionConfig()
    assert fusion_weights(False, cfg) == (0.35, 0.40, 0.25)
    assert fusion_weights(True, cfg) == (0.0, 0.75, 0.25)


@pytest.mark.parametrize("plate,conf,flag", [
    ("", 0.0, IntegrityFlag.NO_PLATE_DETECTED),
    ("TS09EA1234", 0.65, IntegrityFlag.VALID),              # below 0.70
    ("TS09EA1234", 0.95, IntegrityFlag.INVALID_FORMAT),
    ("TS09EA1234", 0.95, IntegrityFlag.TAMPERED_PHYSICAL),
])
def test_ghost_weights_used_for_unreliable_plates(engine, plate, conf, flag):
    engine.process(sighting("A", "CAM-410", 0, "TS09EA1234", 0.95))
    d = engine.process(sighting("B", "CAM-406", 11, plate, conf, view=1, flag=flag))
    assert d.best.ghost and d.best.weights == (0.0, 0.75, 0.25)


# ─── road network ────────────────────────────────────────────────────────────

def test_road_distance_is_directed_and_not_straight_line():
    road = RoadNetwork()
    km, method = road.distance("CAM-410", "CAM-401")
    assert method == "road_table" and km == pytest.approx(11.735)
    assert road.distance_km("CAM-401", "CAM-410") == pytest.approx(11.964)       # one-way streets
    (la1, lo1), (la2, lo2) = road.coords("CAM-410"), road.coords("CAM-401")
    assert km > haversine_km(la1, lo1, la2, lo2)
    assert road.distance("CAM-401", "CAM-401") == (0.0, "same_camera")


def test_unknown_pair_uses_tortuosity_fallback():
    road = RoadNetwork(extra_cameras={"CAM-999": {"name": "x", "latitude": 17.50, "longitude": 78.40}})
    km, method = road.distance("CAM-401", "CAM-999")
    lat, lon = road.coords("CAM-401")
    assert method == "haversine_x_tortuosity"
    assert km == pytest.approx(haversine_km(lat, lon, 17.50, 78.40) * 1.35)
    assert road.distance("CAM-401", "CAM-NOPE") == (None, "unknown_camera")


# ─── Re-ID ───────────────────────────────────────────────────────────────────

def test_reid_embedding_is_deterministic_512d_unit():
    img = render_vehicle("ghost", 1)
    a, b = REID.extract_embedding(img), REID.extract_embedding(img.copy())
    assert a.shape == (512,) and a.dtype == np.float32
    assert np.array_equal(a, b) and np.linalg.norm(a) == pytest.approx(1.0, abs=1e-5)
    assert not np.any(REID.extract_embedding(np.zeros((2, 2, 3), np.uint8)))      # degenerate crop → zero


def test_reid_separates_vehicles():
    same = cosine_similarity(REID.extract_embedding(render_vehicle("ghost", 0)),
                             REID.extract_embedding(render_vehicle("ghost", 3)))
    other = cosine_similarity(REID.extract_embedding(render_vehicle("ghost", 0)),
                              REID.extract_embedding(render_vehicle("hero", 0)))
    assert same > 0.9 > other


# ─── active state ────────────────────────────────────────────────────────────

def test_create_state_falls_back_to_memory():
    state = create_state("redis://localhost:6390/0", prefix=f"t-{uuid.uuid4().hex[:6]}")
    assert state.backend in ("memory", "redis")
    assert create_state(use_redis=False).backend == "memory"


def test_in_memory_state_window_and_geo():
    state = InMemoryActiveState(window_seconds=1800)
    state.register_cameras(RoadNetwork().cameras)
    base = T0.timestamp()
    state.upsert_active_vehicle("g1", {"last_camera_id": "CAM-410", "last_timestamp": base,
                                       "canonical_plate": "TS09EA1234"})
    state.upsert_active_vehicle("g2", {"last_camera_id": "CAM-401", "last_timestamp": base - 3600})
    assert state.find_by_plate("TS09EA1234") == "g1"
    ids = [v["global_vehicle_id"] for v in state.get_active_candidates("CAM-406", base + 60)]
    assert ids == ["g1"]                                  # g2 is outside the 30-min window
    assert state.get_active_candidates("CAM-406", base + 1801) == []
    assert state.cameras_within("CAM-401", 1.5) == {"CAM-401", "CAM-402", "CAM-411"}
    assert state.cameras_within("CAM-401", 1.0) == {"CAM-401", "CAM-402"}
    assert state.stale_ids(base - 1) == ["g2"]


def test_redis_state_implementation(tmp_path):
    """The real RedisActiveState code path, against fakeredis (no Redis server needed)."""
    fakeredis = pytest.importorskip("fakeredis")
    from backend.fusion.redis_state import RedisActiveState

    client = fakeredis.FakeRedis()
    state = RedisActiveState(client, window_seconds=1800, prefix="t")
    road = RoadNetwork()
    state.register_cameras(road.cameras)
    assert state.cameras_within("CAM-401", 1.5) == {"CAM-401", "CAM-402", "CAM-411"}

    emb = REID.extract_embedding(render_vehicle("hero"))
    base = T0.timestamp()
    state.upsert_active_vehicle("g1", {"last_camera_id": "CAM-410", "last_timestamp": base, "last_lat": 17.44,
                                       "canonical_plate": "TS09EA1234", "appearance_embedding": emb,
                                       "last_plate_text": None})
    assert client.ttl("t:vehicle:g1") == 1800 and client.ttl("t:active:plate:TS09EA1234") == 1800
    v = state.get_vehicle("g1")
    assert v["last_timestamp"] == base and np.array_equal(v["appearance_embedding"], emb)
    assert state.find_by_plate("TS09EA1234") == "g1"
    assert [c["global_vehicle_id"] for c in state.get_active_candidates("CAM-406", base + 60)] == ["g1"]
    assert state.get_active_candidates("CAM-406", base + 1801) == []
    assert state.stale_ids(float("inf")) == ["g1"] and state.stale_ids(base) == []
    state.save_trajectory("g1", {"x": 1})
    assert state.get_trajectory("g1") == {"x": 1}

    # the full engine runs on Redis state too
    store = TrajectoryStore(tmp_path / "r.db")
    eng = FusionEngine(FusionConfig(), RedisActiveState(client, prefix="e"), road, store)
    eng.process(sighting("A", "CAM-410", 0, "TS08UB5678", 0.95, vehicle="ghost"))
    d = eng.process(sighting("B", "CAM-406", 12, "", 0.0, vehicle="ghost", view=1))
    assert d.link == "fusion" and d.global_vehicle_id == vehicle_id_for_plate("TS08UB5678")
    assert d.best.weights == (0.0, 0.75, 0.25)
    eng.flush()
    assert store.get_trajectories("TS08UB5678")[0]["status"] == "COMPLETED"
    state.clear()
    assert not list(client.scan_iter(match="t:*"))
    store.close()


# ─── link guards ─────────────────────────────────────────────────────────────

def test_different_confident_plates_never_link(engine):
    engine.process(sighting("A", "CAM-410", 0, "TS09EA1234", 0.95))
    d = engine.process(sighting("B", "CAM-406", 11, "KA05MN8123", 0.95, view=1))     # same look, other plate
    assert d.link == "new" and d.best.reject_reason == "plate_mismatch"
    assert d.global_vehicle_id == vehicle_id_for_plate("KA05MN8123")


def test_impossible_travel_never_links_a_ghost(engine):
    engine.process(sighting("A", "CAM-410", 0, "TS09EA1234", 0.95))
    d = engine.process(sighting("B", "CAM-401", 0.5, view=0))                         # identical look, 30 s later
    assert d.link == "new" and d.best.reject_reason == "kinematically_infeasible"
    assert d.best.visual_sim > 0.99


def test_same_camera_concurrent_transits_are_different_vehicles(engine):
    engine.process(sighting("A", "CAM-401", 0, vehicle="traffic_2", span_s=10))
    d = engine.process(sighting("B", "CAM-401", 0.1, vehicle="traffic_2", span_s=10))
    assert d.link == "new" and d.best.reject_reason == "concurrent_at_same_camera"


def test_same_camera_ghost_relink_only_for_tracker_fragments(engine):
    engine.process(sighting("A", "CAM-401", 0, vehicle="traffic_2"))
    frag = engine.process(sighting("B", "CAM-401", 0.15, vehicle="traffic_2", view=1))       # 5 s gap
    assert frag.link == "fusion"
    later = engine.process(sighting("C", "CAM-401", 3, vehicle="traffic_2", view=2))         # minutes later
    assert later.link == "new" and later.best.reject_reason == "same_camera_gap_too_long"


def test_weak_appearance_ghost_does_not_link(engine):
    engine.process(sighting("A", "CAM-410", 0, "TS09EA1234", 0.95, vehicle="hero"))
    d = engine.process(sighting("B", "CAM-406", 11, vehicle="traffic_1"))
    assert d.link == "new" and d.best.reject_reason == "weak_appearance"


def test_established_plate_blocks_a_different_confident_plate_after_a_ghost_sighting(engine):
    """Found by the synthetic dataset: vehicle A's plate is read, then A is seen plate-less (glare). A
    look-alike vehicle with a DIFFERENT confident plate must not join A's trajectory just because A's last
    sighting had no plate (ghost weights put all the weight on appearance)."""
    engine.process(sighting("A1", "CAM-410", 2, "TS04NC2034", 0.94, vehicle="ghost", view=0))
    ghost = engine.process(sighting("A2", "CAM-406", 14, vehicle="ghost", view=1))           # glare, no plate
    assert ghost.link == "fusion"
    other = engine.process(sighting("B1", "CAM-411", 24, "MH07BG2705", 0.93, vehicle="ghost", view=1))
    assert other.link == "new" and other.global_vehicle_id != ghost.global_vehicle_id
    assert other.best.reject_reason == "canonical_plate_mismatch"
    # a one-character OCR misread of the SAME plate still links (hero trace 3 -> 8)
    misread = engine.process(sighting("A3", "CAM-401", 30, "TS04NC2084", 0.88, vehicle="ghost", view=0))
    assert misread.global_vehicle_id == ghost.global_vehicle_id


def test_low_confidence_misread_raises_no_clone_alert(engine):
    engine.process(sighting("A", "CAM-410", 0, "MH12AB9999", 0.95))
    d = engine.process(sighting("B", "CAM-401", 0.5, "MH12AB9999", 0.40, vehicle="clone_b"))
    assert d.alerts == []


def test_clone_alert_payload(engine):
    engine.process(sighting("A", "CAM-410", 0, "MH12AB9999", 0.95, vehicle="clone_a"))
    d = engine.process(sighting("B", "CAM-401", 0.5, "MH12AB9999", 0.96, vehicle="clone_b"))
    assert d.link == "plate" and len(d.alerts) == 1
    a = d.alerts[0].to_dict()
    assert a["alert_type"] == "CLONED_PLATE" and a["severity"] == "CRITICAL"
    assert (a["camera_a"], a["camera_b"]) == ("CAM-410", "CAM-401")
    assert a["time_delta_seconds"] == 30.0 and a["road_distance_km"] == pytest.approx(11.735)
    assert a["implied_speed_kmh"] == pytest.approx(1408.2, abs=0.1)
    traj = engine.store.get_trajectories("MH12AB9999")[0]
    assert traj["is_cloned_alert"] is True
    assert engine.store.list_alerts()[0]["alert_id"] == a["alert_id"]


# ─── identity + trajectories ─────────────────────────────────────────────────

def test_uuid5_identity_is_deterministic(engine):
    d = engine.process(sighting("A", "CAM-410", 0, "TS09EA1234", 0.95))
    assert d.global_vehicle_id == str(uuid.uuid5(uuid.NAMESPACE_DNS, "TS09EA1234"))
    ghost = engine.process(sighting("G", "CAM-403", 0, vehicle="traffic_1"))
    assert ghost.global_vehicle_id == str(uuid.uuid5(uuid.NAMESPACE_DNS, "ghost:CAM-403:G"))


def test_ghost_trajectory_promoted_when_plate_is_read(engine):
    first = engine.process(sighting("G1", "CAM-410", 0, vehicle="ghost"))
    d = engine.process(sighting("G2", "CAM-406", 12, "TS08UB5678", 0.92, vehicle="ghost", view=1))
    assert d.link == "fusion" and d.global_vehicle_id == vehicle_id_for_plate("TS08UB5678")
    traj = engine.store.get_trajectories("TS08UB5678")
    assert len(traj) == 1 and traj[0]["aliases"] == [first.global_vehicle_id]
    assert [w["camera_id"] for w in traj[0]["waypoints"]] == ["CAM-410", "CAM-406"]
    assert engine.store.get_trajectories(first.global_vehicle_id)                     # alias lookup


def test_out_of_order_waypoints_are_kept_chronological(engine):
    engine.process(sighting("B", "CAM-406", 11, "TS09EA1234", 0.95, view=1))
    engine.process(sighting("A", "CAM-410", 0, "TS09EA1234", 0.95))
    traj = engine.store.get_trajectories("TS09EA1234")[0]
    assert [w["sighting_id"] for w in traj["waypoints"]] == ["A", "B"]


def test_window_expiry_completes_trajectory_and_starts_a_new_journey(engine):
    engine.process(sighting("A", "CAM-410", 0, "TS09EA1234", 0.95))
    engine.process(sighting("B", "CAM-406", 11, "TS09EA1234", 0.95, view=1))
    engine.process(sighting("C", "CAM-406", 11 + 31, "TS09EA1234", 0.95, view=1))    # > 30 min later
    rows = engine.store.get_trajectories("TS09EA1234")
    assert len(rows) == 2 and {r["global_vehicle_id"] for r in rows} == {vehicle_id_for_plate("TS09EA1234")}
    assert [r["status"] for r in rows] == ["COMPLETED", "ACTIVE"]
    assert rows[0]["sightings_count"] == 2 and rows[1]["sightings_count"] == 1
    engine.flush()
    assert all(r["status"] == "COMPLETED" for r in engine.store.get_trajectories("TS09EA1234"))


# ─── Phase 2 adapter ─────────────────────────────────────────────────────────

def test_sightings_from_phase2_payload(tmp_path):
    from backend.fusion.sources import sightings_from_anpr_run

    video = tmp_path / "clip.mp4"
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"mp4v"), 10, (320, 240))
    for i in range(6):
        frame = np.full((240, 320, 3), 90, np.uint8)
        frame[40:200, 60:260] = cv2.resize(render_vehicle("hero" if i < 3 else "ghost"), (200, 160))
        writer.write(frame)
    writer.release()
    obs = lambda oid, frame, status, plate=None, conf=None: {  # noqa: E731
        "observation_id": oid, "timestamp": "2026-09-19T18:45:01+05:30", "first_seen": "2026-09-19T18:45:00+05:30",
        "last_seen": "2026-09-19T18:45:02+05:30", "best_frame": frame, "vehicle_bbox": [60, 40, 260, 200],
        "plate_status": status, "plate": plate, "ocr_confidence": conf, "vehicle_class": "car", "track_id": frame}
    payload = {"camera_id": "CAM-401", "run": {"video": "clip.mp4"}, "observations": [
        obs("o1", 1, "DETECTED", "AP09AZ6596", 0.94), obs("o2", 4, "NOT_VISIBLE"),
        obs("o3", 4, "INVALID_FORMAT", None, 0.6), obs("o4", 2, "OCR_FAILED")]}
    s = {x.sighting_id: x for x in sightings_from_anpr_run(payload, REID, video)}
    assert s["o1"].integrity_flag is IntegrityFlag.VALID and s["o1"].plate_text == "AP09AZ6596"
    assert s["o2"].integrity_flag is IntegrityFlag.NO_PLATE_DETECTED and s["o2"].plate_text == ""
    assert s["o3"].integrity_flag is IntegrityFlag.INVALID_FORMAT and s["o3"].ocr_confidence == 0.0
    assert all(x.appearance_embedding is not None and x.appearance_embedding.shape == (512,) for x in s.values())
    assert cosine_similarity(s["o2"].appearance_embedding, s["o3"].appearance_embedding) == pytest.approx(1.0)
    rt = Sighting.from_dict(s["o1"].to_dict())                                        # JSON round trip
    assert np.array_equal(rt.appearance_embedding, s["o1"].appearance_embedding) and rt.timestamp == s["o1"].timestamp


def test_broker_unavailable_is_detected_quickly():
    from backend.fusion.broker import broker_available

    assert broker_available("amqp://guest:guest@localhost:5999/%2F") is False


# ─── API ─────────────────────────────────────────────────────────────────────

def test_sqlite_store_read_path(tmp_path):
    """The Phase 3 SQLite bridge (still used offline / by --scenarios). The /api/v1 routes
    now read PostgreSQL + PostGIS — see test_phase4_postgis.py."""
    store = TrajectoryStore(tmp_path / "trajectories.db")
    eng = FusionEngine(FusionConfig(), InMemoryActiveState(), RoadNetwork(), store)
    eng.process(sighting("A", "CAM-410", 0, "TS09EA1234", 0.95))
    eng.process(sighting("B", "CAM-406", 11, "TS09EA1234", 0.95, view=1))
    eng.process(sighting("C", "CAM-410", 20, "MH12AB9999", 0.95, vehicle="clone_a"))
    eng.process(sighting("D", "CAM-401", 20.5, "MH12AB9999", 0.95, vehicle="clone_b"))
    eng.flush()
    assert len(store.list_trajectories()) == 2 and store.counts()["anomalies"] == 1
    assert len(store.list_trajectories(cloned_only=True)) == 1
    one = store.get_trajectories("TS09EA1234")[0]
    assert [w["camera_id"] for w in one["waypoints"]] == ["CAM-410", "CAM-406"]
    assert store.get_trajectories(one["global_vehicle_id"]) and not store.get_trajectories("NOPE")
    assert store.list_alerts()[0]["plate_number"] == "MH12AB9999"
    store.close()


# ─── golden scenarios ────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def golden(tmp_path_factory):
    return run_scenarios(FusionConfig(), db_path=tmp_path_factory.mktemp("g") / "scenarios.db",
                         use_redis=False, reid=REID)


def test_golden_hero_trace(golden):
    h = golden["hero_trace"]
    assert h["passed"] and h["global_vehicle_ids"] == [vehicle_id_for_plate("TS09EA1234")]
    assert [w[0] for w in h["waypoints"]] == ["CAM-410", "CAM-406", "CAM-411", "CAM-401"]
    assert h["links"]["SIM-HERO-411"] == "fusion"                  # 1-char OCR error linked by fusion
    assert all(0 < w[2] < 60 for w in h["waypoints"][1:])


def test_golden_ghost_car(golden):
    g = golden["ghost_car"]
    assert g["passed"] and g["weights"] == [0.0, 0.75, 0.25] and g["score"] >= 0.70


def test_golden_cloned_plate(golden):
    c = golden["cloned_plate"]
    assert c["passed"] and c["alerts"][0]["implied_speed_kmh"] > 500 and c["is_cloned_alert"]


def test_golden_zero_vector(golden):
    assert golden["zero_vector"]["passed"] and golden["all_passed"]
