import {
  Activity,
  Bell,
  ChevronLeft,
  ChevronRight,
  Gauge,
  LayoutDashboard,
  Map,
  Navigation,
  Radar,
  Route,
  ShieldAlert,
  TrafficCone,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import Navbar from "../components/Navbar";
import { slides, cameras } from "../data";

export default function HomePage({ navigate, openModal }) {
  const [slide, setSlide] = useState(0);
  const currentSlide = slides[slide];

  // Live animated telemetry tickers
  const [liveSpeed, setLiveSpeed] = useState(42);
  const [activeFeeds, setActiveFeeds] = useState(254);

  useEffect(() => {
    const interval = setInterval(() => {
      setLiveSpeed((prev) => (Math.random() > 0.5 ? prev + 1 : prev - 1));
      setActiveFeeds(250 + Math.floor(Math.random() * 8));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Mouse position tracker for interactive lighting
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  const handleMouseMove = (e) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setMousePos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  };

  const previousSlide = useCallback(() => {
    setSlide((current) => (current === 0 ? slides.length - 1 : current - 1));
  }, []);

  const nextSlide = useCallback(() => {
    setSlide((current) => (current === slides.length - 1 ? 0 : current + 1));
  }, []);

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="relative flex w-full flex-col gap-6 pb-10 overflow-hidden"
    >
      {/* Interactive Cursor Spotlight */}
      <div
        className="pointer-events-none absolute -inset-px rounded-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100 z-30"
        style={{
          background: `radial-gradient(600px circle at ${mousePos.x}px ${mousePos.y}px, rgba(59,130,246,0.12), transparent 80%)`,
        }}
      />

      {/* Background Blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="animate-blob absolute -left-[10%] top-[-5%] h-[400px] w-[400px] rounded-full bg-blue-300/30 mix-blend-multiply blur-[100px] filter" />
        <div className="animate-blob animation-delay-2000 absolute right-[-5%] top-[20%] h-[400px] w-[400px] rounded-full bg-purple-300/30 mix-blend-multiply blur-[100px] filter" />
        <div className="animate-blob animation-delay-4000 absolute bottom-[-10%] left-[20%] h-[500px] w-[500px] rounded-full bg-cyan-300/30 mix-blend-multiply blur-[100px] filter" />
      </div>

      {/* Navbar */}
      <div className="fade-up w-full">
        <Navbar page="home" navigate={navigate} openModal={openModal} />
      </div>

      {/* About Slider (Now directly below Navbar) */}
      <section className="fade-up delay-100 group relative w-full overflow-hidden rounded-[24px] border border-white/60 bg-white/60 px-5 py-5 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl transition-all duration-500 hover:shadow-[0_20px_40px_-10px_rgba(0,0,0,0.3)] sm:px-7 sm:py-6">
        <img
          src="https://images.unsplash.com/photo-1519501025264-65ba15a82390?q=80&w=1200&auto=format&fit=crop"
          alt="City Intelligence"
          className="absolute inset-0 z-0 h-full w-full object-cover opacity-0 transition-all duration-700 group-hover:scale-105 group-hover:opacity-100"
        />
        <div className="absolute inset-0 z-10 bg-gradient-to-r from-gray-900/95 via-gray-900/80 to-gray-900/60 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

        <div className="relative z-20 flex items-center gap-5">
          <button
            onClick={previousSlide}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/80 text-blue-600 shadow-md backdrop-blur-md transition-all hover:scale-110 group-hover:bg-white/10 group-hover:text-white group-hover:border-white/30"
          >
            <ChevronLeft size={18} />
          </button>

          <div key={slide} className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-extrabold tracking-tight text-gray-900 transition-colors duration-500 group-hover:text-white sm:text-xl">
                {currentSlide.title}
              </h2>
              <span className="rounded-full border border-blue-200 bg-blue-100/80 px-2.5 py-0.5 text-[10px] font-extrabold text-blue-700 shadow-sm transition-colors duration-500 group-hover:bg-white/20 group-hover:text-blue-200 group-hover:border-white/20">
                {slide + 1}/{slides.length}
              </span>
            </div>
            <p className="mt-2 min-h-[44px] max-w-[900px] text-[13px] leading-relaxed text-gray-700 transition-colors duration-500 group-hover:text-gray-200 sm:text-sm">
              <TypewriterText text={currentSlide.desc} onComplete={nextSlide} />
            </p>
          </div>

          <button
            onClick={nextSlide}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/80 text-blue-600 shadow-md backdrop-blur-md transition-all hover:scale-110 group-hover:bg-white/10 group-hover:text-white group-hover:border-white/30"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </section>

      {/* Main Feature Cards & GIS Map */}
      <section className="grid w-full gap-5 lg:grid-cols-[1.1fr_1fr] xl:grid-cols-[1.2fr_1fr]">
        {/* 2x2 Feature Grid */}
        <div className="grid gap-5 sm:grid-cols-2 overflow-hidden py-2 px-2 -mx-2">
          <FeatureCard
            direction="slide-left"
            delay="delay-100"
            icon={LayoutDashboard}
            title="Dashboard"
            description="Real-Time City Overview. View centralized performance metrics and average network speeds."
            button="View Dashboard"
            onClick={() => navigate("dashboard")}
            theme="purple"
            bgImage="https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=800&auto=format&fit=crop"
            liveBadge={`${liveSpeed} km/h avg`}
            liveStatusColor="bg-purple-500"
          />

          <FeatureCard
            direction="slide-right"
            delay="delay-200"
            icon={Navigation}
            title="Tracking"
            description="Spatial-Temporal Vehicle Tracking. Reconstruct complete paths from multiple ANPR feeds."
            button="Launch Tracking"
            onClick={() => navigate("tracking")}
            theme="blue"
            bgImage="https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?q=80&w=800&auto=format&fit=crop"
            liveBadge={`${activeFeeds} Feeds Active`}
            liveStatusColor="bg-blue-500"
          />

          <FeatureCard
            direction="slide-left"
            delay="delay-200"
            icon={TrafficCone}
            title="Traffic"
            description="City-Wide Traffic Analytics. Visualize origin-destination patterns and congestion bottlenecks."
            button="Analyze Traffic"
            onClick={() => navigate("traffic")}
            theme="orange"
            bgImage="https://images.unsplash.com/photo-1506146332389-18140dc7b2fb?q=80&w=800&auto=format&fit=crop"
            liveBadge="3 Congestion Zones"
            liveStatusColor="bg-amber-500"
          />

          <FeatureCard
            direction="slide-right"
            delay="delay-300"
            icon={Bell}
            title="Alerts"
            description="Anomalous Route & Blacklist Alerts. Instant notifications for high-interest vehicles."
            button="View Alerts"
            onClick={() => navigate("alerts")}
            theme="red"
            bgImage="https://images.unsplash.com/photo-1558494949-ef010cbdcc31?q=80&w=800&auto=format&fit=crop"
            liveBadge="3 Priority Flags"
            liveStatusColor="bg-red-500"
            isPulse={true}
          />
        </div>

        {/* Real Interactive Leaflet GIS Map with Solid Hover Effect */}
        <div className="fade-up delay-400 group flex h-full min-h-[420px] w-full flex-col rounded-[28px] border-2 border-white/80 bg-white/70 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-blue-500 hover:bg-white hover:shadow-[8px_8px_0px_0px_rgba(37,99,235,1)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/10 text-green-600 shadow-[inset_0_0_0_1px_rgba(34,197,94,0.2)] transition-colors group-hover:bg-blue-500/10 group-hover:text-blue-600 group-hover:shadow-[inset_0_0_0_1px_rgba(59,130,246,0.3)]">
                <Map size={20} strokeWidth={2.5} />
              </div>
              <h3 className="text-xl font-extrabold text-gray-900">Network Overview</h3>
            </div>

            <button
              onClick={() => navigate("tracking")}
              className="group/btn relative overflow-hidden rounded-xl bg-gray-900 px-5 py-2.5 text-xs font-bold text-white shadow-[0_4px_14px_rgba(0,0,0,0.25)] transition-transform hover:scale-105 active:scale-95"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-blue-700 opacity-0 transition-opacity duration-300 group-hover/btn:opacity-100" />
              <span className="relative z-10">Open GIS Tracking</span>
            </button>
          </div>

          <div className="relative mt-5 flex-1 w-full overflow-hidden rounded-[20px] border border-gray-200/60 bg-[#f0f4f8]/80 shadow-inner z-10 min-h-[300px]">
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

              {cameras.map((cam, idx) => (
                <Marker key={idx} position={[cam.latitude, cam.longitude]}>
                  <Popup>
                    <div className="p-1">
                      <span className="text-[10px] font-extrabold text-blue-600 uppercase">{cam.id}</span>
                      <h4 className="text-xs font-bold text-gray-900">{cam.location}</h4>
                      <p className="text-[10px] text-gray-500 mt-1">Status: {cam.status} | Speed: {cam.speed}</p>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>

            <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2.5 rounded-xl border border-white/60 bg-white/90 px-3.5 py-2 text-[10px] font-bold text-gray-800 shadow-xl backdrop-blur-md pointer-events-none transition-colors group-hover:border-blue-200">
              <span className="trace-live-dot h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]" /> LIVE ANPR MESH
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <Radar size={16} className="text-gray-400 group-hover:text-blue-500 transition-colors" />
              <span className="text-xs font-bold text-gray-500 group-hover:text-gray-700 transition-colors">254 camera nodes synchronized</span>
            </div>
            <button onClick={() => navigate("tracking")} className="group/link flex items-center gap-1.5 text-xs font-extrabold text-blue-600 transition hover:text-blue-800">
              Full Trajectory Mode <ChevronRight size={14} className="transition-transform group-hover/link:translate-x-1" />
            </button>
          </div>
        </div>
      </section>

      {/* System Status Strip */}
      <section className="fade-up delay-400 flex w-full flex-col gap-4 rounded-[20px] border border-white/60 bg-white/70 px-6 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="trace-live-dot h-2.5 w-2.5 rounded-full bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.8)]" />
          <span className="text-xs font-extrabold text-gray-800">All core AI systems operational</span>
        </div>
        <div className="flex flex-wrap gap-6">
          <StatusItem icon={Route} text="Trajectory Engine" />
          <StatusItem icon={Activity} text="Traffic Engine" />
          <StatusItem icon={ShieldAlert} text="Alert Service" />
        </div>
      </section>
    </div>
  );
}

function TypewriterText({ text, onComplete }) {
  const [displayedText, setDisplayedText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setDisplayedText("");
    setIsDeleting(false);
  }, [text]);

  useEffect(() => {
    let timeout;
    if (!isDeleting && displayedText.length < text.length) {
      timeout = setTimeout(() => setDisplayedText(text.slice(0, displayedText.length + 1)), 30);
    } else if (!isDeleting && displayedText.length === text.length) {
      timeout = setTimeout(() => setIsDeleting(true), 4000);
    } else if (isDeleting && displayedText.length > 0) {
      timeout = setTimeout(() => setDisplayedText(text.slice(0, displayedText.length - 1)), 15);
    } else if (isDeleting && displayedText.length === 0) {
      setIsDeleting(false);
      onComplete();
    }
    return () => clearTimeout(timeout);
  }, [displayedText, isDeleting, text, onComplete]);

  return (
    <span>
      {displayedText}
      <span className="animate-pulse text-[15px] font-bold text-blue-500 group-hover:text-blue-300">|</span>
    </span>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  button,
  onClick,
  direction,
  delay,
  theme,
  bgImage,
  liveBadge,
  liveStatusColor,
  isPulse = false,
}) {
  const [coord, setCoord] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setCoord({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const styles = {
    blue: {
      hoverOverlay: "from-blue-900/95 to-blue-600/80",
      iconBox: "bg-blue-50 text-blue-600 group-hover:bg-blue-500/40 group-hover:text-white group-hover:backdrop-blur-md",
      titleText: "text-gray-900 group-hover:text-white",
      descText: "text-gray-500 group-hover:text-blue-50",
      btn: "bg-blue-50 text-blue-700 border-transparent group-hover:bg-white/20 group-hover:text-white group-hover:border-white/30 group-hover:backdrop-blur-md",
    },
    orange: {
      hoverOverlay: "from-orange-900/95 to-orange-600/80",
      iconBox: "bg-orange-50 text-orange-600 group-hover:bg-orange-500/40 group-hover:text-white group-hover:backdrop-blur-md",
      titleText: "text-gray-900 group-hover:text-white",
      descText: "text-gray-500 group-hover:text-orange-50",
      btn: "bg-orange-50 text-orange-700 border-transparent group-hover:bg-white/20 group-hover:text-white group-hover:border-white/30 group-hover:backdrop-blur-md",
    },
    purple: {
      hoverOverlay: "from-purple-900/95 to-purple-600/80",
      iconBox: "bg-purple-50 text-purple-600 group-hover:bg-purple-500/40 group-hover:text-white group-hover:backdrop-blur-md",
      titleText: "text-gray-900 group-hover:text-white",
      descText: "text-gray-500 group-hover:text-purple-50",
      btn: "bg-purple-50 text-purple-700 border-transparent group-hover:bg-white/20 group-hover:text-white group-hover:border-white/30 group-hover:backdrop-blur-md",
    },
    red: {
      hoverOverlay: "from-red-900/95 to-red-600/80",
      iconBox: "bg-red-50 text-red-600 group-hover:bg-red-500/40 group-hover:text-white group-hover:backdrop-blur-md",
      titleText: "text-gray-900 group-hover:text-white",
      descText: "text-gray-500 group-hover:text-red-50",
      btn: "bg-red-50 text-red-700 border-transparent group-hover:bg-white/20 group-hover:text-white group-hover:border-white/30 group-hover:backdrop-blur-md",
    },
  };

  const t = styles[theme];

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        ${direction}
        ${delay}
        group
        relative
        flex
        min-h-[200px]
        flex-col
        overflow-hidden
        rounded-[24px]
        border
        border-white/60
        bg-white/60
        p-5
        shadow-[0_8px_32px_rgba(0,0,0,0.04)]
        transition-all
        duration-500
        hover:-translate-y-2
        hover:shadow-[0_20px_40px_-10px_rgba(0,0,0,0.3)]
      `}
    >
      {isHovered && (
        <div
          className="pointer-events-none absolute -inset-px z-30 transition duration-300 rounded-[24px]"
          style={{
            background: `radial-gradient(350px circle at ${coord.x}px ${coord.y}px, rgba(255,255,255,0.25), transparent 80%)`,
          }}
        />
      )}

      <img
        src={bgImage}
        alt={title}
        className="absolute inset-0 z-0 h-full w-full object-cover opacity-0 transition-all duration-700 group-hover:scale-110 group-hover:opacity-100"
      />

      <div className={`absolute inset-0 z-10 bg-gradient-to-br opacity-0 transition-opacity duration-500 group-hover:opacity-100 ${t.hoverOverlay}`} />

      <div className="relative z-20 flex h-full flex-col">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <h3 className={`text-base font-extrabold transition-colors duration-500 ${t.titleText}`}>
              {title}
            </h3>
            {liveBadge && (
              <div className="flex items-center gap-1.5 rounded-full bg-gray-100/80 px-2.5 py-0.5 text-[10px] font-bold text-gray-600 backdrop-blur-sm w-fit transition-all duration-300 group-hover:bg-white/20 group-hover:text-white">
                <span className={`h-1.5 w-1.5 rounded-full ${liveStatusColor} ${isPulse ? 'trace-live-dot' : ''}`} />
                {liveBadge}
              </div>
            )}
          </div>

          <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-500 group-hover:rotate-12 group-hover:scale-110 ${t.iconBox}`}>
            <Icon size={18} />
          </div>
        </div>

        <p className={`mt-2.5 max-w-[260px] text-[11.5px] leading-relaxed transition-colors duration-500 min-h-[44px] ${t.descText}`}>
          {description}
        </p>

        <div className="mt-auto pt-5">
          <button
            onClick={onClick}
            className={`flex w-full items-center justify-center rounded-xl border px-4 py-2.5 text-[13px] font-extrabold transition-all duration-500 ${t.btn}`}
          >
            {button}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusItem({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[1px] text-gray-500">
      <Icon size={14} className="text-gray-400" />
      {text}
    </div>
  );
}