"""
TraceNet Phase 6 — alert payloads.

Every alert is a canonical record (stored in anomaly_alerts.payload) plus, when sent to the
UI, a `ui` block in exactly the shape the React Alerts table / toasts already render:

    {id, plateNumber, category, type, severity, timestamp, cameraId, cameraNode, lat, lng,
     confidence, description, status, isNew}

    CLONED_PLATE     CRITICAL  same confident plate, different cameras, implied speed > 150 km/h
    BLACKLIST_HIT    by threat level (HIGH → CRITICAL, MEDIUM → HIGH, LOW → MEDIUM)
    INVALID_FORMAT   HIGH if TAMPERED_PHYSICAL, else MEDIUM — malformed / tampered plate read
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

IST = timezone(timedelta(hours=5, minutes=30))

CATEGORY = {
    "CLONED_PLATE": "Cloned Plate",
    "BLACKLIST_HIT": "Blacklisted Vehicle",
    "INVALID_FORMAT": "Invalid / Tampered Plate",
}
THREAT_TO_SEVERITY = {"HIGH": "CRITICAL", "MEDIUM": "HIGH", "LOW": "MEDIUM"}


def _alert_id(kind: str, sighting_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{kind}:{sighting_id}"))


def blacklist_alert(sighting, entry: dict[str, Any], global_vehicle_id: Optional[str],
                    matched_plate: str) -> dict[str, Any]:
    return {
        "alert_id": _alert_id("blacklist", sighting.sighting_id),
        "alert_type": "BLACKLIST_HIT",
        "severity": THREAT_TO_SEVERITY.get(entry["threat_level"], "HIGH"),
        "plate_number": matched_plate,
        "plate_read": sighting.plate_text or None,          # None when matched through fusion (ghost read)
        "camera_a": None,
        "camera_b": sighting.camera_id,
        "threat_level": entry["threat_level"],
        "reason": entry["reason"],
        "ocr_confidence": round(float(sighting.ocr_confidence), 4),
        "sighting_b": sighting.sighting_id,
        "global_vehicle_id": global_vehicle_id,
        "detected_at": sighting.timestamp.isoformat(),
        "source": sighting.source,
    }


def invalid_format_alert(sighting) -> dict[str, Any]:
    tampered = sighting.integrity_flag.value == "TAMPERED_PHYSICAL"
    return {
        "alert_id": _alert_id("invalid", sighting.sighting_id),
        "alert_type": "INVALID_FORMAT",
        "severity": "HIGH" if tampered else "MEDIUM",
        "plate_number": sighting.plate_text or (sighting.meta.get("raw_text") or "UNREADABLE")[:16],
        "raw_text": sighting.meta.get("raw_text") or sighting.plate_text,
        "integrity_flag": sighting.integrity_flag.value,
        "camera_a": None,
        "camera_b": sighting.camera_id,
        "ocr_confidence": round(float(sighting.ocr_confidence), 4),
        "sighting_b": sighting.sighting_id,
        "detected_at": sighting.timestamp.isoformat(),
        "source": sighting.source,
    }


def _fmt_time(iso: Optional[str]) -> str:
    try:
        return datetime.fromisoformat(iso).astimezone(IST).strftime("%H:%M:%S")
    except (TypeError, ValueError):
        return "—"


def alert_message(payload: dict[str, Any], cameras: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Canonical payload → WebSocket / REST message (adds camera info + the UI row)."""
    kind = payload.get("alert_type", "UNKNOWN")
    cam = payload.get("camera_b") or payload.get("camera_id") or payload.get("camera_a")
    info = cameras.get(cam or "", {})
    plate = payload.get("plate_number") or "—"
    if kind == "CLONED_PLATE":
        speed = payload.get("implied_speed_kmh")
        confidence = f"{round(speed)} km/h" if speed is not None else "impossible"
        description = (f"Plate {plate} read at {payload.get('camera_a')} and {cam} "
                       f"{payload.get('time_delta_seconds')} s apart — {payload.get('road_distance_km')} km by road "
                       f"needs {confidence}. Two vehicles are using this plate.")
    elif kind == "BLACKLIST_HIT":
        confidence = f"{payload.get('ocr_confidence', 0) * 100:.1f}%"
        via = "" if payload.get("plate_read") else " (identified by re-ID fusion; plate unread)"
        description = f"Watchlist {payload.get('threat_level')} threat: {payload.get('reason')}. Sighted at {cam}{via}."
    elif kind == "INVALID_FORMAT":
        confidence = payload.get("integrity_flag", "INVALID_FORMAT")
        description = (f"Plate read '{payload.get('raw_text') or '—'}' at {cam} does not match any Indian "
                       f"registration format ({payload.get('integrity_flag')}). Possible tampering.")
    else:
        confidence, description = "—", kind
    return {
        "event": "alert",
        **payload,
        "camera_id": cam,
        "camera_name": info.get("name"),
        "lat": info.get("lat"),
        "lng": info.get("lng"),
        "ui": {
            "id": f"ALT-{payload.get('alert_id', '')[:8].upper()}",
            "alertId": payload.get("alert_id"),
            "alertType": kind,
            "plateNumber": plate,
            "category": CATEGORY.get(kind, kind),
            "type": "vehicle",
            "severity": payload.get("severity", "MEDIUM"),
            "timestamp": _fmt_time(payload.get("detected_at")),
            "cameraId": (cam or "").replace("-", " #"),
            "cameraNode": f"{cam} ({info.get('name', 'camera')})",
            "lat": info.get("lat"),
            "lng": info.get("lng"),
            "confidence": confidence,
            "description": description,
            "status": "Active",
            "isNew": True,
            "source": payload.get("source"),
        },
    }
