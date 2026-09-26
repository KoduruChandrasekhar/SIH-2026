import { useState, useEffect, useRef, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Camera,
  Gauge,
  Map as MapIcon,
  MapPin,
  TrendingUp,
  ScanLine,
  Cctv,
  ArrowRight,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
  ReferenceLine,
} from "recharts";
import { MapContainer, TileLayer, Tooltip as MapTooltip, CircleMarker, Circle, Polyline, useMap } from "react-leaflet";
import Navbar from "../components/layout/Navbar";
import { ChartTooltip, hourTicks, useChartTheme } from "../components/charts/ChartKit";
import { AnimatedNumber, Delta, MapBoundary, useFlash } from "../components/motion/Motion";
import { fetchDashboard, fetchMacroAnalytics } from "../lib/api";
import { OCR_ACCURACY_TARGET, SNAPSHOT_TIME, alertsFeed, cameraById, cameraRegistry, hourlyTraffic, junctionReadings } from "../data/data";
import { CAMERA_NETWORK_NODES, CAMERA_NETWORK_EDGES } from "../data/demoData";
import { formatClock, pctChange, simNowSec, useLiveSim } from "../sim/liveSim";

// --- LOCAL DATA (fallback) ---
// Key junction cameras from the shared registry; live readings come from the shared simulation
// (src/sim/liveSim.js), so these nodes always match the Traffic corridors and the Cameras wall.
const localCamerasData = Object.entries(junctionReadings).map(([camId, r]) => {
  const c = cameraById[camId];
  return {
    id: `${c.code} (${c.name})`,
    camId,
    code: c.code,
    name: c.name,
    zone: c.zone,
    lat: c.lat,
    lng: c.lng,
    speed: String(r.speed),
    densityValue: r.density,
    trend: r.trend,
    trafficChange: r.change,
    since: "5 PM",
  };
});

// Backend trend series ({time, volume|density|delay}) are normalised to the hourly shape
const normaliseTrend = (rows, key, target) => rows?.map((r) => ({ hour: r.time ?? r.hour, [target]: r[key] ?? r[target] }));

const densityColor = (d) => (d > 80 ? "#ef4444" : d > 50 ? "#f97316" : "#10b981");
const densityStatus = (d) => (d > 80 ? "High" : d > 50 ? "Med" : "Low");
// Phase 5 (real data): BCI % — red ≥ 70 (severe), orange ≥ 40, green below
const bciColor = (b) => (b == null ? "#94a3b8" : b >= 70 ? "#ef4444" : b >= 40 ? "#f97316" : "#10b981");
const bciLabel = (b) => (b == null ? "No speed data" : b >= 70 ? "Severe" : b >= 40 ? "Moderate" : "Free flow");
const hhmm = (iso) => (iso ? iso.slice(11, 16) : "—");

// Polars heatmap features → the dashboard's camera-node shape (latest hour, else 24 h rollup)
function macroToNodes(macro) {
  const latest = Object.fromEntries((macro.latest?.features ?? []).map((f) => [f.properties.camera_id, f.properties]));
  return macro.heat.features.map((f) => {
    const day = f.properties;
    const now = latest[day.camera_id];
    const p = now && now.bci_score != null ? now : day;
    const [lng, lat] = f.geometry.coordinates;
    return {
      id: day.camera_id,
      camId: day.camera_id.replace("-", " #"),
      code: day.camera_id,
      name: day.camera_name,
      zone: day.road_name,
      lat,
      lng,
      real: true,
      speed: p.avg_speed != null ? String(Math.round(p.avg_speed)) : "—",
      densityValue: p.bci_score != null ? Math.round(p.bci_score * 100) : null,
      trend: p === now ? `hour from ${hhmm(day.latest_hour)}` : "24 h rollup",
      trafficChange: `${day.vehicle_count} veh`,
      since: "the last 24 h",
      peak: day.peak_bci != null ? `${hhmm(day.peak_hour)} · BCI ${day.peak_bci.toFixed(2)}` : null,
    };
  });
}
const NOW_HOUR = Number(SNAPSHOT_TIME.slice(0, 2));

