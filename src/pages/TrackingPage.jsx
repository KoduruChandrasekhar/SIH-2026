import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Gauge,
  Layers,
  MapPin,
  Navigation,
  Search,
  ShieldAlert,
  Target,
  X,
  Zap,
  Network,
  Check as CheckIcon,
} from "lucide-react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import Navbar from "../components/Navbar";
import { fetchVehicles } from "../api";
import { MapBoundary } from "../components/motion/Motion";
import { cameraById, cameraRegistry } from "../data";

import {
  DEMO_PLATE,
  DEMO_GLOBAL_ID,
  DEMO_VEHICLE,
  DEMO_OBSERVATIONS,
  DEMO_REID_TRANSITIONS,
  DEMO_HANDOFF_CANDIDATES,
  DEMO_OCR_EVIDENCE,
  formatConfidence,
} from "../demoData";

import VehicleIdentityCard from "../components/VehicleIdentityCard";
import JourneyTimeline from "../components/JourneyTimeline";
import ReIDPanel from "../components/ReIDPanel";
import OCRPanel from "../components/OCRPanel";
import CameraHandoff from "../components/CameraHandoff";
import ParallelProcessing from "../components/ParallelProcessing";
import CameraGraph from "../components/CameraGraph";

// Trajectory records. Every hop uses a registry camera with its real coordinates; hop distances
// are road distances (≥ the straight line between the cameras) and times match the speeds.
// `deviationSegs` lists the leg indices (hop i → i+1) that depart from the expected route.
const localVehicles = {
  [DEMO_PLATE]: {
    plate: DEMO_PLATE,
    globalId: DEMO_GLOBAL_ID,
    type: DEMO_VEHICLE.vehicleType,
    color: DEMO_VEHICLE.vehicleColor,
    confidence: formatConfidence(DEMO_VEHICLE.ocrConfidence),
    status: DEMO_VEHICLE.status,
    badge: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    expected: "Kukatpally → JNTU → Madhapur (direct, ~8 km)",
    actual: "Kukatpally → JNTU → Balanagar → Madhapur",
    deviation: "Yes (+11 km detour via Balanagar)",
    deviationSegs: [1, 2],
    stats: ["4", "19.2 km", "37 min", "31 km/h"],
    reid: "97.8%",
    transitions: "3",
    fastest: "36 km/h",
    slowest: "29 km/h",
    hops: DEMO_OBSERVATIONS.map((obs) => [obs.camera, obs.name, obs.time, obs.speedLabel, formatConfidence(obs.confidence), obs.direction, obs.distance, obs.lat, obs.lng]),
  },
  TS09EA4512: {
    plate: "TS09EA4512",
    globalId: "GV-00311",
    type: "SUV",
    color: "Grey",
    confidence: "97.9%",
    status: "BLACKLIST",
    badge: "bg-red-500/10 text-red-600 border-red-500/20",
    expected: "Watchlist vehicle — no expected route",
    actual: "Gachibowli → Madhapur → KPHB → Kukatpally Y-Junction",
    deviation: "Blacklist match (FIR 1127/2026) — continuous tracking",
    deviationSegs: [],
    stats: ["4", "11.1 km", "36 min", "19 km/h"],
    reid: "96.2%",
    transitions: "3",
    fastest: "21 km/h",
    slowest: "14 km/h",
    hops: [
      ["CAM #410", "Gachibowli Flyover", "18:08:20", "21 km/h", "96.8%", "East", "0 km", 17.4401, 78.3489],
      ["CAM #406", "Madhapur IT Corridor", "18:19:45", "19 km/h", "97.3%", "North-East", "3.6 km", 17.4485, 78.3742],
      ["CAM #411", "KPHB Colony Phase 1", "18:36:10", "20 km/h", "95.9%", "North-East", "5.6 km", 17.4849, 78.391],
      ["CAM #401", "Kukatpally Y-Junction", "18:44:05", "14 km/h", "97.9%", "North-West", "1.9 km", 17.4947, 78.3996],
    ],
  },
  AP28BK8821: {
    plate: "AP28BK8821",
    globalId: "GV-00284",
    type: "Light Goods Vehicle",
    color: "White",
    confidence: "95.1%",
    status: "ANOMALY",
    badge: "bg-purple-500/10 text-purple-600 border-purple-500/20",
    expected: "JNTU → Kukatpally → Balanagar (CAM-403)",
    actual: "JNTU → Moosapet → Bharat Nagar",
    deviation: "Expected hand-off to CAM-403 not observed (~3 km off route)",
    deviationSegs: [1],
    stats: ["3", "8.2 km", "18 min", "27 km/h"],
    reid: "94.7%",
    transitions: "2",
    fastest: "34 km/h",
    slowest: "14 km/h",
    hops: [
      ["CAM #402", "JNTU Metro Station", "18:12:40", "31 km/h", "95.6%", "South-East", "0 km", 17.4985, 78.3912],
      ["CAM #404", "Moosapet Bypass Link", "18:24:10", "34 km/h", "91.2%", "East", "6.6 km", 17.4631, 78.4236],
      ["CAM #412", "Bharat Nagar Flyover", "18:31:05", "14 km/h", "95.1%", "North-East", "1.6 km", 17.4671, 78.4296],
    ],
  },
  TS08EJ4892: {
    plate: "TS08EJ4892",
    globalId: "GV-00198",
    type: "Sedan",
    color: "Black",
    confidence: "96.4%",
    status: "STALE",
    badge: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    expected: "Balanagar → Kukatpally",
    actual: "Balanagar → Kukatpally",
    deviation: "None (Standard Corridor)",
    deviationSegs: [],
    stats: ["3", "7.3 km", "16 min", "27 km/h"],
    reid: "95.6%",
    transitions: "2",
    fastest: "30 km/h",
    slowest: "19 km/h",
    hops: [
      ["CAM #403", "Balanagar Main Road", "16:15:20", "30 km/h", "96.4%", "North-West", "0 km", 17.4682, 78.4357],
      ["CAM #401", "Kukatpally Y-Junction", "16:27:05", "30 km/h", "95.1%", "West", "5.9 km", 17.4947, 78.3996],
      ["CAM #402", "JNTU Metro Station", "16:31:30", "19 km/h", "94.2%", "North-West", "1.4 km", 17.4985, 78.3912],
    ],
  },
  TS09EE9911: {
    plate: "TS09EE9911",
    globalId: "GV-00242",
    type: "SUV",
    color: "White",
    confidence: "98.1%",
    status: "ALERT",
    badge: "bg-red-500/10 text-red-600 border-red-500/20",
    expected: "Madhapur → Miyapur via Kondapur (~8.4 km)",
    actual: "Madhapur → JNTU → Miyapur",
    deviation: "Suspected evasion route (+2.9 km via JNTU)",
    deviationSegs: [0],
    stats: ["3", "11.3 km", "23 min", "29 km/h"],
    reid: "96.9%",
    transitions: "2",
    fastest: "38 km/h",
    slowest: "26 km/h",
    hops: [
      ["CAM #406", "Madhapur IT Corridor", "14:10:05", "38 km/h", "98.1%", "North", "0 km", 17.4485, 78.3742],
      ["CAM #402", "JNTU Metro Station", "14:24:50", "26 km/h", "97.5%", "West", "7.1 km", 17.4985, 78.3912],
      ["CAM #407", "Miyapur X Roads", "14:33:20", "31 km/h", "96.8%", "West", "4.2 km", 17.4966, 78.3574],
    ],
  },
  MH04EF7710: {
    plate: "MH04EF7710",
    globalId: "GV-00267",
    type: "Sedan",
    color: "Silver",
    confidence: "94.2%",
    status: "RESOLVED",
    badge: "bg-gray-500/10 text-gray-600 border-gray-500/20",
    expected: "Madhapur → Jubilee Hills",
    actual: "Madhapur → Jubilee Hills Checkpost (stopped 18 min)",
    deviation: "Unusual stop: 18 min stationary in a no-stopping zone at CAM-405",
    deviationSegs: [],
    stats: ["2", "5.2 km", "13 min", "23 km/h"],
    reid: "95.4%",
    transitions: "1",
    fastest: "27 km/h",
    slowest: "0 km/h",
    hops: [
      ["CAM #406", "Madhapur IT Corridor", "17:40:10", "27 km/h", "95.0%", "South-East", "0 km", 17.4485, 78.3742],
      ["CAM #405", "Jubilee Hills Checkpost", "17:53:30", "0 km/h", "94.2%", "Stationary", "5.2 km", 17.4325, 78.4072],
    ],
  },
  AP28BY5521: {
    plate: "AP28BY5521",
    globalId: "GV-00129",
    type: "Hatchback",
    color: "Red",
    confidence: "97.6%",
    status: "COMPLETED",
    badge: "bg-gray-500/10 text-gray-600 border-gray-500/20",
    expected: "Jubilee Hills → Madhapur",
    actual: "Jubilee Hills → Madhapur",
    deviation: "None",
    deviationSegs: [],
    stats: ["2", "5.2 km", "10 min", "31 km/h"],
    reid: "98.4%",
    transitions: "1",
    fastest: "34 km/h",
    slowest: "29 km/h",
    hops: [
      ["CAM #405", "Jubilee Hills Checkpost", "11:05:12", "34 km/h", "97.6%", "West", "0 km", 17.4325, 78.4072],
      ["CAM #406", "Madhapur IT Corridor", "11:15:18", "29 km/h", "96.9%", "North-West", "5.2 km", 17.4485, 78.3742],
    ],
  },
};

