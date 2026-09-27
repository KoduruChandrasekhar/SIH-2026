"""
TraceNet Phase 3 — multi-modal cross-camera fusion.

    sighting
      ↓  expire vehicles outside the 30-min window (their trajectories complete)
      ↓  active candidates  (event-time window + GEO radius around the camera)
      ↓  per candidate:  text_sim (normalised Levenshtein)
      ↓                  visual_sim (512-D cosine, zero-norm safe)
      ↓                  physics_ok (road distance / Δt vs 120–150 km/h)
      ↓  score = w1·text + w2·visual + w3·physics   (ghost car: w1=0, w2=0.75)
      ↓  anti-cloning: text_sim ≥ 0.90, different camera, speed > 150 km/h → CRITICAL alert
      ↓  identity: exact active plate → same vehicle; else best candidate ≥ 0.70 passing the
      ↓            hard guards; else a new vehicle
      ↓  Global Vehicle ID = uuid5(NAMESPACE_DNS, plate) | uuid5(NAMESPACE_DNS, "ghost:…")
      ↓
    trajectory (chronological waypoints) → active state + TrajectoryStore

Hard guards (on top of the weighted score, all configurable):
  * kinematically infeasible (physics_ok == 0) never links two sightings;
  * the same camera cannot see one vehicle as two concurrent transits;
  * two confident plates must agree (text_sim ≥ plate_link_min_text_similarity);
  * plate-less links need visual_sim ≥ ghost_min_visual_similarity;
  * a plate-less re-link at the SAME camera must follow within ghost_same_camera_max_gap_seconds
    (that is a tracker fragment; later, a similar-looking car is more likely a different one).
"""

from __future__ import annotations

import logging
import math
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

import numpy as np

from .config import FusionConfig
from .models import AnomalyAlert, IntegrityFlag, Sighting, Trajectory, Waypoint, parse_timestamp
from .redis_state import ActiveState
from .reid_matcher import cosine_similarity
from .road_network import RoadNetwork
from .trajectory_store import TrajectoryStore

log = logging.getLogger("tracenet.fusion")


# ─── scoring primitives ──────────────────────────────────────────────────────

def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a or not b:
        return max(len(a), len(b))
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def text_similarity(plate_a: Optional[str], plate_b: Optional[str]) -> float:
    """Normalised Levenshtein ratio; 0.0 when either plate is missing."""
    if not plate_a or not plate_b:
        return 0.0
    return 1.0 - levenshtein(plate_a, plate_b) / max(len(plate_a), len(plate_b))


def implied_speed_kmh(road_km: Optional[float], dt_seconds: float) -> float:
    if road_km is None or dt_seconds <= 0:
        return math.inf
    return road_km / (dt_seconds / 3600.0)


def physics_score(speed_kmh: float, ok_kmh: float = 120.0, max_kmh: float = 150.0) -> float:
    if speed_kmh <= ok_kmh:
        return 1.0
    if speed_kmh <= max_kmh:
        return max(0.0, 1.0 - (speed_kmh - ok_kmh) / (max_kmh - ok_kmh))
    return 0.0


def plate_is_confident(plate: Optional[str], confidence: float, flag: str, cfg: FusionConfig) -> bool:
    return bool(plate) and flag == IntegrityFlag.VALID.value and confidence >= cfg.ghost_ocr_confidence


def fusion_weights(ghost: bool, cfg: FusionConfig) -> tuple[float, float, float]:
    """Ghost car: the text weight is redistributed onto appearance (0.35 + 0.40 → 0.75)."""
    if ghost:
        return 0.0, cfg.ghost_w_visual, cfg.w_kinematic
    return cfg.w_text, cfg.w_visual, cfg.w_kinematic


def vehicle_id_for_plate(plate: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, plate))


def vehicle_id_for_ghost(sighting: Sighting) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"ghost:{sighting.camera_id}:{sighting.sighting_id}"))


@dataclass
class MatchScore:
    candidate_id: str
    candidate_camera: str
    candidate_plate: Optional[str]
    text_sim: float
    visual_sim: float
    physics_ok: float
    implied_speed_kmh: float
    road_distance_km: Optional[float]
    distance_method: str
    dt_seconds: float
    ghost: bool
    weights: tuple[float, float, float]
    score: float
    eligible: bool = False
    reject_reason: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["implied_speed_kmh"] = round(self.implied_speed_kmh, 2) if math.isfinite(self.implied_speed_kmh) else None
        for key in ("text_sim", "visual_sim", "physics_ok", "score", "dt_seconds"):
            d[key] = round(float(d[key]), 4)
        d["weights"] = list(self.weights)
        return d


