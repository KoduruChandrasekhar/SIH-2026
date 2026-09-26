#!/usr/bin/env python3
"""
Automated full-pipeline ANPR benchmark: acquire a 10 s traffic clip → 15 FPS frames → track → plate → OCR → KPIs.

    # 1. YouTube (you choose the video - use one you have the right to download and process):
    python run_automated_anpr_benchmark.py --url "https://www.youtube.com/watch?v=<id>" --start 30
    # 2. a local video file (any container ffmpeg reads):
    python run_automated_anpr_benchmark.py --video public/camera-feeds/CAM-402.mp4
    # 3. frames you already have:
    python run_automated_anpr_benchmark.py --frames-dir ./test_eval_tmp/local_frames

    options: --duration 10 --fps 15 --ocr-profile default|accurate|full --ocr-device auto|gpu|cpu
             --model backend/models/uvh26_yolo11s.pt --max-ocr-per-frame 6 --cleanup

Requirements for --url: `pip install yt-dlp` (the ffmpeg binary bundled with imageio-ffmpeg is used when ffmpeg
is not on PATH). Everything is written to ./test_eval_tmp/ (frames in local_frames/, metrics in
automated_benchmark_results.json); the repository itself is only read. The folder gets its own `.gitignore: *`.

Hooks (swap the bodies of `PipelineHooks` to benchmark another stack):
    1. detect_and_track(frame)            YOLO11 + ByteTrack                      → tracks
    2. localize_and_warp(frame, track)    plate detector + perspective rectification → fronto-parallel plate
    3. read_plate(flat_plate)             PaddleOCR (TraceNet read path)          → text, confidence

KPIs
    tracking     tracks, retention (share of tracks alive ≥ 3 / ≥ 10 frames), mean lifespan, ID-switch proxy
    ocr          reads, syntactic validity (strict HSRP regex, raw and after TraceNet's positional correction)
    consensus    share of multi-read tracks whose OCR gives the identical string in ≥ 3 CONSECUTIVE frames
    speed        per-component latency (YOLO / plate+warp / OCR ms), end-to-end FPS vs the 15 FPS stream
"""

from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import argparse
import json
import os
import re
import shutil
import statistics
import subprocess
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

TMP = Path("./test_eval_tmp").resolve()
FRAMES_DIR = TMP / "local_frames"
CLIP_DIR = TMP / "clip"
SCRATCH = TMP / "_pipeline_scratch"
RESULTS = TMP / "automated_benchmark_results.json"

HSRP_STANDARD = re.compile(r"^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$")
HSRP_BH = re.compile(r"^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$")
REGIONAL_MODEL = REPO_ROOT / "backend" / "models" / "uvh26_yolo11s.pt"


class AcquisitionError(RuntimeError):
    pass


# ════════════════════════════════════════════════════════════════════════════
# 1. Data acquisition
# ════════════════════════════════════════════════════════════════════════════

def ffmpeg_exe() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        raise AcquisitionError("ffmpeg not found - install it or `pip install imageio-ffmpeg`") from exc


def _run(cmd: list[str], what: str, timeout: int) -> subprocess.CompletedProcess:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as exc:
        raise AcquisitionError(f"{what}: executable not found ({cmd[0]})") from exc
    except subprocess.TimeoutExpired as exc:
        raise AcquisitionError(f"{what}: timed out after {timeout} s") from exc
    if proc.returncode != 0:
        tail = "\n".join((proc.stderr or proc.stdout or "").strip().splitlines()[-8:])
        raise AcquisitionError(f"{what} failed (exit {proc.returncode}):\n{tail}")
    return proc


def yt_dlp_cmd() -> list[str]:
    exe = shutil.which("yt-dlp")
    if exe:
        return [exe]
    try:
        import yt_dlp  # noqa: F401

        return [sys.executable, "-m", "yt_dlp"]
    except ImportError as exc:
        raise AcquisitionError("yt-dlp is not installed - `pip install yt-dlp`") from exc


