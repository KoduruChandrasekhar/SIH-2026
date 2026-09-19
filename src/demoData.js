/**
 * TraceNet SIH-2026 — Centralized Demo Data
 * ============================================
 * Single source of truth for the demo vehicle and camera network.
 * All pages/components import from here to ensure data consistency.
 */

// ─── Primary Demo Vehicle ─────────────────────────────────────
export const DEMO_PLATE = "TS09AB4521";
export const DEMO_GLOBAL_ID = "GV-00157";

export const DEMO_VEHICLE = {
  plate: "TS09AB4521",
  globalId: "GV-00157",
  vehicleType: "Sedan",
  vehicleColor: "White",
  ocrConfidence: 98.7,
  status: "ACTIVE",
};

// ─── Journey Observations (Camera Hops) ───────────────────────
export const DEMO_OBSERVATIONS = [
  {
    camera: "CAM #401",
    name: "Kukatpally Y-Junction",
    lat: 17.4947,
    lng: 78.3996,
    time: "16:02:14",
    speed: 34,
    speedLabel: "34 km/h",
    direction: "North-West",
    confidence: 98.2,
    distance: "0 km",
  },
  {
    camera: "CAM #402",
    name: "JNTU Metro Station",
    lat: 17.4985,
    lng: 78.3912,
    time: "16:08:40",
    speed: 29,
    speedLabel: "29 km/h",
    direction: "East",
    confidence: 99.1,
    distance: "3.2 km",
  },
  {
    camera: "CAM #403",
    name: "Balanagar Main Road",
    lat: 17.4682,
    lng: 78.4357,
    time: "16:22:05",
    speed: 36,
    speedLabel: "36 km/h",
    direction: "South-West",
    confidence: 97.8,
    distance: "7.4 km",
  },
  {
    camera: "CAM #406",
    name: "Madhapur IT Corridor",
    lat: 17.4485,
    lng: 78.3742,
    time: "16:38:50",
    speed: 31,
    speedLabel: "31 km/h",
    direction: "South-West",
    confidence: 98.7,
    distance: "8.6 km",
  },
];

// ─── Re-ID Transition Data (for each camera handoff) ──────────
export const DEMO_REID_TRANSITIONS = [
  {
    from: "CAM #401",
    to: "CAM #402",
    plateSimilarity: 98.2,
    appearanceSimilarity: 94.5,
    vehicleTypeMatch: 100,
    vehicleColorMatch: 97.1,
    timeFeasibility: 96.8,
    routeFeasibility: 91.3,
    overallConfidence: 96.5,
    travelTime: "5m 28s",
    expectedTravelTime: "4-8 min",
  },
  {
    from: "CAM #402",
    to: "CAM #403",
    plateSimilarity: 97.8,
    appearanceSimilarity: 93.2,
    vehicleTypeMatch: 100,
    vehicleColorMatch: 96.4,
    timeFeasibility: 94.1,
    routeFeasibility: 88.7,
    overallConfidence: 95.2,
    travelTime: "6m 49s",
    expectedTravelTime: "5-10 min",
  },
  {
    from: "CAM #403",
    to: "CAM #406",
    plateSimilarity: 96.9,
    appearanceSimilarity: 91.8,
    vehicleTypeMatch: 100,
    vehicleColorMatch: 95.8,
    timeFeasibility: 93.5,
    routeFeasibility: 90.2,
    overallConfidence: 94.8,
    travelTime: "11m 34s",
    expectedTravelTime: "8-15 min",
  },
];

// ─── Camera Handoff Candidates ────────────────────────────────
export const DEMO_HANDOFF_CANDIDATES = [
  {
    from: "CAM #401",
    candidates: [
      { camera: "CAM #402", name: "JNTU Metro Station", match: 91 },
      { camera: "CAM #404", name: "Moosapet Bypass Link", match: 42 },
      { camera: "CAM #403", name: "Balanagar Main Road", match: 28 },
    ],
    confirmed: "CAM #402",
  },
  {
    from: "CAM #402",
    candidates: [
      { camera: "CAM #403", name: "Balanagar Main Road", match: 88 },
      { camera: "CAM #401", name: "Kukatpally Y-Junction", match: 35 },
      { camera: "CAM #404", name: "Moosapet Bypass Link", match: 22 },
    ],
    confirmed: "CAM #403",
  },
  {
    from: "CAM #403",
    candidates: [
      { camera: "CAM #406", name: "Madhapur IT Corridor", match: 93 },
      { camera: "CAM #404", name: "Moosapet Bypass Link", match: 51 },
      { camera: "CAM #402", name: "JNTU Metro Station", match: 19 },
    ],
    confirmed: "CAM #406",
  },
];