// Hop tuple → observation object (same shape as DEMO_OBSERVATIONS)
const toObservation = (h) => ({
  camera: h[0],
  name: h[1],
  time: h[2],
  speedLabel: h[3],
  confidence: parseFloat(h[4]),
  direction: h[5],
  distance: h[6],
  lat: h[7],
  lng: h[8],
});

const isDeviation = (v) => v.deviation && v.deviation !== "None" && !v.deviation.includes("Standard");

function FitRoute({ points, trigger }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    map.fitBounds(L.latLngBounds(points), { padding: [45, 45], maxZoom: 14, animate: true });
  }, [map, points, trigger]);
  return null;
}

const MARKER_STYLE = {
  active: { bg: "#06b6d4", size: 24 },
  visited: { bg: "#3b82f6", size: 16 },
  route: { bg: "#64748b", size: 14 },
  other: { bg: "#334155", size: 9 },
};

function buildCameraIcon(status) {
  const { bg, size } = MARKER_STYLE[status];
  const pulse = status === "active" ? `<div style="position:absolute;width:100%;height:100%;border-radius:50%;background:#06b6d4;animation:tracePulse 1.5s infinite"></div>` : "";
  const border = status === "other" ? "rgba(148,163,184,.6)" : "white";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">${pulse}<div style="position:relative;z-index:10;width:100%;height:100%;border-radius:50%;background:${bg};border:2px solid ${border};box-shadow:0 2px 8px rgba(0,0,0,.35);transition:all .3s ease"></div></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Built once — a new divIcon per render would make Leaflet replace every marker on each animation frame
const CAMERA_ICONS = Object.fromEntries(Object.keys(MARKER_STYLE).map((k) => [k, buildCameraIcon(k)]));

const VEHICLE_ICON = L.divIcon({
  className: "",
  html: `<div style="position:relative;width:20px;height:20px;display:flex;align-items:center;justify-content:center;">
          <div style="position:absolute;width:100%;height:100%;border-radius:50%;background:#f59e0b;animation:tracePulse 1s infinite"></div>
          <div style="position:relative;z-index:10;width:12px;height:12px;border-radius:50%;background:#ea580c;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.3);"></div>
         </div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const CANCELLED = Symbol("cancelled");

export default function TrackingPage({ navigate, openModal, params }) {
  const initialPlate = params?.plate && localVehicles[params.plate] ? params.plate : DEMO_PLATE;
  const [query, setQuery] = useState(params?.plate ?? DEMO_PLATE);
  const [plate, setPlate] = useState(initialPlate);
  const [notice, setNotice] = useState(params?.plate && !localVehicles[params.plate] ? params.plate : null);
  const [selected, setSelected] = useState(null);
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState(false);
  const [fit, setFit] = useState(0);
  const [vehicles, setVehiclesData] = useState(localVehicles);
  const apiLoaded = useRef(false);

  // Playback state — hop index is the single source of truth for map, timeline, hop strip and profile
  const [playbackState, setPlaybackState] = useState("idle"); // idle | resolving | playing | paused | complete
  const [currentHopIndex, setCurrentHopIndex] = useState(-1);
  const [segmentProgress, setSegmentProgress] = useState(0);
  const [vehiclePosition, setVehiclePosition] = useState(null);
  const [activePanel, setActivePanel] = useState(null); // 'ocr' | 'handoff' | 'reid' | null
  const [transition, setTransition] = useState(null); // { from, to } hop indices for hand-off / re-ID panels
  const [handoffStage, setHandoffStage] = useState("idle");
  const [identityProgress, setIdentityProgress] = useState(0);
  const [macroProgress, setMacroProgress] = useState(0);
  const [showGraph, setShowGraph] = useState(false);

  const runToken = useRef(0); // bumps cancel an in-flight animation run
  const resolveSeq = useRef(0); // bumps cancel a pending "resolving" start
  const mounted = useRef(true);
  const resumeFrom = useRef({ hop: -1, progress: 0 });

  useEffect(() => {
    if (apiLoaded.current) return;
    fetchVehicles().then((data) => {
      if (data) {
        setVehiclesData((prev) => ({ ...prev, ...data }));
        apiLoaded.current = true;
      }
    });
  }, []);

  const vehicle = vehicles[plate] ?? localVehicles[DEMO_PLATE];
  const isDemoVehicle = plate === DEMO_PLATE;
  const observations = useMemo(() => (isDemoVehicle ? DEMO_OBSERVATIONS : vehicle.hops.map(toObservation)), [isDemoVehicle, vehicle]);
  const points = useMemo(() => observations.map((o) => [o.lat, o.lng]), [observations]);

  // Refs let the async sequencer read the latest route without restarting
  const routeRef = useRef({ points, observations, isDemoVehicle });
  routeRef.current = { points, observations, isDemoVehicle };

  const cancelRun = useCallback(() => {
    runToken.current += 1;
    resolveSeq.current += 1;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runToken.current += 1; // stop any animation loop on unmount
    };
  }, []);

  const resetPlayback = useCallback(() => {
    cancelRun();
    resumeFrom.current = { hop: -1, progress: 0 };
    setPlaybackState("idle");
    setCurrentHopIndex(-1);
    setSegmentProgress(0);
    setVehiclePosition(null);
    setActivePanel(null);
    setTransition(null);
    setHandoffStage("idle");
    setIdentityProgress(0);
    setMacroProgress(0);
  }, [cancelRun]);

  // ── Sequencer ────────────────────────────────────────────────────
  const run = useCallback(async (startHop, startProgress = 0) => {
    const token = ++runToken.current;
    const alive = () => runToken.current === token;
    const fast = reducedMotion();
    const wait = (ms) =>
      new Promise((resolve, reject) => setTimeout(() => (alive() ? resolve() : reject(CANCELLED)), fast ? Math.min(ms, 250) : ms));

    // Smooth marker movement along one leg: a time-based ~30 fps loop. Progress comes from elapsed
    // time (not frame count), so a throttled/unpainted window only lowers smoothness — the vehicle
    // never freezes mid-leg the way a requestAnimationFrame-only loop would.
    const move = (from, to, p0) =>
      new Promise((resolve, reject) => {
        const { points: pts } = routeRef.current;
        const a = pts[from];
        const b = pts[to];
        const duration = fast ? 0 : 2200 * (1 - p0);
        const start = performance.now();
        const frame = () => {
          if (!alive()) return reject(CANCELLED);
          const elapsed = performance.now() - start;
          const t = duration ? Math.min(1, p0 + (elapsed / duration) * (1 - p0)) : 1;
          resumeFrom.current = { hop: from, progress: t };
          setSegmentProgress(t === 1 ? 0 : t);
          setVehiclePosition([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
          if (t < 1) setTimeout(frame, 33);
          else resolve();
        };
        frame();
      });

    try {
      const { observations: obs, isDemoVehicle: demo, points: pts } = routeRef.current;
      setPlaybackState("playing");
      let i = startHop;

      if (i < 0) {
        // First detection: plate read at the first camera
        setCurrentHopIndex(0);
        setVehiclePosition(pts[0]);
        resumeFrom.current = { hop: 0, progress: 0 };
        if (demo) {
          setActivePanel("ocr");
          setIdentityProgress(1);
          setMacroProgress(1);
          await wait(1500);
          setIdentityProgress(2);
          setMacroProgress(2);
          await wait(1300);
          setIdentityProgress(3);
          setMacroProgress(3);
          await wait(900);
        } else {
          await wait(800);
        }
        i = 0;
      }

      let p0 = startProgress;
      while (i < obs.length - 1) {
        const next = i + 1;
        if (demo) {
          // Hand-off: predict candidate cameras while the vehicle travels
          setTransition({ from: i, to: next });
          setActivePanel("handoff");
          setIdentityProgress(0);
          setMacroProgress(1);
          if (!p0) {
            setHandoffStage("leaving");
            await wait(600);
          }
          setHandoffStage("searching");
          setMacroProgress(2);
        }
        await move(i, next, p0);
        p0 = 0;
        // Arrival: the next camera reads the plate — everything now points at this hop
        setCurrentHopIndex(next);
        resumeFrom.current = { hop: next, progress: 0 };
        i = next;
        if (demo) {
          setHandoffStage("found");
          await wait(600);
          setHandoffStage("confirmed");
          await wait(600);
          setActivePanel("reid");
          setIdentityProgress(2);
          setMacroProgress(3);
          await wait(1800);
          setIdentityProgress(3);
          setMacroProgress(4);
        } else {
          await wait(700);
        }
      }

      setActivePanel(null);
      setTransition(null);
      setPlaybackState("complete");
    } catch (err) {
      if (err !== CANCELLED) throw err;
    }
  }, []);

  // TRACE VEHICLE: brief resolve (≈700 ms) → focus route → play the journey
  const trace = useCallback(
    (targetPlate) => {
      resetPlayback();
      if (targetPlate !== plate) {
        setPlate(targetPlate);
        setSelected(null);
      }
      setNotice(null);
      setPlaybackState("resolving");
      setFit((v) => v + 1);
      const seq = resolveSeq.current;
      setTimeout(() => {
        if (mounted.current && resolveSeq.current === seq) run(-1);
      }, reducedMotion() ? 150 : 700);
    },
    [plate, resetPlayback, run]
  );

  // Arriving from another module with a plate (Alerts → Trace, Cameras → Trace): start tracing it
  const autoTraced = useRef(false);
  useEffect(() => {
    if (autoTraced.current || !params?.plate || !localVehicles[params.plate]) return;
    autoTraced.current = true;
    trace(params.plate);
  }, [params, trace]);

  const handleTraceSubmit = (e) => {
    e.preventDefault();
    const q = query.trim().toUpperCase();
    if (!q) return;
    const key = vehicles[q] ? q : Object.keys(vehicles).find((p) => p.includes(q));
    if (!key) {
      setNotice(q);
      return;
    }
    setQuery(key);
    trace(key);
  };

  const selectVehicle = (p) => {
    resetPlayback();
    setPlate(p);
    setQuery(p);
    setSelected(null);
    setNotice(null);
    setFit((v) => v + 1);
  };

  const pausePlayback = () => {
    cancelRun();
    setPlaybackState("paused");
  };

  const resumePlayback = () => {
    if (playbackState === "complete" || playbackState === "idle") return trace(plate);
    run(resumeFrom.current.hop, resumeFrom.current.progress);
  };

  const seekToHop = (index) => {
    cancelRun();
    resumeFrom.current = { hop: index, progress: 0 };
    setCurrentHopIndex(index);
    setSegmentProgress(0);
    setVehiclePosition(points[index]);
    setActivePanel(null);
    setTransition(null);
    setPlaybackState(index === points.length - 1 ? "complete" : "paused");
  };

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
    const rows = vehicle.hops.map((h) => `"${vehicle.plate}","${h[0]}","${h[1]}","${h[2]}","${h[3]}","${h[4]}","${h[5]}","${h[6]}",${h[7]},${h[8]}`);
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${vehicle.plate}-trajectory.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 1600);
  };

  // ── Derived view state ───────────────────────────────────────────
  const hop = currentHopIndex;
  const started = playbackState !== "idle" && playbackState !== "resolving";
  const revealedUpTo = started ? (playbackState === "complete" ? observations.length - 1 : hop) : observations.length - 1;
  const routeCams = observations.map((o) => o.camera);
  const deviationSegs = vehicle.deviationSegs ?? [];

  const travelled = useMemo(() => {
    if (!started) return points;
    if (hop < 0) return [];
    const base = points.slice(0, hop + 1);
    return vehiclePosition && segmentProgress > 0 ? [...base, vehiclePosition] : base;
  }, [started, points, hop, vehiclePosition, segmentProgress]);

  const cameraStatus = (camId) => {
    const idx = routeCams.indexOf(camId);
    if (idx === -1) return "other";
    if (!started) return "route";
    if (idx === hop && playbackState !== "complete") return "active";
    if (idx <= hop || playbackState === "complete") return "visited";
    return "route";
  };

  const hopState = (i) => {
    if (!started) return "idle";
    if (playbackState === "complete" || i < hop) return "done";
    if (i === hop) return "active";
    return "upcoming";
  };

  const currentObservation = started && hop >= 0 ? observations[hop] : null;
  const panelFrom = transition ? observations[transition.from]?.camera : null;
  const panelTo = transition ? observations[transition.to]?.camera : null;
  const showDemoPanel = isDemoVehicle && activePanel && (playbackState === "playing" || playbackState === "paused");
  const deviating = isDeviation(vehicle);

  return (
    <div className="tracking-page flex w-full flex-col gap-5 pb-10">
      <div>
        <Navbar page="tracking" navigate={navigate} openModal={openModal} />
      </div>

      {/* 1. Vehicle / Plate Search Header */}
      <section className="fade-up rounded-[24px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full bg-blue-600 ${playbackState === "playing" ? "tn-pulse tn-pulse--blue" : ""}`} />
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-blue-600">Module 02 · Spatial-Temporal Trajectory Tracking</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight">Single Plate Trajectory Reconstructor</h1>
            <p className="mt-1 text-xs text-gray-500">Search plates, view camera hops, and verify multi-camera re-identification.</p>
          </div>

          <form onSubmit={handleTraceSubmit} className="flex w-full gap-2 md:w-auto" role="search">
            <div className="relative min-w-0 flex-1 md:flex-none">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="License plate..."
                aria-label="License plate"
                className="w-full md:w-[210px] rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-8 text-xs font-bold font-mono outline-none focus:border-blue-500"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear plate" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={playbackState === "resolving"}
              className="tn-press flex shrink-0 md:min-w-[140px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-blue-700"
              aria-live="polite"
            >
              {playbackState === "resolving" ? (
                <>
                  <span className="tn-spinner" aria-hidden="true" /> TRACING…
                </>
              ) : (
                <>
                  <Navigation size={13} /> TRACE VEHICLE
                </>
              )}
            </button>
          </form>
        </div>

        {notice && (
          <p className="tn-new-item mt-3 rounded-xl border border-amber-500/30 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700" role="status">
            No stored trajectory for <span className="font-mono">{notice}</span> yet — it will appear once two or more cameras read the plate.
          </p>
        )}

        {/* Quick Sample Plates */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400">Sample Plates:</span>
          {Object.keys(vehicles).map((p) => (
            <button
              key={p}
              onClick={() => selectVehicle(p)}
              aria-pressed={plate === p}
              className={`tn-press rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold ${plate === p ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {p}
            </button>
          ))}
        </div>
      </section>

      {/* Stats Summary */}
      <div key={`stats-${plate}`} className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat icon={Layers} label="Cameras" value={vehicle.stats[0]} delay="delay-100" />
        <Stat icon={Navigation} label="Distance" value={vehicle.stats[1]} delay="delay-100" />
        <Stat icon={Clock} label="Travel Time" value={vehicle.stats[2]} delay="delay-150" />
        <Stat icon={Gauge} label="Average Speed" value={vehicle.stats[3]} delay="delay-150" />
        <Stat icon={ShieldAlert} label="OCR Match" value={vehicle.confidence} blue delay="delay-200" />
      </div>

      {/* One plate → multiple cameras → complete trajectory (follows the vehicle's position) */}
      <section aria-label="Camera sequence" className="fade-up delay-150 overflow-x-auto rounded-[20px] border border-white/80 bg-white/80 px-4 py-3">
        <ol className="flex min-w-max items-center gap-2 py-1">
          <li className="flex items-center gap-2 pr-1">
            <span className="rounded-lg bg-blue-600 px-2.5 py-1 font-mono text-[11px] font-black text-white">{vehicle.plate}</span>
            <ArrowRight size={14} className="text-gray-400" aria-hidden="true" />
          </li>
          {observations.map((o, i) => {
            const st = hopState(i);
            return (
              <li key={o.camera + i} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => seekToHop(i)}
                  aria-current={st === "active" ? "step" : undefined}
                  className={`tn-hop tn-hop--${st} flex flex-col rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-left`}
                >
                  <span className="flex items-center gap-1 font-mono text-[10px] font-black text-blue-600">
                    {st === "done" && <CheckIcon size={10} className="text-emerald-500" aria-hidden="true" />}
                    {o.camera.replace(" #", "-")}
                  </span>
                  <span className="text-[10px] font-bold text-gray-500">
                    {o.name} · {o.time}
                  </span>
                </button>
                {i < observations.length - 1 && (
                  <span className={`flex items-center gap-1 text-[10px] font-bold ${deviationSegs.includes(i) ? "text-amber-500" : "text-gray-400"}`}>
                    <ArrowRight size={14} aria-hidden="true" /> {observations[i + 1].distance}
                  </span>
                )}
              </li>
            );
          })}
          <li className="pl-2 text-[10px] font-extrabold uppercase tracking-wider text-emerald-600">
            = {vehicle.stats[1]} trajectory in {vehicle.stats[2]}
          </li>
        </ol>
      </section>

      {/* Main Map & Side Panel */}
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <section className="fade-up delay-200 flex h-[640px] min-w-0 flex-col rounded-[26px] border border-white/80 bg-white/70 p-3 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <MapPin size={15} className="text-blue-600" />
              <h3 className="text-[10px] font-extrabold uppercase tracking-wider">GIS Trajectory Map</h3>
              {currentObservation && (
                <span key={hop} className="tn-new-item rounded-md bg-cyan-500/15 px-2 py-0.5 font-mono text-[10px] font-black text-cyan-500">
                  @ {currentObservation.camera.replace(" #", "-")} · {currentObservation.time}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowGraph(!showGraph)}
                aria-pressed={showGraph}
                data-tip="Show the camera network graph"
                data-tip-pos="bottom"
                className="tn-press flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[9px] font-bold text-gray-600 hover:bg-gray-50"
              >
                <Network size={11} className={showGraph ? "text-blue-600" : ""} /> Graph
              </button>
              <button
                onClick={() => setFit((v) => v + 1)}
                data-tip="Fit the whole route in view"
                data-tip-pos="bottom"
                className="tn-press flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[9px] font-bold text-gray-600 hover:bg-gray-50"
              >
                <Target size={11} /> Fit
              </button>
            </div>
          </div>

          <div className="relative flex-1 overflow-hidden rounded-[18px] border border-gray-200" role="region" aria-label={`Trajectory map for ${vehicle.plate}`}>
            <MapBoundary>
              <MapContainer center={points[0]} zoom={13} scrollWheelZoom style={{ width: "100%", height: "100%" }}>
                <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <FitRoute points={points} trigger={fit} />

                {/* Full reconstructed route (subdued) */}
                <Polyline positions={points} pathOptions={{ color: "#9ca3af", weight: 3, opacity: 0.45, dashArray: "4 8" }} />

                {/* Travelled route — reveals progressively during playback */}
                {travelled.length > 1 && <Polyline positions={travelled} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.9, dashArray: "8 7" }} />}

                {/* Deviation legs only (not the whole route), once the vehicle has driven them */}
                {deviationSegs
                  .filter((s) => s + 1 <= revealedUpTo)
                  .map((s) => (
                    <Polyline key={`dev-${s}`} positions={[points[s], points[s + 1]]} pathOptions={{ color: "#f59e0b", weight: 5, opacity: 0.85 }} />
                  ))}

                {/* Camera nodes from the shared registry */}
                {cameraRegistry.map((cam) => {
                  const status = cameraStatus(cam.id);
                  return (
                    <Marker key={cam.id} position={[cam.lat, cam.lng]} icon={CAMERA_ICONS[status]} zIndexOffset={status === "active" ? 900 : status === "other" ? -100 : 0}>
                      <Popup>
                        <div className="min-w-[170px] p-1">
                          <b className="font-mono text-[10px] text-blue-600">{cam.code}</b>
                          <p className="mt-1 text-xs font-bold">{cam.name}</p>
                          {status === "other" && <p className="text-[10px] text-gray-500">Not on this trajectory</p>}
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}

                {/* Moving vehicle */}
                {started && vehiclePosition && <Marker position={vehiclePosition} icon={VEHICLE_ICON} zIndexOffset={1000} />}
              </MapContainer>
            </MapBoundary>
          </div>
        </section>

        {/* Right Side Panels */}
        <div className="fade-up delay-300 flex h-[640px] min-w-0 flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar">
          <VehicleIdentityCard
            vehicle={
              isDemoVehicle
                ? DEMO_VEHICLE
                : { plate: vehicle.plate, globalId: vehicle.globalId ?? "—", vehicleType: vehicle.type, vehicleColor: vehicle.color }
            }
            currentObservation={currentObservation}
            isTracking={playbackState === "playing"}
          />

          {/* Demo vehicle: OCR → hand-off → Re-ID evidence panels during playback */}
          {showDemoPanel && activePanel === "ocr" && <OCRPanel ocrData={DEMO_OCR_EVIDENCE} isActive />}
          {showDemoPanel && activePanel === "handoff" && panelFrom && (
            <CameraHandoff
              fromCamera={panelFrom}
              candidates={DEMO_HANDOFF_CANDIDATES.find((c) => c.from === panelFrom)?.candidates || []}
              confirmedCamera={DEMO_HANDOFF_CANDIDATES.find((c) => c.from === panelFrom)?.confirmed}
              stage={handoffStage}
              isActive
            />
          )}
          {showDemoPanel && activePanel === "reid" && panelFrom && (
            <ReIDPanel
              matchData={DEMO_REID_TRANSITIONS.find((t) => t.from === panelFrom && t.to === panelTo)}
              fromCamera={panelFrom}
              toCamera={panelTo}
              globalId={DEMO_GLOBAL_ID}
              isActive
            />
          )}

          {!showDemoPanel && (
            <section className="rounded-[26px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400">Vehicle Profile</span>
                <span className={`rounded-full border px-2.5 py-1 text-[9px] font-extrabold ${vehicle.badge}`}>{vehicle.status}</span>
              </div>
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black font-mono">{vehicle.plate}</h2>
                <button onClick={copyPlate} aria-label="Copy plate" data-tip="Copy plate" className="tn-press rounded-lg border border-gray-200 p-2 text-gray-400 hover:bg-gray-50">
                  {copied ? <CheckCircle2 size={15} className="text-emerald-500" /> : <Copy size={15} />}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 border-y border-gray-100 py-3">
                <Info label="Type" value={vehicle.type} />
                <Info label="Color" value={vehicle.color} />
                <Info label="OCR" value={vehicle.confidence} blue />
              </div>
              <div className="mt-3 rounded-xl bg-gray-50 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Activity size={13} className="text-blue-600" />
                  <span className="text-[9px] font-extrabold uppercase text-gray-500">Detection Window</span>
                </div>
                <div className="flex justify-between">
                  <Info label="First" value={observations[0].time} />
                  <Info label="Latest" value={currentObservation ? currentObservation.time : observations.at(-1).time} right />
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={exportCSV} className="tn-press flex items-center justify-center gap-1.5 rounded-xl bg-gray-900 py-2.5 text-[10px] font-bold text-white hover:bg-gray-800">
                  {exported ? <><CheckCircle2 size={13} /> Exported</> : <><Download size={13} /> Export CSV</>}
                </button>
              </div>
            </section>
          )}

          {/* Route analysis — the actual route reveals hop by hop; only deviation legs are highlighted */}
          <section className={`rounded-[26px] border p-5 ${deviating ? "border-amber-200 bg-amber-50/70" : "border-emerald-200 bg-emerald-50/60"}`}>
            <div className="mb-3 flex items-center gap-2">
              {deviating ? <ShieldAlert size={15} className="text-amber-600" /> : <CheckCircle2 size={15} className="text-emerald-600" />}
              <h3 className="text-[10px] font-extrabold uppercase tracking-wider">Route Analysis</h3>
              {playbackState === "playing" && <span className="ml-auto text-[9px] font-bold uppercase tracking-wider text-blue-500">analysing…</span>}
            </div>
            <Info label="Expected Route" value={vehicle.expected} />
            <div className="mt-3">
              <p className="text-[8px] font-extrabold uppercase tracking-wider text-gray-400">Actual Route</p>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {observations.map((o, i) => (
                  <span key={o.camera + i} className="flex items-center gap-1">
                    <span
                      className={`tn-route-chip rounded-md border border-blue-500/30 px-1.5 py-0.5 text-[10px] font-bold text-blue-600 ${
                        i > revealedUpTo ? "is-hidden" : ""
                      } ${deviationSegs.includes(i - 1) ? "is-deviation" : ""}`}
                    >
                      {o.name.replace(/ (Main Road|Metro Station|IT Corridor|Flyover|Junction|Checkpost|Colony Phase 1|Bypass Link|X Roads)$/, "")}
                    </span>
                    {i < observations.length - 1 && <ArrowRight size={10} className={`text-gray-400 ${i + 1 > revealedUpTo ? "opacity-30" : ""}`} aria-hidden="true" />}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-3 border-t border-gray-200/70 pt-3">
              <Info label="Deviation Analysis" value={revealedUpTo >= observations.length - 1 || !deviationSegs.length ? vehicle.deviation : "Evaluating route…"} />
            </div>
          </section>
        </div>
      </div>

      <JourneyTimeline
        observations={observations}
        currentIndex={started ? hop : -1}
        segmentProgress={segmentProgress}
        isPlaying={playbackState === "playing" || playbackState === "resolving"}
        isComplete={playbackState === "complete"}
        deviationSegs={deviationSegs}
        onSeek={seekToHop}
        onPlay={resumePlayback}
        onPause={pausePlayback}
        onRestart={() => trace(plate)}
      />

      {showGraph && (
        <CameraGraph
          activeRoute={started ? routeCams.slice(0, Math.max(1, hop + 1)) : routeCams}
          currentCamera={currentObservation?.camera ?? null}
        />
      )}

      {isDemoVehicle && showDemoPanel && <ParallelProcessing isActive identityProgress={identityProgress} macroProgress={macroProgress} />}

      {/* 5. Chronological Movement Timeline */}
      {(playbackState === "complete" || (!isDemoVehicle && playbackState === "idle")) && (
        <section className="fade-up rounded-[26px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Clock size={15} className="text-blue-600" />
                <h3 className="text-sm font-black">Movement Timeline</h3>
              </div>
              <p className="mt-1 text-[10px] text-gray-400">Chronological camera detections across the vehicle journey</p>
            </div>
          </div>

          <div className="tn-list-in grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {vehicle.hops.map((h, i) => (
              <button
                key={h[0] + i}
                onClick={() => setSelected(h)}
                aria-pressed={selected?.[0] === h[0]}
                className={`tn-card-hover relative rounded-2xl border p-4 text-left ${selected?.[0] === h[0] ? "border-blue-200 bg-blue-50" : "border-gray-100 bg-gray-50/70 hover:bg-white"}`}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${i === 0 ? "bg-green-500" : i === vehicle.hops.length - 1 ? "bg-red-500" : "bg-blue-600"}`} />
                    <span className="font-mono text-[10px] font-black text-blue-600">{cameraById[h[0]]?.code ?? h[0]}</span>
                  </div>
                  <span className="text-[9px] font-bold text-gray-400">{h[2]}</span>
                </div>
                <h4 className="text-xs font-black text-gray-800">{h[1]}</h4>
                <div className="mt-3 grid grid-cols-3 border-t border-gray-200/60 pt-3 text-[8px] font-bold text-gray-500">
                  <span>{h[3]}</span>
                  <span>{h[5]}</span>
                  <span>
                    OCR <b className="text-emerald-600">{h[4]}</b>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 6. Selected Detection Details */}
      {selected && (playbackState === "complete" || (!isDemoVehicle && playbackState === "idle")) && (
        <section className="fade-up rounded-[22px] border border-blue-100 bg-blue-50/70 p-5">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
            <div>
              <div className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-widest text-blue-600">
                <Target size={13} /> Selected Detection Details
              </div>
              <h3 className="mt-1 text-lg font-black">{cameraById[selected[0]]?.code ?? selected[0]}</h3>
              <p className="text-[10px] font-semibold text-gray-500">{selected[1]}</p>
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
      {(playbackState === "complete" || (!isDemoVehicle && playbackState === "idle")) && (
        <section className="fade-up rounded-[26px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap size={15} className="text-blue-600" />
              <h2 className="text-sm font-black">Tracking Intelligence & Re-ID</h2>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-[9px] font-extrabold text-blue-600">AI ANALYSIS</span>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-500">Re-ID Confidence</span>
                <span className="text-lg font-black text-blue-600">{vehicle.reid}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                <div className="h-full rounded-full bg-blue-600" style={{ width: vehicle.reid }} />
              </div>
              <p className="mt-3 text-[9px] leading-4 text-gray-500">
                Vehicle identity verified across <b className="text-gray-700">{vehicle.stats[0]} camera nodes</b>.
              </p>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
              <div className="mb-4 flex items-center gap-2">
                <Activity size={14} className="text-blue-600" />
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-500">Movement Metrics</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Mini label="Transitions" value={vehicle.transitions} />
                <Mini label="Distance" value={vehicle.stats[1]} />
                <Mini label="Fastest" value={vehicle.fastest} />
                <Mini label="Slowest" value={vehicle.slowest} />
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
              <div className="mb-4 flex items-center gap-2">
                <ShieldAlert size={14} className="text-blue-600" />
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-500">AI Findings</span>
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

function Stat({ icon: Icon, label, value, blue, delay = "" }) {
  return (
    <div className={`tn-kpi fade-up ${delay} flex items-center gap-3 rounded-2xl border border-white/80 bg-white/80 p-3.5 shadow-[0_6px_20px_rgba(0,0,0,.03)]`}>
      <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${blue ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-600"}`}>
        <Icon size={15} />
      </div>
      <div>
        <p className="text-[8px] font-extrabold uppercase tracking-wider text-gray-400">{label}</p>
        <p className={`tn-kpi-value text-sm font-black ${blue ? "text-blue-600" : ""}`}>{value}</p>
      </div>
    </div>
  );
}

function Info({ label, value, blue, right }) {
  return (
    <div className={right ? "text-right" : ""}>
      <p className="text-[8px] font-extrabold uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`mt-0.5 text-[10px] font-bold ${blue ? "text-blue-600" : "text-gray-800"}`}>{value}</p>
    </div>
  );
}

function Mini({ label, value }) {
  return (
    <div>
      <p className="text-[8px] font-extrabold uppercase text-gray-400">{label}</p>
      <p className="mt-0.5 text-xs font-black text-gray-800">{value}</p>
    </div>
  );
}

function Check({ text }) {
  return (
    <div className="flex items-start gap-2 text-[9px] font-bold text-emerald-600">
      <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}
