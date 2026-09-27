"""
TraceNet Phase 6 — live fusion service inside the API process.

    FusionWorker (q.fusion) / direct ingest ──► LiveFusionService.process(sighting)
        ├─ appearance embedding (sent as a vector, or computed here from a PNG/JPEG vehicle crop)
        ├─ Phase 3 FusionEngine (Redis / in-memory state) → Phase 4 PostGIS writer
        ├─ CLONED_PLATE   ← FusionEngine kinematic anomaly (> 150 km/h)
        ├─ BLACKLIST_HIT  ← O(1) watchlist lookup on the read plate AND the fused vehicle's plate
        └─ INVALID_FORMAT ← integrity flag INVALID_FORMAT / TAMPERED_PHYSICAL
    → canonical alert payloads (stored in anomaly_alerts) for the WebSocket broadcaster

The engine is synchronous (psycopg), so calls run in a worker thread under a lock.
"""

from __future__ import annotations

import base64
import logging
import threading
import uuid
from typing import Any, Optional

import cv2
import numpy as np
import psycopg
from psycopg.types.json import Jsonb

from backend.fusion.config import load_fusion_config
from backend.fusion.fusion_engine import FusionEngine
from backend.fusion.models import IntegrityFlag, Sighting
from backend.fusion.postgres_writer import PostgresTrajectoryWriter
from backend.fusion.redis_state import create_state
from backend.fusion.reid_matcher import create_reid_extractor
from backend.fusion.road_network import RoadNetwork
from backend.fusion.runtime import runtime

from .payloads import blacklist_alert, invalid_format_alert
from .watchlist import WatchlistCache

log = logging.getLogger("tracenet.alerts.live")

ALERT_FLAGS = {IntegrityFlag.INVALID_FORMAT, IntegrityFlag.TAMPERED_PHYSICAL}


class LiveFusionService:
    def __init__(self, url: str):
        self.url = url
        self.cfg = load_fusion_config()
        self.road = RoadNetwork()
        self.reid = create_reid_extractor(self.cfg.reid_weights_path)
        self.watchlist = WatchlistCache(url)
        self.writer = PostgresTrajectoryWriter(url, self.road)
        self._lock = threading.Lock()
        self._new_engine()
        self.processed = 0

    def _new_engine(self) -> None:
        rt = runtime()
        self.state = create_state(rt.redis_url, self.cfg.active_window_seconds, prefix=rt.live_prefix)
        self.engine = FusionEngine(self.cfg, self.state, self.road, self.writer, source="phase2")

    def cameras(self) -> dict[str, dict[str, Any]]:
        return {code: {"name": m.get("name"), "lat": m.get("latitude"), "lng": m.get("longitude")}
                for code, m in self.road.cameras.items()}

    def _sighting(self, data: dict[str, Any]) -> Sighting:
        data = dict(data)
        # vehicle crop as base64 PNG/JPEG (PNG preferred: JPEG artefacts lower the Re-ID similarity)
        crop_b64 = data.pop("vehicle_crop_b64", None) or data.pop("vehicle_crop_jpeg_b64", None)
        data.pop("vehicle_crop_jpeg_b64", None)
        s = Sighting.from_dict(data)
        if s.appearance_embedding is None and crop_b64:
            img = cv2.imdecode(np.frombuffer(base64.b64decode(crop_b64), np.uint8), cv2.IMREAD_COLOR)
            if img is not None:
                s.appearance_embedding = self.reid.extract_embedding(img)
        if s.camera_id not in self.road.cameras:
            raise ValueError(f"unknown camera {s.camera_id}")
        return s

    def process(self, data: dict[str, Any]) -> dict[str, Any]:
        s = self._sighting(data)
        with self._lock:
            self.engine.source = s.source             # journeys inherit the provenance of their sightings
            decision = self.engine.process(s)
            alerts: list[dict[str, Any]] = [a.to_dict() for a in decision.alerts]   # CLONED_PLATE (already stored)

            traj = self.state.get_trajectory(decision.global_vehicle_id) or {}
            for plate in dict.fromkeys(p for p in (s.plate_text, traj.get("canonical_plate")) if p):
                entry = self.watchlist.lookup(plate)
                if entry:
                    alerts.append(blacklist_alert(s, entry, decision.global_vehicle_id, entry["plate"]))
                    break
            if s.integrity_flag in ALERT_FLAGS:
                alerts.append(invalid_format_alert(s))
            for a in alerts:
                if a["alert_type"] != "CLONED_PLATE":
                    self._store(a)
            self.processed += 1
        return {"sighting_id": s.sighting_id, "decision": decision.to_dict(), "alerts": alerts,
                "canonical_plate": traj.get("canonical_plate")}

    def _store(self, a: dict[str, Any]) -> None:
        self.writer.conn.execute(
            "INSERT INTO anomaly_alerts (id, alert_type, severity, plate_number, camera_a, camera_b, time_delta_seconds, "
            "road_distance_km, implied_speed_kmh, global_vehicle_id, detected_at, source, payload) "
            "VALUES (%s,%s,%s,%s,%s,%s,NULL,NULL,NULL,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING",
            (a["alert_id"], a["alert_type"], a["severity"], a["plate_number"], a.get("camera_a"), a.get("camera_b"),
             a.get("global_vehicle_id"), a["detected_at"], a["source"], Jsonb(a)),
        )

    def reset(self, source: str = "simulated") -> dict[str, Any]:
        """Remove one source's fused rows + alerts and start from an empty active window."""
        with self._lock:
            self.writer.reset(source)
            try:
                self.state.clear()
            except Exception:
                pass
            self._new_engine()
        return {"reset": source, "state_backend": self.state.backend}


_service: Optional[LiveFusionService] = None
_service_lock = threading.Lock()


def get_live_service() -> LiveFusionService:
    global _service
    from backend.api.db import current_url

    url = current_url()
    with _service_lock:
        if _service is None or _service.url != url:
            _service = LiveFusionService(url)
    return _service


def new_sighting_id(prefix: str = "live") -> str:
    return f"{prefix}:{uuid.uuid4().hex[:12]}"


def recent_alerts(url: str, limit: int = 50) -> list[dict[str, Any]]:
    with psycopg.connect(url, connect_timeout=3) as conn:
        rows = conn.execute("SELECT payload FROM anomaly_alerts ORDER BY detected_at DESC LIMIT %s", (limit,)).fetchall()
    return [r[0] for r in rows]
