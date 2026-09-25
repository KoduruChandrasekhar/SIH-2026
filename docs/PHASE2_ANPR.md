# TraceNet — Phase 2: High-Accuracy ANPR / OCR

Phase 2 turns the Phase 1 vehicle tracks into structured plate observations. It reuses
the existing YOLO11 + ByteTrack tracker (`backend/ai/vehicle_tracker.py`); it never
detects vehicles a second time.

```
Video frame
  ↓  YOLO11n + ByteTrack (existing, every frame)
Vehicle track  (camera_id, track_id, frame_id, timestamp, vehicle_class, vehicle_bbox)
  ↓  sampled at candidate_sample_fps
Plate candidate        PlateDetector: dedicated YOLO model if present, else geometric fallback
  ↓
Q-score (pixels only)  area + Laplacian sharpness + exposure − skew; reject small/blurred/skewed
  ↓
Top-K buffer           best 2–3 crops per transit (no OCR has run yet)
  ↓  at transit end, or early once K crops all have Q ≥ early_ocr_min_q
CLAHE → OCR            PaddleOCR (PP-OCRv6); bilateral retry only if confidence < 0.85
  ↓
Validation             Indian STANDARD / BH formats, positional character correction
  ↓
Consensus              confidence-weighted, edit-distance tolerant, per-character vote
  ↓
ANPRObservation        backend/output/anpr/<CAM>_anpr.json + evidence JPEGs
```

## 1. Files

| File | Responsibility |
|---|---|
| `backend/ai/vehicle_tracker.py` | Existing tracker; now exposes `track_frame()` and a `frame_callback` hook |
| `backend/ai/plate_detector.py` | `PlateDetector` interface, `YoloPlateDetector`, `GeometricPlateDetector`, factory |
| `backend/ai/ocr_engine.py` | `OCREngine` interface, `PaddleOCREngine` (primary), `EasyOCREngine` (fallback) |
| `backend/anpr/config.py` + `backend/config/anpr.json` | Every threshold and weight |
| `backend/anpr/quality.py` | Pre-OCR Q-score |
| `backend/anpr/preprocess.py` | grayscale → CLAHE, bilateral fallback, OCR margin |
| `backend/anpr/recognizer.py` | OCR of one selected crop incl. fallback logic |
| `backend/anpr/validation.py` | Normalisation, format detection, positional correction |
| `backend/anpr/consensus.py` | Multi-frame consensus |
| `backend/anpr/pipeline.py` | Transit state machine, best-frame selection, observations |
| `backend/anpr/models.py` | `ANPRObservation`, `PlateRead`, `QualityScore`, `PlateStatus` |
| `backend/anpr/store.py` | JSON + evidence file store (Phase 4 → PostgreSQL) |
| `backend/anpr/api.py` | FastAPI router |
| `backend/tests/test_phase2_anpr.py` | Phase 2 tests |

## 2. Install

```bash
python -m pip install -r backend/requirements.txt
```

The first PaddleOCR run downloads `PP-OCRv6_medium_det` and `PP-OCRv6_medium_rec` to
`~/.paddlex/official_models` (≈ a few minutes once; afterwards the engine loads in ≈ 10 s).

## 3. Run

The existing tracking command gains `--anpr`:

```bash
python backend/scripts/run_vehicle_tracking.py --camera CAM-401 --anpr
python backend/scripts/run_vehicle_tracking.py --camera CAM-403 --anpr --no-video --max-frames 300
python backend/scripts/run_vehicle_tracking.py --input path/to/clip.mp4 --anpr --plate-model weights/plate.pt
```

| Flag | Meaning |
|---|---|
| `--anpr` | run Phase 2 on the tracks |
| `--no-video` | skip the annotated video (faster) |
| `--max-frames N` | stop after N frames |
| `--anpr-config PATH` | alternative ANPR config |
| `--ocr-engine paddle\|easyocr\|auto` | override OCR engine |
| `--plate-model PATH` | dedicated plate YOLO weights |

