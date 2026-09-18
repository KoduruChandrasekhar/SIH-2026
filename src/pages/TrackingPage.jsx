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
  Play
} from "lucide-react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import Navbar from "../components/Navbar";
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
  formatConfidence
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
    badge: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    expected: "Kukatpally → Balanagar → Madhapur",
    actual: "Kukatpally → Begumpet → Madhapur",
    deviation: "Yes (+3.2 km detour via Begumpet)",
    stats: ["4", "12.8 km", "24 min", "42 km/h"],
    reid: "97.8%",
    transitions: "3",
    fastest: "48 km/h",
    slowest: "28 km/h",
    hops: DEMO_OBSERVATIONS.map(obs => [
      obs.camera,
      obs.name,
      obs.time,
      obs.speedLabel,
      formatConfidence(obs.confidence),
      obs.direction,
      obs.distance,
      obs.lat,
      obs.lng
    ]),
  },
  TS08EJ4892: {
    plate: "TS08EJ4892",
    type: "Sedan",
    color: "Black",
    confidence: "96.4%",
    status: "STALE",
    badge: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    expected: "Balanagar → Kukatpally",
    actual: "Balanagar → Kukatpally",
    deviation: "None (Standard Corridor)",
    stats: ["3", "8.4 km", "35 min", "36 km/h"],
    reid: "95.6%",
    transitions: "2",
    fastest: "48 km/h",
    slowest: "28 km/h",
    hops: [
      ["CAM #403", "Balanagar Main Road Circle", "16:15:20", "48 km/h", "96.4%", "South", "0 km", 17.4682, 78.4357],
      ["CAM #402", "Kukatpally Metro Station", "16:32:45", "28 km/h", "94.2%", "North", "3.8 km", 17.4947, 78.3996],
      ["CAM #401", "Kukatpally Flyover Junction", "16:50:10", "34 km/h", "95.1%", "North-West", "4.6 km", 17.4985, 78.3912],
    ],
  },
  TS09EE9911: {
    plate: "TS09EE9911",
    type: "SUV",
    color: "White",
    confidence: "98.1%",
    status: "ALERT",
    badge: "bg-red-500/10 text-red-600 border-red-500/20",
    expected: "Cyberabad → Miyapur",
    actual: "Cyberabad → JNTU → Miyapur",
    deviation: "Suspected Evasion Route",
    stats: ["3", "15.2 km", "70 min", "62 km/h"],
    reid: "96.9%",
    transitions: "2",
    fastest: "70 km/h",
    slowest: "52 km/h",
    hops: [
      ["CAM #101", "Cyberabad IT Corridor", "14:10:05", "65 km/h", "98.1%", "West", "0 km", 17.4485, 78.3742],
      ["CAM #105", "JNTU Junction", "14:45:20", "52 km/h", "97.5%", "North", "6.1 km", 17.4925, 78.393],
      ["CAM #112", "Miyapur Metro Station", "15:20:00", "70 km/h", "96.8%", "North-West", "9.1 km", 17.4968, 78.3522],
    ],
  },
  AP28BY5521: {
    plate: "AP28BY5521",
    type: "Sports Coupe",
    color: "Red",
    confidence: "99.0%",
    status: "COMPLETED",
    badge: "bg-gray-500/10 text-gray-600 border-gray-500/20",
    expected: "Begumpet → Ameerpet",
    actual: "Begumpet → Ameerpet",
    deviation: "None",
    stats: ["2", "4.5 km", "17 min", "88 km/h"],
    reid: "98.4%",
    transitions: "1",
    fastest: "92 km/h",
    slowest: "84 km/h",
    hops: [
      ["CAM #201", "Begumpet Flyover North", "11:05:12", "92 km/h", "99.0%", "South", "0 km", 17.4439, 78.4684],
      ["CAM #204", "Ameerpet Crossroads", "11:22:40", "84 km/h", "97.2%", "West", "4.5 km", 17.4375, 78.4482],
    ],
  },
};

