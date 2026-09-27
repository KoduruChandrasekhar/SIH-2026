"""
Regression tests for the fixes found by the stock-footage benchmark runs:

    1. Delhi / UT 1-digit districts, the state-code whitelist and watermark text in plate validation
    2. plate-to-vehicle bleed: a plate inside overlapping boxes belongs to the smaller vehicle, never to two tracks
    3. consensus: reads within edit distance 1 are one plate, majority (mode) wins
    4. tracker: boxes under 35 px never reach ByteTrack; lost tracks are kept 60 frames

    python -m pytest backend/tests/test_anpr_fixes.py -v
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.anpr import ANPRConfig, ANPRPipeline, build_consensus, validate_plate  # noqa: E402
from backend.anpr.consensus import Candidate, group_reads  # noqa: E402
from backend.anpr.pipeline import plate_owner  # noqa: E402
from backend.tests.test_phase2_anpr import CAR_BBOX, ScriptedOCR, det, make_frame  # noqa: E402

TRUCK_BBOX = [300.0, 100.0, 900.0, 620.0]      # fully covers the car and its plate (dense-traffic overlap)


def _validator(s):
    v = validate_plate(s)
    return v.corrected_text, v.format_valid


# ─── 1. validation ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("DL8CAK0211", "DL8CAK0211"),      # 1-digit district, 3-letter series
    ("DL7CO5900", "DL7CO5900"),
    ("DL7C05900", "DL7CO5900"),        # series expects a letter: 0→O
    ("TG09AB4521", "TG09AB4521"),      # Telangana's post-2024 code
    ("TS09AB4521", "TS09AB4521"),      # legacy code still valid
])
def test_one_and_two_digit_districts_validate(raw, expected):
    v = validate_plate(raw)
    assert v.format_valid and v.plate_format == "STANDARD" and v.corrected_text == expected


@pytest.mark.parametrize("raw", ["XA03BF1027", "XAO38F1027", "OL8CAK0211", "ZZ01AB1234"])
def test_unknown_state_codes_are_rejected(raw):
    v = validate_plate(raw)
    assert not v.format_valid and v.reject_reason == "unknown_state_code"


def test_bh_series_bypasses_the_state_check():
    v = validate_plate("22BH1234AA")
    assert v.format_valid and v.plate_format == "BH"


@pytest.mark.parametrize("raw", ["Getty", "fImages", "iStock by Getty Images", "SHUTTERSTOCK", "alamy"])
def test_watermark_text_is_rejected_before_the_format(raw):
    v = validate_plate(raw)
    assert not v.format_valid and v.reject_reason == "watermark_text"


# ─── 2. plate-to-vehicle ownership ───────────────────────────────────────────

def test_plate_owner_is_the_smallest_containing_box():
    plate = [520, 480, 680, 520]
    assert plate_owner(plate, [TRUCK_BBOX, CAR_BBOX]) == 1          # car, not the truck around it
    assert plate_owner(plate, [CAR_BBOX, TRUCK_BBOX]) == 0          # independent of detection order
    assert plate_owner(plate, [[0, 0, 100, 100]]) is None            # plate outside every box


def _run(tmp_path, detections, frames=12):
    ocr = ScriptedOCR(default=("TS09AB4521", 0.95))
    pipe = ANPRPipeline("CAM-TEST", fps=30.0, config=ANPRConfig(candidate_sample_fps=30.0, early_ocr=False),
                        ocr_engine=ocr, output_root=str(tmp_path), load_ocr=False)
    frame = make_frame()
    for i in range(frames):
        pipe.process_frame(i, frame, detections)
    return pipe.finish()


def test_overlapping_truck_does_not_take_the_cars_plate(tmp_path):
    payload = _run(tmp_path, [det(2, TRUCK_BBOX, "truck"), det(1, CAR_BBOX, "car")])
    obs = {o["track_id"]: o for o in payload["observations"]}
    assert obs[1]["plate_status"] == "DETECTED" and obs[1]["plate"] == "TS09AB4521"
    assert obs[2]["plate"] is None and obs[2]["frames_used"] == 0
    assert payload["stats"]["plate_bleed_rejected"] > 0


def test_one_plate_box_is_never_assigned_to_two_tracks(tmp_path):
    # two track ids on the same vehicle (a tracker duplicate): only one may carry the plate
    payload = _run(tmp_path, [det(1, CAR_BBOX), det(2, CAR_BBOX)])
    detected = [o for o in payload["observations"] if o["plate_status"] == "DETECTED"]
    assert len(detected) == 1


# ─── 3. consensus ────────────────────────────────────────────────────────────

def test_reads_one_edit_apart_are_one_plate_and_the_mode_wins():
    reads = [Candidate("KA40A5855", 0.95, True), Candidate("KA20A5855", 0.89, True), Candidate("KA40A5855", 0.82, True)]
    c = build_consensus(reads, 1, _validator)
    assert c.text == "KA40A5855" and c.valid and c.agreeing_count == 3 and c.consensus_count == 2


def test_majority_group_beats_a_single_more_confident_read():
    reads = [Candidate("KA03MU4358", 0.70, True), Candidate("KA03MU4368", 0.72, True),
             Candidate("KA03MU4358", 0.71, True), Candidate("TS09AB4521", 0.99, True)]
    c = build_consensus(reads, 1, _validator)
    assert c.text == "KA03MU4358" and c.agreeing_count == 3


def test_reads_two_edits_apart_stay_separate():
    groups = group_reads([Candidate("KA40A5855", 0.9, True), Candidate("KA20A5865", 0.9, True)], 1)
    assert len(groups) == 2


# ─── 4. tracker ──────────────────────────────────────────────────────────────

def test_small_boxes_never_reach_the_tracker():
    torch = pytest.importorskip("torch")
    from ultralytics.engine.results import Results

    from backend.ai.vehicle_tracker import VehicleTracker

    boxes = torch.tensor([[0, 0, 50, 50, 0.9, 0], [0, 0, 20, 60, 0.9, 0], [10, 10, 44, 80, 0.9, 0]], dtype=torch.float32)
    result = Results(orig_img=np.zeros((100, 100, 3), np.uint8), path="frame.jpg", names={0: "car"}, boxes=boxes)
    predictor = SimpleNamespace(results=[result])
    VehicleTracker._drop_small_boxes(SimpleNamespace(min_box_px=35), predictor)
    kept = predictor.results[0].boxes.xyxy.tolist()
    assert kept == [[0, 0, 50, 50]]                  # 20 px wide and 34 px wide boxes dropped


def test_tracker_keeps_lost_tracks_for_60_frames():
    from backend.ai.vehicle_tracker import TRACKER_CONFIG

    cfg = yaml.safe_load(Path(TRACKER_CONFIG).read_text(encoding="utf-8"))
    assert cfg["tracker_type"] == "bytetrack" and cfg["track_buffer"] == 60