Output: `backend/output/anpr/<CAM>_anpr.json` and `backend/output/anpr/evidence/<CAM>/`
(per OCR'd crop: `_crop.jpg` original padded crop, `_prep.jpg` preprocessed crop,
`_frame.jpg` downscaled frame with vehicle + plate boxes). Only the top-K crops of each
transit are written — never every frame.

## 4. Plate detection

No dedicated plate model exists in the repository, so `plate_detector: "auto"` uses the
**geometric fallback**. Drop weights named `*plate*.pt` / `*anpr*.pt` / `*lpr*.pt` into
`backend/models/` (or pass `--plate-model`) and the same pipeline uses them.

Geometric fallback: search the lower 40 % of the vehicle box, then the full box; build
three masks (blackhat text band, bright plate panel, closed edges); keep contours with
aspect 2.5–5.5 (motorcycles: 1.4–5.5, for two-row plates), relative width 8–85 % of the
vehicle, rectangularity ≥ 0.55, skew ≤ 30°, and ≥ 6 character-stroke transitions.
Nothing found → the transit is `NOT_VISIBLE`.

## 5. Q-score, top-K, transit logic

`Q = 0.35·Area + 0.45·Sharpness + 0.20·Exposure − 0.30·Skew` (all normalised 0..1,
weights in `anpr.json`). Crops < 40×12 px, Laplacian variance < 25 (measured at a fixed
48 px height), skew > 20° or Q < 0.2 are rejected. Each track keeps only its best
`top_k_ocr` (3) crops. OCR runs **once per track**, on those crops, when the track is
lost for `track_lost_seconds` / the video ends — or earlier when all K crops have
Q ≥ 0.7. After OCR the track is closed for plate search, so a vehicle is never OCR'd
indefinitely.

## 6. OCR

`original crop → grayscale → upscale to ≥128 px → CLAHE → 15 % replicated margin → OCR`.
If confidence < 0.85: `CLAHE → bilateral filter → OCR` again; the better read (format-valid
first, then confidence) is kept. Recorded per read: `preprocessing_method`,
`initial_confidence`, `fallback_used`, `fallback_confidence`, `final_confidence`.

The margin matters: PaddleOCR's detector returned **no text** for tight, legible CAM-401
crops whose characters touched the image edge; with the margin they read correctly.

PaddlePaddle 3.3 on CPU fails inside its oneDNN executor on these models
(`ConvertPirAttribute2RuntimeAttribute not support`), so the engine sets
`enable_mkldnn=False`. It is correct but slow (see §12).

## 7. Validation

Normalise (uppercase, strip non-alphanumerics, strip a leading `IND` hologram read), pick
the format from the string's length / `BH` position, then correct **only** where that
position expects the other character class:

| Position | Expected | Corrections |
|---|---|---|
| State (2) | letter | 0→O, 8→B, 1→I |
| District (2) | digit | O→0, B→8, Z→2 |
| Series (1–3) | letter | 0→O, 8→B, 1→I, 2→Z |
| Number (4) | digit | O→0, B→8 |

BH: `^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$` (year digits, `8H`→`BH`, number digits, suffix
letters). Text that still fails is kept with `validation = "INVALID_FORMAT"`.

## 8. Statuses

| `plate_status` | When |
|---|---|
| `DETECTED` | consensus is a valid Indian plate **and** confidence ≥ `min_plate_confidence` (0.75) |
| `INVALID_FORMAT` | OCR text exists but is not a valid plate (text kept) |
| `OCR_FAILED` | crops were OCR'd but gave no usable text, OCR is unavailable, or a valid-looking consensus is below 0.75 (`low_confidence_consensus`, text kept) |
| `NOT_VISIBLE` | no plate candidate, all candidates rejected by the Q-gate, or vehicle too small |

`status_reason` says which case applied. `plate` is only set for `DETECTED`.

## 9. Observation schema (Phase 3 input)

A real CAM-401 observation (reads trimmed to one):

