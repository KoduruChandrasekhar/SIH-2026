/**
 * TraceNet — local demo dataset (used whenever the FastAPI backend is offline).
 *
 * Everything here describes ONE consistent snapshot of the Hyderabad ANPR network — the west cluster
 * (Kukatpally · JNTU · Miyapur · Nizampet · Balanagar · Madhapur / Hitech City · Gachibowli) and the
 * city centre and east (Ameerpet · Begumpet · Secunderabad · Khairatabad · Abids · Koti · Old City ·
 * Mehdipatnam · Tarnaka · Dilsukhnagar) — at the evening peak (SNAPSHOT_TIME). Cameras, corridors, zones, alerts and the hourly
 * trend series all reference the same camera IDs, coordinates and traffic levels.
 * Values are demo data, not measured production results.
 */

import { CAMERA_NETWORK_NODES } from "./demoData";

export const SNAPSHOT_TIME = "18:45";

// Problem-statement objective — a target, not a verified benchmark
export const OCR_ACCURACY_TARGET = 90;

// ─── Camera registry (single source of truth for camera IDs) ──────────────
// CAM #401–#406 are the demo trajectory network (demoData); #407–#412 extend the west cluster;
// #413–#424 cover central and east Hyderabad.
const node = (id) => CAMERA_NETWORK_NODES.find((n) => n.id === id);

