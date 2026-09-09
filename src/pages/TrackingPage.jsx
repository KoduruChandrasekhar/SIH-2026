import { useEffect, useMemo, useState, useRef } from "react";
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

// Comprehensive Mock Database with Sample Plates & Trajectories
const localVehicles = {
  TS09AB4521: {
    plate: "TS09AB4521",
    type: "Sedan",
    color: "White",
    confidence: "98.7%",
    status: "ACTIVE",
    badge: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    expected: "Kukatpally → Balanagar → Madhapur",
    actual: "Kukatpally → Begumpet → Madhapur",
    deviation: "Yes (+3.2 km detour via Begumpet)",
    stats: ["4", "12.8 km", "24 min", "42 km/h"],
    reid: "97.8%",
    transitions: "3",
    fastest: "48 km/h",
    slowest: "28 km/h",
    hops: [
      ["CAM #401", "Kukatpally Y-Junction", "16:02:14", "34 km/h", "98.2%", "North", "0 km", 17.4947, 78.3996],
      ["CAM #402", "Kukatpally Metro Station", "16:07:42", "28 km/h", "99.1%", "North-East", "3.2 km", 17.4985, 78.3912],
      ["CAM #403", "Balanagar Main Road", "16:14:31", "48 km/h", "97.8%", "South", "4.5 km", 17.4682, 78.4357],
      ["CAM #406", "Madhapur IT Corridor", "16:26:05", "42 km/h", "98.7%", "East", "5.1 km", 17.4485, 78.3742],
    ],
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

function markerIcon(type, selected) {
  const color = type === "start" ? "#16a34a" : type === "end" ? "#dc2626" : "#2563eb";
  const size = selected ? 36 : 28;
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 3px 12px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;color:white;font-size:9px;font-weight:800">${type === "start" ? "S" : type === "end" ? "L" : "●"}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function TrackingPage({ navigate, openModal }) {
  const [query, setQuery] = useState("TS09AB4521");
  const [plate, setPlate] = useState("TS09AB4521");
  const [selected, setSelected] = useState(null);
  const [live, setLive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fit, setFit] = useState(0);
  const [vehicles, setVehiclesData] = useState(localVehicles);
  const apiLoaded = useRef(false);

  // Fetch from API with fallback
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
    setFit((v) => v + 1);
  };

  const selectVehicle = (p) => {
    setPlate(p);
    setQuery(p);
    setSelected(null);
    setFit((v) => v + 1);
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
  };

  useEffect(() => {
    setSelected(null);
    setLive(false);
  }, [plate]);

  useEffect(() => {
    if (!live || vehicle.status !== "ACTIVE") return;
    let i = 0;
    const timer = setInterval(() => {
      setSelected(vehicle.hops[i]);
      i = (i + 1) % vehicle.hops.length;
    }, 2500);
    return () => clearInterval(timer);
  }, [live, vehicle]);

  return (
    <div className="flex w-full flex-col gap-5 pb-10">
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
            <button className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-blue-700">Track</button>
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

      {/* 9. Travel Statistics Summary */}
      <div className="fade-up delay-150 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat icon={Layers} label="Cameras" value={vehicle.stats[0]} />
        <Stat icon={Navigation} label="Distance" value={vehicle.stats[1]} />
        <Stat icon={Clock} label="Travel Time" value={vehicle.stats[2]} />
        <Stat icon={Gauge} label="Average Speed" value={vehicle.stats[3]} />
        <Stat icon={ShieldAlert} label="OCR Match" value={vehicle.confidence} blue />
      </div>

      {/* 3. Interactive GIS Trajectory Map & Profile Layout */}
      <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
        <section className="fade-up delay-200 flex h-[560px] flex-col rounded-[26px] border border-white/80 bg-white/70 p-3 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <MapPin size={15} className="text-blue-600" />
              <h3 className="text-[10px] font-extrabold uppercase tracking-wider">GIS Trajectory Map</h3>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setFit((v) => v + 1)} className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[9px] font-bold text-gray-600">
                <Target size={11} /> Fit
              </button>
              <button disabled={vehicle.status !== "ACTIVE"} onClick={() => setLive((v) => !v)} className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-bold ${live ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600"}`}>
                <Radio size={10} /> {live ? "Live" : "Track"}
              </button>
            </div>
          </div>

          <div className="relative flex-1 overflow-hidden rounded-[18px] border border-gray-200">
            <MapContainer center={points[0]} zoom={13} scrollWheelZoom style={{ width: "100%", height: "100%" }}>
              <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <FitRoute points={points} trigger={fit} />
              <Polyline positions={points} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.9, dashArray: "8 7" }} />
              {vehicle.hops.map((h, i) => {
                const type = i === 0 ? "start" : i === vehicle.hops.length - 1 ? "end" : "normal";
                return (
                  <Marker key={h[0]} position={[h[7], h[8]]} icon={markerIcon(type, selected?.[0] === h[0])} eventHandlers={{ click: () => setSelected(h) }}>
                    <Popup>
                      <div className="min-w-[170px] p-1">
                        <div className="flex justify-between">
                          <b className="font-mono text-[10px] text-blue-600">{h[0]}</b>
                          <b className="text-[9px] text-gray-400">{h[2]}</b>
                        </div>
                        <p className="mt-1 text-xs font-bold">{h[1]}</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-2 text-[9px]">
                          <span>Speed: <b>{h[3]}</b></span>
                          <span>OCR: <b className="text-emerald-600">{h[4]}</b></span>
                          <span>Direction: <b>{h[5]}</b></span>
                          <span>Distance: <b>{h[6]}</b></span>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          </div>
        </section>

        {/* 4. Vehicle Profile & 10. Route Analysis */}
        <div className="fade-up delay-300 flex flex-col gap-5">
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

          {/* Route Analysis Component */}
          <section className={`rounded-[26px] border p-5 ${vehicle.deviation !== "None" && !vehicle.deviation.includes("Standard") ? "border-amber-200 bg-amber-50/70" : "border-emerald-200 bg-emerald-50/60"}`}>
            <div className="mb-3 flex items-center gap-2">
              {vehicle.deviation !== "None" && !vehicle.deviation.includes("Standard") ? <ShieldAlert size={15} className="text-amber-600" /> : <CheckCircle2 size={15} className="text-emerald-600" />}
              <h3 className="text-[10px] font-extrabold uppercase tracking-wider">Route Analysis</h3>
            </div>
            <Info label="Expected Route" value={vehicle.expected} />
            <div className="mt-3"><Info label="Actual Route" value={vehicle.actual} blue /></div>
            <div className="mt-3 border-t border-gray-200/70 pt-3"><Info label="Deviation Analysis" value={vehicle.deviation} /></div>
          </section>
        </div>
      </div>

      {/* 5. Chronological Movement Timeline */}
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

      {/* 6. Selected Detection Details */}
      {selected && (
        <section className="fade-up rounded-[22px] border border-blue-100 bg-blue-50/70 p-5">
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