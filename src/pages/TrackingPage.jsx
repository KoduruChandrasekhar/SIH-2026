import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import {
  Activity,
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Gauge,
  Layers,
  MapPin,
  Navigation,
  Radio,
  Search,
  ShieldAlert,
  Target,
  X,
  Zap,
  Network,
  Play,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { ScatterplotLayer, PathLayer } from "@deck.gl/layers";
import Navbar from "../components/Navbar";
import DeckGLMap from "../components/DeckGLMap";
import { fetchVehicles } from "../api";

// Import demo data
import {
  DEMO_PLATE,
  DEMO_GLOBAL_ID,
  DEMO_VEHICLE,
  DEMO_OBSERVATIONS,
  DEMO_REID_TRANSITIONS,
  DEMO_HANDOFF_CANDIDATES,
  DEMO_OCR_EVIDENCE,
  CAMERA_NETWORK_NODES,
  DEMO_ROUTE_PATH,
  formatConfidence,
} from "../demoData";

// Import new components
import VehicleIdentityCard from "../components/VehicleIdentityCard";
import JourneyTimeline from "../components/JourneyTimeline";
import ReIDPanel from "../components/ReIDPanel";
import OCRPanel from "../components/OCRPanel";
import CameraHandoff from "../components/CameraHandoff";
import ParallelProcessing from "../components/ParallelProcessing";
import CameraGraph from "../components/CameraGraph";

// Comprehensive Mock Database with Sample Plates & Trajectories
const localVehicles = {
  [DEMO_PLATE]: {
    plate: DEMO_PLATE,
    type: DEMO_VEHICLE.vehicleType,
    color: DEMO_VEHICLE.vehicleColor,
    confidence: formatConfidence(DEMO_VEHICLE.ocrConfidence),
    status: DEMO_VEHICLE.status,
    badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    expected: "Kukatpally → Balanagar → Madhapur",
    actual: "Kukatpally → Begumpet → Madhapur",
    deviation: "Yes (+3.2 km detour via Begumpet)",
    stats: ["4", "12.8 km", "24 min", "42 km/h"],
    reid: "97.8%",
    transitions: "3",
    fastest: "48 km/h",
    slowest: "28 km/h",
    hops: DEMO_OBSERVATIONS.map((obs) => [
      obs.camera,
      obs.name,
      obs.time,
      obs.speedLabel,
      formatConfidence(obs.confidence),
      obs.direction,
      obs.distance,
      obs.lat,
      obs.lng,
    ]),
  },
  TS08EJ4892: {
    plate: "TS08EJ4892",
    type: "Sedan",
    color: "Black",
    confidence: "96.4%",
    status: "STALE",
    badge: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    expected: "Balanagar → Kukatpally",
    actual: "Balanagar → Kukatpally",
    deviation: "None (Standard Corridor)",
    stats: ["3", "8.4 km", "35 min", "36 km/h"],
    reid: "95.6%",
    transitions: "2",
    fastest: "48 km/h",
    slowest: "24 km/h",
    hops: [
      ["CAM-05", "Balanagar Industrial", "10:15 PM", "48 km/h", "98.1%", "North-West", "0.0 km", 17.4682, 78.4357],
      ["CAM-03", "KPHB Colony Phase 1", "10:32 PM", "36 km/h", "95.4%", "West", "4.8 km", 17.4855, 78.3895],
      ["CAM-01", "Kukatpally Y-Junction", "10:50 PM", "24 km/h", "96.4%", "North", "3.6 km", 17.4947, 78.3996],
    ],
  },
  AP09CP2034: {
    plate: "AP09CP2034",
    type: "Truck",
    color: "Red",
    confidence: "94.8%",
    status: "ACTIVE",
    badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    expected: "Miyapur → Kukatpally",
    actual: "Miyapur → Kukatpally",
    deviation: "None (Direct Route)",
    stats: ["2", "5.1 km", "18 min", "32 km/h"],
    reid: "93.2%",
    transitions: "1",
    fastest: "38 km/h",
    slowest: "26 km/h",
    hops: [
      ["CAM-04", "Miyapur X-Roads", "10:20 PM", "38 km/h", "94.8%", "South-East", "0.0 km", 17.4968, 78.3614],
      ["CAM-02", "JNTU Main Road", "10:38 PM", "26 km/h", "95.1%", "East", "5.1 km", 17.4985, 78.3912],
    ],
  },
};

export default function TrackingPage({ navigate, openModal, cinematicEntry = false, onCinematicComplete }) {
  const [query, setQuery] = useState(DEMO_PLATE);
  const [plate, setPlate] = useState(DEMO_PLATE);
  const [selected, setSelected] = useState(null);
  const [live, setLive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [vehicles, setVehiclesData] = useState(localVehicles);
  const apiLoaded = useRef(false);

  // States for advanced tracking
  const [playbackState, setPlaybackState] = useState("idle"); // idle | playing | paused | complete
  const [currentHopIndex, setCurrentHopIndex] = useState(-1);
  const [segmentProgress, setSegmentProgress] = useState(0);
  const [visiblePolyline, setVisiblePolyline] = useState([]);
  const [vehiclePosition, setVehiclePosition] = useState(null);
  const [activePanel, setActivePanel] = useState(null); // 'reid' | 'ocr' | 'handoff' | null
  const [handoffStage, setHandoffStage] = useState("idle");
  const [reidActive, setReidActive] = useState(false);
  const [ocrActive, setOcrActive] = useState(false);
  const [parallelActive, setParallelActive] = useState(false);
  const [identityProgress, setIdentityProgress] = useState(0);
  const [macroProgress, setMacroProgress] = useState(0);
  const [showGraph, setShowGraph] = useState(false);
  const [isDemoVehicle, setIsDemoVehicle] = useState(true);
  const [mapFlyTo, setMapFlyTo] = useState(null);
  const [showPipMonitor, setShowPipMonitor] = useState(true);
  const [pipMinimized, setPipMinimized] = useState(false);

  // Animation timers
  const playbackTimer = useRef(null);
  const animationTimer = useRef(null);

  useEffect(() => {
    if (!cinematicEntry) return undefined;
    const flyTimer = window.setTimeout(() => {
      setMapFlyTo({ longitude: 78.405, latitude: 17.485, zoom: 12.8, pitch: 0, bearing: 0, transitionDuration: 2100 });
    }, 180);
    const completeTimer = window.setTimeout(() => onCinematicComplete?.(), 2500);
    return () => { window.clearTimeout(flyTimer); window.clearTimeout(completeTimer); };
  }, [cinematicEntry, onCinematicComplete]);

  useEffect(() => {
    if (apiLoaded.current) return;
    fetchVehicles().then((data) => {
      if (data) {
        setVehiclesData(data);
        apiLoaded.current = true;
      }
    });
  }, []);

  const vehicle = vehicles[plate] || localVehicles[DEMO_PLATE];

  const activeHop = useMemo(() => {
    if (vehicle?.hops && vehicle.hops.length > 0) {
      const idx = currentHopIndex >= 0 ? currentHopIndex : 0;
      return vehicle.hops[Math.min(idx, vehicle.hops.length - 1)];
    }
    return null;
  }, [vehicle, currentHopIndex]);

  const activeCamId = activeHop ? activeHop[0] : "CAM-01";
  const activeCamName = activeHop ? activeHop[1] : "Kukatpally Y-Junction";
  const activeTime = activeHop ? activeHop[2] : "10:42 PM";
  const activeSpeed = activeHop ? activeHop[3] : "42 km/h";
  const activeConf = activeHop ? activeHop[4] : "98.7%";

  const pipVideoSrc = useMemo(() => {
    const hopIdx = Math.max(0, currentHopIndex);
    if (hopIdx === 1) return "/camera-feeds/CAM-402.mp4";
    if (hopIdx === 2) return "/camera-feeds/CAM-403.mp4";
    return "/camera-feeds/CAM-401.mp4";
  }, [currentHopIndex]);

  // deck.gl uses [lng, lat] coordinate format
  const deckPoints = useMemo(
    () => vehicle.hops.map((h) => [h[8], h[7]]),
    [vehicle]
  );

  const search = (e) => {
    e.preventDefault();
    const q = query.trim().toUpperCase();
    if (!q) return;
    const key = vehicles[q] ? q : Object.keys(vehicles).find((p) => p.includes(q));
    if (!key) {
      openModal("Vehicle Not Found", `No trajectory records found for ${query}.`);
      return;
    }
    setPlate(key);
    setQuery(key);
    setSelected(null);
    setIsDemoVehicle(key === DEMO_PLATE);
    resetPlayback();
  };

  const selectVehicle = (p) => {
    setPlate(p);
    setQuery(p);
    setSelected(null);
    setIsDemoVehicle(p === DEMO_PLATE);
    resetPlayback();
  };

  const resetPlayback = useCallback(() => {
    setPlaybackState("idle");
    setCurrentHopIndex(-1);
    setSegmentProgress(0);
    setVisiblePolyline([]);
    setVehiclePosition(null);
    setActivePanel(null);
    setHandoffStage("idle");
    setReidActive(false);
    setOcrActive(false);
    setParallelActive(false);
    setIdentityProgress(0);
    setMacroProgress(0);
    clearTimeout(playbackTimer.current);
    clearInterval(animationTimer.current);
  }, []);

  const startPlayback = () => {
    if (!isDemoVehicle) {
      setLive(!live);
      return;
    }
    if (playbackState === "complete") {
      resetPlayback();
    }
    setPlaybackState("playing");
  };

  const pausePlayback = () => {
    setPlaybackState("paused");
    clearTimeout(playbackTimer.current);
    clearInterval(animationTimer.current);
  };

  const seekToHop = (index) => {
    resetPlayback();
    setCurrentHopIndex(index);
    setSegmentProgress(0);
    setVisiblePolyline(deckPoints.slice(0, index + 1));
    setVehiclePosition(deckPoints[index]);
    setPlaybackState("paused");
  };

  // Main playback logic loop
  useEffect(() => {
    if (playbackState !== "playing" || !isDemoVehicle) return;

    const playNextHop = () => {
      let nextIndex = currentHopIndex + 1;

      if (nextIndex >= DEMO_OBSERVATIONS.length) {
        setPlaybackState("complete");
        setParallelActive(false);
        setActivePanel(null);
        return;
      }

      const isFirstHop = nextIndex === 0;

      // Camera Handoff if not first hop
      if (!isFirstHop) {
        setActivePanel("handoff");
        setHandoffStage("leaving");
        setParallelActive(true);
        setIdentityProgress(0);
        setMacroProgress(1);

        playbackTimer.current = setTimeout(() => {
          setHandoffStage("searching");
          setMacroProgress(2);

          playbackTimer.current = setTimeout(() => {
            setHandoffStage("found");

            playbackTimer.current = setTimeout(() => {
              setHandoffStage("confirmed");

              playbackTimer.current = setTimeout(() => {
                startReIDPhase(nextIndex);
              }, 1000);
            }, 800);
          }, 1500);
        }, 1000);
      } else {
        // First hop setup
        setCurrentHopIndex(0);
        setVisiblePolyline([deckPoints[0]]);
        setVehiclePosition(deckPoints[0]);
        setParallelActive(true);
        setIdentityProgress(1);
        setMacroProgress(1);
        setActivePanel("ocr");
        setOcrActive(true);

        playbackTimer.current = setTimeout(() => {
          setIdentityProgress(2);
          setMacroProgress(2);
          playbackTimer.current = setTimeout(() => {
            setIdentityProgress(3);
            setMacroProgress(3);
            playbackTimer.current = setTimeout(() => {
              playNextHop();
            }, 2000);
          }, 1500);
        }, 3000);
      }
    };

    const startReIDPhase = (nextIndex) => {
      setActivePanel("reid");
      setReidActive(true);
      setIdentityProgress(2);
      setMacroProgress(3);

      playbackTimer.current = setTimeout(() => {
        setIdentityProgress(3);
        setMacroProgress(4);
        animateMovement(currentHopIndex, nextIndex);
      }, 3000);
    };

    const animateMovement = (fromIdx, toIdx) => {
      setActivePanel(null);
      setCurrentHopIndex(toIdx);

      const startPt = deckPoints[fromIdx];
      const endPt = deckPoints[toIdx];
      let startTime = Date.now();
      const duration = 2000;

      clearInterval(animationTimer.current);
      animationTimer.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        let progress = elapsed / duration;

        if (progress >= 1) {
          progress = 1;
          clearInterval(animationTimer.current);
          setSegmentProgress(0);
          setVisiblePolyline(deckPoints.slice(0, toIdx + 1));
          setVehiclePosition(endPt);

          playbackTimer.current = setTimeout(() => {
            playNextHop();
          }, 1000);
        } else {
          setSegmentProgress(progress);
          const currentLng = startPt[0] + (endPt[0] - startPt[0]) * progress;
          const currentLat = startPt[1] + (endPt[1] - startPt[1]) * progress;
          setVehiclePosition([currentLng, currentLat]);
          setVisiblePolyline([...deckPoints.slice(0, fromIdx + 1), [currentLng, currentLat]]);
        }
      }, 20);
    };

    if (currentHopIndex === -1 && segmentProgress === 0) {
      playNextHop();
    } else if (currentHopIndex >= 0 && currentHopIndex < DEMO_OBSERVATIONS.length - 1 && segmentProgress === 0) {
      playNextHop();
    }

    return () => {
      clearTimeout(playbackTimer.current);
      clearInterval(animationTimer.current);
    };
  }, [playbackState, currentHopIndex, isDemoVehicle, deckPoints]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(playbackTimer.current);
      clearInterval(animationTimer.current);
    };
  }, []);

  const copyPlate = async () => {
    try {
      await navigator.clipboard.writeText(vehicle.plate);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      openModal("Copy Failed", "Clipboard access unavailable.");
    }
  };

  const exportCSV = () => {
    const header = "Plate,Camera,Location,Time,Speed,OCR,Direction,Distance,Latitude,Longitude";
    const rows = vehicle.hops.map(
      (h) => `"${vehicle.plate}","${h[0]}","${h[1]}","${h[2]}","${h[3]}","${h[4]}","${h[5]}","${h[6]}",${h[7]},${h[8]}`
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${vehicle.plate}-trajectory.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Status helper for camera markers
  const getCameraStatus = (camId) => {
    if (!isDemoVehicle) return vehicle.hops.some((h) => h[0] === camId) ? "visited" : "unvisited";
    const obsIndex = DEMO_OBSERVATIONS.findIndex((o) => o.camera === camId);
    if (obsIndex === -1) return "unvisited";
    if (obsIndex === currentHopIndex) return "active";
    if (obsIndex < currentHopIndex || playbackState === "complete") return "visited";
    return "unvisited";
  };

  // deck.gl Layers for GIS Trajectory Map
  const mapLayers = useMemo(() => {
    // 1. Full Planned Route (subdued line)
    const plannedRouteLayer = new PathLayer({
      id: "tracking-planned-route",
      data: deckPoints.length > 1 ? [{ path: deckPoints }] : [],
      getPath: (d) => d.path,
      getColor: [148, 163, 184, 100],
      getWidth: 3,
      widthMinPixels: 2,
    });

    // 2. Active Animated Route
    const activeRoutePoints = isDemoVehicle ? visiblePolyline : deckPoints;
    const activeRouteLayer = new PathLayer({
      id: "tracking-active-route",
      data: activeRoutePoints.length > 1 ? [{ path: activeRoutePoints }] : [],
      getPath: (d) => d.path,
      getColor: [59, 130, 246, 240],
      getWidth: 4.5,
      widthMinPixels: 3,
    });

    // 3. Camera Nodes
    const relevantCameraNodes = CAMERA_NETWORK_NODES.filter((node) => {
      const status = getCameraStatus(node.id);
      if (status === "unvisited" && !isDemoVehicle) return false;
      return true;
    });

    const cameraHalos = new ScatterplotLayer({
      id: "tracking-cam-halos",
      data: relevantCameraNodes.filter((n) => getCameraStatus(n.id) === "active"),
      getPosition: (d) => [d.lng, d.lat],
      getRadius: 450,
      getFillColor: [6, 182, 212, 60],
      getLineColor: [6, 182, 212, 180],
      stroked: true,
      lineWidthMinPixels: 2,
      radiusMinPixels: 18,
      radiusMaxPixels: 35,
      pickable: false,
    });

    // 3. Camera Node Disks (clean tactical circular disks, no extruded pillars)
    const cameraNodes = new ScatterplotLayer({
      id: "tracking-camera-disks",
      data: relevantCameraNodes,
      getPosition: (d) => [d.lng, d.lat],
      getRadius: 140,
      radiusMinPixels: 6,
      radiusMaxPixels: 13,
      getFillColor: (d) => {
        const s = getCameraStatus(d.id);
        if (s === "active") return [6, 182, 212, 255];
        if (s === "visited") return [59, 130, 246, 240];
        return [100, 116, 139, 200];
      },
      getLineColor: [255, 255, 255, 255],
      lineWidthMinPixels: 2,
      stroked: true,
      filled: true,
      pickable: true,
    });

    // 4. Vehicle 2D Marker Disc (clean tracking puck)
    const vehicleMarker = vehiclePosition
      ? new ScatterplotLayer({
          id: "tracking-vehicle-disk",
          data: [{ position: vehiclePosition }],
          getPosition: (d) => d.position,
          getRadius: 180,
          radiusMinPixels: 9,
          radiusMaxPixels: 18,
          getFillColor: [245, 158, 11, 255],
          getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 2.5,
          stroked: true,
          filled: true,
          pickable: true,
        })
      : null;

    return [plannedRouteLayer, activeRouteLayer, cameraHalos, cameraNodes, vehicleMarker].filter(Boolean);
  }, [deckPoints, visiblePolyline, isDemoVehicle, vehiclePosition, currentHopIndex, playbackState]);

  return (
    <div className="tracking-page flex w-full flex-col gap-6 pb-12 text-[var(--text-primary)]">
      <div className="fade-up">
        <Navbar page="tracking" navigate={navigate} openModal={openModal} />
      </div>

      {/* 1. Vehicle / Plate Search Header */}
      <section className="fade-up delay-100 glass-card-static p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="live-dot bg-blue-500" style={{ boxShadow: "0 0 10px #3b82f6" }} />
              <span className="text-[11px] font-black uppercase tracking-widest text-blue-400">
                Module 02 · Spatial-Temporal Trajectory Tracking
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[var(--text-primary)]">
              Single Plate Trajectory Reconstructor
            </h1>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Search plates, view camera hops, and verify multi-camera re-identification.
            </p>
          </div>

          <form onSubmit={search} className="flex gap-2">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="License plate..."
                className="glass-input w-[210px] pl-9 pr-8 text-xs font-bold font-mono"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={startPlayback}
              className={`rounded-xl px-5 py-2.5 text-xs font-black uppercase tracking-wider text-white transition-all flex items-center gap-2 shadow-lg ${
                playbackState === "playing"
                  ? "bg-amber-500 hover:bg-amber-600 animate-pulse shadow-amber-500/25"
                  : playbackState === "complete"
                  ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/25"
                  : "bg-blue-600 hover:bg-blue-500 shadow-blue-500/25"
              }`}
            >
              {playbackState === "playing" ? (
                <>TRACING...</>
              ) : playbackState === "complete" ? (
                <>REPLAY JOURNEY</>
              ) : (
                <>TRACE VEHICLE</>
              )}
            </button>
          </form>
        </div>

        {/* Quick Sample Plates */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-muted)]">
            Sample Plates:
          </span>
          {Object.keys(vehicles).map((p) => (
            <button
              key={p}
              onClick={() => selectVehicle(p)}
              className={`rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold transition-all ${
                plate === p
                  ? "bg-blue-600 text-white shadow-[0_0_12px_rgba(59,130,246,0.5)]"
                  : "bg-white/[0.04] text-[var(--text-secondary)] hover:bg-white/[0.08] hover:text-white"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </section>

      {/* Stats Summary */}
      <div className="fade-up delay-150 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat icon={Layers} label="Cameras" value={vehicle.stats[0]} />
        <Stat icon={Navigation} label="Distance" value={vehicle.stats[1]} />
        <Stat icon={Clock} label="Travel Time" value={vehicle.stats[2]} />
        <Stat icon={Gauge} label="Average Speed" value={vehicle.stats[3]} />
        <Stat icon={ShieldAlert} label="OCR Match" value={vehicle.confidence} blue />
      </div>

      {/* Main Map & Side Panel */}
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <section className={`${cinematicEntry ? "tracking-cinematic-map" : ""} fade-up delay-200 flex h-[640px] flex-col glass-card-static p-4`}>
          <div className="mb-3 flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <MapPin size={15} className="text-blue-400" />
              <h3 className="text-[11px] font-black uppercase tracking-wider text-[var(--text-primary)]">
                GIS Trajectory Map (deck.gl)
              </h3>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowGraph(!showGraph)}
                className="btn-glass flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold"
              >
                <Network size={11} className={showGraph ? "text-cyan-400" : ""} /> Graph
              </button>
            </div>
          </div>

          <div className="relative flex-1 overflow-hidden rounded-2xl border border-[var(--border-subtle)]">
            <DeckGLMap
              layers={mapLayers}
              initialViewState={cinematicEntry
                ? { longitude: 78.9637, latitude: 20.5937, zoom: 4.15, pitch: 0, bearing: 0 }
                : { longitude: 78.405, latitude: 17.485, zoom: 12.8, pitch: 0, bearing: 0 }}
              flyTo={mapFlyTo}
            >
              {/* Overlay Status Badge */}
              <div className="absolute top-3 right-3 rounded-lg bg-black/75 backdrop-blur-md border border-white/10 px-3 py-1.5 text-[10px] font-mono text-gray-300 pointer-events-none">
                Plate: <strong className="text-cyan-400">{vehicle.plate}</strong>
                {vehiclePosition && (
                  <span className="ml-2 text-emerald-400 font-bold">● Active Trace</span>
                )}
              </div>

              {/* In-Map Picture-in-Picture (PIP) Camera Feed Monitor */}
              {showPipMonitor ? (
                <div className="absolute bottom-3 left-3 z-10 w-72 sm:w-80 rounded-2xl border border-cyan-500/30 bg-slate-950/90 p-3 shadow-2xl backdrop-blur-xl pointer-events-auto transition-all duration-300">
                  {/* Monitor Header */}
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                      <span className="text-[10px] font-mono font-black uppercase tracking-wider text-cyan-300 truncate">
                        PIP FEED · {activeCamId}
                      </span>
                      <span className="rounded bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 text-[9px] font-bold text-cyan-400 flex-shrink-0">
                        Hop {currentHopIndex >= 0 ? currentHopIndex + 1 : 1}/{vehicle.hops.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setPipMinimized((prev) => !prev)}
                        className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
                        title={pipMinimized ? "Expand Stream" : "Minimize Stream"}
                      >
                        {pipMinimized ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowPipMonitor(false)}
                        className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
                        title="Close PIP Monitor"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>

                  {!pipMinimized ? (
                    <>
                      {/* Dynamic Video Stream switching on camera hop */}
                      <div className="relative mt-2.5 h-36 w-full overflow-hidden rounded-xl border border-white/10 bg-black">
                        <video
                          key={pipVideoSrc}
                          src={pipVideoSrc}
                          autoPlay
                          muted
                          loop
                          playsInline
                          className="h-full w-full object-cover"
                        />

                        {/* Tactical Target Acquisition Overlay */}
                        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-2">
                          <div className="flex items-center justify-between text-[9px] font-mono font-bold">
                            <span className="rounded bg-black/60 px-1.5 py-0.5 text-cyan-300 backdrop-blur-sm truncate max-w-[170px]">
                              {activeCamName}
                            </span>
                            <span className="rounded bg-emerald-600/80 px-1.5 py-0.5 text-white flex-shrink-0">
                              {playbackState === "playing" ? "● TRACKING" : "● FEED SYNC"}
                            </span>
                          </div>

                          {/* Target Reticle */}
                          <div className="mx-auto my-auto h-16 w-28 rounded border border-emerald-400/80 bg-emerald-500/10 p-1 flex flex-col justify-between backdrop-blur-[1px]">
                            <span className="text-[7px] font-mono font-black uppercase tracking-wider text-emerald-300">
                              TARGET ACQUIRED
                            </span>
                            <div className="flex items-center justify-between">
                              <span className="text-[8px] font-mono font-black text-white">
                                {vehicle.plate}
                              </span>
                              <span className="text-[8px] font-mono font-bold text-amber-300">
                                {activeConf}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-[9px] font-mono text-gray-300 bg-black/70 px-2 py-0.5 rounded backdrop-blur-sm">
                            <span>{activeTime}</span>
                            <span className="text-emerald-400 font-bold">{activeSpeed}</span>
                          </div>
                        </div>
                      </div>

                      {/* Live Re-ID / Optical Status */}
                      <div className="mt-2.5 flex items-center justify-between rounded-lg bg-white/[0.04] p-2 border border-white/5 text-[10px] font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                          <span className="text-gray-300">Optical Hand-off:</span>
                        </div>
                        <span className="font-bold text-cyan-400">
                          {handoffStage === "idle" ? "Locked (98.7%)" : handoffStage.toUpperCase()}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-gray-300">
                      <span>{activeCamId} · {activeSpeed}</span>
                      <button
                        type="button"
                        onClick={() => setPipMinimized(false)}
                        className="text-cyan-400 font-bold hover:underline"
                      >
                        Expand Stream
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* Minimized Launcher Button */
                <button
                  type="button"
                  onClick={() => {
                    setShowPipMonitor(true);
                    setPipMinimized(false);
                  }}
                  className="absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-black/80 px-3 py-1.5 text-[11px] font-mono text-gray-300 shadow-xl backdrop-blur-md hover:bg-black hover:text-white transition-all pointer-events-auto"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>PIP Feed: <strong className="text-cyan-400">{activeCamId}</strong></span>
                  <span className="text-[10px] text-gray-400">({activeSpeed})</span>
                </button>
              )}
            </DeckGLMap>
          </div>
        </section>

        {/* Right Side Panels */}
        <div className="fade-up delay-300 flex flex-col gap-4 h-[640px] overflow-y-auto pr-2 custom-scrollbar">
          {/* Always show Vehicle Identity */}
          <VehicleIdentityCard
            vehicle={
              isDemoVehicle
                ? DEMO_VEHICLE
                : {
                    plate: vehicle.plate,
                    globalId: "---",
                    vehicleType: vehicle.type,
                    vehicleColor: vehicle.color,
                  }
            }
            currentObservation={
              isDemoVehicle && currentHopIndex >= 0 ? DEMO_OBSERVATIONS[currentHopIndex] : null
            }
            isTracking={playbackState === "playing"}
          />

          {/* Dynamic Panels during playback */}
          {isDemoVehicle && (
            <>
              {activePanel === "ocr" && (
                <OCRPanel ocrData={DEMO_OCR_EVIDENCE} isActive={ocrActive} />
              )}

              {activePanel === "handoff" && currentHopIndex > 0 && (
                <CameraHandoff
                  fromCamera={DEMO_OBSERVATIONS[currentHopIndex - 1]?.camera}
                  candidates={
                    DEMO_HANDOFF_CANDIDATES.find(
                      (c) => c.from === DEMO_OBSERVATIONS[currentHopIndex - 1]?.camera
                    )?.candidates || []
                  }
                  confirmedCamera={
                    DEMO_HANDOFF_CANDIDATES.find(
                      (c) => c.from === DEMO_OBSERVATIONS[currentHopIndex - 1]?.camera
                    )?.confirmed
                  }
                  stage={handoffStage}
                  isActive={true}
                />
              )}

              {activePanel === "reid" && currentHopIndex > 0 && (
                <ReIDPanel
                  matchData={DEMO_REID_TRANSITIONS.find(
                    (t) =>
                      t.from === DEMO_OBSERVATIONS[currentHopIndex - 1]?.camera &&
                      t.to === DEMO_OBSERVATIONS[currentHopIndex]?.camera
                  )}
                  fromCamera={DEMO_OBSERVATIONS[currentHopIndex - 1]?.camera}
                  toCamera={DEMO_OBSERVATIONS[currentHopIndex]?.camera}
                  globalId={DEMO_GLOBAL_ID}
                  isActive={reidActive}
                />
              )}
            </>
          )}

          {/* Fallback legacy info if not playing or not demo */}
          {(!isDemoVehicle || playbackState === "idle" || playbackState === "complete") && (
            <>
              <section className="glass-card-static p-5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-[var(--text-muted)]">
                    Vehicle Profile
                  </span>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[9px] font-extrabold ${vehicle.badge}`}>
                    {vehicle.status}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-black font-mono text-[var(--text-primary)]">{vehicle.plate}</h2>
                  <button
                    onClick={copyPlate}
                    className="btn-glass p-2 text-[var(--text-secondary)] hover:text-white"
                  >
                    {copied ? <CheckCircle2 size={15} className="text-emerald-400" /> : <Copy size={15} />}
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-y border-[var(--border-subtle)] py-3">
                  <Info label="Type" value={vehicle.type} />
                  <Info label="Color" value={vehicle.color} />
                  <Info label="OCR" value={vehicle.confidence} blue />
                </div>
                <div className="mt-3 rounded-xl bg-white/[0.02] border border-[var(--border-subtle)] p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Activity size={13} className="text-blue-400" />
                    <span className="text-[9px] font-extrabold uppercase text-[var(--text-muted)]">
                      Detection Window
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <Info label="First" value={vehicle.hops[0][2]} />
                    <Info label="Latest" value={vehicle.hops.at(-1)[2]} right />
                  </div>
                </div>
                <div className="mt-3">
                  <button onClick={exportCSV} className="btn-primary w-full text-xs py-2.5 flex items-center justify-center gap-1.5">
                    <Download size={13} /> Export CSV Trajectory
                  </button>
                </div>
              </section>

              <section
                className={`glass-card-static p-5 ${
                  vehicle.deviation !== "None" && !vehicle.deviation.includes("Standard")
                    ? "border-amber-500/30 bg-amber-500/[0.04]"
                    : "border-emerald-500/30 bg-emerald-500/[0.04]"
                }`}
              >
                <div className="mb-3 flex items-center gap-2">
                  {vehicle.deviation !== "None" && !vehicle.deviation.includes("Standard") ? (
                    <ShieldAlert size={15} className="text-amber-400" />
                  ) : (
                    <CheckCircle2 size={15} className="text-emerald-400" />
                  )}
                  <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-primary)]">
                    Route Analysis
                  </h3>
                </div>
                <Info label="Expected Route" value={vehicle.expected} />
                <div className="mt-3">
                  <Info label="Actual Route" value={vehicle.actual} blue />
                </div>
                <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
                  <Info label="Deviation Analysis" value={vehicle.deviation} />
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {isDemoVehicle && (
        <JourneyTimeline
          observations={DEMO_OBSERVATIONS}
          currentIndex={currentHopIndex}
          segmentProgress={segmentProgress}
          isPlaying={playbackState === "playing"}
          isComplete={playbackState === "complete"}
          onSeek={seekToHop}
          onPlay={startPlayback}
          onPause={pausePlayback}
          onRestart={startPlayback}
        />
      )}

      {showGraph && (
        <CameraGraph
          activeRoute={
            isDemoVehicle
              ? DEMO_ROUTE_PATH.slice(0, Math.max(1, currentHopIndex + 1))
              : vehicle.hops.map((h) => h[0])
          }
          currentCamera={isDemoVehicle && currentHopIndex >= 0 ? DEMO_OBSERVATIONS[currentHopIndex].camera : null}
        />
      )}

      {isDemoVehicle && parallelActive && (
        <ParallelProcessing
          isActive={true}
          identityProgress={identityProgress}
          macroProgress={macroProgress}
        />
      )}

      {/* 5. Chronological Movement Timeline */}
      {(!isDemoVehicle || playbackState === "complete") && (
        <section className="fade-up glass-card-static p-6 mt-4">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Clock size={15} className="text-blue-400" />
                <h3 className="text-sm font-black text-[var(--text-primary)]">Movement Timeline</h3>
              </div>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                Chronological camera detections across the vehicle journey
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {vehicle.hops.map((h, i) => (
              <button
                key={h[0]}
                onClick={() => setSelected(h)}
                className={`glass-card p-4 text-left transition-all ${
                  selected?.[0] === h[0]
                    ? "border-blue-500/80 bg-blue-500/[0.08] shadow-[0_0_15px_rgba(59,130,246,0.2)]"
                    : "hover:border-white/20"
                }`}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        i === 0 ? "bg-emerald-400" : i === vehicle.hops.length - 1 ? "bg-red-400" : "bg-blue-400"
                      }`}
                    />
                    <span className="font-mono text-[10px] font-black text-blue-400">{h[0]}</span>
                  </div>
                  <span className="text-[9px] font-bold text-[var(--text-muted)]">{h[2]}</span>
                </div>
                <h4 className="text-xs font-black text-[var(--text-primary)]">{h[1]}</h4>
                <div className="mt-3 grid grid-cols-3 border-t border-[var(--border-subtle)] pt-3 text-[9px] font-bold text-[var(--text-secondary)]">
                  <span>{h[3]}</span>
                  <span>{h[5]}</span>
                  <span>
                    OCR <b className="text-emerald-400">{h[4]}</b>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 6. Selected Detection Details */}
      {selected && (!isDemoVehicle || playbackState === "complete") && (
        <section className="fade-up glass-card-static p-6 mt-2 border-blue-500/30 bg-blue-500/[0.04]">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-400">
                <Target size={13} /> Selected Detection Details
              </div>
              <h3 className="mt-1 text-lg font-black text-[var(--text-primary)]">{selected[0]}</h3>
              <p className="text-[11px] font-semibold text-[var(--text-secondary)]">{selected[1]}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-5">
              <Info label="Time" value={selected[2]} />
              <Info label="Speed" value={selected[3]} />
              <Info label="Direction" value={selected[5]} />
              <Info label="Distance" value={selected[6]} />
              <Info label="OCR Match" value={selected[4]} blue />
            </div>
          </div>
        </section>
      )}

      {/* 8. Tracking Intelligence & Multi-Camera Re-Identification */}
      {(!isDemoVehicle || playbackState === "complete") && (
        <section className="fade-up glass-card-static p-6 mt-2">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={15} className="text-blue-400" />
              <h2 className="text-sm font-black text-[var(--text-primary)]">Tracking Intelligence &amp; Re-ID</h2>
            </div>
            <span className="rounded-full bg-blue-500/10 border border-blue-500/20 px-3 py-1 text-[9px] font-extrabold text-blue-400">
              AI ANALYSIS
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="glass-card p-4">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-muted)]">
                  Re-ID Confidence
                </span>
                <span className="text-lg font-black text-blue-400">{vehicle.reid}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" style={{ width: vehicle.reid }} />
              </div>
              <p className="mt-3 text-[10px] leading-4 text-[var(--text-secondary)]">
                Vehicle identity verified across <b className="text-[var(--text-primary)]">{vehicle.stats[0]} camera nodes</b>.
              </p>
            </div>

            <div className="glass-card p-4">
              <div className="mb-4 flex items-center gap-2">
                <Activity size={14} className="text-blue-400" />
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-muted)]">
                  Movement Metrics
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Mini label="Transitions" value={vehicle.transitions} />
                <Mini label="Distance" value={vehicle.stats[1]} />
                <Mini label="Fastest" value={vehicle.fastest} />
                <Mini label="Slowest" value={vehicle.slowest} />
              </div>
            </div>

            <div className="glass-card p-4">
              <div className="mb-4 flex items-center gap-2">
                <ShieldAlert size={14} className="text-blue-400" />
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-muted)]">
                  AI Findings
                </span>
              </div>
              <div className="space-y-2">
                <Check text="Multi-camera re-ID verified successfully" />
                <Check text={`${vehicle.stats[0]} camera network hops matched`} />
                <Check text={`OCR plate confidence rating: ${vehicle.confidence}`} />
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, blue }) {
  return (
    <div className="glass-card p-4 flex items-center gap-3">
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-xl ${
          blue ? "bg-blue-500/10 text-blue-400" : "bg-white/[0.04] text-[var(--text-secondary)]"
        }`}
      >
        <Icon size={16} />
      </div>
      <div>
        <p className="text-[9px] font-extrabold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
        <p className={`text-base font-black ${blue ? "text-blue-400" : "text-[var(--text-primary)]"}`}>{value}</p>
      </div>
    </div>
  );
}

function Info({ label, value, blue, right }) {
  return (
    <div className={right ? "text-right" : ""}>
      <p className="text-[9px] font-extrabold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className={`mt-0.5 text-xs font-bold ${blue ? "text-blue-400" : "text-[var(--text-primary)]"}`}>{value}</p>
    </div>
  );
}

function Mini({ label, value }) {
  return (
    <div>
      <p className="text-[9px] font-extrabold uppercase text-[var(--text-muted)]">{label}</p>
      <p className="mt-0.5 text-xs font-black text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function Check({ text }) {
  return (
    <div className="flex items-start gap-2 text-[10px] font-bold text-emerald-400">
      <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-400" />
      <span>{text}</span>
    </div>
  );
}
