/**
 * TraceNet live simulation — ONE shared, controlled data source for "live" behaviour.
 *
 * Every page reads the same state, so CAM-401 on the Dashboard, COR-01 on Traffic and the
 * Cameras wall always agree. It ticks every TICK_MS only while at least one component is
 * subscribed and the tab is visible. The clock starts at the dataset's SNAPSHOT_TIME and
 * advances in real time.
 *
 * Rules (so the numbers stay plausible):
 *  - junction density does a mean-reverting random walk (±5 points around its reading)
 *  - speed responds inversely to density (≈0.45 km/h per density point)
 *  - corridors take the drift of their first camera
 *  - online cameras accumulate plate reads at their hourly rate; the degraded one at a
 *    reduced rate; the offline one is frozen (its "last seen" age keeps growing)
 */
import { useSyncExternalStore } from "react";
import { SNAPSHOT_TIME, cameraRegistry, corridorsFeed, hourlyTraffic, junctionReadings } from "../data/data";

const TICK_MS = 5000;

const toSec = (hms) => hms.split(":").reduce((acc, v) => acc * 60 + Number(v), 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;

const START_SEC = toSec(`${SNAPSHOT_TIME}:00`);
const NOW_HOUR = hourlyTraffic[Math.floor(START_SEC / 3600)];

function initialState() {
  const junctions = Object.fromEntries(
    Object.entries(junctionReadings).map(([id, r]) => [id, { density: r.density, speed: r.speed, dev: 0 }])
  );
  const cameras = Object.fromEntries(
    cameraRegistry.map((c) => [
      c.id,
      {
        status: c.status,
        lastHour: c.lastHour,
        today: c.today,
        fps: c.fps,
        lastReadSec: c.status === "offline" ? toSec(c.lastSeen) : START_SEC - 1,
        lastPlate: c.lastPlate,
      },
    ])
  );
  return {
    tick: 0,
    simSec: START_SEC,
    junctions,
    cameras,
    corridors: Object.fromEntries(corridorsFeed.map((c) => [c.id, { density: c.density, speed: c.speed, volume: c.volume }])),
    network: { speed: NOW_HOUR.speed, flow: NOW_HOUR.flow, density: NOW_HOUR.density, delay: NOW_HOUR.delay },
    prevNetwork: null,
    activityCamera: null, // camera that just produced a burst of reads (drives one map ring)
  };
}

let state = initialState();
const listeners = new Set();
let timer = null;
const startedAt = Date.now();

const PLATE_SERIES = ["TS07", "TS08", "TS09", "TS10", "TS15", "AP28", "KA05"];
const randomPlate = () =>
  `${PLATE_SERIES[Math.floor(Math.random() * PLATE_SERIES.length)]}${String.fromCharCode(65 + Math.floor(Math.random() * 26), 65 + Math.floor(Math.random() * 26))}${1000 + Math.floor(Math.random() * 9000)}`;

function step() {
  const prev = state;
  const simSec = START_SEC + Math.round((Date.now() - startedAt) / 1000);
  const dt = Math.max(1, simSec - prev.simSec);

  // Junctions: mean-reverting drift, speed follows density inversely
  const junctions = {};
  for (const [id, r] of Object.entries(junctionReadings)) {
    const p = prev.junctions[id];
    const dev = clamp(p.dev * 0.75 + (Math.random() - 0.5) * 3, -5, 5);
    const density = clamp(Math.round(r.density + dev), 5, 98);
    junctions[id] = { density, speed: Math.max(5, Math.round(r.speed + (r.density - density) * 0.45)), dev };
  }

  const corridors = {};
  for (const c of corridorsFeed) {
    const dev = junctions[c.cameras[0]]?.dev ?? 0;
    const density = clamp(Math.round(c.density + dev), 5, 98);
    corridors[c.id] = {
      density,
      speed: Math.max(5, Math.round(c.speed + (c.density - density) * 0.45)),
      volume: Math.round(c.volume * (1 + (density - c.density) * 0.008)),
    };
  }

  // Cameras: reads accumulate only while the camera is up
  const cameras = {};
  const candidates = [];
  for (const c of cameraRegistry) {
    const p = prev.cameras[c.id];
    if (c.status === "offline") {
      cameras[c.id] = p;
      continue;
    }
    const lastHour = Math.round(c.lastHour * (1 + (Math.random() - 0.5) * 0.03));
    const expected = (lastHour / 3600) * dt;
    const reads = Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0);
    const gap = 3600 / Math.max(lastHour, 1);
    cameras[c.id] = {
      ...p,
      lastHour,
      today: p.today + reads,
      fps: c.status === "degraded" ? clamp(c.fps + Math.round((Math.random() - 0.5) * 3), 9, 14) : c.fps,
      lastReadSec: reads > 0 ? simSec - Math.floor(Math.random() * Math.min(gap, 3)) : p.lastReadSec,
      lastPlate: reads > 0 ? randomPlate() : p.lastPlate,
    };
    if (c.status === "online") candidates.push(c.id);
  }

  // Network KPIs follow the mean junction drift
  const meanDev = Object.values(junctions).reduce((s, j) => s + j.dev, 0) / Object.keys(junctions).length;
  const density = clamp(round1(NOW_HOUR.density + meanDev * 0.8), 5, 99);
  const network = {
    density,
    speed: round1(Math.max(5, NOW_HOUR.speed + (NOW_HOUR.density - density) * 0.45)),
    flow: Math.round(NOW_HOUR.flow * (1 + (density - NOW_HOUR.density) * 0.006) + (Math.random() - 0.5) * 60),
    delay: round1(Math.max(0, NOW_HOUR.delay + (density - NOW_HOUR.density) * 0.35)),
  };

  state = {
    tick: prev.tick + 1,
    simSec,
    junctions,
    cameras,
    corridors,
    network,
    prevNetwork: prev.network,
    activityCamera: candidates[Math.floor(Math.random() * candidates.length)] ?? null,
  };
  listeners.forEach((l) => l());
}

function onVisibility() {
  if (document.hidden) stopTimer();
  else if (listeners.size) startTimer();
}

function startTimer() {
  if (!timer) timer = setInterval(step, TICK_MS);
}
function stopTimer() {
  clearInterval(timer);
  timer = null;
}

function subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) startTimer();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

const getSnapshot = () => state;

export function useLiveSim() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ── helpers for consumers ───────────────────────────────────────────
/** Current simulated time of day in seconds (advances 1:1 from SNAPSHOT_TIME). */
export const simNowSec = () => START_SEC + Math.round((Date.now() - startedAt) / 1000);

export const formatClock = (sec) =>
  [Math.floor(sec / 3600) % 24, Math.floor((sec % 3600) / 60), sec % 60].map((v) => String(v).padStart(2, "0")).join(":");

export const formatAge = (sec) => {
  if (sec < 60) return `${Math.max(0, sec)}s ago`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m ago` : `${m}m ${String(sec % 60).padStart(2, "0")}s ago`;
};

/** Percent change between two numbers (null when there is no previous value). */
export const pctChange = (now, prev) => (prev == null || prev === 0 ? null : ((now - prev) / prev) * 100);