const REGISTRY = [
  { ...node("CAM #401"), status: "online", fps: 25, resolution: "4K", lastHour: 2310, today: 31840, ocrRate: 95.8, latencyMs: 42, uptime: 99.9, lastPlate: "TS08EJ4892", lastSeen: "18:44:58", videoFeed: "/camera-feeds/CAM-401.mp4" },
  { ...node("CAM #402"), status: "online", fps: 25, resolution: "1080p", lastHour: 2140, today: 29610, ocrRate: 94.9, latencyMs: 38, uptime: 99.8, lastPlate: "TS07FZ1029", lastSeen: "18:44:57", videoFeed: "/camera-feeds/CAM-402.mp4" },
  { ...node("CAM #403"), status: "online", fps: 25, resolution: "4K", lastHour: 1580, today: 23470, ocrRate: 93.6, latencyMs: 47, uptime: 99.6, lastPlate: "TS10UA9921", lastSeen: "18:44:55", videoFeed: "/camera-feeds/CAM-403.mp4" },
  { ...node("CAM #404"), status: "degraded", fps: 12, resolution: "1080p", lastHour: 690, today: 14120, ocrRate: 87.9, latencyMs: 214, uptime: 97.2, lastPlate: "TS15EX5540", lastSeen: "18:44:31", videoFeed: "/camera-feeds/CAM-401.mp4", note: "Low frame rate — lens glare after rain" },
  { ...node("CAM #405"), status: "online", fps: 25, resolution: "1080p", lastHour: 1060, today: 17380, ocrRate: 96.4, latencyMs: 35, uptime: 99.9, lastPlate: "TS09FA3307", lastSeen: "18:44:59", videoFeed: "/camera-feeds/CAM-401.mp4" },
  { ...node("CAM #406"), status: "online", fps: 30, resolution: "4K", lastHour: 2190, today: 30250, ocrRate: 95.1, latencyMs: 40, uptime: 99.9, lastPlate: "TS09AB4521", lastSeen: "18:44:58", videoFeed: "/camera-feeds/CAM-402.mp4" },
  { id: "CAM #407", name: "Miyapur X Roads", lat: 17.4966, lng: 78.3574, zone: "Miyapur", status: "online", fps: 25, resolution: "1080p", lastHour: 1240, today: 19860, ocrRate: 94.2, latencyMs: 44, uptime: 99.7, lastPlate: "TS09EE9911", lastSeen: "18:44:56", videoFeed: "/camera-feeds/CAM-403.mp4" },
  { id: "CAM #408", name: "Nizampet Road Junction", lat: 17.5148, lng: 78.385, zone: "Nizampet", status: "online", fps: 25, resolution: "1080p", lastHour: 880, today: 13240, ocrRate: 93.1, latencyMs: 51, uptime: 99.4, lastPlate: "TS28C7745", lastSeen: "18:44:54", videoFeed: "/camera-feeds/CAM-401.mp4" },
  { id: "CAM #409", name: "Pragathi Nagar Main Road", lat: 17.5226, lng: 78.397, zone: "Nizampet", status: "offline", fps: 0, resolution: "1080p", lastHour: 0, today: 6120, ocrRate: null, latencyMs: null, uptime: 91.3, lastPlate: "TS15UB6021", lastSeen: "16:12:08", videoFeed: null, note: "No signal since 16:12 — fibre link down, field team assigned" },
  { id: "CAM #410", name: "Gachibowli Flyover", lat: 17.4401, lng: 78.3489, zone: "Gachibowli", status: "online", fps: 30, resolution: "4K", lastHour: 1930, today: 26780, ocrRate: 96.0, latencyMs: 39, uptime: 99.9, lastPlate: "KA05MN8123", lastSeen: "18:44:59", videoFeed: "/camera-feeds/CAM-402.mp4" },
  { id: "CAM #411", name: "KPHB Colony Phase 1", lat: 17.4849, lng: 78.391, zone: "Kukatpally", status: "online", fps: 25, resolution: "1080p", lastHour: 1370, today: 20550, ocrRate: 92.7, latencyMs: 46, uptime: 99.5, lastPlate: "TS08HK2210", lastSeen: "18:44:57", videoFeed: "/camera-feeds/CAM-403.mp4" },
  { id: "CAM #412", name: "Bharat Nagar Flyover", lat: 17.4671, lng: 78.4296, zone: "Balanagar", status: "online", fps: 25, resolution: "1080p", lastHour: 1490, today: 22160, ocrRate: 94.4, latencyMs: 43, uptime: 99.6, lastPlate: "AP28BK8821", lastSeen: "18:44:55", videoFeed: "/camera-feeds/CAM-401.mp4" },
  // Central and east Hyderabad: Ameerpet · Secunderabad · Tank Bund · Old City · Dilsukhnagar
  { id: "CAM #413", name: "Ameerpet X Roads", lat: 17.4374, lng: 78.4482, zone: "Ameerpet", status: "online", fps: 25, resolution: "4K", lastHour: 2260, today: 31120, ocrRate: 95.2, latencyMs: 41, uptime: 99.8, lastPlate: "TS09EU3316", lastSeen: "18:44:58", videoFeed: "/camera-feeds/CAM-401.mp4" },
  { id: "CAM #414", name: "Panjagutta Circle", lat: 17.426, lng: 78.4513, zone: "Panjagutta", status: "online", fps: 25, resolution: "1080p", lastHour: 2080, today: 28740, ocrRate: 94.6, latencyMs: 43, uptime: 99.7, lastPlate: "TS09FK7742", lastSeen: "18:44:57", videoFeed: "/camera-feeds/CAM-402.mp4" },
  { id: "CAM #415", name: "Begumpet Flyover", lat: 17.4441, lng: 78.4644, zone: "Begumpet", status: "online", fps: 30, resolution: "4K", lastHour: 1720, today: 24310, ocrRate: 95.7, latencyMs: 38, uptime: 99.9, lastPlate: "TS10EC2291", lastSeen: "18:44:59", videoFeed: "/camera-feeds/CAM-403.mp4" },
  { id: "CAM #416", name: "Paradise Circle", lat: 17.4434, lng: 78.4874, zone: "Secunderabad", status: "online", fps: 25, resolution: "1080p", lastHour: 1960, today: 27450, ocrRate: 94.1, latencyMs: 45, uptime: 99.6, lastPlate: "TS10UF6634", lastSeen: "18:44:56", videoFeed: "/camera-feeds/CAM-401.mp4" },
  { id: "CAM #417", name: "Khairatabad Junction", lat: 17.4108, lng: 78.463, zone: "Khairatabad", status: "online", fps: 25, resolution: "4K", lastHour: 2150, today: 29880, ocrRate: 95.0, latencyMs: 40, uptime: 99.8, lastPlate: "TS09GA1187", lastSeen: "18:44:58", videoFeed: "/camera-feeds/CAM-402.mp4" },
  { id: "CAM #418", name: "Tank Bund – Liberty", lat: 17.4057, lng: 78.4787, zone: "Tank Bund", status: "degraded", fps: 11, resolution: "1080p", lastHour: 740, today: 15260, ocrRate: 88.4, latencyMs: 198, uptime: 97.6, lastPlate: "TS07HB5503", lastSeen: "18:44:29", videoFeed: "/camera-feeds/CAM-403.mp4", note: "Lens fogging after evening drizzle — reads intermittent" },
  { id: "CAM #419", name: "Abids GPO Circle", lat: 17.3928, lng: 78.4757, zone: "Abids", status: "online", fps: 25, resolution: "1080p", lastHour: 1840, today: 25930, ocrRate: 93.8, latencyMs: 47, uptime: 99.5, lastPlate: "TS11EQ8820", lastSeen: "18:44:55", videoFeed: "/camera-feeds/CAM-401.mp4" },
  { id: "CAM #420", name: "Koti Junction", lat: 17.3855, lng: 78.4864, zone: "Koti", status: "online", fps: 25, resolution: "1080p", lastHour: 1790, today: 24980, ocrRate: 93.5, latencyMs: 49, uptime: 99.4, lastPlate: "TS11UD4471", lastSeen: "18:44:57", videoFeed: "/camera-feeds/CAM-402.mp4" },
  { id: "CAM #421", name: "Charminar", lat: 17.3616, lng: 78.4747, zone: "Old City", status: "online", fps: 25, resolution: "4K", lastHour: 1530, today: 21640, ocrRate: 92.9, latencyMs: 52, uptime: 99.3, lastPlate: "TS13EK0925", lastSeen: "18:44:54", videoFeed: "/camera-feeds/CAM-403.mp4" },
  { id: "CAM #422", name: "Mehdipatnam Rythu Bazar", lat: 17.3917, lng: 78.4397, zone: "Mehdipatnam", status: "online", fps: 25, resolution: "1080p", lastHour: 1880, today: 26170, ocrRate: 94.3, latencyMs: 44, uptime: 99.6, lastPlate: "TS13UC3368", lastSeen: "18:44:58", videoFeed: "/camera-feeds/CAM-401.mp4" },
  { id: "CAM #423", name: "Tarnaka", lat: 17.4287, lng: 78.5383, zone: "Tarnaka", status: "online", fps: 25, resolution: "1080p", lastHour: 1410, today: 20060, ocrRate: 94.8, latencyMs: 42, uptime: 99.7, lastPlate: "TS08UE7715", lastSeen: "18:44:56", videoFeed: "/camera-feeds/CAM-402.mp4" },
  { id: "CAM #424", name: "Dilsukhnagar", lat: 17.3688, lng: 78.5247, zone: "Dilsukhnagar", status: "online", fps: 30, resolution: "4K", lastHour: 2010, today: 28320, ocrRate: 95.4, latencyMs: 39, uptime: 99.8, lastPlate: "TS07FT2248", lastSeen: "18:44:59", videoFeed: "/camera-feeds/CAM-403.mp4" },
];