// ─── OCR Evidence & Multi-Frame Consensus ─────────────────────
export const DEMO_OCR_EVIDENCE = {
  candidateFrames: [
    {
      id: 1,
      camera: "CAM #401",
      time: "16:02:14",
      plateArea: "Large",
      plateAreaScore: 95,
      sharpness: 94,
      angle: 5,
      angleLabel: "Near-frontal",
      visibility: 98,
      motionBlur: "Low",
      motionBlurScore: 92,
      qualityScore: 95.2,
      selected: true,
      ocrOutput: "TS09AB4521",
      ocrConfidence: 98.7,
    },
    {
      id: 2,
      camera: "CAM #401",
      time: "16:02:16",
      plateArea: "Medium",
      plateAreaScore: 78,
      sharpness: 82,
      angle: 12,
      angleLabel: "Slight angle",
      visibility: 91,
      motionBlur: "Medium",
      motionBlurScore: 71,
      qualityScore: 81.4,
      selected: false,
      ocrOutput: "TS09AB4521",
      ocrConfidence: 93.2,
    },
    {
      id: 3,
      camera: "CAM #402",
      time: "16:08:40",
      plateArea: "Large",
      plateAreaScore: 92,
      sharpness: 91,
      angle: 3,
      angleLabel: "Frontal",
      visibility: 97,
      motionBlur: "Low",
      motionBlurScore: 94,
      qualityScore: 93.8,
      selected: true,
      ocrOutput: "TS09AB4521",
      ocrConfidence: 97.8,
    },
    {
      id: 4,
      camera: "CAM #402",
      time: "16:08:43",
      plateArea: "Small",
      plateAreaScore: 45,
      sharpness: 68,
      angle: 22,
      angleLabel: "Oblique",
      visibility: 75,
      motionBlur: "High",
      motionBlurScore: 38,
      qualityScore: 52.6,
      selected: false,
      ocrOutput: "TS09AB452?",
      ocrConfidence: 72.1,
    },
    {
      id: 5,
      camera: "CAM #403",
      time: "16:22:05",
      plateArea: "Medium",
      plateAreaScore: 81,
      sharpness: 88,
      angle: 8,
      angleLabel: "Slight angle",
      visibility: 93,
      motionBlur: "Low",
      motionBlurScore: 89,
      qualityScore: 88.6,
      selected: true,
      ocrOutput: "TS09AB4521",
      ocrConfidence: 96.4,
    },
  ],
  consensusPlate: "TS09AB4521",
  consensusConfidence: 98.7,
  method: "Weighted Multi-Frame Majority Vote",
};

// ─── Camera Network (for City Camera Graph) ───────────────────
export const CAMERA_NETWORK_NODES = [
  { id: "CAM #401", name: "Kukatpally Y-Junction", lat: 17.4947, lng: 78.3996, zone: "Kukatpally", status: "active" },
  { id: "CAM #402", name: "JNTU Metro Station", lat: 17.4985, lng: 78.3912, zone: "Kukatpally", status: "active" },
  { id: "CAM #403", name: "Balanagar Main Road", lat: 17.4682, lng: 78.4357, zone: "Balanagar", status: "active" },
  { id: "CAM #404", name: "Moosapet Bypass Link", lat: 17.4631, lng: 78.4236, zone: "Kukatpally", status: "active" },
  { id: "CAM #405", name: "Jubilee Hills Checkpost", lat: 17.4325, lng: 78.4072, zone: "Jubilee Hills", status: "active" },
  { id: "CAM #406", name: "Madhapur IT Corridor", lat: 17.4485, lng: 78.3742, zone: "Madhapur", status: "active" },
];

export const CAMERA_NETWORK_EDGES = [
  ["CAM #401", "CAM #402"],
  ["CAM #401", "CAM #404"],
  ["CAM #402", "CAM #403"],
  ["CAM #402", "CAM #404"],
  ["CAM #403", "CAM #404"],
  ["CAM #403", "CAM #406"],
  ["CAM #404", "CAM #405"],
  ["CAM #405", "CAM #406"],
  ["CAM #404", "CAM #406"],
];

// The demo vehicle's route through the camera network
export const DEMO_ROUTE_PATH = ["CAM #401", "CAM #402", "CAM #403", "CAM #406"];

// ─── Macro Analytics (for Parallel Processing) ────────────────
export const DEMO_MACRO_ANALYTICS = {
  vehicleCount: 1547,
  density: 78.4,
  avgSpeed: 36.2,
  flowRate: 842,
  odPairs: 24,
  congestionIndex: 0.72,
};

// ─── Watchlist (for Alerts page propagation) ──────────────────
export const WATCHLIST_CAMERAS = [
  "CAM #401",
  "CAM #402",
  "CAM #403",
  "CAM #404",
  "CAM #405",
  "CAM #406",
];

// ─── Helper: Get camera display ID (CAM #401 → CAM-401) ──────
export function cameraDisplayId(camId) {
  return camId.replace(" #", "-");
}

// ─── Helper: Format a confidence value ────────────────────────
export function formatConfidence(value) {
  return typeof value === "number" ? `${value.toFixed(1)}%` : value;
}
