"""
TraceNet Phase 2 — ANPR / OCR tests.

Run from the repository root:

    python -m pytest backend/tests/test_phase2_anpr.py -v

Pipeline-logic tests use `ScriptedOCR`, a test double that returns scripted
reads, so ordering/gating/fallback/consensus are checked deterministically.
`test_real_paddleocr_*` exercise the real PaddleOCR engine (skipped if it is
not installed). The production code has no scripted or hard-coded results.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.ai.ocr_engine import OCREngine, OCRResult  # noqa: E402
from backend.ai.plate_detector import (  # noqa: E402
    GeometricPlateDetector,
    PlateDetector,
    create_plate_detector,
)
from backend.anpr import (  # noqa: E402
    ANPRConfig,
    ANPRPipeline,
    PlateStatus,
    build_consensus,
    load_anpr_config,
    measure_quality,
    validate_plate,
)
from backend.anpr.consensus import Candidate  # noqa: E402

CAR_BBOX = [400.0, 200.0, 800.0, 560.0]
PLATE_BOX = (520, 480, 680, 520)          # 160 x 40 → aspect 4:1, inside the lower 40% of the car


# ─── helpers ────────────────────────────────────────────────────────────────

def make_frame(with_plate: bool = True, text: str = "TS09AB4521") -> np.ndarray:
    frame = np.full((720, 1280, 3), 90, np.uint8)
    x1, y1, x2, y2 = (int(v) for v in CAR_BBOX)
    cv2.rectangle(frame, (x1, y1), (x2, y2), (40, 40, 160), -1)
    if with_plate:
        px1, py1, px2, py2 = PLATE_BOX
        cv2.rectangle(frame, (px1, py1), (px2, py2), (255, 255, 255), -1)
        cv2.rectangle(frame, (px1, py1), (px2, py2), (0, 0, 0), 2)
        cv2.putText(frame, text, (px1 + 6, py2 - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (0, 0, 0), 2, cv2.LINE_AA)
    return frame


def det(track_id: int = 1, bbox=None, cls: str = "car") -> dict:
    return {"track_id": track_id, "class_name": cls, "confidence": 0.9, "bbox": list(bbox or CAR_BBOX)}


class ScriptedOCR(OCREngine):
    """Test double: returns scripted (text, confidence) per call, records every call."""

    name = "scripted"

    def __init__(self, script=None, default=("", 0.0), events=None):
        self.script = list(script or [])
        self.default = default
        self.calls: list[str] = []
        self.events = events

    def _run(self, image):  # pragma: no cover - recognize() is overridden
        return []

    def recognize(self, image, preprocessing_method=""):
        self.calls.append(preprocessing_method)
        if self.events is not None:
            self.events.append("OCR")
        text, conf = self.script.pop(0) if self.script else self.default
        return OCRResult(text=text, confidence=conf, preprocessing_method=preprocessing_method,
                         engine=self.name, error=None if text else "no_text")


def run_pipeline(tmp_path, ocr, frames=12, with_plate=True, cfg=None, detections=None, **kwargs):
    cfg = cfg or ANPRConfig(candidate_sample_fps=30.0, early_ocr=False)
    pipe = ANPRPipeline("CAM-TEST", fps=30.0, config=cfg, ocr_engine=ocr,
                        output_root=str(tmp_path), load_ocr=False, **kwargs)
    frame = make_frame(with_plate)
    for i in range(frames):
        pipe.process_frame(i, frame, detections if detections is not None else [det()])
    return pipe, pipe.finish()


# ─── 1-2. Existing tracker still works; ANPR consumes its tracks ─────────────

def test_existing_vehicle_tracker_feeds_anpr(tmp_path):
    from backend.ai.vehicle_tracker import VehicleTracker

    video = PROJECT_ROOT / "public" / "camera-feeds" / "CAM-401.mp4"
    if not video.exists():
        pytest.skip("CAM-401 video not present")
    tracker = VehicleTracker(model_path=str(PROJECT_ROOT / "yolo11n.pt"),
                             output_dir=str(tmp_path / "out"), public_dir=str(tmp_path / "pub"))
    seen = []
    summary = tracker.process_video(str(video), "CAM-401", max_frames=4, write_video=False,
                                    frame_callback=lambda i, ts, fr, d: seen.append((i, len(d), d)))
    assert summary["frames_processed"] == 4 and len(seen) == 4
    assert summary["output_video"] is None
    detections = [d for _, _, ds in seen for d in ds]
    assert detections, "YOLO found no vehicles in CAM-401"
    assert {"track_id", "class_name", "bbox", "confidence"} <= set(detections[0])
    assert any(d["track_id"] is not None for d in detections), "ByteTrack assigned no track ids"


# ─── 3-4. PlateDetector interface + geometric fallback ───────────────────────

def test_factory_uses_geometric_fallback_without_plate_model():
    detector = create_plate_detector(ANPRConfig(plate_detector="auto"))
    assert isinstance(detector, PlateDetector) and isinstance(detector, GeometricPlateDetector)
    # asking for YOLO with no weights on disk degrades to the fallback instead of crashing
    detector = create_plate_detector(ANPRConfig(plate_detector="yolo", plate_model_path="missing/plate.pt"))
    assert isinstance(detector, GeometricPlateDetector)


def test_geometric_detector_finds_a_visible_plate():
    detector = create_plate_detector(ANPRConfig())
    cands = detector.detect(make_frame(True), CAR_BBOX, "car")
    assert cands, "plate-like region not found"
    c = cands[0]
    ix1, iy1 = max(c.bbox[0], PLATE_BOX[0]), max(c.bbox[1], PLATE_BOX[1])
    ix2, iy2 = min(c.bbox[2], PLATE_BOX[2]), min(c.bbox[3], PLATE_BOX[3])
    overlap = max(0, ix2 - ix1) * max(0, iy2 - iy1) / ((PLATE_BOX[2] - PLATE_BOX[0]) * (PLATE_BOX[3] - PLATE_BOX[1]))
    assert overlap > 0.5
    assert c.region == "lower" and c.method == "geometric"


def test_geometric_detector_never_invents_a_plate():
    detector = create_plate_detector(ANPRConfig())
    assert detector.detect(make_frame(False), CAR_BBOX, "car") == []
    assert detector.detect(make_frame(True), [0, 0, 5, 5], "car") == []        # degenerate box


def test_aspect_ratio_filter_is_configurable():
    for lo, hi in ((2.5, 5.5), (6.0, 9.0)):
        cands = GeometricPlateDetector(aspect_ratio_min=lo, aspect_ratio_max=hi).detect(make_frame(True), CAR_BBOX, "car")
        assert all(lo <= c.aspect <= hi for c in cands)
    impossible = GeometricPlateDetector(aspect_ratio_min=12.0, aspect_ratio_max=20.0)
    assert impossible.detect(make_frame(True), CAR_BBOX, "car") == []


# ─── Q-score ─────────────────────────────────────────────────────────────────

def test_q_score_rejects_small_blurred_and_skewed():
    cfg = ANPRConfig()
    frame = make_frame(True)
    sharp = frame[475:525, 515:685]
    good = measure_quality(sharp, cfg)
    assert good.accepted and good.q > 0.5

    assert measure_quality(sharp[:8, :30], cfg).reject_reason == "too_small"
    blurred = cv2.GaussianBlur(sharp, (0, 0), 6)
    assert measure_quality(blurred, cfg).reject_reason == "blurred"
    assert measure_quality(sharp, cfg, candidate_angle=35).reject_reason == "skewed"
    assert measure_quality(blurred, ANPRConfig(min_sharpness=0, min_q_score=-9)).q < good.q


# ─── 5-6. Q-score before OCR; only top-K crops reach OCR ─────────────────────

def test_quality_gate_runs_before_ocr_and_only_top_k_crops_are_ocrd(tmp_path, monkeypatch):
    import backend.anpr.pipeline as pipeline_mod

    events: list[str] = []
    real = pipeline_mod.measure_quality
    monkeypatch.setattr(pipeline_mod, "measure_quality",
                        lambda *a, **k: (events.append("Q"), real(*a, **k))[1])
    ocr = ScriptedOCR(default=("TS09AB4521", 0.95), events=events)
    pipe, payload = run_pipeline(tmp_path, ocr, frames=15)

    stats = payload["stats"]
    assert stats["candidates_accepted"] >= 10          # many good crops…
    assert stats["crops_sent_to_ocr"] == 3             # …but only the top 3 reach OCR
    assert events.index("OCR") > events.index("Q")
    assert events.count("Q") >= 10 and events.count("OCR") == 3
    obs = payload["observations"][0]
    assert obs["frames_used"] == 3
    assert all(r["q_score"] is not None for r in obs["reads"])


def test_top_k_is_configurable(tmp_path):
    ocr = ScriptedOCR(default=("TS09AB4521", 0.95))
    _, payload = run_pipeline(tmp_path, ocr, cfg=ANPRConfig(candidate_sample_fps=30, early_ocr=False, top_k_ocr=2))
    assert payload["stats"]["crops_sent_to_ocr"] == 2


def test_frame_sampling_limits_plate_searches(tmp_path):
    ocr = ScriptedOCR(default=("TS09AB4521", 0.95))
    _, payload = run_pipeline(tmp_path, ocr, frames=30, cfg=ANPRConfig(candidate_sample_fps=5, early_ocr=False))
    assert payload["stats"]["plate_searches"] == 5     # 30 fps → every 6th frame


def test_early_resolution_stops_further_ocr_and_plate_search(tmp_path):
    ocr = ScriptedOCR(default=("TS09AB4521", 0.95))
    cfg = ANPRConfig(candidate_sample_fps=30, early_ocr=True, early_ocr_min_q=0.3)
    _, payload = run_pipeline(tmp_path, ocr, frames=40, cfg=cfg)
    stats = payload["stats"]
    assert stats["tracks_resolved_early"] == 1
    assert stats["plate_searches"] == 3                # closed after top-K collected
    assert stats["crops_sent_to_ocr"] == 3
    assert payload["observations"][0]["resolved_early"] is True


# ─── 7-8. CLAHE primary, bilateral fallback < 0.85 ───────────────────────────

def test_clahe_is_primary_and_no_fallback_when_confident(tmp_path):
    ocr = ScriptedOCR(default=("TS09AB4521", 0.93))
    _, payload = run_pipeline(tmp_path, ocr)
    assert set(ocr.calls) == {"CLAHE"}
    read = payload["observations"][0]["reads"][0]
    assert read["preprocessing_method"] == "CLAHE" and read["fallback_used"] is False
    assert payload["stats"]["ocr_engine_calls"] == 3


def test_bilateral_fallback_triggers_below_threshold(tmp_path):
    # each crop: CLAHE read at 0.60 (< 0.85) → bilateral retry at 0.91
    script = [("TS09AB4521", 0.60), ("TS09AB4521", 0.91)] * 3
    ocr = ScriptedOCR(script)
    _, payload = run_pipeline(tmp_path, ocr)
    assert ocr.calls == ["CLAHE", "CLAHE+BILATERAL"] * 3
    read = payload["observations"][0]["reads"][0]
    assert read["fallback_used"] is True
    assert read["initial_confidence"] == 0.6 and read["final_confidence"] == 0.91
    assert read["preprocessing_method"] == "CLAHE+BILATERAL"
    assert payload["stats"]["bilateral_fallbacks"] == 3


def test_fallback_threshold_boundary(tmp_path):
    ocr = ScriptedOCR(default=("TS09AB4521", 0.85))    # exactly at threshold: no fallback
    run_pipeline(tmp_path, ocr)
    assert "CLAHE+BILATERAL" not in ocr.calls


# ─── 9-11. Indian plate validation + positional correction ───────────────────

@pytest.mark.parametrize("raw,expected", [
    ("TS09AB4521", "TS09AB4521"),
    ("ts 09 ab-4521", "TS09AB4521"),
    ("MH12A1234", "MH12A1234"),
    ("DL01ABC1234", "DL01ABC1234"),
    ("IND TS09AB4521", "TS09AB4521"),
])
def test_standard_plates_validate(raw, expected):
    v = validate_plate(raw)
    assert v.format_valid and v.plate_format == "STANDARD" and v.corrected_text == expected


@pytest.mark.parametrize("raw,expected", [("22BH1234AA", "22BH1234AA"), ("21 BH 0001 A", "21BH0001A")])
def test_bh_series_validates(raw, expected):
    v = validate_plate(raw)
    assert v.format_valid and v.plate_format == "BH" and v.corrected_text == expected


def test_positional_correction_by_expected_character_type():
    # state: 0→O, 8→B, 1→I    district: O→0, B→8, Z→2    number: O→0, B→8
    v = validate_plate("0DOZ AB 4B2O")
    assert v.format_valid and v.corrected_text == "OD02AB4820"
    assert set(v.corrections) == {"0->O@0", "O->0@2", "Z->2@3", "B->8@7", "O->0@9"}

    v = validate_plate("8R1BAB1234")                      # state 8→B, district B→8
    assert v.corrected_text == "BR18AB1234"
    v = validate_plate("AP09A26596")                      # series expects a letter: 2→Z
    assert v.corrected_text == "AP09AZ6596"

    # letters/digits already in the right place are never substituted
    v = validate_plate("TS09AB4521")
    assert v.corrections == [] and v.corrected_text == "TS09AB4521"


def test_bh_positional_correction():
    v = validate_plate("2Z8H12O4AB")
    assert v.format_valid and v.corrected_text == "22BH1204AB"


@pytest.mark.parametrize("raw", ["", "HELLO", "12345", "TS09AB45", "TS0AB4521XYZ", "P09"])
def test_invalid_text_is_kept_not_discarded(raw):
    v = validate_plate(raw)
    assert not v.format_valid and v.validation == "INVALID_FORMAT"
    assert v.raw_text == raw and v.plate_format is None


# ─── 12. Multi-frame consensus ───────────────────────────────────────────────

def _validator(s):
    v = validate_plate(s)
    return v.corrected_text, v.format_valid


def test_consensus_example_from_spec():
    reads = [Candidate("TS09AB4521", 0.94, True), Candidate("TS09AB4521", 0.91, True),
             Candidate("TS09A84521", 0.72, False)]
    c = build_consensus(reads, 0.8, _validator)
    assert c.text == "TS09AB4521" and c.valid
    assert c.frames_used == 3 and c.consensus_count == 2 and c.agreeing_count == 3
    assert 0.8 < c.confidence <= 0.94


def test_consensus_character_vote_tolerates_one_error_per_frame():
    reads = [Candidate("TS09AB4521", 0.90, True), Candidate("TS09AB4527", 0.88, True),
             Candidate("TS08AB4521", 0.86, True)]
    c = build_consensus(reads, 0.8, _validator)
    assert c.text == "TS09AB4521"


def test_consensus_disagreement_lowers_confidence_and_empty_is_none():
    agree = build_consensus([Candidate("TS09AB4521", 0.9, True)] * 2, 0.8, _validator)
    split = build_consensus([Candidate("TS09AB4521", 0.9, True), Candidate("KA01MN0001", 0.9, True)], 0.8, _validator)
    assert split.confidence < agree.confidence
    assert build_consensus([Candidate("", 0.0, False)], 0.8, _validator) is None


def test_pipeline_consensus_and_observation_schema(tmp_path):
    script = [("TS09AB4521", 0.94), ("TS09AB4521", 0.91), ("TS09A84521", 0.72), ("TS09A84521", 0.70)]
    _, payload = run_pipeline(tmp_path, ScriptedOCR(script))
    obs = payload["observations"][0]
    assert obs["plate_status"] == "DETECTED" and obs["plate"] == "TS09AB4521"
    assert obs["validation"] == "VALID" and obs["plate_format"] == "STANDARD"
    # the 3rd read "TS09A84521" is repaired positionally (series expects a letter: 8→B),
    # so all three reads agree exactly after correction
    assert obs["frames_used"] == 3 and obs["consensus_count"] == 3
    assert "8->B@5" in obs["reads"][2]["corrections"] and obs["reads"][2]["raw_text"] == "TS09A84521"
    for key in ("camera_id", "track_id", "timestamp", "plate", "raw_ocr", "ocr_confidence", "validation",
                "plate_bbox", "vehicle_bbox", "best_frame", "frames_used", "consensus_count",
                "preprocessing_method", "q_score", "fallback_used", "vehicle_class", "first_seen", "last_seen"):
        assert key in obs
    assert obs["camera_id"] == "CAM-TEST" and obs["track_id"] == 1
    assert obs["timestamp"].startswith("2026-09-19T18:45:00")   # Phase 1 replay clock


# ─── 13-15. Failure states ───────────────────────────────────────────────────

def test_not_visible_when_no_plate(tmp_path):
    ocr = ScriptedOCR(default=("TS09AB4521", 0.99))
    _, payload = run_pipeline(tmp_path, ocr, with_plate=False)
    obs = payload["observations"][0]
    assert obs["plate_status"] == "NOT_VISIBLE" and obs["status_reason"] == "no_plate_candidate"
    assert obs["plate"] is None and obs["plate_bbox"] is None and obs["raw_ocr"] is None
    assert ocr.calls == []                              # nothing to OCR → OCR never called


def test_not_visible_when_vehicle_too_small(tmp_path):
    _, payload = run_pipeline(tmp_path, ScriptedOCR(), detections=[det(bbox=[10, 10, 40, 30])])
    assert payload["observations"][0]["status_reason"] == "vehicle_too_small_for_plate_search"


def test_ocr_failed_when_ocr_returns_nothing(tmp_path):
    _, payload = run_pipeline(tmp_path, ScriptedOCR(default=("", 0.0)))
    obs = payload["observations"][0]
    assert obs["plate_status"] == "OCR_FAILED" and obs["plate"] is None
    assert obs["frames_used"] == 3


def test_ocr_failed_when_no_engine_available(tmp_path):
    pipe, payload = run_pipeline(tmp_path, None)
    assert pipe.ocr is None
    obs = payload["observations"][0]
    assert obs["plate_status"] == "OCR_FAILED" and obs["status_reason"] == "ocr_unavailable"


def test_low_confidence_valid_text_is_not_reported_as_detected(tmp_path):
    _, payload = run_pipeline(tmp_path, ScriptedOCR(default=("TS09AB4521", 0.55)))
    obs = payload["observations"][0]
    assert obs["plate_status"] == "OCR_FAILED" and obs["status_reason"] == "low_confidence_consensus"
    assert obs["plate"] is None and obs["raw_ocr"] == "TS09AB4521"      # kept as evidence


def test_invalid_format_keeps_raw_ocr(tmp_path):
    _, payload = run_pipeline(tmp_path, ScriptedOCR(default=("HELLO WORLD", 0.95)))
    obs = payload["observations"][0]
    assert obs["plate_status"] == "INVALID_FORMAT" and obs["validation"] == "INVALID_FORMAT"
    assert obs["plate"] is None and obs["raw_ocr"] == "HELLO WORLD"


def test_garbage_and_exceptions_do_not_crash(tmp_path):
    class Exploding(ScriptedOCR):
        def _run(self, image):
            raise RuntimeError("engine crashed")

        recognize = OCREngine.recognize

    class BrokenDetector(PlateDetector):
        def detect(self, frame, vehicle_bbox, vehicle_class=None):
            raise ValueError("boom")

    _, payload = run_pipeline(tmp_path, Exploding())
    assert payload["observations"][0]["plate_status"] == "OCR_FAILED"
    assert payload["observations"][0]["reads"][0]["ocr_error"].startswith("RuntimeError")

    _, payload = run_pipeline(tmp_path, ScriptedOCR(), plate_detector=BrokenDetector())
    assert payload["observations"][0]["plate_status"] == "NOT_VISIBLE"


def test_untracked_and_short_tracks_are_handled(tmp_path):
    pipe = ANPRPipeline("CAM-TEST", 30.0, ANPRConfig(), ocr_engine=ScriptedOCR(),
                        output_root=str(tmp_path), load_ocr=False)
    frame = make_frame(True)
    pipe.process_frame(0, frame, [det(track_id=None)])
    pipe.process_frame(1, frame, [det(track_id=7)])
    payload = pipe.finish()
    assert payload["stats"]["untracked_detections"] == 1
    assert payload["stats"]["short_tracks_discarded"] == 1
    assert payload["observations"] == []


def test_multiple_tracks_and_track_expiry(tmp_path):
    ocr = ScriptedOCR(default=("TS09AB4521", 0.95))
    pipe = ANPRPipeline("CAM-TEST", 30.0, ANPRConfig(candidate_sample_fps=30, early_ocr=False, track_lost_seconds=0.1),
                        ocr_engine=ocr, output_root=str(tmp_path), load_ocr=False)
    frame = make_frame(True)
    for i in range(6):
        pipe.process_frame(i, frame, [det(track_id=1)])
    for i in range(6, 20):                               # track 1 disappears → finalised mid-run
        pipe.process_frame(i, frame, [det(track_id=2, bbox=[10, 10, 40, 30])])
    assert any(o.track_id == 1 for o in pipe.observations)
    payload = pipe.finish()
    assert {o["track_id"] for o in payload["observations"]} == {1, 2}


# ─── Evidence + API (16) ─────────────────────────────────────────────────────

def test_evidence_saved_only_for_ocrd_crops(tmp_path):
    _, payload = run_pipeline(tmp_path, ScriptedOCR(default=("TS09AB4521", 0.95)), frames=15)
    files = sorted(p.name for p in (tmp_path / "evidence" / "CAM-TEST").glob("*.jpg"))
    assert len(files) == 9                                # 3 reads × (crop, preprocessed, frame)
    obs = payload["observations"][0]
    assert obs["best_crop_file"] in files and obs["best_frame_file"] in files
    assert (tmp_path / "CAM-TEST_anpr.json").exists()


def test_api_endpoints(tmp_path, monkeypatch, officer_headers):
    from fastapi.testclient import TestClient

    import backend.anpr.store as store
    from backend.main import app

    monkeypatch.setattr(store, "ANPR_OUTPUT_DIR", tmp_path)
    run_pipeline(tmp_path, ScriptedOCR(default=("TS09AB4521", 0.95)))

    client = TestClient(app)
    for path in ("/api/health", "/api/cameras", "/api/dashboard", "/api/vehicles", "/api/traffic",
                 "/api/alerts", "/api/ingestion/cameras"):
        assert client.get(path).status_code == 200, path

    assert client.get("/api/anpr").status_code == 401            # Phase 6: plate reads need a JWT
    client.headers.update(officer_headers)
    data = client.get("/api/anpr").json()
    assert data["count"] == 1 and "CAM-TEST" in data["cameras"]
    obs = data["observations"][0]
    assert obs["plate"] == "TS09AB4521" and obs["best_crop_url"].startswith("/api/anpr/evidence/CAM-TEST/")

    assert client.get("/api/anpr?status=DETECTED").json()["count"] == 1
    assert client.get("/api/anpr?status=NOT_VISIBLE").json()["count"] == 0
    assert client.get("/api/anpr?status=bogus").status_code == 400
    assert client.get("/api/anpr/1").json()["observations"][0]["track_id"] == 1
    assert client.get("/api/anpr/999").status_code == 404
    cam = client.get("/api/cameras/CAM-TEST/anpr").json()
    assert cam["stats"]["crops_sent_to_ocr"] == 3 and len(cam["observations"]) == 1
    assert client.get("/api/cameras/CAM-NOPE/anpr").status_code == 404

    img = client.get(obs["best_crop_url"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    assert client.get("/api/anpr/evidence/CAM-TEST/..%2F..%2Fmain.py").status_code == 404


def test_repo_config_loads():
    cfg = load_anpr_config()
    assert cfg.top_k_ocr in (2, 3) and cfg.ocr_fallback_threshold == 0.85
    assert cfg.aspect_ratio_min == 2.5 and cfg.aspect_ratio_max == 5.5
    with pytest.raises(ValueError):
        ANPRConfig.from_dict({"not_a_key": 1})


# ─── Real OCR engine (19: runs locally, reads only what is in the image) ─────

@pytest.fixture(scope="module")
def paddle():
    pytest.importorskip("paddleocr")
    from backend.ai.ocr_engine import PaddleOCREngine

    return PaddleOCREngine(det_model="PP-OCRv6_medium_det", rec_model="PP-OCRv6_medium_rec")


def test_real_paddleocr_reads_a_rendered_plate(paddle):
    from backend.anpr.preprocess import add_margin, apply_clahe, to_bgr

    crop = make_frame(True, "KA01MN2345")[475:525, 515:685]
    cfg = ANPRConfig()
    result = paddle.recognize(to_bgr(add_margin(apply_clahe(crop, cfg), cfg)), "CLAHE")
    assert result.engine == "paddleocr" and result.error is None
    assert validate_plate(result.text).corrected_text == "KA01MN2345"
    assert result.confidence > 0.8


def test_real_paddleocr_returns_nothing_for_a_blank_crop(paddle):
    result = paddle.recognize(np.full((80, 240, 3), 200, np.uint8))
    assert result.text == "" and result.confidence == 0.0
