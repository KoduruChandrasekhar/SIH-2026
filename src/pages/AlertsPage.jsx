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
import Navbar from "../components/layout/Navbar";
import { addToWatchlist, fetchAlerts } from "../lib/api";
import { useAlerts } from "../context/AlertsContext";
import { WATCHLIST_CAMERAS, cameraDisplayId } from "../data/demoData";
import { alertsFeed as localAlerts, cameraById } from "../data/data";
import { AnimatedNumber, MapBoundary } from "../components/motion/Motion";
import { formatClock, simNowSec } from "../sim/liveSim";

// One controlled demo event per session: the blacklisted SUV from ALT-9041 is re-sighted
// at the next camera on its path (CAM-401 → CAM-402 is 1.4 km). Not a random alert generator.
let sessionResighting = null; // persists across page visits for this session
const RESIGHT_DELAY_MS = 9000;
const makeResighting = () => {
  const cam = cameraById["CAM #402"];
  const t = formatClock(simNowSec()).slice(0, 5);
  return {
    id: "ALT-9044",
    plateNumber: "TS09EA4512",
    category: "Blacklisted Vehicle",
    type: "vehicle",
    severity: "CRITICAL",
    timestamp: `${t} (just now)`,
    cameraId: cam.id,
    cameraNode: `${cam.code} (${cam.name})`,
    lat: cam.lat,
    lng: cam.lng,
    confidence: "97.4%",
    description: "Watchlist re-sighting: same SUV as ALT-9041, now heading north-west past JNTU. Trajectory updated.",
    status: "Active",
    isNew: true,
  };
};

// One severity palette across the app: critical = red, high = orange, medium = amber
const SEVERITY = {
  CRITICAL: { color: "#ef4444", badge: "bg-red-500 text-white", icon: "bg-red-100 text-red-600", border: "border-red-500/80", ring: "ring-red-500/20" },
  HIGH: { color: "#f97316", badge: "bg-orange-500 text-white", icon: "bg-orange-100 text-orange-600", border: "border-orange-500/80", ring: "ring-orange-500/20" },
  MEDIUM: { color: "#eab308", badge: "bg-amber-500 text-amber-950", icon: "bg-amber-100 text-amber-600", border: "border-amber-500/80", ring: "ring-amber-500/20" },
};
const sev = (a) => SEVERITY[a.severity] ?? SEVERITY.MEDIUM;
const ANOMALY_CATEGORIES = ["Trajectory Anomaly", "Unusual Stop / Loitering", "Cloned Plate", "Invalid / Tampered Plate"];
const isAnomaly = (a) => ANOMALY_CATEGORIES.includes(a.category);

// Pans the existing map to the selected alert without re-creating it
function FocusAlert({ alert }) {
  const map = useMap();
  useEffect(() => {
    if (alert) map.flyTo([alert.lat, alert.lng], 14, { duration: 0.8 });
  }, [map, alert]);
  return null;
}

