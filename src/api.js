/**
 * TraceNet API Client
 * Fetches data from the FastAPI backend with graceful fallback to null.
 * When null is returned, callers fall back to existing local mock data.
 */

const API_BASE = "http://localhost:8000";

async function apiFetch(endpoint) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Network error, timeout, or backend unavailable — silent fallback
    return null;
  }
}

export async function fetchHealth() {
  return apiFetch("/api/health");
}

export async function fetchVehicles() {
  const data = await apiFetch("/api/vehicles");
  return data?.vehicles ?? null;
}

export async function fetchVehicle(plate) {
  return apiFetch(`/api/vehicles/${encodeURIComponent(plate)}`);
}

export async function fetchVehicleTrajectory(plate) {
  return apiFetch(`/api/vehicles/${encodeURIComponent(plate)}/trajectory`);
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

export async function fetchDashboard() {
  return apiFetch("/api/dashboard");
}
