"""
TraceNet Phase 2 — OCR of one selected plate crop.

    original crop → grayscale → CLAHE → OCR
                                   └─ conf < ocr_fallback_threshold → bilateral → OCR again

The fallback only runs when the CLAHE read is not confident enough.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np

from backend.ai.ocr_engine import OCREngine, OCRResult

from .config import ANPRConfig
from .models import PlateValidation
from .preprocess import FALLBACK_METHOD, PRIMARY_METHOD, add_margin, apply_bilateral, apply_clahe, to_bgr
from .validation import validate_plate


@dataclass
class CropOCR:
    result: OCRResult                 # the read that was kept
    validation: PlateValidation
    preprocessing_method: str
    initial_confidence: float
    fallback_used: bool
    fallback_confidence: Optional[float]
    engine_calls: int
    image: np.ndarray                 # preprocessed image of the kept read (evidence)


def _better(a: tuple[OCRResult, PlateValidation], b: tuple[OCRResult, PlateValidation]) -> bool:
    """Is read `b` better than `a`? Format-valid beats invalid, then confidence."""
    return (b[1].format_valid, b[0].confidence) > (a[1].format_valid, a[0].confidence)


def read_crop(engine: Optional[OCREngine], crop: np.ndarray, cfg: ANPRConfig) -> CropOCR:
    clahe = apply_clahe(crop, cfg)
    if engine is None:
        empty = OCRResult(text="", confidence=0.0, preprocessing_method=PRIMARY_METHOD,
                          engine="none", error="ocr_unavailable")
        return CropOCR(empty, validate_plate(""), PRIMARY_METHOD, 0.0, False, None, 0, clahe)

    first = engine.recognize(to_bgr(add_margin(clahe, cfg)), PRIMARY_METHOD)
    kept = (first, validate_plate(first.text))
    image, method = clahe, PRIMARY_METHOD
    fallback_conf, calls = None, 1

    if first.confidence < cfg.ocr_fallback_threshold:
        filtered = apply_bilateral(clahe, cfg)
        second = engine.recognize(to_bgr(add_margin(filtered, cfg)), FALLBACK_METHOD)
        calls += 1
        fallback_conf = second.confidence
        candidate = (second, validate_plate(second.text))
        if second.text and _better(kept, candidate):
            kept, image, method = candidate, filtered, FALLBACK_METHOD

    return CropOCR(
        result=kept[0],
        validation=kept[1],
        preprocessing_method=method,
        initial_confidence=first.confidence,
        fallback_used=fallback_conf is not None,
        fallback_confidence=fallback_conf,
        engine_calls=calls,
        image=image,
    )
