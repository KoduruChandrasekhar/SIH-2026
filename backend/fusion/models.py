"""
TraceNet Phase 3 — fusion data contracts.

    Sighting       one vehicle transit at one camera (from a Phase 2 ANPRObservation)
    Waypoint       one sighting placed on a vehicle's journey
    Trajectory     chronological city-wide journey of one Global Vehicle ID
    AnomalyAlert   kinematic anomaly (cloned plate) for Phase 6 dispatch

Everything serialises to JSON-safe dicts that map onto the Phase 4 tables.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

import numpy as np

EMBEDDING_DIM = 512


class IntegrityFlag(str, Enum):
    VALID = "VALID"
    NO_PLATE_DETECTED = "NO_PLATE_DETECTED"
    INVALID_FORMAT = "INVALID_FORMAT"
    TAMPERED_PHYSICAL = "TAMPERED_PHYSICAL"


def parse_timestamp(value: Any) -> datetime:
    """ISO-8601 string, datetime, or epoch microseconds → tz-aware datetime."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1_000_000, tz=timezone.utc)
    text = str(value).strip()
    if text.isdigit():
        return datetime.fromtimestamp(int(text) / 1_000_000, tz=timezone.utc)
    dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def encode_embedding(emb: Optional[np.ndarray]) -> Optional[str]:
    if emb is None:
        return None
    return base64.b64encode(np.asarray(emb, dtype=np.float32).tobytes()).decode("ascii")


def decode_embedding(value: Any) -> Optional[np.ndarray]:
    if value is None:
        return None
    if isinstance(value, np.ndarray):
        return value.astype(np.float32)
    if isinstance(value, (bytes, bytearray)):
        return np.frombuffer(bytes(value), dtype=np.float32).copy()
    if isinstance(value, str):
        return np.frombuffer(base64.b64decode(value), dtype=np.float32).copy()
    return np.asarray(value, dtype=np.float32)


@dataclass
class Sighting:
    sighting_id: str
    camera_id: str
    timestamp: datetime
    plate_text: str                          # normalised, "" when unreadable
    ocr_confidence: float
    appearance_embedding: Optional[np.ndarray]
    vehicle_bbox: list[float]
    integrity_flag: IntegrityFlag
    vehicle_class: Optional[str] = None
    first_seen: Optional[datetime] = None    # transit interval at this camera (Phase 2)
    last_seen: Optional[datetime] = None
    source: str = "phase2"                   # phase2 | simulated
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def epoch(self) -> float:
        return self.timestamp.timestamp()

    @property
    def interval(self) -> tuple[float, float]:
        start = (self.first_seen or self.timestamp).timestamp()
        end = (self.last_seen or self.timestamp).timestamp()
        return start, end

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Sighting":
        emb = d.get("appearance_embedding")
        if emb is None and d.get("appearance_embedding_b64"):
            emb = d["appearance_embedding_b64"]
        return cls(
            sighting_id=str(d["sighting_id"]),
            camera_id=str(d["camera_id"]).upper(),
            timestamp=parse_timestamp(d["timestamp"]),
            plate_text=(d.get("plate_text") or "").upper(),
            ocr_confidence=float(d.get("ocr_confidence") or 0.0),
            appearance_embedding=decode_embedding(emb),
            vehicle_bbox=list(d.get("vehicle_bbox") or []),
            integrity_flag=IntegrityFlag(d.get("integrity_flag") or "NO_PLATE_DETECTED"),
            vehicle_class=d.get("vehicle_class"),
            first_seen=parse_timestamp(d["first_seen"]) if d.get("first_seen") else None,
            last_seen=parse_timestamp(d["last_seen"]) if d.get("last_seen") else None,
            source=d.get("source", "phase2"),
            meta=dict(d.get("meta") or {}),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "sighting_id": self.sighting_id,
            "camera_id": self.camera_id,
            "timestamp": self.timestamp.isoformat(),
            "plate_text": self.plate_text,
            "ocr_confidence": round(self.ocr_confidence, 4),
            "appearance_embedding_b64": encode_embedding(self.appearance_embedding),
            "vehicle_bbox": self.vehicle_bbox,
            "integrity_flag": self.integrity_flag.value,
            "vehicle_class": self.vehicle_class,
            "first_seen": self.first_seen.isoformat() if self.first_seen else None,
            "last_seen": self.last_seen.isoformat() if self.last_seen else None,
            "source": self.source,
            "meta": self.meta,
        }


