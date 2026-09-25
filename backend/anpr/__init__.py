"""
TraceNet Phase 2 — High-accuracy ANPR / OCR.

Consumes YOLO11 + ByteTrack vehicle tracks and produces one structured
ANPRObservation per vehicle transit:

    track → plate candidate → Q-score → top-K crops → CLAHE → OCR
          → (bilateral fallback) → Indian format validation → consensus

Public API:

    from backend.anpr import ANPRPipeline, load_anpr_config

    pipeline = ANPRPipeline("CAM-401", fps=29.97, config=load_anpr_config())
    pipeline.process_frame(frame_index, frame, tracker_detections)
    payload = pipeline.finish()        # writes backend/output/anpr/CAM-401_anpr.json
"""

from .config import ANPRConfig, load_anpr_config
from .consensus import build_consensus
from .models import ANPRObservation, PlateRead, PlateStatus, PlateValidation, QualityScore
from .pipeline import ANPRPipeline
from .quality import measure_quality
from .validation import normalize_text, validate_plate

__all__ = [
    "ANPRConfig",
    "ANPRObservation",
    "ANPRPipeline",
    "PlateRead",
    "PlateStatus",
    "PlateValidation",
    "QualityScore",
    "build_consensus",
    "load_anpr_config",
    "measure_quality",
    "normalize_text",
    "validate_plate",
]
