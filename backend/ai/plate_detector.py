"""
TraceNet — License plate candidate detection (Phase 2).

    PlateDetector            interface: detect(frame, vehicle_bbox, vehicle_class) -> [PlateCandidate]
    YoloPlateDetector        dedicated plate YOLO weights (used when a model file exists)
    GeometricPlateDetector   no-model fallback: plate-like rectangles inside the vehicle box

The geometric fallback searches the lower 40% of the vehicle box first and
only expands to the full vehicle crop when nothing plate-like is found there.
Candidates are filtered by aspect ratio (≈2.5:1 – 5.5:1), size relative to the
vehicle, rectangularity, skew, and character-stroke transitions. It returns an
empty list when no plate-like region exists — it never invents a box.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional, Sequence

import cv2
import numpy as np

log = logging.getLogger("tracenet.plate")

PROJECT_ROOT = Path(__file__).resolve().parents[2]

# Places a dedicated plate model would be dropped; checked by create_plate_detector("auto").
PLATE_MODEL_SEARCH = [
    PROJECT_ROOT / "backend" / "models",
    PROJECT_ROOT / "models",
    PROJECT_ROOT,
]
PLATE_MODEL_PATTERNS = ("*plate*.pt", "*anpr*.pt", "*lpr*.pt")


@dataclass
class PlateCandidate:
    bbox: list[int]                 # [x1, y1, x2, y2] in full-frame pixels (unpadded)
    score: float                    # detector confidence / plate-likeness (0..1)
    method: str                     # yolo | geometric
    angle: float = 0.0              # rotation of the plate rectangle, degrees
    aspect: float = 0.0
    rectangularity: float = 0.0
    region: str = "full"            # lower | full  (geometric search region)
    extra: dict[str, Any] = field(default_factory=dict)


class PlateDetector(ABC):
    """Finds plate regions inside one tracked vehicle's box."""

    name: str = "base"

    @abstractmethod
    def detect(self, frame: np.ndarray, vehicle_bbox: Sequence[float],
               vehicle_class: Optional[str] = None) -> list[PlateCandidate]:
        ...


def _clamp_box(bbox: Sequence[float], width: int, height: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = (int(round(v)) for v in bbox)
    return max(0, x1), max(0, y1), min(width, x2), min(height, y2)


def _iou(a: Sequence[int], b: Sequence[int]) -> float:
    ix1, iy1, ix2, iy2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


# ─── Dedicated model ─────────────────────────────────────────────────────────

class YoloPlateDetector(PlateDetector):
    name = "yolo"

    def __init__(self, model_path: str | Path, confidence: float = 0.25):
        from ultralytics import YOLO

        self.model_path = str(model_path)
        self.confidence = confidence
        self.model = YOLO(self.model_path)

    def detect(self, frame, vehicle_bbox, vehicle_class=None):
        H, W = frame.shape[:2]
        x1, y1, x2, y2 = _clamp_box(vehicle_bbox, W, H)
        if x2 - x1 < 8 or y2 - y1 < 8:
            return []
        results = self.model.predict(frame[y1:y2, x1:x2], conf=self.confidence, verbose=False)
        out = []
        for r in results or []:
            if r.boxes is None:
                continue
            for box, conf in zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist()):
                bx1, by1, bx2, by2 = box
                w, h = bx2 - bx1, by2 - by1
                out.append(PlateCandidate(
                    bbox=[int(x1 + bx1), int(y1 + by1), int(x1 + bx2), int(y1 + by2)],
                    score=float(conf), method=self.name, aspect=w / h if h > 0 else 0.0,
                ))
        return sorted(out, key=lambda c: c.score, reverse=True)


# ─── Geometric fallback ──────────────────────────────────────────────────────

