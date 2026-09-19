import { useState, useEffect, useMemo } from "react";
import {
  Activity,
  BarChart3,
  Gauge,
  Map as MapIcon,
  MapPin,
  Search,
  TrafficCone,
  TrendingUp,
  Zap,
  AlertTriangle,
  ArrowRight,
  Filter,
} from "lucide-react";
import { LineLayer, ScatterplotLayer } from "@deck.gl/layers";
import Navbar from "../components/Navbar";
import DeckGLMap from "../components/DeckGLMap";
import { fetchTrafficCorridors, fetchTrafficOD } from "../api";

// Known Hyderabad Sector GPS Coordinates for O-D Flow Mapping
const SECTOR_COORDS = {
  "Kukatpally": [78.3996, 17.4947],
  "Balanagar": [78.4357, 17.4682],
  "Madhapur": [78.3742, 17.4485],
  "Cyberabad": [78.3742, 17.4485],
  "JNTU": [78.3912, 17.4985],
  "Begumpet": [78.4735, 17.4435],
  "Gachibowli": [78.3489, 17.4401],
};

// Mock Traffic Corridor Data
const localCorridors = [
  {
    id: "COR-01",
    name: "Kukatpally Y-Junction",
    status: "Severe",
    density: 92,
    speed: 12,
    trend: "+15%",
    lat: 17.4947,
    lng: 78.3996,
    color: "#ef4444",
    rgb: [239, 68, 68],
    bottleneck: "Active Signal Jam",
    length: "1.4 km",
    duration: "45 mins",
  },
  {
    id: "COR-02",
    name: "Cyberabad IT Corridor",
    status: "High",
    density: 78,
    speed: 22,
    trend: "+5%",
    lat: 17.4485,
    lng: 78.3742,
    color: "#f97316",
    rgb: [249, 115, 22],
    bottleneck: "Peak Tech Outflow",
    length: "2.8 km",
    duration: "30 mins",
  },
  {
    id: "COR-03",
    name: "Balanagar Industrial",
    status: "Moderate",
    density: 45,
    speed: 40,
    trend: "-2%",
    lat: 17.4682,
    lng: 78.4357,
    color: "#eab308",
    rgb: [234, 179, 8],
    bottleneck: "Heavy Transit Merging",
    length: "0.9 km",
    duration: "15 mins",
  },
  {
    id: "COR-04",
    name: "JNTU Main Road",
    status: "Low",
    density: 25,
    speed: 55,
    trend: "Stable",
    lat: 17.4985,
    lng: 78.3912,
    color: "#22c55e",
    rgb: [34, 197, 94],
    bottleneck: "None",
    length: "0 km",
    duration: "0 mins",
  },
];

// Origin-Destination Mock Routes with Coordinates & Parabolic Flow Telemetry
const localOdRoutes = [
  {
    id: "OD-1",
    origin: "Kukatpally",
    destination: "Balanagar",
    fromCoords: [78.3996, 17.4947],
    toCoords: [78.4357, 17.4682],
    count: "1,842 vehicles/h",
    volume: 1842,
    sourceColor: [34, 211, 238],
    targetColor: [249, 115, 22],
  },
  {
    id: "OD-2",
    origin: "Balanagar",
    destination: "Madhapur",
    fromCoords: [78.4357, 17.4682],
    toCoords: [78.3742, 17.4485],
    count: "1,426 vehicles/h",
    volume: 1426,
    sourceColor: [59, 130, 246],
    targetColor: [168, 85, 247],
  },
  {
    id: "OD-3",
    origin: "Kukatpally",
    destination: "Cyberabad",
    fromCoords: [78.3996, 17.4947],
    toCoords: [78.3742, 17.4485],
    count: "2,103 vehicles/h",
    volume: 2103,
    sourceColor: [168, 85, 247],
    targetColor: [239, 68, 68],
  },
  {
    id: "OD-4",
    origin: "JNTU",
    destination: "Cyberabad",
    fromCoords: [78.3912, 17.4985],
    toCoords: [78.3742, 17.4485],
    count: "965 vehicles/h",
    volume: 965,
    sourceColor: [34, 197, 94],
    targetColor: [249, 115, 22],
  },
];

