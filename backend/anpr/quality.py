"""
TraceNet Phase 2 — pre-OCR frame quality gating (Q-score).

Only cheap pixel statistics are used here; OCR has NOT run yet:

    Q = w_area * Area + w_sharp * Sharpness + w_exp * Exposure - w_skew * Skew

Crops that are too small, too blurred or too skewed are rejected outright, and
only the top-K crops by Q per transit are ever sent to OCR.
"""

from __future__ import annotations

import math
from typing import Optional

import cv2
import numpy as np

from .config import ANPRConfig
from .models import QualityScore

_NORM_HEIGHT = 48   # sharpness is measured at a fixed crop height so it is scale-comparable


def estimate_skew(gray: np.ndarray) -> Optional[float]:
    """Dominant near-horizontal edge angle in degrees (None when no lines are found)."""
    edges = cv2.Canny(gray, 50, 150)
    min_len = max(10, gray.shape[1] // 3)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=max(10, min_len // 2),
                            minLineLength=min_len, maxLineGap=4)
    if lines is None:
        return None
    angles = []
    for x1, y1, x2, y2 in lines[:, 0]:
        angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
        if angle > 90:
            angle -= 180
        elif angle < -90:
            angle += 180
        if abs(angle) <= 45:
            angles.append(abs(angle))
    return float(np.median(angles)) if angles else None


def measure_quality(crop: np.ndarray, cfg: ANPRConfig, candidate_angle: float = 0.0) -> QualityScore:
    h, w = crop.shape[:2]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop

    area_norm = min(1.0, (w * h) / float(cfg.q_area_ref_px))

    scale = _NORM_HEIGHT / max(h, 1)
    norm = cv2.resize(gray, (max(1, int(round(w * scale))), _NORM_HEIGHT),
                      interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
    sharpness = float(cv2.Laplacian(norm, cv2.CV_64F).var())
    sharpness_norm = min(1.0, sharpness / cfg.q_sharpness_ref)

    hough = estimate_skew(gray)
    skew = max(abs(candidate_angle), hough) if hough is not None else abs(candidate_angle)
    skew_norm = min(1.0, skew / cfg.max_skew_deg) if cfg.max_skew_deg > 0 else 0.0

    mean, std = float(gray.mean()), float(gray.std())
    brightness = 1.0 - abs(mean - 127.5) / 127.5
    contrast = min(1.0, std / 64.0)
    exposure = 0.5 * brightness + 0.5 * contrast

    q = (cfg.q_weight_area * area_norm
         + cfg.q_weight_sharpness * sharpness_norm
         + cfg.q_weight_exposure * exposure
         - cfg.q_weight_skew * skew_norm)

    reason = None
    if w < cfg.min_plate_width_px or h < cfg.min_plate_height_px:
        reason = "too_small"
    elif sharpness < cfg.min_sharpness:
        reason = "blurred"
    elif skew > cfg.max_skew_deg:
        reason = "skewed"
    elif q < cfg.min_q_score:
        reason = "low_q"

    return QualityScore(
        width=w, height=h, area_norm=area_norm, sharpness=sharpness, sharpness_norm=sharpness_norm,
        skew_deg=skew, skew_norm=skew_norm, exposure=exposure, q=q,
        accepted=reason is None, reject_reason=reason,
    )