export default function AlertsPage({ navigate, openModal }) {
  const [alerts, setAlerts] = useState(() => (sessionResighting ? [{ ...sessionResighting, isNew: false }, ...localAlerts] : localAlerts));
  const [filterCategory, setFilterCategory] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAlert, setSelectedAlert] = useState(localAlerts[0]);
  const [toastMessage, setToastMessage] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);

  const [newPlate, setNewPlate] = useState("");
  const [newReason, setNewReason] = useState("");

  // ── Watchlist Propagation State ──
  const [propagationState, setPropagationState] = useState('idle'); // idle | propagating | synced | detected
  const [propagatedCameras, setPropagatedCameras] = useState([]);
  const [detectedPlate, setDetectedPlate] = useState(null);
  const timeoutIdsRef = useRef([]);

  // Phase 6: when the backend stream is live, this table shows real alerts (snapshot + WebSocket)
  const { live, alerts: liveAlerts, markRead, subscribe } = useAlerts();
  const liveRef = useRef(live);
  liveRef.current = live;
  const pendingWatchPlate = useRef(null);
  useEffect(() => {
    if (!live) return;
    setAlerts((prev) => liveAlerts.map((a) => ({ ...a, status: prev.find((p) => p.alertId && p.alertId === a.alertId)?.status ?? a.status })));
    setSelectedAlert((cur) => (cur && liveAlerts.some((a) => a.alertId === cur.alertId) ? cur : liveAlerts[0] ?? null));
    markRead();
  }, [live, liveAlerts, markRead]);
  // A real BLACKLIST_HIT for a plate just added here completes the propagation panel
  useEffect(
    () =>
      subscribe((row) => {
        if (row.alertType === "BLACKLIST_HIT" && row.plateNumber === pendingWatchPlate.current) {
          setPropagationState("detected");
          setDetectedPlate({ plate: row.plateNumber, camera: row.cameraId, timestamp: row.timestamp, confidence: row.confidence });
        }
      }),
    [subscribe]
  );

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
      if (data && !liveRef.current) {
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
    setResolvingId(id);
    const t = setTimeout(() => {
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status: "Resolved", isNew: false } : a)));
      setResolvingId(null);
      triggerToast(`Alert ${id} marked as Resolved.`);
    }, 450);
    timeoutIdsRef.current.push(t);
  };

  // Controlled demo event (once per session)
  useEffect(() => {
    if (sessionResighting) return;
    const t = setTimeout(() => {
      if (liveRef.current) return; // real alerts only when the backend stream is live
      const alert = makeResighting();
      sessionResighting = alert;
      setAlerts((prev) => (prev.some((a) => a.id === alert.id) ? prev : [alert, ...prev]));
      setToastMessage(`New CRITICAL alert · ${alert.plateNumber} re-sighted at ${cameraById["CAM #402"].code}`);
      setTimeout(() => setToastMessage(null), 3500);
    }, RESIGHT_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  // ── Propagation Sequence ──
  const startPropagation = (plate, real = false) => {
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

    // Real watchlist: detection happens only when a camera actually reads the plate (WebSocket)
    if (real) {
      pendingWatchPlate.current = plate;
      const resetId = setTimeout(() => {
        pendingWatchPlate.current = null;
        resetPropagation();
      }, 120000);
      timeoutIdsRef.current.push(resetId);
      return;
    }

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

  const handleAddWatchlist = async (e) => {
    e.preventDefault();
    if (!newPlate) return;
    const plate = newPlate.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (live) {
      const res = await addToWatchlist(plate, newReason || "Added from the Alerts page");
      if (!res.ok) {
        triggerToast(`Watchlist update failed (${res.status || "offline"}).`);
        return;
      }
      triggerToast(`Plate [${plate}] added to the central watchlist — enforced on the next sighting.`);
      startPropagation(plate, true);
    } else {
      triggerToast(`Plate [${plate}] registered to Central Watchlist.`);
      startPropagation(plate);
    }
    setNewPlate("");
    setNewReason("");
  };

  const handleOpenTrajectory = () => {
    const plate = detectedPlate?.plate;
    resetPropagation();
    navigate("tracking", plate ? { plate } : null);
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
      (filterCategory === "ANOMALY" && isAnomaly(item));

    const matchesSearch =
      item.plateNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.cameraNode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  return (
    <div className="relative flex w-full flex-col gap-6 pb-10">

      {/* Floating Action Toast */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 flex items-center gap-3 rounded-2xl border border-red-500/30 bg-gray-950/90 px-4 py-3 text-xs font-bold text-white shadow-2xl backdrop-blur-xl animate-fade-in">
          <Zap size={16} className="text-red-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Navbar */}
      <div className="w-full">
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
        <AlertMetricCard title="Blacklist Detections" value={<><AnimatedNumber value={metrics.blacklist} /> Active</>} trend={metrics.blacklist ? "Action required" : "None open"} icon={ShieldAlert} color="text-red-600" />
        <AlertMetricCard title="High-Density Spots" value={<><AnimatedNumber value={metrics.congestion} /> {metrics.congestion === 1 ? "Corridor" : "Corridors"}</>} trend="≥85% road capacity" icon={TrafficCone} color="text-amber-500" />
        <AlertMetricCard title="Sudden Traffic Surge" value={metrics.surge ? metrics.surge.confidence : "None"} trend={metrics.surge ? metrics.surge.plateNumber : "No surge open"} icon={Activity} color="text-orange-500" />
        <AlertMetricCard title="Trajectory Anomalies" value={<><AnimatedNumber value={metrics.anomalies} /> Open</>} trend="Route deviations · stops" icon={Route} color="text-purple-600" />
      </div>

      {/* Main Content Grid (Map on Left, Alerts on Right) */}
      <div className="grid w-full gap-5 lg:grid-cols-[1fr_1.4fr] xl:grid-cols-[1fr_1.6fr]">
        
        {/* LEFT COLUMN: GIS Incident Spatial Map & Watchlist Tool */}
        <div className="fade-up delay-300 flex min-w-0 flex-col gap-5 order-2 lg:order-1">
          
          {/* Leaflet Tactical Alert Map */}
          <div className="flex h-[420px] flex-col rounded-[28px] border border-white/80 bg-white/70 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-2">
              <div className="flex items-center gap-2">
                <ShieldAlert size={16} className="text-red-500" />
                <h3 className="text-xs font-extrabold text-gray-800 uppercase tracking-wider">
                  Incident & Congestion Map
                </h3>
              </div>
              <span key={selectedAlert?.id} className="tn-new-item flex min-w-0 max-w-full items-center gap-1.5 truncate rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[10px] font-bold text-gray-600" aria-live="polite">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: selectedAlert ? sev(selectedAlert).color : "#64748b" }} aria-hidden="true" />
                Focus:
                <span className="font-mono font-black text-gray-900">{selectedAlert ? selectedAlert.plateNumber : "Mesh Grid"}</span>
                {selectedAlert && <span className="font-mono text-gray-400">{selectedAlert.cameraNode?.split(" ")[0]}</span>}
              </span>
            </div>

            <div className="relative flex-1 w-full rounded-[20px] overflow-hidden border border-gray-200/60 shadow-inner z-10">
              <MapBoundary>
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
                        radius={selectedAlert?.id === al.id ? 10 : hoveredId === al.id ? 10 : 7}
                        pathOptions={{ color: hoveredId === al.id ? "#bfdbfe" : "#fff", weight: hoveredId === al.id ? 3 : 2, fillColor: resolved ? "#64748b" : color, fillOpacity: 1 }}
                        eventHandlers={{ click: () => setSelectedAlert(al), mouseover: () => setHoveredId(al.id), mouseout: () => setHoveredId(null) }}
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
                {/* focus ring on the selected alert; a one-off ping marks a newly arrived alert */}
                {selectedAlert && (
                  <CircleMarker
                    key={`focus-${selectedAlert.id}`}
                    center={[selectedAlert.lat, selectedAlert.lng]}
                    radius={16}
                    interactive={false}
                    pathOptions={{ color: sev(selectedAlert).color, weight: 2.5, fill: false, className: "tn-marker-selected" }}
                  />
                )}
                {alerts.filter((a) => a.isNew).map((a) => (
                  <CircleMarker key={`new-${a.id}`} center={[a.lat, a.lng]} radius={12} interactive={false} pathOptions={{ color: "#ef4444", weight: 2, fill: false, className: "tn-marker-ring" }} />
                ))}
              </MapContainer>
              </MapBoundary>
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
        <div className="fade-up delay-200 flex min-w-0 flex-col gap-4 order-1 lg:order-2">
          
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
                { label: "All Alerts", key: "ALL", active: "bg-blue-600" },
                { label: "Congestion/Surge", key: "CONGESTION", active: "bg-orange-500" },
                { label: "Watchlist", key: "BLACKLIST", active: "bg-red-500" },
                { label: "Anomalies", key: "ANOMALY", active: "bg-purple-600" },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilterCategory(f.key)}
                  aria-pressed={filterCategory === f.key}
                  className={`tn-press rounded-xl px-3 py-1.5 text-xs font-bold shrink-0 ${
                    filterCategory === f.key
                      ? `${f.active} text-white shadow-md`
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Alert Cards List (Rendered as a 2x2 Grid on Large Screens) */}
          <div key={filterCategory + "|" + searchQuery} className="tn-list-in grid gap-3.5 sm:grid-cols-2">
            {filteredAlerts.length === 0 ? (
              <div className="tn-empty col-span-full">
                <p className="tn-empty-title">No matching alerts</p>
                <p className="tn-empty-sub">{searchQuery ? `Nothing matches “${searchQuery}” in this filter.` : "No alerts in this category right now."}</p>
              </div>
            ) : (
              filteredAlerts.map((item) => {
                const isTraffic = item.type === "traffic";

                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selectedAlert?.id === item.id}
                    onClick={() => setSelectedAlert(item)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), setSelectedAlert(item))}
                    onMouseEnter={() => setHoveredId(item.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    className={`tn-card-hover group relative flex flex-col gap-3 rounded-[24px] border p-5 cursor-pointer backdrop-blur-xl ${item.isNew ? "tn-new-item" : ""} ${
                      selectedAlert?.id === item.id
                        ? `${sev(item).border} bg-white shadow-lg ring-2 ${sev(item).ring}`
                        : "border-white/80 bg-white/70 hover:bg-white hover:shadow-md"
                    } ${item.status === "Resolved" ? "opacity-70" : ""} ${item.severity === "CRITICAL" && item.status !== "Resolved" ? "tn-alert-critical" : ""}`}
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
                            <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${sev(item).badge}`}>
                              {/* urgency without flashing: critical/high pulse softly while open, medium is static */}
                              <span
                                style={{ background: "#fff" }}
                                className={`h-1.5 w-1.5 rounded-full ${
                                  item.status === "Resolved" ? "" : item.severity === "CRITICAL" ? "tn-pulse tn-pulse--red" : item.severity === "HIGH" ? "tn-pulse tn-pulse--orange" : ""
                                }`}
                                aria-hidden="true"
                              />
                              {item.severity}
                            </span>
                            <span className={`text-[9px] font-extrabold uppercase tracking-wider ${item.status === "Resolved" ? "text-emerald-600" : "text-gray-400"}`}>{item.status}</span>
                            {item.isNew && <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-500">New</span>}
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
                          <span className="truncate">{item.cameraNode}</span>
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
                                navigate("traffic", item.corridorId ? { corridor: item.corridorId } : null);
                              }}
                              className="tn-press flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1 text-[10px] font-bold text-amber-950 hover:bg-amber-400 group-hover:shadow-md"
                              aria-label={`View traffic flow${item.corridorId ? ` for ${item.corridorId}` : ""}`}
                            >
                              <Gauge size={12} /> View Flow
                            </button>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate("tracking", { plate: item.plateNumber });
                              }}
                              className="tn-press flex items-center gap-1 rounded-lg bg-gray-900 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-blue-600 group-hover:shadow-md"
                              aria-label={`Trace ${item.plateNumber} on the Tracking page`}
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
                              disabled={resolvingId === item.id}
                              className="tn-press flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-bold text-gray-600 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300"
                            >
                              {resolvingId === item.id ? <><span className="tn-spinner" style={{ width: 10, height: 10 }} aria-hidden="true" /> Resolving…</> : "Resolve"}
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
    <div className="tn-kpi fade-up delay-100 rounded-[24px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-extrabold text-gray-400 uppercase tracking-wider">{title}</span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-xl bg-gray-100 ${color}`}>
          <Icon size={16} />
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <h2 className="tn-kpi-value text-xl font-black text-gray-900 tracking-tight tabular-nums">{value}</h2>
        <span className="text-[10px] font-bold text-gray-500 truncate ml-2">{trend}</span>
      </div>
    </div>
  );
}