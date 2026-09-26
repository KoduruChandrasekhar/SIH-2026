/**
 * What the backend AI pipeline actually does and measured — shown on the Pipeline page.
 *
 * Sources (all from this repository):
 *   OCR_READ / ANPR_RUNS   backend/output/anpr/CAM-40x_anpr.json (Phase 2 runs; evidence images copied to
 *                          public/pipeline/). When a backend is connected, /api/anpr replaces ANPR_RUNS live.
 *   DETECTOR_*, OCR_*      docs/UPGRADES_OCR_DETECTOR_BENCHMARK.md (measured on the development machine, CPU)
 *   OCR_RUNTIME            backend/config/anpr.json (ocr_device "auto", ocr_use_tensorrt, fp16, hybrid mode)
 *   UVH26_CLASSES          backend/training/yolo/uvh26.yaml + CLASS_NAME_MAP in backend/ai/vehicle_tracker.py
 */

// ─── One real plate read, end to end (CAM-401, track 4) ──────────────────────
// Boxes are in the source video's pixels (2560 × 1440); the saved frame is a 1280 × 720 copy.
export const OCR_READ = {
  camera: "CAM-401",
  cameraName: "Kukatpally Y-Junction",
  trackId: 4,
  vehicleClass: "Two-wheeler",
  source: [2560, 1440],
  frame: "/pipeline/cam401-t4-frame.jpg",
  vehicleBox: [274.5, 647.9, 513.3, 980.2],
  plateBox: [359, 744, 429, 779],
  plate: "AP09AZ6596",
  confidence: 94.2,
  plateFormat: "STANDARD",
  validation: "VALID",
  trackHits: 4,
  candidatesFound: 4,
  // per-frame reads that went into the consensus
  reads: [
    { frame: 207, raw: "AP09AZ6596", conf: 95.45, q: 0.82, skew: 2.5, sharpness: 1.0, exposure: 0.99, size: [84, 43], crop: "/pipeline/cam401-t4-r1-crop.jpg", prep: "/pipeline/cam401-t4-r1-prep.jpg" },
    { frame: 179, raw: "AP.09AZ6596", conf: 92.58, q: 0.79, skew: 5.0, sharpness: 1.0, exposure: 0.85, size: [98, 43], crop: "/pipeline/cam401-t4-r2-crop.jpg", prep: "/pipeline/cam401-t4-r2-prep.jpg" },
    { frame: 199, raw: "AP.09AZ6596", conf: 94.58, q: 0.66, skew: 15.0, sharpness: 1.0, exposure: 0.97, size: [94, 44], crop: "/pipeline/cam401-t4-r3-crop.jpg", prep: "/pipeline/cam401-t4-r3-prep.jpg" },
  ],
  preprocessing: "CLAHE",
  // Indian registration format: state · district · series · number
  segments: [
    { text: "AP", label: "State", note: "Andhra Pradesh" },
    { text: "09", label: "District / RTO", note: "RTO code 09" },
    { text: "AZ", label: "Series", note: "Letter series" },
    { text: "6596", label: "Number", note: "4-digit number" },
  ],
};

// ─── Phase 2 ANPR runs: the funnel from frames to plate reads (real stats) ────
export const ANPR_RUNS = {
  "CAM-401": {
    name: "Kukatpally Y-Junction",
    source: "RTSP · 25 fps",
    stats: { frames_processed: 18, vehicle_detections: 133, unique_tracks: 45, plate_searches: 124, plate_candidates: 44, candidates_accepted: 27, crops_sent_to_ocr: 19, ocr_engine_calls: 34, observations: 20, ocr_seconds: 59.87, status_counts: { NOT_VISIBLE: 12, OCR_FAILED: 7, DETECTED: 1 } },
  },
  "CAM-402": {
    name: "JNTU Metro Station",
    source: "MP4 · 60 fps",
    stats: { frames_processed: 1230, vehicle_detections: 3025, unique_tracks: 48, plate_searches: 357, plate_candidates: 54, candidates_accepted: 28, crops_sent_to_ocr: 20, ocr_engine_calls: 40, observations: 37, ocr_seconds: 164.83, status_counts: { NOT_VISIBLE: 27, OCR_FAILED: 8, INVALID_FORMAT: 2 } },
  },
  "CAM-403": {
    name: "Balanagar Main Road",
    source: "RTSP · 25 fps",
    stats: { frames_processed: 185, vehicle_detections: 1173, unique_tracks: 146, plate_searches: 0, plate_candidates: 0, candidates_accepted: 0, crops_sent_to_ocr: 0, ocr_engine_calls: 0, observations: 96, ocr_seconds: 0, status_counts: { NOT_VISIBLE: 96 } },
  },
};

