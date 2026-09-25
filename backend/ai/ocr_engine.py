"""
TraceNet — License Plate OCR Engine (Phase 2)

OCR sits behind one small interface so engines are swappable:

    OCREngine.recognize(image) -> OCRResult(text, confidence, bbox, preprocessing_method, ...)

    PaddleOCREngine   primary (PaddleOCR 3.x, PP-OCRv5 detection + recognition)
    EasyOCREngine     fallback when PaddleOCR is not installed

The engine only reads what is in the image. Empty or failed reads are returned
as empty text with confidence 0.0 and an `error` — never a made-up plate.

`LicensePlateOCR` / `recognize_plate` keep the original Phase 2-preparation API.
"""

from __future__ import annotations

import logging
import os
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Union

import numpy as np

log = logging.getLogger("tracenet.ocr")


class OCRUnavailable(RuntimeError):
    """No OCR engine could be initialised in this environment."""


@dataclass
class OCRResult:
    text: str                                   # raw recognised text (lines joined top→bottom)
    confidence: float                           # 0..1
    bbox: Optional[list[int]] = None            # text extent inside the OCR input image
    preprocessing_method: str = ""
    engine: str = ""
    lines: list[dict[str, Any]] = field(default_factory=list)
    error: Optional[str] = None
    elapsed_ms: float = 0.0


def _join_lines(lines: list[dict[str, Any]]) -> tuple[str, float, Optional[list[int]]]:
    """Two-row Indian plates: read rows top→bottom, left→right; confidence is length-weighted."""
    if not lines:
        return "", 0.0, None
    # A line starts a new row when its centre is below the current row by > half a line height.
    rows: list[list[dict[str, Any]]] = []
    for line in sorted(lines, key=lambda l: l["cy"]):
        if rows and line["cy"] - rows[-1][0]["cy"] <= 0.5 * min(line["h"], rows[-1][0]["h"]):
            rows[-1].append(line)
        else:
            rows.append([line])
    lines = [l for row in rows for l in sorted(row, key=lambda l: l["cx"])]
    text = "".join(l["text"] for l in lines)
    total = sum(max(len(l["text"]), 1) for l in lines)
    conf = sum(l["conf"] * max(len(l["text"]), 1) for l in lines) / total
    boxes = [l["box"] for l in lines if l.get("box")]
    bbox = None
    if boxes:
        bbox = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
    return text, float(conf), bbox


def _poly_to_box(poly) -> Optional[list[int]]:
    try:
        pts = np.asarray(poly, dtype=float).reshape(-1, 2)
        return [int(pts[:, 0].min()), int(pts[:, 1].min()), int(pts[:, 0].max()), int(pts[:, 1].max())]
    except Exception:
        return None


class OCREngine(ABC):
    name = "base"

    @abstractmethod
    def _run(self, image: np.ndarray) -> list[dict[str, Any]]:
        """Return text lines as dicts: text, conf, box, cx, cy, h."""

    def recognize(self, image: np.ndarray, preprocessing_method: str = "") -> OCRResult:
        start = time.perf_counter()
        try:
            lines = self._run(image)
            text, conf, bbox = _join_lines(lines)
            return OCRResult(text=text, confidence=conf, bbox=bbox, preprocessing_method=preprocessing_method,
                             engine=self.name, lines=lines, error=None if text else "no_text",
                             elapsed_ms=(time.perf_counter() - start) * 1000)
        except Exception as exc:          # OCR failure must never stop the pipeline
            log.warning("%s OCR failed: %s", self.name, exc)
            return OCRResult(text="", confidence=0.0, preprocessing_method=preprocessing_method,
                             engine=self.name, error=f"{type(exc).__name__}: {exc}",
                             elapsed_ms=(time.perf_counter() - start) * 1000)


def _line(text: str, conf: float, box: Optional[list[int]]) -> dict[str, Any]:
    box = box or [0, 0, 0, 0]
    return {"text": str(text), "conf": float(conf), "box": box,
            "cx": (box[0] + box[2]) / 2.0, "cy": (box[1] + box[3]) / 2.0, "h": max(1, box[3] - box[1])}


