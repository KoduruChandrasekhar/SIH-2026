"""
TraceNet Phase 2 — ANPR configuration.

Defaults live here; backend/config/anpr.json overrides any subset of them.
Unknown keys are rejected so typos in the JSON do not silently do nothing.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, fields, replace
from pathlib import Path
from typing import Any, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ANPR_CONFIG_PATH = PROJECT_ROOT / "backend" / "config" / "anpr.json"


@dataclass(frozen=True)
class ANPRConfig:
    # ── Transit / sampling ──────────────────────────────────────────────
    candidate_sample_fps: float = 10.0      # plate search rate per track (tracking still runs every frame)
    min_vehicle_width_px: int = 60          # vehicles smaller than this are not searched for plates
    min_vehicle_height_px: int = 40
    min_track_hits: int = 3                 # shorter tracks are treated as tracker noise
    track_lost_seconds: float = 1.5         # a track unseen this long ends its transit

    # ── Plate detection ─────────────────────────────────────────────────
    plate_detector: str = "auto"            # auto | yolo | geometric
    plate_model_path: Optional[str] = None  # dedicated plate YOLO weights, if any
    plate_model_confidence: float = 0.25
    lower_search_fraction: float = 0.40     # geometric: search the lower 40% of the vehicle first
    expand_to_full_vehicle: bool = True     # ...then the full vehicle crop
    aspect_ratio_min: float = 2.5
    aspect_ratio_max: float = 5.5
    class_aspect_ratio_min: dict = field(default_factory=lambda: {"motorcycle": 1.4})
    min_plate_rel_width: float = 0.08       # plate width / vehicle width
    max_plate_rel_width: float = 0.85
    min_rectangularity: float = 0.55
    max_detect_skew_deg: float = 30.0
    min_char_transitions: int = 6           # dark/light transitions across the plate's middle rows
    crop_padding: float = 0.08              # fraction of plate size added on each side

    # ── Q-score (runs BEFORE any OCR) ───────────────────────────────────
    q_weight_area: float = 0.35
    q_weight_sharpness: float = 0.45
    q_weight_exposure: float = 0.20
    q_weight_skew: float = 0.30
    q_area_ref_px: int = 6000               # crop area that counts as "full" area score
    q_sharpness_ref: float = 400.0          # Laplacian variance that counts as "full" sharpness
    min_plate_width_px: int = 40
    min_plate_height_px: int = 12
    min_sharpness: float = 25.0
    max_skew_deg: float = 20.0
    min_q_score: float = 0.20

    # ── Best-frame selection ────────────────────────────────────────────
    top_k_ocr: int = 3                      # at most this many crops per transit reach OCR
    early_ocr: bool = True                  # OCR as soon as top_k high-quality crops exist
    early_ocr_min_q: float = 0.70

    # ── OCR ─────────────────────────────────────────────────────────────
    ocr_engine: str = "paddle"              # paddle | easyocr | auto
    ocr_det_model: Optional[str] = None     # PaddleOCR text detection model (None = PaddleOCR default)
    ocr_rec_model: Optional[str] = None     # PaddleOCR text recognition model
    ocr_fallback_threshold: float = 0.85    # below this, retry with CLAHE + bilateral
    min_read_confidence: float = 0.40       # reads below this count as OCR failures
    ocr_min_height_px: int = 128            # crops are upscaled to at least this height
    ocr_border_fraction: float = 0.15       # replicated margin so text does not touch the image edge
    clahe_clip_limit: float = 2.0
    clahe_tile_grid: int = 8
    bilateral_d: int = 9
    bilateral_sigma_color: float = 75.0
    bilateral_sigma_space: float = 75.0

    # ── Consensus ───────────────────────────────────────────────────────
    consensus_similarity: float = 0.80      # 1 - normalised edit distance to count as agreeing
    resolve_confidence: float = 0.85        # early-OCR consensus at/above this closes the transit
    min_plate_confidence: float = 0.75      # valid-format consensus below this is OCR_FAILED, not DETECTED

    # ── Evidence ────────────────────────────────────────────────────────
    evidence_frame_max_width: int = 1280
    evidence_jpeg_quality: int = 90

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ANPRConfig":
        known = {f.name for f in fields(cls)}
        values = {k: v for k, v in data.items() if not k.startswith("$")}
        unknown = set(values) - known
        if unknown:
            raise ValueError(f"Unknown ANPR config keys: {sorted(unknown)}")
        return cls(**values)

    def with_overrides(self, **overrides: Any) -> "ANPRConfig":
        return replace(self, **{k: v for k, v in overrides.items() if v is not None})

    def to_dict(self) -> dict[str, Any]:
        return {f.name: getattr(self, f.name) for f in fields(self)}


def load_anpr_config(path: Optional[Path | str] = None) -> ANPRConfig:
    """Load backend/config/anpr.json (or `path`); defaults when the file is absent."""
    config_path = Path(path) if path else DEFAULT_ANPR_CONFIG_PATH
    if not config_path.exists():
        if path:
            raise FileNotFoundError(f"ANPR config not found: {config_path}")
        return ANPRConfig()
    with open(config_path, encoding="utf-8") as fh:
        return ANPRConfig.from_dict(json.load(fh))
