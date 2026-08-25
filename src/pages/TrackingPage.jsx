import { useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import { Search, Navigation, Clock, ShieldAlert, MapPin, Activity, ArrowRight, CheckCircle2 } from "lucide-react";
import { cameras, areas } from "../data";
import Navbar from "../components/Navbar";

// Pre-configured simulated historical trajectories for specific vehicle plates
const vehicleTrajectories = {
  "TS08EJ4892": {
    vehicleNumber: "TS08EJ4892",
    vehicleType: "Sedan (Black)",
    owner: "Registered Enterprise Fleet",
    status: "Normal Transit",
    riskLevel: "Low",
    path: [
      { camera: "CAM #403", location: "Balanagar Main Road Circle", time: "16:15:20", speed: "48 km/h", coords: [17.4855, 78.4120], status: "Verified OCR (96.4%)" },
      { camera: "CAM #402", location: "Kukatpally Metro Station Gate 2", time: "16:32:45", speed: "28 km/h", coords: [17.4891, 78.4012], status: "Verified OCR (94.2%)" },
      { camera: "CAM #401", location: "Kukatpally Flyover Junction", time: "16:50:10", speed: "34 km/h", coords: [17.4932, 78.3984], status: "Verified OCR (95.1%)" },
    ]
  },
  "TS07FZ1029": {
    vehicleNumber: "TS07FZ1029",
    vehicleType: "SUV (White)",
    owner: "Restricted / Flagged Watchlist",
    status: "Anomaly Flagged (Unusual Loitering)",
    riskLevel: "High",
    path: [
      { camera: "CAM #401", location: "Kukatpally Flyover Junction", time: "15:10:00", speed: "65 km/h", coords: [17.4932, 78.3984], status: "Speed Violation" },
      { camera: "CAM #404", location: "Moosapet Bypass Link", time: "15:45:12", speed: "56 km/h", coords: [17.4810, 78.4055], status: "Normal Transit" },
      { camera: "CAM #402", location: "Kukatpally Metro Station Gate 2", time: "16:20:30", speed: "22 km/h", coords: [17.4891, 78.4012], status: "Congestion Bottleneck Match" },
    ]
  },
  "TS10UA9921": {
    vehicleNumber: "TS10UA9921",
    vehicleType: "Commercial Transport",
    owner: "Logistics Provider Corp",
    status: "Compliant Route",
    riskLevel: "Low",
    path: [
      { camera: "CAM #403", location: "Balanagar Main Road Circle", time: "14:00:15", speed: "45 km/h", coords: [17.4855, 78.4120], status: "OCR Match" },
      { camera: "CAM #404", location: "Moosapet Bypass Link", time: "14:25:50", speed: "52 km/h", coords: [17.4810, 78.4055], status: "OCR Match" },
    ]
  }
};

export default function TrackingPage({ navigate, openModal }) {
  const [searchQuery, setSearchQuery] = useState("TS08EJ4892");
  const [activeRecord, setActiveRecord] = useState(vehicleTrajectories["TS08EJ4892"]);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSearch = (e) => {
    e.preventDefault();
    const formatted = searchQuery.trim().toUpperCase();
    if (vehicleTrajectories[formatted]) {
      setActiveRecord(vehicleTrajectories[formatted]);
      setErrorMsg("");
    } else {
      setErrorMsg(`No historical spatial-temporal trajectory found for plate: ${formatted}`);
    }
  };

  const handleQuickSelect = (plate) => {
    setSearchQuery(plate);
    setActiveRecord(vehicleTrajectories[plate]);
    setErrorMsg("");
  };

  const polylineCoords = activeRecord ? activeRecord.path.map(p => p.coords) : [];

  return (
    <div className="relative flex w-full flex-col gap-6 pb-10">
      
      {/* Background Decorative Elements */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="animate-blob absolute -left-[10%] top-[-5%] h-[400px] w-[400px] rounded-full bg-blue-300/30 mix-blend-multiply blur-[100px] filter" />
        <div className="animate-blob animation-delay-2000 absolute right-[-5%] top-[20%] h-[400px] w-[400px] rounded-full bg-purple-300/30 mix-blend-multiply blur-[100px] filter" />
      </div>

      {/* Navbar with explicit tracking active page state */}
      <div className="fade-up w-full">
        <Navbar page="tracking" navigate={navigate} openModal={openModal} />
      </div>

      {/* Header Banner */}
      <div className="fade-up delay-100 flex flex-col md:flex-row md:items-center md:justify-between gap-4 rounded-[24px] border border-white/60 bg-white/80 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-3 w-3 rounded-full bg-blue-600 trace-live-dot" />
            <span className="text-xs font-extrabold uppercase tracking-widest text-blue-600">Module 02: Spatial-Temporal Reconstruction</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 mt-1">Single Plate Trajectory Tracking</h1>
          <p className="text-xs text-gray-500 mt-1">
            Reconstruct complete travel paths, timestamps, camera hops, and chronological movement history across the city GIS grid.
          </p>
        </div>

        {/* Quick Plate Selectors */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-gray-400">Quick Test Plates:</span>
          {Object.keys(vehicleTrajectories).map((plate) => (
            <button
              key={plate}
              onClick={() => handleQuickSelect(plate)}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                searchQuery === plate 
                  ? "bg-blue-600 text-white shadow-md shadow-blue-500/30" 
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {plate}
            </button>
          ))}
        </div>
      </div>

      {/* Search & Query Bar */}
      <div className="fade-up delay-200 rounded-[24px] border border-white/60 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Enter License Plate (e.g. TS08EJ4892)..."
              className="w-full rounded-xl border border-gray-200/80 bg-white/50 pl-11 pr-4 py-3 text-sm font-bold text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
            />
          </div>
          <button
            type="submit"
            className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-6 py-3 text-xs font-bold text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
          >
            <Navigation size={16} /> Reconstruct Trajectory
          </button>
        </form>
        {errorMsg && (
          <p className="mt-3 text-xs font-bold text-red-500 flex items-center gap-1.5">
            <ShieldAlert size={14} /> {errorMsg}
          </p>
        )}
      </div>

      {/* Main Content Grid: Timeline (Left) + GIS Map (Right) */}
      {activeRecord && (
        <div className="grid w-full gap-5 lg:grid-cols-[1fr_1.3fr]">
          
          {/* LEFT: Chronological Timeline & Vehicle Intelligence Metadata */}
          <div className="fade-up delay-300 flex flex-col gap-5">
            
            {/* Metadata Card */}
            <div className="rounded-[24px] border border-white/80 bg-white/80 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
              <div className="flex items-center justify-between pb-4 border-b border-gray-100">
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">Target Plate</span>
                  <h2 className="text-xl font-black text-gray-900 font-mono tracking-tight">{activeRecord.vehicleNumber}</h2>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-extrabold ${
                  activeRecord.riskLevel === 'High' ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-green-100 text-green-700 border border-green-200'
                }`}>
                  {activeRecord.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4">
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Vehicle Classification</span>
                  <p className="text-xs font-extrabold text-gray-800 mt-0.5">{activeRecord.vehicleType}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Registry Database</span>
                  <p className="text-xs font-extrabold text-gray-800 mt-0.5">{activeRecord.owner}</p>
                </div>
              </div>
            </div>

            {/* Chronological Path History */}
            <div className="flex-1 rounded-[24px] border border-white/80 bg-white/80 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
              <h3 className="text-sm font-extrabold text-gray-900 mb-5 flex items-center gap-2">
                <Clock size={16} className="text-blue-600" /> Chronological Camera Hops
              </h3>

              <div className="relative pl-6 space-y-6 before:absolute before:bottom-2 before:top-2 before:left-2.5 before:w-[2px] before:bg-blue-100">
                {activeRecord.path.map((node, index) => (
                  <div key={index} className="relative group">
                    <span className="absolute -left-6 top-1 h-3 w-3 rounded-full border-2 border-white bg-blue-600 shadow-sm" />
                    <div className="rounded-2xl border border-gray-100 bg-gray-50/80 p-4 transition-all hover:bg-white hover:shadow-md">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-blue-600">{node.camera}</span>
                        <span className="text-[11px] font-bold font-mono text-gray-500 bg-white px-2 py-0.5 rounded-md border border-gray-200">{node.time}</span>
                      </div>
                      <h4 className="text-xs font-extrabold text-gray-800 mt-1">{node.location}</h4>
                      <div className="mt-3 flex items-center justify-between pt-2 border-t border-gray-200/60 text-[11px]">
                        <span className="font-bold text-gray-600">Speed: {node.speed}</span>
                        <span className="font-bold text-emerald-600 flex items-center gap-1">
                          <CheckCircle2 size={12} /> {node.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT: Leaflet GIS Map with Live Trajectory Polylines */}
          <div className="fade-up delay-400 flex flex-col h-[550px] lg:h-auto rounded-[28px] border border-white/80 bg-white/70 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl overflow-hidden">
            <div className="flex items-center justify-between mb-3 px-2">
              <div className="flex items-center gap-2">
                <MapPin size={16} className="text-blue-600" />
                <h3 className="text-xs font-extrabold text-gray-800 uppercase tracking-wider">GIS Spatial Reconstruction Map</h3>
              </div>
              <span className="text-[10px] font-bold text-gray-400">Hyderabad ANPR Grid</span>
            </div>

            <div className="relative flex-1 w-full rounded-[20px] overflow-hidden border border-gray-200/60 shadow-inner z-10">
              <MapContainer
                center={activeRecord.path[0].coords}
                zoom={13}
                scrollWheelZoom={false}
                style={{ width: "100%", height: "100%" }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {/* Draw connecting route line across camera nodes */}
                <Polyline positions={polylineCoords} color="#2563eb" weight={4} opacity={0.8} dashArray="6, 6" />

                {/* Render markers for each matched camera hop */}
                {activeRecord.path.map((node, idx) => (
                  <Marker key={idx} position={node.coords}>
                    <Popup>
                      <div className="p-1">
                        <span className="text-[10px] font-extrabold text-blue-600 uppercase">{node.camera}</span>
                        <h4 className="text-xs font-bold text-gray-900">{node.location}</h4>
                        <p className="text-[10px] text-gray-500 mt-1">Timestamp: {node.time} | Speed: {node.speed}</p>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}