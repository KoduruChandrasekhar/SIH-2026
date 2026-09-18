import { useState, useEffect } from "react";
import {
  Activity,
  AlertTriangle,
  Camera,
  Gauge,
  Map as MapIcon,
  TrendingUp,
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
  Cell
} from "recharts";
import { MapContainer, TileLayer, Popup, CircleMarker, Circle } from "react-leaflet";
import Navbar from "../components/Navbar";
import CameraFeedCard from "../components/CameraFeedCard";
import { useTheme } from "../ThemeContext";
import { fetchDashboard, fetchCameras } from "../api";
import { cameras as localCameraFeeds } from "../data";

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
    trafficChange: "-10%",
    since: "3 PM",
    color: "#10b981",
  },
  {
    id: "CAM-04 (Balanagar Cross)",
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
  },
];

const localFlowTrendsData = [
  { time: "6 AM", volume: 4000 }, { time: "9 AM", volume: 11000 },
  { time: "12 PM", volume: 7500 }, { time: "3 PM", volume: 8500 },
  { time: "6 PM", volume: 13500 }, { time: "9 PM", volume: 5000 },
];

const localDensityTrendsData = [
  { time: "6 AM", density: 25 }, { time: "9 AM", density: 92 },
  { time: "12 PM", density: 55 }, { time: "3 PM", density: 70 },
  { time: "6 PM", density: 95 }, { time: "9 PM", density: 35 },
];

const localCongestionTrendsData = [
  { time: "6 AM", delay: 2 }, { time: "9 AM", delay: 28 },
  { time: "12 PM", delay: 12 }, { time: "3 PM", delay: 18 },
  { time: "6 PM", delay: 35 }, { time: "9 PM", delay: 5 },
];

// Custom Tooltip for Recharts
const CustomTooltip = ({ active, payload, label, suffix = "" }) => {
  const { theme } = useTheme();
  if (active && payload && payload.length) {
    return (
      <div className={`rounded-xl border px-3 py-2 shadow-xl backdrop-blur-md ${
        theme === 'dark' 
          ? 'border-gray-700 bg-gray-800/95 text-gray-200' 
          : 'border-gray-100 bg-white/95'
      }`}>
        <p className={`text-[10px] font-extrabold uppercase ${theme === 'dark' ? 'text-gray-400' : 'text-gray-400'}`}>{label}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: payload[0].color || payload[0].payload.color || "#3b82f6" }} />
          <span className={`text-xs font-black ${theme === 'dark' ? 'text-gray-100' : 'text-gray-900'}`}>
            {payload[0].value} {suffix}
          </span>
        </div>
      </div>
    );
  }
  return null;
};

