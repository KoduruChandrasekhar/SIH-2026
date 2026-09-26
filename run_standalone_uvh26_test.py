#!/usr/bin/env python3
"""
Standalone, disposable ANPR + tracking benchmark on IISc UVH-26 (Bengaluru Safe-City pole cameras).

    python run_standalone_uvh26_test.py                                  # 2 val folders x 30 frames
    python run_standalone_uvh26_test.py --sequences 000 --frames-per-seq 100
    python run_standalone_uvh26_test.py --local-frames D:/cctv/seq01     # any folder of sequential frames
    python run_standalone_uvh26_test.py --cleanup                        # delete downloads afterwards

Isolation
    * Nothing in the repository is created or modified. TraceNet modules are imported read-only (backend.ai,
      backend.anpr); bytecode writing is disabled. Everything this script writes goes to ./test_eval_tmp/
      (which gets its own `.gitignore: *` so git never sees it). --cleanup removes the downloaded frames,
      annotations and scratch output and keeps only the summary JSON.
    * To benchmark another pipeline, replace the bodies of the functions in the HOOKS section.

What UVH-26 can and cannot measure (verified against the dataset before writing this script)
    * Validation frames live under UVH-26-Val/data/000 and /001 (5 000 PNGs each, ~3 MB per 1080p frame),
      not UVH-26-Val/images/. Only a configurable number of frames per folder is downloaded.
    * The frames are independent snapshots sampled from ~2 800 cameras over 4 weeks - NOT video sequences;
      neighbouring files come from different cameras. The script measures scene continuity between
      consecutive frames and resets the tracker at every cut, so tracking KPIs are computed only over
      genuinely continuous runs and are reported as not applicable when there are none.
    * The images are anonymised (the annotation file says so): number plates are blurred. Plate-reading
      KPIs therefore mostly measure the anonymisation, not the OCR. Use --local-frames with real footage
      for meaningful ANPR numbers.
    * UVH-26 ships COCO vehicle boxes, so vehicle detection IS scored against ground truth (IoU >= 0.5).
    Dataset: https://huggingface.co/datasets/iisc-aim/UVH-26 (CC-BY-4.0; cite arXiv:2511.02563).
"""

from __future__ import annotations

import sys

sys.dont_write_bytecode = True               # read-only: no __pycache__ written into the repo's packages

import argparse
import json
import os
import re
import shutil
import statistics
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

TMP = Path("./test_eval_tmp").resolve()
DATA_DIR = TMP / "UVH-26"
SCRATCH = TMP / "_pipeline_scratch"
SUMMARY = TMP / "uvh26_accuracy_summary.json"
REPO_ID = "iisc-aim/UVH-26"
STREAM_FPS = 15.0

HSRP_STANDARD = re.compile(r"^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$")
HSRP_BH = re.compile(r"^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$")


# ════════════════════════════════════════════════════════════════════════════
# HOOKS — the only place that touches the pipeline (read-only). Replace the bodies to test another stack.
# ════════════════════════════════════════════════════════════════════════════

class PipelineHooks:
    def __init__(self, model: str, max_ocr_per_frame: int, with_ocr: bool = True):
        from backend.ai.ocr_engine import OCRUnavailable, create_ocr_engine
        from backend.ai.plate_detector import create_plate_detector
        from backend.ai.vehicle_tracker import VehicleTracker
        from backend.anpr.config import load_anpr_config

        SCRATCH.mkdir(parents=True, exist_ok=True)
        # VehicleTracker only creates its output folders - point them into the scratch area
        self.tracker = VehicleTracker(model_path=model, output_dir=str(SCRATCH), public_dir=str(SCRATCH))
        self.cfg = load_anpr_config()
        self.plate_detector = create_plate_detector(self.cfg)
        self.max_ocr_per_frame = max_ocr_per_frame
        self.ocr = None
        self.ocr_error = None
        if with_ocr:
            try:
                self.ocr = create_ocr_engine(self.cfg.ocr_engine, det_model=self.cfg.ocr_det_model,
                                             rec_model=self.cfg.ocr_rec_model)
            except OCRUnavailable as exc:
                self.ocr_error = str(exc)

    # tracks = my_tracker.update(my_vehicle_detector(frame))
    def my_vehicle_detector(self, frame: np.ndarray) -> list[dict]:
        """YOLO11 vehicle detection. Ultralytics runs ByteTrack inside the same call (`model.track`), so the
        detections already carry track ids; association costs well under 1 ms of the measured time."""
        return self.tracker.track_frame(frame)

    def my_tracker_update(self, detections: list[dict]) -> list[dict]:
        return [d for d in detections if d.get("track_id") is not None]

    def reset_tracker(self) -> None:
        """Scene cut: forget all tracks (ByteTrack state lives on the ultralytics predictor)."""
        predictor = getattr(self.tracker.model, "predictor", None)
        for t in getattr(predictor, "trackers", None) or []:
            try:
                t.reset()
            except Exception:
                pass

    def locate_plates(self, frame: np.ndarray, det: dict) -> list:
        return self.plate_detector.detect(frame, det["bbox"], det.get("class_name"))

    def plate_quality(self, crop: np.ndarray, angle: float):
        from backend.anpr.quality import measure_quality

        return measure_quality(crop, self.cfg, angle)

    # plate_text, ocr_conf = my_paddle_ocr(flat_plate)
    def my_paddle_ocr(self, flat_plate: np.ndarray) -> tuple[str, float, list[float]]:
        """TraceNet's read path: CLAHE → PaddleOCR (bilateral fallback below the confidence threshold).
        Returns (text, line-weighted confidence, per-line confidences)."""
        from backend.anpr.recognizer import read_crop

        if self.ocr is None:
            return "", 0.0, []
        read = read_crop(self.ocr, flat_plate, self.cfg)
        return read.result.text or "", float(read.result.confidence or 0.0), [float(l["conf"]) for l in read.result.lines]

    @staticmethod
    def pipeline_corrected(text: str) -> tuple[str, bool]:
        """TraceNet's positional correction + format validation (for the 'after correction' HSRP rate)."""
        from backend.anpr.validation import validate_plate

        v = validate_plate(text)
        return v.corrected_text or "", bool(v.format_valid)


