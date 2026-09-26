# TraceNet — OCR acceleration, regional detector, automated benchmark

Three upgrades to the ANPR stack, and what was measured on this development machine. This machine has no
NVIDIA GPU and runs the CPU build of PaddlePaddle, so the GPU and TensorRT path is implemented and unit-tested,
but it has not been timed here.

## 1. OCR: GPU / TensorRT with fallback, plus a recognition-only fast path

**Files:** `backend/ai/ocr_engine.py` (`OCRRuntime`, `PaddleOCREngine`), `backend/anpr/recognizer.py`
(`build_ocr_engine`, hybrid `read_crop`), `backend/anpr/config.py` + `backend/config/anpr.json` (`ocr_*` keys).

* **Device plan** (`ocr_device: "auto"`): GPU + TensorRT (`use_tensorrt`, `precision: fp16`), then GPU, then CPU.
  * Each candidate runs one real inference before it is accepted. TensorRT builds its engine on the first
    run, and that's where a missing TensorRT library or too little GPU memory surfaces.
  * `engine.backend` says what was used, and `engine.fallbacks` records why the earlier rungs were skipped.
  * On this machine: `gpu: PaddlePaddle is the CPU build (install paddlepaddle-gpu for CUDA)` → `cpu`.
* **PaddleOCR 3.x API:** `device="gpu:0"`, `use_tensorrt=True`, `precision="fp16"`. The 2.x flags `use_gpu` and
  `trt_max_shape` no longer exist; 3.x raises `ValueError: Unknown argument` for them. TensorRT dynamic shapes are
  passed as a PaddleX `engine_config` (`trt_dynamic_shapes` for the recognition input `[batch, 3, 48, width]`,
  width up to `ocr_trt_max_width`), with a shape-range cache in `backend/models/trt_cache/`.
* **Hybrid read path** (`ocr_mode: "hybrid"`, the default):
  * A plate crop is already the text line, so recognition runs alone first.
  * The full det+rec pipeline runs only when that read isn't already a confident valid plate
    (`ocr_hybrid_min_conf`), and only if it looks like text at all (≥ `ocr_hybrid_min_chars`,
    ≥ `ocr_hybrid_escalate_min_conf`).
  * Two-row plates (crop aspect < `ocr_single_line_min_aspect`) always use det+rec.
  * `ocr_mode: "rec"` never escalates; `"full"` is the old behaviour.
* **Default first-read model:** `ocr_fast_rec_model: "PP-OCRv5_mobile_rec"` with `ocr_fast_rec_mkldnn: true`,
  chosen from the measurements below. The accurate profile is `"PP-OCRv6_medium_rec"` with
  `ocr_fast_rec_mkldnn: false`.

### Measured (CPU, per plate crop, through `read_crop`)

The test set is 60 rendered Indian plates degraded to CCTV quality (95–170 px wide, blur, ±6° tilt, JPEG 55–85)
plus 80 real crops from the Phase 2 runs and the dataset evaluation.

| Profile | Synthetic exact | Old path's valid real reads kept | Median | Mean |
|---|---|---|---|---|
| Old: full det+rec | 59 / 60 | (baseline, 45) | 1.7–2.0 s | 1.9–2.3 s |
| Accurate: medium-rec hybrid | 59 / 60 | 44 / 45 | 0.28–0.31 s | 0.6 s |
| **Default: mobile-rec + oneDNN hybrid** | 58 / 60 | **45 / 45** | **53–67 ms** | 0.54 s |
| (rec-only sweep, no fallback) PP-OCRv5 mobile + oneDNN | 56 / 60 | 32 / 45 | 47 ms | 50 ms |

The ranges cover two runs, one of them on a busy CPU. The mean stays high because hard crops escalate to det+rec
(1.5–3 s on CPU). On real footage (section 3) the medium-rec profile once read a plate as "6", which the junk guard
did not escalate, so it lost a three-frame consensus that the mobile profile kept. That, plus 45/45 kept reads, is
why mobile-rec is the default. Setting `ocr_hybrid_min_chars: 0` escalates every doubtful read, at a higher mean.

**Your < 100 ms per frame target:**
* On CPU, the fast profile reaches about 50–70 ms for a typical crop, and a frame with several plates costs
  several crops.
* A GPU with TensorRT FP16 is the realistic way to reach < 100 ms per frame with the accurate PP-OCRv6 model.
  PaddleOCR publishes single-digit-millisecond recognition latencies on such hardware, but that isn't measured here.
* To enable the GPU path:

  ```bash
  pip uninstall paddlepaddle
  pip install paddlepaddle-gpu
  ```

  Choose the build matching the CUDA version (see paddlepaddle.org.cn), install TensorRT, and keep
  `ocr_device: auto`. Check `engine.backend` in the logs.

