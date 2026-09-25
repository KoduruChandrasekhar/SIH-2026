"""
TraceNet Phase 2 — ANPR data contracts.

    QualityScore    cheap pre-OCR image measurements + Q-score of one plate crop
    PlateValidation normalised / positionally-corrected OCR text + format check
    PlateRead       one OCR'd crop (a top-K frame of a transit)
    ANPRObservation one vehicle transit through one camera  →  Phase 3 input

Records are flat and JSON-safe (`to_dict()`), so they map 1:1 onto future
Postgres tables (anpr_observation, anpr_read) in Phase 4.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Optional


class PlateStatus(str, Enum):
    """Outcome of one vehicle transit. Never set optimistically."""

    DETECTED = "DETECTED"              # consensus plate passed Indian format validation
    NOT_VISIBLE = "NOT_VISIBLE"        # no usable plate region was found
    OCR_FAILED = "OCR_FAILED"          # plate crops existed but OCR produced no usable text
    INVALID_FORMAT = "INVALID_FORMAT"  # OCR produced text that is not a valid Indian plate


@dataclass
class QualityScore:
    """Pre-OCR crop quality. Computed from pixels only — never from OCR output."""

    width: int
    height: int
    area_norm: float        # 0..1, crop area vs. q_area_ref_px
    sharpness: float        # Laplacian variance at a normalised crop height
    sharpness_norm: float   # 0..1
    skew_deg: float         # absolute text-line angle
    skew_norm: float        # 0..1
    exposure: float         # 0..1, brightness/contrast quality
    q: float                # weighted score
    accepted: bool
    reject_reason: Optional[str] = None   # too_small | blurred | skewed | low_q

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        for key in ("area_norm", "sharpness", "sharpness_norm", "skew_deg", "skew_norm", "exposure", "q"):
            data[key] = round(float(data[key]), 4)
        return data


@dataclass
class PlateValidation:
    raw_text: str
    normalized_text: str               # uppercase, alphanumerics only
    corrected_text: str                # after positional disambiguation (== normalized when invalid)
    plate_format: Optional[str]        # STANDARD | BH | None
    format_valid: bool
    corrections: list[str] = field(default_factory=list)   # e.g. ["0->O@0", "B->8@9"]

    @property
    def validation(self) -> str:
        return "VALID" if self.format_valid else "INVALID_FORMAT"

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["validation"] = self.validation
        return data


@dataclass
class PlateRead:
    """One top-K plate crop after preprocessing + OCR."""

    frame_id: int
    timestamp: str
    media_offset: float
    q_score: float
    quality: QualityScore
    plate_bbox: list[int]
    vehicle_bbox: list[float]
    detector: str
    preprocessing_method: str          # CLAHE | CLAHE+BILATERAL
    initial_confidence: float          # OCR confidence on the CLAHE crop
    fallback_used: bool                # bilateral retry ran (initial < threshold)
    fallback_confidence: Optional[float]
    final_confidence: float
    ocr_engine: str
    ocr_error: Optional[str]
    validation: PlateValidation
    usable: bool                       # text present and confidence >= min_read_confidence
    crop_file: Optional[str] = None
    preprocessed_file: Optional[str] = None
    frame_file: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "frame_id": self.frame_id,
            "timestamp": self.timestamp,
            "media_offset": round(self.media_offset, 3),
            "q_score": round(self.q_score, 4),
            "quality": self.quality.to_dict(),
            "plate_bbox": self.plate_bbox,
            "vehicle_bbox": self.vehicle_bbox,
            "detector": self.detector,
            "preprocessing_method": self.preprocessing_method,
            "initial_confidence": round(self.initial_confidence, 4),
            "fallback_used": self.fallback_used,
            "fallback_confidence": None if self.fallback_confidence is None else round(self.fallback_confidence, 4),
            "final_confidence": round(self.final_confidence, 4),
            "ocr_engine": self.ocr_engine,
            "ocr_error": self.ocr_error,
            "raw_text": self.validation.raw_text,
            "normalized_text": self.validation.normalized_text,
            "corrected_text": self.validation.corrected_text,
            "plate_format": self.validation.plate_format,
            "format_valid": self.validation.format_valid,
            "validation": self.validation.validation,
            "corrections": self.validation.corrections,
            "usable": self.usable,
            "crop_file": self.crop_file,
            "preprocessed_file": self.preprocessed_file,
            "frame_file": self.frame_file,
        }


@dataclass
class ANPRObservation:
    """
    One vehicle transit through one camera.

    camera_id + track_id + timestamp are the keys Phase 3 associates on.
    `plate` is only set when plate_status == DETECTED.
    """

    observation_id: str
    camera_id: str
    track_id: int
    timestamp: str                     # camera time of the best frame (or first sighting)
    first_seen: str
    last_seen: str
    first_frame_id: int
    last_frame_id: int
    vehicle_class: str
    vehicle_bbox: list[float]          # at the best frame
    plate_status: PlateStatus
    status_reason: Optional[str]
    plate: Optional[str]
    consensus_text: Optional[str]      # multi-frame consensus string, even when not DETECTED (evidence)
    raw_ocr: Optional[str]
    ocr_confidence: Optional[float]    # final consensus confidence
    validation: Optional[str]          # VALID | INVALID_FORMAT | None (no OCR text)
    plate_format: Optional[str]
    plate_bbox: Optional[list[int]]
    best_frame: Optional[int]
    best_frame_file: Optional[str]
    best_crop_file: Optional[str]
    q_score: Optional[float]
    preprocessing_method: Optional[str]
    fallback_used: bool
    frames_used: int                   # crops sent to OCR
    consensus_count: int               # reads exactly matching the final plate
    agreeing_count: int                # reads within the consensus edit-distance tolerance
    track_hits: int                    # frames the vehicle was tracked in
    candidates_found: int              # plate candidates seen before quality gating
    candidates_accepted: int           # candidates that passed the Q-score gate
    resolved_early: bool
    camera: dict[str, Any] = field(default_factory=dict)
    reads: list[PlateRead] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "observation_id": self.observation_id,
            "camera_id": self.camera_id,
            "track_id": self.track_id,
            "timestamp": self.timestamp,
            "first_seen": self.first_seen,
            "last_seen": self.last_seen,
            "first_frame_id": self.first_frame_id,
            "last_frame_id": self.last_frame_id,
            "vehicle_class": self.vehicle_class,
            "vehicle_bbox": self.vehicle_bbox,
            "plate_status": self.plate_status.value,
            "status_reason": self.status_reason,
            "plate": self.plate,
            "consensus_text": self.consensus_text,
            "raw_ocr": self.raw_ocr,
            "ocr_confidence": None if self.ocr_confidence is None else round(self.ocr_confidence, 4),
            "validation": self.validation,
            "plate_format": self.plate_format,
            "plate_bbox": self.plate_bbox,
            "best_frame": self.best_frame,
            "best_frame_file": self.best_frame_file,
            "best_crop_file": self.best_crop_file,
            "q_score": None if self.q_score is None else round(self.q_score, 4),
            "preprocessing_method": self.preprocessing_method,
            "fallback_used": self.fallback_used,
            "frames_used": self.frames_used,
            "consensus_count": self.consensus_count,
            "agreeing_count": self.agreeing_count,
            "track_hits": self.track_hits,
            "candidates_found": self.candidates_found,
            "candidates_accepted": self.candidates_accepted,
            "resolved_early": self.resolved_early,
            "camera": self.camera,
            "reads": [r.to_dict() for r in self.reads],
        }
