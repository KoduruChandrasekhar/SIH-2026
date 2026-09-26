import { useCallback, useEffect, useRef, useState } from "react";
import { TOMTOM_API_KEY } from "./config";
import { cameraRegistry } from "../data/data";

/**
 * Live traffic analytics from TomTom (needs VITE_TOMTOM_API_KEY):
 *   Traffic Flow — current vs free-flow speed, travel times and closures on the road at each camera junction
 *   Traffic Incidents — jams, closures, accidents and roadworks inside the camera cluster
 * One refresh = one flow request per junction + one incident request; refreshed every 5 min while the tab is
 * visible and cached in localStorage so page switches and reloads do not re-query. Each refresh also adds a
 * network sample to a rolling 24 h trend kept in this browser.
 */
export const LIVE_ANALYTICS = Boolean(TOMTOM_API_KEY);

const FLOW_URL = "https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/12/json";
const INCIDENT_URL = "https://api.tomtom.com/traffic/services/5/incidentDetails";
const REFRESH_MS = 5 * 60 * 1000;
const MIN_MANUAL_MS = 60 * 1000; // a manual refresh never re-queries more than once a minute
const CACHE_KEY = "tn.liveTraffic.v1";
const HISTORY_KEY = "tn.liveTraffic.history.v1";
const HISTORY_MS = 24 * 3600 * 1000;

// bounding box around the cluster (lon/lat) with a small margin
const BBOX = (() => {
  const lats = cameraRegistry.map((c) => c.lat);
  const lngs = cameraRegistry.map((c) => c.lng);
  const pad = 0.02;
  return [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad];
})();

// TomTom incident iconCategory → label / group
const INCIDENT_TYPES = {
  1: { label: "Accident", group: "accident" },
  6: { label: "Traffic jam", group: "jam" },
  7: { label: "Lane closed", group: "closure" },
  8: { label: "Road closed", group: "closure" },
  9: { label: "Roadworks", group: "works" },
  14: { label: "Broken-down vehicle", group: "accident" },
  11: { label: "Flooding", group: "hazard" },
  3: { label: "Dangerous conditions", group: "hazard" },
};
const MAGNITUDE = { 0: "Unknown", 1: "Minor", 2: "Moderate", 3: "Major", 4: "Closure" };

const readJSON = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJSON = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked — live data still works, just uncached */
  }
};

async function fetchFlow(cam) {
  const url = `${FLOW_URL}?point=${cam.lat},${cam.lng}&unit=KMPH&key=${encodeURIComponent(TOMTOM_API_KEY)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`TomTom flow ${res.status}`);
  const f = (await res.json()).flowSegmentData;
  return {
    camera: cam.id,
    code: cam.code,
    name: cam.name,
    zone: cam.zone,
    lat: cam.lat,
    lng: cam.lng,
    roadClass: f.frc,
    speed: f.currentSpeed,
    freeFlow: f.freeFlowSpeed,
    travelTime: f.currentTravelTime,
    freeTravelTime: f.freeFlowTravelTime,
    confidence: f.confidence,
    closed: Boolean(f.roadClosure),
  };
}

async function fetchIncidents() {
  const params = new URLSearchParams({
    key: TOMTOM_API_KEY,
    bbox: BBOX.join(","),
    fields: "{incidents{geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,delay,length,from,to,events{description}}}}",
    language: "en-GB",
    timeValidityFilter: "present",
  });
  const res = await fetch(`${INCIDENT_URL}?${params}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`TomTom incidents ${res.status}`);
  const data = await res.json();
  return (data.incidents ?? []).map((i, idx) => {
    const p = i.properties ?? {};
    const type = INCIDENT_TYPES[p.iconCategory] ?? { label: "Incident", group: "other" };
    const coords = i.geometry?.type === "Point" ? [i.geometry.coordinates] : i.geometry?.coordinates ?? [];
    return {
      id: p.id ?? `inc-${idx}`,
      label: type.label,
      group: type.group,
      magnitude: MAGNITUDE[p.magnitudeOfDelay] ?? "Unknown",
      magnitudeLevel: p.magnitudeOfDelay ?? 0,
      delay: p.delay ?? 0,
      length: p.length ?? 0,
      from: p.from,
      to: p.to,
      description: p.events?.[0]?.description ?? type.label,
      lat: coords[0]?.[1],
      lng: coords[0]?.[0],
    };
  });
}

