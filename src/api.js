/**
 * TraceNet API Client
 * Fetches data from the FastAPI backend with graceful fallback to null.
 * When null is returned, callers fall back to existing local mock data.
 */

import { ensureSession, getToken, refreshSession } from "./auth";
import { API_BASE, BACKEND_ENABLED } from "./config";

// Tracker vehicle classes (backend/ai/vehicle_tracker.py CLASS_NAME_MAP) → the labels the UI shows.
// The UVH-26 detector adds auto_rickshaw; its LCV / mini-bus labels arrive already mapped to truck / bus.
const VEHICLE_CLASS_LABELS = {
  car: "Car",
  motorcycle: "Two-wheeler",
  auto_rickshaw: "Auto",
  bus: "Bus",
  truck: "Truck",
  bicycle: "Bicycle",
};

export function vehicleClassLabel(cls) {
  if (!cls) return "—";
  const key = String(cls).trim().toLowerCase();
  return VEHICLE_CLASS_LABELS[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

// Phase 6: every call carries the JWT (Authorization: Bearer …); a 401 re-authenticates once.
async function request(endpoint, { method = "GET", body, retry = true } = {}) {
  if (!BACKEND_ENABLED) throw new Error("No backend configured (VITE_API_BASE_URL)");
  const token = getToken() ?? (await ensureSession())?.token;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(method === "GET" ? 3000 : 8000),
  });
  if (res.status === 401 && retry && (await refreshSession())) return request(endpoint, { method, body, retry: false });
  return res;
}

async function apiFetch(endpoint) {
  try {
    const res = await request(endpoint);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Network error, timeout, or backend unavailable — silent fallback
    return null;
  }
}

/** Mutating call; returns { ok, status, data }. */
export async function apiSend(endpoint, method, body) {
  try {
    const res = await request(endpoint, { method, body });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

// <img src> cannot send headers: protected evidence images take the JWT as ?token=
const withToken = (url) => {
  const token = getToken();
  return url && token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url;
};

export async function fetchVehicles() {
  const data = await apiFetch("/api/vehicles");
  return data?.vehicles ?? null;
}

export async function fetchTraffic() {
  return apiFetch("/api/traffic");
}

export async function fetchTrafficCorridors() {
  const data = await apiFetch("/api/traffic/corridors");
  return data?.corridors ?? null;
}

export async function fetchTrafficOD() {
  const data = await apiFetch("/api/traffic/od");
  return data?.odRoutes ?? null;
}

export async function fetchAlerts() {
  const data = await apiFetch("/api/alerts");
  return data?.alerts ?? null;
}

export async function fetchCameras() {
  return apiFetch("/api/cameras");
}

/**
 * Phase 1 ingestion: real camera state from the backend ingestion layer.
 * Returns null when the backend is offline, so the UI keeps its local dataset.
 */
export async function fetchIngestionCameras() {
  const data = await apiFetch("/api/ingestion/cameras");
  return data?.cameras ?? null;
}

/**
 * Phase 2 ANPR: real observations produced by the ANPR pipeline for one camera.
 * Returns null when the backend is offline or the camera has no ANPR run yet.
 */
export async function fetchCameraAnpr(cameraId) {
  return apiFetch(`/api/cameras/${encodeURIComponent(cameraId)}/anpr`);
}

export const anprEvidenceUrl = (path) => (path ? withToken(`${API_BASE}${path}`) : null);

/** Map one ANPR observation onto the OCRPanel's `ocrData` shape (real reads only). */
export function anprToOcrEvidence(obs) {
  if (!obs?.reads?.length) return null;
  return {
    candidateFrames: obs.reads.map((r, i) => ({
      id: i + 1,
      camera: obs.camera_id,
      time: r.timestamp?.slice(11, 19),
      qualityScore: Math.round(r.q_score * 1000) / 10,
      selected: r.usable && r.corrected_text === obs.consensus_text,
      ocrOutput: r.corrected_text || "—",
      ocrConfidence: r.final_confidence * 100,
      cropUrl: anprEvidenceUrl(r.crop_url),
    })),
    consensusPlate: obs.plate ?? obs.consensus_text ?? "—",
    consensusConfidence: obs.ocr_confidence != null ? obs.ocr_confidence * 100 : "—",
    validated: obs.plate_status === "DETECTED",
    status: obs.plate_status,
  };
}

/* ─── Phase 4: PostGIS-backed trajectories ─────────────────────────────────── */

export const apiUrl = (path) => (path ? withToken(`${API_BASE}${path}`) : null);

/** { database: "ok" | "unavailable", … } or null when the backend is offline. */
export async function fetchDbHealth() {
  return apiFetch("/api/v1/db/health");
}

/** Real journey from PostGIS (audited server-side under the JWT user). null when not found / offline. */
export async function fetchTrajectory(plate, reason = "Trace Vehicle (Tracking page)") {
  const qs = new URLSearchParams({ reason });
  return apiFetch(`/api/v1/vehicles/${encodeURIComponent(plate)}/trajectory?${qs}`);
}

/** Fuzzy plate search (pg_trgm + levenshtein). */
export async function searchPlates(q, reason = "Did-you-mean lookup (Tracking page)") {
  const qs = new URLSearchParams({ q, reason, limit: "6" });
  return apiFetch(`/api/v1/search?${qs}`);
}

/** Stored journeys, multi-camera first. */
export async function fetchStoredTrajectories(limit = 60) {
  return apiFetch(`/api/v1/trajectories?limit=${limit}`);
}

const COMPASS = ["North", "North-East", "East", "South-East", "South", "South-West", "West", "North-West"];

function compass(from, to) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(to.lon - from.lon)) * Math.cos(toRad(to.lat));
  const x = Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) - Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lon - from.lon));
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(bearing / 45) % 8];
}

