"""
TraceNet — License Plate OCR Engine (Phase 2)

OCR sits behind one small interface so engines are swappable:

    OCREngine.recognize(image) -> OCRResult(text, confidence, bbox, preprocessing_method, ...)

    PaddleOCREngine   primary (PaddleOCR 3.x): full detection + recognition, plus a recognition-only fast
                      path for single-line plate crops (`recognize_line`, ~6x faster - the crop is already the
                      text line, so the detector adds latency without adding information)
    EasyOCREngine     fallback when PaddleOCR is not installed

Acceleration (OCRRuntime): device "auto" tries GPU + TensorRT → GPU → CPU, warming each candidate up with a
real inference before accepting it (TensorRT builds its engine on the first run, which is where it fails when
the TensorRT libraries or GPU memory are missing). `PaddleOCREngine.backend` / `.fallbacks` say what was used.
PaddleOCR 3.x API: device="gpu:0", use_tensorrt=True, precision="fp16" (the 2.x `use_gpu` flag no longer exists).

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


@dataclass
class OCRRuntime:
    """Where / how PaddleOCR runs (backend/config/anpr.json `ocr_*` keys)."""

    device: str = "auto"                  # auto | gpu | gpu:N | cpu
    use_tensorrt: bool = True             # GPU only: Paddle Inference TensorRT subgraph engine
    precision: str = "fp16"               # TensorRT precision: fp16 | fp32
    trt_max_width: int = 1280             # recognition input: dynamic width range up to this (height is 48)
    trt_max_batch: int = 8
    trt_cache_dir: Optional[str] = None   # TensorRT shape-range cache (engine rebuild avoided on restart)
    cpu_threads: int = 8
    enable_mkldnn: bool = False           # full det+rec pipeline on CPU (oneDNN breaks PP-OCRv6 det on paddle 3.3)
    fast_rec_mkldnn: bool = False         # recognition-only model on CPU (works; big win for *_mobile_rec)


def cuda_available() -> tuple[bool, str]:
    try:
        import paddle

        if not paddle.device.is_compiled_with_cuda():
            return False, "PaddlePaddle is the CPU build (install paddlepaddle-gpu for CUDA)"
        n = paddle.device.cuda.device_count()
        return (n > 0, f"{n} CUDA device(s)" if n else "no CUDA device visible")
    except Exception as exc:
        return False, f"CUDA probe failed: {type(exc).__name__}: {exc}"


class PaddleOCREngine(OCREngine):
    """PaddleOCR 3.x. Document orientation/unwarping stages are off — inputs are plate crops."""

    name = "paddleocr"

    def __init__(self, lang: str = "en", det_model: Optional[str] = None, rec_model: Optional[str] = None,
                 fast_rec_model: Optional[str] = None, runtime: Optional[OCRRuntime] = None):
        os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
        # import paddleocr BEFORE probing paddle: on Windows, loading paddle's DLLs first breaks torch's
        # later import inside paddlex (WinError 127 on torch\lib\shm.dll)
        import paddleocr  # noqa: F401

        self.lang, self.det_model, self.rec_model = lang, det_model, rec_model
        self.fast_rec_model = fast_rec_model
        self.runtime = runtime or OCRRuntime()
        self.ocr = None
        self.rec = None                   # recognition-only model (fast path), optional
        self.backend = "none"
        self.fallbacks: list[str] = []
        last_error: Optional[Exception] = None
        for label, device, trt in self._plan():
            try:
                self.ocr, self.rec = self._build(device, trt)
                self._warm_up()
                self.backend = label
                break
            except Exception as exc:      # CUDA / TensorRT init or first-run failure → next candidate
                last_error = exc
                self.fallbacks.append(f"{label}: {type(exc).__name__}: {str(exc)[:200]}")
                log.warning("PaddleOCR on %s failed (%s) - falling back", label, type(exc).__name__)
                self.ocr = self.rec = None
        if self.ocr is None:
            raise last_error or RuntimeError("PaddleOCR could not be initialised")
        log.info("PaddleOCR backend: %s%s", self.backend, f" (fast rec: {self.fast_rec_model})" if self.rec else "")

    # ── device plan ───────────────────────────────────────────────────────
    def _plan(self) -> list[tuple[str, str, bool]]:
        rt = self.runtime
        want = (rt.device or "auto").lower()
        plan: list[tuple[str, str, bool]] = []
        if want != "cpu":
            ok, why = cuda_available()
            gpu = want if want.startswith("gpu:") else "gpu:0"
            if ok:
                if rt.use_tensorrt:
                    plan.append((f"{gpu}+tensorrt-{rt.precision}", gpu, True))
                plan.append((gpu, gpu, False))
            else:
                self.fallbacks.append(f"gpu: {why}")
                if want.startswith("gpu"):
                    log.warning("OCR device '%s' requested but %s - using CPU", want, why)
        plan.append(("cpu", "cpu", False))
        return plan

    def _common(self, device: str, trt: bool, mkldnn: bool) -> dict[str, Any]:
        rt = self.runtime
        if device == "cpu":
            return {"device": "cpu", "enable_mkldnn": mkldnn, "cpu_threads": rt.cpu_threads}
        return {"device": device, "use_tensorrt": trt, "precision": rt.precision if trt else "fp32"}

    def _build(self, device: str, trt: bool):
        from paddleocr import PaddleOCR

        kwargs: dict[str, Any] = dict(lang=self.lang, use_doc_orientation_classify=False, use_doc_unwarping=False,
                                      use_textline_orientation=False,
                                      **self._common(device, trt, self.runtime.enable_mkldnn))
        if self.det_model:
            kwargs["text_detection_model_name"] = self.det_model
        if self.rec_model:
            kwargs["text_recognition_model_name"] = self.rec_model
        ocr = PaddleOCR(**kwargs)
        rec = None
        if self.fast_rec_model:
            from paddleocr import TextRecognition

            rec_kwargs = self._common(device, trt, self.runtime.fast_rec_mkldnn)
            if trt:
                rec_kwargs["engine_config"] = self._trt_rec_engine_config()
            rec = TextRecognition(model_name=self.fast_rec_model, **rec_kwargs)
        return ocr, rec

    def _trt_rec_engine_config(self) -> dict[str, Any]:
        """TensorRT dynamic shapes for the recognition input [batch, 3, 48, width] (PaddleX engine_config)."""
        rt = self.runtime
        cfg: dict[str, Any] = {
            "run_mode": "trt_fp16" if rt.precision == "fp16" else "trt_fp32",
            "trt_use_dynamic_shapes": True,
            "trt_dynamic_shapes": {"x": [[1, 3, 48, 32], [1, 3, 48, 320], [rt.trt_max_batch, 3, 48, rt.trt_max_width]]},
            "trt_allow_rebuild_at_runtime": True,
        }
        if rt.trt_cache_dir:
            os.makedirs(rt.trt_cache_dir, exist_ok=True)
            cfg["trt_shape_range_info_path"] = os.path.join(rt.trt_cache_dir, f"{self.fast_rec_model}_shape_range.pbtxt")
        return {"paddle_static": cfg}

    def _warm_up(self) -> None:
        """One real inference per model: CUDA kernels / TensorRT engines are built here, so a broken GPU
        setup fails now (and falls back) instead of on the first plate."""
        probe = np.full((48, 200, 3), 255, np.uint8)
        probe[12:36, 20:180] = 0
        self.ocr.predict(probe)
        if self.rec is not None:
            self.rec.predict(probe)

    # ── inference ─────────────────────────────────────────────────────────
    @property
    def has_fast_path(self) -> bool:
        return self.rec is not None

    def recognize_line(self, image: np.ndarray, preprocessing_method: str = "") -> OCRResult:
        """Recognition only - for a crop that is a single text line (a one-row plate). Falls back to the full
        pipeline when no fast model is loaded or it fails."""
        if self.rec is None:
            return self.recognize(image, preprocessing_method)
        start = time.perf_counter()
        try:
            res = self.rec.predict(image)[0]
            data = res.json.get("res", res.json) if hasattr(res, "json") else res
            text = str(data.get("rec_text", "") or "").strip()
            conf = float(data.get("rec_score", 0.0) or 0.0)
            h, w = image.shape[:2]
            lines = [_line(text, conf, [0, 0, w, h])] if text else []
            return OCRResult(text=text, confidence=conf if text else 0.0, bbox=[0, 0, w, h] if text else None,
                             preprocessing_method=preprocessing_method, engine=f"{self.name}-rec", lines=lines,
                             error=None if text else "no_text", elapsed_ms=(time.perf_counter() - start) * 1000)
        except Exception as exc:
            log.warning("recognition-only OCR failed (%s) - using the full pipeline", exc)
            return self.recognize(image, preprocessing_method)

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
    `paddle_kwargs` (det_model / rec_model / fast_rec_model / runtime) only apply to PaddleOCR.
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