/** Network-level numbers from the junction probes (plain means across the junction roads). */
export function networkSummary(probes) {
  const open = probes.filter((p) => p.speed != null && p.freeFlow);
  if (!open.length) return null;
  const speed = open.reduce((s, p) => s + p.speed, 0) / open.length;
  const freeFlow = open.reduce((s, p) => s + p.freeFlow, 0) / open.length;
  const delay = open.reduce((s, p) => s + Math.max(0, (p.travelTime ?? 0) - (p.freeTravelTime ?? 0)), 0);
  return {
    speed,
    freeFlow,
    congestion: Math.max(0, Math.round((1 - speed / freeFlow) * 100)),
    delay,
    closed: probes.filter((p) => p.closed).length,
    confidence: open.reduce((s, p) => s + (p.confidence ?? 0), 0) / open.length,
  };
}

/** Status from how far current speed has fallen below free flow (TomTom's relative-speed idea). */
function statusForRatio(ratio, closed) {
  if (closed || ratio < 0.5) return "Severe";
  if (ratio < 0.7) return "High";
  if (ratio < 0.85) return "Moderate";
  return "Low";
}

/** Live readings for one corridor from the probes at its cameras (null when none are available). */
export function corridorLive(corridor, probesByCamera) {
  const probes = (corridor.cameras ?? []).map((id) => probesByCamera[id]).filter(Boolean);
  if (!probes.length) return null;
  const s = networkSummary(probes);
  if (!s) return null;
  const closed = probes.some((p) => p.closed);
  const ratio = s.speed / s.freeFlow;
  return {
    speed: Math.round(s.speed),
    freeFlow: Math.round(s.freeFlow),
    congestion: s.congestion,
    delay: Math.round(s.delay),
    closed,
    status: statusForRatio(ratio, closed),
    confidence: s.confidence,
  };
}

export function useLiveTraffic() {
  const cached = useRef(readJSON(CACHE_KEY, null));
  const [state, setState] = useState(() => ({
    status: cached.current ? "ok" : LIVE_ANALYTICS ? "loading" : "off",
    probes: cached.current?.probes ?? [],
    incidents: cached.current?.incidents ?? [],
    updatedAt: cached.current?.updatedAt ?? null,
    error: null,
    history: readJSON(HISTORY_KEY, []),
  }));
  const busy = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (!LIVE_ANALYTICS || busy.current) return;
    const last = readJSON(CACHE_KEY, null);
    const age = last ? Date.now() - last.updatedAt : Infinity;
    if (age < (force ? MIN_MANUAL_MS : REFRESH_MS)) {
      setState((s) => ({ ...s, status: "ok", probes: last.probes, incidents: last.incidents, updatedAt: last.updatedAt }));
      return;
    }
    busy.current = true;
    setState((s) => ({ ...s, status: s.probes.length ? "refreshing" : "loading", error: null }));
    try {
      const [flows, incidents] = await Promise.all([
        Promise.allSettled(cameraRegistry.map(fetchFlow)),
        fetchIncidents().catch(() => null),
      ]);
      const probes = flows.filter((r) => r.status === "fulfilled").map((r) => r.value);
      if (!probes.length) throw new Error(flows.find((r) => r.status === "rejected")?.reason?.message ?? "No live readings");
      const updatedAt = Date.now();
      const entry = { probes, incidents: incidents ?? last?.incidents ?? [], updatedAt };
      writeJSON(CACHE_KEY, entry);
      const summary = networkSummary(probes);
      const history = [...readJSON(HISTORY_KEY, []), { t: updatedAt, speed: +summary.speed.toFixed(1), freeFlow: +summary.freeFlow.toFixed(1), congestion: summary.congestion }]
        .filter((h) => updatedAt - h.t < HISTORY_MS);
      writeJSON(HISTORY_KEY, history);
      setState({ status: "ok", ...entry, history, error: null });
    } catch (err) {
      setState((s) => ({ ...s, status: s.probes.length ? "ok" : "error", error: err.message }));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (!LIVE_ANALYTICS) return undefined;
    refresh();
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, 30000); // checks often, but only queries TomTom once the cached reading is older than REFRESH_MS
    const onVisible = () => !document.hidden && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { ...state, refresh: () => refresh(true) };
}
