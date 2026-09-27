"""
TraceNet — synthetic multi-camera dataset + evaluation (completion plan 4C).

    python -m pytest backend/tests/test_dataset.py -v

The generation tests reuse the anonymised vehicle-crop / background caches written by the first
`python backend/scripts/generate_dataset.py` run (the OCR anonymisation check takes minutes); they are
skipped until then.
"""

from __future__ import annotations

import random
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
for p in (PROJECT_ROOT, PROJECT_ROOT / "backend" / "scripts"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

import generate_dataset as gen  # noqa: E402
import evaluate_dataset as ev  # noqa: E402

from backend.anpr.validation import validate_plate  # noqa: E402
from backend.fusion.road_network import RoadNetwork  # noqa: E402

caches_ready = (gen.SPRITE_CACHE / "sprites.json").exists() and gen.cached_backgrounds() is not None
needs_caches = pytest.mark.skipif(not caches_ready, reason="run `python backend/scripts/generate_dataset.py` once")


# ─── plates ──────────────────────────────────────────────────────────────────

def test_random_plates_are_valid_indian_registrations():
    rng = random.Random(1)
    plates = [gen.random_plate(rng) for _ in range(300)]
    assert all(validate_plate(p).format_valid and validate_plate(p).corrected_text == p for p in plates)
    assert not any(ch in "IO" for p in plates for ch in p[4:-4])
    assert gen.spaced("TS09EA1234") == "TS 09 EA 1234" and gen.spaced("KA05M0001") == "KA 05 M 0001"


def test_tampered_plates_never_validate_and_glare_hides_the_text():
    rng = random.Random(2)
    for _ in range(50):
        assert not validate_plate(gen.tamper(gen.random_plate(rng), rng)).format_valid
    clean = gen.render_plate("TS09EA1234", False, "clean", random.Random(3))
    glare = gen.render_plate("TS09EA1234", False, "glare", random.Random(3))
    assert clean.shape == glare.shape == (120, 520, 3)
    centre = (slice(30, 90), slice(120, 400))
    assert glare[centre].mean() > clean[centre].mean() + 40             # text region washed out


def test_video_time_maps_to_wall_time_through_segments():
    segs = [{"video_start": 0.0, "video_end": 6.0, "wall_start": "2026-09-25T09:00:10+05:30"},
            {"video_start": 6.0, "video_end": 13.0, "wall_start": "2026-09-25T09:07:00+05:30"}]
    assert ev.video_to_wall(segs, 2.5) == datetime.fromisoformat("2026-09-25T09:00:12.500000+05:30")
    assert ev.video_to_wall(segs, 7.0) == datetime.fromisoformat("2026-09-25T09:07:01+05:30")
    assert ev.video_to_wall(segs, 99.0) is None


# ─── generation + fusion evaluation ──────────────────────────────────────────

@pytest.fixture(scope="module")
def small_dataset(tmp_path_factory):
    out = tmp_path_factory.mktemp("dataset")
    gt = gen.generate(out, n_vehicles=8, seed=26127, write_video=False, log=lambda *a: None)
    return out, gt


@needs_caches
def test_ground_truth_is_consistent(small_dataset):
    out, gt = small_dataset
    road = RoadNetwork()
    roles = {v["vehicle_id"]: v for v in gt["vehicles"]}
    assert sorted(r["role"] for r in roles.values()).count("normal") == 2 and len(roles) == 8
    for t in gt["transits"]:
        assert (out / t["crop"]).exists()
        segs = gt["cameras"][t["camera_id"]]["segments"]
        assert ev.video_to_wall(segs, t["video_time"]) is not None
        wall = ev.video_to_wall(segs, t["video_time"])
        assert abs((wall - datetime.fromisoformat(t["timestamp"])).total_seconds()) < 0.05
    # plates: unique per vehicle except the clone pair; the clone pair is kinematically impossible
    a = next(v for v in roles.values() if v["role"] == "clone_a")
    b = next(v for v in roles.values() if v["role"] == "clone_b")
    assert a["plate"] == b["plate"] and a["sprite_id"] != b["sprite_id"]
    ta = next(t for t in gt["transits"] if t["vehicle_id"] == a["vehicle_id"] and t["camera_id"] == "CAM-410")
    tb = next(t for t in gt["transits"] if t["vehicle_id"] == b["vehicle_id"])
    dt = (datetime.fromisoformat(tb["timestamp"]) - datetime.fromisoformat(ta["timestamp"])).total_seconds()
    assert road.distance_km("CAM-410", tb["camera_id"]) / (dt / 3600) > 150
    others = [v["plate"] for v in roles.values() if v["role"] not in ("clone_a", "clone_b")]
    assert len(set(others)) == len(others) and "DL01XY0001" in others
    # scenario conditions
    ghost_rows = [t for t in gt["transits"] if roles[t["vehicle_id"]]["role"] == "ghost"]
    assert {t["plate_condition"] for t in ghost_rows} == {"clean", "glare"}
    assert all(t["expected_plate"] is None for t in gt["transits"] if t["plate_condition"] != "clean")
    assert gt["expected_alerts"]["INVALID_FORMAT"] and gt["expected_alerts"]["CLONED_PLATE"] == [a["plate"]]


@needs_caches
def test_generation_is_deterministic(small_dataset, tmp_path):
    _, gt = small_dataset
    again = gen.generate(tmp_path, n_vehicles=8, seed=26127, write_video=False, log=lambda *a: None)
    strip = lambda g: [(t["vehicle_id"], t["camera_id"], t["timestamp"], t["plate_printed"]) for t in g["transits"]]
    assert strip(again) == strip(gt)


@needs_caches
def test_fusion_scores_on_the_dataset(small_dataset):
    out, _ = small_dataset
    r = ev.evaluate_fusion(out)
    assert r["identity"]["precision"] == 1.0 and r["identity"]["recall"] >= 0.9
    assert r["alerts"]["CLONED_PLATE"]["detected"] and not r["alerts"]["CLONED_PLATE"]["false"]
    assert r["alerts"]["BLACKLIST_HIT"]["detected"] and not r["alerts"]["BLACKLIST_HIT"]["false"]
    assert r["alerts"]["INVALID_FORMAT"]["recall"] == 1.0 and r["alerts"]["INVALID_FORMAT"]["on_other_transits"] == 0
    assert r["ghost"]["plate_less_transits"] >= 1


def test_identity_metrics_count_pairs():
    fused = {s: {"gid": g} for s, g in [("a", "X"), ("b", "X"), ("c", "Y"), ("d", "Y")]}
    perfect = ev.identity_metrics({"a": "V1", "b": "V1", "c": "V2", "d": "V2"}, fused)
    assert perfect["f1"] == 1.0 and perfect["merged_ids"] == 0
    merged = ev.identity_metrics({"a": "V1", "b": "V2", "c": "V3", "d": "V3"}, fused)
    assert merged["pairs_fp"] == 1 and merged["precision"] == 0.5 and merged["merged_ids"] == 1
    split = ev.identity_metrics({"a": "V1", "b": "V1", "c": "V1", "d": "V2"}, fused)
    assert split["pairs_fn"] == 2 and split["fragmented_vehicles"] == ["V1"]


def test_sprite_anonymisation_band_is_blurred():
    img = (np.indices((200, 300)).sum(axis=0) % 2 * 255).astype(np.uint8)[..., None].repeat(3, axis=2)
    before = img[120:180, 60:240].std()
    gen._soft_blur(img, (60, 110, 240, 190))
    assert img[130:170, 80:220].std() < before * 0.2                     # checkerboard text-like detail gone
    assert img[:40, :40].std() > before * 0.9                             # outside the band untouched