```json
{
  "observation_id": "CAM-401:20260923T193037Z:186",
  "camera_id": "CAM-401", "track_id": 186,
  "timestamp": "2026-09-19T18:45:07.907900+05:30",
  "first_seen": "2026-09-19T18:45:07.841167+05:30", "last_seen": "2026-09-19T18:45:08.174833+05:30",
  "first_frame_id": 235, "last_frame_id": 245,
  "vehicle_class": "motorcycle", "vehicle_bbox": [258.2, 642.9, 485.1, 978.0], "plate_bbox": [372, 748, 450, 783],
  "plate_status": "DETECTED", "status_reason": null,
  "plate": "AP09AZ6596", "consensus_text": "AP09AZ6596", "raw_ocr": "AP09AZ6596",
  "ocr_confidence": 0.9442, "validation": "VALID", "plate_format": "STANDARD",
  "best_frame": 237, "best_frame_file": "track_00186_r2_frame.jpg", "best_crop_file": "track_00186_r2_crop.jpg",
  "q_score": 0.6984, "preprocessing_method": "CLAHE", "fallback_used": false,
  "frames_used": 3, "consensus_count": 3, "agreeing_count": 3,
  "track_hits": 11, "candidates_found": 3, "candidates_accepted": 3, "resolved_early": false,
  "camera": {"camera_id": "CAM-401", "name": "Kukatpally Y-Junction", "latitude": 17.4947, "longitude": 78.3996},
  "reads": [
    {"frame_id": 243, "q_score": 0.8152, "initial_confidence": 0.9138, "fallback_used": false,
     "final_confidence": 0.9138, "raw_text": "AP.09AZ6596", "corrected_text": "AP09AZ6596",
     "corrections": [], "crop_file": "track_00186_r1_crop.jpg", "...": "..."}
  ]
}
```

Timestamps use the Phase 1 replay clock (`replay_start_time + frame / fps`), so ANPR
observations line up with ingestion `FramePacket`s. Observations map onto two future
tables: `anpr_observation` (one row per transit) and `anpr_read` (one row per OCR'd crop).

## 10. API

| Endpoint | Purpose |
|---|---|
| `GET /api/anpr?camera_id=&status=&limit=` | all observations + per-camera run stats |
| `GET /api/anpr/{track_id}?camera_id=` | observations for a track id |
| `GET /api/cameras/{camera_id}/anpr?status=` | one camera's latest run |
| `GET /api/anpr/evidence/{camera_id}/{file}` | evidence JPEG |

The API only serves saved runs; it never runs OCR. The Cameras page detail modal shows
the real run (counts row, real reads in "Recent ANPR detections", and the `OCRPanel` with
the real top-K crops) whenever the backend has one, and the demo data otherwise.

## 11. Tests

```bash
python -m pytest backend/tests/test_phase2_anpr.py -v
python -m pytest backend/tests/test_phase1_ingestion.py -v
```

Pipeline-logic tests use a scripted test-double OCR engine (test file only) so gating,
top-K, fallback, consensus and failure states are deterministic; two tests run the real
PaddleOCR engine and one runs the real YOLO11 + ByteTrack tracker on CAM-401.

## 12. Known limitations

* **CPU speed.** PaddleOCR without oneDNN takes ≈ 1.5–5 s per call on this machine; a
  crop that needs the bilateral retry costs two calls. The Q-gate + top-K is what keeps a
  full clip tractable.
* **Geometric fallback precision.** It finds plate-like rectangles, which includes truck
  and bus signage, bumpers and railings. Those transits end up `INVALID_FORMAT`/`OCR_FAILED`
  rather than wrong plates, but they cost OCR calls, and `OCR_FAILED` then really means
  "no readable plate in the candidate" (the fallback cannot tell a non-plate candidate from
  an unreadable plate). A dedicated plate model would remove most of them.
* **Track ID switches.** ByteTrack occasionally re-IDs the same vehicle; each track is a
  separate transit (Phase 3 is responsible for linking observations).
* **Footage.** The demo clips are not ANPR footage: most vehicles are small, distant,
  side-on or motion-blurred, so most transits are honestly `NOT_VISIBLE`.
