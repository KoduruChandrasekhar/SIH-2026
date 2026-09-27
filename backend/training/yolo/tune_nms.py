#!/usr/bin/env python3
"""
TraceNet — choose the detector's confidence and NMS IoU thresholds on a labelled val split.

    python backend/training/yolo/tune_nms.py --model backend/models/uvh26_yolo11s.pt \
        --data backend/training/yolo/datasets/uvh26/uvh26.yaml --max-images 300

Predictions are computed once per NMS IoU at a low confidence, then every confidence threshold is scored by
filtering them - so the sweep costs (#iou values x #images) inferences, not (#iou x #conf x #images).
Scoring matches predictions to ground truth one-to-one at IoU >= 0.5 over the classes TraceNet tracks
(Bicycle / Others excluded), class-agnostic and per class. The pick maximises recall on the focus classes
(default Two-wheeler + Three-wheeler) subject to a minimum overall precision, and is printed as the
VehicleTracker settings to use.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
EXCLUDED = {"bicycle", "others"}


def iou_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)))
    x1 = np.maximum(a[:, None, 0], b[None, :, 0])
    y1 = np.maximum(a[:, None, 1], b[None, :, 1])
    x2 = np.minimum(a[:, None, 2], b[None, :, 2])
    y2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area = lambda r: (r[:, 2] - r[:, 0]) * (r[:, 3] - r[:, 1])
    return inter / (area(a)[:, None] + area(b)[None, :] - inter + 1e-9)


def greedy_match(pred: np.ndarray, gt: np.ndarray, thr: float = 0.5) -> tuple[int, np.ndarray]:
    m = iou_matrix(pred, gt)
    matched_gt = np.zeros(len(gt), bool)
    used = np.zeros(len(pred), bool)
    for flat in np.argsort(-m, axis=None):
        i, j = np.unravel_index(flat, m.shape)
        if m[i, j] < thr:
            break
        if not used[i] and not matched_gt[j]:
            used[i] = matched_gt[j] = True
    return int(used.sum()), matched_gt


def load_split(data_yaml: Path, max_images: int):
    import yaml

    data = yaml.safe_load(data_yaml.read_text(encoding="utf-8"))
    names = data["names"] if isinstance(data["names"], dict) else dict(enumerate(data["names"]))
    root = Path(data.get("path", data_yaml.parent))
    img_dir = root / data["val"]
    lbl_dir = Path(str(img_dir).replace("images", "labels"))
    images = sorted(p for p in img_dir.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))[:max_images]
    return names, images, lbl_dir


def read_gt(label: Path, w: int, h: int, keep: set[int]):
    boxes, classes = [], []
    if label.exists():
        for line in label.read_text(encoding="utf-8").split("\n"):
            parts = line.split()
            if len(parts) != 5 or int(parts[0]) not in keep:
                continue
            c, cx, cy, bw, bh = int(parts[0]), *map(float, parts[1:])
            boxes.append([(cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h])
            classes.append(c)
    return np.array(boxes, float).reshape(-1, 4), np.array(classes, int)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Sweep detector confidence x NMS IoU on a labelled val split")
    p.add_argument("--model", required=True)
    p.add_argument("--data", required=True)
    p.add_argument("--max-images", type=int, default=300)
    p.add_argument("--imgsz", type=int, default=None)
    p.add_argument("--ious", type=float, nargs="*", default=[0.5, 0.6, 0.7, 0.8])
    p.add_argument("--confs", type=float, nargs="*", default=[0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5])
    p.add_argument("--focus", nargs="*", default=["Two-wheeler", "Three-wheeler"])
    p.add_argument("--min-precision", type=float, default=0.75)
    p.add_argument("--device", default=None)
    p.add_argument("--out", default=str(HERE / "runs" / "nms_sweep.json"))
    args = p.parse_args(argv)

    import cv2
    from ultralytics import YOLO

    names, images, lbl_dir = load_split(Path(args.data), args.max_images)
    keep = {i for i, n in names.items() if str(n).lower() not in EXCLUDED}
    focus = {i for i, n in names.items() if str(n).lower() in {f.lower() for f in args.focus}}
    model = YOLO(args.model)
    gts = []
    for img in images:
        im = cv2.imread(str(img))
        gts.append(read_gt(lbl_dir / f"{img.stem}.txt", im.shape[1], im.shape[0], keep))
    print(f"{len(images)} val images, {sum(len(g[0]) for g in gts)} ground-truth boxes; focus: {[names[c] for c in focus]}")

    rows = []
    for iou in args.ious:
        preds = []
        for img in images:
            kwargs = {"imgsz": args.imgsz} if args.imgsz else {}
            r = model.predict(str(img), conf=min(args.confs), iou=iou, classes=sorted(keep), verbose=False,
                              device=args.device, **kwargs)[0]
            preds.append((r.boxes.xyxy.cpu().numpy(), r.boxes.conf.cpu().numpy(), r.boxes.cls.cpu().numpy().astype(int)))
        for conf in args.confs:
            tp = n_pred = n_gt = 0
            per = defaultdict(lambda: [0, 0])
            for (pb, pc, pk), (gb, gk) in zip(preds, gts):
                sel = pc >= conf
                t, matched = greedy_match(pb[sel], gb)
                tp, n_pred, n_gt = tp + t, n_pred + int(sel.sum()), n_gt + len(gb)
                for c, m in zip(gk, matched):
                    per[int(c)][0] += int(m)
                    per[int(c)][1] += 1
            focus_hit = sum(per[c][0] for c in focus)
            focus_n = sum(per[c][1] for c in focus)
            rows.append({"iou": iou, "conf": conf, "precision": tp / n_pred if n_pred else 0.0,
                         "recall": tp / n_gt if n_gt else 0.0, "focus_recall": focus_hit / focus_n if focus_n else 0.0,
                         "per_class_recall": {names[c]: round(h / n, 4) for c, (h, n) in per.items() if n}})
        print(f"  iou {iou:.2f} done")

    ok = [r for r in rows if r["precision"] >= args.min_precision] or rows
    best = max(ok, key=lambda r: (r["focus_recall"], r["recall"], r["precision"]))
    print(f"\n{'iou':>5} {'conf':>5} {'P':>6} {'R':>6} {'focusR':>7}")
    for r in rows:
        mark = "  <- pick" if r is best else ""
        print(f"{r['iou']:5.2f} {r['conf']:5.2f} {r['precision']:6.3f} {r['recall']:6.3f} {r['focus_recall']:7.3f}{mark}")
    print(f"\nVehicleTracker(model_path={args.model!r}, confidence={best['conf']}, iou={best['iou']}"
          + (f", imgsz={args.imgsz}" if args.imgsz else "") + ")")
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps({"model": args.model, "images": len(images), "best": best, "grid": rows}, indent=2),
                              encoding="utf-8")
    print(f"sweep: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