export const FUNNEL_STEPS = [
  { key: "vehicle_detections", label: "Vehicle detections", hint: "YOLO boxes across sampled frames" },
  { key: "unique_tracks", label: "Unique tracks", hint: "ByteTrack identities" },
  { key: "plate_searches", label: "Plate searches", hint: "track frames searched for a plate" },
  { key: "plate_candidates", label: "Plate candidates", hint: "plate-shaped regions found" },
  { key: "candidates_accepted", label: "Passed quality gate", hint: "sharp, large and straight enough" },
  { key: "crops_sent_to_ocr", label: "Sent to OCR", hint: "best crops per track" },
  { key: "observations", label: "Track observations", hint: "one result per tracked vehicle" },
];

export const STATUS_META = {
  DETECTED: { label: "Plate read", color: "#10b981" },
  INVALID_FORMAT: { label: "Invalid format", color: "#f59e0b" },
  OCR_FAILED: { label: "OCR failed", color: "#f97316" },
  NOT_VISIBLE: { label: "Plate not visible", color: "#64748b" },
};

// ─── Detector upgrade: COCO yolo11n → IISc UVH-26 YOLOv11-S (60 val frames, 800 boxes) ──
export const DETECTOR_BENCH = [
  { metric: "Recall", before: 31.3, after: 78.5 },
  { metric: "F1", before: 44.8, after: 79.6 },
  { metric: "Precision", before: 79.3, after: 80.7 },
  { metric: "Two-wheeler recall", before: 8.8, after: 74.4 },
  { metric: "Three-wheeler recall", before: 32.6, after: 85.5 },
  { metric: "LCV recall", before: 25.6, after: 79.1 },
];
export const DETECTOR_MODELS = { before: "COCO yolo11n", after: "UVH-26 YOLOv11-S", cpuMs: { before: 192, after: 295 } };

// 14 Indian vehicle classes (UVH-26) → the 5 classes TraceNet tracks; Bicycle / Others carry no plate
export const UVH26_CLASSES = [
  { name: "Hatchback", to: "Car" },
  { name: "Sedan", to: "Car" },
  { name: "SUV", to: "Car" },
  { name: "MUV", to: "Car" },
  { name: "Van", to: "Car" },
  { name: "Two-wheeler", to: "Two-wheeler" },
  { name: "Three-wheeler", to: "Auto" },
  { name: "Bus", to: "Bus" },
  { name: "Mini-bus", to: "Bus" },
  { name: "Tempo-traveller", to: "Bus" },
  { name: "Truck", to: "Truck" },
  { name: "LCV", to: "Truck" },
  { name: "Bicycle", to: null },
  { name: "Others", to: null },
];
export const TRACENET_CLASSES = ["Car", "Two-wheeler", "Auto", "Bus", "Truck"];

// ─── OCR speed-up: hybrid recognition-first read path (CPU, per plate crop) ──
export const OCR_PROFILES = [
  { name: "Old: full det+rec", medianMs: 1850, range: "1.7–2.0 s", kept: "45 / 45 (baseline)", exact: "59 / 60" },
  { name: "Accurate: medium-rec hybrid", medianMs: 295, range: "0.28–0.31 s", kept: "44 / 45", exact: "59 / 60" },
  { name: "Default: mobile-rec + oneDNN hybrid", medianMs: 60, range: "53–67 ms", kept: "45 / 45", exact: "58 / 60", current: true },
];

// Device plan tried in order at startup; each rung runs one real inference before it is accepted
export const OCR_RUNTIME = [
  { name: "GPU + TensorRT", detail: "FP16 engine, dynamic width shapes" },
  { name: "GPU", detail: "CUDA via paddlepaddle-gpu" },
  { name: "CPU", detail: "oneDNN, PP-OCRv5 mobile rec", active: true },
];