export const cameraRegistry = REGISTRY.map((c) => ({ ...c, code: c.id.replace(" #", "-") }));

export const cameraById = Object.fromEntries(cameraRegistry.map((c) => [c.id, c]));

export const systemMetrics = {
  totalNodesActive: 254, // city-wide ANPR nodes (the registry above is 24 of them)
};

// ─── Hourly network profile for the cluster (00:00–23:00) ─────────────────
// flow: vehicles/hour · density: % of road capacity · speed: km/h · delay: avg minutes lost per trip
// Morning peak ~09:00, midday plateau, evening peak ~18:00, night decline. Density and delay rise
// exactly where speed falls.
const FLOW = [2100, 1500, 1100, 900, 1200, 2800, 5600, 9400, 13200, 14100, 12000, 10400, 9800, 9900, 10100, 10900, 12600, 14800, 16200, 15100, 11800, 8300, 5400, 3400];
const DENSITY = [12, 9, 6, 5, 7, 16, 32, 54, 76, 81, 69, 60, 56, 57, 58, 62, 72, 85, 93, 87, 67, 47, 31, 19];
const SPEED = [48, 50, 52, 52, 51, 47, 42, 35, 27, 25, 30, 33, 34, 34, 33, 32, 28, 22, 18, 21, 30, 37, 43, 46];
const DELAY = [0.5, 0.3, 0.2, 0.2, 0.3, 0.9, 2.4, 5.8, 10.9, 12.4, 8.1, 6.0, 5.3, 5.4, 5.7, 6.6, 9.2, 14.8, 18.6, 15.3, 7.9, 4.1, 2.0, 1.0];