// Flow lines between connected cameras (demo network edges)
const flowLineEdges = CAMERA_NETWORK_EDGES.map(([fromId, toId]) => {
  const from = CAMERA_NETWORK_NODES.find((n) => n.id === fromId);
  const to = CAMERA_NETWORK_NODES.find((n) => n.id === toId);
  return from && to ? [[from.lat, from.lng], [to.lat, to.lng]] : null;
}).filter(Boolean);

// Pans the (persistent) map to the selected camera
function FocusCamera({ cam }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (!cam) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    map.flyTo([cam.lat, cam.lng], Math.max(map.getZoom(), 14), { duration: reduce ? 0 : 0.8 });
  }, [map, cam]);
  return null;
}

export default function DashboardPage({ navigate, openModal }) {
  const [camerasData, setCamerasData] = useState(localCamerasData);
  const [apiTrends, setApiTrends] = useState(null);
  const [macro, setMacro] = useState(null); // Phase 5 Polars analytics (null → local demo data)
  const realLoaded = useRef(false); // once real analytics arrive, the legacy mock payload must not overwrite them
  const [selectedId, setSelectedId] = useState(localCamerasData[0].id);
  const chart = useChartTheme();
  const sim = useLiveSim();
  const apiLoaded = useRef(false);

  // Fetch from API with fallback
  useEffect(() => {
    fetchDashboard().then((data) => {
      if (!data || realLoaded.current) return;
      if (data.cameras) {
        setCamerasData(data.cameras);
        setSelectedId(data.cameras[0].id);
      }
      if (data.flowTrends)
        setApiTrends({
          flow: normaliseTrend(data.flowTrends, "volume", "flow"),
          density: normaliseTrend(data.densityTrends, "density", "density"),
          delay: normaliseTrend(data.congestionTrends, "delay", "delay"),
        });
      apiLoaded.current = true;
    });
  }, []);

  // Phase 5: real macro analytics (server recomputes every ~45 s; poll every 30 s)
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchMacroAnalytics().then((m) => {
        if (!alive || !m) return;
        realLoaded.current = true;
        setMacro(m);
        const nodes = macroToNodes(m);
        setCamerasData(nodes);
        setSelectedId((cur) => (nodes.some((n) => n.id === cur) ? cur : nodes[0].id));
      });
    load();
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  const real = Boolean(macro);

  // --- Live clock (sim time, 1 s) + "updated Ns ago" since the last data tick ---
  const [clock, setClock] = useState(simNowSec);
  const lastTickAt = useRef(Date.now());
  useEffect(() => {
    lastTickAt.current = Date.now();
  }, [sim.tick]);
  useEffect(() => {
    const id = setInterval(() => setClock(simNowSec()), 1000);
    return () => clearInterval(id);
  }, []);
  const updatedAgo = Math.max(0, Math.round((Date.now() - lastTickAt.current) / 1000));

  // Live node readings from the shared simulation (API cameras keep their served values)
  const liveCameras = useMemo(
    () =>
      camerasData.map((c) => {
        if (c.real) {
          const speed = parseInt(c.speed, 10);
          return { ...c, liveDensity: c.densityValue ?? 0, liveSpeed: Number.isNaN(speed) ? null : speed, color: bciColor(c.densityValue), status: bciLabel(c.densityValue) };
        }
        const live = c.camId ? sim.junctions[c.camId] : null;
        const density = live?.density ?? c.densityValue;
        const speed = live?.speed ?? parseInt(c.speed, 10);
        return { ...c, liveDensity: density, liveSpeed: speed, color: densityColor(density), status: densityStatus(density) };
      }),
    [camerasData, sim.junctions]
  );
  const selected = liveCameras.find((c) => c.id === selectedId) ?? liveCameras[0];
  const camId = selected.code ?? selected.id.split(" ")[0];
  const camName = selected.name ?? selected.id.replace(camId, "").trim().replace(/[()]/g, "");
  const flashRef = useFlash(sim.tick);

  // Network KPIs — live values from the simulation, deltas vs the previous tick
  const net = sim.network;
  const prev = sim.prevNetwork;
  const kpi = useMemo(() => {
    const reads = cameraRegistry.filter((c) => c.ocrRate != null);
    return {
      online: cameraRegistry.filter((c) => c.status !== "offline").length,
      offline: cameraRegistry.filter((c) => c.status === "offline").length,
      ocrMean: reads.reduce((s, c) => s + c.ocrRate, 0) / reads.length,
      activeAlerts: alertsFeed.filter((a) => a.status !== "Resolved").length,
    };
  }, []);
  const readsLastHour = Object.values(sim.cameras).reduce((s, c) => s + (c.status === "offline" ? 0 : c.lastHour), 0);
  const nowTick = `${String(NOW_HOUR).padStart(2, "0")}:00`;

  // Today so far: hours after "now" have not happened yet; the current hour updates live
  const today = useMemo(
    () =>
      hourlyTraffic.map((h, i) =>
        i > NOW_HOUR
          ? { hour: h.hour, flow: null, density: null, delay: null }
          : i === NOW_HOUR
          ? { hour: h.hour, flow: net.flow, density: Math.round(net.density), delay: net.delay }
          : h
      ),
    [net]
  );
  const realTrends = useMemo(
    () => macro?.hourly.map((h) => ({ hour: h.hour, flow: h.vehicles, density: h.bci != null ? Math.round(h.bci * 100) : null, delay: h.delay })),
    [macro]
  );
  const flowTrendsData = realTrends ?? apiTrends?.flow ?? today;
  const densityTrendsData = realTrends ?? apiTrends?.density ?? today;
  const congestionTrendsData = realTrends ?? apiTrends?.delay ?? today;
  const trendNowTick = real ? macro.hourly.at(-1)?.hour : nowTick;
  // Flow lines: real O-D pairs (top 8 by volume) between camera coordinates
  const odLines = useMemo(() => {
    if (!macro) return null;
    const at = Object.fromEntries(liveCameras.map((c) => [c.code, [c.lat, c.lng]]));
    const flows = (macro.od?.flows ?? []).slice(0, 8);
    const max = Math.max(1, ...flows.map((f) => f.vehicle_volume));
    return flows.filter((f) => at[f.source] && at[f.destination]).map((f) => ({ positions: [at[f.source], at[f.destination]], weight: 1.5 + (4 * f.vehicle_volume) / max, key: `${f.source}-${f.destination}` }));
  }, [macro, liveCameras]);

  const activityCam = liveCameras.find((c) => c.camId === sim.activityCamera);

  return (
    <div className="relative flex w-full flex-col gap-5 pb-10 min-h-screen">

      {/* Navbar */}
      <div className="w-full">
        <Navbar page="dashboard" navigate={navigate} openModal={openModal} />
      </div>

      {/* Header Banner with Module 01 Badge */}
      <div className="premium-panel fade-up p-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-3 w-3 rounded-full bg-purple-500 shadow-[0_0_18px_rgba(168,85,247,0.9)]" />
              <span className="premium-badge text-xs font-extrabold uppercase tracking-[0.22em] text-purple-600">
                Module 01: Central Command Overview
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">Network Dashboard &amp; GIS Intelligence</h1>
            <p className="mt-2 max-w-[800px] text-xs font-medium text-gray-500 sm:text-sm">
              Interactive multi-camera ANPR mapping, live density heatmaps, and macro-level urban traffic tracking metrics.
            </p>
          </div>

          {/* Live City Flow Badge — only the dot pulses */}
          <div ref={flashRef} className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 shadow-sm" aria-live="off">
            <span className="tn-pulse tn-pulse--green h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-emerald-600">Live City Flow</span>
            <span className="ml-0.5 font-mono text-[10px] font-bold text-emerald-500">{formatClock(clock)} IST</span>
            <span className="hidden font-mono text-[9px] font-bold text-emerald-600/70 sm:inline">
              {real ? `· Polars ${hhmm(macro.summary.computed_at)}` : `· updated ${updatedAgo}s ago`}
            </span>
          </div>
        </div>
      </div>

      {/* Network KPIs (live) */}
      <section aria-label="Network indicators" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {real ? (
          <>
            <Kpi icon={Gauge} label="Network avg speed" value={macro.summary.average_city_speed != null ? `${macro.summary.average_city_speed.toFixed(1)} km/h` : "—"} sub={`24 h · ${macro.summary.speed_samples} leg speeds`} delay="delay-100" />
            <Kpi
              icon={Activity}
              label="Traffic volume"
              value={<AnimatedNumber value={macro.summary.vehicles_latest_hour} format={(v) => `${Math.round(v).toLocaleString("en-IN")} veh/h`} />}
              sub={`${macro.summary.vehicles_24h.toLocaleString("en-IN")} vehicles in 24 h`}
              delay="delay-100"
            />
            <Kpi
              icon={MapIcon}
              label="City congestion (BCI)"
              value={macro.summary.city_bci != null ? `${Math.round(macro.summary.city_bci * 100)}%` : "—"}
              sub={`≥70% = severe · peak ${macro.summary.peak_congestion ? `${macro.summary.peak_congestion.camera_id} ${hhmm(macro.summary.peak_congestion.hour)}` : "—"}`}
              tone={macro.summary.city_bci >= 0.7 ? "text-red-500" : "text-gray-900"}
              delay="delay-200"
            />
            <Kpi
              icon={AlertTriangle}
              label="Active alerts"
              value={macro.summary.cloned_alerts.last_24h + macro.summary.severe_now.length}
              sub={`${macro.summary.cloned_alerts.last_24h} cloned plate · ${macro.summary.severe_now.length} severe junction`}
              tone="text-amber-500"
              delay="delay-200"
            />
            <Kpi
              icon={ScanLine}
              label={`OCR read rate (target >${OCR_ACCURACY_TARGET}%)`}
              value={macro.summary.city_ocr_yield != null ? `${(macro.summary.city_ocr_yield * 100).toFixed(1)}%` : "—"}
              sub="confidence > 0.80 · 24 h"
              tone="text-emerald-600"
              delay="delay-300"
            />
          </>
        ) : (
          <>
        <Kpi
          icon={Gauge}
          label="Network avg speed"
          value={<AnimatedNumber value={net.speed} format={(v) => `${v.toFixed(1)} km/h`} />}
          delta={<Delta pct={pctChange(net.speed, prev?.speed)} good="up" />}
          sub="24h avg 30 km/h"
          delay="delay-100"
        />
        <Kpi
          icon={Activity}
          label="Traffic volume"
          value={<AnimatedNumber value={net.flow} format={(v) => `${Math.round(v).toLocaleString("en-IN")} veh/h`} />}
          delta={<Delta pct={pctChange(net.flow, prev?.flow)} />}
          sub="evening peak hour"
          delay="delay-100"
        />
        <Kpi
          icon={MapIcon}
          label="Road capacity used"
          value={<AnimatedNumber value={net.density} format={(v) => `${Math.round(v)}%`} />}
          delta={<Delta pct={pctChange(net.density, prev?.density)} good="down" />}
          sub="≥85% = congested"
          tone={net.density >= 85 ? "text-red-500" : "text-gray-900"}
          delay="delay-200"
        />
        <Kpi icon={AlertTriangle} label="Active alerts" value={kpi.activeAlerts} sub="blacklist · congestion · anomaly" tone="text-amber-500" delay="delay-200" />
        <Kpi
          icon={ScanLine}
          label={`OCR read rate (target >${OCR_ACCURACY_TARGET}%)`}
          value={`${kpi.ocrMean.toFixed(1)}%`}
          sub="cluster mean · demo data"
          tone="text-emerald-600"
          delay="delay-300"
        />
          </>
        )}
      </section>

      {/* TOP SECTION: Map & Analytics Panel */}
      <div className="grid w-full gap-5 lg:grid-cols-[1.6fr_1fr]">
        {/* Left: GIS Map with Heatmap */}
        <div className="premium-panel fade-up delay-200 flex h-[420px] flex-col p-4">
          <div className="mb-3 flex items-center justify-between px-2">
            <div>
              <h3 className="text-sm font-black text-gray-900">Live GIS &amp; Heatmap</h3>
              <p className="text-[10px] font-bold text-gray-500">Click a camera node to focus its analytics</p>
            </div>

            {/* Map Legend */}
            <div className="tn-legend" role="note" aria-label="Density legend">
              <span className="tn-legend-title">{real ? "BCI:" : "Density:"}</span>
              <span className="tn-legend-item">
                <span className="h-2 w-2 rounded-full bg-red-500" /> {real ? "≥0.7" : "High"}
              </span>
              <span className="tn-legend-item">
                <span className="h-2 w-2 rounded-full bg-orange-500" /> {real ? "≥0.4" : "Med"}
              </span>
              <span className="tn-legend-item">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> {real ? "<0.4" : "Low"}
              </span>
            </div>
          </div>

          <div className="relative z-10 w-full flex-1 overflow-hidden rounded-[16px] border border-gray-100" role="region" aria-label="Live GIS map of camera nodes">
            <MapBoundary>
              <MapContainer center={[17.475, 78.405]} zoom={13} scrollWheelZoom={false} style={{ width: "100%", height: "100%" }}>
                <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <FocusCamera cam={selected} />

                {/* Flow lines between connected cameras */}
                {odLines
                  ? odLines.map((l) => (
                      <Polyline key={`od-${l.key}`} positions={l.positions} pathOptions={{ color: "#3b82f6", weight: l.weight, opacity: 0.4, dashArray: "8 12", className: "dashboard-flow-line" }} />
                    ))
                  : flowLineEdges.map((positions, idx) => (
                      <Polyline
                        key={`flow-${idx}`}
                        positions={positions}
                        pathOptions={{ color: "#3b82f6", weight: 2, opacity: 0.35, dashArray: "8 12", className: "dashboard-flow-line" }}
                      />
                    ))}

                {/* Density zones: radius/colour follow the live reading (small, slow changes) */}
                {liveCameras.map((cam) => (
                  <Circle
                    key={`zone-${cam.id}`}
                    center={[cam.lat, cam.lng]}
                    radius={cam.liveDensity * 8}
                    pathOptions={{ color: cam.color, fillColor: cam.color, fillOpacity: cam.id === selected.id ? 0.3 : 0.18, stroke: false }}
                  />
                ))}

                {/* One staggered activity ring: the camera that just produced a burst of reads */}
                {activityCam && activityCam.id !== selected.id && (
                  <CircleMarker
                    key={`ring-${sim.tick}`}
                    center={[activityCam.lat, activityCam.lng]}
                    radius={9}
                    interactive={false}
                    pathOptions={{ color: "#93c5fd", weight: 2, fill: false, className: "tn-marker-ring" }}
                  />
                )}

                {liveCameras.map((cam) => {
                  const isSel = cam.id === selected.id;
                  return (
                    <CircleMarker
                      key={cam.id}
                      center={[cam.lat, cam.lng]}
                      radius={isSel ? 10 : 7}
                      pathOptions={{
                        color: isSel ? "#bfdbfe" : "#fff",
                        weight: isSel ? 3 : 2,
                        fillColor: cam.color,
                        fillOpacity: 1,
                      }}
                      eventHandlers={{ click: () => setSelectedId(cam.id) }}
                    >
                      <MapTooltip direction="top" offset={[0, -8]}>
                        <strong>{cam.code ?? cam.id.split(" ")[0]}</strong> · {cam.name ?? ""}
                        <br />
                        {cam.real ? `${cam.liveSpeed ?? "—"} km/h · BCI ${cam.densityValue != null ? (cam.densityValue / 100).toFixed(2) : "—"}` : `${cam.liveSpeed} km/h · ${cam.liveDensity}% capacity`}
                      </MapTooltip>
                    </CircleMarker>
                  );
                })}
                {/* Selected-node ring rendered last so it sits on top */}
                <CircleMarker
                  key={`sel-${selected.id}`}
                  center={[selected.lat, selected.lng]}
                  radius={15}
                  interactive={false}
                  pathOptions={{ color: "#60a5fa", weight: 2.5, fill: false, className: "tn-marker-selected" }}
                />
              </MapContainer>
            </MapBoundary>
          </div>
        </div>

        {/* Right: Selected Node Analytics — follows the selected camera */}
        <div className="premium-panel fade-up delay-300 flex h-[420px] flex-col p-6" aria-live="polite">
          <div className="mb-4 flex items-start justify-between">
            <div key={selected.id} className="tn-list-in flex flex-col">
              <h3 className="flex items-center gap-2 text-xl font-black text-gray-900">
                Analytics
                <span className="premium-badge bg-blue-50 font-mono text-[11px] font-extrabold uppercase tracking-[0.2em] text-blue-600">{camId}</span>
              </h3>
              <p className="mt-1 flex items-center gap-1 text-xs font-bold text-gray-500">
                <MapPin size={12} /> {camName}
                {selected.zone ? ` · ${selected.zone}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("cameras", { camera: selected.camId })}
              disabled={!selected.camId}
              className="tn-surface-btn h-10 w-10 rounded-xl"
              aria-label={`Open ${camId} feed on the Cameras page`}
              data-tip="Open this camera's feed"
              data-tip-pos="bottom"
            >
              <Camera size={19} />
            </button>
          </div>

          <div className="mt-2 flex flex-1 flex-col justify-center gap-4">
            {/* Speed & Density Cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="metric-tile tn-kpi flex flex-col rounded-[20px] border border-gray-100 bg-white/80 p-5 shadow-sm">
                <span className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                  <Gauge size={14} className="text-blue-500" /> Avg Speed
                </span>
                <span className="text-3xl font-black tracking-tight text-gray-900">
                  {selected.liveSpeed != null ? <AnimatedNumber value={selected.liveSpeed} format={(v) => Math.round(v)} /> : "—"} <span className="text-sm font-bold text-gray-500">km/h</span>
                </span>
              </div>

              <div className="metric-tile tn-kpi flex flex-col rounded-[20px] border border-gray-100 bg-white/80 p-5 shadow-sm">
                <span className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                  <Activity size={14} style={{ color: selected.color }} /> {selected.real ? "Congestion (BCI)" : "Density"}
                </span>
                <span className="congestion-transition text-3xl font-black tracking-tight" style={{ color: selected.color }}>
                  <AnimatedNumber value={selected.liveDensity} format={(v) => `${Math.round(v)}%`} />
                </span>
              </div>
            </div>

            {/* List Details */}
            <div className="flex flex-col gap-0 overflow-hidden rounded-[20px] border border-gray-100 bg-gray-50/70 p-2 shadow-inner">
              <div className="flex items-center justify-between border-b border-gray-100 p-3">
                <span className="text-xs font-bold text-gray-500">Current Trend:</span>
                <span className="congestion-transition rounded-lg border border-gray-100 bg-white px-3 py-1.5 text-[11px] font-black text-gray-800 shadow-sm">
                  {selected.trend} · {selected.status}
                </span>
              </div>
              <div className="flex items-center justify-between p-3">
                <span className="text-xs font-bold text-gray-500">{selected.real ? `Volume (${selected.since}):` : `Volume (since ${selected.since}):`}</span>
                <span
                  className={`congestion-transition flex items-center gap-1 rounded-lg border border-gray-100 bg-white px-2.5 py-1.5 text-[11px] font-black shadow-sm ${
                    selected.trafficChange.includes("+") ? "text-red-500" : "text-emerald-500"
                  }`}
                >
                  {selected.trafficChange.includes("+") ? <TrendingUp size={14} /> : <TrendingUp size={14} className="rotate-180" />}
                  {selected.trafficChange}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Camera network summary — live feeds live on the Cameras page */}
      <section className="premium-panel fade-up delay-300 flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Cctv size={18} />
          </div>
          <div>
            <h3 className="text-sm font-black text-gray-900">ANPR camera network</h3>
            <p className="text-[11px] font-bold text-gray-500">
              {real ? (
                <>
                  {liveCameras.filter((c) => c.trafficChange !== "0 veh").length} of {liveCameras.length} database cameras reporting in 24 h ·{" "}
                  <AnimatedNumber value={macro.summary.vehicles_latest_hour} /> vehicles in the latest hour
                </>
              ) : (
                <>
                  {kpi.online} of {cameraRegistry.length} cluster cameras reporting · {kpi.offline} offline ·{" "}
                  <AnimatedNumber value={readsLastHour} /> plate reads in the last hour
                </>
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate("cameras", { camera: selected.camId })}
          className="tn-press flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-gray-800"
        >
          Open {camId} feed <ArrowRight size={14} />
        </button>
      </section>

      {/* BOTTOM SECTION: today's network trends — the current hour updates live */}
      <div className="grid w-full gap-5 lg:grid-cols-3">
        <TrendCard icon={Activity} iconClass="text-blue-500" title="Traffic Flow Trends" subtitle={real ? "Vehicles per hour across the cluster · last 24 h (Polars)" : "Vehicles per hour across the cluster · today so far"}>
          <AreaChart data={flowTrendsData} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorFlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chart.grid} />
            <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={chart.tick} tickFormatter={hourTicks(4)} interval={0} dy={6} />
            <YAxis domain={real ? [0, "auto"] : [0, 20000]} ticks={real ? undefined : [0, 5000, 10000, 15000, 20000]} axisLine={false} tickLine={false} tick={chart.tick} width={42} tickFormatter={(v) => (real ? v : `${v / 1000}k`)} label={{ value: "veh/h", angle: -90, position: "insideLeft", style: chart.axisLabel }} />
            <Tooltip cursor={chart.cursorLine} content={<ChartTooltip units={{ flow: "veh/h" }} />} />
            <ReferenceLine x={trendNowTick} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "now", position: "top", style: chart.axisLabel }} />
            <Area type="monotone" dataKey="flow" name="Volume" stroke="#3b82f6" strokeWidth={2.5} fill="url(#colorFlow)" activeDot={{ r: 4 }} animationDuration={600} />
          </AreaChart>
        </TrendCard>

        <TrendCard icon={MapIcon} iconClass="text-purple-500" title={real ? "Congestion Index Trends" : "Traffic Density Trends"} subtitle={real ? "BCI = 1 − v / 60 km/h (%) · last 24 h" : "Road capacity utilisation (%) · today so far"}>
          <BarChart data={densityTrendsData} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chart.grid} />
            <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={chart.tick} tickFormatter={hourTicks(4)} interval={0} dy={6} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} axisLine={false} tickLine={false} tick={chart.tick} width={42} tickFormatter={(v) => `${v}%`} />
            <Tooltip cursor={{ fill: chart.cursor }} content={<ChartTooltip units={{ density: "%" }} />} />
            <ReferenceLine y={real ? 70 : 85} stroke="#ef4444" strokeDasharray="4 4" label={{ value: real ? "severe" : "congested", position: "insideTopLeft", style: { ...chart.axisLabel, fill: "#ef4444" } }} />
            <Bar dataKey="density" name={real ? "BCI" : "Capacity used"} radius={[3, 3, 0, 0]} maxBarSize={14} animationDuration={600}>
              {densityTrendsData.map((entry) => (
                <Cell
                  key={entry.hour}
                  fill={real ? bciColor(entry.density) : entry.density >= 85 ? "#ef4444" : entry.density >= 70 ? "#f97316" : entry.density >= 50 ? "#eab308" : "#10b981"}
                />
              ))}
            </Bar>
          </BarChart>
        </TrendCard>

        <TrendCard icon={AlertTriangle} iconClass="text-orange-500" title="Congestion Trends" subtitle={real ? "Average delay per leg vs free-flow (minutes) · last 24 h" : "Average delay per trip (minutes) · today so far"}>
          <LineChart data={congestionTrendsData} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chart.grid} />
            <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={chart.tick} tickFormatter={hourTicks(4)} interval={0} dy={6} />
            <YAxis domain={real ? [0, "auto"] : [0, 25]} ticks={real ? undefined : [0, 5, 10, 15, 20, 25]} axisLine={false} tickLine={false} tick={chart.tick} width={42} label={{ value: "min", angle: -90, position: "insideLeft", style: chart.axisLabel }} />
            <Tooltip cursor={chart.cursorLine} content={<ChartTooltip units={{ delay: "min delay" }} />} />
            <ReferenceLine x={trendNowTick} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "now", position: "top", style: chart.axisLabel }} />
            <Line type="monotone" dataKey="delay" name="Avg delay" stroke="#f97316" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} animationDuration={600} />
          </LineChart>
        </TrendCard>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, delta, tone = "text-gray-900", delay = "" }) {
  return (
    <div className={`premium-panel tn-kpi fade-up ${delay} p-4`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">{label}</span>
        <Icon size={15} className="shrink-0 text-gray-400" />
      </div>
      <p className={`tn-kpi-value mt-2 text-2xl font-black tabular-nums tracking-tight ${tone}`}>{value}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-bold text-gray-500">
        {delta}
        {sub}
      </p>
    </div>
  );
}

function TrendCard({ icon: Icon, iconClass, title, subtitle, children }) {
  return (
    <section className="premium-panel fade-up delay-400 flex h-[310px] flex-col p-5">
      <div className="mb-3">
        <h3 className="flex items-center gap-1.5 text-sm font-black text-gray-900">
          <Icon size={16} className={iconClass} /> {title}
        </h3>
        <p className="mt-0.5 text-[10px] font-bold text-gray-500">{subtitle}</p>
      </div>
      <div className="min-h-0 w-full flex-1">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </section>
  );
}