class GeometricPlateDetector(PlateDetector):
    """Classical CV plate localisation — a stand-in until a plate model exists."""

    name = "geometric"

    def __init__(
        self,
        lower_search_fraction: float = 0.40,
        expand_to_full_vehicle: bool = True,
        aspect_ratio_min: float = 2.5,
        aspect_ratio_max: float = 5.5,
        class_aspect_ratio_min: Optional[dict[str, float]] = None,
        min_plate_rel_width: float = 0.08,
        max_plate_rel_width: float = 0.85,
        min_plate_width_px: int = 20,
        min_rectangularity: float = 0.55,
        max_skew_deg: float = 30.0,
        min_char_transitions: int = 6,
        max_candidates: int = 1,
        work_width: int = 640,
    ):
        self.lower_search_fraction = lower_search_fraction
        self.expand_to_full_vehicle = expand_to_full_vehicle
        self.aspect_ratio_min = aspect_ratio_min
        self.aspect_ratio_max = aspect_ratio_max
        self.class_aspect_ratio_min = class_aspect_ratio_min or {}
        self.min_plate_rel_width = min_plate_rel_width
        self.max_plate_rel_width = max_plate_rel_width
        self.min_plate_width_px = min_plate_width_px
        self.min_rectangularity = min_rectangularity
        self.max_skew_deg = max_skew_deg
        self.min_char_transitions = min_char_transitions
        self.max_candidates = max_candidates
        self.work_width = work_width

    def detect(self, frame, vehicle_bbox, vehicle_class=None):
        H, W = frame.shape[:2]
        x1, y1, x2, y2 = _clamp_box(vehicle_bbox, W, H)
        vw, vh = x2 - x1, y2 - y1
        if vw < 16 or vh < 16:
            return []

        regions = [("lower", y1 + int(vh * (1.0 - self.lower_search_fraction)), y2)]
        if self.expand_to_full_vehicle:
            regions.append(("full", y1, y2))

        for region, ry1, ry2 in regions:
            if ry2 - ry1 < 8:
                continue
            found = self._search(frame, x1, ry1, x2, ry2, vw, region, vehicle_class)
            if found:
                return found[: self.max_candidates]
        return []

    # -- internals --------------------------------------------------------

    def _masks(self, gray: np.ndarray) -> list[np.ndarray]:
        """Binary masks whose blobs are plate-shaped regions."""
        h, w = gray.shape[:2]
        kw, kh = max(9, w // 30) | 1, max(3, w // 90) | 1
        rect = cv2.getStructuringElement(cv2.MORPH_RECT, (kw, kh))

        # 1) dark characters on a light plate: blackhat + horizontal gradient, closed into a band
        blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, rect)
        grad = np.absolute(cv2.Sobel(blackhat, cv2.CV_32F, 1, 0, ksize=3))
        grad = cv2.normalize(grad, None, 0, 255, cv2.NORM_MINMAX).astype("uint8")
        grad = cv2.GaussianBlur(grad, (5, 5), 0)
        grad = cv2.morphologyEx(grad, cv2.MORPH_CLOSE, rect)
        _, text_band = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        text_band = cv2.dilate(cv2.erode(text_band, None, iterations=1), None, iterations=2)

        # 2) bright plate panel (white / yellow plates)
        _, bright = cv2.threshold(cv2.GaussianBlur(gray, (5, 5), 0), 0, 255,
                                  cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        bright = cv2.morphologyEx(bright, cv2.MORPH_OPEN,
                                  cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))

        # 3) closed edges (plate border)
        edges = cv2.Canny(cv2.bilateralFilter(gray, 7, 50, 50), 60, 180)
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, rect)
        return [text_band, bright, edges]

    def _char_transitions(self, gray_plate: np.ndarray) -> int:
        """Median dark/light transitions across three middle rows (characters create many)."""
        if gray_plate.size == 0 or gray_plate.shape[0] < 4:
            return 0
        _, binary = cv2.threshold(gray_plate, 0, 1, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        h = binary.shape[0]
        counts = [int(np.count_nonzero(np.diff(binary[int(h * f)].astype(np.int8)))) for f in (0.35, 0.5, 0.65)]
        return int(np.median(counts))

    def _search(self, frame, x1, ry1, x2, ry2, vehicle_w, region, vehicle_class):
        roi = frame[ry1:ry2, x1:x2]
        gray_full = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        scale = min(1.0, self.work_width / float(roi.shape[1]))
        gray = cv2.resize(gray_full, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else gray_full

        ar_min = self.class_aspect_ratio_min.get(vehicle_class or "", self.aspect_ratio_min)
        candidates: list[PlateCandidate] = []

        for mask in self._masks(gray):
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for c in contours:
                if cv2.contourArea(c) < 30:
                    continue
                (cx, cy), (rw, rh), angle = cv2.minAreaRect(c)
                if rw < rh:
                    rw, rh = rh, rw
                    angle += 90
                angle = (angle + 90) % 180 - 90       # → [-90, 90)
                if rh <= 0 or abs(angle) > self.max_skew_deg:
                    continue
                aspect = rw / rh
                if not ar_min <= aspect <= self.aspect_ratio_max:
                    continue
                rectangularity = cv2.contourArea(c) / (rw * rh)
                if rectangularity < self.min_rectangularity:
                    continue

                bx, by, bw, bh = cv2.boundingRect(c)
                fx1, fy1 = int(bx / scale), int(by / scale)
                fx2, fy2 = int((bx + bw) / scale), int((by + bh) / scale)
                pw = fx2 - fx1
                rel_w = pw / float(vehicle_w)
                if pw < self.min_plate_width_px or not self.min_plate_rel_width <= rel_w <= self.max_plate_rel_width:
                    continue

                transitions = self._char_transitions(gray_full[fy1:fy2, fx1:fx2])
                if transitions < self.min_char_transitions:
                    continue

                # plate-likeness: shape + character evidence + position (lower is likelier)
                vertical = ((fy1 + fy2) / 2.0) / max(gray_full.shape[0], 1)
                score = (0.35 * min(rectangularity, 1.0)
                         + 0.45 * min(transitions / 16.0, 1.0)
                         + 0.20 * vertical)
                candidates.append(PlateCandidate(
                    bbox=[x1 + fx1, ry1 + fy1, x1 + fx2, ry1 + fy2],
                    score=round(float(score), 4), method=self.name, angle=float(angle),
                    aspect=float(aspect), rectangularity=float(rectangularity), region=region,
                    extra={"transitions": transitions},
                ))

        # non-maximum suppression across the three masks
        kept: list[PlateCandidate] = []
        for cand in sorted(candidates, key=lambda c: c.score, reverse=True):
            if all(_iou(cand.bbox, k.bbox) < 0.4 for k in kept):
                kept.append(cand)
        return kept


# ─── Factory ─────────────────────────────────────────────────────────────────

def find_plate_model() -> Optional[Path]:
    for folder in PLATE_MODEL_SEARCH:
        if folder.is_dir():
            for pattern in PLATE_MODEL_PATTERNS:
                hits = sorted(folder.glob(pattern))
                if hits:
                    return hits[0]
    return None


def create_plate_detector(cfg) -> PlateDetector:
    """
    `cfg` is an ANPRConfig. "auto" uses a dedicated plate YOLO model when one is
    configured or found on disk, otherwise the geometric fallback.
    """
    mode = (cfg.plate_detector or "auto").lower()
    if mode in ("auto", "yolo"):
        model = Path(cfg.plate_model_path) if cfg.plate_model_path else find_plate_model()
        if model and not model.is_absolute():
            model = PROJECT_ROOT / model
        if model and model.exists():
            log.info("plate detector: YOLO model %s", model)
            return YoloPlateDetector(model, cfg.plate_model_confidence)
        if mode == "yolo":
            log.warning("plate_detector=yolo but no plate model found — using geometric fallback")

    log.info("plate detector: geometric fallback (no dedicated plate model)")
    return GeometricPlateDetector(
        lower_search_fraction=cfg.lower_search_fraction,
        expand_to_full_vehicle=cfg.expand_to_full_vehicle,
        aspect_ratio_min=cfg.aspect_ratio_min,
        aspect_ratio_max=cfg.aspect_ratio_max,
        class_aspect_ratio_min=dict(cfg.class_aspect_ratio_min),
        min_plate_rel_width=cfg.min_plate_rel_width,
        max_plate_rel_width=cfg.max_plate_rel_width,
        min_plate_width_px=max(8, cfg.min_plate_width_px // 2),
        min_rectangularity=cfg.min_rectangularity,
        max_skew_deg=cfg.max_detect_skew_deg,
        min_char_transitions=cfg.min_char_transitions,
    )
