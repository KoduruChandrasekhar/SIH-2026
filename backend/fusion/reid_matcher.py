"""
TraceNet Phase 3 — visual appearance Re-ID embeddings (512-D).

    extract_embedding(vehicle_crop) -> np.ndarray(512, float32), L2-normalised

    OSNetExtractor        torchreid OSNet with vehicle Re-ID weights (e.g. VeRi-776), when
                          torchreid is installed AND a weights file is configured/found
    HandcraftedExtractor  fallback: HSV colour histogram (256) + gradient-orientation grid (256)

The fallback is fully deterministic in the input pixels (no random numbers). It is a
colour/shape descriptor, not a learned identity embedding: it separates vehicles of
different colour/shape well but cannot tell two similar white hatchbacks apart —
which is why plate-less links additionally require ghost_min_visual_similarity.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from .models import EMBEDDING_DIM

log = logging.getLogger("tracenet.reid")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
REID_WEIGHT_SEARCH = [PROJECT_ROOT / "backend" / "models", PROJECT_ROOT / "models"]
REID_WEIGHT_PATTERNS = ("*osnet*.pth", "*osnet*.pth.tar", "*veri*.pth", "*reid*.pth")


def cosine_similarity(emb_a: Optional[np.ndarray], emb_b: Optional[np.ndarray]) -> float:
    """Cosine similarity with a zero-norm guard: degenerate vectors give 0.0, never NaN."""
    if emb_a is None or emb_b is None:
        return 0.0
    a = np.asarray(emb_a, dtype=np.float64).ravel()
    b = np.asarray(emb_b, dtype=np.float64).ravel()
    if a.shape != b.shape or not (np.all(np.isfinite(a)) and np.all(np.isfinite(b))):
        return 0.0
    norm_a, norm_b = np.linalg.norm(a), np.linalg.norm(b)
    if norm_a < 1e-8 or norm_b < 1e-8:
        return 0.0
    return float(np.clip(np.dot(a, b) / (norm_a * norm_b), -1.0, 1.0))


class ReIDExtractor(ABC):
    name = "base"
    dim = EMBEDDING_DIM

    @abstractmethod
    def extract_embedding(self, vehicle_crop: np.ndarray) -> np.ndarray:
        ...


def _l2(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return (v / n).astype(np.float32) if n > 1e-8 else np.zeros_like(v, dtype=np.float32)


class HandcraftedExtractor(ReIDExtractor):
    """Colour histogram + chassis gradient descriptor → 512-D unit vector."""

    name = "handcrafted-hsv-hog"

    def extract_embedding(self, vehicle_crop: np.ndarray) -> np.ndarray:
        if vehicle_crop is None or vehicle_crop.size == 0 or min(vehicle_crop.shape[:2]) < 4:
            return np.zeros(EMBEDDING_DIM, np.float32)
        img = cv2.resize(vehicle_crop, (128, 128), interpolation=cv2.INTER_AREA)

        # 256: HSV histogram (16 hue × 4 sat × 4 val) of the central 80 % (less road/background)
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)[13:115, 13:115]
        hist = cv2.calcHist([hsv], [0, 1, 2], None, [16, 4, 4], [0, 180, 0, 256, 0, 256]).ravel()
        colour = _l2(np.sqrt(hist / max(hist.sum(), 1.0)))           # Hellinger

        # 256: gradient-orientation histograms on a 4×4 grid, 16 bins each (magnitude-weighted)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
        gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        mag, ang = cv2.cartToPolar(gx, gy, angleInDegrees=True)
        bins = np.minimum((ang % 180.0) / (180.0 / 16), 15).astype(np.int32)
        cells = []
        for gy_i in range(4):
            for gx_i in range(4):
                sl = (slice(gy_i * 32, (gy_i + 1) * 32), slice(gx_i * 32, (gx_i + 1) * 32))
                cells.append(np.bincount(bins[sl].ravel(), weights=mag[sl].ravel(), minlength=16))
        shape = _l2(np.sqrt(np.concatenate(cells)))

        return _l2(np.concatenate([colour, shape]))


class OSNetExtractor(ReIDExtractor):
    name = "osnet"

    def __init__(self, weights_path: Path, model_name: str = "osnet_x1_0"):
        from torchreid.utils import FeatureExtractor  # noqa: WPS433 (optional dependency)

        self.extractor = FeatureExtractor(model_name=model_name, model_path=str(weights_path), device="cpu")
        self.name = f"osnet:{Path(weights_path).name}"

    def extract_embedding(self, vehicle_crop: np.ndarray) -> np.ndarray:
        if vehicle_crop is None or vehicle_crop.size == 0:
            return np.zeros(EMBEDDING_DIM, np.float32)
        rgb = cv2.cvtColor(vehicle_crop, cv2.COLOR_BGR2RGB)
        feat = self.extractor([rgb]).cpu().numpy().ravel().astype(np.float32)
        return _l2(feat)


def find_reid_weights() -> Optional[Path]:
    for folder in REID_WEIGHT_SEARCH:
        if folder.is_dir():
            for pattern in REID_WEIGHT_PATTERNS:
                hits = sorted(folder.glob(pattern))
                if hits:
                    return hits[0]
    return None


def create_reid_extractor(weights_path: Optional[str] = None) -> ReIDExtractor:
    """OSNet when torchreid + weights are available, otherwise the deterministic fallback."""
    path = Path(weights_path) if weights_path else find_reid_weights()
    if path and not path.is_absolute():
        path = PROJECT_ROOT / path
    if path and path.exists():
        try:
            extractor = OSNetExtractor(path)
            log.info("Re-ID: %s", extractor.name)
            return extractor
        except Exception as exc:     # torchreid missing or incompatible weights
            log.warning("OSNet unavailable (%s) - using handcrafted Re-ID fallback", exc)
    else:
        log.info("Re-ID: no OSNet/VeRi-776 weights found - using handcrafted Re-ID fallback")
    return HandcraftedExtractor()
