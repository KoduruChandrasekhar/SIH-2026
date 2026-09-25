"""
TraceNet Phase 3 — local trajectory persistence (pre-Phase-4 bridge).

SQLite at backend/output/fusion/trajectories.db (plus a JSON export). The columns
are exactly what Phase 4 PostgreSQL/PostGIS will ingest:

    trajectories  id, global_vehicle_id, canonical_plate, first_seen, last_seen,
                  total_distance_km, average_speed_kmh, sightings_count,
                  is_cloned_alert, status, source, aliases_json, waypoints_json, updated_at
    anomalies     id, alert_type, severity, plate_number, camera_a, camera_b, …, payload_json
    sightings     sighting_id, trajectory_id, global_vehicle_id, camera_id, timestamp,
                  plate_text, integrity_flag, decision_json          (fusion audit trail)
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from .config import FUSION_OUTPUT_DIR
from .models import AnomalyAlert, Sighting, Trajectory

DEFAULT_DB_PATH = FUSION_OUTPUT_DIR / "trajectories.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS trajectories (
    id                TEXT PRIMARY KEY,
    global_vehicle_id TEXT NOT NULL,
    canonical_plate   TEXT,
    first_seen        TEXT,
    last_seen         TEXT,
    total_distance_km REAL,
    average_speed_kmh REAL,
    sightings_count   INTEGER,
    is_cloned_alert   INTEGER,
    status            TEXT,
    source            TEXT,
    aliases_json      TEXT,
    waypoints_json    TEXT,
    updated_at        TEXT
);
CREATE INDEX IF NOT EXISTS ix_traj_vehicle ON trajectories(global_vehicle_id);
CREATE INDEX IF NOT EXISTS ix_traj_plate ON trajectories(canonical_plate);

CREATE TABLE IF NOT EXISTS anomalies (
    id                 TEXT PRIMARY KEY,
    alert_type         TEXT,
    severity           TEXT,
    plate_number       TEXT,
    camera_a           TEXT,
    camera_b           TEXT,
    time_delta_seconds REAL,
    road_distance_km   REAL,
    implied_speed_kmh  REAL,
    global_vehicle_id  TEXT,
    detected_at        TEXT,
    source             TEXT,
    payload_json       TEXT
);

CREATE TABLE IF NOT EXISTS sightings (
    sighting_id       TEXT PRIMARY KEY,
    trajectory_id     TEXT,
    global_vehicle_id TEXT,
    camera_id         TEXT,
    timestamp         TEXT,
    plate_text        TEXT,
    integrity_flag    TEXT,
    decision_json     TEXT
);
"""


