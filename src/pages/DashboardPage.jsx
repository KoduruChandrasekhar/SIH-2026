import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Camera,
  Gauge,
  Map as MapIcon,
  TrendingUp,
  Radio,
  Zap,
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
} from "recharts";
import { ScatterplotLayer, LineLayer } from "@deck.gl/layers";
import Navbar from "../components/Navbar";
import DeckGLMap from "../components/DeckGLMap";
import CameraFeedCard from "../components/CameraFeedCard";
import { fetchDashboard, fetchCameras } from "../api";
import { cameras as localCameraFeeds } from "../data";
import { CAMERA_NETWORK_NODES, CAMERA_NETWORK_EDGES } from "../demoData";

// --- LOCAL MOCK DATA (fallback) ---

const localCamerasData = [
  {
    id: "CAM-01 (Kukatpally Y-Junction)",
    lat: 17.4947,
    lng: 78.3996,
    status: "High",
    speed: "12",
    densityValue: 94,
    density: "94%",
    trend: "Severe Gridlock",
    trafficChange: "+45%",
    since: "4 PM",
    color: "#ef4444",
    rgb: [239, 68, 68],
  },
  {
    id: "CAM-02 (JNTU Main Road)",
    lat: 17.4985,
    lng: 78.3912,
    status: "Med",
    speed: "35",
    densityValue: 65,
    density: "65%",
    trend: "Moderate Flow",
    trafficChange: "+15%",
    since: "5 PM",
    color: "#f97316",
    rgb: [249, 115, 22],
  },
  {
    id: "CAM-03 (KPHB Colony Phase 1)",
    lat: 17.4855,
    lng: 78.3895,
    status: "Low",
    speed: "55",
    densityValue: 25,
    density: "25%",
    trend: "Clear Route",
    trafficChange: "-8%",
    since: "3 PM",
    color: "#10b981",
    rgb: [16, 185, 129],
  },
  {
    id: "CAM-04 (Miyapur X-Roads)",
    lat: 17.4968,
    lng: 78.3614,
    status: "Med",
    speed: "42",
    densityValue: 58,
    density: "58%",
    trend: "Steady Inflow",
    trafficChange: "+2%",
    since: "5 PM",
    color: "#f97316",
    rgb: [249, 115, 22],
  },
  {
    id: "CAM-05 (Balanagar Industrial)",
    lat: 17.4682,
    lng: 78.4357,
    status: "High",
    speed: "18",
    densityValue: 88,
    density: "88%",
    trend: "Heavy Congestion",
    trafficChange: "+30%",
    since: "4 PM",
    color: "#ef4444",
    rgb: [239, 68, 68],
  },
];

const localFlowTrendsData = [
  { time: "6 AM", volume: 4000 },
  { time: "9 AM", volume: 11000 },
  { time: "12 PM", volume: 7500 },
  { time: "3 PM", volume: 8500 },
  { time: "6 PM", volume: 13500 },
  { time: "9 PM", volume: 5000 },
];

const localDensityTrendsData = [
  { time: "6 AM", density: 25 },
  { time: "9 AM", density: 92 },
  { time: "12 PM", density: 55 },
  { time: "3 PM", density: 70 },
  { time: "6 PM", density: 95 },
  { time: "9 PM", density: 35 },
];

const localCongestionTrendsData = [
  { time: "6 AM", delay: 2 },
  { time: "9 AM", delay: 28 },
  { time: "12 PM", delay: 12 },
  { time: "3 PM", delay: 18 },
  { time: "6 PM", delay: 35 },
  { time: "9 PM", delay: 5 },
];

// --- Helpers ---

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const jitter = (range) => (Math.random() - 0.5) * 2 * range;
const densityColor = (d) => (d > 80 ? "#ef4444" : d > 50 ? "#f97316" : "#10b981");
const densityRgb = (d) => (d > 80 ? [239, 68, 68] : d > 50 ? [249, 115, 22] : [16, 185, 129]);

