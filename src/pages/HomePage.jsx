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
import Navbar from "../components/Navbar";
import { slides } from "../data";

export default function HomePage({ navigate, openModal }) {
  const [slide, setSlide] = useState(0);
  const currentSlide = slides[slide];

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
      
      {/* =====================================================
          INTERACTIVE CURSOR SPOTLIGHT (Follows mouse everywhere)
          ===================================================== */}
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

      {/* About Slider */}
      <section
        className="
          fade-up
          delay-100
          group
          relative
          w-full
          overflow-hidden
          rounded-[24px]
          border
          border-white/60
          bg-white/60
          px-5
          py-5
          shadow-[0_8px_32px_rgba(0,0,0,0.04)]
          backdrop-blur-xl
          transition-all
          duration-500
          hover:shadow-[0_20px_40px_-10px_rgba(0,0,0,0.3)]
          sm:px-7
          sm:py-6
        "
      >
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

      {/* Main Content: Cards & Map */}
      <section className="grid w-full gap-5 lg:grid-cols-[1.1fr_1fr] xl:grid-cols-[1.2fr_1fr]">
        
        {/* 2x2 Grid */}
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
          />

          <FeatureCard
            direction="slide-right"
            delay="delay-200"
            icon={Navigation}
            title="Tracking"
            description="Spatial-Temporal Vehicle Tracking. Reconstruct complete paths from multiple ANPR feeds."
            button="Launch Tracking"
            onClick={() => navigate("dashboard")}
            theme="blue"
            bgImage="https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?q=80&w=800&auto=format&fit=crop"
          />

          <FeatureCard
            direction="slide-left"
            delay="delay-200"
            icon={TrafficCone}
            title="Traffic"
            description="City-Wide Traffic Analytics. Visualize origin-destination patterns and congestion bottlenecks."
            button="Analyze Traffic"
            onClick={() => navigate("dashboard")}
            theme="orange"
            bgImage="https://images.unsplash.com/photo-1508697014387-db72834b21d7?q=80&w=800&auto=format&fit=crop"
          />

          <FeatureCard
            direction="slide-right"
            delay="delay-300"
            icon={Bell}
            title="Alerts"
            description="Anomalous Route & Blacklist Alerts. Instant notifications for high-interest vehicles."
            button="View Alerts"
            onClick={() => openModal("Alert Center", "The alert service monitors suspicious vehicle movement.")}
            theme="red"
            bgImage="https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?q=80&w=800&auto=format&fit=crop"
          />
        </div>

        {/* Overview Map */}
        <div className="fade-up delay-400 flex h-full min-h-[420px] w-full flex-col rounded-[28px] border border-white/80 bg-white/70 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl transition-all duration-300 hover:shadow-[0_15px_35px_rgba(0,0,0,0.08)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/10 text-green-600 shadow-[inset_0_0_0_1px_rgba(34,197,94,0.2)]">
                <Map size={20} strokeWidth={2.5} />
              </div>
              <h3 className="text-xl font-extrabold text-gray-900">Network Overview</h3>
            </div>

            <button
              onClick={() => navigate("dashboard")}
              className="group relative overflow-hidden rounded-xl bg-gray-900 px-5 py-2.5 text-xs font-bold text-white shadow-[0_4px_14px_rgba(0,0,0,0.25)] transition-transform hover:scale-105 active:scale-95"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-600 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <span className="relative z-10">Open GIS</span>
            </button>
          </div>

          <div className="relative mt-5 flex-1 w-full overflow-hidden rounded-[20px] border border-gray-200/60 bg-[#f0f4f8]/80 shadow-inner">
            <div className="animate-grid-scroll absolute inset-0 opacity-50 [background-image:linear-gradient(#fff_2px,transparent_2px),linear-gradient(90deg,#fff_2px,transparent_2px)] [background-size:80px_80px]" />
            <div className="absolute left-[10%] top-[20%] h-[80px] w-[20%] rotate-[3deg] bg-green-300/40 backdrop-blur-sm" style={{ clipPath: "polygon(5% 0,100% 0,86% 100%,8% 90%)" }} />
            <div className="absolute bottom-[15%] right-[20%] h-[90px] w-[15%] rotate-[12deg] bg-green-300/40 backdrop-blur-sm" style={{ clipPath: "polygon(20% 0,100% 8%,82% 100%,0 92%)" }} />
            <div className="absolute left-[35%] top-[-10%] h-[120%] w-[10px] rotate-[-4deg] rounded-full bg-white shadow-md" />
            <div className="absolute left-[35.2%] top-[-10%] h-[120%] w-[6px] rotate-[-4deg] rounded-full bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.6)]" />
            <div className="absolute right-[-2%] top-[55%] h-[8px] w-[65%] rotate-[4deg] rounded-full bg-white shadow-md" />
            <div className="absolute right-[-2%] top-[55.2%] h-[5px] w-[65%] rotate-[4deg] rounded-full bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.6)]" />
            <div className="absolute left-[10%] top-[40%] h-[6px] w-[30%] rotate-[15deg] rounded-full bg-white shadow-md" />
            <div className="absolute left-[10%] top-[40.2%] h-[4px] w-[30%] rotate-[15deg] rounded-full bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.6)]" />
            <div className="absolute right-[5%] top-[8%] rounded-xl border border-white/60 bg-white/80 px-4 py-2 text-[10px] font-extrabold uppercase tracking-[2px] text-gray-600 shadow-lg backdrop-blur-md">HYD</div>
            
            <MapDot left="25%" top="45%" color="#ff453a" />
            <MapDot left="34%" top="36%" color="#ffcc00" delay="200ms" />
            <MapDot left="55%" top="52%" color="#34c759" delay="600ms" />
            <MapDot left="75%" top="60%" color="#6366f1" delay="400ms" />

            <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2.5 rounded-xl border border-white/60 bg-white/90 px-3.5 py-2 text-[10px] font-bold text-gray-800 shadow-xl backdrop-blur-md">
              <span className="trace-live-dot h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]" /> LIVE NETWORK
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <Radar size={16} className="text-gray-400" />
              <span className="text-xs font-bold text-gray-500">254 cameras monitored</span>
            </div>
            <button onClick={() => navigate("dashboard")} className="group flex items-center gap-1.5 text-xs font-extrabold text-blue-600 transition hover:text-blue-800">
              Explore Map <ChevronRight size={14} className="transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        </div>
      </section>

      {/* Status Strip */}
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

/* =========================================================
   FEATURE CARD WITH MOUSE TILT & SPOTLIGHT HIGHLIGHT
   ========================================================= */
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
      {/* Interactive Spotlight that tracks cursor inside the card */}
      {isHovered && (
        <div
          className="pointer-events-none absolute -inset-px z-30 transition duration-300 rounded-[24px]"
          style={{
            background: `radial-gradient(350px circle at ${coord.x}px ${coord.y}px, rgba(255,255,255,0.25), transparent 80%)`,
          }}
        />
      )}

      {/* Background Image */}
      <img
        src={bgImage}
        alt={title}
        className="absolute inset-0 z-0 h-full w-full object-cover opacity-0 transition-all duration-700 group-hover:scale-110 group-hover:opacity-100"
      />

      {/* Glass Overlay */}
      <div className={`absolute inset-0 z-10 bg-gradient-to-br opacity-0 transition-opacity duration-500 group-hover:opacity-100 ${t.hoverOverlay}`} />

      {/* Content */}
      <div className="relative z-20 flex h-full flex-col">
        <div className="flex items-start justify-between">
          <h3 className={`text-base font-extrabold transition-colors duration-500 ${t.titleText}`}>
            {title}
          </h3>
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-500 group-hover:rotate-12 group-hover:scale-110 ${t.iconBox}`}>
            <Icon size={18} />
          </div>
        </div>

        <p className={`mt-2.5 max-w-[260px] text-[11.5px] leading-relaxed transition-colors duration-500 ${t.descText}`}>
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

function MapDot({ left, top, color, delay = "0ms" }) {
  return (
    <div className="absolute z-20" style={{ left, top, color, animationDelay: delay }}>
      <span className="animate-radar-ping absolute h-4 w-4 rounded-full bg-transparent" style={{ animationDelay: delay }} />
      <span className="relative block h-4 w-4 rounded-full border-[3px] border-white shadow-[0_0_15px_rgba(0,0,0,0.3)]" style={{ backgroundColor: color }} />
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