export default function TrafficPage({ navigate, openModal }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [corridors, setCorridors] = useState(localCorridors);
  const [odRoutes, setOdRoutes] = useState(localOdRoutes);
  const [selectedCorridor, setSelectedCorridor] = useState(localCorridors[0]);
  const [hoveredCorridor, setHoveredCorridor] = useState(null);
  const [showFlowLines, setShowFlowLines] = useState(true);
  const [selectedOD, setSelectedOD] = useState(null);
  const [hoveredOD, setHoveredOD] = useState(null);

  // Fetch from API with fallback
  useEffect(() => {
    fetchTrafficCorridors().then((data) => {
      if (data && data.length > 0) {
        setCorridors(data);
        setSelectedCorridor(data[0]);
      }
    });
    fetchTrafficOD().then((data) => {
      if (data && data.length > 0) setOdRoutes(data);
    });
  }, []);

  // Live telemetry pulse effect for corridor speeds and densities
  useEffect(() => {
    const interval = setInterval(() => {
      setCorridors((prev) =>
        prev.map((c) => {
          const deltaDensity = (Math.random() - 0.5) * 4;
          const deltaSpeed = (Math.random() - 0.5) * 3;
          const newDensity = Math.min(99, Math.max(10, Math.round(c.density + deltaDensity)));
          const newSpeed = Math.min(80, Math.max(5, Math.round(c.speed + deltaSpeed)));
          return { ...c, density: newDensity, speed: newSpeed };
        })
      );
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Filter corridors based on search query
  const filteredCorridors = corridors.filter((corridor) =>
    corridor.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    corridor.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    corridor.status.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Deck.gl layers for corridor density hotspots & 3D parabolic O-D arcs
  const layers = useMemo(() => {
    // Outer halo layer
    const haloLayer = new ScatterplotLayer({
      id: "corridor-halo-layer",
      data: corridors,
      getPosition: (d) => [d.lng, d.lat],
      getRadius: (d) => d.density * 16,
      getFillColor: (d) => {
        const rgb = d.rgb || [249, 115, 22];
        return [...rgb, 40];
      },
      getLineColor: (d) => {
        const rgb = d.rgb || [249, 115, 22];
        return [...rgb, 120];
      },
      stroked: true,
      lineWidthMinPixels: 1.5,
      radiusMinPixels: 20,
      radiusMaxPixels: 80,
      pickable: false,
    });

    // Core 2D circular disk marker layer (clean tactical disks, no extruded pillars)
    const coreLayer = new ScatterplotLayer({
      id: "corridor-signal-disks",
      data: corridors,
      getPosition: (d) => [d.lng, d.lat],
      getRadius: 160,
      radiusMinPixels: 8,
      radiusMaxPixels: 16,
      getFillColor: (d) => {
        const rgb = d.rgb || [249, 115, 22];
        return [...rgb, 240];
      },
      getLineColor: [255, 255, 255, 255],
      lineWidthMinPixels: 2.5,
      stroked: true,
      filled: true,
      pickable: true,
      onClick: ({ object }) => {
        if (object) setSelectedCorridor(object);
      },
      onHover: ({ object }) => {
        setHoveredCorridor(object || null);
      },
    });

    // 2D Origin-Destination Corridor Flow Lines (flat 2D, no 3D arcs)
    const odFlowLayer = new LineLayer({
      id: "od-flow-lines",
      data: odRoutes.map((r) => ({
        ...r,
        fromCoords: r.fromCoords || SECTOR_COORDS[r.origin] || [78.3996, 17.4947],
        toCoords: r.toCoords || SECTOR_COORDS[r.destination] || [78.4357, 17.4682],
        sourceColor: r.sourceColor || [168, 85, 247],
        targetColor: r.targetColor || [59, 130, 246],
      })),
      getSourcePosition: (d) => d.fromCoords,
      getTargetPosition: (d) => d.toCoords,
      getColor: (d) => [...(d.sourceColor || [168, 85, 247]), 210],
      getWidth: (d) => Math.max(3, ((d.volume || 1400) / 500) * 2),
      widthMinPixels: 2.5,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 220],
      onClick: ({ object }) => {
        if (object) setSelectedOD(object);
      },
      onHover: ({ object }) => {
        setHoveredOD(object || null);
      },
    });

    return showFlowLines ? [haloLayer, odFlowLayer, coreLayer] : [haloLayer, coreLayer];
  }, [corridors, odRoutes, showFlowLines]);

  return (
    <div className="relative flex w-full flex-col gap-6 pb-12 text-[var(--text-primary)]">
      {/* Background Ambience */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-[10%] top-[-5%] h-[400px] w-[400px] rounded-full bg-orange-500/10 blur-[120px]" />
        <div className="absolute right-[-5%] top-[20%] h-[400px] w-[400px] rounded-full bg-blue-500/10 blur-[120px]" />
      </div>

      {/* Navbar */}
      <div className="fade-up w-full">
        <Navbar page="traffic" navigate={navigate} openModal={openModal} />
      </div>

      {/* Header Banner */}
      <div className="fade-up delay-100 glass-card-static p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="live-dot bg-orange-500" style={{ boxShadow: "0 0 10px #f97316" }} />
            <span className="text-xs font-black uppercase tracking-widest text-orange-400">
              Module 03: Macro Traffic Flow & Movement Analytics
            </span>
          </div>
          <button
            onClick={() =>
              openModal(
                "Export Traffic Telemetry",
                "City-wide traffic telemetry and corridor CSV data exported successfully."
              )
            }
            className="btn-glass text-xs px-4 py-2 self-start sm:self-auto"
          >
            Export Telemetry CSV
          </button>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[var(--text-primary)] mt-3">
          City-Wide Traffic Intelligence
        </h1>
        <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-[850px] leading-relaxed">
          Aggregated ANPR camera data visualizing city-wide traffic dynamics, WebGL density heatmaps,
          origin-destination patterns, and congestion bottlenecks.
        </p>
      </div>

      {/* Metrics Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Network Average Speed"
          value="32 km/h"
          trend="-4% vs yesterday"
          icon={Gauge}
          color="text-blue-400"
          accent="rgba(59,130,246,0.15)"
        />
        <MetricCard
          title="Active Bottlenecks"
          value="2 Severe"
          trend="Kukatpally & IT Corridor"
          icon={TrafficCone}
          color="text-orange-400"
          accent="rgba(249,115,22,0.15)"
        />
        <MetricCard
          title="Vehicle Volume (1h)"
          value="14,280"
          trend="+12% Surge"
          icon={Activity}
          color="text-emerald-400"
          accent="rgba(16,185,129,0.15)"
        />
        <MetricCard
          title="O-D Routes Tracked"
          value="1,402"
          trend="Cross-city analysis"
          icon={TrendingUp}
          color="text-purple-400"
          accent="rgba(139,92,246,0.15)"
        />
      </div>

      {/* Main Grid: GIS Heatmap (Left) + Search & Corridors (Right) */}
      <div className="grid w-full gap-5 lg:grid-cols-[1.4fr_1fr] xl:grid-cols-[1.6fr_1fr]">
        {/* LEFT COLUMN: deck.gl Traffic Heatmap */}
        <div className="fade-up delay-200 flex flex-col gap-4">
          <div className="flex h-[520px] flex-col glass-card-static p-4">
            <div className="flex items-center justify-between mb-3 px-2">
              <div className="flex items-center gap-2">
                <MapIcon size={16} className="text-orange-400" />
                <h3 className="text-xs font-black uppercase tracking-wider text-[var(--text-primary)]">
                  Live Corridor & O-D GIS Map (deck.gl)
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowFlowLines((prev) => !prev)}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold transition-all ${
                    showFlowLines
                      ? "border-purple-500/50 bg-purple-500/20 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.25)]"
                      : "border-white/10 bg-white/5 text-gray-400 hover:text-white"
                  }`}
                  title="Toggle 2D Origin-Destination Flow Lines"
                >
                  <TrendingUp size={10} />
                  <span>{showFlowLines ? "O-D Flows: ON" : "O-D Flows: OFF"}</span>
                </button>
                <span className="flex items-center gap-1.5 rounded-full bg-orange-500/10 border border-orange-500/20 px-2.5 py-0.5 text-[10px] font-bold text-orange-400">
                  <Zap size={10} /> WebGL Accelerating
                </span>
              </div>
            </div>

            <div className="relative flex-1 w-full rounded-2xl overflow-hidden border border-[var(--border-subtle)]">
              <DeckGLMap
                layers={layers}
                initialViewState={{
                  longitude: 78.41,
                  latitude: 17.478,
                  zoom: 11.8,
                  pitch: 0,
                  bearing: 0,
                }}
              >
                {/* Floating Map Legend & Overlay */}
                <div className="absolute top-4 left-4 p-3 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 max-w-xs pointer-events-auto">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: selectedCorridor.color }}
                    />
                    <span className="text-[11px] font-bold text-white truncate">
                      {selectedCorridor.name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-300 gap-4 mt-1">
                    <span>Speed: <strong className="text-white">{selectedCorridor.speed} km/h</strong></span>
                    <span>Density: <strong className="text-white">{selectedCorridor.density}%</strong></span>
                    <span className="text-orange-400 font-bold">{selectedCorridor.status}</span>
                  </div>
                </div>

                {/* 2D O-D Flow Hover / Selection Readout */}
                {(hoveredOD || selectedOD) && (
                  <div className="absolute bottom-4 right-4 p-3 rounded-xl bg-black/85 backdrop-blur-md border border-purple-500/30 max-w-xs shadow-2xl pointer-events-auto">
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-purple-400 animate-pulse" />
                        <span className="text-[10px] font-black uppercase tracking-wider text-purple-300">
                          2D Corridor Flow
                        </span>
                      </div>
                      {selectedOD && !hoveredOD && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedOD(null);
                          }}
                          className="text-[9px] text-gray-400 hover:text-white"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs font-bold text-white mt-1.5">
                      <span>{(hoveredOD || selectedOD).origin}</span>
                      <ArrowRight size={13} className="text-purple-400" />
                      <span>{(hoveredOD || selectedOD).destination}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-gray-300 font-mono">
                      <span>Flow Volume:</span>
                      <span className="font-bold text-purple-300">
                        {(hoveredOD || selectedOD).count || `${(hoveredOD || selectedOD).volume} vehicles/h`}
                      </span>
                    </div>
                  </div>
                )}

                {hoveredCorridor && hoveredCorridor.id !== selectedCorridor.id && (
                  <div className="absolute bottom-4 left-4 p-2.5 rounded-lg bg-black/80 backdrop-blur-md border border-white/15 pointer-events-none">
                    <p className="text-[10px] font-bold text-white">{hoveredCorridor.name}</p>
                    <p className="text-[9px] text-gray-400">Click to select corridor</p>
                  </div>
                )}
              </DeckGLMap>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Search Bar & Corridor List */}
        <div className="fade-up delay-300 flex flex-col gap-4">
          {/* Controls Bar - Search Bar */}
          <div className="glass-card-static p-3">
            <div className="relative w-full">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Search sector, corridor, or status..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="glass-input w-full pl-10 pr-4 py-2.5 text-xs font-semibold"
              />
            </div>
          </div>

          {/* Corridor Cards List */}
          <div className="flex flex-col gap-3 overflow-y-auto pr-1 pb-2 custom-scrollbar" style={{ maxHeight: "440px" }}>
            {filteredCorridors.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-glass)] p-12 text-center text-xs font-bold text-[var(--text-muted)]">
                No corridors match your search.
              </div>
            ) : (
              filteredCorridors.map((item) => {
                const isSelected = selectedCorridor.id === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedCorridor(item)}
                    className={`glass-card p-4 flex flex-col gap-3 cursor-pointer transition-all duration-300 ${
                      isSelected
                        ? "border-orange-500/80 bg-orange-500/[0.06] shadow-[0_0_20px_rgba(249,115,22,0.15)]"
                        : "hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="text-sm font-black text-[var(--text-primary)] tracking-tight">
                          {item.name}
                        </h4>
                        <div className="flex items-center gap-1.5 mt-1">
                          <MapPin size={12} className="text-[var(--text-muted)]" />
                          <span className="text-[10px] font-bold text-[var(--text-secondary)]">{item.id}</span>
                        </div>
                      </div>
                      <span
                        className="rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white shadow-sm"
                        style={{ backgroundColor: item.color }}
                      >
                        {item.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 border-t border-[var(--border-subtle)] pt-3">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-extrabold text-[var(--text-muted)] uppercase">
                          Avg Speed
                        </span>
                        <span className="text-base font-black text-[var(--text-primary)]">
                          {item.speed} <span className="text-[10px] text-[var(--text-secondary)]">km/h</span>
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-extrabold text-[var(--text-muted)] uppercase">
                          Density Index
                        </span>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-base font-black text-[var(--text-primary)]">{item.density}%</span>
                          <span
                            className={`text-[10px] font-bold ${
                              item.trend.includes("+") ? "text-red-400" : "text-emerald-400"
                            }`}
                          >
                            {item.trend}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Origin-Destination & Corridor Analysis Breakdown */}
      <div className="grid w-full gap-5 lg:grid-cols-2">
        {/* Origin-Destination Patterns */}
        <div className="glass-card-static p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className="text-purple-400" />
              <h3 className="text-sm font-black uppercase tracking-wide text-[var(--text-primary)]">
                Origin–Destination (O-D) Flows
              </h3>
            </div>
            <span className="text-[10px] font-bold text-[var(--text-muted)]">
              Sector-to-Sector Movement
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {odRoutes.map((route, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-xl bg-white/[0.02] border border-[var(--border-subtle)] p-3.5 transition-colors hover:bg-white/[0.04]"
              >
                <div className="flex items-center gap-2 font-bold text-xs text-[var(--text-primary)]">
                  <span>{route.origin}</span>
                  <ArrowRight size={14} className="text-purple-400" />
                  <span>{route.destination}</span>
                </div>
                <span className="font-mono text-xs font-black text-purple-400 bg-purple-500/10 border border-purple-500/20 px-3 py-1 rounded-lg">
                  {route.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Selected Corridor Deep-Dive Analysis */}
        <div className="glass-card-static p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrafficCone size={18} className="text-orange-400" />
              <h3 className="text-sm font-black uppercase tracking-wide text-[var(--text-primary)]">
                Corridor Bottleneck Analysis
              </h3>
            </div>
            <span className="font-mono text-xs font-black text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2.5 py-1 rounded-md">
              {selectedCorridor.id}
            </span>
          </div>

          <div className="flex flex-col gap-3.5">
            <div className="flex items-center justify-between rounded-xl bg-white/[0.02] border border-[var(--border-subtle)] p-3.5">
              <span className="text-xs font-bold text-[var(--text-secondary)]">Corridor Name:</span>
              <span className="text-xs font-black text-[var(--text-primary)]">{selectedCorridor.name}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col rounded-xl bg-white/[0.02] border border-[var(--border-subtle)] p-3.5">
                <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Bottleneck Status</span>
                <span className="text-xs font-black text-red-400 mt-1 flex items-center gap-1">
                  <AlertTriangle size={14} /> {selectedCorridor.bottleneck}
                </span>
              </div>
              <div className="flex flex-col rounded-xl bg-white/[0.02] border border-[var(--border-subtle)] p-3.5">
                <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Congested Length</span>
                <span className="text-xs font-black text-[var(--text-primary)] mt-1">{selectedCorridor.length}</span>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-white/[0.02] border border-[var(--border-subtle)] p-3.5">
              <span className="text-xs font-bold text-[var(--text-secondary)]">Estimated Delay Duration:</span>
              <span className="text-xs font-black text-orange-400">{selectedCorridor.duration} peak delay</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, trend, icon: Icon, color, accent }) {
  return (
    <div className="glass-card p-5 flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-extrabold text-[var(--text-muted)] uppercase tracking-wider">
          {title}
        </span>
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-xl ${color}`}
          style={{ background: accent }}
        >
          <Icon size={16} />
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <h2 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">{value}</h2>
        <span className="text-[10px] font-bold text-[var(--text-secondary)] truncate ml-2">{trend}</span>
      </div>
    </div>
  );
}
