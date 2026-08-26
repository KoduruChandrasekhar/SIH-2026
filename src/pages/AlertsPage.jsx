import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  MapPin,
  Navigation,
  Plus,
  Route,
  Search,
  ShieldAlert,
  TrafficCone,
  Zap,
} from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import Navbar from "../components/Navbar";

// Alert data incorporating distinct congestion vs surge, and route anomalies
const initialAlerts = [
  {
    id: "ALT-9041",
    plateNumber: "TS09EA4512",
    category: "Blacklisted Vehicle",
    type: "vehicle",
    severity: "CRITICAL",
    timestamp: "Just Now (10:45 PM)",
    cameraNode: "CAM-04 (Kukatpally Y-Junction)",
    lat: 17.4947,
    lng: 78.3996,
    confidence: "98.4%",
    description: "National Crime Database match: Stolen SUV reported. Trajectory tracking active.",
    status: "Active",
  },
  {
    id: "TRF-3012",
    plateNumber: "Kukatpally ⇄ JNTU",
    category: "High-Density Congestion",
    type: "traffic",
    severity: "CRITICAL",
    timestamp: "2 mins ago (10:43 PM)",
    cameraNode: "CAM-02 (Main Expressway)",
    lat: 17.4985,
    lng: 78.3912,
    confidence: "Sector 2",
    description: "Severe urban bottleneck: Traffic density exceeded capacity. Average speed dropped to 5 km/h.",
    status: "Active",
  },
  {
    id: "TRF-3015",
    plateNumber: "Cyberabad IT Corridor",
    category: "Sudden Traffic Surge",
    type: "traffic",
    severity: "HIGH",
    timestamp: "5 mins ago (10:40 PM)",
    cameraNode: "CAM-07 (Hitec City Flyover)",
    lat: 17.4485,
    lng: 78.3742,
    confidence: "+45% Vol",
    description: "Unexpected inflow spike. Current count: 1,240 veh/hr (Normal: 850 veh/hr). Signal adjustment advised.",
    status: "Investigating",
  },
  {
    id: "ALT-9038",
    plateNumber: "AP28BK8821",
    category: "Trajectory Anomaly",
    type: "vehicle",
    severity: "HIGH",
    timestamp: "11 mins ago (10:34 PM)",
    cameraNode: "CAM-12 (Balanagar Industrial)",
    lat: 17.4682,
    lng: 78.4357,
    confidence: "95.1%",
    description: "Missing expected camera detection sequence. Vehicle deviated >3km from expected standard route.",
    status: "Active",
  },
  {
    id: "ALT-9029",
    plateNumber: "MH04EF7710",
    category: "Unusual Stop / Loitering",
    type: "vehicle",
    severity: "MEDIUM",
    timestamp: "24 mins ago (10:21 PM)",
    cameraNode: "CAM-19 (Begumpet Airport Rd)",
    lat: 17.4439,
    lng: 78.4684,
    confidence: "94.2%",
    description: "Vehicle stopped for 18 minutes in restricted no-stopping zone. Repeated loitering detected.",
    status: "Resolved",
  },
];

