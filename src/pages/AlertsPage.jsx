import { useState, useEffect, useRef, useCallback } from "react";
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
  Radio,
  ExternalLink,
} from "lucide-react";
import { MapContainer, TileLayer, CircleMarker, Popup, Circle, useMap } from "react-leaflet";
import Navbar from "../components/Navbar";
import { fetchAlerts } from "../api";
import { WATCHLIST_CAMERAS, cameraDisplayId } from "../demoData";
import { alertsFeed as localAlerts } from "../data";

// One severity palette across the app: critical = red, high = orange, medium = amber
const SEVERITY = {
  CRITICAL: { color: "#ef4444", badge: "bg-red-500 text-white", icon: "bg-red-100 text-red-600", border: "border-red-500/80", ring: "ring-red-500/20" },
  HIGH: { color: "#f97316", badge: "bg-orange-500 text-white", icon: "bg-orange-100 text-orange-600", border: "border-orange-500/80", ring: "ring-orange-500/20" },
  MEDIUM: { color: "#eab308", badge: "bg-amber-500 text-white", icon: "bg-amber-100 text-amber-600", border: "border-amber-500/80", ring: "ring-amber-500/20" },
};
const sev = (a) => SEVERITY[a.severity] ?? SEVERITY.MEDIUM;
const isAnomaly = (a) => a.category === "Trajectory Anomaly" || a.category === "Unusual Stop / Loitering";

// Pans the existing map to the selected alert without re-creating it
function FocusAlert({ alert }) {
  const map = useMap();
  useEffect(() => {
    if (alert) map.flyTo([alert.lat, alert.lng], 14, { duration: 0.8 });
  }, [map, alert]);
  return null;
}