export default function DashboardPage({ navigate, openModal }) {
  const { theme } = useTheme();
  const [camerasData, setCamerasData] = useState(localCamerasData);
  const [flowTrendsData, setFlowTrendsData] = useState(localFlowTrendsData);
  const [densityTrendsData, setDensityTrendsData] = useState(localDensityTrendsData);
  const [congestionTrendsData, setCongestionTrendsData] = useState(localCongestionTrendsData);
  const [selectedCam, setSelectedCam] = useState(localCamerasData[0]);
  const [cameraFeeds, setCameraFeeds] = useState(localCameraFeeds);

  // Fetch from API with fallback
  useEffect(() => {
    fetchDashboard().then((data) => {
      if (data) {
        if (data.cameras) { setCamerasData(data.cameras); setSelectedCam(data.cameras[0]); }
        if (data.flowTrends) setFlowTrendsData(data.flowTrends);
        if (data.densityTrends) setDensityTrendsData(data.densityTrends);
        if (data.congestionTrends) setCongestionTrendsData(data.congestionTrends);
      }
    });
    fetchCameras().then((data) => {
      if (data && data.cameras) setCameraFeeds(data.cameras);
    });
  }, []);

  const camId = selectedCam.id.split(' ')[0];
  const camName = selectedCam.id.replace(camId, '').trim().replace(/[()]/g, '');

  const gridColor = theme === 'dark' ? '#1e2030' : '#f3f4f6';
  const tickColor = theme === 'dark' ? '#6b7280' : '#9ca3af';
  const cursorFill = theme === 'dark' ? '#1e2030' : '#f9fafb';

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
      <div className="fade-up delay-100 rounded-[24px] border border-gray-200/80 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-3 w-3 rounded-full bg-purple-500 trace-live-dot" />
          <span className="text-xs font-extrabold uppercase tracking-widest text-purple-600">
            Module 01: Central Command Overview
          </span>
        </div>
        <h1 className="text-2xl font-black tracking-tight text-gray-900 mt-1">
          Network Dashboard & GIS Intelligence
        </h1>
        <p className="text-xs text-gray-500 mt-1 max-w-[800px]">
          Interactive multi-camera ANPR mapping, live density heatmaps, and macro-level urban traffic tracking metrics.
        </p>
      </div>

      {/* TOP SECTION: Map & Analytics Panel */}
      <div className="grid w-full gap-5 lg:grid-cols-[1.6fr_1fr]">
        
        {/* Left: GIS Map with Heatmap */}
        <div className="fade-up delay-200 flex h-[420px] flex-col rounded-[24px] border border-gray-200/80 bg-white p-4 shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between mb-3 px-2">
            <div>
              <h3 className="text-sm font-black text-gray-900">Live GIS & Heatmap</h3>
              <p className="text-[10px] font-bold text-gray-500">Camera Nodes & Density Radars</p>
            </div>
            
            {/* Map Legend */}
            <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/50 px-3 py-1.5 shadow-sm">
              <span className="text-[9px] font-extrabold uppercase text-gray-500 tracking-wider">Density:</span>
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
              
              {camerasData.map((cam) => (
                <div key={cam.id}>
                  {/* Heatmap Circle */}
                  <Circle
                    center={[cam.lat, cam.lng]}
                    radius={cam.densityValue * 8} 
                    pathOptions={{ color: cam.color, fillColor: cam.color, fillOpacity: 0.2, stroke: false }}
                  />
                  {/* Clickable Camera Node */}
                  <CircleMarker
                    center={[cam.lat, cam.lng]}
                    radius={8}
                    pathOptions={{ color: '#fff', weight: 2.5, fillColor: cam.color, fillOpacity: 1 }}
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
        <div className="fade-up delay-300 flex h-[420px] flex-col rounded-[24px] border border-gray-200/80 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex flex-col">
              <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                Analytics 
                <span className="text-blue-600 text-[11px] font-extrabold uppercase tracking-wider bg-blue-50 px-2.5 py-1 rounded-lg">
                  {camId}
                </span>
              </h3>
              <p className="text-xs font-bold text-gray-500 mt-1">({camName})</p>
            </div>
            <div className="p-2 rounded-xl bg-gray-50 border border-gray-100">
              <Camera size={20} className="text-gray-400" />
            </div>
          </div>

          <div className="flex flex-col gap-4 flex-1 justify-center mt-2">
            
            {/* Speed & Density Cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col rounded-[20px] bg-white p-5 shadow-sm border border-gray-100 transition-all hover:shadow-md hover:border-blue-100">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 flex items-center gap-1.5 mb-2">
                  <Gauge size={14} className="text-blue-500" /> Avg Speed
                </span>
                <span className="text-3xl font-black text-gray-900 tracking-tight">
                  {selectedCam.speed} <span className="text-sm font-bold text-gray-500">km/h</span>
                </span>
              </div>
              
              <div className="flex flex-col rounded-[20px] bg-white p-5 shadow-sm border border-gray-100 transition-all hover:shadow-md">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 flex items-center gap-1.5 mb-2">
                  <Activity size={14} style={{ color: selectedCam.color }} /> Density
                </span>
                <span className="text-3xl font-black tracking-tight" style={{ color: selectedCam.color }}>
                  {selectedCam.density}
                </span>
              </div>
            </div>

            {/* List Details */}
            <div className="flex flex-col gap-0 rounded-[20px] bg-gray-50/50 border border-gray-100 p-2 overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-100 p-3">
                <span className="text-xs font-bold text-gray-500">Current Trend:</span>
                <span className="text-[11px] font-black text-gray-800 bg-white px-3 py-1.5 rounded-lg shadow-sm border border-gray-100">
                  {selectedCam.trend}
                </span>
              </div>
              <div className="flex items-center justify-between p-3">
                <span className="text-xs font-bold text-gray-500">Volume (since {selectedCam.since}):</span>
                <span className={`text-[11px] font-black flex items-center gap-1 bg-white px-2.5 py-1.5 rounded-lg shadow-sm border border-gray-100 ${selectedCam.trafficChange.includes('+') ? 'text-red-500' : 'text-emerald-500'}`}>
                  {selectedCam.trafficChange.includes('+') ? <TrendingUp size={14} /> : <TrendingUp size={14} className="rotate-180" />}
                  {selectedCam.trafficChange}
                </span>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* CAMERA FEEDS SECTION — Simulated AI CCTV */}
      <div className="fade-up delay-300">
        <div className="flex items-center justify-between mb-4 px-1">
          <div>
            <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
              <Camera size={16} className="text-blue-500" />
              Live Camera Feeds
              <span className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400 ml-1">AI Simulation</span>
            </h3>
            <p className="text-[10px] font-bold text-gray-500 mt-0.5">Hover to view simulated CCTV feed with AI detection overlays</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-gray-100 bg-gray-50/50 px-2.5 py-1.5 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-green-500 trace-live-dot" />
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-500">{cameraFeeds.length} Feeds Online</span>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cameraFeeds.map((cam, i) => (
            <CameraFeedCard key={cam.id} camera={cam} index={i} />
          ))}
        </div>
      </div>

      {/* BOTTOM SECTION: The 3 Requested Graphs */}
      <div className="grid w-full gap-5 lg:grid-cols-3">
        
        {/* Graph 1: Traffic Flow Trends */}
        <div className="fade-up delay-400 flex h-[300px] flex-col rounded-[24px] border border-gray-200/80 bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
          <div className="mb-4">
            <h3 className="text-sm font-black text-gray-900 flex items-center gap-1.5">
              <Activity size={16} className="text-blue-500" /> Traffic Flow Trends
            </h3>
            <p className="text-[10px] font-bold text-gray-500 mt-0.5">Total volume over time</p>
          </div>
          <div className="flex-1 w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={flowTrendsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorFlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: tickColor, fontWeight: 700 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: tickColor, fontWeight: 700 }} tickFormatter={(val) => `${val / 1000}k`} />
                <Tooltip content={<CustomTooltip suffix="Vehicles" />} />
                <Area type="monotone" dataKey="volume" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorFlow)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Graph 2: Traffic Density Trends */}
        <div className="fade-up delay-500 flex h-[300px] flex-col rounded-[24px] border border-gray-200/80 bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
          <div className="mb-4">
            <h3 className="text-sm font-black text-gray-900 flex items-center gap-1.5">
              <MapIcon size={16} className="text-purple-500" /> Traffic Density Trends
            </h3>
            <p className="text-[10px] font-bold text-gray-500 mt-0.5">Road capacity utilization (%)</p>
          </div>
          <div className="flex-1 w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={densityTrendsData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: tickColor, fontWeight: 700 }} dy={10} />
                <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: tickColor, fontWeight: 700 }} />
                <Tooltip content={<CustomTooltip suffix="%" />} cursor={{ fill: cursorFill }} />
                <Bar dataKey="density" radius={[4, 4, 0, 0]} barSize={24}>
                  {densityTrendsData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.density > 85 ? '#ef4444' : entry.density > 50 ? '#f97316' : '#10b981'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Graph 3: Congestion Trends */}
        <div className="fade-up delay-[600ms] flex h-[300px] flex-col rounded-[24px] border border-gray-200/80 bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
          <div className="mb-4">
            <h3 className="text-sm font-black text-gray-900 flex items-center gap-1.5">
              <AlertTriangle size={16} className="text-orange-500" /> Congestion Trends
            </h3>
            <p className="text-[10px] font-bold text-gray-500 mt-0.5">Average delay in minutes</p>
          </div>
          <div className="flex-1 w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={congestionTrendsData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: tickColor, fontWeight: 700 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: tickColor, fontWeight: 700 }} />
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