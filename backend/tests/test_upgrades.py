"""
TraceNet — OCR acceleration, regional detector integration, fine-tuning kit and the automated benchmark.

    python -m pytest backend/tests/test_upgrades.py -v
"""

from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
for p in (PROJECT_ROOT, PROJECT_ROOT / "backend" / "training" / "yolo"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from backend.ai.ocr_engine import OCRResult, OCRRuntime, PaddleOCREngine  # noqa: E402
from backend.anpr.config import load_anpr_config  # noqa: E402
from backend.anpr.recognizer import read_crop  # noqa: E402

REGIONAL = PROJECT_ROOT / "backend" / "models" / "uvh26_yolo11s.pt"


# ─── OCR device plan / fallback (no model loading) ───────────────────────────

def _plan(device, use_trt, cuda):
    import backend.ai.ocr_engine as ocr

    engine = object.__new__(PaddleOCREngine)
    engine.runtime, engine.fallbacks = OCRRuntime(device=device, use_tensorrt=use_trt), []
    original = ocr.cuda_available
    ocr.cuda_available = lambda: cuda
    try:
        return engine._plan(), engine.fallbacks
    finally:
        ocr.cuda_available = original


def test_ocr_device_plan_prefers_tensorrt_then_gpu_then_cpu():
    plan, _ = _plan("auto", True, (True, "1 CUDA device(s)"))
    assert [(label, dev, trt) for label, dev, trt in plan] == [
        ("gpu:0+tensorrt-fp16", "gpu:0", True), ("gpu:0", "gpu:0", False), ("cpu", "cpu", False)]
    plan, _ = _plan("gpu:1", False, (True, "2 CUDA device(s)"))
    assert [p[0] for p in plan] == ["gpu:1", "cpu"]


def test_ocr_falls_back_to_cpu_without_cuda_and_says_why():
    plan, why = _plan("gpu", True, (False, "PaddlePaddle is the CPU build"))
    assert [p[0] for p in plan] == ["cpu"] and "CPU build" in why[0]
    plan, _ = _plan("cpu", True, (True, "1 CUDA device(s)"))
    assert [p[0] for p in plan] == ["cpu"]                       # cpu forced even with a GPU


def test_tensorrt_engine_config_has_dynamic_recognition_shapes(tmp_path):
    engine = object.__new__(PaddleOCREngine)
    engine.runtime = OCRRuntime(precision="fp16", trt_max_width=1280, trt_max_batch=8, trt_cache_dir=str(tmp_path))
    engine.fast_rec_model = "PP-OCRv6_medium_rec"
    cfg = engine._trt_rec_engine_config()["paddle_static"]
    assert cfg["run_mode"] == "trt_fp16" and cfg["trt_dynamic_shapes"]["x"][2] == [8, 3, 48, 1280]
    assert cfg["trt_shape_range_info_path"].startswith(str(tmp_path))


# ─── hybrid read policy ──────────────────────────────────────────────────────

class FakeEngine:
    """recognize_line → `quick`, recognize (det+rec) → `full`; counts calls."""

    has_fast_path = True

    def __init__(self, quick, full):
        self.quick, self.full, self.calls = quick, full, []

    def recognize_line(self, image, method=""):
        self.calls.append("rec")
        return OCRResult(text=self.quick[0], confidence=self.quick[1], engine="fake-rec")

    def recognize(self, image, method=""):
        self.calls.append("full")
        return OCRResult(text=self.full[0], confidence=self.full[1], engine="fake-full")


ONE_ROW = np.full((40, 180, 3), 200, np.uint8)       # aspect 4.5
TWO_ROW = np.full((80, 120, 3), 200, np.uint8)       # aspect 1.5


@pytest.fixture(scope="module")
def cfg():
    return replace(load_anpr_config(), ocr_fallback_threshold=0.0)   # isolate the policy from the bilateral retry


def test_confident_valid_quick_read_needs_one_call(cfg):
    e = FakeEngine(("TS09EA1234", 0.95), ("XX", 0.1))
    r = read_crop(e, ONE_ROW, cfg)
    assert e.calls == ["rec"] and r.result.text == "TS09EA1234" and r.engine_calls == 1


def test_invalid_quick_read_escalates_to_det_rec_and_keeps_the_better(cfg):
    e = FakeEngine(("TS09EA12", 0.70), ("TS09EA1234", 0.91))
    r = read_crop(e, ONE_ROW, cfg)
    assert e.calls == ["rec", "full"] and r.result.text == "TS09EA1234" and r.engine_calls == 2
    e = FakeEngine(("TS09EA1234", 0.60), ("", 0.0))                # low-confidence but valid; full finds nothing
    assert read_crop(e, ONE_ROW, cfg).result.text == "TS09EA1234"


def test_junk_quick_read_is_not_escalated(cfg):
    e = FakeEngine(("I1", 0.9), ("TS09EA1234", 0.9))
    read_crop(e, ONE_ROW, cfg)
    assert e.calls == ["rec"]
    e = FakeEngine(("TS09EA1X", 0.12), ("TS09EA1234", 0.9))        # below the escalation confidence floor
    read_crop(e, ONE_ROW, cfg)
    assert e.calls == ["rec"]


def test_two_row_plates_and_full_mode_use_det_rec(cfg):
    e = FakeEngine(("TS09EA1234", 0.95), ("TS09EA1234", 0.95))
    read_crop(e, TWO_ROW, cfg)
    assert e.calls == ["full"]
    e = FakeEngine(("TS09EA1234", 0.95), ("TS09EA1234", 0.95))
    read_crop(e, ONE_ROW, replace(cfg, ocr_mode="full"))
    assert e.calls == ["full"]


def test_rec_mode_never_escalates(cfg):
    e = FakeEngine(("TS09E", 0.5), ("TS09EA1234", 0.95))
    read_crop(e, ONE_ROW, replace(cfg, ocr_mode="rec"))
    assert e.calls == ["rec"]


# ─── detector class mapping ──────────────────────────────────────────────────

def test_coco_model_keeps_its_four_vehicle_classes(tmp_path):
    from backend.ai.vehicle_tracker import VehicleTracker

    t = VehicleTracker(model_path=str(PROJECT_ROOT / "yolo11n.pt"), output_dir=str(tmp_path), public_dir=str(tmp_path))
    assert t.class_map == {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
    assert t.iou == 0.7 and t.imgsz is None


@pytest.mark.skipif(not REGIONAL.exists(), reason="backend/models/uvh26_yolo11s.pt not downloaded")
def test_regional_model_maps_indian_classes(tmp_path):
    from backend.ai.vehicle_tracker import VehicleTracker

    t = VehicleTracker(model_path=str(REGIONAL), output_dir=str(tmp_path), public_dir=str(tmp_path), iou=0.6, imgsz=960)
    mapped = {t.fine_names[i]: t.class_map[i] for i in t.class_ids}
    assert mapped["Two-wheeler"] == "motorcycle" and mapped["Three-wheeler"] == "auto_rickshaw"
    assert mapped["Hatchback"] == mapped["SUV"] == "car" and mapped["LCV"] == "truck" and mapped["Mini-bus"] == "bus"
    assert "Bicycle" not in mapped and "Others" not in mapped                  # no plates to read
    dets = t.track_frame(np.zeros((360, 640, 3), np.uint8))
    assert dets == [] or {"class_name", "fine_class"} <= set(dets[0])


# ─── fine-tuning kit ─────────────────────────────────────────────────────────

def test_class_weighted_sampling_weights():
    from train_regional import image_weights

    labels = [{"cls": np.array([[7.0], [0.0]])}, {"cls": np.array([[0.0]])}, {"cls": np.zeros((0, 1))}, {"cls": np.array([[6.0]])}]
    w = image_weights(labels, 14, {7: 3.0, 6: 2.0})
    assert list(w) == [3.0, 1.0, 1.0, 2.0]                          # max weight in the image; background = 1
    rf = image_weights([{"cls": np.array([[0.0]])}] * 9 + [{"cls": np.array([[7.0]])}], 14, balance=True)
    assert rf[-1] > rf[0] == 1.0                                    # the rare class is repeated more


def test_nms_sweep_matching():
    from tune_nms import greedy_match, iou_matrix

    gt = np.array([[0, 0, 10, 10], [20, 20, 30, 30]], float)
    pred = np.array([[1, 1, 10, 10], [0, 0, 9, 9], [50, 50, 60, 60]], float)   # duplicate on gt[0], one FP
    assert iou_matrix(pred, gt).shape == (3, 2)
    tp, matched = greedy_match(pred, gt)
    assert tp == 1 and list(matched) == [True, False]


def test_p2_config_builds():
    from ultralytics import YOLO

    cfg = PROJECT_ROOT / "backend" / "training" / "yolo" / "yolo11n-p2.yaml"
    cfg.write_text((cfg.parent / "yolo11-p2.yaml").read_text(encoding="utf-8"), encoding="utf-8")
    try:
        model = YOLO(str(cfg))
        detect = model.model.model[-1]
        assert detect.nl == 4 and list(detect.stride.int()) == [4, 8, 16, 32]
    finally:
        cfg.unlink(missing_ok=True)


# ─── automated benchmark helpers ─────────────────────────────────────────────

def test_consensus_needs_three_consecutive_identical_reads():
    import run_automated_anpr_benchmark as bench

    assert bench.longest_identical_run([(1, "A"), (2, "A"), (3, "A")]) == (3, "A")
    assert bench.longest_identical_run([(1, "A"), (2, "A"), (4, "A")])[0] == 2        # frame 3 missing
    assert bench.longest_identical_run([(1, "A"), (2, "B"), (3, "A"), (4, "A"), (5, "A")]) == (3, "A")
    assert bench.longest_identical_run([(1, "2"), (2, "2"), (3, "2")], bench.MIN_PLATE_CHARS)[0] == 0   # noise
    assert bench.hsrp_valid("TS09EA1234") and bench.hsrp_valid("22BH1234AB") and not bench.hsrp_valid("TS0?EA1234")


def test_frame_extraction_from_a_local_video(tmp_path):
    import cv2

    import run_automated_anpr_benchmark as bench

    video = tmp_path / "clip.mp4"
    w = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"mp4v"), 30, (320, 240))
    for i in range(90):                                              # 3 s at 30 fps
        frame = np.zeros((240, 320, 3), np.uint8)
        cv2.putText(frame, str(i), (20, 120), cv2.FONT_HERSHEY_SIMPLEX, 2, (255, 255, 255), 3)
        w.write(frame)
    w.release()
    frames = bench.extract_frames(video, tmp_path / "frames", fps=15, start=1.0, duration=1.0)
    assert 14 <= len(frames) <= 16 and frames[0].name == "frame_00001.png"
    with pytest.raises(bench.AcquisitionError):
        bench.extract_frames(tmp_path / "missing.mp4", tmp_path / "f2", fps=15)