export default function AlertsPage({ navigate, openModal }) {
  const [alerts, setAlerts] = useState(localAlerts);
  const [filterCategory, setFilterCategory] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAlert, setSelectedAlert] = useState(localAlerts[0]);
  const [toastMessage, setToastMessage] = useState(null);

  const [newPlate, setNewPlate] = useState("");
  const [newReason, setNewReason] = useState("");

  // ── Watchlist Propagation State ──
  const [propagationState, setPropagationState] = useState('idle'); // idle | propagating | synced | detected
  const [propagatedCameras, setPropagatedCameras] = useState([]);
  const [detectedPlate, setDetectedPlate] = useState(null);
  const timeoutIdsRef = useRef([]);

  // Cleanup all timeouts on unmount or reset
  const clearAllTimeouts = useCallback(() => {
    timeoutIdsRef.current.forEach((id) => clearTimeout(id));
    timeoutIdsRef.current = [];
  }, []);

  useEffect(() => {
    return () => clearAllTimeouts();
  }, [clearAllTimeouts]);

  const resetPropagation = useCallback(() => {
    clearAllTimeouts();
    setPropagationState('idle');
    setPropagatedCameras([]);
    setDetectedPlate(null);
  }, [clearAllTimeouts]);

  // Fetch from API with fallback
  useEffect(() => {
    fetchAlerts().then((data) => {
      if (data) {
        setAlerts(data);
        setSelectedAlert(data[0]);
      }
    });
  }, []);

  const triggerToast = (msg) => {
    setToastMessage(msg);
    const id = setTimeout(() => setToastMessage(null), 3500);
    timeoutIdsRef.current.push(id);
  };

  const handleResolve = (id) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "Resolved" } : a))
    );
    triggerToast(`Alert ${id} marked as Resolved.`);
  };

  // ── Propagation Sequence ──
  const startPropagation = (plate) => {
    clearAllTimeouts();
    setPropagationState('propagating');
    setPropagatedCameras([]);
    setDetectedPlate(null);

    // Stagger camera propagation
    WATCHLIST_CAMERAS.forEach((cam, index) => {
      const id = setTimeout(() => {
        setPropagatedCameras((prev) => [...prev, cam]);
      }, (index + 1) * 300);
      timeoutIdsRef.current.push(id);
    });

    // After all cameras propagated → synced
    const syncId = setTimeout(() => {
      setPropagationState('synced');
    }, WATCHLIST_CAMERAS.length * 300 + 400);
    timeoutIdsRef.current.push(syncId);

    // After sync → detection
    const detectId = setTimeout(() => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setPropagationState('detected');
      setDetectedPlate({
        plate,
        camera: "CAM #403",
        timestamp: timeStr,
        confidence: "96.8%",
      });
    }, WATCHLIST_CAMERAS.length * 300 + 2400);
    timeoutIdsRef.current.push(detectId);

    // Auto-reset after 15 seconds
    const resetId = setTimeout(() => {
      resetPropagation();
    }, 15000);
    timeoutIdsRef.current.push(resetId);
  };

  const handleAddWatchlist = (e) => {
    e.preventDefault();
    if (!newPlate) return;
    const plate = newPlate.toUpperCase();
    triggerToast(`Plate [${plate}] registered to Central Watchlist.`);
    startPropagation(plate);
    setNewPlate("");
    setNewReason("");
  };

  const handleOpenTrajectory = () => {
    resetPropagation();
    navigate("tracking");
  };

  const open = alerts.filter((a) => a.status !== "Resolved");
  const metrics = {
    blacklist: open.filter((a) => a.category === "Blacklisted Vehicle").length,
    congestion: open.filter((a) => a.category === "High-Density Congestion").length,
    surge: open.find((a) => a.category === "Sudden Traffic Surge"),
    anomalies: open.filter(isAnomaly).length,
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

      {/* Metrics Row — computed from the alert feed (resolving an alert updates them) */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <AlertMetricCard title="Blacklist Detections" value={`${metrics.blacklist} Active`} trend={metrics.blacklist ? "Action required" : "None open"} icon={ShieldAlert} color="text-red-600" />
        <AlertMetricCard title="High-Density Spots" value={`${metrics.congestion} ${metrics.congestion === 1 ? "Corridor" : "Corridors"}`} trend="≥85% road capacity" icon={TrafficCone} color="text-amber-500" />
        <AlertMetricCard title="Sudden Traffic Surge" value={metrics.surge ? metrics.surge.confidence : "None"} trend={metrics.surge ? metrics.surge.plateNumber : "No surge open"} icon={Activity} color="text-orange-500" />
        <AlertMetricCard title="Trajectory Anomalies" value={`${metrics.anomalies} Open`} trend="Route deviations · stops" icon={Route} color="text-purple-600" />
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

                <FocusAlert alert={selectedAlert} />
                {alerts.map((al) => {
                  const isCongestion = al.type === "traffic";
                  const color = sev(al).color;
                  const resolved = al.status === "Resolved";
                  return (
                    <div key={al.id}>
                      <Circle
                        center={[al.lat, al.lng]}
                        radius={isCongestion ? 900 : 350}
                        pathOptions={{ color, weight: 1, fillColor: color, fillOpacity: resolved ? 0.05 : isCongestion ? 0.2 : 0.12, dashArray: isCongestion ? undefined : "4 4" }}
                      />
                      <CircleMarker
                        center={[al.lat, al.lng]}
                        radius={selectedAlert?.id === al.id ? 9 : 7}
                        pathOptions={{ color: "#fff", weight: 2, fillColor: resolved ? "#64748b" : color, fillOpacity: 1 }}
                        eventHandlers={{ click: () => setSelectedAlert(al) }}
                      >
                        <Popup>
                          <div className="p-1">
                            <span className="font-mono text-xs font-black" style={{ color }}>
                              {al.plateNumber}
                            </span>
                            <h4 className="text-[11px] font-bold text-gray-900 mt-0.5">{al.category}</h4>
                            <p className="text-[10px] text-gray-500">{al.cameraNode}</p>
                          </div>
                        </Popup>
                      </CircleMarker>
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
                  disabled={propagationState !== 'idle'}
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
                  disabled={propagationState !== 'idle'}
                />
              </div>

              <button
                type="submit"
                disabled={propagationState !== 'idle'}
                className="w-full rounded-xl bg-red-600 px-4 py-2.5 text-xs font-black text-white shadow-md shadow-red-600/20 transition hover:bg-red-700 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Register to Watch Mesh
              </button>
            </form>

            {/* ── Watchlist Propagation Panel ── */}
            {propagationState !== 'idle' && (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-gray-50/70 p-4 transition-all duration-500">
                {/* Propagation header */}
                <div className="flex items-center gap-2 mb-3">
                  <Radio size={14} className={`text-emerald-500 ${propagationState === 'propagating' ? 'animate-pulse' : ''}`} />
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-600">
                    {propagationState === 'propagating' && 'Propagating Watchlist...'}
                    {propagationState === 'synced' && 'Propagating Watchlist...'}
                    {propagationState === 'detected' && 'Propagation Complete'}
                  </span>
                </div>

                {/* Camera list with staggered checks */}
                <div className="space-y-1.5 mb-3">
                  {WATCHLIST_CAMERAS.map((cam) => {
                    const isPropagated = propagatedCameras.includes(cam);
                    return (
                      <div
                        key={cam}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 transition-all duration-300 ${
                          isPropagated
                            ? 'bg-emerald-50 opacity-100 translate-x-0'
                            : 'opacity-30 -translate-x-2'
                        }`}
                      >
                        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all duration-300 ${
                          isPropagated ? 'bg-emerald-500 scale-100' : 'bg-gray-300 scale-75'
                        }`}>
                          {isPropagated && (
                            <CheckCircle2 size={12} className="text-white" />
                          )}
                        </div>
                        <span className={`font-mono text-[11px] font-bold transition-colors duration-300 ${
                          isPropagated ? 'text-gray-900' : 'text-gray-400'
                        }`}>
                          {cameraDisplayId(cam)}
                        </span>
                        {isPropagated && (
                          <span className="ml-auto text-[10px] font-bold text-emerald-600">
                            Synced
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Network Synchronized badge */}
                {(propagationState === 'synced' || propagationState === 'detected') && (
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 mb-3 transition-all duration-500">
                    <CheckCircle2 size={14} className="text-emerald-500" />
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-600">
                      Network Synchronized
                    </span>
                    <span className="ml-auto text-[10px] font-bold text-emerald-500">
                      {WATCHLIST_CAMERAS.length}/{WATCHLIST_CAMERAS.length} Nodes
                    </span>
                  </div>
                )}

                {/* Detection Alert */}
                {propagationState === 'detected' && detectedPlate && (
                  <div className="rounded-xl border border-amber-400/60 bg-gradient-to-r from-amber-50 to-red-50 p-4 shadow-lg shadow-amber-500/10 transition-all duration-500">
                    <div className="flex items-center gap-2 mb-2.5">
                      <Zap size={14} className="text-amber-600" />
                      <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-700">
                        Watchlist Match Detected
                      </span>
                    </div>

                    <div className="space-y-1.5 mb-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Plate</span>
                        <span className="font-mono text-xs font-black text-gray-900 bg-gray-100 px-2 py-0.5 rounded-md">
                          {detectedPlate.plate}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Camera</span>
                        <span className="font-mono text-xs font-bold text-gray-800">
                          {cameraDisplayId(detectedPlate.camera)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Timestamp</span>
                        <span className="font-mono text-xs font-bold text-gray-800">
                          {detectedPlate.timestamp}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Confidence</span>
                        <span className="font-mono text-xs font-black text-emerald-600">
                          {detectedPlate.confidence}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={handleOpenTrajectory}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white shadow-md shadow-blue-600/20 transition hover:bg-blue-700 active:scale-95"
                    >
                      <ExternalLink size={14} />
                      Open Trajectory
                    </button>
                  </div>
                )}
              </div>
            )}
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
                        ? `${sev(item).border} bg-white shadow-lg ring-2 ${sev(item).ring}`
                        : "border-white/80 bg-white/70 hover:bg-white hover:shadow-md"
                    } ${item.status === "Resolved" ? "opacity-70" : ""}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-black ${
                            isAnomaly(item) ? "bg-purple-100 text-purple-600" : sev(item).icon
                          }`}
                        >
                          {isTraffic ? <TrafficCone size={18} /> : isAnomaly(item) ? <Route size={18} /> : <AlertTriangle size={18} />}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] font-black tracking-wider text-gray-900 bg-gray-100 px-2 py-0.5 rounded-md">
                              {item.plateNumber}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${sev(item).badge} ${
                                item.severity === "CRITICAL" && item.status === "Active" ? "live-flow-dot" : ""
                              }`}
                            >
                              {item.severity}
                            </span>
                            <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400">{item.status}</span>
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
                          <span className="truncate" title={item.cameraNode}>{item.cameraNode}</span>
                        </span>
                        <span className="font-mono font-bold text-emerald-600 whitespace-nowrap">
                          {isTraffic ? `Metric: ${item.confidence}` : `Conf: ${item.confidence}`}
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-between mt-1">
                        <span className="flex items-center gap-1 text-[10px] font-bold text-gray-400">
                          <Clock size={12} /> {item.timestamp}
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