export const hourlyTraffic = FLOW.map((flow, h) => ({
  hour: `${String(h).padStart(2, "0")}:00`,
  flow,
  density: DENSITY[h],
  speed: SPEED[h],
  delay: DELAY[h],
}));

// ─── Junction readings at the snapshot (density % of capacity, speed km/h) ──
// The live simulation drifts these; corridors reuse their first camera's reading so the
// Dashboard node and the Traffic corridor always agree.
export const junctionReadings = {
  "CAM #401": { speed: 14, density: 91, trend: "Severe gridlock", change: "+18%" },
  "CAM #402": { speed: 16, density: 88, trend: "Heavy congestion", change: "+15%" },
  "CAM #406": { speed: 19, density: 84, trend: "IT outflow surge", change: "+44%" },
  "CAM #403": { speed: 27, density: 68, trend: "Moderate flow", change: "+6%" },
  "CAM #411": { speed: 29, density: 62, trend: "Moderate flow", change: "+4%" },
  "CAM #407": { speed: 33, density: 55, trend: "Steady flow", change: "+3%" },
  "CAM #405": { speed: 39, density: 42, trend: "Free flow", change: "-2%" },
  "CAM #419": { speed: 13, density: 88, trend: "Heavy congestion", change: "+16%" },
  "CAM #413": { speed: 18, density: 82, trend: "Metro interchange surge", change: "+12%" },
  "CAM #417": { speed: 20, density: 79, trend: "Heavy congestion", change: "+9%" },
  "CAM #422": { speed: 24, density: 71, trend: "Moderate flow", change: "+4%" },
  "CAM #415": { speed: 26, density: 64, trend: "Moderate flow", change: "+5%" },
  "CAM #423": { speed: 31, density: 58, trend: "Steady flow", change: "+2%" },
};

