#!/usr/bin/env python3
"""
TraceNet — synthetic multi-camera ANPR dataset with exact ground truth (completion plan 4C).

    python backend/scripts/generate_dataset.py                    # 16 vehicles, 6 cameras, seed 26127
    python backend/scripts/generate_dataset.py --vehicles 24 --seed 7
    python backend/scripts/evaluate_dataset.py                    # score fusion (and, with --e2e, the vision stack)

Programmatic generation (strategy C), built from the project's own material:

* backgrounds  - temporal median of the real camera footage (CAM-401/402/403), which removes moving
                 traffic; cameras without footage (CAM-406/410/411) get a mirrored, re-tinted copy of one of
                 those (labelled `derived_from` in the ground truth). Plate-like regions are blurred.
* vehicles     - real vehicle crops cut from the footage with the Phase 1 YOLO11 detections (one crop per
                 synthetic identity, so appearance is consistent across cameras - what Re-ID relies on).
                 The real plate on every crop is blurred and covered by the synthetic plate.
* plates       - rendered with PIL in the Indian high-security layout (IND strip, black border; white =
                 private, yellow = commercial) from random valid STANDARD registrations.
* routes       - each vehicle drives an ordered camera route; camera-to-camera times come from the directed
                 OSRM road distances in backend/config/road_network.json at a per-vehicle speed.
* recording    - event recording, like motion-triggered CCTV: each camera video holds only the windows in
                 which vehicles pass (merged when they overlap). `segments` maps video time to wall time.

Scenario roles (ground truth says which): normal · ghost (plate read at the first camera, washed out by glare
at the others) · clone_a/clone_b (two different vehicles with the same plate, far apart, minutes apart →
CLONED_PLATE) · blacklist (DL01XY0001, on the seeded watchlist → BLACKLIST_HIT) · tampered (altered plate
→ INVALID_FORMAT).

Output (backend/output/dataset/, git-ignored):
    videos/CAM-xxx.mp4       1920x1080 H.264, 25 fps
    crops/<transit>.png      vehicle crop at the ground-truth frame (for fusion-only evaluation)
    ground_truth.json        vehicles, routes, transits (camera, wall time, video time, bbox, plate), segments
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.anpr.validation import validate_plate  # noqa: E402
from backend.fusion.road_network import RoadNetwork  # noqa: E402

FEEDS_DIR = PROJECT_ROOT / "public" / "camera-feeds"
DETECTIONS_DIR = PROJECT_ROOT / "backend" / "output"
DATASET_DIR = PROJECT_ROOT / "backend" / "output" / "dataset"

W, H, FPS = 1920, 1080, 25
TRANSIT_SECONDS = 4.0            # horizon → closest point (plate largest)
EXIT_SECONDS = 1.0               # then the vehicle leaves the frame at the bottom
BEST_U = 0.95                    # ground-truth instant: plate largest while the vehicle is fully in frame
SEGMENT_PAD = 1.0
LANES = (0.30, 0.55, 0.78)
BASE_WIDTH = {"car": 620, "truck": 780, "bus": 820, "motorcycle": 440}
VEHICLE_CLASSES = set(BASE_WIDTH)
STATES = ("TS", "AP", "KA", "MH", "TN", "GJ", "KL", "RJ")
SERIES_LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ"         # no I / O on Indian plates
BLACKLIST_PLATE = "DL01XY0001"                     # seeded in db/schema.sql
DEFAULT_START = "2026-09-25T09:00:00+05:30"


# ─── plates ──────────────────────────────────────────────────────────────────

def random_plate(rng: random.Random) -> str:
    while True:
        text = (f"{rng.choice(STATES)}{rng.randint(1, 40):02d}"
                f"{''.join(rng.choice(SERIES_LETTERS) for _ in range(rng.choice((1, 2, 2))))}{rng.randint(1, 9999):04d}")
        v = validate_plate(text)
        if v.format_valid and v.corrected_text == text:
            return text


def spaced(plate: str) -> str:
    """TS09EA1234 → 'TS 09 EA 1234' (the printed layout)."""
    return f"{plate[:2]} {plate[2:4]} {plate[4:-4]} {plate[-4:]}"


def _font(size: int) -> ImageFont.FreeTypeFont:
    candidates = []
    try:
        import matplotlib

        candidates.append(Path(matplotlib.get_data_path()) / "fonts" / "ttf" / "DejaVuSans-Bold.ttf")
    except Exception:
        pass
    candidates += [Path("C:/Windows/Fonts/DejaVuSansCondensed-Bold.ttf"), Path("C:/Windows/Fonts/arialbd.ttf"),
                   Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")]
    for c in candidates:
        if c.exists():
            return ImageFont.truetype(str(c), size)
    return ImageFont.load_default(size=size)


def render_plate(text: str, commercial: bool, condition: str, rng: random.Random) -> np.ndarray:
    """Indian HSRP-style plate, BGR, 520x120. condition: clean | glare | tampered."""
    pw, ph = 520, 120
    img = Image.new("RGB", (pw, ph), (252, 208, 26) if commercial else (246, 246, 242))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([3, 3, pw - 4, ph - 4], radius=10, outline=(12, 12, 12), width=6)
    d.rectangle([9, 9, 52, ph - 10], fill=(24, 64, 170))                       # IND strip
    d.text((30, ph - 30), "IND", font=_font(15), fill=(255, 255, 255), anchor="mm")
    label = text if condition == "tampered" else spaced(text)
    size = 74
    while size > 20:
        font = _font(size)
        box = d.textbbox((0, 0), label, font=font)
        if box[2] - box[0] <= pw - 90:
            break
        size -= 2
    d.text((60 + (pw - 70) / 2, ph / 2 + 2), label, font=font, fill=(10, 10, 10), anchor="mm")
    arr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    if condition == "glare":                   # specular glare: the text is washed out, not readable
        yy, xx = np.mgrid[0:ph, 0:pw]
        cx, cy = rng.uniform(0.35, 0.65) * pw, rng.uniform(0.3, 0.7) * ph
        g = np.exp(-(((xx - cx) / (pw * 0.42)) ** 2 + ((yy - cy) / (ph * 0.9)) ** 2))
        arr = np.clip(arr + (g[..., None] * 255 * 1.4), 0, 255).astype(np.uint8)
    return arr


def tamper(plate: str, rng: random.Random) -> str:
    """Physically altered plate: characters painted over / replaced - never a valid registration."""
    while True:
        chars = list(plate)
        for i in rng.sample(range(2, len(chars) - 1), 2):
            chars[i] = rng.choice("?#")
        out = "".join(chars)
        if not validate_plate(out).format_valid:
            return out


# ─── real material: backgrounds + vehicle crops ─────────────────────────────

def _frames_at(video: Path, indices) -> dict[int, np.ndarray]:
    """Decode the wanted frames in ONE sequential pass (seeking in long-GOP 1440p H.264 is very slow)."""
    wanted, out = set(int(i) for i in indices), {}
    if not wanted:
        return out
    cap = cv2.VideoCapture(str(video))
    last, index = max(wanted), 0
    while index <= last:
        if index in wanted:
            ok, frame = cap.read()
            if not ok:
                break
            out[index] = frame
        elif not cap.grab():
            break
        index += 1
    cap.release()
    return out


class FrameBank:
    """Every frame the generator needs from the real footage, decoded in one pass per video."""

    def __init__(self):
        self.wanted: dict[Path, set[int]] = {}
        self.frames: dict[tuple[Path, int], np.ndarray] = {}

    def want(self, video: Path, indices) -> None:
        self.wanted.setdefault(video, set()).update(int(i) for i in indices)

    def load(self) -> "FrameBank":
        for video, indices in self.wanted.items():
            for i, frame in _frames_at(video, indices).items():
                self.frames[(video, i)] = frame
        return self

    def get(self, video: Path, index: int) -> Optional[np.ndarray]:
        return self.frames.get((video, int(index)))


def footage() -> dict[str, Path]:
    return {mp4.stem: mp4 for mp4 in sorted(FEEDS_DIR.glob("CAM-*.mp4")) if "_" not in mp4.stem}


def background_indices(video: Path, count: int = 21) -> list[int]:
    cap = cv2.VideoCapture(str(video))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()
    return sorted({int(i) for i in np.linspace(0, max(0, n - 2), count)})


def _blur_plates(img: np.ndarray, boxes) -> None:
    for x1, y1, x2, y2 in boxes:
        x1, y1 = max(0, int(x1)), max(0, int(y1))
        x2, y2 = min(img.shape[1], int(x2)), min(img.shape[0], int(y2))
        if x2 - x1 > 2 and y2 - y1 > 2:
            img[y1:y2, x1:x2] = cv2.GaussianBlur(img[y1:y2, x1:x2], (0, 0), 9)


BG_CACHE = DATASET_DIR / "backgrounds"


def cached_backgrounds() -> Optional[dict[str, np.ndarray]]:
    """Real-footage medians from an earlier run (valid while the footage is unchanged)."""
    out = {}
    for cam, mp4 in footage().items():
        f = BG_CACHE / f"{cam}.png"
        if not f.exists() or f.stat().st_mtime < mp4.stat().st_mtime:
            return None
        out[cam] = cv2.imread(str(f))
    return out or None


def build_backgrounds(rng: random.Random, detector, bank: FrameBank) -> dict[str, dict[str, Any]]:
    real = cached_backgrounds() or _median_backgrounds(detector, bank)
    return _with_derived(real, rng)


def _median_backgrounds(detector, bank: FrameBank) -> dict[str, np.ndarray]:
    real: dict[str, np.ndarray] = {}
    BG_CACHE.mkdir(parents=True, exist_ok=True)
    for cam, mp4 in footage().items():
        frames = [cv2.resize(f, (W, H), interpolation=cv2.INTER_AREA)
                  for f in (bank.get(mp4, i) for i in background_indices(mp4)) if f is not None]
        if not frames:
            continue
        bg = np.median(np.stack(frames), axis=0).astype(np.uint8)
        # privacy: parked vehicles' plates in the static background are blurred
        _blur_plates(bg, [c.bbox for c in detector.detect(bg, [0, int(H * 0.35), W, H])])
        real[cam] = bg
        cv2.imwrite(str(BG_CACHE / f"{cam}.png"), bg)
    return real


def _with_derived(real: dict[str, np.ndarray], rng: random.Random) -> dict[str, dict[str, Any]]:
    if not real:
        raise SystemExit(f"[ERROR] no camera footage in {FEEDS_DIR}")
    out = {cam: {"image": img, "derived_from": None} for cam, img in real.items()}
    sources = sorted(real)
    for i, cam in enumerate(sorted(set(RoadNetwork().cameras) - set(real))):
        src = sources[i % len(sources)]
        img = cv2.flip(real[src], 1)
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.int16)
        hsv[..., 0] = (hsv[..., 0] + rng.randint(4, 12)) % 180
        hsv[..., 2] = np.clip(hsv[..., 2] * rng.uniform(0.85, 1.05), 0, 255)
        out[cam] = {"image": cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR),
                    "derived_from": f"{src} (mirrored, re-tinted)"}
    return out


@dataclass
class Sprite:
    sprite_id: str
    vehicle_class: str
    image: np.ndarray                      # BGR crop, real plate blurred
    plate_box: tuple[int, int, int, int]   # x1, y1, x2, y2 inside the crop
    source: dict[str, Any] = field(default_factory=dict)


ASPECT_RANGE = {"car": (0.7, 1.45), "truck": (0.6, 1.4), "bus": (0.6, 1.3), "motorcycle": (0.35, 0.95)}


def _overlap(det: dict, others: list[dict]) -> float:
    """Largest share of this box covered by another detection in the same frame."""
    x1, y1, x2, y2 = det["bbox"]
    area = max(1.0, (x2 - x1) * (y2 - y1))
    worst = 0.0
    for o in others:
        if o is det:
            continue
        ox1, oy1, ox2, oy2 = o["bbox"]
        iw, ih = min(x2, ox2) - max(x1, ox1), min(y2, oy2) - max(y1, oy1)
        if iw > 0 and ih > 0:
            worst = max(worst, iw * ih / area)
    return worst


def sprite_candidates(limit: int) -> list[tuple]:
    candidates = []
    for det_file in sorted(DETECTIONS_DIR.glob("CAM-*_detections.json")):
        data = json.loads(det_file.read_text(encoding="utf-8"))
        video = FEEDS_DIR / data["video"]
        if not video.exists():
            continue
        best: dict[int, tuple[float, int, dict]] = {}
        for fr in data["frames"]:
            for d in fr["detections"]:
                x1, y1, x2, y2 = d["bbox"]
                w, h = x2 - x1, y2 - y1
                if (d["class_name"] not in VEHICLE_CLASSES or d["confidence"] < 0.5 or w < 200 or h < 150
                        or x1 < 6 or y1 < 6 or x2 > 2554 or y2 > 1434):
                    continue
                lo, hi = ASPECT_RANGE[d["class_name"]]
                if not lo <= w / h <= hi:                  # front / rear views only (side views hide the plate)
                    continue
                if _overlap(d, fr["detections"]) > 0.12:   # isolated vehicles only - no neighbours in the crop
                    continue
                area = w * h
                if d["track_id"] not in best or area > best[d["track_id"]][0]:
                    best[d["track_id"]] = (area, fr["frame_index"], d)
        for tid, (area, frame_index, d) in best.items():
            candidates.append((area, data["camera_id"], video, frame_index, tid, d))
    candidates.sort(key=lambda c: -c[0])
    return candidates[: limit * 4]


SPRITE_CACHE = DATASET_DIR / "sprites"
PLATE_BAND = {"motorcycle": (0.22, 0.38, 0.78, 0.86), "default": (0.18, 0.55, 0.82, 0.97)}
PLATE_CENTRE = {"motorcycle": (0.5, 0.62), "default": (0.5, 0.8)}


def _soft_blur(img: np.ndarray, box, sigma: float = 14.0) -> None:
    """Blur a region with feathered edges (no hard rectangle)."""
    h, w = img.shape[:2]
    x1, y1, x2, y2 = (int(v) for v in box)
    mask = np.zeros((h, w), np.float32)
    mask[max(0, y1):min(h, y2), max(0, x1):min(w, x2)] = 1.0
    mask = cv2.GaussianBlur(mask, (0, 0), max(2.0, min(w, h) * 0.03))[..., None]
    blurred = cv2.GaussianBlur(img, (0, 0), sigma)
    img[:] = (img * (1 - mask) + blurred * mask).astype(np.uint8)


def _leaked_text(ocr, crop: np.ndarray) -> list[str]:
    """Readable text left on a crop after anonymisation (checked with the project's own OCR)."""
    res = ocr.recognize(crop)
    return [l["text"] for l in res.lines if sum(ch.isalnum() for ch in l["text"]) >= 4 and l["conf"] >= 0.5]


def _load_sprite_cache(limit: int, candidates: list[tuple]) -> Optional[list[Sprite]]:
    index = SPRITE_CACHE / "sprites.json"
    if not index.exists():
        return None
    entries = json.loads(index.read_text(encoding="utf-8"))
    wanted = {(c[1], c[3], c[4]) for c in candidates}
    if len(entries) < limit or any((e["source"]["camera"], e["source"]["frame"], e["source"]["track_id"]) not in wanted
                                   for e in entries[:limit]):
        return None
    return [Sprite(e["sprite_id"], e["vehicle_class"], cv2.imread(str(SPRITE_CACHE / e["file"])),
                   tuple(e["plate_box"]), e["source"]) for e in entries[:limit]]


def extract_sprites(limit: int, bank: FrameBank, candidates: list[tuple], detector=None, verify: bool = True,
                    log=print) -> list[Sprite]:
    """Isolated front/rear-view crops, anonymised: every plate-like region the Phase 2 detector finds and the
    whole band where a plate sits on such views are blurred, then (verify=True) the project's OCR must find no
    readable text left, else the crop is rejected. The synthetic plate is laid over the band centre.
    Verified crops are cached in backend/output/dataset/sprites/ (the OCR check runs once)."""
    cached = _load_sprite_cache(limit, candidates) if verify else None
    if cached:
        log(f"  vehicle crops: {len(cached)} from the verified cache")
        return cached
    ocr = None
    if verify:
        from backend.ai.ocr_engine import create_ocr_engine

        log("  loading OCR for the anonymisation check (one-time) ...")
        ocr = create_ocr_engine("paddle")
    sprites: list[Sprite] = []
    rejected = 0
    for area, cam, video, frame_index, tid, d in candidates:
        if len(sprites) >= limit:
            break
        frame = bank.get(video, frame_index)
        if frame is None:
            continue
        x1, y1, x2, y2 = (int(v) for v in d["bbox"])
        pad_x, pad_y = int((x2 - x1) * 0.04), int((y2 - y1) * 0.04)
        x1, y1 = max(0, x1 - pad_x), max(0, y1 - pad_y)
        x2, y2 = min(frame.shape[1], x2 + pad_x), min(frame.shape[0], y2 + pad_y)
        crop = frame[y1:y2, x1:x2].copy()
        ch, cw = crop.shape[:2]
        kind = "motorcycle" if d["class_name"] == "motorcycle" else "default"
        if detector is not None:
            for c in detector.detect(crop, [0, 0, cw, ch], d["class_name"]):
                _soft_blur(crop, (c.bbox[0] - 10, c.bbox[1] - 10, c.bbox[2] + 10, c.bbox[3] + 10))
        bx1, by1, bx2, by2 = PLATE_BAND[kind]
        _soft_blur(crop, (cw * bx1, ch * by1, cw * bx2, ch * by2))
        if ocr is not None and _leaked_text(ocr, crop):
            rejected += 1
            continue
        fx, fy = PLATE_CENTRE[kind]
        cx, cy = cw * fx, ch * fy
        pw = cw * (0.42 if kind == "motorcycle" else 0.3)
        ph = pw / 4.33
        box = (int(cx - pw / 2), int(cy - ph / 2), int(cx + pw / 2), int(cy + ph / 2))
        sprites.append(Sprite(f"S{len(sprites) + 1:02d}", d["class_name"], crop, box,
                              {"camera": cam, "frame": frame_index, "track_id": tid}))
    log(f"  vehicle crops: {len(sprites)} anonymised" + (f", {rejected} rejected (text still readable)" if verify else ""))
    if verify:
        SPRITE_CACHE.mkdir(parents=True, exist_ok=True)
        entries = []
        for sp in sprites:
            cv2.imwrite(str(SPRITE_CACHE / f"{sp.sprite_id}.png"), sp.image)
            entries.append({"sprite_id": sp.sprite_id, "vehicle_class": sp.vehicle_class, "file": f"{sp.sprite_id}.png",
                            "plate_box": list(sp.plate_box), "source": sp.source})
        (SPRITE_CACHE / "sprites.json").write_text(json.dumps(entries, indent=2), encoding="utf-8")
    return sprites


def dress(sprite: Sprite, plate_img: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Sprite with the synthetic plate + a feathered alpha mask (hides the crop rectangle)."""
    img = sprite.image.copy()
    x1, y1, x2, y2 = sprite.plate_box
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(img.shape[1], x2), min(img.shape[0], y2)
    img[y1:y2, x1:x2] = cv2.resize(plate_img, (x2 - x1, y2 - y1), interpolation=cv2.INTER_AREA)
    h, w = img.shape[:2]
    mask = np.zeros((h, w), np.float32)
    cv2.ellipse(mask, (w // 2, h // 2), (int(w * 0.5), int(h * 0.52)), 0, 0, 360, 1.0, -1)
    mask = cv2.GaussianBlur(mask, (0, 0), max(3, min(w, h) * 0.05))
    mask[y1:y2, x1:x2] = 1.0                    # the plate itself is never faded
    return img, mask


# ─── scenario ────────────────────────────────────────────────────────────────

@dataclass
class Vehicle:
    vehicle_id: str
    role: str
    plate: str
    commercial: bool
    sprite_id: str
    vehicle_class: str
    speed_kmh: float
    route: list[str]
    first_time: float                       # seconds from the dataset start


def plan_vehicles(n: int, sprites: list[Sprite], cameras: list[str], rng: random.Random) -> list[Vehicle]:
    roles = ["ghost", "ghost", "clone_a", "clone_b", "blacklist", "tampered"]
    roles += ["normal"] * max(0, n - len(roles))
    roles = roles[:n]
    if len(sprites) < n:
        raise SystemExit(f"[ERROR] only {len(sprites)} distinct vehicle crops for {n} vehicles - lower --vehicles")
    used_plates = {BLACKLIST_PLATE}
    vehicles: list[Vehicle] = []
    clone_plate = random_plate(rng)
    for i, role in enumerate(roles):
        sp = sprites[i]
        if role in ("clone_a", "clone_b"):
            plate = clone_plate
        elif role == "blacklist":
            plate = BLACKLIST_PLATE
        else:
            plate = random_plate(rng)
            while plate in used_plates or plate == clone_plate:
                plate = random_plate(rng)
        used_plates.add(plate)
        hops = {"ghost": 3, "clone_b": 1, "clone_a": 2}.get(role, rng.choice((2, 2, 3, 4)))
        route = rng.sample(cameras, hops)
        speed = rng.uniform(24, 48)
        first = rng.uniform(0, 900)
        if role == "clone_a":
            route = ["CAM-410", rng.choice(["CAM-406", "CAM-411"])]
        vehicles.append(Vehicle(f"V{i + 1:02d}", role, plate, rng.random() < 0.2 and role == "normal",
                                sp.sprite_id, sp.vehicle_class, round(speed, 1), route, first))
    # clone_b is a DIFFERENT vehicle with the same plate, at CAM-401 two minutes after clone_a is at CAM-410
    a = next(v for v in vehicles if v.role == "clone_a")
    b = next(v for v in vehicles if v.role == "clone_b")
    b.route, b.first_time = ["CAM-401"], a.first_time + 120.0
    return vehicles


def plan_transits(vehicles: list[Vehicle], road: RoadNetwork, rng: random.Random) -> list[dict[str, Any]]:
    transits = []
    for v in vehicles:
        t = v.first_time
        for k, cam in enumerate(v.route):
            if k:
                km = road.distance_km(v.route[k - 1], cam) or 5.0
                t += km / v.speed_kmh * 3600 + rng.uniform(-10, 10)
            if v.role == "ghost":
                condition = "clean" if k == 0 else "glare"
            elif v.role == "tampered":
                condition = "tampered"
            else:
                condition = "clean"
            transits.append({"vehicle_id": v.vehicle_id, "camera_id": cam, "t_best": t, "condition": condition})
    transits.sort(key=lambda r: (r["camera_id"], r["t_best"]))
    for i, tr in enumerate(transits):
        tr["transit_id"] = f"T{i + 1:03d}"
    return transits


def geometry(u: float, lane: float, sprite: Sprite) -> tuple[int, int, int, int]:
    """Vehicle box at progress u (0 = far, 1 = closest, >1 = leaving the frame)."""
    scale = 0.34 + 0.66 * min(u, 1.08)
    bottom = H * (0.56 + 0.42 * u)
    w = BASE_WIDTH[sprite.vehicle_class] * scale
    h = w * sprite.image.shape[0] / sprite.image.shape[1]
    cx = W * lane
    return int(cx - w / 2), int(bottom - h), int(cx + w / 2), int(bottom)


def composite(frame: np.ndarray, img: np.ndarray, mask: np.ndarray, box: tuple[int, int, int, int]) -> None:
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    if w < 4 or h < 4:
        return
    spr = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA if w < img.shape[1] else cv2.INTER_LINEAR)
    m = cv2.resize(mask, (w, h))[..., None]
    fx1, fy1, fx2, fy2 = max(0, x1), max(0, y1), min(W, x2), min(H, y2)
    if fx2 <= fx1 or fy2 <= fy1:
        return
    sx1, sy1 = fx1 - x1, fy1 - y1
    sub = spr[sy1:sy1 + (fy2 - fy1), sx1:sx1 + (fx2 - fx1)].astype(np.float32)
    a = m[sy1:sy1 + (fy2 - fy1), sx1:sx1 + (fx2 - fx1)]
    roi = frame[fy1:fy2, fx1:fx2].astype(np.float32)
    frame[fy1:fy2, fx1:fx2] = (roi * (1 - a) + sub * a).astype(np.uint8)


# ─── main ────────────────────────────────────────────────────────────────────

def generate(out_dir: Path = DATASET_DIR, n_vehicles: int = 16, seed: int = 26127, start: str = DEFAULT_START,
             write_video: bool = True, log=print, verify: bool = True) -> dict[str, Any]:
    import imageio_ffmpeg

    from backend.ai.plate_detector import create_plate_detector
    from backend.anpr.config import ANPRConfig

    rng = random.Random(seed)
    detector = create_plate_detector(ANPRConfig())
    road = RoadNetwork()
    cameras = sorted(road.cameras)
    t0 = datetime.fromisoformat(start)

    limit = max(n_vehicles + 4, 20)
    candidates = sprite_candidates(limit)
    bank = FrameBank()
    if cached_backgrounds() is None:
        for mp4 in footage().values():
            bank.want(mp4, background_indices(mp4))
    if not verify or _load_sprite_cache(limit, candidates) is None:
        for c in candidates:
            bank.want(c[2], [c[3]])
    if bank.wanted:
        log("  decoding the real footage (one pass per camera) ...")
        bank.load()
    log("  backgrounds (temporal median of the real footage) + vehicle crops (Phase 1 YOLO11 detections) ...")
    backgrounds = build_backgrounds(rng, detector, bank)
    sprites = extract_sprites(limit, bank, candidates, detector, verify=verify, log=log)
    rng.shuffle(sprites)
    by_sprite = {s.sprite_id: s for s in sprites}
    vehicles = plan_vehicles(n_vehicles, sprites, cameras, rng)
    by_vehicle = {v.vehicle_id: v for v in vehicles}
    transits = plan_transits(vehicles, road, rng)

    dressed: dict[tuple[str, str], tuple[np.ndarray, np.ndarray, str]] = {}
    for tr in transits:
        v = by_vehicle[tr["vehicle_id"]]
        key = (v.vehicle_id, tr["condition"])
        if key not in dressed:
            text = tamper(v.plate, random.Random(f"{seed}:{v.vehicle_id}")) if tr["condition"] == "tampered" else v.plate
            img, mask = dress(by_sprite[v.sprite_id], render_plate(text, v.commercial, tr["condition"], rng))
            dressed[key] = (img, mask, text)

    (out_dir / "videos").mkdir(parents=True, exist_ok=True)
    (out_dir / "crops").mkdir(parents=True, exist_ok=True)
    segments_out: dict[str, list[dict[str, Any]]] = {}
    visible = TRANSIT_SECONDS + EXIT_SECONDS
    for cam in cameras:
        cam_tr = [t for t in transits if t["camera_id"] == cam]
        if not cam_tr:
            continue
        for t in cam_tr:
            t["t_enter"] = t["t_best"] - BEST_U * TRANSIT_SECONDS
        # lanes: concurrent vehicles never share one
        for t in cam_tr:
            busy = {o["lane"] for o in cam_tr if "lane" in o and o["t_enter"] < t["t_enter"] + visible
                    and t["t_enter"] < o["t_enter"] + visible}
            free = [lane for lane in LANES if lane not in busy] or list(LANES)
            t["lane"] = rng.choice(free)
        windows = sorted((t["t_enter"] - SEGMENT_PAD, t["t_enter"] + visible + SEGMENT_PAD) for t in cam_tr)
        merged: list[list[float]] = []
        for a, b in windows:
            if merged and a <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], b)
            else:
                merged.append([a, b])
        segs, vt = [], 0.0
        for a, b in merged:
            segs.append({"video_start": round(vt, 3), "video_end": round(vt + (b - a), 3),
                         "wall_start": (t0 + timedelta(seconds=a)).isoformat()})
            vt += b - a
        segments_out[cam] = segs
        bg = backgrounds[cam]["image"]

        writer = None
        if write_video:
            writer = imageio_ffmpeg.write_frames(str(out_dir / "videos" / f"{cam}.mp4"), (W, H), fps=FPS,
                                                 codec="libx264", pix_fmt_in="bgr24", quality=None,
                                                 output_params=["-crf", "20", "-preset", "veryfast", "-g", str(FPS)],
                                                 macro_block_size=8)
            writer.send(None)
        best_frames = {}
        for t in cam_tr:
            seg = next(s for s, (a, b) in zip(segs, merged) if a <= t["t_enter"] - SEGMENT_PAD + 1e-6 and t["t_enter"] + visible <= b + 1e-6)
            a = merged[segs.index(seg)][0]
            t["video_best"] = round(seg["video_start"] + (t["t_best"] - a), 3)
            best_frames[int(round(t["video_best"] * FPS))] = t
            v = by_vehicle[t["vehicle_id"]]
            t["bbox_best"] = list(geometry(BEST_U, t["lane"], by_sprite[v.sprite_id]))
        n_frames = int(round(vt * FPS))
        for f in range(n_frames):
            video_t = f / FPS
            si = max(i for i, s in enumerate(segs) if s["video_start"] <= video_t + 1e-9)
            wall = merged[si][0] + (video_t - segs[si]["video_start"])
            if writer is None and f not in best_frames:
                continue                            # --no-video: only the ground-truth frames are rendered
            active = [t for t in cam_tr if t["t_enter"] <= wall < t["t_enter"] + visible]
            if not active and f not in best_frames:
                if writer is not None:
                    writer.send(bg.tobytes())
                continue
            frame = bg.copy()
            draw = []
            for t in active:
                u = (wall - t["t_enter"]) / TRANSIT_SECONDS
                v = by_vehicle[t["vehicle_id"]]
                img, mask, _ = dressed[(v.vehicle_id, t["condition"])]
                box = geometry(u, t["lane"], by_sprite[v.sprite_id])
                draw.append((box[3], img, mask, box))
            for _, img, mask, box in sorted(draw, key=lambda d: d[0]):          # far vehicles first
                composite(frame, img, mask, box)
            if f in best_frames:
                t = best_frames[f]
                x1, y1, x2, y2 = t["bbox_best"]
                cv2.imwrite(str(out_dir / "crops" / f"{t['transit_id']}.png"),
                            frame[max(0, y1):min(H, y2), max(0, x1):min(W, x2)])
            if writer is not None:
                writer.send(frame.tobytes())
        if writer is not None:
            writer.close()
        log(f"  {cam}: {len(cam_tr)} transits, {len(segs)} segment(s), {vt:.0f} s of video")

    gt_transits = []
    for t in sorted(transits, key=lambda r: r["t_best"]):
        v = by_vehicle[t["vehicle_id"]]
        text = dressed[(v.vehicle_id, t["condition"])][2]
        gt_transits.append({
            "transit_id": t["transit_id"], "vehicle_id": v.vehicle_id, "camera_id": t["camera_id"],
            "timestamp": (t0 + timedelta(seconds=t["t_best"])).isoformat(),
            "window": [(t0 + timedelta(seconds=t["t_enter"])).isoformat(),
                       (t0 + timedelta(seconds=t["t_enter"] + visible)).isoformat()],
            "video": f"videos/{t['camera_id']}.mp4", "video_time": t["video_best"],
            "bbox": t["bbox_best"], "lane": t["lane"], "crop": f"crops/{t['transit_id']}.png",
            "plate_condition": t["condition"], "plate_printed": text,
            "expected_plate": v.plate if t["condition"] == "clean" else None,
            "expected_flag": {"clean": "VALID", "glare": "NO_PLATE_DETECTED", "tampered": "INVALID_FORMAT"}[t["condition"]],
        })
    clone_plate = next(v.plate for v in vehicles if v.role == "clone_a")
    gt = {
        "dataset": "tracenet-synthetic-v1", "seed": seed, "generated_at": datetime.now(timezone.utc).isoformat(),
        "start_time": start, "resolution": [W, H], "fps": FPS,
        "method": "programmatic compositing of real vehicle crops over real-footage backgrounds (plan 4C)",
        "cameras": {c: {"name": road.cameras[c].get("name"), "video": f"videos/{c}.mp4" if c in segments_out else None,
                        "background_from": backgrounds[c]["derived_from"] or f"{c} footage (temporal median)",
                        "segments": segments_out.get(c, [])} for c in cameras},
        "vehicles": [{**asdict(v), "first_time": round(v.first_time, 2),
                      "sprite_source": by_sprite[v.sprite_id].source} for v in vehicles],
        "transits": gt_transits,
        "expected_alerts": {
            "CLONED_PLATE": [clone_plate],
            "BLACKLIST_HIT": [BLACKLIST_PLATE] if any(v.role == "blacklist" for v in vehicles) else [],
            "INVALID_FORMAT": [t["transit_id"] for t in gt_transits if t["expected_flag"] == "INVALID_FORMAT"],
        },
    }
    (out_dir / "ground_truth.json").write_text(json.dumps(gt, indent=2), encoding="utf-8")
    return gt


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Generate the synthetic multi-camera ANPR dataset (plan 4C)")
    p.add_argument("--vehicles", type=int, default=16)
    p.add_argument("--seed", type=int, default=26127)
    p.add_argument("--start", default=DEFAULT_START, help="wall-clock time of the dataset start (ISO)")
    p.add_argument("--out", default=str(DATASET_DIR))
    p.add_argument("--no-video", action="store_true", help="ground truth + crops only (fast)")
    p.add_argument("--no-verify", action="store_true",
                   help="skip the OCR check that no real registration is readable on the vehicle crops")
    args = p.parse_args(argv)
    print("TraceNet synthetic dataset")
    gt = generate(Path(args.out), args.vehicles, args.seed, args.start, write_video=not args.no_video,
                  verify=not args.no_verify)
    roles = {}
    for v in gt["vehicles"]:
        roles[v["role"]] = roles.get(v["role"], 0) + 1
    print(f"  vehicles: {len(gt['vehicles'])} {roles}")
    print(f"  transits: {len(gt['transits'])} across {sum(1 for c in gt['cameras'].values() if c['video'])} cameras")
    print(f"  expected alerts: {gt['expected_alerts']}")
    print(f"  ground truth: {Path(args.out) / 'ground_truth.json'}")
    print("  next: python backend/scripts/evaluate_dataset.py   (add --e2e to run YOLO + ANPR on the videos)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
