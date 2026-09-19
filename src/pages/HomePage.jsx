import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Activity, ArrowRight, Bell, ChevronDown, LayoutDashboard, Navigation,
  Route, ShieldAlert, TrafficCone, Zap, Globe2, Radar,
} from "lucide-react";
import Navbar from "../components/Navbar";

const EarthGlobe = lazy(() => import("../components/EarthGlobe"));
gsap.registerPlugin(ScrollTrigger);

function AnimatedCounter({ target, suffix = "", prefix = "" }) {
  const node = useRef(null);
  const [value, setValue] = useState(0);

  useEffect(() => {
    const element = node.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || element.dataset.counted) return;
      element.dataset.counted = "true";
      const state = { value: 0 };
      gsap.to(state, {
        value: target,
        duration: 1.6,
        ease: "power3.out",
        onUpdate: () => setValue(Math.round(state.value)),
      });
      observer.disconnect();
    }, { threshold: 0.45 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);

  return <span ref={node}>{prefix}{value.toLocaleString()}{suffix}</span>;
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  buttonText = "Open command module",
  onClick,
  eyebrow,
  theme = "blue",
  bgImage,
  liveBadge,
  liveStatusColor = "bg-blue-400",
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

  const themeStyles = {
    purple: {
      accent: "#a855f7",
      hoverOverlay: "from-purple-950/90 via-purple-900/80 to-slate-950/90",
      iconBox: "bg-purple-500/15 text-purple-400 group-hover:bg-purple-500/30 group-hover:text-white",
    },
    blue: {
      accent: "#3b82f6",
      hoverOverlay: "from-blue-950/90 via-blue-900/80 to-slate-950/90",
      iconBox: "bg-blue-500/15 text-blue-400 group-hover:bg-blue-500/30 group-hover:text-white",
    },
    orange: {
      accent: "#f97316",
      hoverOverlay: "from-amber-950/90 via-orange-900/80 to-slate-950/90",
      iconBox: "bg-orange-500/15 text-orange-400 group-hover:bg-orange-500/30 group-hover:text-white",
    },
    red: {
      accent: "#ef4444",
      hoverOverlay: "from-rose-950/90 via-red-900/80 to-slate-950/90",
      iconBox: "bg-red-500/15 text-red-400 group-hover:bg-red-500/30 group-hover:text-white",
    },
  };

  const currentTheme = themeStyles[theme] || themeStyles.blue;

  return (
    <div
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group relative flex min-h-[260px] cursor-pointer flex-col overflow-hidden rounded-[24px] border border-white/15 bg-slate-900/80 p-6 shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl transition-all duration-500 hover:-translate-y-1.5 hover:border-white/30 hover:shadow-[0_20px_50px_rgba(0,0,0,0.8)]"
      style={{ isolation: "isolate" }}
    >
      {/* Background Cover Image with Hover Zoom */}
      <img
        src={bgImage}
        alt={title}
        className="pointer-events-none absolute inset-0 -z-20 h-full w-full object-cover opacity-0 transition-all duration-700 group-hover:scale-105 group-hover:opacity-100"
      />

      {/* Thematic Gradient Overlay */}
      <div
        className={`pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br opacity-0 transition-opacity duration-500 group-hover:opacity-100 ${currentTheme.hoverOverlay}`}
      />

      {/* Floating Spotlight Follows Cursor */}
      {isHovered && (
        <div
          className="pointer-events-none absolute -inset-px z-10 transition-opacity duration-300 rounded-[24px]"
          style={{
            background: `radial-gradient(350px circle at ${coord.x}px ${coord.y}px, rgba(255,255,255,0.22), transparent 75%)`,
          }}
        />
      )}

      {/* Card Content */}
      <div className="relative z-20 flex h-full flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 transition-all duration-500 group-hover:scale-110 group-hover:rotate-6 ${currentTheme.iconBox}`}
              >
                <Icon size={20} />
              </div>
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] group-hover:text-white/80 transition-colors">
                  {eyebrow}
                </span>
                <h3 className="text-xl font-bold tracking-tight text-[var(--text-primary)] group-hover:text-white transition-colors">
                  {title}
                </h3>
              </div>
            </div>

            {liveBadge && (
              <div className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-[11px] font-bold text-gray-200 backdrop-blur-md transition-all duration-300 group-hover:border-white/30 group-hover:bg-white/20 group-hover:text-white">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${liveStatusColor} ${
                    isPulse ? "animate-pulse" : ""
                  }`}
                />
                <span>{liveBadge}</span>
              </div>
            )}
          </div>

          <p className="mt-4 text-xs leading-relaxed text-[var(--text-secondary)] group-hover:text-white/90 transition-colors max-w-sm">
            {description}
          </p>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
          <span className="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)] group-hover:text-white transition-colors">
            {buttonText}
            <ArrowRight
              size={15}
              className="transition-transform duration-300 group-hover:translate-x-1.5 text-[var(--text-muted)] group-hover:text-white"
            />
          </span>
          <span
            className="h-1.5 w-1.5 rounded-full transition-transform duration-300 group-hover:scale-150"
            style={{ backgroundColor: currentTheme.accent }}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ value, suffix, label }) {
  return <div className="stat-unit"><strong><AnimatedCounter target={value} suffix={suffix} /></strong><span>{label}</span></div>;
}

export default function HomePage({ navigate, openModal, launchTracking }) {
  const root = useRef(null);
  const hero = useRef(null);
  const globe = useRef(null);
  const copy = useRef(null);

  useLayoutEffect(() => {
    const context = gsap.context(() => {
      // Hero scroll animation
      gsap.timeline({
        scrollTrigger: { trigger: hero.current, start: "top top", end: "bottom 35%", scrub: 0.6 },
      })
        .to(globe.current, { scale: 0.59, x: "27vw", y: "-16vh", opacity: 0.42, ease: "none" }, 0)
        .to(copy.current, { opacity: 0, y: -34, filter: "blur(8px)", ease: "none" }, 0);

      // Immediately fade out the scroll cue on initial scroll
      gsap.to(".hero-scroll-cue", {
        scrollTrigger: { trigger: hero.current, start: "top top", end: "top -50px", scrub: true },
        opacity: 0,
        y: 25,
      });
    }, root);
    return () => context.revert();
  }, []);

  const track = () => (launchTracking ? launchTracking() : navigate("tracking"));

  return (
    <main ref={root} className="relative overflow-hidden">
      <section ref={hero} className="hero-orbit-stage">
        <div className="hero-aurora" />
        <div ref={globe} className="hero-globe-stage"><Suspense fallback={<div className="globe-fallback" />}><EarthGlobe /></Suspense></div>
        <div className="hero-interface pointer-events-none">
          <div className="pointer-events-auto px-4 pt-4 sm:px-6 lg:px-8"><Navbar page="home" navigate={navigate} openModal={openModal} launchTracking={track} /></div>
          <div ref={copy} className="hero-copy">
            <div className="hero-kicker"><span className="live-dot" /> TRACENET · BY TEAM TRACE FORCE</div>
            <h1>TRACE <span>NET</span></h1>
            <p>City-wide AI engine for multi-camera ANPR tracking, live traffic intelligence and decisive field response.</p>
            <div className="pointer-events-auto mt-8 flex flex-wrap justify-center gap-3">
              <button onClick={() => navigate("dashboard")} className="btn-primary px-6 py-3 text-sm"><Zap size={16} /> Open command center</button>
              <button onClick={track} className="btn-glass px-6 py-3 text-sm"><Navigation size={16} /> Track a vehicle</button>
            </div>
          </div>
          <div className="hero-scroll-cue"><span>Scroll to enter</span><ChevronDown size={18} /></div>
        </div>
      </section>

      <section className="platform-overview relative z-10 mx-auto max-w-6xl px-4 pb-14 sm:px-6 lg:px-8">
        <div className="section-heading">
          <span><Radar size={14} /> FOUR CONNECTED COMMAND SURFACES</span>
          <h2>See the city as one intelligence system.</h2>
          <p>From a single plate observation to city-wide response, every action stays connected to the same real-time operational picture.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <FeatureCard
            icon={LayoutDashboard}
            title="Dashboard"
            eyebrow="01 / OBSERVE"
            theme="purple"
            bgImage="https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=800&auto=format&fit=crop"
            liveBadge="42 km/h avg"
            liveStatusColor="bg-purple-400"
            description="Real-Time City Overview. Centralized performance metrics, camera availability, and average network speeds across urban sectors."
            buttonText="View Dashboard"
            onClick={() => navigate("dashboard")}
          />
          <FeatureCard
            icon={Navigation}
            title="Tracking"
            eyebrow="02 / TRACE"
            theme="blue"
            bgImage="https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?q=80&w=800&auto=format&fit=crop"
            liveBadge="254 Feeds Active"
            liveStatusColor="bg-blue-400"
            description="Spatial-Temporal Vehicle Tracking. Reconstruct complete paths and cross-camera trajectories from ANPR feeds with millisecond precision."
            buttonText="Launch Tracking"
            onClick={track}
          />
          <FeatureCard
            icon={TrafficCone}
            title="Traffic"
            eyebrow="03 / UNDERSTAND"
            theme="orange"
            bgImage="https://images.unsplash.com/photo-1506146332389-18140dc7b2fb?q=80&w=800&auto=format&fit=crop"
            liveBadge="3 Congestion Zones"
            liveStatusColor="bg-amber-400"
            description="City-Wide Traffic Analytics. Macro WebGL corridor heatmaps, origin-destination arcs, and bottleneck prediction."
            buttonText="Analyze Traffic"
            onClick={() => navigate("traffic")}
          />
          <FeatureCard
            icon={Bell}
            title="Alerts"
            eyebrow="04 / RESPOND"
            theme="red"
            bgImage="https://images.unsplash.com/photo-1558494949-ef010cbdcc31?q=80&w=800&auto=format&fit=crop"
            liveBadge="3 Priority Flags"
            liveStatusColor="bg-rose-400"
            isPulse={true}
            description="Anomalous Route & Blacklist Alerts. Real-time notifications for stolen vehicles, suspicious routes, and perimeter violations."
            buttonText="View Alerts"
            onClick={() => navigate("alerts")}
          />
        </div>
      </section>

      <section className="telemetry-strip mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="status-reveal telemetry-panel">
          <Stat value={254} label="Camera nodes" />
          <Stat value={99} suffix=".98%" label="Network uptime" />
          <Stat value={14} suffix=" ms" label="Inference latency" />
          <Stat value={1400000} suffix="+" label="Plates indexed today" />
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 pb-14 pt-5 sm:px-6 lg:px-8">
        <div className="status-reveal system-status-bar">
          <div className="flex items-center gap-3"><span className="live-dot" /><span className="text-sm font-semibold text-[var(--text-primary)]">All AI systems operational</span></div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            <span><Route size={13} /> Trajectory engine</span><span><Activity size={13} /> Traffic engine</span><span><ShieldAlert size={13} /> Alert service</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
