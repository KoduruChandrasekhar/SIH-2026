import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Camera,
  Gauge,
  Map as MapIcon,
  TrendingUp,
  Radio,
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
import { MapContainer, TileLayer, Popup, CircleMarker, Circle, Polyline } from "react-leaflet";
import Navbar from "../components/Navbar";
import { ChartTooltip, hourTicks, useChartTheme } from "../components/charts/ChartKit";
import { fetchDashboard } from "../api";
import { OCR_ACCURACY_TARGET, SNAPSHOT_TIME, alertsFeed, cameraById, cameraRegistry, hourlyTraffic } from "../data";
import { CAMERA_NETWORK_NODES, CAMERA_NETWORK_EDGES } from "../demoData";

// --- LOCAL MOCK DATA (fallback) ---
// Key junction cameras from the shared registry, with evening-peak (SNAPSHOT_TIME) readings that
// match the Traffic corridors: denser junctions are slower.
const NODE_READINGS = [
  { cam: "CAM #401", speed: 14, density: 91, trend: "Severe gridlock", change: "+18%", since: "5 PM" },
  { cam: "CAM #402", speed: 16, density: 88, trend: "Heavy congestion", change: "+15%", since: "5 PM" },
  { cam: "CAM #406", speed: 19, density: 84, trend: "IT outflow surge", change: "+44%", since: "5 PM" },
  { cam: "CAM #403", speed: 27, density: 68, trend: "Moderate flow", change: "+6%", since: "5 PM" },
  { cam: "CAM #411", speed: 29, density: 62, trend: "Moderate flow", change: "+4%", since: "5 PM" },
  { cam: "CAM #407", speed: 33, density: 55, trend: "Steady flow", change: "+3%", since: "5 PM" },
  { cam: "CAM #405", speed: 39, density: 42, trend: "Free flow", change: "-2%", since: "5 PM" },
];

const localCamerasData = NODE_READINGS.map((r) => {
  const c = cameraById[r.cam];
  return {
    id: `${c.code} (${c.name})`,
    lat: c.lat,
    lng: c.lng,
    status: r.density > 80 ? "High" : r.density > 50 ? "Med" : "Low",
    speed: String(r.speed),
    densityValue: r.density,
    density: `${r.density}%`,
    trend: r.trend,
    trafficChange: r.change,
    since: r.since,
    color: r.density > 80 ? "#ef4444" : r.density > 50 ? "#f97316" : "#10b981",
  };
});

// Backend trend series ({time, volume|density|delay}) are normalised to the hourly shape
const normaliseTrend = (rows, key, target) => rows?.map((r) => ({ hour: r.time ?? r.hour, [target]: r[key] ?? r[target] }));

// --- Helpers ---

/** Clamp a number between min and max */
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/** Small random delta within ±range */
const jitter = (range) => (Math.random() - 0.5) * 2 * range;

/** Determine color from density value */
const densityColor = (d) => d > 80 ? "#ef4444" : d > 50 ? "#f97316" : "#10b981";

/** Build a lookup of camera positions for flow-line rendering */
const buildCameraPositionMap = (cameras) => {
  const map = {};
  cameras.forEach(c => { map[c.id] = [c.lat, c.lng]; });
  return map;
};

// Build flow-line edges from CAMERA_NETWORK_EDGES using the dashboard camera nodes
const flowLineEdges = CAMERA_NETWORK_EDGES.map(([fromId, toId]) => {
  const from = CAMERA_NETWORK_NODES.find(n => n.id === fromId);
  const to = CAMERA_NETWORK_NODES.find(n => n.id === toId);
  if (from && to) return [[from.lat, from.lng], [to.lat, to.lng]];
  return null;
}).filter(Boolean);

