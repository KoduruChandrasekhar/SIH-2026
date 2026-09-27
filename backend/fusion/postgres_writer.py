"""
TraceNet Phase 4 — Phase 3 fusion → PostgreSQL + PostGIS.

Drop-in store for FusionEngine (same interface as the Phase 3 SQLite TrajectoryStore):

    record_sighting(sighting, trajectory_id, global_id, decision)
        → vehicle_observations row (ULID id, camera point geometry, packed embedding),
          upserted on sighting_id so replays are idempotent
    upsert_trajectory(trajectory)
        → propagates canonical plate / vehicle id to the journey's observations, then builds
          trajectory_line   = ST_MakeLine(location ORDER BY observed_at)
          trajectory_line_m = ST_MakeLine(ST_MakePointM(x, y, epoch) ORDER BY observed_at)
          in SQL from the stored observations (NULL until ≥ 2 observations)
    add_alert(alert) → anomaly_alerts

Read helpers mirror TrajectoryStore so the fusion CLI / scenarios work against either.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import numpy as np
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from ulid import ULID

from backend.db.config import database_url, redact

from .config import FUSION_OUTPUT_DIR
from .models import AnomalyAlert, Sighting, Trajectory
from .road_network import RoadNetwork

log = logging.getLogger("tracenet.postgres")

IST = timezone(timedelta(hours=5, minutes=30))


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.astimezone(IST).isoformat() if dt else None


def postgres_available(url: Optional[str] = None) -> bool:
    try:
        with psycopg.connect(url or database_url(), connect_timeout=2) as conn:
            conn.execute("SELECT 1")
        return True
    except Exception as exc:
        log.info("PostgreSQL unavailable at %s (%s)", redact(url or database_url()), type(exc).__name__)
        return False


class PostgresTrajectoryWriter:
    def __init__(self, url: Optional[str] = None, road: Optional[RoadNetwork] = None):
        self.url = url or database_url()
        self.path = redact(self.url)            # shown by the CLI in place of a file path
        self.conn = psycopg.connect(self.url, autocommit=True, row_factory=dict_row)
        self.road = road or RoadNetwork()
        self._camera_ids: dict[str, str] = {}

    def close(self) -> None:
        self.conn.close()

    # ── cameras ──────────────────────────────────────────────────────────

    def ensure_camera(self, code: str) -> str:
        """Camera ULID for `code`; registers it from the road network if it is not seeded yet."""
        code = code.upper()
        if code in self._camera_ids:
            return self._camera_ids[code]
        row = self.conn.execute("SELECT id FROM cameras WHERE camera_code = %s", (code,)).fetchone()
        if row is None:
            lat, lon = self.road.coords(code)
            if lat is None:
                raise ValueError(f"Camera {code} is not seeded and has no known coordinates")
            meta = self.road.cameras.get(code, {})
            road_name = meta.get("road") or "Unknown road"
            try:
                from backend.ingestion import get_camera

                cam = get_camera(code)
                if cam is not None:
                    road_name = cam.road or road_name
            except Exception:
                pass
            self.conn.execute(
                "INSERT INTO cameras (id, camera_code, road_name, junction_name, latitude, longitude) "
                "VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (camera_code) DO NOTHING",
                (str(ULID()), code, road_name, meta.get("name", code), lat, lon),
            )
            row = self.conn.execute("SELECT id FROM cameras WHERE camera_code = %s", (code,)).fetchone()
        self._camera_ids[code] = row["id"]
        return row["id"]

    # ── FusionEngine store interface ─────────────────────────────────────

    def record_sighting(self, s: Sighting, trajectory_id: str, global_id: str, decision: dict[str, Any]) -> None:
        camera_id = self.ensure_camera(s.camera_id)
        emb = s.appearance_embedding
        packed = np.asarray(emb, dtype=np.float32).tobytes() if emb is not None and np.any(emb) else None
        self.conn.execute(
            """
            INSERT INTO vehicle_observations
                (id, camera_id, plate_number, canonical_plate, confidence, q_score, appearance_embedding,
                 integrity_flags, observed_at, location, crop_path, sighting_id, trajectory_id,
                 global_vehicle_id, vehicle_class, vehicle_bbox, source, fusion_decision)
            SELECT %(id)s, c.id, %(plate)s, %(plate)s, %(conf)s, %(q)s, %(emb)s, %(flag)s, %(ts)s, c.location,
                   %(crop)s, %(sid)s, %(tid)s, %(gid)s, %(cls)s, %(bbox)s, %(source)s, %(decision)s
            FROM cameras c WHERE c.id = %(cam)s
            ON CONFLICT (sighting_id) DO UPDATE SET
                camera_id = EXCLUDED.camera_id, plate_number = EXCLUDED.plate_number,
                confidence = EXCLUDED.confidence, q_score = EXCLUDED.q_score,
                appearance_embedding = EXCLUDED.appearance_embedding, integrity_flags = EXCLUDED.integrity_flags,
                observed_at = EXCLUDED.observed_at, location = EXCLUDED.location, crop_path = EXCLUDED.crop_path,
                trajectory_id = EXCLUDED.trajectory_id, global_vehicle_id = EXCLUDED.global_vehicle_id,
                vehicle_class = EXCLUDED.vehicle_class, vehicle_bbox = EXCLUDED.vehicle_bbox,
                source = EXCLUDED.source, fusion_decision = EXCLUDED.fusion_decision
            """,
            {
                "id": str(ULID()), "cam": camera_id, "plate": s.plate_text or None,
                "conf": float(s.ocr_confidence), "q": float(s.meta.get("q_score") or 0.0), "emb": packed,
                "flag": s.integrity_flag.value, "ts": s.timestamp, "crop": s.meta.get("crop_path"),
                "sid": s.sighting_id, "tid": trajectory_id, "gid": global_id, "cls": s.vehicle_class,
                "bbox": Jsonb(s.vehicle_bbox), "source": s.source, "decision": Jsonb(decision),
            },
        )

    def upsert_trajectory(self, t: Trajectory) -> None:
        d = t.to_dict()
        with self.conn.transaction():
            # The journey's resolved identity applies to every observation in it (incl. plate-less ones).
            self.conn.execute(
                "UPDATE vehicle_observations SET canonical_plate = %s, global_vehicle_id = %s WHERE trajectory_id = %s",
                (t.canonical_plate, t.global_vehicle_id, t.trajectory_id),
            )
            self.conn.execute(
                """
                INSERT INTO global_trajectories
                    (id, global_vehicle_id, canonical_plate, first_seen, last_seen, observation_count,
                     total_distance_km, average_speed_kmh, is_cloned_alert, status, source, aliases, legs,
                     trajectory_line, trajectory_line_m, updated_at)
                SELECT %(id)s::varchar, %(gid)s, %(plate)s, min(o.observed_at), max(o.observed_at), count(*),
                       %(dist)s, %(speed)s, %(clone)s, %(status)s, %(source)s, %(aliases)s, %(legs)s,
                       CASE WHEN count(*) >= 2 THEN ST_MakeLine(o.location ORDER BY o.observed_at, o.id) END,
                       CASE WHEN count(*) >= 2 THEN ST_MakeLine(
                           ST_MakePointM(ST_X(o.location), ST_Y(o.location), EXTRACT(EPOCH FROM o.observed_at))
                           ORDER BY o.observed_at, o.id) END,
                       now()
                FROM vehicle_observations o
                WHERE o.trajectory_id = %(id)s::varchar
                HAVING count(*) > 0
                ON CONFLICT (id) DO UPDATE SET
                    global_vehicle_id = EXCLUDED.global_vehicle_id, canonical_plate = EXCLUDED.canonical_plate,
                    first_seen = EXCLUDED.first_seen, last_seen = EXCLUDED.last_seen,
                    observation_count = EXCLUDED.observation_count, total_distance_km = EXCLUDED.total_distance_km,
                    average_speed_kmh = EXCLUDED.average_speed_kmh, is_cloned_alert = EXCLUDED.is_cloned_alert,
                    status = EXCLUDED.status, source = EXCLUDED.source, aliases = EXCLUDED.aliases,
                    legs = EXCLUDED.legs, trajectory_line = EXCLUDED.trajectory_line,
                    trajectory_line_m = EXCLUDED.trajectory_line_m, updated_at = now()
                """,
                {
                    "id": t.trajectory_id, "gid": t.global_vehicle_id, "plate": t.canonical_plate,
                    "dist": d["total_distance_km"], "speed": d["average_speed_kmh"], "clone": t.is_cloned_alert,
                    "status": t.status, "source": t.source, "aliases": Jsonb(t.aliases), "legs": Jsonb(d["waypoints"]),
                },
            )

    def add_alert(self, a: AnomalyAlert) -> None:
        d = a.to_dict()
        self.conn.execute(
            """
            INSERT INTO anomaly_alerts (id, alert_type, severity, plate_number, camera_a, camera_b, time_delta_seconds,
                                        road_distance_km, implied_speed_kmh, global_vehicle_id, detected_at, source, payload)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING
            """,
            (a.alert_id, a.alert_type, a.severity, a.plate_number, a.camera_a, a.camera_b, d["time_delta_seconds"],
             d["road_distance_km"], d["implied_speed_kmh"], a.global_vehicle_id, a.detected_at, a.source, Jsonb(d)),
        )

    # ── maintenance / reads (mirror TrajectoryStore) ─────────────────────

    def reset(self, source: Optional[str] = None) -> None:
        """Delete fused rows of one source (phase2 | simulated); never touches seed_backdrop."""
        sources = [source] if source else ["phase2", "simulated"]
        with self.conn.transaction():
            for table in ("vehicle_observations", "global_trajectories", "anomaly_alerts"):
                self.conn.execute(f"DELETE FROM {table} WHERE source = ANY(%s)", (sources,))

    def _row(self, r: dict[str, Any]) -> dict[str, Any]:
        return {
            "trajectory_id": r["id"], "global_vehicle_id": r["global_vehicle_id"],
            "canonical_plate": r["canonical_plate"], "first_seen": _iso(r["first_seen"]),
            "last_seen": _iso(r["last_seen"]), "total_distance_km": r["total_distance_km"],
            "average_speed_kmh": r["average_speed_kmh"], "sightings_count": r["observation_count"],
            "is_cloned_alert": r["is_cloned_alert"], "status": r["status"], "source": r["source"],
            "aliases": r["aliases"] or [], "waypoints": r["legs"] or [],
        }

    def list_trajectories(self, limit: int = 500, cloned_only: bool = False, min_sightings: int = 1) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM global_trajectories WHERE observation_count >= %s AND (NOT %s OR is_cloned_alert) "
            "ORDER BY first_seen, id LIMIT %s",
            (min_sightings, cloned_only, limit),
        ).fetchall()
        return [self._row(r) for r in rows]

    def get_trajectories(self, plate_or_id: str) -> list[dict]:
        key = plate_or_id.strip()
        rows = self.conn.execute(
            "SELECT * FROM global_trajectories WHERE id = %s OR global_vehicle_id = %s OR canonical_plate = %s "
            "OR aliases ? %s ORDER BY first_seen",
            (key, key, key.upper(), key),
        ).fetchall()
        return [self._row(r) for r in rows]

    def list_alerts(self) -> list[dict]:
        return [r["payload"] for r in self.conn.execute("SELECT payload FROM anomaly_alerts ORDER BY detected_at")]

    def counts(self) -> dict[str, int]:
        one = lambda sql: self.conn.execute(sql).fetchone()["n"]  # noqa: E731
        return {
            "trajectories": one("SELECT count(*) AS n FROM global_trajectories"),
            "multi_sighting_trajectories": one("SELECT count(*) AS n FROM global_trajectories WHERE observation_count > 1"),
            "cross_camera_trajectories": one(
                "SELECT count(*) AS n FROM (SELECT trajectory_id FROM vehicle_observations WHERE trajectory_id IS NOT NULL "
                "GROUP BY trajectory_id HAVING count(DISTINCT camera_id) > 1) x"),
            "sightings": one("SELECT count(*) AS n FROM vehicle_observations WHERE trajectory_id IS NOT NULL"),
            "anomalies": one("SELECT count(*) AS n FROM anomaly_alerts"),
            "backdrop_observations": one("SELECT count(*) AS n FROM vehicle_observations WHERE source = 'seed_backdrop'"),
        }

    def export_json(self, path: Optional[Path | str] = None) -> Path:
        out = Path(path) if path else FUSION_OUTPUT_DIR / "trajectories_postgres.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({"counts": self.counts(), "trajectories": self.list_trajectories(limit=100000),
                                   "anomalies": self.list_alerts()}, indent=2, default=str), encoding="utf-8")
        return out
