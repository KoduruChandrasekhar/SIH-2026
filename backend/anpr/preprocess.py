"""
TraceNet Phase 2 — plate crop preprocessing.

    primary : original crop → grayscale → (upscale) → CLAHE
    fallback: CLAHE crop → bilateral filter          (only when OCR conf < threshold)

Before OCR a replicated margin is added (`add_margin`): PaddleOCR's text
detector misses characters that touch the image border, which tight plate
crops often do.
"""

from __future__ import annotations

import cv2
import numpy as np

from .config import ANPRConfig

PRIMARY_METHOD = "CLAHE"
FALLBACK_METHOD = "CLAHE+BILATERAL"


def to_gray(crop: np.ndarray, min_height: int) -> np.ndarray:
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop.copy()
    h, w = gray.shape[:2]
    if h < min_height:
        scale = min_height / float(h)
        gray = cv2.resize(gray, (int(round(w * scale)), min_height), interpolation=cv2.INTER_CUBIC)
    return gray


def apply_clahe(crop: np.ndarray, cfg: ANPRConfig) -> np.ndarray:
    gray = to_gray(crop, cfg.ocr_min_height_px)
    clahe = cv2.createCLAHE(clipLimit=cfg.clahe_clip_limit,
                            tileGridSize=(cfg.clahe_tile_grid, cfg.clahe_tile_grid))
    return clahe.apply(gray)


def apply_bilateral(clahe_img: np.ndarray, cfg: ANPRConfig) -> np.ndarray:
    return cv2.bilateralFilter(clahe_img, cfg.bilateral_d, cfg.bilateral_sigma_color, cfg.bilateral_sigma_space)


def add_margin(img: np.ndarray, cfg: ANPRConfig) -> np.ndarray:
    pad = int(round(img.shape[0] * cfg.ocr_border_fraction))
    return cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_REPLICATE) if pad > 0 else img


def to_bgr(gray: np.ndarray) -> np.ndarray:
    """OCR engines expect 3-channel input."""
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR) if gray.ndim == 2 else gray