export default function DashboardPage({ navigate, openModal }) {
  const [camerasData, setCamerasData] = useState(localCamerasData);
  const [flowTrendsData, setFlowTrendsData] = useState(hourlyTraffic);
  const [densityTrendsData, setDensityTrendsData] = useState(hourlyTraffic);
  const [congestionTrendsData, setCongestionTrendsData] = useState(hourlyTraffic);
  const [selectedCam, setSelectedCam] = useState(localCamerasData[0]);
  const chart = useChartTheme();

  // --- Live City Flow: current timestamp ---
  const [liveTime, setLiveTime] = useState(() => new Date());

  // --- Live data pulse: mutable live values for cameras ---
  const [liveCameras, setLiveCameras] = useState(() =>
    localCamerasData.map(c => ({
      ...c,
      liveSpeed: parseInt(c.speed, 10),
      liveDensity: c.densityValue,
      liveTrafficChange: parseFloat(c.trafficChange),
    }))
  );

  // Keep a ref to track whether API data has been loaded
  const apiLoaded = useRef(false);

  // Fetch from API with fallback
  useEffect(() => {
    fetchDashboard().then((data) => {
      if (data) {
        if (data.cameras) { setCamerasData(data.cameras); setSelectedCam(data.cameras[0]); }
        if (data.flowTrends) setFlowTrendsData(normaliseTrend(data.flowTrends, "volume", "flow"));
        if (data.densityTrends) setDensityTrendsData(normaliseTrend(data.densityTrends, "density", "density"));
        if (data.congestionTrends) setCongestionTrendsData(normaliseTrend(data.congestionTrends, "delay", "delay"));
        apiLoaded.current = true;
      }
    });
  }, []);

  // Sync liveCameras when camerasData changes (e.g. from API)
  useEffect(() => {
    setLiveCameras(
      camerasData.map(c => ({
        ...c,
        liveSpeed: parseInt(c.speed, 10),
        liveDensity: c.densityValue,
        liveTrafficChange: parseFloat(c.trafficChange),
      }))
    );
  }, [camerasData]);

  // --- Live clock (1s) ---
  useEffect(() => {
    const id = setInterval(() => setLiveTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // --- Live data pulse tick (every 4 seconds) ---
  const tickLiveData = useCallback(() => {
    setLiveCameras(prev =>
      prev.map(cam => {
        const baseDensity = cam.densityValue0 ?? cam.liveDensity;
        const baseSpeed = cam.speed0 ?? cam.liveSpeed;
        // density drifts ±6 points around its reading; speed responds inversely (≈0.45 km/h per point)
        const newDensity = clamp(Math.round(cam.liveDensity + jitter(2)), Math.max(5, baseDensity - 6), Math.min(98, baseDensity + 6));
        const newSpeed = clamp(Math.round(baseSpeed + (baseDensity - newDensity) * 0.45), 5, 60);
        const newColor = densityColor(newDensity);
        return {
          ...cam,
          densityValue0: baseDensity,
          speed0: baseSpeed,
          liveSpeed: newSpeed,
          speed: String(newSpeed),
          liveDensity: newDensity,
          densityValue: newDensity,
          density: `${newDensity}%`,
          color: newColor,
          status: newDensity > 80 ? "High" : newDensity > 50 ? "Med" : "Low",
        };
      })
    );
  }, []);

  useEffect(() => {
    const id = setInterval(tickLiveData, 4000);
    return () => clearInterval(id);
  }, [tickLiveData]);

  // --- Keep selectedCam in sync with liveCameras ---
  const liveSelectedCam = liveCameras.find(c => c.id === selectedCam.id) || selectedCam;

  const camId = liveSelectedCam.id.split(' ')[0];
  const camName = liveSelectedCam.id.replace(camId, '').trim().replace(/[()]/g, '');

  // Network KPIs at the snapshot hour, derived from the same series the charts use
  const kpi = useMemo(() => {
    const now = hourlyTraffic[Number(SNAPSHOT_TIME.slice(0, 2))];
    const reads = cameraRegistry.filter((c) => c.ocrRate != null);
    return {
      now,
      online: cameraRegistry.filter((c) => c.status !== "offline").length,
      offline: cameraRegistry.filter((c) => c.status === "offline").length,
      readsLastHour: cameraRegistry.reduce((s, c) => s + c.lastHour, 0),
      ocrMean: (reads.reduce((s, c) => s + c.ocrRate, 0) / reads.length).toFixed(1),
      activeAlerts: alertsFeed.filter((a) => a.status !== "Resolved").length,
    };
  }, []);
  const nowTick = `${SNAPSHOT_TIME.slice(0, 2)}:00`;

  // Format live timestamp
  const timeStr = liveTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  return (
    <div className="relative flex w-full flex-col gap-5 pb-10 min-h-screen">
      
      {/* Background Subtle Blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-gray-50/50">
        <div className="animate-blob absolute -left-[10%] top-[-5%] h-[400px] w-[400px] rounded-full bg-blue-200/20 mix-blend-multiply blur-[100px] filter" />
        <div className="animate-blob animation-delay-2000 absolute right-[-5%] top-[20%] h-[400px] w-[400px] rounded-full bg-indigo-200/20 mix-blend-multiply blur-[100px] filter" />
      </div>

      {/* Navbar */}
      <div className="fade-up w-full">
        <Navbar page="dashboard" navigate={navigate} openModal={openModal} />
      </div>

      {/* Header Banner with Module 01 Badge */}
      <div className="premium-panel fade-up delay-100 p-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-3 w-3 rounded-full bg-purple-500 trace-live-dot shadow-[0_0_18px_rgba(168,85,247,0.9)]" />
              <span className="premium-badge text-xs font-extrabold uppercase tracking-[0.22em] text-purple-600">
                Module 01: Central Command Overview
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">
              Network Dashboard &amp; GIS Intelligence
            </h1>
            <p className="mt-2 max-w-[800px] text-xs font-medium text-gray-500 sm:text-sm">
              Interactive multi-camera ANPR mapping, live density heatmaps, and macro-level urban traffic tracking metrics.
            </p>
          </div>

          {/* Live City Flow Badge */}
          <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 shadow-sm">
            <span className="live-flow-dot h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-emerald-600">
              Live City Flow
            </span>
            <span className="ml-0.5 font-mono text-[10px] font-bold text-emerald-500">{timeStr}</span>
          </div>
        </div>
      </div>

      {/* Network KPIs (snapshot hour) */}
      <section aria-label="Network indicators" className="fade-up delay-150 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi icon={Gauge} label="Network avg speed" value={`${kpi.now.speed} km/h`} sub={`at ${SNAPSHOT_TIME} · 30 km/h 24h avg`} />
        <Kpi icon={Activity} label="Traffic volume" value={`${(kpi.now.flow / 1000).toFixed(1)}k veh/h`} sub="evening peak hour" />
        <Kpi icon={MapIcon} label="Road capacity used" value={`${kpi.now.density}%`} sub="≥85% = congested" tone={kpi.now.density >= 85 ? "text-red-500" : "text-gray-900"} />
        <Kpi icon={AlertTriangle} label="Active alerts" value={kpi.activeAlerts} sub="blacklist · congestion · anomaly" tone="text-amber-500" />
        <Kpi icon={ScanLine} label={`OCR read rate (target >${OCR_ACCURACY_TARGET}%)`} value={`${kpi.ocrMean}%`} sub="cluster mean · demo data" tone="text-emerald-600" />
      </section>

      {/* TOP SECTION: Map & Analytics Panel */}
      <div className="grid w-full gap-5 lg:grid-cols-[1.6fr_1fr]">
        
        {/* Left: GIS Map with Heatmap */}
        <div className="premium-panel fade-up delay-200 flex h-[420px] flex-col p-4">
          <div className="mb-3 flex items-center justify-between px-2">
            <div>
              <h3 className="text-sm font-black text-gray-900">Live GIS &amp; Heatmap</h3>
              <p className="text-[10px] font-bold text-gray-500">Camera Nodes &amp; Density Radars</p>
            </div>
            
            {/* Map Legend */}
            <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-1.5 shadow-sm backdrop-blur-sm">
              <span className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-gray-500">Density:</span>
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-700">
                <span className="h-2 w-2 rounded-full bg-red-500" /> High
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-700">
                <span className="h-2 w-2 rounded-full bg-orange-500" /> Med
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Low
              </div>
            </div>
          </div>

          <div className="relative flex-1 w-full rounded-[16px] overflow-hidden border border-gray-100 z-10">
            <MapContainer
              center={[17.4900, 78.4050]} 
              zoom={13}
              scrollWheelZoom={false}
              style={{ width: "100%", height: "100%" }}
            >
              <TileLayer
                attribution='&copy; OpenStreetMap'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {/* Animated Flow Lines between connected cameras */}
              {flowLineEdges.map((positions, idx) => (
                <Polyline
                  key={`flow-${idx}`}
                  positions={positions}
                  pathOptions={{
                    color: "#3b82f6",
                    weight: 2,
                    opacity: 0.35,
                    dashArray: "8 12",
                    className: "dashboard-flow-line",
                  }}
                />
              ))}
              
              {liveCameras.map((cam) => (
                <div key={cam.id}>
                  {/* Heatmap Circle */}
                  <Circle
                    center={[cam.lat, cam.lng]}
                    radius={cam.liveDensity * 8} 
                    pathOptions={{ color: cam.color, fillColor: cam.color, fillOpacity: 0.2, stroke: false }}
                  />
                  {/* Clickable Camera Node with pulse animation */}
                  <CircleMarker
                    center={[cam.lat, cam.lng]}
                    radius={8}
                    pathOptions={{
                      color: '#fff',
                      weight: 2.5,
                      fillColor: cam.color,
                      fillOpacity: 1,
                      className: 'cam-node-pulse',
                    }}
                    eventHandlers={{ click: () => setSelectedCam(cam) }}
                  >
                    <Popup>
                      <div className="p-1 font-mono text-center">
                        <h4 className="text-[11px] font-black text-gray-900 mb-0.5">{cam.id.split(' ')[0]}</h4>
                        <p className="text-[10px] text-gray-500 font-bold">Click to view analytics</p>
                      </div>
                    </Popup>
                  </CircleMarker>
                </div>
              ))}
            </MapContainer>
          </div>
        </div>

        {/* Right: Selected Node Analytics */}
        <div className="premium-panel fade-up delay-300 flex h-[420px] flex-col p-6">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex flex-col">
              <h3 className="flex items-center gap-2 text-xl font-black text-gray-900">
                Analytics 
                <span className="premium-badge bg-blue-50 text-[11px] font-extrabold uppercase tracking-[0.2em] text-blue-600">
                  {camId}
                </span>
              </h3>
              <p className="mt-1 text-xs font-bold text-gray-500">({camName})</p>
            </div>
            <div className="heartbeat-icon rounded-xl border border-gray-100 bg-gray-50/80 p-2.5 shadow-sm">
              <Camera size={20} className="text-gray-400" />
            </div>
          </div>

          <div className="mt-2 flex flex-1 flex-col justify-center gap-4">
            
            {/* Speed & Density Cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="metric-tile congestion-transition flex flex-col rounded-[20px] border border-gray-100 bg-white/80 p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-blue-100 hover:shadow-[0_16px_30px_rgba(59,130,246,0.12)]">
                <span className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                  <span className="heartbeat-icon inline-flex"><Gauge size={14} className="text-blue-500" /></span> Avg Speed
                </span>
                <span className="text-3xl font-black tracking-tight text-gray-900">
                  {liveSelectedCam.speed} <span className="text-sm font-bold text-gray-500">km/h</span>
                </span>
              </div>
              
              <div className="metric-tile congestion-transition flex flex-col rounded-[20px] border border-gray-100 bg-white/80 p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-blue-100 hover:shadow-[0_16px_30px_rgba(59,130,246,0.12)]">
                <span className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                  <span className="heartbeat-icon inline-flex"><Activity size={14} style={{ color: liveSelectedCam.color }} /></span> Density
                </span>
                <span className="congestion-transition text-3xl font-black tracking-tight" style={{ color: liveSelectedCam.color }}>
                  {liveSelectedCam.density}
                </span>
              </div>
            </div>

            {/* List Details */}
            <div className="flex flex-col gap-0 overflow-hidden rounded-[20px] border border-gray-100 bg-gray-50/70 p-2 shadow-inner">
              <div className="flex items-center justify-between border-b border-gray-100 p-3">
                <span className="text-xs font-bold text-gray-500">Current Trend:</span>
                <span className="congestion-transition rounded-lg border border-gray-100 bg-white px-3 py-1.5 text-[11px] font-black text-gray-800 shadow-sm">
                  {liveSelectedCam.trend}
                </span>
              </div>
              <div className="flex items-center justify-between p-3">
                <span className="text-xs font-bold text-gray-500">Volume (since {liveSelectedCam.since}):</span>
                <span className={`congestion-transition flex items-center gap-1 rounded-lg border border-gray-100 bg-white px-2.5 py-1.5 text-[11px] font-black shadow-sm ${liveSelectedCam.trafficChange.includes('+') ? 'text-red-500' : 'text-emerald-500'}`}>
                  {liveSelectedCam.trafficChange.includes('+') ? <TrendingUp size={14} /> : <TrendingUp size={14} className="rotate-180" />}
                  {liveSelectedCam.trafficChange}
                </span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Camera network summary — live feeds now live on the Cameras page */}
      <section className="premium-panel fade-up delay-300 flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Cctv size={18} />
          </div>
          <div>
            <h3 className="text-sm font-black text-gray-900">ANPR camera network</h3>
            <p className="text-[11px] font-bold text-gray-500">
              {kpi.online} of {cameraRegistry.length} cluster cameras reporting · {kpi.offline} offline · {kpi.readsLastHour.toLocaleString("en-IN")} plate reads in the last hour
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate("cameras")}
          className="flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-gray-800"
        >
          Open camera feeds <ArrowRight size={14} />
        </button>
      </section>

      {/* BOTTOM SECTION: 24-hour network trends (same series as the KPIs above) */}
      <div className="grid w-full gap-5 lg:grid-cols-3">
        <TrendCard icon={Activity} iconClass="text-blue-500" title="Traffic Flow Trends" subtitle="Vehicles per hour across the cluster · today">
          <AreaChart data={flowTrendsData} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorFlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chart.grid} />
            <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={chart.tick} tickFormatter={hourTicks(4)} interval={0} dy={6} />
            <YAxis domain={[0, 20000]} ticks={[0, 5000, 10000, 15000, 20000]} axisLine={false} tickLine={false} tick={chart.tick} width={42} tickFormatter={(v) => `${v / 1000}k`} label={{ value: "veh/h", angle: -90, position: "insideLeft", style: chart.axisLabel }} />
            <Tooltip cursor={chart.cursorLine} content={<ChartTooltip units={{ flow: "veh/h" }} />} />
            <ReferenceLine x={nowTick} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "now", position: "top", style: chart.axisLabel }} />
            <Area type="monotone" dataKey="flow" name="Volume" stroke="#3b82f6" strokeWidth={2.5} fill="url(#colorFlow)" activeDot={{ r: 4 }} />
          </AreaChart>
        </TrendCard>

        <TrendCard icon={MapIcon} iconClass="text-purple-500" title="Traffic Density Trends" subtitle="Road capacity utilisation (%) · today">
          <BarChart data={densityTrendsData} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chart.grid} />
            <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={chart.tick} tickFormatter={hourTicks(4)} interval={0} dy={6} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} axisLine={false} tickLine={false} tick={chart.tick} width={42} tickFormatter={(v) => `${v}%`} />
            <Tooltip cursor={{ fill: chart.cursor }} content={<ChartTooltip units={{ density: "%" }} />} />
            <ReferenceLine y={85} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "congested", position: "insideTopLeft", style: { ...chart.axisLabel, fill: "#ef4444" } }} />
            <Bar dataKey="density" name="Capacity used" radius={[3, 3, 0, 0]} maxBarSize={14}>
              {densityTrendsData.map((entry) => (
                <Cell key={entry.hour} fill={entry.density >= 85 ? "#ef4444" : entry.density >= 70 ? "#f97316" : entry.density >= 50 ? "#eab308" : "#10b981"} />
              ))}
            </Bar>
          </BarChart>
        </TrendCard>

        <TrendCard icon={AlertTriangle} iconClass="text-orange-500" title="Congestion Trends" subtitle="Average delay per trip (minutes) · today">
          <LineChart data={congestionTrendsData} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chart.grid} />
            <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={chart.tick} tickFormatter={hourTicks(4)} interval={0} dy={6} />
            <YAxis axisLine={false} tickLine={false} tick={chart.tick} width={42} label={{ value: "min", angle: -90, position: "insideLeft", style: chart.axisLabel }} />
            <Tooltip cursor={chart.cursorLine} content={<ChartTooltip units={{ delay: "min delay" }} />} />
            <ReferenceLine x={nowTick} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "now", position: "top", style: chart.axisLabel }} />
            <Line type="monotone" dataKey="delay" name="Avg delay" stroke="#f97316" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </TrendCard>
      </div>

    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone = "text-gray-900" }) {
  return (
    <div className="premium-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">{label}</span>
        <Icon size={15} className="shrink-0 text-gray-400" />
      </div>
      <p className={`mt-2 text-2xl font-black tabular-nums tracking-tight ${tone}`}>{value}</p>
      <p className="mt-0.5 text-[10px] font-bold text-gray-500">{sub}</p>
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