function duration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

const pct = (v) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—");

/**
 * Map a /api/v1/vehicles/{plate}/trajectory response onto the Tracking page's vehicle shape.
 * Uses the journey with the most observations (latest on ties). Returns null when the plate
 * has no fused journey (e.g. only backdrop sightings).
 */
export function trajectoryToVehicle(data) {
  const journey = [...(data?.trajectories ?? [])].sort((a, b) => b.observation_count - a.observation_count)[0];
  if (!journey) return null;
  const wps = data.waypoints.filter((w) => w.trajectory_id === journey.trajectory_id);
  if (!wps.length) return null;

  const legSpeeds = wps.slice(1).map((w) => w.speed_from_prev_kmh ?? 0);
  const alert = data.alerts?.[0];
  const cloned = journey.is_cloned_alert;
  const hops = wps.map((w, i) => [
    w.camera_code.replace("-", " #"), // registry id format (CAM #401)
    w.junction_name,
    w.observed_at.slice(11, 19),
    i === 0 ? "—" : `${Math.round(w.speed_from_prev_kmh ?? 0)} km/h`,
    pct(w.confidence),
    i === 0 ? "—" : compass(wps[i - 1], w),
    i === 0 ? "0 km" : `${(w.distance_from_prev_km ?? 0).toFixed(1)} km`,
    w.lat,
    w.lon,
    apiUrl(w.crop_path),
    { plate: w.plate_number, flag: w.integrity_flags, source: w.source, observedAt: w.observed_at, match: w.match },
  ]);
  const cams = new Set(wps.map((w) => w.camera_code));
  const fusionScores = wps.map((w) => w.match?.link === "fusion" && w.match?.score).filter(Boolean);
  const confidences = wps.map((w) => w.confidence).filter((c) => c > 0);
  const status = cloned ? "CLONED PLATE" : journey.source === "simulated" ? "SIMULATED" : journey.source === "seed_backdrop" ? "SYNTHETIC" : journey.status;

  return {
    real: true,
    source: journey.source,
    trajectoryId: journey.trajectory_id,
    geojson: journey.geojson ? { type: "Feature", geometry: journey.geojson, properties: { trajectory_id: journey.trajectory_id } } : null,
    plate: data.plate,
    globalId: `${journey.global_vehicle_id.slice(0, 8)}…${journey.global_vehicle_id.slice(-4)}`,
    type: vehicleClassLabel(wps.find((w) => w.vehicle_class)?.vehicle_class),
    color: "—",
    confidence: confidences.length ? pct(Math.max(...confidences)) : "—",
    status,
    badge: cloned
      ? "bg-red-500/10 text-red-600 border-red-500/20"
      : journey.source === "simulated" || journey.source === "seed_backdrop"
      ? "bg-purple-500/10 text-purple-600 border-purple-500/20"
      : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    expected: "No expected-route model yet",
    actual: hops.map((h) => h[1]).join(" → "),
    cloned,
    deviation: cloned && alert
      ? `Cloned plate: ${alert.camera_a} → ${alert.camera_b} needs ${Math.round(alert.implied_speed_kmh)} km/h (${alert.road_distance_km} km in ${alert.time_delta_seconds} s)`
      : "None detected",
    deviationSegs: cloned ? legSpeeds.map((s, i) => (s > 150 ? i : -1)).filter((i) => i >= 0) : [],
    stats: [
      String(cams.size),
      `${journey.total_distance_km.toFixed(1)} km`,
      duration((wps.at(-1).epoch - wps[0].epoch) || 0),
      `${Math.round(journey.average_speed_kmh)} km/h`,
    ],
    reid: fusionScores.length ? pct(Math.max(...fusionScores)) : "—",
    transitions: String(Math.max(0, wps.length - 1)),
    fastest: legSpeeds.length ? `${Math.round(Math.max(...legSpeeds))} km/h` : "—",
    slowest: legSpeeds.length ? `${Math.round(Math.min(...legSpeeds))} km/h` : "—",
    hops,
    audit: data.audit,
    queryMs: data.query_ms,
  };
}