# ─── plate geometry (benchmark-local; the pipeline itself has no perspective rectification) ──────────

def estimate_plate_corners(frame: np.ndarray, bbox) -> tuple[Optional[np.ndarray], str]:
    """Four plate corners in frame pixels: a 4-point contour (trapezoid) when the plate outline is
    visible, else the minimum-area rotated rectangle, else the detector's axis-aligned box."""
    H, W = frame.shape[:2]
    x1, y1, x2, y2 = (int(v) for v in bbox)
    pw, ph = x2 - x1, y2 - y1
    if pw < 8 or ph < 4:
        return None, "none"
    px, py = int(pw * 0.15), int(ph * 0.35)
    rx1, ry1, rx2, ry2 = max(0, x1 - px), max(0, y1 - py), min(W, x2 + px), min(H, y2 + py)
    gray = cv2.cvtColor(frame[ry1:ry2, rx1:rx2], cv2.COLOR_BGR2GRAY)
    best = None
    for inv in (False, True):
        _, th = cv2.threshold(gray, 0, 255, (cv2.THRESH_BINARY_INV if inv else cv2.THRESH_BINARY) + cv2.THRESH_OTSU)
        contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            area = cv2.contourArea(c)
            if area >= 0.4 * pw * ph and area <= 3.0 * pw * ph and (best is None or area > cv2.contourArea(best)):
                best = c
    offset = np.array([rx1, ry1], np.float32)
    if best is not None:
        approx = cv2.approxPolyDP(best, 0.04 * cv2.arcLength(best, True), True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            return approx.reshape(4, 2).astype(np.float32) + offset, "quad"
        return cv2.boxPoints(cv2.minAreaRect(best)).astype(np.float32) + offset, "min_area_rect"
    return np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], np.float32), "bbox"


def _order(pts: np.ndarray) -> np.ndarray:
    s, d = pts.sum(axis=1), np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], np.float32)


def is_angled(corners: np.ndarray) -> bool:
    """Rotated (> 3°) or trapezoidal (opposite sides differ > 8 %) - i.e. needs rectification."""
    tl, tr, br, bl = _order(corners)
    angle = abs(np.degrees(np.arctan2(tr[1] - tl[1], tr[0] - tl[0])))
    top, bottom = np.linalg.norm(tr - tl), np.linalg.norm(br - bl)
    left, right = np.linalg.norm(bl - tl), np.linalg.norm(br - tr)
    return bool(angle > 3.0 or abs(top - bottom) / max(top, bottom, 1e-6) > 0.08
                or abs(left - right) / max(left, right, 1e-6) > 0.08)


