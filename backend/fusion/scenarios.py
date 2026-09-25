"""
TraceNet Phase 3 — golden verification scenarios (SIMULATED input).

The demo footage contains no vehicle that crosses cameras, so the four Phase 3
acceptance scenarios are driven by simulated sightings. They are labelled
source="simulated" and go to backend/output/fusion/scenarios.db by default; with
`--store postgres` they are loaded into PostGIS, still labelled source='simulated' (the
UI shows "simulated run" for them) so they are never mistaken for pipeline output.

Appearance embeddings are NOT random: each vehicle is rendered as a deterministic
synthetic image (body colour, cabin, wheels, livery) with per-camera viewing changes
(brightness, shift, blur), and the real Re-ID extractor turns those pixels into
512-D vectors. The fusion engine under test is the production engine.

    1 HERO TRACE     TS09EA1234  CAM-410 → CAM-406 → CAM-411 → CAM-401  (one read is a 1-char OCR error)
    2 GHOST CAR      TS08UB5678  CAM-410 with plate → CAM-406 NO_PLATE_DETECTED
    3 CLONED PLATE   MH12AB9999  CAM-410 and CAM-401, 30 s apart, two different cars
    4 ZERO VECTOR    all-zero embedding → cosine 0.0, no NaN, pipeline keeps running
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np

from .config import FUSION_OUTPUT_DIR, FusionConfig
from .fusion_engine import FusionEngine, vehicle_id_for_plate
from .models import IntegrityFlag, Sighting
from .redis_state import create_state
from .reid_matcher import ReIDExtractor, cosine_similarity, create_reid_extractor
from .road_network import RoadNetwork
from .trajectory_store import TrajectoryStore

SCENARIO_DB = FUSION_OUTPUT_DIR / "scenarios.db"
T0 = datetime.fromisoformat("2026-09-24T10:00:00+05:30")

# vehicle "models": body colour (BGR), cabin colour, livery stripe colour, has roof rack
VEHICLES = {
    "hero":      ((40, 40, 190), (60, 45, 40), (230, 230, 230), False),   # red sedan, white stripe
    "ghost":     ((160, 110, 30), (50, 40, 35), None, True),              # blue SUV with roof rack
    "clone_a":   ((30, 30, 30), (70, 70, 70), None, False),               # black car
    "clone_b":   ((235, 235, 235), (90, 80, 70), (40, 40, 200), False),   # white car, red stripe
    "traffic_1": ((60, 170, 220), (50, 50, 50), None, False),             # yellow cab
    "traffic_2": ((150, 150, 150), (60, 60, 60), (30, 30, 30), True),     # grey van
}


def render_vehicle(name: str, view: int = 0) -> np.ndarray:
    """Deterministic synthetic vehicle image; `view` changes lighting/position like another camera."""
    body, cabin, stripe, rack = VEHICLES[name]
    img = np.full((120, 160, 3), (95, 95, 95), np.uint8)
    cv2.rectangle(img, (0, 95), (160, 120), (70, 70, 70), -1)                       # road
    cv2.rectangle(img, (18, 45), (142, 95), body, -1)                                 # body
    cv2.fillConvexPoly(img, np.array([[42, 45], [58, 20], [104, 20], [120, 45]]), body)
    cv2.fillConvexPoly(img, np.array([[50, 44], [62, 25], [100, 25], [112, 44]]), cabin)  # glass
    if stripe is not None:
        cv2.rectangle(img, (18, 66), (142, 72), stripe, -1)
    if rack:
        cv2.rectangle(img, (55, 14), (107, 18), (20, 20, 20), -1)
    for cx in (45, 115):
        cv2.circle(img, (cx, 95), 13, (15, 15, 15), -1)
        cv2.circle(img, (cx, 95), 5, (170, 170, 170), -1)
    cv2.rectangle(img, (20, 52), (30, 58), (0, 200, 255), -1)                          # lights
    cv2.rectangle(img, (130, 52), (140, 58), (0, 0, 220), -1)

    # per-camera viewing conditions (deterministic in `view`)
    gain = 1.0 + 0.08 * math.sin(view * 1.7)
    shift = int(3 * math.cos(view * 2.3))
    img = np.clip(img.astype(np.float32) * gain, 0, 255).astype(np.uint8)
    img = cv2.warpAffine(img, np.float32([[1, 0, shift], [0, 1, -shift // 2]]), (160, 120),
                         borderMode=cv2.BORDER_REPLICATE)
    if view % 2:
        img = cv2.GaussianBlur(img, (3, 3), 0)
    return img


def _sighting(reid: ReIDExtractor, sid: str, cam: str, minutes: float, plate: str, conf: float,
              vehicle: str, view: int, flag: IntegrityFlag = IntegrityFlag.VALID,
              embedding: Optional[np.ndarray] = None) -> Sighting:
    ts = T0 + timedelta(minutes=minutes)
    emb = embedding if embedding is not None else reid.extract_embedding(render_vehicle(vehicle, view))
    return Sighting(
        sighting_id=sid, camera_id=cam, timestamp=ts, plate_text=plate, ocr_confidence=conf,
        appearance_embedding=emb, vehicle_bbox=[0, 0, 160, 120], integrity_flag=flag,
        vehicle_class="car", first_seen=ts - timedelta(seconds=2), last_seen=ts + timedelta(seconds=2),
        source="simulated", meta={"vehicle": vehicle, "view": view},
    )


def build_stream(reid: ReIDExtractor) -> list[Sighting]:
    """All scenario sightings (plus background traffic), in chronological order."""
    s = _sighting
    stream = [
        # background traffic sharing the cameras and time window
        s(reid, "SIM-T1-410", "CAM-410", -1.0, "KA05MN8123", 0.93, "traffic_1", 5),
        s(reid, "SIM-T2-406", "CAM-406", 4.0, "", 0.0, "traffic_2", 6, IntegrityFlag.NO_PLATE_DETECTED),
        # 1. hero trace — 5.19 km / 11 min, 5.40 km / 11 min, 2.52 km / 5 min (~30 km/h)
        s(reid, "SIM-HERO-410", "CAM-410", 0.0, "TS09EA1234", 0.94, "hero", 0),
        s(reid, "SIM-HERO-406", "CAM-406", 11.0, "TS09EA1234", 0.91, "hero", 1),
        s(reid, "SIM-HERO-411", "CAM-411", 22.0, "TS09EA1284", 0.88, "hero", 2),   # OCR read 3 as 8
        s(reid, "SIM-HERO-401", "CAM-401", 27.0, "TS09EA1234", 0.93, "hero", 3),
        # 2. ghost car — plate read upstream, mud-covered at CAM-406 12 min later (5.19 km)
        s(reid, "SIM-GHOST-410", "CAM-410", 2.0, "TS08UB5678", 0.92, "ghost", 0),
        s(reid, "SIM-GHOST-406", "CAM-406", 14.0, "", 0.0, "ghost", 1, IntegrityFlag.NO_PLATE_DETECTED),
        # 3. cloned plate — two different cars, 11.7 km apart by road, 30 s apart
        s(reid, "SIM-CLONE-410", "CAM-410", 40.0, "MH12AB9999", 0.95, "clone_a", 0),
        s(reid, "SIM-CLONE-401", "CAM-401", 40.5, "MH12AB9999", 0.96, "clone_b", 1),
        # 4. zero-vector embedding (degenerate Re-ID output) at CAM-411
        s(reid, "SIM-ZERO-411", "CAM-411", 45.0, "", 0.0, "traffic_1", 0, IntegrityFlag.NO_PLATE_DETECTED,
          embedding=np.zeros(512, np.float32)),
    ]
    return sorted(stream, key=lambda x: (x.timestamp, x.sighting_id))


def run_scenarios(config: Optional[FusionConfig] = None, db_path: Optional[Path] = None,
                  use_redis: bool = True, reid: Optional[ReIDExtractor] = None, store=None) -> dict[str, Any]:
    """`store`: a TrajectoryStore / PostgresTrajectoryWriter (default: SQLite scenarios.db)."""
    cfg = config or FusionConfig()
    reid = reid or create_reid_extractor(cfg.reid_weights_path)
    road = RoadNetwork()
    state = create_state(cfg.redis_url, cfg.active_window_seconds,
                         prefix=f"tracenet-scenarios-{uuid.uuid4().hex[:8]}", use_redis=use_redis)
    store = store or TrajectoryStore(db_path or SCENARIO_DB)
    store.reset("simulated")                         # only the simulated rows are replaced
    engine = FusionEngine(cfg, state, road, store, source="simulated")

    decisions = {sg.sighting_id: engine.process(sg) for sg in build_stream(reid)}
    engine.flush()
    if state.backend == "redis":
        state.clear()

    def trajectory_of(sid: str) -> dict[str, Any]:
        tid = decisions[sid].trajectory_id
        return next(t for t in store.list_trajectories(limit=1000) if t["trajectory_id"] == tid)

    # 1. hero
    hero_ids = ["SIM-HERO-410", "SIM-HERO-406", "SIM-HERO-411", "SIM-HERO-401"]
    hero_gids = {decisions[s].global_vehicle_id for s in hero_ids}
    hero_traj = trajectory_of("SIM-HERO-401")
    hero = {
        "global_vehicle_ids": sorted(hero_gids),
        "expected_uuid5": vehicle_id_for_plate("TS09EA1234"),
        "links": {s: decisions[s].link for s in hero_ids},
        "scores": {s: round(decisions[s].best.score, 4) if decisions[s].best else None for s in hero_ids},
        "waypoints": [(w["camera_id"], w["timestamp"], w["speed_from_prev_kmh"]) for w in hero_traj["waypoints"]],
        "total_distance_km": hero_traj["total_distance_km"],
        "average_speed_kmh": hero_traj["average_speed_kmh"],
    }
    hero["passed"] = (len(hero_gids) == 1 and hero_gids == {hero["expected_uuid5"]}
                      and [w[0] for w in hero["waypoints"]] == ["CAM-410", "CAM-406", "CAM-411", "CAM-401"])

    # 2. ghost
    g = decisions["SIM-GHOST-406"]
    ghost = {
        "link": g.link,
        "global_vehicle_id": g.global_vehicle_id,
        "expected_uuid5": vehicle_id_for_plate("TS08UB5678"),
        "weights": list(g.best.weights) if g.best else None,
        "visual_sim": round(g.best.visual_sim, 4) if g.best else None,
        "physics_ok": g.best.physics_ok if g.best else None,
        "score": round(g.best.score, 4) if g.best else None,
        "waypoints": [w["camera_id"] for w in trajectory_of("SIM-GHOST-406")["waypoints"]],
        "visual_sim_vs_other_vehicles": {
            other: round(cosine_similarity(reid.extract_embedding(render_vehicle("ghost", 1)),
                                           reid.extract_embedding(render_vehicle(other, 0))), 4)
            for other in ("hero", "traffic_1", "traffic_2", "clone_b")
        },
    }
    ghost["passed"] = (g.link == "fusion" and g.global_vehicle_id == ghost["expected_uuid5"]
                       and ghost["weights"] == [0.0, cfg.ghost_w_visual, cfg.w_kinematic]
                       and ghost["waypoints"] == ["CAM-410", "CAM-406"])

    # 3. clone
    alerts = [a for a in store.list_alerts() if a["plate_number"] == "MH12AB9999"]
    clone_traj = trajectory_of("SIM-CLONE-401")
    clone = {"alerts": alerts, "is_cloned_alert": clone_traj["is_cloned_alert"],
             "global_vehicle_id": clone_traj["global_vehicle_id"]}
    clone["passed"] = (len(alerts) == 1 and alerts[0]["severity"] == "CRITICAL"
                       and alerts[0]["implied_speed_kmh"] > 500 and clone_traj["is_cloned_alert"])

    # 4. zero vector
    zero_emb = np.zeros(512, np.float32)
    real_emb = reid.extract_embedding(render_vehicle("hero", 0))
    z = decisions["SIM-ZERO-411"]
    zero = {
        "cosine(zero, real)": cosine_similarity(zero_emb, real_emb),
        "cosine(zero, zero)": cosine_similarity(zero_emb, zero_emb),
        "pipeline_link": z.link,
        "best_score_finite": (z.best is None) or math.isfinite(z.best.score),
    }
    zero["passed"] = (zero["cosine(zero, real)"] == 0.0 and zero["cosine(zero, zero)"] == 0.0
                      and zero["best_score_finite"])

    results = {
        "reid": reid.name, "state_backend": state.backend, "db": str(store.path),
        "engine_stats": engine.stats, "store_counts": store.counts(),
        "hero_trace": hero, "ghost_car": ghost, "cloned_plate": clone, "zero_vector": zero,
    }
    results["all_passed"] = all(results[k]["passed"] for k in ("hero_trace", "ghost_car", "cloned_plate", "zero_vector"))
    if isinstance(store, TrajectoryStore):
        store.export_json(Path(store.path).with_suffix(".json"))
    else:
        store.export_json(FUSION_OUTPUT_DIR / "scenarios_postgres.json")
    store.close()
    return results