def download_youtube_slice(url: str, start: float, duration: float, out_dir: Path, max_height: int = 1080) -> Path:
    """Download only [start, start+duration] of a video at ≤ max_height (yt-dlp --download-sections)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("clip.*"):
        old.unlink()
    fmt = (f"bv*[height<={max_height}][ext=mp4]/bv*[height<={max_height}]/"
           f"b[height<={max_height}]/b")
    cmd = yt_dlp_cmd() + [
        "--no-playlist", "--no-part", "--quiet", "--no-warnings",
        "-f", fmt,
        "--download-sections", f"*{start:.2f}-{start + duration:.2f}",
        "--force-keyframes-at-cuts",
        "--ffmpeg-location", ffmpeg_exe(),
        "-o", str(out_dir / "clip.%(ext)s"),
        url,
    ]
    _run(cmd, "yt-dlp download", timeout=900)
    clips = sorted(out_dir.glob("clip.*"))
    if not clips:
        raise AcquisitionError("yt-dlp finished but produced no file")
    return clips[0]


def extract_frames(video: Path, out_dir: Path, fps: float, start: float = 0.0, duration: Optional[float] = None,
                   max_height: int = 1080) -> list[Path]:
    """Sequential frames at `fps` (PNG, lossless - OCR is sensitive to JPEG artefacts on small plates)."""
    if not video.exists():
        raise AcquisitionError(f"video not found: {video}")
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    cmd = [ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y"]
    if start:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", str(video)]
    if duration:
        cmd += ["-t", f"{duration:.3f}"]
    cmd += ["-vf", f"fps={fps},scale=-2:'min({max_height},ih)'", str(out_dir / "frame_%05d.png")]
    _run(cmd, "ffmpeg frame extraction", timeout=900)
    frames = sorted(out_dir.glob("frame_*.png"))
    if not frames:
        raise AcquisitionError("ffmpeg produced no frames (is the clip empty or the start past its end?)")
    return frames


def acquire(args) -> tuple[list[Path], dict[str, Any]]:
    if args.frames_dir:
        folder = Path(args.frames_dir)
        frames = sorted(p for p in folder.iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg"))
        if not frames:
            raise AcquisitionError(f"no frames in {folder}")
        return frames, {"type": "frames", "path": str(folder)}
    if args.url:
        print(f"[1/3] Downloading {args.duration:g} s from {args.url} (start {args.start:g} s, ≤{args.max_height}p) ...")
        clip = download_youtube_slice(args.url, args.start, args.duration, CLIP_DIR, args.max_height)
        frames = extract_frames(clip, FRAMES_DIR, args.fps, max_height=args.max_height)
        return frames, {"type": "youtube", "url": args.url, "start": args.start, "duration": args.duration, "clip": str(clip)}
    video = Path(args.video)
    print(f"[1/3] Extracting {args.duration:g} s of {video} at {args.fps:g} FPS ...")
    frames = extract_frames(video, FRAMES_DIR, args.fps, args.start, args.duration, args.max_height)
    return frames, {"type": "video", "path": str(video), "start": args.start, "duration": args.duration}


# ════════════════════════════════════════════════════════════════════════════
# 2. Pipeline hooks (read-only use of TraceNet)
# ════════════════════════════════════════════════════════════════════════════

def _order(pts: np.ndarray) -> np.ndarray:
    s, d = pts.sum(axis=1), np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], np.float32)


def estimate_plate_corners(frame: np.ndarray, bbox) -> Optional[np.ndarray]:
    """4 plate corners: a 4-point contour (trapezoid) if visible, else the min-area rectangle, else the box."""
    H, W = frame.shape[:2]
    x1, y1, x2, y2 = (int(v) for v in bbox)
    pw, ph = x2 - x1, y2 - y1
    if pw < 8 or ph < 4:
        return None
    px, py = int(pw * 0.15), int(ph * 0.35)
    rx1, ry1, rx2, ry2 = max(0, x1 - px), max(0, y1 - py), min(W, x2 + px), min(H, y2 + py)
    gray = cv2.cvtColor(frame[ry1:ry2, rx1:rx2], cv2.COLOR_BGR2GRAY)
    best = None
    for inv in (False, True):
        _, th = cv2.threshold(gray, 0, 255, (cv2.THRESH_BINARY_INV if inv else cv2.THRESH_BINARY) + cv2.THRESH_OTSU)
        for c in cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
            a = cv2.contourArea(c)
            if 0.4 * pw * ph <= a <= 3.0 * pw * ph and (best is None or a > cv2.contourArea(best)):
                best = c
    off = np.array([rx1, ry1], np.float32)
    if best is not None:
        approx = cv2.approxPolyDP(best, 0.04 * cv2.arcLength(best, True), True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            return approx.reshape(4, 2).astype(np.float32) + off
        return cv2.boxPoints(cv2.minAreaRect(best)).astype(np.float32) + off
    return np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], np.float32)


def rectify_angled_plate(frame: np.ndarray, corners: np.ndarray) -> Optional[np.ndarray]:
    tl, tr, br, bl = _order(corners)
    width = max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))
    height = max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))
    if width < 20 or height < 6:
        return None
    out_h = 64
    out_w = int(round(out_h * float(np.clip(width / height, 1.5, 6.5))))
    M = cv2.getPerspectiveTransform(np.array([tl, tr, br, bl], np.float32),
                                    np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], np.float32))
    flat = cv2.warpPerspective(frame, M, (out_w, out_h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return flat if float(cv2.cvtColor(flat, cv2.COLOR_BGR2GRAY).std()) >= 12.0 else None


class PipelineHooks:
    def __init__(self, model: str, confidence: float, iou: float, imgsz: Optional[int], ocr_profile: str,
                 ocr_device: str, with_ocr: bool = True):
        from backend.ai.plate_detector import create_plate_detector
        from backend.ai.vehicle_tracker import VehicleTracker
        from backend.anpr.config import load_anpr_config

        SCRATCH.mkdir(parents=True, exist_ok=True)
        self.tracker = VehicleTracker(model_path=model, confidence=confidence, iou=iou, imgsz=imgsz,
                                      output_dir=str(SCRATCH), public_dir=str(SCRATCH))
        cfg = load_anpr_config()
        profiles = {
            "default": cfg,                                                   # anpr.json: hybrid, PP-OCRv5 mobile rec
            "accurate": replace(cfg, ocr_fast_rec_model="PP-OCRv6_medium_rec", ocr_fast_rec_mkldnn=False),
            "full": replace(cfg, ocr_mode="full"),                            # the pre-upgrade det+rec path
        }
        self.cfg = replace(profiles[ocr_profile], ocr_device=ocr_device)
        self.plate_detector = create_plate_detector(self.cfg)
        self.ocr = None
        self.ocr_backend = None
        self.ocr_error = None
        if with_ocr:
            try:
                from backend.anpr.recognizer import build_ocr_engine

                self.ocr = build_ocr_engine(self.cfg)
                self.ocr_backend = getattr(self.ocr, "backend", self.ocr.name)
            except Exception as exc:
                self.ocr_error = f"{type(exc).__name__}: {exc}"

    # hook 1
    def detect_and_track(self, frame: np.ndarray) -> list[dict]:
        return [d for d in self.tracker.track_frame(frame) if d.get("track_id") is not None]

    # hook 2
    def localize_and_warp(self, frame: np.ndarray, track: dict) -> tuple[Optional[np.ndarray], str]:
        """Best plate candidate on this vehicle → corners → fronto-parallel crop. (crop | None, status)."""
        try:
            cands = self.plate_detector.detect(frame, track["bbox"], track.get("class_name"))
        except Exception:
            return None, "plate_search_error"
        if not cands:
            return None, "no_plate"
        cand = max(cands, key=lambda c: c.score)
        corners = estimate_plate_corners(frame, cand.bbox)
        if corners is None:
            return None, "no_corners"
        flat = rectify_angled_plate(frame, corners)
        if flat is None:
            return None, "warp_failed"
        from backend.anpr.quality import measure_quality

        q = measure_quality(flat, self.cfg, 0.0)
        return (flat, "ok") if q.accepted else (None, f"quality_{q.reject_reason or 'low'}")

    # hook 3
    def read_plate(self, flat_plate: np.ndarray) -> tuple[str, float, str, bool]:
        """(raw text, confidence, pipeline-corrected text, corrected text is a valid plate)."""
        from backend.anpr.recognizer import read_crop

        read = read_crop(self.ocr, flat_plate, self.cfg)
        return (read.result.text or "", float(read.result.confidence or 0.0),
                read.validation.corrected_text or "", bool(read.validation.format_valid))


# ════════════════════════════════════════════════════════════════════════════
# 3. Benchmark + KPIs
# ════════════════════════════════════════════════════════════════════════════

def normalize(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


def hsrp_valid(text: str) -> bool:
    return bool(HSRP_STANDARD.match(text) or HSRP_BH.match(text))


def iou(a, b) -> float:
    ix1, iy1, ix2, iy2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def pct(n, d) -> Optional[float]:
    return round(100.0 * n / d, 2) if d else None


def dist(v: list[float]) -> dict[str, Optional[float]]:
    if not v:
        return {"mean": None, "p50": None, "p95": None}
    s = sorted(v)
    return {"mean": round(statistics.fmean(s), 2), "p50": round(s[len(s) // 2], 2), "p95": round(s[min(len(s) - 1, int(0.95 * len(s)))], 2)}


@dataclass
class Track:
    first: int
    last: int
    frames: int = 0
    bbox: list[float] = field(default_factory=list)
    reads: list[tuple[int, str]] = field(default_factory=list)      # (frame index, text)


MIN_PLATE_CHARS = 6          # shorter strings are OCR noise ("2", "IND") - never counted as a stabilised plate


def longest_identical_run(reads: list[tuple[int, str]], min_chars: int = 1) -> tuple[int, str]:
    """Longest run of the same string (≥ min_chars) over CONSECUTIVE frame indices."""
    best, best_text, run, prev_f, prev_t = 0, "", 0, None, None
    for f, t in sorted(reads):
        t = t if len(t) >= min_chars else ""
        run = run + 1 if (t and t == prev_t and prev_f is not None and f == prev_f + 1) else (1 if t else 0)
        if run > best:
            best, best_text = run, t
        prev_f, prev_t = f, t
    return best, best_text


def benchmark(frames: list[Path], hooks: PipelineHooks, args) -> dict[str, Any]:
    from tqdm import tqdm

    lat = defaultdict(list)
    k = Counter()
    tracks: dict[int, Track] = {}
    prev_ids: dict[int, list[float]] = {}
    recently_lost: dict[int, tuple[int, list[float]]] = {}
    id_switches = 0
    t0 = time.perf_counter()
    bar = tqdm(frames, unit="frame", dynamic_ncols=True, desc="[3/3] benchmark")
    for fi, path in enumerate(bar):
        t_frame = time.perf_counter()
        frame = cv2.imread(str(path))
        if frame is None or frame.size == 0:
            k["unreadable_frames"] += 1
            continue
        k["frames"] += 1

        ta = time.perf_counter()
        try:
            active = hooks.detect_and_track(frame)
        except Exception as exc:
            active = []
            k["tracker_errors"] += 1
            if k["tracker_errors"] == 1:
                tqdm.write(f"  tracker error (continuing): {type(exc).__name__}: {exc}")
        lat["yolo_ms"].append((time.perf_counter() - ta) * 1000)
        k["detections"] += len(active)
        k["frames_without_vehicles"] += not active

        # tracks + ID-switch proxy: a new id born within 3 frames on the last box of a vanished id
        ids_now = {d["track_id"] for d in active}
        for tid, box in prev_ids.items():
            if tid not in ids_now:
                recently_lost[tid] = (fi - 1, box)
        recently_lost = {t: v for t, v in recently_lost.items() if fi - v[0] <= 3}
        for d in active:
            tid = d["track_id"]
            tr = tracks.get(tid)
            if tr is None:
                tr = tracks[tid] = Track(first=fi, last=fi)
                hit = next((t for t, (_, box) in recently_lost.items() if iou(d["bbox"], box) >= 0.4), None)
                if hit is not None:
                    id_switches += 1
                    recently_lost.pop(hit, None)
            tr.last, tr.frames, tr.bbox = fi, tr.frames + 1, d["bbox"]
        prev_ids = {d["track_id"]: d["bbox"] for d in active}

        # plates: largest vehicles first, capped per frame (CPU budget)
        warp_ms = ocr_ms = 0.0
        budget = args.max_ocr_per_frame
        for d in sorted(active, key=lambda d: -(d["bbox"][2] - d["bbox"][0]) * (d["bbox"][3] - d["bbox"][1])):
            if budget <= 0:
                k["ocr_skipped_budget"] += 1
                continue
            tb = time.perf_counter()
            try:
                flat, status = hooks.localize_and_warp(frame, d)
            except Exception:
                flat, status = None, "warp_error"
            warp_ms += (time.perf_counter() - tb) * 1000
            k[f"plate_{status}"] += 1
            if flat is None or hooks.ocr is None:
                continue
            budget -= 1
            tc = time.perf_counter()
            try:
                raw, conf, corrected, valid = hooks.read_plate(flat)
            except Exception:
                raw, conf, corrected, valid = "", 0.0, "", False
                k["ocr_errors"] += 1
            ocr_ms += (time.perf_counter() - tc) * 1000
            k["ocr_reads"] += 1
            text = normalize(raw)
            if not text:
                continue
            k["ocr_nonempty"] += 1
            k["hsrp_valid_raw"] += hsrp_valid(text)
            k["hsrp_valid_corrected"] += valid
            k["conf_sum_x1000"] += int(conf * 1000)
            tracks[d["track_id"]].reads.append((fi, corrected if valid else text))

        lat["plate_warp_ms"].append(warp_ms)
        lat["ocr_ms"].append(ocr_ms)
        lat["total_ms"].append((time.perf_counter() - t_frame) * 1000)
        elapsed = time.perf_counter() - t0
        bar.set_postfix_str(f"{k['frames'] / elapsed:.2f} FPS | tracks {len(tracks)} | "
                            f"valid HSRP {pct(k['hsrp_valid_raw'], k['ocr_nonempty']) or 0:.1f}%")
    wall = time.perf_counter() - t0

    lifespans = [t.frames for t in tracks.values()]
    multi = {tid: t for tid, t in tracks.items() if len(t.reads) >= 3}
    runs = {tid: longest_identical_run(t.reads, MIN_PLATE_CHARS) for tid, t in multi.items()}
    consensus = {tid: r for tid, r in runs.items() if r[0] >= 3}
    consensus_valid = {tid: r for tid, r in consensus.items() if hsrp_valid(r[1])}
    anywhere = {tid for tid, t in multi.items()
                if (lambda top: len(top[0]) >= MIN_PLATE_CHARS and top[1] >= 3)(Counter(x for _, x in t.reads).most_common(1)[0])}
    plate_status = {s[6:]: n for s, n in k.items() if s.startswith("plate_")}
    return {
        "frames": {"total": k["frames"], "unreadable": k["unreadable_frames"], "without_vehicles": k["frames_without_vehicles"]},
        "tracking": {
            "detections": k["detections"], "tracks": len(tracks), "tracker_errors": k["tracker_errors"],
            "retained_3plus_frames": sum(n >= 3 for n in lifespans),
            "track_retention_pct_3plus": pct(sum(n >= 3 for n in lifespans), len(lifespans)),
            "track_retention_pct_10plus": pct(sum(n >= 10 for n in lifespans), len(lifespans)),
            "mean_lifespan_frames": round(statistics.fmean(lifespans), 2) if lifespans else None,
            "mean_lifespan_seconds": round(statistics.fmean(lifespans) / args.fps, 2) if lifespans else None,
            "id_switches_proxy": id_switches,
            "id_switch_definition": "new track id born within 3 frames on (IoU >= 0.4) the last box of an id that "
                                    "vanished - no ground-truth identities are available for web/dashcam clips"},
        "plates": {"attempts_by_status": plate_status, "ocr_skipped_by_budget": k["ocr_skipped_budget"]},
        "ocr": {"backend": hooks.ocr_backend, "error": hooks.ocr_error, "reads": k["ocr_reads"],
                "nonempty": k["ocr_nonempty"], "errors": k["ocr_errors"],
                "mean_confidence": round(k["conf_sum_x1000"] / 1000 / k["ocr_nonempty"], 3) if k["ocr_nonempty"] else None,
                "syntactic_validity_raw_pct": pct(k["hsrp_valid_raw"], k["ocr_nonempty"]),
                "syntactic_validity_after_correction_pct": pct(k["hsrp_valid_corrected"], k["ocr_nonempty"]),
                "regex": [HSRP_STANDARD.pattern, HSRP_BH.pattern]},
        "consensus": {
            "tracks_with_3plus_reads": len(multi),
            "consecutive_3_identical": len(consensus),
            "consensus_pct": pct(len(consensus), len(multi)),
            "consecutive_3_identical_valid_plate": len(consensus_valid),
            "consensus_valid_plate_pct": pct(len(consensus_valid), len(multi)),
            "identical_3_anywhere": len(anywhere),
            "identical_3_anywhere_pct": pct(len(anywhere), len(multi)),
            "stabilised_plates": sorted({t for _, t in consensus.values()}),
            "definition": f"identical OCR string (>= {MIN_PLATE_CHARS} chars) in >= 3 consecutive frames of the "
                          "same track id; *_valid_plate additionally requires the string to be a valid HSRP plate"},
        "latency_ms": {name: dist(v) for name, v in lat.items()},
        "throughput": {"wall_seconds": round(wall, 2), "fps": round(k["frames"] / wall, 3) if wall else None,
                       "realtime_factor": round(k["frames"] / wall / args.fps, 3) if wall else None,
                       "note": "'yolo_ms' includes ByteTrack association (one ultralytics call)"},
        "track_reads": {str(tid): {"frames": [t.first, t.last], "reads": len(t.reads),
                                   "top": Counter(x for _, x in t.reads).most_common(3)} for tid, t in multi.items()},
    }


def print_summary(r: dict[str, Any]) -> None:
    f = lambda v, s="": "—" if v is None else f"{v}{s}"
    t, o, c, lat, thr = r["tracking"], r["ocr"], r["consensus"], r["latency_ms"], r["throughput"]
    rows = [
        ("Frames", f(r["frames"]["total"])),
        ("Tracks / detections", f"{t['tracks']} / {t['detections']}"),
        ("Track retention (≥3 / ≥10 frames)", f"{f(t['track_retention_pct_3plus'], ' %')} / {f(t['track_retention_pct_10plus'], ' %')}"),
        ("Mean track lifespan", f"{f(t['mean_lifespan_frames'])} frames ({f(t['mean_lifespan_seconds'])} s)"),
        ("ID switches (proxy)", f(t["id_switches_proxy"])),
        ("OCR backend", f(o["backend"] or o["error"])),
        ("OCR reads (non-empty)", f"{o['reads']} ({o['nonempty']})"),
        ("HSRP validity raw / corrected", f"{f(o['syntactic_validity_raw_pct'], ' %')} / {f(o['syntactic_validity_after_correction_pct'], ' %')}"),
        ("Consensus (3 consecutive identical)", f"{c['consecutive_3_identical']}/{c['tracks_with_3plus_reads']} ({f(c['consensus_pct'], ' %')})"),
        ("  … on a valid HSRP plate", f"{c['consecutive_3_identical_valid_plate']}/{c['tracks_with_3plus_reads']} ({f(c['consensus_valid_plate_pct'], ' %')})"),
        ("Stabilised plates", ", ".join(c["stabilised_plates"][:6]) or "—"),
        ("Latency YOLO / plate+warp / OCR (mean ms)", " / ".join(f(lat[x]["mean"]) for x in ("yolo_ms", "plate_warp_ms", "ocr_ms"))),
        ("Frame latency p50 / p95 (ms)", f"{f(lat['total_ms']['p50'])} / {f(lat['total_ms']['p95'])}"),
        ("Throughput", f"{f(thr['fps'])} FPS ({f(thr['realtime_factor'])}x real time)"),
    ]
    try:
        from rich.console import Console
        from rich.table import Table

        table = Table(title="Automated ANPR benchmark")
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
            w = max(len(a) for a, _ in rows)
            print("\n".join(f"{a:<{w}}  {b}" for a, b in rows))


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Automated full-pipeline ANPR benchmark (writes only to ./test_eval_tmp/)")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--url", help="video URL for yt-dlp (you are responsible for the right to download it)")
    src.add_argument("--video", help="local video file")
    src.add_argument("--frames-dir", help="existing folder of sequential frames")
    p.add_argument("--start", type=float, default=0.0, help="slice start (s)")
    p.add_argument("--duration", type=float, default=10.0, help="slice length (s)")
    p.add_argument("--fps", type=float, default=15.0)
    p.add_argument("--max-height", type=int, default=1080)
    p.add_argument("--model", default=str(REGIONAL_MODEL) if REGIONAL_MODEL.exists() else str(REPO_ROOT / "yolo11n.pt"))
    p.add_argument("--confidence", type=float, default=0.3)
    p.add_argument("--iou", type=float, default=0.7, help="NMS IoU")
    p.add_argument("--imgsz", type=int, default=None)
    p.add_argument("--ocr-profile", choices=["default", "accurate", "full"], default="default",
                   help="default = hybrid, PP-OCRv5 mobile rec first (anpr.json) · accurate = PP-OCRv6 medium rec first "
                        "· full = the old det+rec path")
    p.add_argument("--ocr-device", default="auto", help="auto | gpu | gpu:N | cpu")
    p.add_argument("--no-ocr", action="store_true")
    p.add_argument("--max-ocr-per-frame", type=int, default=6)
    p.add_argument("--out", default=str(RESULTS))
    p.add_argument("--cleanup", action="store_true", help="delete clip + frames afterwards (keeps the results JSON)")
    args = p.parse_args(argv)

    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass
    import logging

    logging.basicConfig(level=logging.WARNING, format="[%(name)s] %(message)s")
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    TMP.mkdir(parents=True, exist_ok=True)
    (TMP / ".gitignore").write_text("*\n", encoding="utf-8")

    try:
        frames, source = acquire(args)
        print(f"      {len(frames)} frames in {frames[0].parent}")
        print("[2/3] Loading the pipeline ...")
        hooks = PipelineHooks(args.model, args.confidence, args.iou, args.imgsz, args.ocr_profile, args.ocr_device,
                              with_ocr=not args.no_ocr)
        if hooks.ocr_error:
            print(f"      OCR unavailable: {hooks.ocr_error}")
        result = benchmark(frames, hooks, args)
        result = {"generated_at": datetime.now(timezone.utc).isoformat(), "source": source,
                  "config": {k: v for k, v in vars(args).items()},
                  "pipeline": {"detector": args.model, "confidence": args.confidence, "nms_iou": args.iou,
                               "ocr_profile": args.ocr_profile, "ocr_backend": hooks.ocr_backend}, **result}
        Path(args.out).write_text(json.dumps(result, indent=2), encoding="utf-8")
        print_summary(result)
        print(f"results: {args.out}")
        return 0
    except AcquisitionError as exc:
        print(f"[ERROR] data acquisition: {exc}", file=sys.stderr)
        return 2
    finally:
        if args.cleanup:
            for d in (CLIP_DIR, FRAMES_DIR, SCRATCH):
                shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
