"""
TraceNet Phase 3 — Phase 2 ANPR observations → fusion Sightings.

For each Phase 2 observation (backend/output/anpr/<CAM>_anpr.json) the vehicle crop is
re-read from the source video at the observation's best frame + vehicle_bbox and turned
into a 512-D appearance embedding. The result is a replayable dump:

    backend/output/fusion/sightings/<CAM>_sightings.json

Plate integrity mapping (Phase 2 plate_status → integrity_flag):
    DETECTED → VALID · INVALID_FORMAT → INVALID_FORMAT · OCR_FAILED / NOT_VISIBLE → NO_PLATE_DETECTED
Only DETECTED plates are passed on as plate_text; everything else is a plate-less sighting.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Iterable, Optional

import cv2
import numpy as np

from backend.anpr.store import load_results

from .config import FUSION_OUTPUT_DIR, PROJECT_ROOT
from .models import IntegrityFlag, Sighting, parse_timestamp
from .reid_matcher import ReIDExtractor

log = logging.getLogger("tracenet.fusion.sources")

SIGHTINGS_DIR = FUSION_OUTPUT_DIR / "sightings"

FLAG_BY_STATUS = {
    "DETECTED": IntegrityFlag.VALID,
    "INVALID_FORMAT": IntegrityFlag.INVALID_FORMAT,
    "OCR_FAILED": IntegrityFlag.NO_PLATE_DETECTED,
    "NOT_VISIBLE": IntegrityFlag.NO_PLATE_DETECTED,
}


def resolve_video(camera_id: str, payload: dict[str, Any]) -> Optional[Path]:
    try:
        from backend.ingestion import get_camera

        cam = get_camera(camera_id)
        if cam is not None and Path(cam.source).exists():
            return Path(cam.source)
    except Exception:
        pass
    name = (payload.get("run") or {}).get("video")
    for candidate in (PROJECT_ROOT / "public" / "camera-feeds" / str(name), PROJECT_ROOT / "public" / "camera-feeds" / f"{camera_id}.mp4"):
        if name and candidate.exists():
            return candidate
    return None


def _crop(frame: np.ndarray, bbox: list[float]) -> Optional[np.ndarray]:
    H, W = frame.shape[:2]
    x1, y1, x2, y2 = (int(round(v)) for v in bbox)
    x1, y1, x2, y2 = max(0, x1), max(0, y1), min(W, x2), min(H, y2)
    if x2 - x1 < 4 or y2 - y1 < 4:
        return None
    return frame[y1:y2, x1:x2]


def sightings_from_anpr_run(payload: dict[str, Any], reid: ReIDExtractor,
                            video_path: Optional[Path] = None) -> list[Sighting]:
    camera_id = payload["camera_id"]
    observations = payload.get("observations", [])
    wanted: dict[int, list[dict]] = {}
    for obs in observations:
        if obs.get("best_frame") is not None and obs.get("vehicle_bbox"):
            wanted.setdefault(int(obs["best_frame"]), []).append(obs)

    embeddings: dict[str, np.ndarray] = {}
    video = video_path or resolve_video(camera_id, payload)
    if video is None:
        log.warning("%s: source video not found - sightings will have no appearance embedding", camera_id)
    elif wanted:
        cap = cv2.VideoCapture(str(video))
        last = max(wanted)
        index = 0
        while index <= last:
            if index in wanted:
                ok, frame = cap.read()
                if not ok:
                    break
                for obs in wanted[index]:
                    crop = _crop(frame, obs["vehicle_bbox"])
                    if crop is not None:
                        embeddings[obs["observation_id"]] = reid.extract_embedding(crop)
            elif not cap.grab():
                break
            index += 1
        cap.release()

    return [sighting_from_observation(obs, camera_id, embeddings.get(obs["observation_id"]), reid.name)
            for obs in observations]


def sighting_from_observation(obs: dict[str, Any], camera_id: str, embedding: Optional[np.ndarray] = None,
                              reid_name: Optional[str] = None, source: str = "phase2") -> Sighting:
    """One Phase 2 ANPR observation (dict form) → Phase 3 Sighting. Only DETECTED plates carry text."""
    status = obs.get("plate_status", "NOT_VISIBLE")
    detected = status == "DETECTED"
    return Sighting(
        sighting_id=obs["observation_id"],
        camera_id=camera_id,
        timestamp=parse_timestamp(obs["timestamp"]),
        plate_text=(obs.get("plate") or "") if detected else "",
        ocr_confidence=float(obs.get("ocr_confidence") or 0.0) if detected else 0.0,
        appearance_embedding=embedding,
        vehicle_bbox=list(obs.get("vehicle_bbox") or []),
        integrity_flag=FLAG_BY_STATUS.get(status, IntegrityFlag.NO_PLATE_DETECTED),
        vehicle_class=obs.get("vehicle_class"),
        first_seen=parse_timestamp(obs["first_seen"]) if obs.get("first_seen") else None,
        last_seen=parse_timestamp(obs["last_seen"]) if obs.get("last_seen") else None,
        source=source,
        meta={"track_id": obs.get("track_id"), "plate_status": status, "status_reason": obs.get("status_reason"),
              "best_frame": obs.get("best_frame"), "consensus_text": obs.get("consensus_text"),
              "q_score": obs.get("q_score") or 0.0,
              # raw OCR text of a malformed read (INVALID_FORMAT alert evidence)
              **({"raw_text": obs.get("raw_ocr") or obs.get("consensus_text")} if status == "INVALID_FORMAT" else {}),
              # Phase 2 evidence URL (served by /api/anpr/evidence) — the plate crop for the timeline
              "crop_path": (f"/api/anpr/evidence/{camera_id}/{obs['best_crop_file']}"
                            if obs.get("best_crop_file") else None),
              "reid": reid_name},
    )


def extract_sightings(reid: ReIDExtractor, cameras: Optional[Iterable[str]] = None,
                      out_dir: Optional[Path] = None) -> dict[str, Path]:
    """Build <CAM>_sightings.json dumps from the saved Phase 2 runs."""
    out_dir = Path(out_dir) if out_dir else SIGHTINGS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    runs = load_results()
    wanted = {c.upper() for c in cameras} if cameras else set(runs)
    written = {}
    for cam, payload in sorted(runs.items()):
        if cam not in wanted:
            continue
        sightings = sightings_from_anpr_run(payload, reid)
        path = out_dir / f"{cam}_sightings.json"
        path.write_text(json.dumps({"camera_id": cam, "reid": reid.name, "anpr_run": payload.get("run", {}).get("run_id"),
                                    "sightings": [s.to_dict() for s in sightings]}, indent=1), encoding="utf-8")
        log.info("%s: %d sightings -> %s", cam, len(sightings), path)
        written[cam] = path
    return written


def load_sighting_dumps(paths: Iterable[Path]) -> list[Sighting]:
    """All sightings from dumps, in chronological order (the replay order)."""
    out: list[Sighting] = []
    for path in paths:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        out.extend(Sighting.from_dict(d) for d in data.get("sightings", []))
    return sorted(out, key=lambda s: (s.timestamp, s.camera_id, s.sighting_id))