// Build flow-line edges from CAMERA_NETWORK_EDGES
const flowLineData = CAMERA_NETWORK_EDGES.map(([fromId, toId]) => {
  const from = CAMERA_NETWORK_NODES.find((n) => n.id === fromId);
  const to = CAMERA_NETWORK_NODES.find((n) => n.id === toId);
  if (from && to) {
    return {
      from: [from.lng, from.lat],
      to: [to.lng, to.lat],
    };
  }
  return null;
}).filter(Boolean);

// Dark theme Custom Tooltip for Recharts
const CustomTooltip = ({ active, payload, label, suffix = "" }) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0f172a]/95 px-3.5 py-2 shadow-2xl backdrop-blur-xl">
        <p className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">{label}</p>
        <div className="flex items-center gap-2 mt-1">
          <span
            className="h-2 w-2 rounded-full shadow-[0_0_8px_currentColor]"
            style={{ backgroundColor: payload[0].color || payload[0].payload.color || "#3b82f6" }}
          />
          <span className="text-xs font-black text-white">
            {payload[0].value} {suffix}
          </span>
        </div>
      </div>
    );
  }
  return null;
};

export default function DashboardPage({ navigate, openModal }) {
  const [camerasData, setCamerasData] = useState(localCamerasData);
  const [flowTrendsData, setFlowTrendsData] = useState(localFlowTrendsData);
  const [densityTrendsData, setDensityTrendsData] = useState(localDensityTrendsData);
  const [congestionTrendsData, setCongestionTrendsData] = useState(localCongestionTrendsData);
  const [selectedCam, setSelectedCam] = useState(localCamerasData[0]);
  const [cameraFeeds, setCameraFeeds] = useState(localCameraFeeds);
  const [liveTime, setLiveTime] = useState(() => new Date());

  // Mutable live values for cameras
  const [liveCameras, setLiveCameras] = useState(() =>
    localCamerasData.map((c) => ({
      ...c,
      liveSpeed: parseInt(c.speed, 10),
      liveDensity: c.densityValue,
      liveTrafficChange: parseFloat(c.trafficChange),
    }))
  );

  const apiLoaded = useRef(false);

  // Fetch from API with fallback
  useEffect(() => {
    fetchDashboard().then((data) => {
      if (data) {
        if (data.cameras) {
          setCamerasData(data.cameras);
          setSelectedCam(data.cameras[0]);
        }
        if (data.flowTrends) setFlowTrendsData(data.flowTrends);
        if (data.densityTrends) setDensityTrendsData(data.densityTrends);
        if (data.congestionTrends) setCongestionTrendsData(data.congestionTrends);
        apiLoaded.current = true;
      }
    });
    fetchCameras().then((data) => {
      if (data && data.cameras) setCameraFeeds(data.cameras);
    });
  }, []);

  // Sync liveCameras when camerasData changes
  useEffect(() => {
    setLiveCameras(
      camerasData.map((c) => ({
        ...c,
        liveSpeed: parseInt(c.speed, 10),
        liveDensity: c.densityValue || 50,
        liveTrafficChange: parseFloat(c.trafficChange || "0"),
        rgb: c.rgb || densityRgb(c.densityValue || 50),
      }))
    );
  }, [camerasData]);

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setLiveTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Live telemetry pulse
  const tickLiveData = useCallback(() => {
    setLiveCameras((prev) =>
      prev.map((cam) => {
        const newSpeed = clamp(cam.liveSpeed + Math.round(jitter(2)), 5, 80);
        const newDensity = clamp(cam.liveDensity + Math.round(jitter(3)), 5, 99);
        const newChange = clamp(cam.liveTrafficChange + jitter(1.5), -30, 60);
        const newColor = densityColor(newDensity);
        const newRgb = densityRgb(newDensity);
        return {
          ...cam,
          liveSpeed: newSpeed,
          speed: String(newSpeed),
          liveDensity: newDensity,
          densityValue: newDensity,
          density: `${newDensity}%`,
          liveTrafficChange: Math.round(newChange * 10) / 10,
          trafficChange: `${newChange >= 0 ? "+" : ""}${Math.round(newChange)}%`,
          color: newColor,
          rgb: newRgb,
          status: newDensity > 80 ? "High" : newDensity > 50 ? "Med" : "Low",
        };
      })
    );
  }, []);

  useEffect(() => {
    const id = setInterval(tickLiveData, 4000);
    return () => clearInterval(id);
  }, [tickLiveData]);

  const liveSelectedCam = liveCameras.find((c) => c.id === selectedCam.id) || selectedCam;
  const camId = liveSelectedCam.id.split(" ")[0];
  const camName = liveSelectedCam.id.replace(camId, "").trim().replace(/[()]/g, "");

  const gridColor = "rgba(255, 255, 255, 0.06)";
  const tickColor = "#94a3b8";
  const cursorFill = "rgba(255, 255, 255, 0.04)";

  const timeStr = liveTime.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // Deck.gl layers for Dashboard Map
  const mapLayers = useMemo(() => {
    // Inter-camera network link flow lines
    const lineLayer = new LineLayer({
      id: "dashboard-flow-lines",
      data: flowLineData,
      getSourcePosition: (d) => d.from,
      getTargetPosition: (d) => d.to,
      getColor: [59, 130, 246, 140],
      getWidth: 2.5,
      widthMinPixels: 1.5,
    });

    // Density Heat Halos
    const densityHalos = new ScatterplotLayer({
      id: "dashboard-density-halos",
      data: liveCameras,
      getPosition: (d) => [d.lng, d.lat],
      getRadius: (d) => d.liveDensity * 12,
      getFillColor: (d) => [...(d.rgb || [59, 130, 246]), 45],
      getLineColor: (d) => [...(d.rgb || [59, 130, 246]), 120],
      stroked: true,
      lineWidthMinPixels: 1.5,
      radiusMinPixels: 16,
      radiusMaxPixels: 60,
      pickable: false,
    });

    // Interactive Camera Nodes
    const cameraNodes = new ScatterplotLayer({
      id: "dashboard-camera-nodes",
      data: liveCameras,
      getPosition: (d) => [d.lng, d.lat],
      getRadius: (d) => 320,
      getFillColor: (d) => (d.id === liveSelectedCam.id ? [6, 182, 212, 255] : [...(d.rgb || [59, 130, 246]), 240]),
      getLineColor: [255, 255, 255, 240],
      lineWidthMinPixels: 2.5,
      stroked: true,
      radiusMinPixels: 8,
      radiusMaxPixels: 16,
      pickable: true,
      onClick: ({ object }) => {
        if (object) setSelectedCam(object);
      },
    });

    return [lineLayer, densityHalos, cameraNodes];
  }, [liveCameras, liveSelectedCam.id]);

  return (
    <div className="relative flex w-full flex-col gap-6 pb-12 min-h-screen text-[var(--text-primary)]">
      {/* Background Ambience */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-[10%] top-[-5%] h-[450px] w-[450px] rounded-full bg-blue-600/10 blur-[140px]" />
        <div className="absolute right-[-5%] top-[20%] h-[450px] w-[450px] rounded-full bg-indigo-600/10 blur-[140px]" />
      </div>

      {/* Navbar */}
      <div className="fade-up w-full">
        <Navbar page="dashboard" navigate={navigate} openModal={openModal} />
      </div>

      {/* Header Banner */}
      <div className="fade-up delay-100 glass-card-static p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="live-dot bg-purple-500" style={{ boxShadow: "0 0 10px #a855f7" }} />
              <span className="text-xs font-black uppercase tracking-widest text-purple-400">
                Module 01: Central Command Overview
              </span>
            </div>
            <h1 className="mt-2 text-2xl sm:text-3xl font-black tracking-tight text-[var(--text-primary)]">
              Network Dashboard &amp; GIS Intelligence
            </h1>
            <p className="mt-2 max-w-[850px] text-xs sm:text-sm font-medium text-[var(--text-secondary)] leading-relaxed">
              Interactive multi-camera ANPR mapping, real-time WebGL density radars, and city-scale urban traffic metrics.
            </p>
          </div>

          {/* Live City Flow Badge */}
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 backdrop-blur-md">
            <span className="live-flow-dot h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400">
              Live City Flow
            </span>
            <span className="ml-1 font-mono text-[11px] font-bold text-emerald-300">{timeStr}</span>
          </div>
        </div>
      </div>

      {/* TOP SECTION: DeckGL Map & Analytics Panel */}
      <div className="grid w-full gap-5 lg:grid-cols-[1.6fr_1fr]">
        {/* Left: GIS Map with Heatmap */}
        <div className="fade-up delay-200 flex h-[460px] flex-col glass-card-static p-4">
          <div className="mb-3 flex items-center justify-between px-2">
            <div>
              <h3 className="text-sm font-black text-[var(--text-primary)]">Live GIS &amp; Heatmap (deck.gl)</h3>
              <p className="text-[10px] font-bold text-[var(--text-muted)]">Camera Nodes &amp; Density Radars</p>
            </div>

            {/* Map Legend */}
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 backdrop-blur-md">
              <span className="text-[9px] font-extrabold uppercase tracking-widest text-[var(--text-muted)]">Density:</span>
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-red-400">
                <span className="h-2 w-2 rounded-full bg-red-500" /> High
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-orange-400">
                <span className="h-2 w-2 rounded-full bg-orange-500" /> Med
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Low
              </div>
            </div>
          </div>

          <div className="relative flex-1 w-full rounded-2xl overflow-hidden border border-[var(--border-subtle)]">
            <DeckGLMap
              layers={mapLayers}
              viewState={{
                longitude: 78.405,
                latitude: 17.49,
                zoom: 12.5,
                pitch: 25,
                bearing: 0,
              }}
            >
              {/* Selected node quick badge on map */}
              <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-lg bg-black/75 backdrop-blur-md border border-white/10 text-[10px] font-mono text-gray-300">
                Node: <strong className="text-cyan-400">{camId}</strong> | Speed:{" "}
                <strong className="text-white">{liveSelectedCam.speed} km/h</strong>
              </div>
            </DeckGLMap>
          </div>
        </div>

        {/* Right: Selected Node Analytics */}
        <div className="fade-up delay-300 flex h-[460px] flex-col glass-card-static p-6">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex flex-col">
              <h3 className="flex items-center gap-2 text-xl font-black text-[var(--text-primary)]">
                Analytics
                <span className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-blue-400">
                  {camId}
                </span>
              </h3>
              <p className="mt-1 text-xs font-bold text-[var(--text-secondary)]">({camName})</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 shadow-sm">
              <Camera size={20} className="text-blue-400" />
            </div>
          </div>

          <div className="mt-1 flex flex-1 flex-col justify-center gap-4">
            {/* Speed & Density Cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="glass-card p-5 flex flex-col justify-between">
                <span className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">
                  <Gauge size={14} className="text-blue-400" /> Avg Speed
                </span>
                <span className="text-3xl font-black tracking-tight text-[var(--text-primary)]">
                  {liveSelectedCam.speed}{" "}
                  <span className="text-xs font-bold text-[var(--text-secondary)]">km/h</span>
                </span>
              </div>

              <div className="glass-card p-5 flex flex-col justify-between">
                <span className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">
                  <Activity size={14} style={{ color: liveSelectedCam.color }} /> Density
                </span>
                <span
                  className="text-3xl font-black tracking-tight drop-shadow-[0_0_12px_currentColor]"
                  style={{ color: liveSelectedCam.color }}
                >
                  {liveSelectedCam.density}
                </span>
              </div>
            </div>

            {/* List Details */}
            <div className="flex flex-col rounded-2xl border border-[var(--border-subtle)] bg-white/[0.02] p-2">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-3">
                <span className="text-xs font-bold text-[var(--text-secondary)]">Current Trend:</span>
                <span className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-black text-[var(--text-primary)]">
                  {liveSelectedCam.trend}
                </span>
              </div>
              <div className="flex items-center justify-between p-3">
                <span className="text-xs font-bold text-[var(--text-secondary)]">
                  Volume (since {liveSelectedCam.since}):
                </span>
                <span
                  className={`flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-black ${
                    liveSelectedCam.trafficChange.includes("+") ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  <TrendingUp
                    size={14}
                    className={liveSelectedCam.trafficChange.includes("+") ? "" : "rotate-180"}
                  />
                  {liveSelectedCam.trafficChange}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CAMERA FEEDS SECTION — Simulated AI CCTV */}
      <div className="fade-up delay-300">
        <div className="mb-4 flex items-center justify-between px-1">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-black text-[var(--text-primary)]">
              <Camera size={16} className="text-blue-400" />
              Live Camera Feeds
              <span className="ml-1 text-[9px] font-extrabold uppercase tracking-widest text-[var(--accent-cyan)]">
                AI Simulation
              </span>
            </h3>
            <p className="mt-0.5 text-[10px] font-bold text-[var(--text-muted)]">
              Hover to view simulated CCTV feed with AI detection overlays
            </p>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 backdrop-blur-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400">
              {cameraFeeds.length} Feeds Online
            </span>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cameraFeeds.map((cam, i) => (
            <CameraFeedCard key={cam.id} camera={cam} index={i} />
          ))}
        </div>
      </div>

      {/* BOTTOM SECTION: 3 Analytics Graphs */}
      <div className="grid w-full gap-5 lg:grid-cols-3">
        {/* Graph 1: Traffic Flow Trends */}
        <div className="fade-up delay-400 flex h-[320px] flex-col glass-card-static p-5">
          <div className="mb-4">
            <h3 className="flex items-center gap-1.5 text-sm font-black text-[var(--text-primary)]">
              <Activity size={16} className="text-blue-400" /> Traffic Flow Trends
            </h3>
            <p className="mt-0.5 text-[10px] font-bold text-[var(--text-muted)]">Total volume over time</p>
          </div>
          <div className="flex-1 w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={flowTrendsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorFlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                <XAxis
                  dataKey="time"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: tickColor, fontWeight: 700 }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: tickColor, fontWeight: 700 }}
                  tickFormatter={(val) => `${val / 1000}k`}
                />
                <Tooltip content={<CustomTooltip suffix="Vehicles" />} />
                <Area
                  type="monotone"
                  dataKey="volume"
                  stroke="#3b82f6"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorFlow)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Graph 2: Traffic Density Trends */}
        <div className="fade-up delay-500 flex h-[320px] flex-col glass-card-static p-5">
          <div className="mb-4">
            <h3 className="flex items-center gap-1.5 text-sm font-black text-[var(--text-primary)]">
              <MapIcon size={16} className="text-purple-400" /> Traffic Density Trends
            </h3>
            <p className="mt-0.5 text-[10px] font-bold text-[var(--text-muted)]">Road capacity utilization (%)</p>
          </div>
          <div className="flex-1 w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={densityTrendsData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                <XAxis
                  dataKey="time"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: tickColor, fontWeight: 700 }}
                  dy={10}
                />
                <YAxis
                  domain={[0, 100]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: tickColor, fontWeight: 700 }}
                />
                <Tooltip content={<CustomTooltip suffix="%" />} cursor={{ fill: cursorFill }} />
                <Bar dataKey="density" radius={[6, 6, 0, 0]} barSize={24}>
                  {densityTrendsData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.density > 85 ? "#ef4444" : entry.density > 50 ? "#f97316" : "#10b981"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Graph 3: Congestion Trends */}
        <div className="fade-up delay-[600ms] flex h-[320px] flex-col glass-card-static p-5">
          <div className="mb-4">
            <h3 className="flex items-center gap-1.5 text-sm font-black text-[var(--text-primary)]">
              <AlertTriangle size={16} className="text-orange-400" /> Congestion Trends
            </h3>
            <p className="mt-0.5 text-[10px] font-bold text-[var(--text-muted)]">Average delay in minutes</p>
          </div>
          <div className="flex-1 w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={congestionTrendsData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                <XAxis
                  dataKey="time"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: tickColor, fontWeight: 700 }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: tickColor, fontWeight: 700 }}
                />
                <Tooltip content={<CustomTooltip suffix="mins delay" />} />
                <Line type="stepAfter" dataKey="delay" stroke="#f97316" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}