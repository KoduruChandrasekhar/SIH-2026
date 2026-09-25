"""
TraceNet Phase 2 — file-based ANPR store (Phase 4 replaces this with PostgreSQL).

    backend/output/anpr/<CAMERA>_anpr.json          run metadata + stats + observations
    backend/output/anpr/evidence/<CAMERA>/*.jpg     plate crops, preprocessed crops, context frames

Only the top-K OCR'd crops of each transit are written — never every frame.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ANPR_OUTPUT_DIR = PROJECT_ROOT / "backend" / "output" / "anpr"

_SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")


def _root(root: Optional[Path | str]) -> Path:
    return Path(root) if root else ANPR_OUTPUT_DIR


def results_path(camera_id: str, root: Optional[Path | str] = None) -> Path:
    return _root(root) / f"{camera_id.upper()}_anpr.json"


def evidence_dir(camera_id: str, root: Optional[Path | str] = None) -> Path:
    return _root(root) / "evidence" / camera_id.upper()


class EvidenceWriter:
    """Writes evidence JPEGs for one camera run (the camera's old evidence is cleared first)."""

    def __init__(self, camera_id: str, root: Optional[Path | str] = None, jpeg_quality: int = 90):
        self.dir = evidence_dir(camera_id, root)
        self.jpeg_quality = jpeg_quality
        self.dir.mkdir(parents=True, exist_ok=True)
        for old in self.dir.glob("*.jpg"):
            try:
                old.unlink()
            except OSError:
                pass

    def save_image(self, name: str, image: np.ndarray) -> Optional[str]:
        ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, self.jpeg_quality])
        return self.save_bytes(name, buf.tobytes()) if ok else None

    def save_bytes(self, name: str, data: bytes) -> Optional[str]:
        if not data:
            return None
        (self.dir / name).write_bytes(data)
        return name


def save_results(camera_id: str, payload: dict[str, Any], root: Optional[Path | str] = None) -> Path:
    path = results_path(camera_id, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    os.replace(tmp, path)
    return path


def load_results(camera_id: Optional[str] = None, root: Optional[Path | str] = None) -> dict[str, dict[str, Any]]:
    """camera_id → saved run payload. Unreadable files are skipped, not fatal."""
    base = _root(root)
    if not base.is_dir():
        return {}
    files = [results_path(camera_id, root)] if camera_id else sorted(base.glob("*_anpr.json"))
    out: dict[str, dict[str, Any]] = {}
    for path in files:
        if not path.exists():
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
            out[data.get("camera_id", path.stem.replace("_anpr", ""))] = data
        except (OSError, ValueError):
            continue
    return out


def evidence_file(camera_id: str, filename: str, root: Optional[Path | str] = None) -> Optional[Path]:
    """Resolve an evidence file safely (no path traversal)."""
    if not _SAFE_NAME.match(camera_id) or not _SAFE_NAME.match(filename):
        return None
    path = evidence_dir(camera_id, root) / filename
    return path if path.is_file() else None