class PaddleOCREngine(OCREngine):
    """PaddleOCR 3.x (PP-OCRv5). Document orientation/unwarping stages are off — inputs are plate crops."""

    name = "paddleocr"

    def __init__(self, lang: str = "en", det_model: Optional[str] = None, rec_model: Optional[str] = None):
        os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
        from paddleocr import PaddleOCR

        kwargs: dict[str, Any] = dict(
            lang=lang,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            # PaddlePaddle 3.x CPU: the oneDNN executor raises
            # "ConvertPirAttribute2RuntimeAttribute not support" on these models.
            enable_mkldnn=False,
        )
        if det_model:
            kwargs["text_detection_model_name"] = det_model
        if rec_model:
            kwargs["text_recognition_model_name"] = rec_model
        self.ocr = PaddleOCR(**kwargs)

    def _run(self, image):
        results = self.ocr.predict(image)
        lines = []
        for res in results or []:
            data = res.json.get("res", res.json) if hasattr(res, "json") else res
            texts = data.get("rec_texts", []) or []
            scores = data.get("rec_scores", []) or []
            polys = data.get("rec_polys", data.get("dt_polys", [])) or []
            for i, text in enumerate(texts):
                if not str(text).strip():
                    continue
                box = _poly_to_box(polys[i]) if i < len(polys) else None
                lines.append(_line(text, scores[i] if i < len(scores) else 0.0, box))
        return lines


class EasyOCREngine(OCREngine):
    name = "easyocr"

    def __init__(self, lang: str = "en"):
        import easyocr

        self.reader = easyocr.Reader([lang], gpu=False, verbose=False)

    def _run(self, image):
        allow = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        return [_line(text, conf, _poly_to_box(poly))
                for poly, text, conf in self.reader.readtext(image, allowlist=allow, detail=1)]


ENGINES = {"paddle": PaddleOCREngine, "paddleocr": PaddleOCREngine, "easyocr": EasyOCREngine}


def create_ocr_engine(name: str = "paddle", **paddle_kwargs: Any) -> OCREngine:
    """
    Build an OCR engine. "paddle" is preferred; "auto" tries PaddleOCR then EasyOCR.
    A named engine that fails to load falls back to the other before giving up.
    `paddle_kwargs` (det_model / rec_model) only apply to PaddleOCR.
    """
    name = (name or "auto").lower()
    order = ["easyocr", "paddle"] if name == "easyocr" else ["paddle", "easyocr"]
    errors = []
    for i, key in enumerate(order):
        try:
            engine = ENGINES[key](**paddle_kwargs) if key == "paddle" else ENGINES[key]()
        except Exception as exc:
            errors.append(f"{key}: {type(exc).__name__}: {exc}")
            continue
        if i > 0 and name != "auto":
            log.warning("OCR engine '%s' unavailable (%s), using %s", name, errors[-1], engine.name)
        log.info("OCR engine: %s", engine.name)
        return engine
    raise OCRUnavailable("No OCR engine available — " + " | ".join(errors))


# ─── Legacy Phase 2-preparation API ──────────────────────────────────────────

class LicensePlateOCR:
    """Backwards-compatible wrapper: predict(img) -> {"text", "confidence"[, "error"]}."""

    def __init__(self, engine: str = "paddle"):
        try:
            self.engine: Optional[OCREngine] = create_ocr_engine(engine)
            self.enabled = True
        except OCRUnavailable as exc:
            log.warning("%s", exc)
            self.engine, self.enabled = None, False

    def predict(self, img_input: Union[str, np.ndarray]) -> Dict[str, Any]:
        if not self.enabled or self.engine is None:
            return {"text": "", "confidence": 0.0, "error": "No OCR engine is installed or initialized."}
        if isinstance(img_input, str):
            import cv2

            img_input = cv2.imread(img_input)
            if img_input is None:
                return {"text": "", "confidence": 0.0, "error": "Could not read image."}
        result = self.engine.recognize(img_input)
        clean = "".join(c for c in result.text if c.isalnum()).upper()
        out: Dict[str, Any] = {"text": clean, "confidence": round(result.confidence, 4)}
        if result.error:
            out["error"] = result.error
        return out


_ocr_instance: Optional[LicensePlateOCR] = None


def recognize_plate(img_input: Union[str, np.ndarray]) -> Dict[str, Any]:
    """Helper function to run OCR on an image crop or path."""
    global _ocr_instance
    if _ocr_instance is None:
        _ocr_instance = LicensePlateOCR()
    return _ocr_instance.predict(img_input)
