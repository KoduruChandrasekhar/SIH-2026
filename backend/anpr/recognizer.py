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


def build_ocr_engine(cfg: ANPRConfig) -> OCREngine:
    """The configured OCR engine: device plan (GPU + TensorRT → GPU → CPU) and the recognition-only fast path."""
    from backend.ai.ocr_engine import OCRRuntime, create_ocr_engine

    from pathlib import Path

    cache = cfg.ocr_trt_cache_dir
    if cache and not Path(cache).is_absolute():              # relative to the repository root
        cache = str(Path(__file__).resolve().parents[2] / cache)
    runtime = OCRRuntime(device=cfg.ocr_device, use_tensorrt=cfg.ocr_use_tensorrt, precision=cfg.ocr_precision,
                         trt_max_width=cfg.ocr_trt_max_width, trt_cache_dir=cache,
                         cpu_threads=cfg.ocr_cpu_threads, enable_mkldnn=cfg.ocr_cpu_mkldnn,
                         fast_rec_mkldnn=cfg.ocr_fast_rec_mkldnn)
    fast = cfg.ocr_fast_rec_model if cfg.ocr_mode in ("hybrid", "rec") else None
    return create_ocr_engine(cfg.ocr_engine, det_model=cfg.ocr_det_model, rec_model=cfg.ocr_rec_model,
                             fast_rec_model=fast, runtime=runtime)


def _read(engine: OCREngine, image: np.ndarray, method: str, cfg: ANPRConfig, one_row: bool) -> tuple[OCRResult, int]:
    """One read under the configured policy. Returns (result, engine calls)."""
    fast = getattr(engine, "recognize_line", None) if getattr(engine, "has_fast_path", False) else None
    if fast is None or cfg.ocr_mode == "full" or not one_row:
        return engine.recognize(image, method), 1
    quick = fast(image, method)
    if cfg.ocr_mode == "rec":
        return quick, 1
    # hybrid: the full pipeline is only a second opinion for reads that are not already a confident valid plate,
    # and only when the quick read looks like text at all (junk crops are not worth a 1-3 s det+rec pass)
    if validate_plate(quick.text).format_valid and quick.confidence >= cfg.ocr_hybrid_min_conf:
        return quick, 1
    if sum(ch.isalnum() for ch in quick.text) < cfg.ocr_hybrid_min_chars or quick.confidence < cfg.ocr_hybrid_escalate_min_conf:
        return quick, 1
    full = engine.recognize(image, method)
    return (full if full.text and _better((quick, validate_plate(quick.text)), (full, validate_plate(full.text)))
            else quick), 2


def read_crop(engine: Optional[OCREngine], crop: np.ndarray, cfg: ANPRConfig) -> CropOCR:
    clahe = apply_clahe(crop, cfg)
    if engine is None:
        empty = OCRResult(text="", confidence=0.0, preprocessing_method=PRIMARY_METHOD,
                          engine="none", error="ocr_unavailable")
        return CropOCR(empty, validate_plate(""), PRIMARY_METHOD, 0.0, False, None, 0, clahe)

    h, w = crop.shape[:2]
    one_row = w / max(h, 1) >= cfg.ocr_single_line_min_aspect
    first, calls = _read(engine, to_bgr(add_margin(clahe, cfg)), PRIMARY_METHOD, cfg, one_row)
    kept = (first, validate_plate(first.text))
    image, method = clahe, PRIMARY_METHOD
    fallback_conf = None

    if first.confidence < cfg.ocr_fallback_threshold:
        filtered = apply_bilateral(clahe, cfg)
        second, n = _read(engine, to_bgr(add_margin(filtered, cfg)), FALLBACK_METHOD, cfg, one_row)
        calls += n
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
