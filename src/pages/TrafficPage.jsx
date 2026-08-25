import { useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import { Activity, TrafficCone, MapPin, AlertTriangle, TrendingUp, ArrowRight, ShieldAlert, BarChart3 } from "lucide-react";
import { areas, cameras } from "../data";
import Navbar from "../components/Navbar";

const originDestinationData = [
  { origin: "Kukatpally Zone", destination: "Cyberabad Hub (Madhapur)", volume: "14,250 vehicles/day", avgTime: "24 mins", status: "Heavy Flow" },
  { origin: "Balanagar Corridor", destination: "Begumpet Central", volume: "9,840 vehicles/day", avgTime: "18 mins", status: "Moderate" },
  { origin: "Secunderabad Hub", destination: "Cyberabad Hub (Madhapur)", volume: "18,600 vehicles/day", avgTime: "32 mins", status: "Peak Congestion" },
  { origin: "Begumpet Central", destination: "Kukatpally Zone", volume: "8,120 vehicles/day", avgTime: "16 mins", status: "Smooth Flow" }
];

export default function TrafficPage({ navigate, openModal }) {
  const [selectedSector, setSelectedSector] = useState("All");

  return (
    <div className="relative flex w-full flex-col gap-6 pb-10">
      
      {/* Background Decorative Blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="animate-blob absolute -left-[10%] top-[-5%] h-[400px] w-[400px] rounded-full bg-orange-300/30 mix-blend-multiply blur-[100px] filter" />
        <div className="animate-blob animation-delay-2000 absolute right-[-5%] top-[20%] h-[400px] w-[400px] rounded-full bg-blue-300/30 mix-blend-multiply blur-[100px] filter" />
      </div>

      {/* Navbar with Traffic active page state */}
      <div className="fade-up w-full">
        <Navbar page="traffic" navigate={navigate} openModal={openModal} />
      </div>

      {/* Header Banner */}
      <div className="fade-up delay-100 flex flex-col md:flex-row md:items-center md:justify-between gap-4 rounded-[24px] border border-white/60 bg-white/80 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-3 w-3 rounded-full bg-orange-500 trace-live-dot" />
            <span className="text-xs font-extrabold uppercase tracking-widest text-orange-600">Module 03: Macro Traffic Flow & Movement Analytics</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 mt-1">City-Wide Traffic Analytics & Heatmaps</h1>
          <p className="text-xs text-gray-500 mt-1">
            Analyze aggregated multi-camera feeds to measure density, compute origin-destination matrices, and detect congestion bottlenecks in real time.
          </p>
        </div>

        {/* Quick Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-400">Sector Filter:</span>
          {["All", "Kukatpally", "Cyberabad", "Balanagar"].map((sec) => (
            <button
              key={sec}
              onClick={() => setSelectedSector(sec)}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                selectedSector === sec
                  ? "bg-orange-500 text-white shadow-md shadow-orange-500/30"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {sec}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Metrics Grid */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Active Surveillance Nodes" value="254 Cameras" trend="+4 online today" icon={Activity} color="text-blue-600" />
        <MetricCard title="Average Corridor Speed" value="44.2 km/h" trend="↑ 3.4% from avg" icon={TrendingUp} color="text-emerald-600" />
        <MetricCard title="Congestion Bottlenecks" value="3 Zones Flagged" trend="Kukatpally / Madhapur" icon={AlertTriangle} color="text-orange-500" />
        <MetricCard title="Daily Plate Indexing" value="1.42M Reads" trend=">96.8% OCR Precision" icon={BarChart3} color="text-purple-600" />
      </div>

      {/* Main Content: Origin-Destination Matrix (Left) + Heatmap GIS Map (Right) */}
      <div className="grid w-full gap-5 lg:grid-cols-[1fr_1.2fr]">
        
        {/* LEFT: Origin-Destination Matrix & Corridor Congestion Breakdown */}
        <div className="fade-up delay-200 flex flex-col gap-5">
          
          <div className="rounded-[24px] border border-white/80 bg-white/80 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
            <h3 className="text-sm font-extrabold text-gray-900 mb-4 flex items-center gap-2">
              <TrafficCone size={16} className="text-orange-500" /> Origin-Destination (O-D) Matrix
            </h3>

            <div className="space-y-3">
              {originDestinationData.map((item, idx) => (
                <div key={idx} className="rounded-2xl border border-gray-100 bg-gray-50/80 p-4 transition-all hover:bg-white hover:shadow-md">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-gray-800">
                      <span>{item.origin}</span>
                      <ArrowRight size={14} className="text-gray-400" />
                      <span>{item.destination}</span>
                    </div>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                      item.status === 'Peak Congestion' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {item.status}
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-[11px] text-gray-500 border-t border-gray-200/60 pt-2">
                    <span>Volume: <strong className="text-gray-800">{item.volume}</strong></span>
                    <span>Avg Transit: <strong className="text-gray-800">{item.avgTime}</strong></span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sector Density Table */}
          <div className="rounded-[24px] border border-white/80 bg-white/80 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
            <h3 className="text-sm font-extrabold text-gray-900 mb-4">Sector Density & Speed Status</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-400 font-bold uppercase tracking-wider">
                    <th className="pb-3">Sector</th>
                    <th className="pb-3">Density Status</th>
                    <th className="pb-3">Avg Speed</th>
                    <th className="pb-3">OCR Accuracy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {areas.map((area, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/50">
                      <td className="py-3 font-extrabold text-gray-900">{area.name}</td>
                      <td className="py-3 font-bold text-orange-600">{area.density}</td>
                      <td className="py-3 font-mono font-bold text-gray-700">{area.speed}</td>
                      <td className="py-3 font-mono font-bold text-emerald-600">{area.accuracy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* RIGHT: Leaflet GIS Map with Congestion Heatmap Circles */}
        <div className="fade-up delay-300 flex flex-col h-[550px] lg:h-auto rounded-[28px] border border-white/80 bg-white/70 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl overflow-hidden">
          <div className="flex items-center justify-between mb-3 px-2">
            <div className="flex items-center gap-2">
              <MapPin size={16} className="text-orange-500" />
              <h3 className="text-xs font-extrabold text-gray-800 uppercase tracking-wider">Real-Time Traffic Heatmap & Bottlenecks</h3>
            </div>
            <span className="text-[10px] font-bold text-gray-400">Hyderabad GIS Grid</span>
          </div>

          <div className="relative flex-1 w-full rounded-[20px] overflow-hidden border border-gray-200/60 shadow-inner z-10">
            <MapContainer
              center={[17.4850, 78.4100]}
              zoom={12}
              scrollWheelZoom={false}
              style={{ width: "100%", height: "100%" }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {/* Render Congestion Circles / Heatmap overlay */}
              {areas.map((area, idx) => (
                <div key={idx}>
                  <Marker position={area.position}>
                    <Popup>
                      <div className="p-1">
                        <span className="text-[10px] font-extrabold text-orange-600 uppercase">{area.sector}</span>
                        <h4 className="text-xs font-bold text-gray-900">{area.title}</h4>
                        <p className="text-[10px] text-gray-500 mt-1">Density: {area.density} | Speed: {area.speed}</p>
                      </div>
                    </Popup>
                  </Marker>
                  <Circle
                    center={area.position}
                    radius={area.density.includes("High") || area.density.includes("Very") ? 1200 : 800}
                    pathOptions={{
                      color: area.density.includes("High") ? "#ef4444" : "#f59e0b",
                      fillColor: area.density.includes("High") ? "#ef4444" : "#f59e0b",
                      fillOpacity: 0.25
                    }}
                  />
                </div>
              ))}
            </MapContainer>
          </div>
        </div>

      </div>
    </div>
  );
}

function MetricCard({ title, value, trend, icon: Icon, color }) {
  return (
    <div className="rounded-[24px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <span className="text-xs font-extrabold text-gray-400 uppercase tracking-wider">{title}</span>
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 ${color}`}>
          <Icon size={18} />
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <h2 className="text-xl font-black text-gray-900 tracking-tight">{value}</h2>
        <span className="text-[11px] font-bold text-gray-500">{trend}</span>
      </div>
    </div>
  );
}