// ─── Corridors (Traffic page) — tied to registry cameras ──────────────────
export const corridorsFeed = [
  { id: "COR-01", name: "Kukatpally Y-Junction ⇄ JNTU", cameras: ["CAM #401", "CAM #402"], status: "Severe", density: 91, speed: 14, volume: 2640, trend: "+18%", lat: 17.4947, lng: 78.3996, color: "#ef4444", bottleneck: "Signal queue spill-back at Y-Junction", length: "1.6 km", duration: "17 mins" },
  { id: "COR-02", name: "Hitech City – Madhapur IT Corridor", cameras: ["CAM #406", "CAM #410"], status: "High", density: 84, speed: 19, volume: 2380, trend: "+44%", lat: 17.4485, lng: 78.3742, color: "#f97316", bottleneck: "IT park outflow surge", length: "2.8 km", duration: "12 mins" },
  { id: "COR-03", name: "Balanagar – Bharat Nagar", cameras: ["CAM #403", "CAM #412"], status: "Moderate", density: 68, speed: 27, volume: 1720, trend: "+6%", lat: 17.4682, lng: 78.4357, color: "#eab308", bottleneck: "Heavy-vehicle merge at flyover ramp", length: "0.9 km", duration: "6 mins" },
  { id: "COR-04", name: "Miyapur X Roads – Nizampet", cameras: ["CAM #407", "CAM #408"], status: "Moderate", density: 55, speed: 33, volume: 1310, trend: "+3%", lat: 17.4966, lng: 78.3574, color: "#eab308", bottleneck: "Metro feeder buses at Miyapur", length: "0.6 km", duration: "4 mins" },
  { id: "COR-05", name: "Jubilee Hills Checkpost", cameras: ["CAM #405"], status: "Low", density: 42, speed: 39, volume: 1150, trend: "-2%", lat: 17.4325, lng: 78.4072, color: "#22c55e", bottleneck: "None", length: "0 km", duration: "0 mins" },
  { id: "COR-06", name: "Ameerpet – Panjagutta", cameras: ["CAM #413", "CAM #414"], status: "High", density: 82, speed: 18, volume: 2460, trend: "+12%", lat: 17.4317, lng: 78.4497, color: "#f97316", bottleneck: "Metro interchange crowds at Ameerpet", length: "1.3 km", duration: "9 mins" },
  { id: "COR-07", name: "Begumpet – Paradise Circle", cameras: ["CAM #415", "CAM #416"], status: "Moderate", density: 64, speed: 26, volume: 1880, trend: "+5%", lat: 17.4437, lng: 78.4759, color: "#eab308", bottleneck: "Airport-road merge at Begumpet flyover", length: "2.4 km", duration: "8 mins" },
  { id: "COR-08", name: "Khairatabad – Tank Bund", cameras: ["CAM #417", "CAM #418"], status: "High", density: 79, speed: 20, volume: 2210, trend: "+9%", lat: 17.4083, lng: 78.4708, color: "#f97316", bottleneck: "Signal cycle at Khairatabad flyover", length: "1.8 km", duration: "9 mins" },
  { id: "COR-09", name: "Abids – Koti", cameras: ["CAM #419", "CAM #420"], status: "Severe", density: 88, speed: 13, volume: 2050, trend: "+16%", lat: 17.3891, lng: 78.4810, color: "#ef4444", bottleneck: "Market-area parking spill-over", length: "1.2 km", duration: "10 mins" },
  { id: "COR-10", name: "Mehdipatnam – Charminar", cameras: ["CAM #422", "CAM #421"], status: "Moderate", density: 71, speed: 24, volume: 1640, trend: "+4%", lat: 17.3767, lng: 78.4572, color: "#eab308", bottleneck: "Two-wheeler weave near Charminar", length: "4.3 km", duration: "14 mins" },
  { id: "COR-11", name: "Tarnaka – Dilsukhnagar", cameras: ["CAM #423", "CAM #424"], status: "Moderate", density: 58, speed: 31, volume: 1420, trend: "+2%", lat: 17.3988, lng: 78.5315, color: "#eab308", bottleneck: "Inner Ring Road merge at Uppal", length: "6.4 km", duration: "13 mins" },
];

// ─── City zones (homepage map / dashboard) — counts sum to the 254-node network ──
export const areas = [
  { name: "Kukatpally", title: "Kukatpally – JNTU Zone", density: "High (91%)", speed: "14 km/h", cameras: "54 ANPR Cameras", status: "Severe congestion", color: "#ef4444", position: [17.4947, 78.3996] },
  { name: "Balanagar", title: "Balanagar Corridor", density: "Moderate (68%)", speed: "27 km/h", cameras: "38 ANPR Cameras", status: "Stable flow", color: "#eab308", position: [17.4682, 78.4357] },
  { name: "Cyberabad / Madhapur", title: "Hitech City – Madhapur", density: "High (84%)", speed: "19 km/h", cameras: "72 ANPR Cameras", status: "IT outflow surge", color: "#f97316", position: [17.4485, 78.3742] },
  { name: "Miyapur", title: "Miyapur – Nizampet", density: "Moderate (55%)", speed: "33 km/h", cameras: "41 ANPR Cameras", status: "Normal operations", color: "#eab308", position: [17.4966, 78.3574] },
  { name: "Jubilee Hills", title: "Jubilee Hills", density: "Low (42%)", speed: "39 km/h", cameras: "49 ANPR Cameras", status: "Free flow", color: "#22c55e", position: [17.4325, 78.4072] },
];

