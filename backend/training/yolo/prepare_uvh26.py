#!/usr/bin/env python3
"""
TraceNet — build a YOLO-format regional detection dataset from IISc UVH-26 (+ optionally your own cameras).

    python backend/training/yolo/prepare_uvh26.py                        # 3000 train + 600 val images
    python backend/training/yolo/prepare_uvh26.py --train 21000 --val 5000   # the full dataset (~80 GB PNG)
    python backend/training/yolo/prepare_uvh26.py --extra-coco my.json --extra-images my_frames/

* Source: https://huggingface.co/datasets/iisc-aim/UVH-26 (CC-BY-4.0; cite arXiv:2511.02563). COCO boxes for
  14 Indian vehicle classes; majority-vote (mv, default) or STAPLE (st) consensus.
* Sampling favours scarce / hard classes: images containing Two-wheelers, Three-wheelers, bicycles, LCVs and
  mini-buses are taken first (--priority), then the rest at random. The class histogram is printed.
* Images are stored as JPEG (quality 92; the source PNGs are ~3 MB each) under
  backend/training/yolo/datasets/uvh26/images/{train,val}, labels as YOLO txt next to them, and a ready
  data yaml is written to datasets/uvh26/uvh26.yaml.
* --extra-coco / --extra-images add your own annotated frames (COCO json whose category names match the 14
  UVH-26 names, case-insensitive) to the training split - the "custom regional data" step.
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import cv2

HERE = Path(__file__).resolve().parent
REPO_ID = "iisc-aim/UVH-26"
NAMES = ["Hatchback", "Sedan", "SUV", "MUV", "Bus", "Truck", "Three-wheeler", "Two-wheeler", "LCV", "Mini-bus",
         "Tempo-traveller", "Bicycle", "Van", "Others"]
NAME_TO_ID = {n.lower(): i for i, n in enumerate(NAMES)}
DEFAULT_PRIORITY = ["Two-wheeler", "Three-wheeler", "Bicycle", "LCV", "Mini-bus", "Tempo-traveller"]


def use_system_certificates() -> bool:
    """Trust the Windows/macOS certificate store (needed when antivirus or a network gateway re-signs TLS -
    Python's certifi bundle then reports 'self-signed certificate in certificate chain')."""
    try:
        import truststore

        truststore.inject_into_ssl()
        return True
    except ImportError:
        return False


def retry(fn, *a, attempts=6, **kw):
    """Hub calls with backoff. After a TLS/connection error huggingface_hub closes its shared HTTP client,
    so the session is reset before every retry."""
    from huggingface_hub.utils import close_session

    for i in range(attempts):
        try:
            return fn(*a, **kw)
        except Exception as exc:
            if i == attempts - 1:
                raise
            print(f"  hub request failed ({type(exc).__name__}: {str(exc)[:70]}) - retry in {2 ** i} s")
            close_session()
            time.sleep(2 ** i)


def download_files(repo_paths: list[str], raw: Path, workers: int) -> None:
    """Download exactly these files. snapshot_download silently returns the local folder when the Hub is
    unreachable, so every file is checked and missing ones make the attempt fail (and retry)."""
    from huggingface_hub import snapshot_download

    from huggingface_hub import hf_hub_download
    from huggingface_hub.utils import close_session

    missing = [f for f in repo_paths if not (raw / f).exists()]
    if missing:
        try:                                            # fast path: parallel
            snapshot_download(REPO_ID, repo_type="dataset", allow_patterns=missing, local_dir=str(raw), max_workers=workers)
        except Exception as exc:
            print(f"  parallel download interrupted ({type(exc).__name__}) - continuing file by file")
            close_session()
    # a TLS/connection error resets huggingface_hub's shared client under the other download threads, so
    # whatever is still missing is fetched one file at a time, each with its own retries
    still = [f for f in repo_paths if not (raw / f).exists()]
    for i, f in enumerate(still, 1):
        retry(hf_hub_download, REPO_ID, f, repo_type="dataset", local_dir=str(raw))
        if i % 50 == 0:
            print(f"  sequential download {i}/{len(still)}")
    lost = [f for f in repo_paths if not (raw / f).exists()]
    if lost:
        raise RuntimeError(f"{len(lost)} of {len(repo_paths)} files could not be downloaded (first: {lost[0]})")


def load_coco(path: Path) -> tuple[dict[str, tuple[int, int]], dict[str, list[tuple[int, list[float]]]]]:
    """file_name → (w, h); file_name → [(class id, [x, y, w, h])] with categories mapped by name."""
    coco = json.loads(path.read_text(encoding="utf-8"))
    cat = {}
    for c in coco["categories"]:
        cid = NAME_TO_ID.get(c["name"].strip().lower())
        if cid is None:
            print(f"  skipping unknown category {c['name']!r}")
        cat[c["id"]] = cid
    images = {im["id"]: im for im in coco["images"]}
    sizes = {im["file_name"]: (im["width"], im["height"]) for im in coco["images"]}
    anns: dict[str, list] = defaultdict(list)
    for a in coco["annotations"]:
        cid = cat.get(a["category_id"])
        if cid is not None and a["bbox"][2] > 1 and a["bbox"][3] > 1:
            anns[images[a["image_id"]]["file_name"]].append((cid, a["bbox"]))
    return sizes, anns


def choose(files: list[str], anns: dict, n: int, priority: list[str], rng: random.Random) -> list[str]:
    pri_ids = {NAME_TO_ID[p.lower()] for p in priority}
    pri = [f for f in files if any(c in pri_ids for c, _ in anns.get(f, []))]
    rest = [f for f in files if f not in set(pri)]
    rng.shuffle(pri)
    rng.shuffle(rest)
    # at most 70 % priority images, so common classes stay represented
    k = min(len(pri), int(n * 0.7))
    return (pri[:k] + rest[: n - k])[:n] if n < len(files) else files


def yolo_lines(boxes, w: int, h: int) -> list[str]:
    out = []
    for cid, (x, y, bw, bh) in boxes:
        x1, y1 = max(0.0, x), max(0.0, y)
        x2, y2 = min(float(w), x + bw), min(float(h), y + bh)
        if x2 - x1 < 1 or y2 - y1 < 1:
            continue
        out.append(f"{cid} {(x1 + x2) / 2 / w:.6f} {(y1 + y2) / 2 / h:.6f} {(x2 - x1) / w:.6f} {(y2 - y1) / h:.6f}")
    return out


def export(src: Path, dst_img: Path, dst_lbl: Path, boxes, size, quality: int) -> bool:
    img = cv2.imread(str(src))
    if img is None:
        return False
    h, w = img.shape[:2]
    cv2.imwrite(str(dst_img), img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    dst_lbl.write_text("\n".join(yolo_lines(boxes, w, h)) + "\n", encoding="utf-8")
    return True


def uvh_split(split: str, n: int, variant: str, raw: Path, out: Path, priority, rng, quality, workers) -> Counter:
    from huggingface_hub import HfApi, hf_hub_download

    s = split.capitalize()
    coco_path = Path(retry(hf_hub_download, REPO_ID, f"UVH-26-{s}/UVH-26-{variant.upper()}-{s}.json",
                           repo_type="dataset", local_dir=str(raw)))
    sizes, anns = load_coco(coco_path)
    api = HfApi()
    folders = [p.path for p in retry(lambda: list(api.list_repo_tree(REPO_ID, path_in_repo=f"UVH-26-{s}/data", repo_type="dataset")))]
    where = {}
    for folder in folders:
        for p in retry(lambda: list(api.list_repo_tree(REPO_ID, path_in_repo=folder, repo_type="dataset"))):
            where[p.path.split("/")[-1]] = p.path
    files = sorted(f for f in sizes if f in where)
    chosen = choose(files, anns, n, priority, rng)
    print(f"  {split}: {len(chosen)} of {len(files)} images (~{len(chosen) * 3.2 / 1000:.1f} GB download)")
    download_files([where[f] for f in chosen], raw, workers)
    (out / "images" / split).mkdir(parents=True, exist_ok=True)
    (out / "labels" / split).mkdir(parents=True, exist_ok=True)
    hist = Counter()
    for f in chosen:
        stem = Path(f).stem
        if export(raw / where[f], out / "images" / split / f"{stem}.jpg", out / "labels" / split / f"{stem}.txt",
                  anns.get(f, []), sizes[f], quality):
            hist.update(NAMES[c] for c, _ in anns.get(f, []))
    return hist


def extra_split(coco: Path, images: Path, out: Path, quality: int) -> Counter:
    sizes, anns = load_coco(coco)
    hist = Counter()
    for f in sizes:
        src = images / f
        if not src.exists():
            continue
        stem = f"custom_{Path(f).stem}"
        if export(src, out / "images" / "train" / f"{stem}.jpg", out / "labels" / "train" / f"{stem}.txt",
                  anns.get(f, []), sizes[f], quality):
            hist.update(NAMES[c] for c, _ in anns.get(f, []))
    return hist


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--train", type=int, default=3000, help="training images from UVH-26-Train")
    p.add_argument("--val", type=int, default=600, help="validation images from UVH-26-Val")
    p.add_argument("--variant", choices=["mv", "st"], default="mv")
    p.add_argument("--priority", nargs="*", default=DEFAULT_PRIORITY, help="classes whose images are sampled first")
    p.add_argument("--out", default=str(HERE / "datasets" / "uvh26"))
    p.add_argument("--raw", default=str(HERE / "datasets" / "_uvh26_raw"), help="download cache (deleted with --clean-raw)")
    p.add_argument("--extra-coco", help="your own COCO annotations (UVH-26 class names)")
    p.add_argument("--extra-images", help="folder with the images referenced by --extra-coco")
    p.add_argument("--jpeg-quality", type=int, default=92)
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--clean-raw", action="store_true", help="delete the downloaded PNGs after conversion")
    p.add_argument("--system-certs", action="store_true", help="use the OS certificate store (pip install truststore)")
    args = p.parse_args(argv)
    if args.system_certs and not use_system_certificates():
        print("  --system-certs needs `pip install truststore` - continuing with certifi")

    out, raw = Path(args.out), Path(args.raw)
    rng = random.Random(args.seed)
    print(f"UVH-26 → YOLO dataset at {out}")
    hists = {}
    if args.train:
        hists["train"] = uvh_split("train", args.train, args.variant, raw, out, args.priority, rng, args.jpeg_quality, args.workers)
    if args.val:
        hists["val"] = uvh_split("val", args.val, args.variant, raw, out, args.priority, rng, args.jpeg_quality, args.workers)
    if args.extra_coco:
        if not args.extra_images:
            p.error("--extra-coco needs --extra-images")
        hists["custom (train)"] = extra_split(Path(args.extra_coco), Path(args.extra_images), out, args.jpeg_quality)

    yaml_text = (HERE / "uvh26.yaml").read_text(encoding="utf-8").replace("path: datasets/uvh26", f"path: {out.as_posix()}")
    (out / "uvh26.yaml").write_text(yaml_text, encoding="utf-8")
    for split, h in hists.items():
        total = sum(h.values())
        print(f"  {split:15s} boxes {total:6d} | " + " · ".join(f"{n} {h.get(n, 0)}" for n in NAMES if h.get(n)))
    if args.clean_raw:
        shutil.rmtree(raw, ignore_errors=True)
    print(f"  data yaml: {out / 'uvh26.yaml'}")
    print(f"  next: python backend/training/yolo/train_regional.py --data {out / 'uvh26.yaml'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