function FitRoute({ points, trigger }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    map.fitBounds(L.latLngBounds(points), { padding: [35, 35], maxZoom: 14, animate: true });
  }, [map, points, trigger]);
  return null;
}

function cameraMarkerIcon(status) {
  let bg = status === 'active' ? '#06b6d4' : status === 'visited' ? '#3b82f6' : '#6b7280';
  let size = status === 'active' ? 24 : status === 'visited' ? 16 : 12;
  let pulseHtml = status === 'active' ? `<div style="position:absolute;width:100%;height:100%;border-radius:50%;background:#06b6d4;animation:tracePulse 1.5s infinite"></div>` : '';
  
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">
            ${pulseHtml}
            <div style="position:relative;z-index:10;width:100%;height:100%;border-radius:50%;background:${bg};border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.25);"></div>
           </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function vehicleMarkerIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:20px;height:20px;display:flex;align-items:center;justify-content:center;">
            <div style="position:absolute;width:100%;height:100%;border-radius:50%;background:#f59e0b;animation:tracePulse 1s infinite"></div>
            <div style="position:relative;z-index:10;width:12px;height:12px;border-radius:50%;background:#ea580c;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.3);"></div>
           </div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

export default function TrackingPage({ navigate, openModal }) {
  const [query, setQuery] = useState(DEMO_PLATE);
  const [plate, setPlate] = useState(DEMO_PLATE);
  const [selected, setSelected] = useState(null);
  const [live, setLive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fit, setFit] = useState(0);
  const [vehicles, setVehiclesData] = useState(localVehicles);
  const apiLoaded = useRef(false);

  // New states for advanced tracking
  const [playbackState, setPlaybackState] = useState('idle'); // idle | playing | paused | complete
  const [currentHopIndex, setCurrentHopIndex] = useState(-1);
  const [segmentProgress, setSegmentProgress] = useState(0);
  const [visiblePolyline, setVisiblePolyline] = useState([]);
  const [vehiclePosition, setVehiclePosition] = useState(null);
  const [activePanel, setActivePanel] = useState(null); // 'reid' | 'ocr' | 'handoff' | null
  const [handoffStage, setHandoffStage] = useState('idle');
  const [reidActive, setReidActive] = useState(false);
  const [ocrActive, setOcrActive] = useState(false);
  const [parallelActive, setParallelActive] = useState(false);
  const [identityProgress, setIdentityProgress] = useState(0);
  const [macroProgress, setMacroProgress] = useState(0);
  const [showGraph, setShowGraph] = useState(false);
  const [isDemoVehicle, setIsDemoVehicle] = useState(true);

  // Refs for animation timers
  const playbackTimer = useRef(null);
  const animationTimer = useRef(null);

  useEffect(() => {
    if (apiLoaded.current) return;
    fetchVehicles().then((data) => {
      if (data) {
        setVehiclesData(data);
        apiLoaded.current = true;
      }
    });
  }, []);

  const vehicle = vehicles[plate];
  const points = useMemo(() => vehicle.hops.map((h) => [h[7], h[8]]), [vehicle]);

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
    setFit((v) => v + 1);
  };

  const selectVehicle = (p) => {
    setPlate(p);
    setQuery(p);
    setSelected(null);
    setIsDemoVehicle(p === DEMO_PLATE);
    resetPlayback();
    setFit((v) => v + 1);
  };

  const resetPlayback = useCallback(() => {
    setPlaybackState('idle');
    setCurrentHopIndex(-1);
    setSegmentProgress(0);
    setVisiblePolyline([]);
    setVehiclePosition(null);
    setActivePanel(null);
    setHandoffStage('idle');
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
    if (playbackState === 'complete') {
      resetPlayback();
    }
    setPlaybackState('playing');
    setFit(v => v + 1); // Reset map view
  };

  const pausePlayback = () => {
    setPlaybackState('paused');
    clearTimeout(playbackTimer.current);
    clearInterval(animationTimer.current);
  };

  const seekToHop = (index) => {
    resetPlayback();
    setCurrentHopIndex(index);
    setSegmentProgress(0);
    setVisiblePolyline(points.slice(0, index + 1));
    setVehiclePosition(points[index]);
    setPlaybackState('paused');
  };

  // Main playback logic loop
  useEffect(() => {
    if (playbackState !== 'playing' || !isDemoVehicle) return;

    const playNextHop = () => {
      let nextIndex = currentHopIndex + 1;
      
      if (nextIndex >= DEMO_OBSERVATIONS.length) {
        setPlaybackState('complete');
        setParallelActive(false);
        setActivePanel(null);
        return;
      }

      const isFirstHop = nextIndex === 0;

      // Phase 1: Camera Handoff (if not first)
      if (!isFirstHop) {
        setActivePanel('handoff');
        setHandoffStage('leaving');
        setParallelActive(true);
        setIdentityProgress(0);
        setMacroProgress(1);

        playbackTimer.current = setTimeout(() => {
          setHandoffStage('searching');
          setMacroProgress(2);
          
          playbackTimer.current = setTimeout(() => {
            setHandoffStage('found');
            
            playbackTimer.current = setTimeout(() => {
              setHandoffStage('confirmed');
              
              playbackTimer.current = setTimeout(() => {
                startReIDPhase(nextIndex);
              }, 1000);
            }, 800);
          }, 1500);
        }, 1000);
      } else {
        // First hop setup
        setCurrentHopIndex(0);
        setVisiblePolyline([points[0]]);
        setVehiclePosition(points[0]);
        setParallelActive(true);
        setIdentityProgress(1);
        setMacroProgress(1);
        setActivePanel('ocr');
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
      setActivePanel('reid');
      setReidActive(true);
      setIdentityProgress(2);
      setMacroProgress(3);

      playbackTimer.current = setTimeout(() => {
        setIdentityProgress(3);
        setMacroProgress(4);
        
        // Start movement animation
        animateMovement(currentHopIndex, nextIndex);
      }, 3000); // ReID takes about 3s
    };

    const animateMovement = (fromIdx, toIdx) => {
      setActivePanel(null);
      setCurrentHopIndex(toIdx);
      
      const startPt = points[fromIdx];
      const endPt = points[toIdx];
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
          setVisiblePolyline(points.slice(0, toIdx + 1));
          setVehiclePosition(endPt);
          
          playbackTimer.current = setTimeout(() => {
            playNextHop();
          }, 1000);
        } else {
          setSegmentProgress(progress);
          const currentLat = startPt[0] + (endPt[0] - startPt[0]) * progress;
          const currentLng = startPt[1] + (endPt[1] - startPt[1]) * progress;
          setVehiclePosition([currentLat, currentLng]);
          
          // Progressive polyline
          setVisiblePolyline([...points.slice(0, fromIdx + 1), [currentLat, currentLng]]);
        }
      }, 20);
    };

    // Kick off if just started
    if (currentHopIndex === -1 && segmentProgress === 0) {
      playNextHop();
    } else if (currentHopIndex >= 0 && currentHopIndex < DEMO_OBSERVATIONS.length - 1 && segmentProgress === 0) {
      playNextHop();
    }

    return () => {
      clearTimeout(playbackTimer.current);
      clearInterval(animationTimer.current);
    };
  }, [playbackState, currentHopIndex, isDemoVehicle, points]);


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
    const rows = vehicle.hops.map((h) => `"${vehicle.plate}","${h[0]}","${h[1]}","${h[2]}","${h[3]}","${h[4]}","${h[5]}","${h[6]}",${h[7]},${h[8]}`);
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${vehicle.plate}-trajectory.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Helper for tracking page map markers
  const getCameraStatus = (camId) => {
    if (!isDemoVehicle) return vehicle.hops.some(h => h[0] === camId) ? 'visited' : 'unvisited';
    
    const obsIndex = DEMO_OBSERVATIONS.findIndex(o => o.camera === camId);
    if (obsIndex === -1) return 'unvisited';
    
    if (obsIndex === currentHopIndex) return 'active';
    if (obsIndex < currentHopIndex || playbackState === 'complete') return 'visited';
    return 'unvisited';
  };

  return (
    <div className="tracking-page flex w-full flex-col gap-5 pb-10">
      <div className="fade-up">
        <Navbar page="tracking" navigate={navigate} openModal={openModal} />
      </div>

      {/* 1. Vehicle / Plate Search Header */}
      <section className="fade-up delay-100 rounded-[24px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="trace-live-dot h-2.5 w-2.5 rounded-full bg-blue-600" />
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-blue-600">
                Module 02 · Spatial-Temporal Trajectory Tracking
              </span>
            </div>
            <h1 className="text-2xl font-black tracking-tight">Single Plate Trajectory Reconstructor</h1>
            <p className="mt-1 text-xs text-gray-500">Search plates, view camera hops, and verify multi-camera re-identification.</p>
          </div>

          <form onSubmit={search} className="flex gap-2">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="License plate..."
                className="w-[210px] rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-8 text-xs font-bold font-mono outline-none focus:border-blue-500"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                  <X size={13} />
                </button>
              )}
            </div>
            <button 
              type="button" 
              onClick={startPlayback}
              className={`rounded-xl px-5 py-2.5 text-xs font-bold text-white transition-all flex items-center gap-2 ${
                playbackState === 'playing' ? 'bg-amber-500 hover:bg-amber-600 animate-pulse' :
                playbackState === 'complete' ? 'bg-emerald-600 hover:bg-emerald-700' :
                'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {playbackState === 'playing' ? (
                <>TRACING...</>
              ) : playbackState === 'complete' ? (
                <>REPLAY JOURNEY</>
              ) : (
                <>TRACE VEHICLE</>
              )}
            </button>
          </form>
        </div>

        {/* Quick Sample Plates */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400">Sample Plates:</span>
          {Object.keys(vehicles).map((p) => (
            <button
              key={p}
              onClick={() => selectVehicle(p)}
              className={`rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold ${plate === p ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
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
        <section className="fade-up delay-200 flex h-[640px] flex-col rounded-[26px] border border-white/80 bg-white/70 p-3 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <MapPin size={15} className="text-blue-600" />
              <h3 className="text-[10px] font-extrabold uppercase tracking-wider">GIS Trajectory Map</h3>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowGraph(!showGraph)} className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[9px] font-bold text-gray-600 hover:bg-gray-50">
                <Network size={11} className={showGraph ? "text-blue-600" : ""} /> Graph
              </button>
              <button onClick={() => setFit((v) => v + 1)} className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[9px] font-bold text-gray-600 hover:bg-gray-50">
                <Target size={11} /> Fit
              </button>
            </div>
          </div>

          <div className="relative flex-1 overflow-hidden rounded-[18px] border border-gray-200">
            <MapContainer center={points[0]} zoom={13} scrollWheelZoom style={{ width: "100%", height: "100%" }}>
              <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <FitRoute points={points} trigger={fit} />
              
              {/* Full planned route (subdued) */}
              <Polyline positions={points} pathOptions={{ color: "#9ca3af", weight: 3, opacity: 0.5, dashArray: "4 8" }} />
              
              {/* Active animated route */}
              {(isDemoVehicle ? visiblePolyline.length > 0 : true) && (
                <Polyline 
                  positions={isDemoVehicle ? visiblePolyline : points} 
                  pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.9, dashArray: "8 7" }} 
                />
              )}

              {/* All Camera Nodes */}
              {CAMERA_NETWORK_NODES.map((node) => {
                const status = getCameraStatus(node.id);
                if (status === 'unvisited' && !isDemoVehicle) return null; // Only show visited for non-demo
                
                return (
                  <Marker 
                    key={node.id} 
                    position={[node.lat, node.lng]} 
                    icon={cameraMarkerIcon(status)}
                  >
                    <Popup>
                      <div className="min-w-[170px] p-1">
                        <div className="flex justify-between">
                          <b className="font-mono text-[10px] text-blue-600">{node.id}</b>
                        </div>
                        <p className="mt-1 text-xs font-bold">{node.name}</p>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

              {/* Animated Vehicle Marker */}
              {isDemoVehicle && vehiclePosition && (
                <Marker position={vehiclePosition} icon={vehicleMarkerIcon()} zIndexOffset={1000} />
              )}
            </MapContainer>
          </div>
        </section>

        {/* Right Side Panels */}
        <div className="fade-up delay-300 flex flex-col gap-4 h-[640px] overflow-y-auto pr-2 custom-scrollbar">
          
          {/* Always show Vehicle Identity */}
          <VehicleIdentityCard 
            vehicle={isDemoVehicle ? DEMO_VEHICLE : {
              plate: vehicle.plate,
              globalId: '---',
              vehicleType: vehicle.type,
              vehicleColor: vehicle.color
            }}
            currentObservation={isDemoVehicle && currentHopIndex >= 0 ? DEMO_OBSERVATIONS[currentHopIndex] : null}
            isTracking={playbackState === 'playing'}
          />

          {/* Dynamic Panels during playback */}
          {isDemoVehicle && (
            <>
              {activePanel === 'ocr' && (
                <OCRPanel ocrData={DEMO_OCR_EVIDENCE} isActive={ocrActive} />
              )}
              
              {activePanel === 'handoff' && currentHopIndex > 0 && (
                <CameraHandoff 
                  fromCamera={DEMO_OBSERVATIONS[currentHopIndex-1]?.camera}
                  candidates={DEMO_HANDOFF_CANDIDATES.find(c => c.from === DEMO_OBSERVATIONS[currentHopIndex-1]?.camera)?.candidates || []}
                  confirmedCamera={DEMO_HANDOFF_CANDIDATES.find(c => c.from === DEMO_OBSERVATIONS[currentHopIndex-1]?.camera)?.confirmed}
                  stage={handoffStage}
                  isActive={true}
                />
              )}

              {activePanel === 'reid' && currentHopIndex > 0 && (
                <ReIDPanel 
                  matchData={DEMO_REID_TRANSITIONS.find(t => t.from === DEMO_OBSERVATIONS[currentHopIndex-1]?.camera && t.to === DEMO_OBSERVATIONS[currentHopIndex]?.camera)}
                  fromCamera={DEMO_OBSERVATIONS[currentHopIndex-1]?.camera}
                  toCamera={DEMO_OBSERVATIONS[currentHopIndex]?.camera}
                  globalId={DEMO_GLOBAL_ID}
                  isActive={reidActive}
                />
              )}
            </>
          )}

          {/* Fallback legacy info if not playing or not demo */}
          {(!isDemoVehicle || (playbackState === 'idle' || playbackState === 'complete')) && (
            <>
              <section className="rounded-[26px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-gray-400">Vehicle Profile</span>
                  <span className={`rounded-full border px-2.5 py-1 text-[9px] font-extrabold ${vehicle.badge}`}>{vehicle.status}</span>
                </div>
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-black font-mono">{vehicle.plate}</h2>
                  <button onClick={copyPlate} className="rounded-lg border border-gray-200 p-2 text-gray-400 hover:bg-gray-50">
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
                    <Info label="First" value={vehicle.hops[0][2]} />
                    <Info label="Latest" value={vehicle.hops.at(-1)[2]} right />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button onClick={exportCSV} className="flex items-center justify-center gap-1.5 rounded-xl bg-gray-900 py-2.5 text-[10px] font-bold text-white hover:bg-gray-800">
                    <Download size={13} /> Export CSV
                  </button>
                </div>
              </section>

              <section className={`rounded-[26px] border p-5 ${vehicle.deviation !== "None" && !vehicle.deviation.includes("Standard") ? "border-amber-200 bg-amber-50/70" : "border-emerald-200 bg-emerald-50/60"}`}>
                <div className="mb-3 flex items-center gap-2">
                  {vehicle.deviation !== "None" && !vehicle.deviation.includes("Standard") ? <ShieldAlert size={15} className="text-amber-600" /> : <CheckCircle2 size={15} className="text-emerald-600" />}
                  <h3 className="text-[10px] font-extrabold uppercase tracking-wider">Route Analysis</h3>
                </div>
                <Info label="Expected Route" value={vehicle.expected} />
                <div className="mt-3"><Info label="Actual Route" value={vehicle.actual} blue /></div>
                <div className="mt-3 border-t border-gray-200/70 pt-3"><Info label="Deviation Analysis" value={vehicle.deviation} /></div>
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
          isPlaying={playbackState === 'playing'}
          isComplete={playbackState === 'complete'}
          onSeek={seekToHop}
          onPlay={startPlayback}
          onPause={pausePlayback}
          onRestart={startPlayback}
        />
      )}

      {showGraph && (
        <CameraGraph 
          activeRoute={isDemoVehicle ? DEMO_ROUTE_PATH.slice(0, Math.max(1, currentHopIndex + 1)) : vehicle.hops.map(h => h[0])} 
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

      {/* 5. Chronological Movement Timeline (Static view for non-demo or completed demo) */}
      {(!isDemoVehicle || playbackState === 'complete') && (
        <section className="fade-up rounded-[26px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl mt-5">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Clock size={15} className="text-blue-600" />
                <h3 className="text-sm font-black">Movement Timeline</h3>
              </div>
              <p className="mt-1 text-[10px] text-gray-400">Chronological camera detections across the vehicle journey</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {vehicle.hops.map((h, i) => (
              <button
                key={h[0]}
                onClick={() => setSelected(h)}
                className={`relative rounded-2xl border p-4 text-left transition-all ${selected?.[0] === h[0] ? "border-blue-200 bg-blue-50" : "border-gray-100 bg-gray-50/70 hover:bg-white"}`}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${i === 0 ? "bg-green-500" : i === vehicle.hops.length - 1 ? "bg-red-500" : "bg-blue-600"}`} />
                    <span className="font-mono text-[10px] font-black text-blue-600">{h[0]}</span>
                  </div>
                  <span className="text-[9px] font-bold text-gray-400">{h[2]}</span>
                </div>
                <h4 className="text-xs font-black text-gray-800">{h[1]}</h4>
                <div className="mt-3 grid grid-cols-3 border-t border-gray-200/60 pt-3 text-[8px] font-bold text-gray-500">
                  <span>{h[3]}</span>
                  <span>{h[5]}</span>
                  <span>OCR <b className="text-emerald-600">{h[4]}</b></span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 6. Selected Detection Details */}
      {selected && (!isDemoVehicle || playbackState === 'complete') && (
        <section className="fade-up rounded-[22px] border border-blue-100 bg-blue-50/70 p-5 mt-5">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
            <div>
              <div className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-widest text-blue-600">
                <Target size={13} /> Selected Detection Details
              </div>
              <h3 className="mt-1 text-lg font-black">{selected[0]}</h3>
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
      {(!isDemoVehicle || playbackState === 'complete') && (
        <section className="fade-up rounded-[26px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl mt-5">
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
              <p className="mt-3 text-[9px] leading-4 text-gray-500">Vehicle identity verified across <b className="text-gray-700">{vehicle.stats[0]} camera nodes</b>.</p>
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

function Stat({ icon: Icon, label, value, blue }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/80 p-3.5 shadow-[0_6px_20px_rgba(0,0,0,.03)]">
      <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${blue ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-600"}`}>
        <Icon size={15} />
      </div>
      <div>
        <p className="text-[8px] font-extrabold uppercase tracking-wider text-gray-400">{label}</p>
        <p className={`text-sm font-black ${blue ? "text-blue-600" : ""}`}>{value}</p>
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