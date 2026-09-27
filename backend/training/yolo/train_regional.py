#!/usr/bin/env python3
"""
TraceNet — fine-tune the vehicle detector on regional (Indian) traffic, weighted towards two-wheelers and
auto-rickshaws.

    python backend/training/yolo/train_regional.py --data backend/training/yolo/datasets/uvh26/uvh26.yaml
    python backend/training/yolo/train_regional.py --data ... --p2 --imgsz 1280          # small-object head
    python backend/training/yolo/train_regional.py --data ... --class-weights Two-wheeler=3 Three-wheeler=3

Start point (--model): backend/models/uvh26_yolo11s.pt, the IISc UVH-26 YOLOv11-S (Apache-2.0) - already
trained on 21k Indian frames, so your own camera data only has to adapt it (use yolo11s.pt to start from COCO).

How each recall lever is implemented
* Class weighting - ultralytics YOLO11 has no per-class loss weight (the YOLOv5 `cls_pw` is gone), so weighting
  is done where it works for detection: sampling. `WeightedYOLODataset` draws training images with probability
  ∝ the largest weight among the classes in the image (explicit --class-weights, or --balance for LVIS-style
  repeat-factor weights r(c) = max(1, sqrt(t / f(c))) from the label frequencies f(c)).
* Anchors - YOLO11 is anchor-free (per-pixel box regression with DFL), so there are no anchor scales to edit.
  The equivalent for small vehicles is resolution: --p2 adds a stride-4 detection head (yolo11-p2.yaml) and
  --imgsz 960/1280 keeps a far-away scooter above ~8 px on the P3 grid.
* NMS - training does not use NMS thresholds; tune them afterwards on the val split with tune_nms.py and put
  the result into the tracker (VehicleTracker(confidence=…, iou=…, imgsz=…)).
* Augmentation for dense traffic: mosaic on (multiplies small instances per batch, closed for the last 10
  epochs), scale 0.5, no vertical flip / rotation (cameras are upright), mild HSV for dusk and glare.

GPU is strongly recommended (a 3000-image run is ~1 h on one RTX-class GPU at imgsz 960; CPU is for smoke tests).
"""

from __future__ import annotations

import argparse
import math
import sys
from collections import Counter
from pathlib import Path
from typing import Optional

import numpy as np

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
DEFAULT_MODEL = REPO_ROOT / "backend" / "models" / "uvh26_yolo11s.pt"


# ─── class-weighted sampling ─────────────────────────────────────────────────

def image_weights(labels: list[dict], nc: int, class_weights: Optional[dict[int, float]] = None,
                  balance: bool = False) -> np.ndarray:
    """Per-image sampling weight = max weight of the classes it contains (1.0 for background images)."""
    if balance:
        freq = Counter()
        for lb in labels:
            freq.update(set(int(c) for c in lb["cls"].reshape(-1)))
        n_img = max(len(labels), 1)
        t = 0.1 if not freq else max(0.01, np.median([freq[c] / n_img for c in freq]))
        rf = {c: max(1.0, math.sqrt(t / (freq[c] / n_img))) for c in freq}
        class_weights = {**rf, **(class_weights or {})}
    class_weights = class_weights or {}
    w = np.ones(len(labels), dtype=np.float64)
    for i, lb in enumerate(labels):
        cls = lb["cls"].reshape(-1)
        if len(cls):
            w[i] = max(class_weights.get(int(c), 1.0) for c in cls)
    return w


def make_weighted_dataset_class():
    from ultralytics.data.dataset import YOLODataset

    class WeightedYOLODataset(YOLODataset):
        """YOLODataset that samples training images by class weight (validation stays deterministic)."""

        def __init__(self, *args, class_weights=None, balance=False, **kwargs):
            super().__init__(*args, **kwargs)
            self.sampling_weights = None
            if self.augment and (class_weights or balance):
                w = image_weights(self.labels, len(self.data["names"]), class_weights, balance)
                self.sampling_weights = w / w.sum()
                exp = Counter()
                for lb, p in zip(self.labels, self.sampling_weights):
                    for c in lb["cls"].reshape(-1):
                        exp[int(c)] += p * len(self.labels)
                names = self.data["names"]
                print("  class-weighted sampling - expected instances per epoch vs dataset:")
                raw = Counter(int(c) for lb in self.labels for c in lb["cls"].reshape(-1))
                for c in sorted(raw, key=lambda c: -raw[c]):
                    print(f"    {names[c]:<16} {raw[c]:>7} -> {exp[c]:>9.0f}")

        def __getitem__(self, index):
            if self.sampling_weights is not None:
                index = int(np.random.choice(len(self.labels), p=self.sampling_weights))
            return self.transforms(self.get_image_and_label(index))

    return WeightedYOLODataset