export default function AlertsPage({ navigate, openModal }) {
  const [alerts, setAlerts] = useState(initialAlerts);
  const [filterCategory, setFilterCategory] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAlert, setSelectedAlert] = useState(initialAlerts[0]);
  const [toastMessage, setToastMessage] = useState(null);

  const [newPlate, setNewPlate] = useState("");
  const [newReason, setNewReason] = useState("");

  const triggerToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleResolve = (id) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "Resolved" } : a))
    );
    triggerToast(`Alert ${id} marked as Resolved.`);
  };

  const handleAddWatchlist = (e) => {
    e.preventDefault();
    if (!newPlate) return;
    triggerToast(`Plate [${newPlate.toUpperCase()}] registered to Central Watchlist.`);
    setNewPlate("");
    setNewReason("");
  };

  const filteredAlerts = alerts.filter((item) => {
    const matchesFilter =
      filterCategory === "ALL" ||
      (filterCategory === "CONGESTION" && item.type === "traffic") ||
      (filterCategory === "BLACKLIST" && item.category === "Blacklisted Vehicle") ||
      (filterCategory === "ANOMALY" && (item.category === "Trajectory Anomaly" || item.category === "Unusual Stop / Loitering"));

    const matchesSearch =
      item.plateNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.cameraNode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  return (
    <div className="relative flex w-full flex-col gap-6 pb-10">
      {/* Background Blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="animate-blob absolute -left-[10%] top-[-5%] h-[400px] w-[400px] rounded-full bg-red-300/25 mix-blend-multiply blur-[100px] filter" />
        <div className="animate-blob animation-delay-2000 absolute right-[-5%] top-[20%] h-[400px] w-[400px] rounded-full bg-orange-300/25 mix-blend-multiply blur-[100px] filter" />
      </div>

      {/* Floating Action Toast */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 flex items-center gap-3 rounded-2xl border border-red-500/30 bg-gray-950/90 px-4 py-3 text-xs font-bold text-white shadow-2xl backdrop-blur-xl animate-fade-in">
          <Zap size={16} className="text-red-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Navbar */}
      <div className="fade-up w-full">
        <Navbar page="alerts" navigate={navigate} openModal={openModal} />
      </div>

      {/* Header Banner */}
      <div className="fade-up delay-100 rounded-[24px] border border-white/60 bg-white/80 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <span className="flex h-3 w-3 rounded-full bg-red-500 trace-live-dot" />
          <span className="text-xs font-extrabold uppercase tracking-widest text-red-600">
            Module 04: Real-Time Tactical Threat & Alert Engine
          </span>
        </div>
        <h1 className="text-2xl font-black tracking-tight text-gray-900 mt-1">
          Surveillance Alerts & Traffic Anomalies
        </h1>
        <p className="text-xs text-gray-500 mt-1 max-w-[800px]">
          Autonomous real-time identification of blacklisted vehicles, sudden traffic surges, high-density gridlocks, and spatial-temporal trajectory deviations.
        </p>
      </div>

      {/* Metrics Row (2x2 on Mobile, 4x1 on Desktop) */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <AlertMetricCard title="Blacklist Detections" value="3 Active" trend="Action Required" icon={ShieldAlert} color="text-red-600" />
        <AlertMetricCard title="High-Density Spots" value="2 Sectors" trend="Severe Gridlock" icon={TrafficCone} color="text-amber-500" />
        <AlertMetricCard title="Sudden Traffic Surge" value="+45% Vol" trend="Cyberabad Corridor" icon={Activity} color="text-orange-500" />
        <AlertMetricCard title="Trajectory Anomalies" value="4 Detected" trend="Unusual Stops/Routes" icon={Route} color="text-purple-600" />
      </div>

      {/* Main Content Grid (Map on Left, Alerts on Right) */}
      <div className="grid w-full gap-5 lg:grid-cols-[1fr_1.4fr] xl:grid-cols-[1fr_1.6fr]">
        
        {/* LEFT COLUMN: GIS Incident Spatial Map & Watchlist Tool */}
        <div className="fade-up delay-300 flex flex-col gap-5 order-2 lg:order-1">
          
          {/* Leaflet Tactical Alert Map */}
          <div className="flex h-[420px] flex-col rounded-[28px] border border-white/80 bg-white/70 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
            <div className="flex items-center justify-between mb-3 px-2">
              <div className="flex items-center gap-2">
                <ShieldAlert size={16} className="text-red-500" />
                <h3 className="text-xs font-extrabold text-gray-800 uppercase tracking-wider">
                  Incident & Congestion Map
                </h3>
              </div>
              <span className="text-[10px] font-bold text-gray-400">
                Focus: {selectedAlert ? selectedAlert.plateNumber : "Mesh Grid"}
              </span>
            </div>

            <div className="relative flex-1 w-full rounded-[20px] overflow-hidden border border-gray-200/60 shadow-inner z-10">
              <MapContainer
                center={[selectedAlert ? selectedAlert.lat : 17.485, selectedAlert ? selectedAlert.lng : 78.41]}
                zoom={13}
                scrollWheelZoom={false}
                style={{ width: "100%", height: "100%" }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {alerts.map((al) => {
                  const isCongestion = al.type === "traffic";
                  return (
                    <div key={al.id}>
                      <Marker position={[al.lat, al.lng]}>
                        <Popup>
                          <div className="p-1">
                            <span className={`font-mono text-xs font-black ${isCongestion ? 'text-amber-600' : 'text-red-600'}`}>
                              {al.plateNumber}
                            </span>
                            <h4 className="text-[11px] font-bold text-gray-900 mt-0.5">{al.category}</h4>
                            <p className="text-[10px] text-gray-500">{al.cameraNode}</p>
                          </div>
                        </Popup>
                      </Marker>
                      <Circle
                        center={[al.lat, al.lng]}
                        radius={isCongestion ? 1200 : al.severity === "CRITICAL" ? 900 : 500}
                        pathOptions={{
                          color: isCongestion ? "#f59e0b" : al.severity === "CRITICAL" ? "#ef4444" : "#3b82f6",
                          fillColor: isCongestion ? "#f59e0b" : al.severity === "CRITICAL" ? "#ef4444" : "#3b82f6",
                          fillOpacity: 0.25,
                        }}
                      />
                    </div>
                  );
                })}
              </MapContainer>
            </div>
          </div>

          {/* Add Plate to Active Watchlist Form */}
          <div className="rounded-[28px] border border-white/80 bg-white/80 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
            <div className="flex items-center gap-2 mb-3">
              <Plus size={16} className="text-red-500" />
              <h3 className="text-sm font-extrabold text-gray-900">Add Plate to Central Watchlist</h3>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Registered plates trigger instant cross-camera spatial correlation & tactical dispatch across all 254 ANPR nodes.
            </p>

            <form onSubmit={handleAddWatchlist} className="space-y-3">
              <div>
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-gray-500 mb-1 block">
                  Vehicle License Plate
                </label>
                <input
                  type="text"
                  placeholder="e.g. TS09AB1234"
                  value={newPlate}
                  onChange={(e) => setNewPlate(e.target.value.toUpperCase())}
                  className="w-full font-mono rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2 text-xs font-bold uppercase text-gray-900 focus:border-red-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-gray-500 mb-1 block">
                  Flag Reason / Category
                </label>
                <input
                  type="text"
                  placeholder="e.g. Suspected Stolen / Route Anomaly Target"
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2 text-xs font-semibold text-gray-800 focus:border-red-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-red-600 px-4 py-2.5 text-xs font-black text-white shadow-md shadow-red-600/20 transition hover:bg-red-700 active:scale-95"
              >
                Register to Watch Mesh
              </button>
            </form>
          </div>
        </div>

        {/* RIGHT COLUMN: Feed & Filter */}
        <div className="fade-up delay-200 flex flex-col gap-4 order-1 lg:order-2">
          
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-[20px] border border-white/80 bg-white/80 p-3 shadow-sm backdrop-blur-xl">
            {/* Search */}
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search alert, plate, location, or camera..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-gray-200/80 bg-gray-50/50 pl-10 pr-4 py-2 text-xs font-semibold text-gray-800 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {[
                { label: "All Alerts", key: "ALL" },
                { label: "Congestion/Surge", key: "CONGESTION" },
                { label: "Watchlist", key: "BLACKLIST" },
                { label: "Anomalies", key: "ANOMALY" },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilterCategory(f.key)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all shrink-0 ${
                    filterCategory === f.key
                      ? "bg-red-500 text-white shadow-md shadow-red-500/20"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Alert Cards List (Rendered as a 2x2 Grid on Large Screens) */}
          <div className="grid gap-3.5 sm:grid-cols-2">
            {filteredAlerts.length === 0 ? (
              <div className="col-span-full rounded-[24px] border border-dashed border-gray-300 bg-white/60 p-12 text-center text-xs font-bold text-gray-400">
                No active alerts match the selected criteria.
              </div>
            ) : (
              filteredAlerts.map((item) => {
                const isTraffic = item.type === "traffic";

                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedAlert(item)}
                    className={`group relative flex flex-col gap-3 rounded-[24px] border p-5 transition-all duration-300 cursor-pointer backdrop-blur-xl ${
                      selectedAlert?.id === item.id
                        ? isTraffic
                          ? "border-amber-500/80 bg-white shadow-lg shadow-amber-500/10 ring-2 ring-amber-500/20"
                          : "border-red-500/80 bg-white shadow-lg shadow-red-500/10 ring-2 ring-red-500/20"
                        : "border-white/80 bg-white/70 hover:bg-white hover:shadow-md"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-black ${
                            isTraffic
                              ? "bg-amber-100 text-amber-600"
                              : item.severity === "CRITICAL"
                              ? "bg-red-100 text-red-600"
                              : "bg-blue-100 text-blue-600"
                          }`}
                        >
                          {isTraffic ? <TrafficCone size={18} /> : <AlertTriangle size={18} />}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] font-black tracking-wider text-gray-900 bg-gray-100 px-2 py-0.5 rounded-md">
                              {item.plateNumber}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                isTraffic
                                  ? "bg-amber-500 text-white animate-pulse"
                                  : item.severity === "CRITICAL"
                                  ? "bg-red-500 text-white animate-pulse"
                                  : "bg-blue-500 text-white"
                              }`}
                            >
                              {item.severity}
                            </span>
                          </div>
                          <span className="text-[11px] font-bold text-gray-600 mt-1 block">{item.category}</span>
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-gray-600 leading-relaxed pt-1">{item.description}</p>

                    <div className="flex flex-col gap-2 border-t border-gray-100 pt-3 text-[11px] mt-auto">
                      <div className="flex items-center justify-between text-gray-500">
                        <span className="flex items-center gap-1 font-semibold truncate pr-2">
                          <MapPin size={12} className={isTraffic ? "text-amber-500" : "text-red-500"} />
                          <span className="truncate">{item.cameraNode.split("(")[0]}</span>
                        </span>
                        <span className="font-mono font-bold text-emerald-600 whitespace-nowrap">
                          {isTraffic ? `Metric: ${item.confidence}` : `Conf: ${item.confidence}`}
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-between mt-1">
                        <span className="flex items-center gap-1 text-[10px] font-bold text-gray-400">
                          <Clock size={12} /> {item.timestamp.split(" ")[0]}
                        </span>
                        <div className="flex items-center gap-2">
                          {isTraffic ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate("traffic");
                              }}
                              className="flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1 text-[10px] font-bold text-white transition hover:bg-amber-600"
                            >
                              <Gauge size={12} /> View Flow
                            </button>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate("tracking");
                              }}
                              className="flex items-center gap-1 rounded-lg bg-gray-900 px-2.5 py-1 text-[10px] font-bold text-white transition hover:bg-blue-600"
                            >
                              <Navigation size={12} /> Trace
                            </button>
                          )}

                          {item.status !== "Resolved" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleResolve(item.id);
                              }}
                              className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-bold text-gray-600 transition hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300"
                            >
                              Resolve
                            </button>
                          )}
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
    </div>
  );
}

function AlertMetricCard({ title, value, trend, icon: Icon, color }) {
  return (
    <div className="rounded-[24px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
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