"""
TraceNet Phase 1 — camera configuration loading.

Camera metadata lives in backend/config/cameras.json (not scattered through code).
Relative source paths are resolved against the repository root, so no absolute,
machine-specific paths are baked in.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable, Optional

from .models import CameraConfig, SourceType

# backend/ingestion/config.py → repo root
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "backend" / "config" / "cameras.json"


class ConfigError(RuntimeError):
    """Raised when the camera configuration is missing or malformed."""


def resolve_source(source: str, source_type: SourceType) -> str:
    """Resolve an mp4 path relative to the repo root; leave URLs untouched."""
    if source_type is SourceType.RTSP or "://" in source:
        return source
    path = Path(source)
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return str(path)


def _camera_from_entry(entry: dict[str, Any], defaults: dict[str, Any], replay_start: str) -> CameraConfig:
    try:
        camera_id = entry["camera_id"]
        name = entry["name"]
        source_type = SourceType(str(entry.get("source_type", "mp4")).lower())
    except (KeyError, ValueError) as exc:
        raise ConfigError(f"Invalid camera entry {entry!r}: {exc}") from exc

    raw_source = entry.get("source_path") or entry.get("source_url")
    if not raw_source:
        raise ConfigError(f"Camera {camera_id} has no source_path/source_url")

    return CameraConfig(
        camera_id=camera_id,
        name=name,
        latitude=float(entry.get("latitude", 0.0)),
        longitude=float(entry.get("longitude", 0.0)),
        source_type=source_type,
        source=resolve_source(raw_source, source_type),
        road=entry.get("road"),
        sector=entry.get("sector"),
        direction=entry.get("direction"),
        aliases=tuple(entry.get("aliases", ())),
        enabled=bool(entry.get("enabled", True)),
        processing_fps=float(entry.get("processing_fps", defaults.get("processing_fps", 6.0))),
        realtime=bool(entry.get("realtime", defaults.get("realtime", True))),
        loop=bool(entry.get("loop", defaults.get("loop", False))),
        max_consecutive_read_errors=int(
            entry.get("max_consecutive_read_errors", defaults.get("max_consecutive_read_errors", 15))
        ),
        replay_start_time=entry.get("replay_start_time", replay_start),
        source_note=entry.get("source_note"),
    )


def load_cameras(
    config_path: Optional[Path | str] = None,
    only: Optional[Iterable[str]] = None,
    include_disabled: bool = False,
) -> list[CameraConfig]:
    """Load camera configuration. `only` filters by camera_id (case-insensitive)."""
    path = Path(config_path) if config_path else DEFAULT_CONFIG_PATH
    if not path.exists():
        raise ConfigError(f"Camera configuration not found: {path}")

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ConfigError(f"Camera configuration is not valid JSON ({path}): {exc}") from exc

    defaults = raw.get("defaults", {})
    replay_start = raw.get("replay_start_time", "2026-09-19T18:45:00+05:30")
    entries = raw.get("cameras", [])
    if not entries:
        raise ConfigError(f"No cameras defined in {path}")

    cameras = [_camera_from_entry(e, defaults, replay_start) for e in entries]
    if not include_disabled:
        cameras = [c for c in cameras if c.enabled]
    if only:
        wanted = {c.upper() for c in only}
        cameras = [c for c in cameras if c.camera_id.upper() in wanted]
        missing = wanted - {c.camera_id.upper() for c in cameras}
        if missing:
            raise ConfigError(f"Unknown camera id(s): {', '.join(sorted(missing))}")
    return cameras


def get_camera(camera_id: str, config_path: Optional[Path | str] = None) -> Optional[CameraConfig]:
    """Look up a single camera by id (case-insensitive), including disabled ones."""
    for cam in load_cameras(config_path, include_disabled=True):
        if cam.camera_id.upper() == camera_id.upper():
            return cam
    return None
