"""
TraceNet Phase 3 — fusion configuration (defaults here, overrides in backend/config/fusion.json).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, fields, replace
from pathlib import Path
from typing import Any, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FUSION_CONFIG_PATH = PROJECT_ROOT / "backend" / "config" / "fusion.json"
DEFAULT_ROAD_NETWORK_PATH = PROJECT_ROOT / "backend" / "config" / "road_network.json"
FUSION_OUTPUT_DIR = PROJECT_ROOT / "backend" / "output" / "fusion"


@dataclass(frozen=True)
class FusionConfig:
    # ── Composite score ─────────────────────────────────────────────────
    w_text: float = 0.35
    w_visual: float = 0.40
    w_kinematic: float = 0.25
    ghost_w_visual: float = 0.75            # text weight moved onto appearance for ghost cars
    ghost_ocr_confidence: float = 0.70      # plates below this confidence are treated as unreadable
    match_threshold: float = 0.70

    # ── Kinematics / anomalies ──────────────────────────────────────────
    speed_ok_kmh: float = 120.0             # physics_ok = 1 up to here
    speed_max_kmh: float = 150.0            # physics_ok = 0 beyond here (and clone check)
    clone_text_similarity: float = 0.90

    # ── Hard link guards (applied on top of the score) ──────────────────
    plate_link_min_text_similarity: float = 0.80   # two confident plates must agree to link
    ghost_min_visual_similarity: float = 0.90      # plate-less links need strong appearance evidence
    ghost_same_camera_max_gap_seconds: float = 15.0  # plate-less re-link at the SAME camera = tracker fragment

    # ── Active window ───────────────────────────────────────────────────
    active_window_seconds: int = 1800
    candidate_radius_km: float = 50.0

    # ── Infrastructure ──────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"
    redis_prefix: str = "tracenet"
    amqp_url: str = "amqp://guest:guest@localhost:5672/%2F"
    amqp_exchange: str = "tracenet.events"
    amqp_queue: str = "q.fusion"
    reid_weights_path: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "FusionConfig":
        known = {f.name for f in fields(cls)}
        values = {k: v for k, v in data.items() if not k.startswith("$")}
        unknown = set(values) - known
        if unknown:
            raise ValueError(f"Unknown fusion config keys: {sorted(unknown)}")
        return cls(**values)

    def with_overrides(self, **overrides: Any) -> "FusionConfig":
        return replace(self, **{k: v for k, v in overrides.items() if v is not None})

    def to_dict(self) -> dict[str, Any]:
        return {f.name: getattr(self, f.name) for f in fields(self)}


def load_fusion_config(path: Optional[Path | str] = None) -> FusionConfig:
    config_path = Path(path) if path else DEFAULT_FUSION_CONFIG_PATH
    if not config_path.exists():
        if path:
            raise FileNotFoundError(f"Fusion config not found: {config_path}")
        return FusionConfig()
    with open(config_path, encoding="utf-8") as fh:
        return FusionConfig.from_dict(json.load(fh))
