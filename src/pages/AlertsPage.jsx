import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import { ScatterplotLayer } from "@deck.gl/layers";
import Navbar from "../components/Navbar";
import DeckGLMap from "../components/DeckGLMap";
import { fetchAlerts } from "../api";
import { WATCHLIST_CAMERAS, cameraDisplayId } from "../demoData";

// Alert data incorporating distinct congestion vs surge, and route anomalies
const localAlerts = [
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
  const [alerts, setAlerts] = useState(localAlerts);
  const [filterCategory, setFilterCategory] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAlert, setSelectedAlert] = useState(localAlerts[0]);
  const [toastMessage, setToastMessage] = useState(null);

  const [newPlate, setNewPlate] = useState("");
  const [newReason, setNewReason] = useState("");

  // Watchlist Propagation State
  const [propagationState, setPropagationState] = useState("idle"); // idle | propagating | synced | detected
  const [propagatedCameras, setPropagatedCameras] = useState([]);
  const [detectedPlate, setDetectedPlate] = useState(null);
  const timeoutIdsRef = useRef([]);

  const clearAllTimeouts = useCallback(() => {
    timeoutIdsRef.current.forEach((id) => clearTimeout(id));
    timeoutIdsRef.current = [];
  }, []);

  useEffect(() => {
    return () => clearAllTimeouts();
  }, [clearAllTimeouts]);

  const resetPropagation = useCallback(() => {
    clearAllTimeouts();
    setPropagationState("idle");
    setPropagatedCameras([]);
    setDetectedPlate(null);
  }, [clearAllTimeouts]);

  useEffect(() => {
    fetchAlerts().then((data) => {
      if (data && data.length > 0) {
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

  const startPropagation = (plate) => {
    clearAllTimeouts();
    setPropagationState("propagating");
    setPropagatedCameras([]);
    setDetectedPlate(null);

    WATCHLIST_CAMERAS.forEach((cam, index) => {
      const id = setTimeout(() => {
        setPropagatedCameras((prev) => [...prev, cam]);
      }, (index + 1) * 300);
      timeoutIdsRef.current.push(id);
    });

    const syncId = setTimeout(() => {
      setPropagationState("synced");
    }, WATCHLIST_CAMERAS.length * 300 + 400);
    timeoutIdsRef.current.push(syncId);

    const detectId = setTimeout(() => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      setPropagationState("detected");
      setDetectedPlate({
        plate,
        camera: "CAM #403",
        timestamp: timeStr,
        confidence: "96.8%",
      });
    }, WATCHLIST_CAMERAS.length * 300 + 2400);
    timeoutIdsRef.current.push(detectId);

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

  const filteredAlerts = alerts.filter((item) => {
    const matchesFilter =
      filterCategory === "ALL" ||
      (filterCategory === "CONGESTION" && item.type === "traffic") ||
      (filterCategory === "BLACKLIST" && item.category === "Blacklisted Vehicle") ||
      (filterCategory === "ANOMALY" &&
        (item.category === "Trajectory Anomaly" || item.category === "Unusual Stop / Loitering"));

    const matchesSearch =
      item.plateNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.cameraNode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  // deck.gl layers for Tactical Alert Map
  const mapLayers = useMemo(() => {
    const alertHalos = new ScatterplotLayer({
      id: "alert-halos",
      data: alerts,
      getPosition: (d) => [d.lng, d.lat],
      getRadius: (d) => (d.type === "traffic" ? 900 : d.severity === "CRITICAL" ? 750 : 450),
      getFillColor: (d) =>
        d.type === "traffic"
          ? [245, 158, 11, 40]
          : d.severity === "CRITICAL"
          ? [239, 68, 68, 50]
          : [59, 130, 246, 40],
      getLineColor: (d) =>
        d.type === "traffic"
          ? [245, 158, 11, 140]
          : d.severity === "CRITICAL"
          ? [239, 68, 68, 180]
          : [59, 130, 246, 140],
      stroked: true,
      lineWidthMinPixels: 1.5,
      radiusMinPixels: 18,
      radiusMaxPixels: 60,
      pickable: false,
    });

    const alertPins = new ScatterplotLayer({
      id: "alert-pins",
      data: alerts,
      getPosition: (d) => [d.lng, d.lat],
      getRadius: 300,
      getFillColor: (d) =>
        d.id === selectedAlert?.id
          ? [255, 255, 255, 255]
          : d.type === "traffic"
          ? [245, 158, 11, 240]
          : d.severity === "CRITICAL"
          ? [239, 68, 68, 240]
          : [59, 130, 246, 240],
      getLineColor: (d) =>
        d.type === "traffic"
          ? [245, 158, 11, 255]
          : d.severity === "CRITICAL"
          ? [239, 68, 68, 255]
          : [59, 130, 246, 255],
      lineWidthMinPixels: 2.5,
      stroked: true,
      radiusMinPixels: 8,
      radiusMaxPixels: 18,
      pickable: true,
      onClick: ({ object }) => {
        if (object) setSelectedAlert(object);
      },
    });

    return [alertHalos, alertPins];
  }, [alerts, selectedAlert?.id]);

  return (
    <div className="relative flex w-full flex-col gap-6 pb-12 text-[var(--text-primary)]">
      {/* Ambience */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-[10%] top-[-5%] h-[400px] w-[400px] rounded-full bg-red-600/10 blur-[130px]" />
        <div className="absolute right-[-5%] top-[20%] h-[400px] w-[400px] rounded-full bg-orange-600/10 blur-[130px]" />
      </div>

      {/* Floating Action Toast */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 flex items-center gap-3 rounded-2xl border border-red-500/40 bg-gray-950/95 px-5 py-3.5 text-xs font-bold text-white shadow-2xl backdrop-blur-xl animate-fade-in">
          <Zap size={16} className="text-red-400 animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Navbar */}
      <div className="fade-up w-full">
        <Navbar page="alerts" navigate={navigate} openModal={openModal} />
      </div>

      {/* Header Banner */}
      <div className="fade-up delay-100 glass-card-static p-6">
        <div className="flex items-center gap-2.5">
          <span className="live-dot bg-red-500" style={{ boxShadow: "0 0 10px #ef4444" }} />
          <span className="text-xs font-black uppercase tracking-widest text-red-400">
            Module 04: Real-Time Tactical Threat &amp; Alert Engine
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[var(--text-primary)] mt-2">
          Surveillance Alerts &amp; Traffic Anomalies
        </h1>
        <p className="text-xs text-[var(--text-secondary)] mt-1.5 max-w-[850px] leading-relaxed">
          Autonomous real-time identification of blacklisted vehicles, sudden traffic surges, high-density gridlocks,
          and spatial-temporal trajectory deviations.
        </p>
      </div>

      {/* Metrics Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AlertMetricCard
          title="Blacklist Detections"
          value="3 Active"
          trend="Action Required"
          icon={ShieldAlert}
          color="text-red-400"
          accent="rgba(239,68,68,0.15)"
        />
        <AlertMetricCard
          title="High-Density Spots"
          value="2 Sectors"
          trend="Severe Gridlock"
          icon={TrafficCone}
          color="text-amber-400"
          accent="rgba(245,158,11,0.15)"
        />
        <AlertMetricCard
          title="Sudden Traffic Surge"
          value="+45% Vol"
          trend="Cyberabad Corridor"
          icon={Activity}
          color="text-orange-400"
          accent="rgba(249,115,22,0.15)"
        />
        <AlertMetricCard
          title="Trajectory Anomalies"
          value="4 Detected"
          trend="Unusual Stops/Routes"
          icon={Route}
          color="text-purple-400"
          accent="rgba(139,92,246,0.15)"
        />
      </div>

      {/* Main Content Grid (Map on Left, Alerts on Right) */}
      <div className="grid w-full gap-5 lg:grid-cols-[1fr_1.4fr] xl:grid-cols-[1fr_1.6fr]">
        {/* LEFT COLUMN: GIS Incident Map & Watchlist Tool */}
        <div className="fade-up delay-300 flex flex-col gap-5 order-2 lg:order-1">
          {/* DeckGL Tactical Alert Map */}
          <div className="flex h-[440px] flex-col glass-card-static p-4">
            <div className="flex items-center justify-between mb-3 px-2">
              <div className="flex items-center gap-2">
                <ShieldAlert size={16} className="text-red-400" />
                <h3 className="text-xs font-black uppercase tracking-wider text-[var(--text-primary)]">
                  Incident &amp; Congestion Map (deck.gl)
                </h3>
              </div>
              <span className="text-[10px] font-mono text-cyan-400">
                Focus: {selectedAlert ? selectedAlert.plateNumber : "Mesh Grid"}
              </span>
            </div>

            <div className="relative flex-1 w-full rounded-2xl overflow-hidden border border-[var(--border-subtle)]">
              <DeckGLMap
                layers={mapLayers}
                viewState={{
                  longitude: selectedAlert ? selectedAlert.lng : 78.41,
                  latitude: selectedAlert ? selectedAlert.lat : 17.485,
                  zoom: 12.4,
                  pitch: 20,
                  bearing: 0,
                }}
              >
                {selectedAlert && (
                  <div className="absolute bottom-3 left-3 p-2.5 rounded-xl bg-black/80 backdrop-blur-md border border-white/10 text-[10px] font-mono pointer-events-none">
                    <p className="font-bold text-white">{selectedAlert.plateNumber}</p>
                    <p className="text-gray-400">{selectedAlert.category}</p>
                  </div>
                )}
              </DeckGLMap>
            </div>
          </div>

          {/* Add Plate to Active Watchlist Form */}
          <div className="glass-card-static p-6">
            <div className="flex items-center gap-2 mb-2">
              <Plus size={16} className="text-red-400" />
              <h3 className="text-sm font-black text-[var(--text-primary)]">Add Plate to Central Watchlist</h3>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mb-4 leading-relaxed">
              Registered plates trigger instant cross-camera spatial correlation & tactical dispatch across all 254 ANPR nodes.
            </p>

            <form onSubmit={handleAddWatchlist} className="space-y-3.5">
              <div>
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-muted)] mb-1 block">
                  Vehicle License Plate
                </label>
                <input
                  type="text"
                  placeholder="e.g. TS09AB1234"
                  value={newPlate}
                  onChange={(e) => setNewPlate(e.target.value.toUpperCase())}
                  className="glass-input w-full font-mono text-xs font-bold uppercase"
                  disabled={propagationState !== "idle"}
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-muted)] mb-1 block">
                  Flag Reason / Category
                </label>
                <input
                  type="text"
                  placeholder="e.g. Suspected Stolen / Route Anomaly Target"
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  className="glass-input w-full text-xs font-semibold"
                  disabled={propagationState !== "idle"}
                />
              </div>

              <button
                type="submit"
                disabled={propagationState !== "idle"}
                className="w-full rounded-xl bg-gradient-to-r from-red-600 to-red-700 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-red-600/30 transition hover:from-red-500 hover:to-red-600 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Register to Watch Mesh
              </button>
            </form>

            {/* Watchlist Propagation Panel */}
            {propagationState !== "idle" && (
              <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-4 backdrop-blur-md transition-all duration-500">
                <div className="flex items-center gap-2 mb-3">
                  <Radio
                    size={14}
                    className={`text-emerald-400 ${propagationState === "propagating" ? "animate-pulse" : ""}`}
                  />
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400">
                    {propagationState === "propagating" && "Propagating Watchlist..."}
                    {propagationState === "synced" && "Propagating Watchlist..."}
                    {propagationState === "detected" && "Propagation Complete"}
                  </span>
                </div>

                <div className="space-y-1.5 mb-3">
                  {WATCHLIST_CAMERAS.map((cam) => {
                    const isPropagated = propagatedCameras.includes(cam);
                    return (
                      <div
                        key={cam}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 transition-all duration-300 ${
                          isPropagated ? "bg-emerald-500/10 opacity-100" : "opacity-30"
                        }`}
                      >
                        <div
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-all duration-300 ${
                            isPropagated ? "bg-emerald-500" : "bg-gray-700"
                          }`}
                        >
                          {isPropagated && <CheckCircle2 size={10} className="text-white" />}
                        </div>
                        <span
                          className={`font-mono text-[11px] font-bold ${
                            isPropagated ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                          }`}
                        >
                          {cameraDisplayId(cam)}
                        </span>
                        {isPropagated && (
                          <span className="ml-auto text-[10px] font-bold text-emerald-400">Synced</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {(propagationState === "synced" || propagationState === "detected") && (
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 mb-3">
                    <CheckCircle2 size={14} className="text-emerald-400" />
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400">
                      Network Synchronized
                    </span>
                    <span className="ml-auto text-[10px] font-bold text-emerald-300">
                      {WATCHLIST_CAMERAS.length}/{WATCHLIST_CAMERAS.length} Nodes
                    </span>
                  </div>
                )}

                {propagationState === "detected" && detectedPlate && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.08] p-4 shadow-xl">
                    <div className="flex items-center gap-2 mb-2.5">
                      <Zap size={14} className="text-amber-400 animate-pulse" />
                      <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-400">
                        Watchlist Match Detected
                      </span>
                    </div>

                    <div className="space-y-1.5 mb-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          Plate
                        </span>
                        <span className="font-mono text-xs font-black text-[var(--text-primary)] bg-white/10 px-2 py-0.5 rounded">
                          {detectedPlate.plate}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          Camera
                        </span>
                        <span className="font-mono font-bold text-cyan-400">
                          {cameraDisplayId(detectedPlate.camera)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          Confidence
                        </span>
                        <span className="font-mono font-black text-emerald-400">{detectedPlate.confidence}</span>
                      </div>
                    </div>

                    <button
                      onClick={handleOpenTrajectory}
                      className="w-full btn-primary text-xs py-2.5 flex items-center justify-center gap-2"
                    >
                      <ExternalLink size={14} /> Open Trajectory
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
          <div className="glass-card-static p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Search alert, plate, location, or camera..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="glass-input w-full pl-10 pr-4 py-2 text-xs font-semibold"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {[
                { label: "All Alerts", key: "ALL" },
                { label: "Congestion", key: "CONGESTION" },
                { label: "Watchlist", key: "BLACKLIST" },
                { label: "Anomalies", key: "ANOMALY" },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilterCategory(f.key)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all shrink-0 ${
                    filterCategory === f.key
                      ? "bg-red-500 text-white shadow-lg shadow-red-500/30"
                      : "bg-white/[0.04] text-[var(--text-secondary)] hover:bg-white/[0.08] hover:text-white"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Alert Cards List */}
          <div className="grid gap-3.5 sm:grid-cols-2">
            {filteredAlerts.length === 0 ? (
              <div className="col-span-full rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-glass)] p-12 text-center text-xs font-bold text-[var(--text-muted)]">
                No active alerts match the selected criteria.
              </div>
            ) : (
              filteredAlerts.map((item) => {
                const isTraffic = item.type === "traffic";
                const isSelected = selectedAlert?.id === item.id;

                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedAlert(item)}
                    className={`glass-card p-5 flex flex-col gap-3 cursor-pointer transition-all duration-300 ${
                      isSelected
                        ? isTraffic
                          ? "border-amber-500/80 bg-amber-500/[0.06] shadow-[0_0_20px_rgba(245,158,11,0.2)]"
                          : "border-red-500/80 bg-red-500/[0.06] shadow-[0_0_20px_rgba(239,68,68,0.2)]"
                        : "hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-black ${
                            isTraffic
                              ? "bg-amber-500/10 text-amber-400"
                              : item.severity === "CRITICAL"
                              ? "bg-red-500/10 text-red-400"
                              : "bg-blue-500/10 text-blue-400"
                          }`}
                        >
                          {isTraffic ? <TrafficCone size={18} /> : <AlertTriangle size={18} />}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[11px] font-black tracking-wider text-[var(--text-primary)] bg-white/10 px-2 py-0.5 rounded">
                              {item.plateNumber}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                isTraffic
                                  ? "bg-amber-500 text-white"
                                  : item.severity === "CRITICAL"
                                  ? "bg-red-500 text-white"
                                  : "bg-blue-500 text-white"
                              }`}
                            >
                              {item.severity}
                            </span>
                          </div>
                          <span className="text-[11px] font-bold text-[var(--text-secondary)] mt-1 block">
                            {item.category}
                          </span>
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed pt-1">{item.description}</p>

                    <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-3 text-[11px] mt-auto">
                      <div className="flex items-center justify-between text-[var(--text-muted)]">
                        <span className="flex items-center gap-1 font-semibold truncate pr-2">
                          <MapPin size={12} className={isTraffic ? "text-amber-400" : "text-red-400"} />
                          <span className="truncate text-[var(--text-secondary)]">
                            {item.cameraNode.split("(")[0]}
                          </span>
                        </span>
                        <span className="font-mono font-bold text-emerald-400 whitespace-nowrap">
                          {isTraffic ? `Metric: ${item.confidence}` : `Conf: ${item.confidence}`}
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-between mt-1">
                        <span className="flex items-center gap-1 text-[10px] font-bold text-[var(--text-muted)]">
                          <Clock size={12} /> {item.timestamp.split(" ")[0]}
                        </span>
                        <div className="flex items-center gap-2">
                          {isTraffic ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate("traffic");
                              }}
                              className="btn-glass px-2.5 py-1 text-[10px] font-bold text-amber-300"
                            >
                              <Gauge size={12} /> View Flow
                            </button>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate("tracking");
                              }}
                              className="btn-primary px-2.5 py-1 text-[10px] font-bold"
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
                              className="btn-glass px-2 py-1 text-[10px] font-bold hover:text-emerald-400"
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

function AlertMetricCard({ title, value, trend, icon: Icon, color, accent }) {
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