// ─── Alerts (fallback when the API is offline) — cameras/locations from the registry ──
const cam = (id) => `${cameraById[id].code} (${cameraById[id].name})`;

export const alertsFeed = [
  {
    id: "ALT-9041",
    plateNumber: "TS09EA4512",
    category: "Blacklisted Vehicle",
    type: "vehicle",
    severity: "CRITICAL",
    timestamp: "18:44 (1 min ago)",
    cameraId: "CAM #401",
    cameraNode: cam("CAM #401"),
    lat: cameraById["CAM #401"].lat,
    lng: cameraById["CAM #401"].lng,
    confidence: "97.9%",
    description: "Watchlist match: SUV reported stolen (FIR 1127/2026). Cross-camera trajectory tracking started.",
    status: "Active",
  },
  {
    id: "TRF-3012",
    plateNumber: "Kukatpally ⇄ JNTU",
    category: "High-Density Congestion",
    type: "traffic",
    severity: "CRITICAL",
    timestamp: "18:42 (3 mins ago)",
    cameraId: "CAM #402",
    corridorId: "COR-01",
    cameraNode: cam("CAM #402"),
    lat: cameraById["CAM #402"].lat,
    lng: cameraById["CAM #402"].lng,
    confidence: "91% density",
    description: "Density at 91% of capacity on COR-01; average speed down to 14 km/h and 17 min added delay.",
    status: "Active",
  },
  {
    id: "TRF-3015",
    plateNumber: "Hitech City Corridor",
    category: "Sudden Traffic Surge",
    type: "traffic",
    severity: "HIGH",
    timestamp: "18:38 (7 mins ago)",
    cameraId: "CAM #406",
    corridorId: "COR-02",
    cameraNode: cam("CAM #406"),
    lat: cameraById["CAM #406"].lat,
    lng: cameraById["CAM #406"].lng,
    confidence: "+44% volume",
    description: "Inflow 2,380 veh/h vs 1,650 veh/h typical for this hour. Signal re-timing recommended.",
    status: "Investigating",
  },
  {
    id: "ALT-9038",
    plateNumber: "AP28BK8821",
    category: "Trajectory Anomaly",
    type: "vehicle",
    severity: "HIGH",
    timestamp: "18:31 (14 mins ago)",
    cameraId: "CAM #412",
    cameraNode: cam("CAM #412"),
    lat: cameraById["CAM #412"].lat,
    lng: cameraById["CAM #412"].lng,
    confidence: "95.1%",
    description: "Expected hand-off to CAM-403 not observed within 6 min; vehicle deviated ~3 km from its usual route.",
    status: "Active",
  },
  {
    id: "ALT-9029",
    plateNumber: "MH04EF7710",
    category: "Unusual Stop / Loitering",
    type: "vehicle",
    severity: "MEDIUM",
    timestamp: "18:12 (33 mins ago)",
    cameraId: "CAM #405",
    cameraNode: cam("CAM #405"),
    lat: cameraById["CAM #405"].lat,
    lng: cameraById["CAM #405"].lng,
    confidence: "94.2%",
    description: "Vehicle stationary for 18 min in a no-stopping zone near the checkpost; cleared by patrol.",
    status: "Resolved",
  },
];

// Network traffic summary (mirrors backend traffic_metrics / od_routes; used when the API is offline)
export const trafficSummary = {
  networkAverageSpeed: "30 km/h", // 24h volume-weighted mean of hourlyTraffic
  odRoutes: [
    { origin: "Kukatpally", destination: "Balanagar", count: "1,842 vehicles" },
    { origin: "Balanagar", destination: "Madhapur", count: "1,426 vehicles" },
    { origin: "Kukatpally", destination: "Cyberabad", count: "2,103 vehicles" },
    { origin: "Miyapur", destination: "Madhapur", count: "1,268 vehicles" },
    { origin: "Ameerpet", destination: "Secunderabad", count: "1,634 vehicles" },
    { origin: "Mehdipatnam", destination: "Koti", count: "1,187 vehicles" },
    { origin: "Dilsukhnagar", destination: "Tarnaka", count: "962 vehicles" },
  ],
};