def make_trainer_class(class_weights: Optional[dict[int, float]], balance: bool):
    from ultralytics.data.build import build_yolo_dataset
    from ultralytics.models.yolo.detect import DetectionTrainer
    from ultralytics.utils import colorstr
    from ultralytics.utils.torch_utils import unwrap_model

    Weighted = make_weighted_dataset_class()

    class RegionalTrainer(DetectionTrainer):
        def build_dataset(self, img_path, mode="train", batch=None):
            gs = max(int(unwrap_model(self.model).stride.max()), 32)
            if mode != "train" or not (class_weights or balance):
                return build_yolo_dataset(self.args, img_path, batch, self.data, mode=mode, rect=mode == "val", stride=gs)
            return Weighted(img_path=img_path, imgsz=self.args.imgsz, batch_size=batch, augment=True, hyp=self.args,
                            rect=False, cache=self.args.cache or None, single_cls=self.args.single_cls or False,
                            stride=gs, pad=0.0, prefix=colorstr("train: "), task=self.args.task,
                            classes=self.args.classes, data=self.data, fraction=self.args.fraction,
                            class_weights=class_weights, balance=balance)

    return RegionalTrainer


# ─── CLI ─────────────────────────────────────────────────────────────────────

def parse_class_weights(items: list[str], names: dict[int, str]) -> dict[int, float]:
    by_name = {n.lower(): i for i, n in names.items()}
    out = {}
    for item in items or []:
        name, _, value = item.partition("=")
        cid = by_name.get(name.strip().lower())
        if cid is None:
            raise SystemExit(f"[ERROR] unknown class {name!r}; classes: {', '.join(names.values())}")
        out[cid] = float(value)
    return out


def build_model(args):
    from ultralytics import YOLO

    if not args.p2:
        return YOLO(args.model)
    scale = args.scale
    cfg = HERE / f"yolo11{scale}-p2.yaml"            # ultralytics reads the scale letter from the file name
    cfg.write_text((HERE / "yolo11-p2.yaml").read_text(encoding="utf-8"), encoding="utf-8")
    model = YOLO(str(cfg))
    if args.model:
        model.load(args.model)                        # transfers every layer whose name and shape match
    return model


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Fine-tune YOLO11 on regional traffic (TraceNet)")
    p.add_argument("--data", required=True, help="data yaml (prepare_uvh26.py writes datasets/uvh26/uvh26.yaml)")
    p.add_argument("--model", default=str(DEFAULT_MODEL if DEFAULT_MODEL.exists() else "yolo11s.pt"))
    p.add_argument("--p2", action="store_true", help="add the stride-4 small-object head (yolo11-p2.yaml)")
    p.add_argument("--scale", default="s", choices=list("nsmlx"), help="model scale for --p2")
    p.add_argument("--epochs", type=int, default=60)
    p.add_argument("--imgsz", type=int, default=960)
    p.add_argument("--batch", type=int, default=16, help="-1 = auto batch for the GPU memory")
    p.add_argument("--device", default=None, help="0 | 0,1 | cpu (default: GPU when available)")
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--class-weights", nargs="*", default=["Two-wheeler=2.5", "Three-wheeler=2.5", "Bicycle=1.5"],
                   help="Name=weight sampling weights (default favours two- and three-wheelers); '' to disable")
    p.add_argument("--balance", action="store_true", help="add LVIS repeat-factor weights from label frequencies")
    p.add_argument("--freeze", type=int, default=0, help="freeze the first N layers (10 = backbone) for small datasets")
    p.add_argument("--lr0", type=float, default=0.002)
    p.add_argument("--patience", type=int, default=20)
    p.add_argument("--fraction", type=float, default=1.0, help="use a fraction of the training set (smoke tests)")
    p.add_argument("--project", default=str(HERE / "runs"))
    p.add_argument("--name", default="regional")
    args = p.parse_args(argv)

    import yaml

    data = yaml.safe_load(Path(args.data).read_text(encoding="utf-8"))
    names = data["names"] if isinstance(data["names"], dict) else dict(enumerate(data["names"]))
    weights = parse_class_weights([w for w in args.class_weights if w], names)
    print(f"model {args.model}{' + P2 head' if args.p2 else ''} · imgsz {args.imgsz} · class weights "
          f"{ {names[c]: w for c, w in weights.items()} or 'none'}{' + repeat-factor balance' if args.balance else ''}")

    model = build_model(args)
    trainer = make_trainer_class(weights, args.balance)
    results = model.train(
        trainer=trainer, data=args.data, epochs=args.epochs, imgsz=args.imgsz, batch=args.batch, device=args.device,
        workers=args.workers, project=args.project, name=args.name, exist_ok=True, patience=args.patience,
        optimizer="AdamW", lr0=args.lr0, cos_lr=True, freeze=args.freeze or None, fraction=args.fraction,
        # dense small objects: mosaic on, closed for the final epochs; cameras are upright → no flipud/rotation
        mosaic=1.0, close_mosaic=10, mixup=0.0, scale=0.5, translate=0.1, fliplr=0.5, flipud=0.0, degrees=0.0,
        hsv_h=0.015, hsv_s=0.5, hsv_v=0.4, plots=True,
    )
    best = Path(results.save_dir) / "weights" / "best.pt" if results is not None else None
    print(f"\nbest weights: {best}")
    print("next: python backend/training/yolo/tune_nms.py --model <best.pt> --data", args.data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
