import { useState, useEffect, useMemo } from "react";
import {
  Activity,
  BarChart3,
  Gauge,
  Map,
  MapPin,
  Search,
  TrafficCone,
  TrendingUp,
  Zap,
  AlertTriangle,
  ArrowRight,
  Filter
} from "lucide-react";
import { MapContainer, TileLayer, Circle, Popup } from "react-leaflet";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Area,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Navbar from "../components/Navbar";
import { ChartTooltip, hourTicks, useChartTheme } from "../components/charts/ChartKit";
import { fetchTrafficCorridors, fetchTrafficOD } from "../api";
import { SNAPSHOT_TIME, cameraById, corridorsFeed, hourlyTraffic, trafficSummary } from "../data";

// Corridor + OD data come from the shared dataset (src/data.js) so the map, lists, charts,
// Dashboard and Alerts all describe the same evening-peak situation.
const localCorridors = corridorsFeed;
const localOdRoutes = trafficSummary.odRoutes;
const STATUS_COLOR = { Severe: "#ef4444", High: "#f97316", Moderate: "#eab308", Low: "#22c55e" };
const countOf = (label) => parseInt(String(label).replace(/\D/g, ""), 10) || 0;

export default function TrafficPage({ navigate, openModal }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [corridors, setCorridors] = useState(localCorridors);
  const [odRoutes, setOdRoutes] = useState(localOdRoutes);
  const [selectedCorridor, setSelectedCorridor] = useState(localCorridors[0]);
  const chart = useChartTheme();

  // Fetch from API with fallback
  useEffect(() => {
    fetchTrafficCorridors().then((data) => {
      if (data) { setCorridors(data); setSelectedCorridor(data[0]); }
    });
    fetchTrafficOD().then((data) => {
      if (data) setOdRoutes(data);
    });
  }, []);

  // Live telemetry pulse: density drifts a few points around its reading, speed responds inversely
  useEffect(() => {
    const interval = setInterval(() => {
      setCorridors((prev) =>
        prev.map((c) => {
          const baseDensity = c.density0 ?? c.density;
          const baseSpeed = c.speed0 ?? c.speed;
          const density = Math.min(baseDensity + 4, Math.max(baseDensity - 4, Math.round(c.density + (Math.random() - 0.5) * 3)));
          const speed = Math.max(5, Math.round(baseSpeed + (baseDensity - density) * 0.45));
          return { ...c, density0: baseDensity, speed0: baseSpeed, density, speed };
        })
      );
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const nowHour = hourlyTraffic[Number(SNAPSHOT_TIME.slice(0, 2))];
  const bottlenecks = corridors.filter((c) => c.status === "Severe" || c.status === "High");
  const odTotal = odRoutes.reduce((sum, r) => sum + countOf(r.count), 0);
  const odMax = Math.max(...odRoutes.map((r) => countOf(r.count)), 1);
  const routeDensity = useMemo(
    () =>
      [...corridors]
        .map((c) => ({ name: c.name, id: c.id, volume: c.volume ?? Math.round(c.density * 28), status: c.status }))
        .sort((a, b) => b.volume - a.volume),
    [corridors]
  );

  // Filter corridors based on search query
  const filteredCorridors = corridors.filter((corridor) =>
    corridor.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    corridor.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    corridor.status.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="relative flex w-full flex-col gap-6 pb-10">
      
      {/* Background Blobs (Orange/Yellow Theme for Traffic) */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="animate-blob absolute -left-[10%] top-[-5%] h-[400px] w-[400px] rounded-full bg-orange-300/25 mix-blend-multiply blur-[100px] filter" />
        <div className="animate-blob animation-delay-2000 absolute right-[-5%] top-[20%] h-[400px] w-[400px] rounded-full bg-yellow-300/25 mix-blend-multiply blur-[100px] filter" />
      </div>

      {/* Navbar */}
      <div className="fade-up w-full">
        <Navbar page="traffic" navigate={navigate} openModal={openModal} />
      </div>

      {/* Header Banner */}
      <div className="fade-up delay-100 rounded-[24px] border border-white/60 bg-white/80 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-3 w-3 rounded-full bg-orange-500 trace-live-dot" />
            <span className="text-xs font-extrabold uppercase tracking-widest text-orange-600">
              Module 03: Macro Traffic Flow & Movement Analytics
            </span>
          </div>
          <button
            onClick={() => openModal("Export Traffic Data", "City-wide traffic telemetry and CSV summary exported successfully.")}
            className="rounded-xl bg-gray-900 px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-gray-800 transition"
          >
            Export CSV Report
          </button>
        </div>
        <h1 className="text-2xl font-black tracking-tight text-gray-900 mt-1">
          City-Wide Traffic Intelligence
        </h1>
        <p className="text-xs text-gray-500 mt-1 max-w-[800px]">
          Aggregated ANPR camera data visualizing city-wide traffic dynamics, density heatmaps, origin-destination patterns, and congestion bottlenecks.
        </p>
      </div>

      {/* Metrics Row — derived from the hourly profile and corridor data */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Network Average Speed" value={`${nowHour.speed} km/h`} trend={`at ${SNAPSHOT_TIME} · 24h avg ${trafficSummary.networkAverageSpeed}`} icon={Gauge} color="text-blue-600" />
        <MetricCard title="Active Bottlenecks" value={`${bottlenecks.length} corridors`} trend={bottlenecks.map((c) => c.id).join(" · ") || "None"} icon={TrafficCone} color="text-orange-500" />
        <MetricCard title="Vehicle Volume (1h)" value={nowHour.flow.toLocaleString("en-IN")} trend="veh/h · evening peak" icon={Activity} color="text-emerald-600" />
        <MetricCard title="O-D Trips Matched" value={odTotal.toLocaleString("en-IN")} trend={`${odRoutes.length} zone pairs · today`} icon={TrendingUp} color="text-purple-600" />
      </div>

      {/* Main Grid: GIS Heatmap (Left) + Search & Corridors (Right) */}
      <div className="grid w-full gap-5 lg:grid-cols-[1.4fr_1fr] xl:grid-cols-[1.6fr_1fr]">
        
        {/* LEFT COLUMN: GIS Traffic Heatmap */}
        <div className="fade-up delay-300 flex flex-col gap-5">
          <div className="flex h-[500px] flex-col rounded-[28px] border border-white/80 bg-white/70 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
            <div className="flex items-center justify-between mb-3 px-2">
              <div className="flex items-center gap-2">
                <Map size={16} className="text-orange-500" />
                <h3 className="text-xs font-extrabold text-gray-800 uppercase tracking-wider">
                  Live Density Heatmap
                </h3>
              </div>
              <span className="flex items-center gap-1.5 rounded-full bg-orange-100 px-2 py-0.5 text-[9px] font-bold text-orange-600">
                <Zap size={10} /> Auto-Sync Active
              </span>
            </div>

            <div className="relative flex-1 w-full rounded-[20px] overflow-hidden border border-gray-200/60 shadow-inner z-10">
              <MapContainer
                center={[17.475, 78.41]}
                zoom={12}
                scrollWheelZoom={false}
                style={{ width: "100%", height: "100%" }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {corridors.map((corridor) => (
                  <Circle
                    key={corridor.id}
                    center={[corridor.lat, corridor.lng]}
                    radius={300 + corridor.density * 9} // radius grows with density
                    pathOptions={{
                      color: corridor.color,
                      fillColor: corridor.color,
                      fillOpacity: 0.4,
                      weight: 2,
                    }}
                    eventHandlers={{
                      click: () => setSelectedCorridor(corridor),
                    }}
                  >
                    <Popup>
                      <div className="p-1">
                        <h4 className="text-[11px] font-bold text-gray-900">{corridor.name}</h4>
                        <p className="text-[10px] text-gray-500 mt-0.5">Speed: {corridor.speed} km/h · Density: {corridor.density}%</p>
                        <p className="text-[10px] font-semibold" style={{ color: corridor.color }}>
                          Status: {corridor.status}
                        </p>
                      </div>
                    </Popup>
                  </Circle>
                ))}
              </MapContainer>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Search Bar & Corridor List */}
        <div className="fade-up delay-200 flex flex-col gap-4">
          
          {/* Controls Bar - Search Bar */}
          <div className="flex items-center gap-3 rounded-[20px] border border-white/80 bg-white/80 p-3 shadow-sm backdrop-blur-xl">
            <div className="relative w-full">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search sector, corridor, or status..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-gray-200/80 bg-gray-50/50 pl-10 pr-4 py-2.5 text-xs font-semibold text-gray-800 placeholder-gray-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 transition-all"
              />
            </div>
          </div>

          {/* Corridor Cards List */}
          <div className="flex flex-col gap-3.5 overflow-y-auto pr-1 pb-4" style={{ maxHeight: "440px" }}>
            {filteredCorridors.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-gray-300 bg-white/60 p-12 text-center text-xs font-bold text-gray-400">
                No corridors match your search.
              </div>
            ) : (
              filteredCorridors.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedCorridor(item)}
                  className={`group relative flex flex-col gap-3 rounded-[24px] border bg-white/70 p-5 transition-all duration-300 cursor-pointer backdrop-blur-xl hover:bg-white hover:shadow-md ${selectedCorridor.id === item.id ? 'border-orange-500 ring-1 ring-orange-500' : 'border-white/80'}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-sm font-black text-gray-900 tracking-tight">{item.name}</h4>
                      <div className="flex items-center gap-1.5 mt-1">
                        <MapPin size={12} className="text-gray-400" />
                        <span className="text-[10px] font-bold text-gray-500">{item.id}</span>
                      </div>
                    </div>
                    <span
                      className="rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-white shadow-sm"
                      style={{ backgroundColor: item.color }}
                    >
                      {item.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-gray-100 pt-3">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-extrabold text-gray-400 uppercase">Avg Speed</span>
                      <span className="text-lg font-black text-gray-900">{item.speed} <span className="text-[10px] text-gray-500">km/h</span></span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-extrabold text-gray-400 uppercase">Density Index</span>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-black text-gray-900">{item.density}%</span>
                        <span className={`text-[10px] font-bold ${item.trend.includes('+') ? 'text-red-500' : 'text-emerald-500'}`}>
                          {item.trend}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* Speed vs density + route density */}
      <div className="grid w-full gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="premium-panel flex h-[320px] flex-col p-5">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-black text-gray-900"><BarChart3 size={16} className="text-blue-500" /> Average speed vs density</h3>
              <p className="text-[10px] font-bold text-gray-500">Cluster-wide, hourly · today — speed falls as capacity fills</p>
            </div>
            <div className="tn-chart-legend">
              <span><i style={{ background: "#3b82f6" }} />Avg speed (km/h)</span>
              <span><i style={{ background: "#a855f7" }} />Density (% capacity)</span>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={hourlyTraffic} margin={{ top: 14, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="hour" tick={chart.tick} tickFormatter={hourTicks(3)} interval={0} axisLine={false} tickLine={false} dy={6} />
                <YAxis yAxisId="speed" domain={[0, 60]} tick={chart.tick} axisLine={false} tickLine={false} width={38} label={{ value: "km/h", angle: -90, position: "insideLeft", style: chart.axisLabel }} />
                <YAxis yAxisId="density" orientation="right" domain={[0, 100]} tick={chart.tick} axisLine={false} tickLine={false} width={38} tickFormatter={(v) => `${v}%`} />
                <Tooltip cursor={chart.cursorLine} content={<ChartTooltip units={{ speed: "km/h", density: "%" }} />} />
                <ReferenceLine yAxisId="speed" x={`${SNAPSHOT_TIME.slice(0, 2)}:00`} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "now", position: "top", style: chart.axisLabel }} />
                <Area yAxisId="density" type="monotone" dataKey="density" name="Density" stroke="#a855f7" strokeWidth={1.5} fill="#a855f7" fillOpacity={0.12} />
                <Line yAxisId="speed" type="monotone" dataKey="speed" name="Avg speed" stroke="#3b82f6" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="premium-panel flex h-[320px] flex-col p-5">
          <div className="mb-2">
            <h3 className="flex items-center gap-2 text-sm font-black text-gray-900"><TrafficCone size={16} className="text-orange-500" /> Route density by corridor</h3>
            <p className="text-[10px] font-bold text-gray-500">Vehicles per hour at {SNAPSHOT_TIME} · colour = congestion status</p>
          </div>
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={routeDensity} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" domain={[0, 3000]} ticks={[0, 1000, 2000, 3000]} tick={chart.tick} axisLine={false} tickLine={false} tickFormatter={(v) => (v ? `${v / 1000}k veh/h` : "0")} />
                <YAxis type="category" dataKey="id" tick={chart.tick} axisLine={false} tickLine={false} width={52} />
                <Tooltip cursor={{ fill: chart.cursor }} content={<ChartTooltip units={{ volume: "veh/h" }} />} labelFormatter={(id) => routeDensity.find((r) => r.id === id)?.name} />
                <Bar dataKey="volume" name="Volume" radius={[0, 4, 4, 0]} maxBarSize={20}>
                  {routeDensity.map((r) => (
                    <Cell key={r.id} fill={STATUS_COLOR[r.status] ?? "#3b82f6"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* NEW SECTION: Origin-Destination & Corridor Analysis Breakdown */}
      <div className="grid w-full gap-5 lg:grid-cols-2">
        
        {/* Origin-Destination Patterns */}
        <div className="rounded-[28px] border border-white/80 bg-white/70 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className="text-purple-600" />
              <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">Origin–Destination (O-D) Flows</h3>
            </div>
            <span className="text-[10px] font-bold text-gray-400">Sector-to-Sector Movement</span>
          </div>
          <div className="flex flex-col gap-3">
            {odRoutes.map((route, idx) => (
              <div key={idx} className="rounded-2xl bg-white/80 p-4 border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-xs text-gray-800">
                    <span>{route.origin}</span>
                    <ArrowRight size={14} className="text-purple-500" />
                    <span>{route.destination}</span>
                  </div>
                  <span className="font-mono text-xs font-black text-purple-600 bg-purple-50 px-3 py-1 rounded-lg">
                    {route.count}
                  </span>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-purple-500" style={{ width: `${(countOf(route.count) / odMax) * 100}%` }} />
                </div>
              </div>
            ))}
            <p className="text-[10px] font-bold text-gray-400">Trips where the same plate was read in both zones today (ANPR-matched).</p>
          </div>
        </div>

        {/* Selected Corridor Deep-Dive Analysis */}
        <div className="rounded-[28px] border border-white/80 bg-white/70 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrafficCone size={18} className="text-orange-500" />
              <h3 className="text-sm font-black text-gray-900 uppercase tracking-wide">Corridor Bottleneck Analysis</h3>
            </div>
            <span className="font-mono text-xs font-black text-orange-600 bg-orange-50 px-2.5 py-1 rounded-md">{selectedCorridor.id}</span>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-2xl bg-white/80 p-4 border border-gray-100 shadow-sm">
              <span className="text-xs font-bold text-gray-500">Selected Corridor Name:</span>
              <span className="text-xs font-black text-gray-900">{selectedCorridor.name}</span>
            </div>

            {selectedCorridor.cameras && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/80 p-4 border border-gray-100 shadow-sm">
                <span className="text-xs font-bold text-gray-500">Monitoring cameras:</span>
                <span className="flex flex-wrap gap-1.5">
                  {selectedCorridor.cameras.map((id) => (
                    <span key={id} className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-[10px] font-black text-gray-700" title={cameraById[id]?.name}>
                      {cameraById[id]?.code ?? id}
                    </span>
                  ))}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col rounded-2xl bg-white/80 p-3.5 border border-gray-100 shadow-sm">
                <span className="text-[10px] font-bold text-gray-400 uppercase">Bottleneck Status</span>
                <span className="text-xs font-black text-red-600 mt-1 flex items-center gap-1">
                  <AlertTriangle size={14} /> {selectedCorridor.bottleneck}
                </span>
              </div>
              <div className="flex flex-col rounded-2xl bg-white/80 p-3.5 border border-gray-100 shadow-sm">
                <span className="text-[10px] font-bold text-gray-400 uppercase">Congested Road Length</span>
                <span className="text-xs font-black text-gray-900 mt-1">{selectedCorridor.length}</span>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-white/80 p-4 border border-gray-100 shadow-sm">
              <span className="text-xs font-bold text-gray-500">Estimated Delay Duration:</span>
              <span className="text-xs font-black text-orange-600">{selectedCorridor.duration} peak delay</span>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}

function MetricCard({ title, value, trend, icon: Icon, color }) {
  return (
    <div className="rounded-[24px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl transition-transform hover:-translate-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-extrabold text-gray-400 uppercase tracking-wider">{title}</span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-xl bg-gray-100 ${color}`}>
          <Icon size={16} />
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <h2 className="text-xl font-black text-gray-900 tracking-tight">{value}</h2>
        <span className="text-[10px] font-bold text-gray-500 truncate ml-2">{trend}</span>
      </div>
    </div>
  );
}