@dataclass
class FusionDecision:
    sighting_id: str
    global_vehicle_id: str
    trajectory_id: str
    link: str                       # new | plate | fusion
    linked_to: Optional[str]
    best: Optional[MatchScore]
    candidates_considered: int
    alerts: list[AnomalyAlert] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "sighting_id": self.sighting_id,
            "global_vehicle_id": self.global_vehicle_id,
            "trajectory_id": self.trajectory_id,
            "link": self.link,
            "linked_to": self.linked_to,
            "best": self.best.to_dict() if self.best else None,
            "candidates_considered": self.candidates_considered,
            "alerts": [a.to_dict() for a in self.alerts],
        }


# ─── engine ──────────────────────────────────────────────────────────────────

class FusionEngine:
    def __init__(self, config: FusionConfig, state: ActiveState, road: RoadNetwork,
                 store: Optional[TrajectoryStore] = None, source: str = "phase2"):
        self.cfg = config
        self.state = state
        self.road = road
        self.store = store
        self.source = source
        self.state.register_cameras(road.cameras)
        self.stats: dict[str, int] = {"sightings": 0, "new_vehicles": 0, "plate_links": 0,
                                      "fusion_links": 0, "ghost_sightings": 0, "clone_alerts": 0,
                                      "completed_trajectories": 0}

    # ── pairwise score ───────────────────────────────────────────────────

    def score_pair(self, s: Sighting, v: dict[str, Any]) -> MatchScore:
        cfg = self.cfg
        cand_plate = v.get("last_plate_text") or v.get("canonical_plate") or ""
        cand_flag = v.get("last_integrity_flag", IntegrityFlag.NO_PLATE_DETECTED.value)
        cand_conf = float(v.get("last_ocr_confidence") or 0.0)

        s_confident = plate_is_confident(s.plate_text, s.ocr_confidence, s.integrity_flag.value, cfg)
        c_confident = plate_is_confident(cand_plate, cand_conf, cand_flag, cfg)
        ghost = not (s_confident and c_confident)

        text_sim = text_similarity(s.plate_text, cand_plate)
        visual_sim = cosine_similarity(s.appearance_embedding, v.get("appearance_embedding"))
        road_km, method = self.road.distance(v["last_camera_id"], s.camera_id)
        dt = s.epoch - float(v["last_timestamp"])
        speed = implied_speed_kmh(road_km, dt)
        if road_km == 0.0 and dt > 0:
            speed = 0.0
        physics = physics_score(speed, cfg.speed_ok_kmh, cfg.speed_max_kmh)

        w = fusion_weights(ghost, cfg)
        score = w[0] * text_sim + w[1] * visual_sim + w[2] * physics

        m = MatchScore(
            candidate_id=v["global_vehicle_id"], candidate_camera=v["last_camera_id"], candidate_plate=cand_plate or None,
            text_sim=text_sim, visual_sim=visual_sim, physics_ok=physics, implied_speed_kmh=speed,
            road_distance_km=road_km, distance_method=method, dt_seconds=dt, ghost=ghost, weights=w, score=score,
        )

        # hard guards
        start, end = s.interval
        c_start = float(v.get("last_interval_start", v["last_timestamp"]))
        c_end = float(v.get("last_interval_end", v["last_timestamp"]))
        if v["last_camera_id"] == s.camera_id and start <= c_end and c_start <= end:
            m.reject_reason = "concurrent_at_same_camera"
        elif physics <= 0.0:
            m.reject_reason = "kinematically_infeasible"
        elif s_confident and c_confident and text_sim < cfg.plate_link_min_text_similarity:
            m.reject_reason = "plate_mismatch"
        elif (s_confident and v.get("canonical_plate")
              and text_similarity(s.plate_text, v["canonical_plate"]) < cfg.plate_link_min_text_similarity):
            # the vehicle's plate is already established by a confident read: a different confident plate
            # is a different vehicle, even when its LAST sighting was plate-less (ghost weights would
            # otherwise let appearance alone link two look-alike vehicles)
            m.reject_reason = "canonical_plate_mismatch"
        elif ghost and visual_sim < cfg.ghost_min_visual_similarity:
            m.reject_reason = "weak_appearance"
        elif ghost and v["last_camera_id"] == s.camera_id and start - c_end > cfg.ghost_same_camera_max_gap_seconds:
            m.reject_reason = "same_camera_gap_too_long"
        elif score < cfg.match_threshold:
            m.reject_reason = "below_threshold"
        m.eligible = m.reject_reason is None
        return m

    def _clone_alert(self, s: Sighting, m: MatchScore, v: dict[str, Any]) -> Optional[AnomalyAlert]:
        cfg = self.cfg
        # Both plates must be confident reads: a low-confidence misread never raises a CRITICAL alert.
        if (m.ghost or m.road_distance_km is None or m.candidate_camera == s.camera_id
                or m.text_sim < cfg.clone_text_similarity or m.implied_speed_kmh <= cfg.speed_max_kmh):
            return None
        a_id = v.get("last_sighting_id", m.candidate_id)
        return AnomalyAlert(
            alert_id=str(uuid.uuid5(uuid.NAMESPACE_DNS, f"clone:{a_id}:{s.sighting_id}")),
            alert_type="CLONED_PLATE", severity="CRITICAL", plate_number=s.plate_text,
            camera_a=m.candidate_camera, camera_b=s.camera_id, time_delta_seconds=m.dt_seconds,
            road_distance_km=m.road_distance_km,
            implied_speed_kmh=m.implied_speed_kmh, sighting_a=a_id, sighting_b=s.sighting_id,
            global_vehicle_id=m.candidate_id, detected_at=s.timestamp.isoformat(), source=self.source,
        )

    # ── main entry ───────────────────────────────────────────────────────

    def process(self, s: Sighting) -> FusionDecision:
        cfg = self.cfg
        self.stats["sightings"] += 1
        self.expire(s.epoch)

        s_confident = plate_is_confident(s.plate_text, s.ocr_confidence, s.integrity_flag.value, cfg)
        if not s_confident:
            self.stats["ghost_sightings"] += 1

        allowed = self.state.cameras_within(s.camera_id, cfg.candidate_radius_km)
        candidates = self.state.get_active_candidates(s.camera_id, s.epoch, allowed)
        scored = [(self.score_pair(s, v), v) for v in candidates]

        alerts = [a for m, v in scored if (a := self._clone_alert(s, m, v))]

        link, gid, best = "new", None, None
        plate_gid = self.state.find_by_plate(s.plate_text) if s_confident else None
        if plate_gid:
            # Same confident plate still active → same vehicle, whatever the kinematics say
            # (an impossible transition is reported as a cloned plate, not silently split).
            link, gid = "plate", plate_gid
            best = next((m for m, _ in scored if m.candidate_id == plate_gid), None)
            if best is None and (v := self.state.get_vehicle(plate_gid)):
                best = self.score_pair(s, v)
        else:
            eligible = sorted((m for m, _ in scored if m.eligible), key=lambda m: m.score, reverse=True)
            if eligible:
                link, gid, best = "fusion", eligible[0].candidate_id, eligible[0]
            elif scored:
                best = max((m for m, _ in scored), key=lambda m: m.score)

        if gid is None:
            gid = vehicle_id_for_plate(s.plate_text) if s_confident else vehicle_id_for_ghost(s)
            self.stats["new_vehicles"] += 1
        else:
            self.stats["plate_links" if link == "plate" else "fusion_links"] += 1

        traj = self._load_trajectory(gid, s)
        # A ghost trajectory that is now identified by a confident plate is promoted to uuid5(plate).
        if s_confident and not traj.canonical_plate:
            gid = self._promote(traj, s.plate_text)

        if alerts:
            traj.is_cloned_alert = True
            self.stats["clone_alerts"] += len(alerts)
            for a in alerts:
                a.global_vehicle_id = gid
                log.warning("CLONED_PLATE %s %s->%s %.1f km in %.1f s = %.0f km/h", a.plate_number,
                            a.camera_a, a.camera_b, a.road_distance_km, a.time_delta_seconds, a.implied_speed_kmh)

        confidence = (best.score if link == "fusion" and best else
                      s.ocr_confidence if s_confident else 0.0)
        self._add_waypoint(traj, s, confidence, link, best)

        decision = FusionDecision(
            sighting_id=s.sighting_id, global_vehicle_id=gid, trajectory_id=traj.trajectory_id,
            link=link, linked_to=gid if link != "new" else None, best=best,
            candidates_considered=len(scored), alerts=alerts,
        )
        # The observation is stored before the trajectory: the PostGIS store builds the
        # route geometry from the journey's stored observations.
        if self.store:
            self.store.record_sighting(s, traj.trajectory_id, gid, decision.to_dict())
        self._save(traj, s)
        if self.store:
            for a in alerts:
                self.store.add_alert(a)
        return decision

    # ── trajectory bookkeeping ───────────────────────────────────────────

    def _load_trajectory(self, gid: str, s: Sighting) -> Trajectory:
        data = self.state.get_trajectory(gid)
        if data:
            return Trajectory.from_dict(data)
        plate = s.plate_text if plate_is_confident(s.plate_text, s.ocr_confidence, s.integrity_flag.value, self.cfg) else None
        return Trajectory(
            trajectory_id=str(uuid.uuid5(uuid.NAMESPACE_DNS, f"trajectory:{gid}:{s.sighting_id}")),
            global_vehicle_id=gid, canonical_plate=plate, source=self.source,
        )

    def _promote(self, traj: Trajectory, plate: str) -> str:
        old = traj.global_vehicle_id
        new = vehicle_id_for_plate(plate)
        self.state.remove_vehicle(old)
        self.state.delete_trajectory(old)
        traj.aliases.append(old)
        traj.global_vehicle_id, traj.canonical_plate = new, plate
        return new

    def _add_waypoint(self, traj: Trajectory, s: Sighting, confidence: float, link: str,
                      best: Optional[MatchScore]) -> None:
        lat, lon = self.road.coords(s.camera_id)
        traj.waypoints.append(Waypoint(
            sighting_id=s.sighting_id, camera_id=s.camera_id, timestamp=s.timestamp.isoformat(),
            latitude=lat, longitude=lon, confidence=float(confidence), speed_from_prev_kmh=0.0,
            distance_from_prev_km=0.0, plate_text=s.plate_text, integrity_flag=s.integrity_flag.value,
            match={"link": link, **(best.to_dict() if best else {})},
        ))
        traj.waypoints.sort(key=lambda w: parse_timestamp(w.timestamp))
        for prev, cur in zip(traj.waypoints, traj.waypoints[1:]):          # re-derive legs
            km = self.road.distance_km(prev.camera_id, cur.camera_id) or 0.0
            dt = (parse_timestamp(cur.timestamp) - parse_timestamp(prev.timestamp)).total_seconds()
            speed = implied_speed_kmh(km, dt) if km > 0 else 0.0
            cur.distance_from_prev_km = km
            cur.speed_from_prev_kmh = speed if math.isfinite(speed) else 0.0
        traj.waypoints[0].distance_from_prev_km = 0.0
        traj.waypoints[0].speed_from_prev_kmh = 0.0
        traj.status = "ACTIVE"

    def _save(self, traj: Trajectory, s: Sighting) -> None:
        gid = traj.global_vehicle_id
        previous = self.state.get_vehicle(gid) or {}
        emb = s.appearance_embedding
        if emb is None or not np.any(emb):
            emb = previous.get("appearance_embedding")
        lat, lon = self.road.coords(s.camera_id)
        start, end = s.interval
        self.state.upsert_active_vehicle(gid, {
            "trajectory_id": traj.trajectory_id,
            "last_camera_id": s.camera_id,
            "last_timestamp": s.epoch,
            "last_lat": lat,
            "last_lon": lon,
            "canonical_plate": traj.canonical_plate,
            "last_plate_text": s.plate_text or None,
            "last_ocr_confidence": s.ocr_confidence,
            "last_integrity_flag": s.integrity_flag.value,
            "last_sighting_id": s.sighting_id,
            "last_interval_start": start,
            "last_interval_end": end,
            "appearance_embedding": emb,
        })
        self.state.save_trajectory(gid, traj.to_dict())
        if self.store:
            self.store.upsert_trajectory(traj)

    def expire(self, now_epoch: float) -> None:
        """Vehicles unseen for the whole window: their trajectory is complete."""
        for gid in self.state.stale_ids(now_epoch - self.cfg.active_window_seconds):
            self._complete(gid)

    def _complete(self, gid: str) -> None:
        data = self.state.get_trajectory(gid)
        if data and self.store:
            traj = Trajectory.from_dict(data)
            traj.status = "COMPLETED"
            self.store.upsert_trajectory(traj)
        self.state.remove_vehicle(gid)
        self.state.delete_trajectory(gid)
        self.stats["completed_trajectories"] += 1

    def flush(self) -> None:
        """End of a replay: complete every open trajectory."""
        for gid in self.state.stale_ids(math.inf):
            self._complete(gid)