## 2. Regional detector: IISc UVH-26 weights + fine-tuning kit

* **Drop-in weights:** `backend/models/uvh26_yolo11s.pt` is the IISc AIM *UVH-26-MV YOLOv11-S*
  (Apache-2.0, https://huggingface.co/iisc-aim/UVH-26), trained on 21k Bengaluru CCTV frames with 14 Indian
  classes.
  * `run_vehicle_tracking.py` uses it by default when the file is present.
  * The file is git-ignored. Download it with:

    ```bash
    python -c "from huggingface_hub import hf_hub_download as d; import shutil; shutil.copy(d('iisc-aim/UVH-26','weights/YOLOv11-S/UVH-26-MV-YOLOv11-S.pt'),'backend/models/uvh26_yolo11s.pt')"
    ```

* **Model-aware classes** (`backend/ai/vehicle_tracker.py`): classes are read from `model.names` and mapped to
  TraceNet's vocabulary through `CLASS_NAME_MAP`:
  * Two-wheeler → `motorcycle`;
  * Three-wheeler → `auto_rickshaw` (new);
  * Hatchback, Sedan, SUV, MUV and Van → `car`;
  * LCV → `truck`;
  * Mini-bus and Tempo-traveller → `bus`;
  * Bicycle and Others are not tracked, since they carry no plate to read.

  Each detection keeps the detector's own label as `fine_class`. New tracker arguments are `iou` (NMS), `imgsz`
  and `tracker_config`; `run_vehicle_tracking.py` exposes `--iou` and `--imgsz`.

### Measured (UVH-26 validation frames, 60 frames / 800 GT boxes, IoU ≥ 0.5, class-agnostic)

| Detector | Precision | Recall | F1 | Two-wheeler R | Three-wheeler R | LCV R | CPU ms/frame |
|---|---|---|---|---|---|---|---|
| COCO `yolo11n.pt` (before) | 79.3 % | 31.3 % | 44.8 % | 8.8 % | 32.6 % | 25.6 % | 192 |
| **UVH-26 YOLOv11-S** | 80.7 % | **78.5 %** | **79.6 %** | **74.4 %** | **85.5 %** | 79.1 % | 295 |

**Caveat:** these are UVH-26 validation frames, which IISc also used to select its checkpoint, so expect a few
points less on cameras outside Bengaluru. Fine-tune on your own frames, then re-measure with `tune_nms.py`.

### Fine-tuning kit (`backend/training/yolo/`)

| File | What it does |
|---|---|
| `prepare_uvh26.py` | Downloads a sample of UVH-26 (priority sampling of two-wheeler, three-wheeler, bicycle, LCV and mini-bus images), converts COCO to YOLO txt (JPEG 92), adds your own COCO-annotated frames with `--extra-coco` / `--extra-images`, and writes `datasets/uvh26/uvh26.yaml`. It survives flaky networks: resets the Hub session, retries, and falls back to file-by-file download. |
| `uvh26.yaml` | Data yaml template (14 classes in the IISc weights' order). |
| `train_regional.py` | Fine-tunes from the UVH-26 weights (or `yolo11s.pt`) with class-weighted sampling, an optional P2 head, and augmentation for dense upright traffic. |
| `yolo11-p2.yaml` | YOLO11 with an extra stride-4 head (Detect on P2–P5) for small or far vehicles. |
| `tune_nms.py` | Sweeps confidence × NMS IoU on a labelled validation split and picks the recall-maximising setting above a precision floor for the focus classes. It prints the matching `VehicleTracker(...)` call. |

What each requested lever becomes in YOLO11:
* **Class weights:** YOLO11 has no per-class loss weight (the YOLOv5 `cls_pw` was removed). `WeightedYOLODataset`
  samples training images with probability proportional to the largest class weight in each image
  (`--class-weights Two-wheeler=2.5 Three-wheeler=2.5`, the default), or with LVIS repeat-factor weights (`--balance`).
* **Anchor scales:** YOLO11 is anchor-free (per-location regression with DFL), so there are no anchors to rescale.
  The equivalent levers for small vehicles are the P2 head (`--p2`) and a larger `--imgsz` (960–1280).
* **NMS thresholds:** these are an inference setting (`VehicleTracker(confidence, iou)`), picked with `tune_nms.py`.
  In dense two-wheeler traffic, a higher IoU (0.75–0.8) stops adjacent riders being suppressed as duplicates.

Smoke-tested on CPU (24 training and 12 validation images, imgsz 320, 1 epoch): weighted sampling, the P2 head
(297 of 593 tensors transferred from the UVH weights; the new head needs real epochs), and the NMS sweep.

**For a real run:**
* Use a GPU: roughly 1 hour for 3000 images at imgsz 960 on one RTX-class card.
* Prepare the data with:

  ```bash
  python backend/training/yolo/prepare_uvh26.py --train 3000 --val 600
  ```

* Then train with:

  ```bash
  python backend/training/yolo/train_regional.py --data backend/training/yolo/datasets/uvh26/uvh26.yaml --epochs 60 --imgsz 960
  ```

**Licences:** ultralytics is AGPL-3.0; the UVH-26 weights are Apache-2.0; the UVH-26 data is CC-BY-4.0
(cite arXiv:2511.02563).

## 3. Automated benchmark (`run_automated_anpr_benchmark.py`)

```bash
python run_automated_anpr_benchmark.py --url "<video URL you may download>" --start 30   # yt-dlp + ffmpeg
python run_automated_anpr_benchmark.py --video public/camera-feeds/CAM-401.mp4 --max-height 1440
python run_automated_anpr_benchmark.py --frames-dir my_frames/ --ocr-profile fast
```

* **Acquisition:**
  * `yt-dlp --download-sections "*start-end" --force-keyframes-at-cuts` fetches only the slice (≤ 1080p).
  * ffmpeg extracts `frame_%05d.png` at 15 FPS into `./test_eval_tmp/local_frames/`.
  * ffmpeg on PATH is used when present, otherwise the binary bundled with imageio-ffmpeg.
  * A missing yt-dlp or ffmpeg, a failed download, or an empty clip exits with code 2 and a clear message.
* **Hooks:** `PipelineHooks.detect_and_track` (YOLO11 + ByteTrack), `.localize_and_warp` (plate detector →
  corner estimation → perspective warp → quality gate), `.read_plate` (TraceNet's OCR read path, profile
  default / fast / full, `--ocr-device`).
* **KPIs:**
  * track retention (≥ 3 and ≥ 10 frames) and mean lifespan;
  * an ID-switch proxy;
  * strict HSRP regex validity (raw, and after TraceNet's positional correction);
  * **consensus** = identical string in ≥ 3 *consecutive* frames of a track;
  * YOLO, plate+warp and OCR latency, and FPS.
* **Output:** `tqdm` progress, a `rich` table, and `./test_eval_tmp/automated_benchmark_results.json`
  (per-track top reads included). `--cleanup` removes the clip and frames.

The benchmark was validated on this repository's own junction footage (results below), because no URL was given.
**CAM-402 (10 s → 150 frames at 1080p, accurate profile):**
* 9 tracks, 100 % retained ≥ 3 frames, 66.7 % retained ≥ 10 frames, mean lifespan 3.6 s, 0 ID switches (proxy).
* 136 OCR reads, 0 % valid HSRP: this camera's plates are too small to read, matching its Phase 2 run
  (0 readable plates).
* 0.59 FPS end to end.

**CAM-401 (8.2 s clip → 123 frames at native 1440p), the same frames through each OCR profile:**

| Profile | OCR ms/frame (mean / p50) | Frame p50 | FPS | Non-empty reads | Valid HSRP reads | 3-consecutive consensus on a valid plate |
|---|---|---|---|---|---|---|
| Full det+rec (old path) | 4395 / 4227 | 4.70 s | 0.20 | 19 | 4 | 1 (AP09AZ6596) |
| Accurate: medium-rec hybrid | 2158 / 1963 | 2.40 s | 0.38 | 54 | 3 | 0 (one frame read "6") |
| **Default: mobile-rec hybrid** | **1695 / 1526** | **1.95 s** | **0.47** | 30 | 4 | **1 (AP09AZ6596)** |

Tracking was identical across the three runs: 56 tracks, 71 % retained ≥ 3 frames, 45 % retained ≥ 10 frames,
mean lifespan 22 frames (1.5 s), 1 ID switch (proxy). YOLO took 270–350 ms and plate localization + warp 70–90 ms
per frame.

**What these numbers say:**
* On real frames the per-frame OCR saving is 2.6×, not the 6× per clean crop. The geometric plate detector passes
  many non-plate regions (231 OCR'd candidates in 123 frames, most of them signage), and doubtful reads still
  escalate to det+rec.
* The biggest remaining CPU win is a trained plate detector (plan item 1.2), so OCR only sees real plates.
* The GPU / TensorRT path addresses the rest.
* Consensus is computed only on strings of ≥ 6 characters: repeated OCR noise such as "2" is not a
  "stabilised plate".