# flat_plate = rectify_angled_plate(frame, plate_corners)
def rectify_angled_plate(frame: np.ndarray, plate_corners: np.ndarray) -> Optional[np.ndarray]:
    """Perspective-warp the plate quadrilateral to a fronto-parallel crop (height 64 px). None if degenerate."""
    tl, tr, br, bl = _order(plate_corners)
    width = max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))
    height = max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))
    if width < 20 or height < 6:
        return None
    aspect = float(np.clip(width / height, 1.5, 6.5))
    out_h = 64
    out_w = int(round(out_h * aspect))
    M = cv2.getPerspectiveTransform(np.array([tl, tr, br, bl], np.float32),
                                    np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], np.float32))
    flat = cv2.warpPerspective(frame, M, (out_w, out_h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    if float(cv2.cvtColor(flat, cv2.COLOR_BGR2GRAY).std()) < 12.0:        # blank / fully smeared warp
        return None
    return flat


# ════════════════════════════════════════════════════════════════════════════
# Data: UVH-26 from the Hugging Face Hub (or a local folder of frames)
# ════════════════════════════════════════════════════════════════════════════

def _retry(fn, *args, attempts: int = 6, **kwargs):
    """Hub calls occasionally fail on some networks (TLS interception / resets): retry with backoff. After such
    an error huggingface_hub closes its shared HTTP client, so the session is reset before each retry."""
    from huggingface_hub.utils import close_session

    for i in range(attempts):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            if i == attempts - 1:
                raise
            wait = 2 ** i
            print(f"      hub request failed ({type(exc).__name__}: {str(exc)[:80]}) - retrying in {wait} s")
            close_session()
            time.sleep(wait)


def _numeric(name: str):
    stem = Path(name).stem
    return (0, int(stem)) if stem.isdigit() else (1, stem)


def plan_download(split: str, sequences: Optional[list[str]], max_sequences: int, frames_per_seq: int,
                  start_index: int) -> dict[str, list[str]]:
    from huggingface_hub import HfApi

    api = HfApi()
    root = f"UVH-26-{split.capitalize()}/data"
    available = sorted(p.path.split("/")[-1] for p in _retry(lambda: list(api.list_repo_tree(REPO_ID, path_in_repo=root, repo_type="dataset"))))
    chosen = [s for s in (sequences or available) if s in available][:max_sequences]
    missing = sorted(set(sequences or []) - set(available))
    if missing:
        print(f"  note: {root} has folders {available}; not found: {missing}")
    plan = {}
    for seq in chosen:
        listing = _retry(lambda: list(api.list_repo_tree(REPO_ID, path_in_repo=f"{root}/{seq}", repo_type="dataset")))
        files = sorted((p.path for p in listing if p.path.lower().endswith((".png", ".jpg", ".jpeg"))),
                       key=lambda p: _numeric(p.split("/")[-1]))
        plan[seq] = files[start_index:start_index + frames_per_seq]
    return plan


def download(paths: list[str], workers: int = 8) -> list[Path]:
    """Only the listed files (snapshot_download with an explicit allow-list; it parallelises internally and
    skips files already present in ./test_eval_tmp/UVH-26 from an earlier run)."""
    from huggingface_hub import snapshot_download

    from huggingface_hub import hf_hub_download
    from huggingface_hub.utils import close_session

    missing = [p for p in paths if not (DATA_DIR / p).exists()]
    if missing:
        try:                                            # fast path: parallel
            snapshot_download(REPO_ID, repo_type="dataset", allow_patterns=missing, local_dir=str(DATA_DIR),
                              max_workers=workers)
        except Exception as exc:
            print(f"      parallel download interrupted ({type(exc).__name__}) - continuing file by file")
            close_session()
    # snapshot_download can return silently without the files when the Hub is unreachable, and a TLS error
    # resets huggingface_hub's shared client under the other threads → fetch what is missing one by one
    for p in [p for p in paths if not (DATA_DIR / p).exists()]:
        _retry(hf_hub_download, REPO_ID, p, repo_type="dataset", local_dir=str(DATA_DIR))
    lost = [p for p in paths if not (DATA_DIR / p).exists()]
    if lost:
        raise RuntimeError(f"{len(lost)} of {len(paths)} frames could not be downloaded (first: {lost[0]})")
    return [DATA_DIR / p for p in paths]


def load_ground_truth(split: str, variant: str) -> dict[str, list[dict]]:
    from huggingface_hub import hf_hub_download

    name = f"UVH-26-{split.capitalize()}/UVH-26-{variant.upper()}-{split.capitalize()}.json"
    coco = json.loads(Path(_retry(hf_hub_download, REPO_ID, name, repo_type="dataset", local_dir=str(DATA_DIR))).read_text(encoding="utf-8"))
    cats = {c["id"]: c["name"] for c in coco["categories"]}
    files = {im["id"]: im["file_name"] for im in coco["images"]}
    gt: dict[str, list[dict]] = defaultdict(list)
    for a in coco["annotations"]:
        x, y, w, h = a["bbox"]
        gt[files[a["image_id"]]].append({"bbox": [x, y, x + w, y + h], "class": cats.get(a["category_id"], "?")})
    return gt


# ════════════════════════════════════════════════════════════════════════════
# Metrics helpers
# ════════════════════════════════════════════════════════════════════════════

def iou(a, b) -> float:
    ix1, iy1, ix2, iy2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def match_boxes(pred: list[list[float]], gt: list[list[float]], thr: float = 0.5) -> tuple[int, list[bool]]:
    """Greedy one-to-one matching by IoU. Returns (true positives, per-GT matched flags)."""
    pairs = sorted(((iou(p, g), i, j) for i, p in enumerate(pred) for j, g in enumerate(gt)), reverse=True)
    used_p, used_g = set(), set()
    for v, i, j in pairs:
        if v < thr:
            break
        if i not in used_p and j not in used_g:
            used_p.add(i)
            used_g.add(j)
    return len(used_p), [j in used_g for j in range(len(gt))]


def frame_signature(frame: np.ndarray) -> np.ndarray:
    small = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (96, 54), interpolation=cv2.INTER_AREA).astype(np.float32)
    return (small - small.mean()) / (small.std() + 1e-6)


def continuous(sig_a: Optional[np.ndarray], sig_b: np.ndarray, thr: float) -> bool:
    """Same camera, same scene? (normalised cross-correlation of 96x54 thumbnails)."""
    return sig_a is not None and float((sig_a * sig_b).mean()) >= thr


def normalize(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


def hsrp_valid(text: str) -> bool:
    return bool(HSRP_STANDARD.match(text) or HSRP_BH.match(text))


def pct(n: float, d: float) -> Optional[float]:
    return round(100.0 * n / d, 2) if d else None


def dist(values: list[float]) -> dict[str, Optional[float]]:
    if not values:
        return {"mean": None, "p50": None, "p95": None}
    v = sorted(values)
    return {"mean": round(statistics.fmean(v), 2), "p50": round(v[len(v) // 2], 2),
            "p95": round(v[min(len(v) - 1, int(0.95 * len(v)))], 2)}


# ════════════════════════════════════════════════════════════════════════════
# Benchmark
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class TrackLog:
    first: int
    last: int
    frames: int = 0
    reads: list[str] = field(default_factory=list)
    last_bbox: Optional[list[float]] = None


def run(args) -> dict[str, Any]:
    from tqdm import tqdm

    TMP.mkdir(parents=True, exist_ok=True)
    (TMP / ".gitignore").write_text("*\n", encoding="utf-8")      # keep the whole folder out of git

    # ── frames ──
    gt: dict[str, list[dict]] = {}
    if args.local_frames:
        folder = Path(args.local_frames)
        seqs = {folder.name: sorted((p for p in folder.iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg")),
                                    key=lambda p: _numeric(p.name))[args.start_index:args.start_index + args.frames_per_seq]}
        source = {"type": "local", "path": str(folder)}
    else:
        print(f"[1/3] Planning download from {REPO_ID} ({args.split}) ...")
        plan = plan_download(args.split, args.sequences, args.max_sequences, args.frames_per_seq, args.start_index)
        n = sum(len(v) for v in plan.values())
        print(f"      {len(plan)} folder(s) x up to {args.frames_per_seq} frames = {n} frames "
              f"(~{n * 3.2:.0f} MB, 1080p PNG) → {DATA_DIR}")
        seqs = {seq: download(paths, args.workers) for seq, paths in plan.items()}
        if args.annotations != "none":
            print(f"      ground truth: UVH-26-{args.annotations.upper()} COCO boxes")
            gt = load_ground_truth(args.split, args.annotations)
        source = {"type": "huggingface", "repo": REPO_ID, "split": args.split, "sequences": list(plan),
                  "note": "UVH-26 frames are independent anonymised snapshots from ~2 800 cameras (not video)"}

    total_frames = sum(len(v) for v in seqs.values())
    if not total_frames:
        raise SystemExit("[ERROR] no frames to evaluate")

    # ── pipeline ──
    print(f"[2/3] Loading the pipeline (read-only hooks) ...")
    hooks = PipelineHooks(args.model, args.max_ocr_per_frame, with_ocr=not args.no_ocr)
    if hooks.ocr_error:
        print(f"      OCR unavailable: {hooks.ocr_error}")

    # ── accumulators ──
    lat = defaultdict(list)                       # yolo / plates / warp / ocr / total ms per frame
    k = Counter()
    frame_sharpness: list[float] = []
    ocr_line_conf: list[float] = []
    ocr_word_conf: list[float] = []
    gt_tp = gt_pred = gt_total = 0
    gt_class_hits: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    per_seq: dict[str, dict[str, Any]] = {}
    tracks: dict[tuple[str, int, int], TrackLog] = {}
    id_switches = 0
    segment_lengths: list[int] = []

    print(f"[3/3] Streaming {total_frames} frames at a simulated {STREAM_FPS:g} FPS ...")
    t_start = time.perf_counter()
    bar = tqdm(total=total_frames, unit="frame", dynamic_ncols=True)
    for seq_i, (seq, frames) in enumerate(seqs.items(), start=1):
        s = Counter()
        prev_sig, segment, seg_len = None, 0, 0
        prev_tracks: dict[int, list[float]] = {}
        hooks.reset_tracker()
        for fi, path in enumerate(frames):
            t_frame = time.perf_counter()
            frame = cv2.imread(str(path))
            if frame is None:
                k["unreadable_frames"] += 1
                bar.update(1)
                continue
            k["frames"] += 1
            s["frames"] += 1

            # scene continuity → tracker reset at every cut (UVH-26: every frame)
            sig = frame_signature(frame)
            is_cont = args.tracking_mode == "continuous" or (args.tracking_mode == "auto" and continuous(prev_sig, sig, args.continuity))
            if fi > 0:
                k["frame_pairs"] += 1
                k["continuous_pairs"] += is_cont
            if fi > 0 and not is_cont:
                hooks.reset_tracker()
                segment_lengths.append(seg_len)
                segment, seg_len, prev_tracks = segment + 1, 0, {}
            seg_len += 1
            prev_sig = sig

            # quality gate (frame level): Laplacian variance at 960 px width
            g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            g = cv2.resize(g, (960, int(960 * g.shape[0] / g.shape[1])), interpolation=cv2.INTER_AREA)
            sharp = float(cv2.Laplacian(g, cv2.CV_64F).var())
            frame_sharpness.append(sharp)
            k["frames_sharp"] += sharp >= args.frame_sharpness

            # detection + tracking
            t0 = time.perf_counter()
            try:
                detections = hooks.my_vehicle_detector(frame)
                active = hooks.my_tracker_update(detections)
            except Exception as exc:                          # never break the run on one bad frame
                k["detector_errors"] += 1
                detections, active = [], []
                if k["detector_errors"] == 1:
                    print(f"\n      detector error (continuing): {type(exc).__name__}: {exc}")
            lat["yolo_ms"].append((time.perf_counter() - t0) * 1000)
            k["vehicles_detected"] += len(detections)
            s["vehicles_detected"] += len(detections)
            k["frames_without_vehicles"] += not detections

            # ground truth (UVH-26 COCO boxes, class-agnostic, IoU >= 0.5)
            name = Path(path).name
            if name in gt:
                gboxes = [a["bbox"] for a in gt[name]]
                tp, flags = match_boxes([d["bbox"] for d in detections], gboxes, 0.5)
                gt_tp += tp
                gt_pred += len(detections)
                gt_total += len(gboxes)
                for a, hit in zip(gt[name], flags):
                    gt_class_hits[a["class"]][0] += hit
                    gt_class_hits[a["class"]][1] += 1

            # tracks: lifespan, ID-switch proxy (new id born on the box of an id that just vanished)
            cur = {}
            for d in active:
                key = (seq, segment, d["track_id"])
                tl = tracks.get(key)
                if tl is None:
                    tl = tracks[key] = TrackLog(first=fi, last=fi)
                    if any(iou(d["bbox"], b) >= 0.5 for tid, b in prev_tracks.items() if tid not in {x["track_id"] for x in active}):
                        id_switches += 1
                tl.last, tl.frames, tl.last_bbox = fi, tl.frames + 1, d["bbox"]
                cur[d["track_id"]] = d["bbox"]
            prev_tracks = cur

            # plates: localise → quality gate → rectify → OCR (largest vehicles first, capped per frame)
            t_plate = warp_ms = ocr_ms = 0.0
            ocr_budget = hooks.max_ocr_per_frame
            for d in sorted(detections, key=lambda d: -(d["bbox"][2] - d["bbox"][0]) * (d["bbox"][3] - d["bbox"][1])):
                t1 = time.perf_counter()
                try:
                    cands = hooks.locate_plates(frame, d)
                except Exception:
                    cands = []
                    k["plate_search_errors"] += 1
                t_plate += (time.perf_counter() - t1) * 1000
                if not cands:
                    continue
                k["vehicles_with_plate"] += 1
                s["plates_localized"] += 1
                cand = max(cands, key=lambda c: c.score)

                t2 = time.perf_counter()
                corners, method = estimate_plate_corners(frame, cand.bbox)
                flat = None
                if corners is not None:
                    angled = is_angled(corners)
                    k["plates_angled"] += angled
                    flat = rectify_angled_plate(frame, corners)
                    k[f"corners_{method}"] += 1
                    if angled:
                        k["plates_angled_rectified"] += flat is not None
                warp_ms += (time.perf_counter() - t2) * 1000
                if flat is None:
                    k["rectify_failed"] += 1
                    continue
                k["plates_rectified"] += 1

                q = hooks.plate_quality(flat, 0.0)
                if not q.accepted:
                    k["plates_rejected_quality"] += 1
                    continue
                k["plates_passed_quality"] += 1
                if hooks.ocr is None or ocr_budget <= 0:
                    k["ocr_skipped_budget"] += hooks.ocr is not None
                    continue
                ocr_budget -= 1

                t3 = time.perf_counter()
                try:
                    text, conf, lines = hooks.my_paddle_ocr(flat)
                except Exception:
                    text, conf, lines = "", 0.0, []
                    k["ocr_errors"] += 1
                ocr_ms += (time.perf_counter() - t3) * 1000
                k["ocr_reads"] += 1
                raw = normalize(text)
                if not raw:
                    continue
                k["ocr_nonempty"] += 1
                s["ocr_nonempty"] += 1
                ocr_word_conf.append(conf)
                ocr_line_conf.extend(lines)
                if hsrp_valid(raw):
                    k["hsrp_valid_raw"] += 1
                    s["hsrp_valid_raw"] += 1
                corrected, valid = hooks.pipeline_corrected(raw)
                k["hsrp_valid_corrected"] += valid
                if d.get("track_id") is not None:
                    tracks[(seq, segment, d["track_id"])].reads.append(corrected if valid else raw)

            lat["plates_ms"].append(t_plate)
            lat["warp_ms"].append(warp_ms)
            lat["ocr_ms"].append(ocr_ms)
            lat["total_ms"].append((time.perf_counter() - t_frame) * 1000)

            if args.realtime:                                   # pace like a live 15 FPS camera
                spare = 1.0 / STREAM_FPS - (time.perf_counter() - t_frame)
                if spare > 0:
                    time.sleep(spare)

            elapsed = time.perf_counter() - t_start
            bar.set_postfix_str(f"Seq {seq_i}/{len(seqs)} | {k['frames'] / elapsed:.2f} FPS | Valid HSRP "
                                f"{pct(k['hsrp_valid_raw'], k['ocr_nonempty']) or 0:.1f}%")
            bar.update(1)
        segment_lengths.append(seg_len)
        per_seq[seq] = {"frames": s["frames"], "vehicles_detected": s["vehicles_detected"],
                        "plates_localized": s["plates_localized"], "ocr_nonempty": s["ocr_nonempty"],
                        "hsrp_valid_raw": s["hsrp_valid_raw"]}
    bar.close()
    wall = time.perf_counter() - t_start

    # ── KPIs ──
    lifespans = [t.frames for t in tracks.values()]
    multi_read = [t for t in tracks.values() if len(t.reads) >= 3]
    converged = [t for t in multi_read if Counter(t.reads).most_common(1)[0][1] >= 3]
    tracking_applicable = k["continuous_pairs"] > 0
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "script": "run_standalone_uvh26_test.py",
        "source": source,
        "config": {k2: (str(v) if isinstance(v, Path) else v) for k2, v in vars(args).items()},
        "pipeline": {"detector": f"YOLO11 ({args.model}) + ByteTrack", "plate_detector": hooks.plate_detector.name,
                     "ocr": hooks.ocr.name if hooks.ocr else None, "ocr_error": hooks.ocr_error},
        "frames": {"total": k["frames"], "unreadable": k["unreadable_frames"],
                   "sharpness_gate_threshold": args.frame_sharpness,
                   "passing_sharpness_gate_pct": pct(k["frames_sharp"], k["frames"]),
                   "laplacian_variance": dist(frame_sharpness)},
        "detection": {"vehicles_detected": k["vehicles_detected"],
                      "mean_per_frame": round(k["vehicles_detected"] / max(k["frames"], 1), 2),
                      "frames_without_vehicles": k["frames_without_vehicles"], "detector_errors": k["detector_errors"],
                      "ground_truth": None if not gt_total else {
                          "annotations": f"UVH-26-{args.annotations.upper()}", "iou_threshold": 0.5, "class_agnostic": True,
                          "gt_boxes": gt_total, "predicted_boxes": gt_pred, "true_positives": gt_tp,
                          "precision_pct": pct(gt_tp, gt_pred), "recall_pct": pct(gt_tp, gt_total),
                          "f1_pct": round(200.0 * gt_tp / (gt_pred + gt_total), 2) if gt_pred + gt_total else None,
                          "recall_by_class_pct": {c: {"recall_pct": pct(h, n), "gt": n}
                                                  for c, (h, n) in sorted(gt_class_hits.items(), key=lambda x: -x[1][1])},
                          "note": "the pipeline keeps COCO car/motorcycle/bus/truck only (no bicycle, no auto-rickshaw class)"}},
        "tracking": {
            "applicable": tracking_applicable,
            "note": None if tracking_applicable else
                    "no two consecutive frames show the same scene - UVH-26 frames are independent snapshots, so "
                    "track retention, lifespan and ID switches are not meaningful here (tracker reset at every cut)",
            "continuous_frame_pairs": k["continuous_pairs"], "frame_pairs": k["frame_pairs"],
            "continuous_segments": sum(1 for n in segment_lengths if n > 1),
            "tracks_total": len(tracks),
            "tracks_retained_3plus_frames": sum(1 for n in lifespans if n >= 3),
            "track_retention_pct": pct(sum(1 for n in lifespans if n >= 3), len(lifespans)),
            "avg_track_lifespan_frames": round(statistics.fmean(lifespans), 2) if lifespans else None,
            "avg_track_lifespan_seconds_at_15fps": round(statistics.fmean(lifespans) / STREAM_FPS, 2) if lifespans else None,
            "id_switches_proxy": id_switches,
            "id_switch_definition": "a new track id born on (IoU >= 0.5) the box of an id that vanished in the previous "
                                    "frame (no ground-truth identities in UVH-26)"},
        "plates": {
            "vehicles_with_plate_candidate": k["vehicles_with_plate"],
            "plate_localization_rate_pct": pct(k["vehicles_with_plate"], k["vehicles_detected"]),
            "angled_or_trapezoidal": k["plates_angled"],
            "angled_rectified": k["plates_angled_rectified"],
            "angled_rectification_yield_pct": pct(k["plates_angled_rectified"], k["plates_angled"]),
            "rectified_total": k["plates_rectified"], "rectify_failed": k["rectify_failed"],
            "corner_methods": {m: k[f"corners_{m}"] for m in ("quad", "min_area_rect", "bbox")},
            "passed_plate_quality_gate": k["plates_passed_quality"],
            "rejected_plate_quality_gate": k["plates_rejected_quality"],
            "plate_quality_pass_pct": pct(k["plates_passed_quality"], k["plates_rectified"]),
            "ocr_skipped_by_per_frame_budget": k["ocr_skipped_budget"]},
        "ocr": {
            "reads": k["ocr_reads"], "nonempty": k["ocr_nonempty"], "errors": k["ocr_errors"],
            "word_level_confidence": dist(ocr_word_conf),
            "line_level_confidence": dist(ocr_line_conf),
            "character_level_confidence": None,
            "character_level_note": "PaddleOCR 3.x reports one score per text line; per-character probabilities "
                                    "are not exposed, so none are reported"},
        "hsrp": {
            "regex_standard": HSRP_STANDARD.pattern, "regex_bh": HSRP_BH.pattern,
            "valid_raw": k["hsrp_valid_raw"], "valid_raw_pct": pct(k["hsrp_valid_raw"], k["ocr_nonempty"]),
            "valid_after_pipeline_correction": k["hsrp_valid_corrected"],
            "valid_after_pipeline_correction_pct": pct(k["hsrp_valid_corrected"], k["ocr_nonempty"])},
        "convergence": {
            "tracks_with_3plus_reads": len(multi_read), "converged": len(converged),
            "convergence_pct": pct(len(converged), len(multi_read)),
            "definition": "the most frequent plate string of a track occurs in >= 3 of its sightings"},
        "latency_ms": {name: dist(v) for name, v in lat.items()},
        "throughput": {"wall_seconds": round(wall, 2), "processing_fps": round(k["frames"] / wall, 3) if wall else None,
                       "realtime_factor_vs_15fps": round(k["frames"] / wall / STREAM_FPS, 3) if wall else None,
                       "note": "'yolo_ms' includes ByteTrack association (ultralytics runs both in one call)"},
        "per_sequence": per_seq,
    }
    return summary


# ════════════════════════════════════════════════════════════════════════════
# Reporting
# ════════════════════════════════════════════════════════════════════════════

def print_summary(r: dict[str, Any]) -> None:
    def f(v, suffix=""):
        return "—" if v is None else f"{v}{suffix}"

    gt = r["detection"]["ground_truth"]
    rows = [
        ("Frames processed", f(r["frames"]["total"])),
        ("Frames passing sharpness gate", f(r["frames"]["passing_sharpness_gate_pct"], " %")),
        ("Vehicles detected", f"{r['detection']['vehicles_detected']} ({r['detection']['mean_per_frame']}/frame)"),
        ("Detection vs UVH-26 GT (P / R / F1)", "—" if not gt else f"{gt['precision_pct']} / {gt['recall_pct']} / {gt['f1_pct']} %"),
        ("Tracking applicable", f"{r['tracking']['applicable']} ({r['tracking']['continuous_frame_pairs']}/{r['tracking']['frame_pairs']} continuous pairs)"),
        ("Tracks / retained ≥3 frames / ID switches", f"{r['tracking']['tracks_total']} / {r['tracking']['tracks_retained_3plus_frames']} / {r['tracking']['id_switches_proxy']}"),
        ("Avg track lifespan", f(r["tracking"]["avg_track_lifespan_frames"], " frames")),
        ("Plates localized", f"{r['plates']['vehicles_with_plate_candidate']} ({f(r['plates']['plate_localization_rate_pct'], ' %')} of vehicles)"),
        ("Angled plates rectified", f"{r['plates']['angled_rectified']}/{r['plates']['angled_or_trapezoidal']} ({f(r['plates']['angled_rectification_yield_pct'], ' %')})"),
        ("Plate quality gate pass", f(r["plates"]["plate_quality_pass_pct"], " %")),
        ("OCR reads (non-empty)", f"{r['ocr']['reads']} ({r['ocr']['nonempty']})"),
        ("OCR word conf (mean)", f(r["ocr"]["word_level_confidence"]["mean"])),
        ("Valid HSRP (raw / corrected)", f"{f(r['hsrp']['valid_raw_pct'], ' %')} / {f(r['hsrp']['valid_after_pipeline_correction_pct'], ' %')}"),
        ("Track convergence (≥3 reads)", f"{r['convergence']['converged']}/{r['convergence']['tracks_with_3plus_reads']} ({f(r['convergence']['convergence_pct'], ' %')})"),
        ("Latency YOLO / plate / warp / OCR (mean ms)", " / ".join(f(r["latency_ms"].get(k2, {}).get("mean")) for k2 in ("yolo_ms", "plates_ms", "warp_ms", "ocr_ms"))),
        ("Frame latency p50 / p95 (ms)", f"{f(r['latency_ms']['total_ms']['p50'])} / {f(r['latency_ms']['total_ms']['p95'])}"),
        ("Throughput", f"{r['throughput']['processing_fps']} FPS ({r['throughput']['realtime_factor_vs_15fps']}x of 15 FPS)"),
    ]
    try:
        from rich.console import Console
        from rich.table import Table

        table = Table(title="UVH-26 standalone benchmark", show_lines=False)
        table.add_column("KPI", style="bold")
        table.add_column("Value", justify="right")
        for a, b in rows:
            table.add_row(a, b)
        Console().print(table)
    except ImportError:
        try:
            from tabulate import tabulate

            print(tabulate(rows, headers=["KPI", "Value"], tablefmt="github"))
        except ImportError:
            width = max(len(a) for a, _ in rows)
            print("\n".join(f"{a:<{width}}  {b}" for a, b in rows))
    if r["tracking"]["note"]:
        print(f"note: {r['tracking']['note']}")


def cleanup(keep_summary: bool = True) -> None:
    for p in (DATA_DIR, SCRATCH):
        shutil.rmtree(p, ignore_errors=True)
    if not keep_summary:
        shutil.rmtree(TMP, ignore_errors=True)
    print(f"cleanup: removed downloaded frames/annotations and scratch output"
          + (f" (kept {SUMMARY})" if keep_summary else ""))


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Standalone UVH-26 ANPR/tracking benchmark (writes only to ./test_eval_tmp/)")
    p.add_argument("--split", choices=["val", "train"], default="val")
    p.add_argument("--sequences", nargs="*", help="data sub-folders, e.g. 000 001 (default: all available)")
    p.add_argument("--max-sequences", type=int, default=11, help="upper bound on folders (Val has 000-001)")
    p.add_argument("--frames-per-seq", type=int, default=30, help="frames per folder (each ~3 MB)")
    p.add_argument("--start-index", type=int, default=0, help="first frame (numeric filename order) per folder")
    p.add_argument("--annotations", choices=["mv", "st", "none"], default="mv", help="ground-truth vehicle boxes")
    p.add_argument("--local-frames", help="benchmark a local folder of sequential frames instead of downloading")
    p.add_argument("--model", default=str(REPO_ROOT / "yolo11n.pt") if (REPO_ROOT / "yolo11n.pt").exists() else "yolo11n.pt")
    p.add_argument("--tracking-mode", choices=["auto", "continuous", "reset"], default="auto",
                   help="auto: reset the tracker at scene cuts · continuous: never reset · reset: every frame")
    p.add_argument("--continuity", type=float, default=0.80, help="thumbnail correlation above which frames are one scene")
    p.add_argument("--frame-sharpness", type=float, default=100.0, help="Laplacian-variance gate at 960 px width")
    p.add_argument("--max-ocr-per-frame", type=int, default=6, help="OCR calls per frame (CPU budget)")
    p.add_argument("--no-ocr", action="store_true", help="skip OCR (detection / plate geometry only)")
    p.add_argument("--realtime", action="store_true", help="sleep so frames never arrive faster than 15 FPS")
    p.add_argument("--workers", type=int, default=8, help="parallel downloads")
    p.add_argument("--cleanup", action="store_true", help="delete downloads + scratch after the run (keeps the summary)")
    args = p.parse_args(argv)

    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass
    import logging

    logging.basicConfig(level=logging.WARNING, format="[%(name)s] %(message)s")
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

    try:
        summary = run(args)
        SUMMARY.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print_summary(summary)
        print(f"summary: {SUMMARY}")
    finally:
        if args.cleanup:
            cleanup(keep_summary=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