class TrajectoryStore:
    def __init__(self, db_path: Optional[Path | str] = None):
        self.path = Path(db_path) if db_path else DEFAULT_DB_PATH
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(_SCHEMA)

    def close(self) -> None:
        self.conn.close()

    def reset(self, source: Optional[str] = None) -> None:
        """Clear the store (`source` is accepted for interface parity with the PostGIS store)."""
        with self._lock, self.conn:
            for table in ("trajectories", "anomalies", "sightings"):
                self.conn.execute(f"DELETE FROM {table}")

    # ── writes ───────────────────────────────────────────────────────────

    def upsert_trajectory(self, t: Trajectory) -> None:
        d = t.to_dict()
        with self._lock, self.conn:
            self.conn.execute(
                "INSERT OR REPLACE INTO trajectories VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (t.trajectory_id, t.global_vehicle_id, t.canonical_plate, d["first_seen"], d["last_seen"],
                 d["total_distance_km"], d["average_speed_kmh"], d["sightings_count"], int(t.is_cloned_alert),
                 t.status, t.source, json.dumps(t.aliases), json.dumps(d["waypoints"]),
                 datetime.now(timezone.utc).isoformat()),
            )

    def add_alert(self, a: AnomalyAlert) -> None:
        d = a.to_dict()
        with self._lock, self.conn:
            self.conn.execute(
                "INSERT OR REPLACE INTO anomalies VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (a.alert_id, a.alert_type, a.severity, a.plate_number, a.camera_a, a.camera_b,
                 d["time_delta_seconds"], d["road_distance_km"], d["implied_speed_kmh"],
                 a.global_vehicle_id, a.detected_at, a.source, json.dumps(d)),
            )

    def record_sighting(self, s: Sighting, trajectory_id: str, global_id: str, decision: dict[str, Any]) -> None:
        with self._lock, self.conn:
            self.conn.execute(
                "INSERT OR REPLACE INTO sightings VALUES (?,?,?,?,?,?,?,?)",
                (s.sighting_id, trajectory_id, global_id, s.camera_id, s.timestamp.isoformat(),
                 s.plate_text, s.integrity_flag.value, json.dumps(decision)),
            )

    # ── reads ────────────────────────────────────────────────────────────

    @staticmethod
    def _row_to_trajectory(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "trajectory_id": row["id"],
            "global_vehicle_id": row["global_vehicle_id"],
            "canonical_plate": row["canonical_plate"],
            "first_seen": row["first_seen"],
            "last_seen": row["last_seen"],
            "total_distance_km": row["total_distance_km"],
            "average_speed_kmh": row["average_speed_kmh"],
            "sightings_count": row["sightings_count"],
            "is_cloned_alert": bool(row["is_cloned_alert"]),
            "status": row["status"],
            "source": row["source"],
            "aliases": json.loads(row["aliases_json"] or "[]"),
            "waypoints": json.loads(row["waypoints_json"] or "[]"),
        }

    def list_trajectories(self, limit: int = 500, cloned_only: bool = False,
                          min_sightings: int = 1) -> list[dict[str, Any]]:
        sql = "SELECT * FROM trajectories WHERE sightings_count >= ?"
        args: list[Any] = [min_sightings]
        if cloned_only:
            sql += " AND is_cloned_alert = 1"
        sql += " ORDER BY first_seen, id LIMIT ?"
        args.append(limit)
        return [self._row_to_trajectory(r) for r in self.conn.execute(sql, args)]

    def get_trajectories(self, plate_or_id: str) -> list[dict[str, Any]]:
        """By trajectory id, global vehicle id, canonical plate, or a promoted ghost alias."""
        key = plate_or_id.strip()
        rows = self.conn.execute(
            "SELECT * FROM trajectories WHERE id = ? OR global_vehicle_id = ? OR canonical_plate = ? "
            "OR aliases_json LIKE ? ORDER BY first_seen",
            (key, key, key.upper(), f'%"{key}"%'),
        ).fetchall()
        return [self._row_to_trajectory(r) for r in rows]

    def list_alerts(self) -> list[dict[str, Any]]:
        return [json.loads(r["payload_json"]) for r in
                self.conn.execute("SELECT payload_json FROM anomalies ORDER BY detected_at")]

    def counts(self) -> dict[str, int]:
        q = lambda sql: self.conn.execute(sql).fetchone()[0]  # noqa: E731
        return {
            "trajectories": q("SELECT COUNT(*) FROM trajectories"),
            "multi_sighting_trajectories": q("SELECT COUNT(*) FROM trajectories WHERE sightings_count > 1"),
            "cross_camera_trajectories": q(
                "SELECT COUNT(*) FROM (SELECT trajectory_id FROM sightings GROUP BY trajectory_id "
                "HAVING COUNT(DISTINCT camera_id) > 1)"),
            "sightings": q("SELECT COUNT(*) FROM sightings"),
            "anomalies": q("SELECT COUNT(*) FROM anomalies"),
        }

    def export_json(self, path: Optional[Path | str] = None) -> Path:
        out = Path(path) if path else self.path.with_suffix(".json")
        out.parent.mkdir(parents=True, exist_ok=True)
        payload = {"counts": self.counts(), "trajectories": self.list_trajectories(limit=100000),
                   "anomalies": self.list_alerts()}
        out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return out