@dataclass
class Waypoint:
    sighting_id: str
    camera_id: str
    timestamp: str
    latitude: Optional[float]
    longitude: Optional[float]
    confidence: float                 # fusion score that linked it (1st waypoint: OCR / 1.0)
    speed_from_prev_kmh: float
    distance_from_prev_km: float
    plate_text: str
    integrity_flag: str
    match: dict[str, Any] = field(default_factory=dict)   # score breakdown

    def to_dict(self) -> dict[str, Any]:
        return {
            "sighting_id": self.sighting_id,
            "camera_id": self.camera_id,
            "timestamp": self.timestamp,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "confidence": round(self.confidence, 4),
            "speed_from_prev_kmh": round(self.speed_from_prev_kmh, 2),
            "distance_from_prev_km": round(self.distance_from_prev_km, 3),
            "plate_text": self.plate_text,
            "integrity_flag": self.integrity_flag,
            "match": self.match,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Waypoint":
        return cls(**{k: d.get(k) for k in (
            "sighting_id", "camera_id", "timestamp", "latitude", "longitude", "confidence",
            "speed_from_prev_kmh", "distance_from_prev_km", "plate_text", "integrity_flag")},
            match=d.get("match") or {})


@dataclass
class Trajectory:
    trajectory_id: str                                    # one journey (a vehicle can have several)
    global_vehicle_id: str                                # vehicle identity (UUIDv5)
    canonical_plate: Optional[str]
    waypoints: list[Waypoint] = field(default_factory=list)
    is_cloned_alert: bool = False
    aliases: list[str] = field(default_factory=list)     # earlier ghost ids promoted to this id
    source: str = "phase2"
    status: str = "ACTIVE"                                # ACTIVE | COMPLETED

    @property
    def first_seen(self) -> Optional[str]:
        return self.waypoints[0].timestamp if self.waypoints else None

    @property
    def last_seen(self) -> Optional[str]:
        return self.waypoints[-1].timestamp if self.waypoints else None

    @property
    def total_distance_km(self) -> float:
        return sum(w.distance_from_prev_km for w in self.waypoints)

    @property
    def average_speed_kmh(self) -> float:
        if len(self.waypoints) < 2:
            return 0.0
        hours = (parse_timestamp(self.last_seen) - parse_timestamp(self.first_seen)).total_seconds() / 3600.0
        return self.total_distance_km / hours if hours > 0 else 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "trajectory_id": self.trajectory_id,
            "global_vehicle_id": self.global_vehicle_id,
            "canonical_plate": self.canonical_plate,
            "first_seen": self.first_seen,
            "last_seen": self.last_seen,
            "total_distance_km": round(self.total_distance_km, 3),
            "average_speed_kmh": round(self.average_speed_kmh, 2),
            "sightings_count": len(self.waypoints),
            "is_cloned_alert": self.is_cloned_alert,
            "status": self.status,
            "source": self.source,
            "aliases": self.aliases,
            "waypoints": [w.to_dict() for w in self.waypoints],
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Trajectory":
        return cls(
            trajectory_id=d["trajectory_id"],
            global_vehicle_id=d["global_vehicle_id"],
            canonical_plate=d.get("canonical_plate"),
            waypoints=[Waypoint.from_dict(w) for w in d.get("waypoints", [])],
            is_cloned_alert=bool(d.get("is_cloned_alert")),
            aliases=list(d.get("aliases") or []),
            source=d.get("source", "phase2"),
            status=d.get("status", "ACTIVE"),
        )


@dataclass
class AnomalyAlert:
    alert_id: str
    alert_type: str
    severity: str
    plate_number: str
    camera_a: str
    camera_b: str
    time_delta_seconds: float
    road_distance_km: float
    implied_speed_kmh: float
    sighting_a: str
    sighting_b: str
    global_vehicle_id: Optional[str]
    detected_at: str                  # event time of the second sighting
    source: str = "phase2"

    def to_dict(self) -> dict[str, Any]:
        return {
            "alert_id": self.alert_id,
            "alert_type": self.alert_type,
            "severity": self.severity,
            "plate_number": self.plate_number,
            "camera_a": self.camera_a,
            "camera_b": self.camera_b,
            "time_delta_seconds": round(self.time_delta_seconds, 3),
            "road_distance_km": round(self.road_distance_km, 3),
            "implied_speed_kmh": round(self.implied_speed_kmh, 1) if np.isfinite(self.implied_speed_kmh) else None,
            "sighting_a": self.sighting_a,
            "sighting_b": self.sighting_b,
            "global_vehicle_id": self.global_vehicle_id,
            "detected_at": self.detected_at,
            "source": self.source,
        }
