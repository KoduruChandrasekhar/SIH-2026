/**
 * What the backend AI pipeline actually does and measured — shown on the Pipeline page.
 *
 * Sources (all from this repository):
 *   OCR_READ       backend/output/anpr/CAM-401_anpr.json (Phase 2 run; evidence images copied to public/pipeline/)
 *   OCR_PROFILES   measured on the development machine (CPU)
 *   OCR_RUNTIME    backend/config/anpr.json (ocr_device "auto", ocr_use_tensorrt, fp16, hybrid mode)
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