/* ─── Phase 5: Polars macro analytics (summary tables, refreshed in the background) ─── */

export async function fetchHeatmap(window = "24h") {
  return apiFetch(`/api/v1/geo/heatmap?window=${window}`);
}

export async function fetchOdMatrix() {
  return apiFetch("/api/v1/analytics/od-matrix");
}

export async function fetchAnalyticsSummary() {
  return apiFetch("/api/v1/analytics/summary");
}

export async function fetchHourlySeries(camera) {
  return apiFetch(`/api/v1/analytics/hourly${camera ? `?camera=${encodeURIComponent(camera)}` : ""}`);
}

/** Everything the Traffic / Dashboard pages need; null when the analytics backend is unavailable. */
export async function fetchMacroAnalytics() {
  const [heat, latest, od, summary, hourly] = await Promise.all([
    fetchHeatmap("24h"),
    fetchHeatmap("latest"),
    fetchOdMatrix(),
    fetchAnalyticsSummary(),
    fetchHourlySeries(),
  ]);
  if (!heat?.features?.length || !summary) return null;
  return { heat, latest, od, summary, hourly: hourly?.series ?? [] };
}

// BCI bands used by both pages: red ≥ 0.70 (severe), orange ≥ 0.55, yellow ≥ 0.40, green below
export const bciStatus = (bci) => (bci == null ? "No data" : bci >= 0.7 ? "Severe" : bci >= 0.55 ? "High" : bci >= 0.4 ? "Moderate" : "Low");
export const BCI_COLOR = { Severe: "#ef4444", High: "#f97316", Moderate: "#eab308", Low: "#22c55e", "No data": "#94a3b8" };

/* ─── Phase 6: live alerts & watchlist ─── */

export async function addToWatchlist(plate, reason, threatLevel = "HIGH") {
  return apiSend("/api/v1/watchlist", "POST", { plate, reason, threat_level: threatLevel });
}

export async function fetchDashboard() {
  return apiFetch("/api/dashboard");
}

// ─── Live CCTV (MediaMTX restream) ───────────────────────────────────────────

/** GET /api/v1/streams → { streams: [{ camera_id, live, hls_url, rtsp_url, webrtc_url, origin }] } or null */
export async function fetchStreams() {
  return apiFetch("/api/v1/streams");
}

// ─── Admin console (camera_admin) ────────────────────────────────────────────

export const fetchAdminUsers = () => apiFetch("/api/v1/admin/users");
export const createAdminUser = (user) => apiSend("/api/v1/admin/users", "POST", user);
export const updateAdminUser = (username, changes) => apiSend(`/api/v1/admin/users/${encodeURIComponent(username)}`, "PATCH", changes);
export const fetchPermissionMatrix = () => apiFetch("/api/v1/admin/permissions");
export const fetchAdminEvents = (limit = 20) => apiFetch(`/api/v1/admin/events?limit=${limit}`);
export const fetchPipelineStatus = () => apiFetch("/api/v1/pipeline/status");
export const fetchAnalyticsRuns = () => apiFetch("/api/v1/analytics/runs");
export const refreshAnalytics = () => apiSend("/api/v1/analytics/refresh", "POST");
/** Start / stop one camera's ingestion worker (camera_admin). */
export const controlCamera = (cameraId, action) => apiSend(`/api/ingestion/cameras/${encodeURIComponent(cameraId)}/${action}`, "POST");
