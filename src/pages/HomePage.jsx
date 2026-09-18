import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  ChevronDown,
  LayoutDashboard,
  Navigation,
  Radar,
  Route,
  ShieldAlert,
  TrafficCone,
  Zap,
  Camera,
  Globe,
} from "lucide-react";
import Navbar from "../components/Navbar";
import { slides } from "../data";

// Lazy load Earth globe for smooth rendering
const EarthGlobe = lazy(() => import("../components/EarthGlobe"));

/* ──────────────────────────────────────────
   Animated Counter Component
   ────────────────────────────────────────── */
function AnimatedCounter({ target, suffix = "", prefix = "", duration = 2000 }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          const startTime = Date.now();
          const tick = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.round(target * eased));
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target, duration]);

  return (
    <span ref={ref}>
      {prefix}{count.toLocaleString()}{suffix}
    </span>
  );
}

/* ──────────────────────────────────────────
   Loading fallback for Earth globe
   ────────────────────────────────────────── */
function GlobeLoader() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative">
        <div className="w-32 h-32 rounded-full border border-blue-500/20 animate-pulse" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Globe size={32} className="text-blue-500/40 animate-spin" style={{ animationDuration: "3s" }} />
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────
   Feature Card
   ────────────────────────────────────────── */
function FeatureCard({ icon: Icon, title, description, onClick, accentColor, delay, liveBadge }) {
  return (
    <div
      onClick={onClick}
      className="feature-card fade-up group"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Gradient border glow on hover */}
      <div
        className="absolute inset-0 rounded-[20px] opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10"
        style={{
          background: `radial-gradient(600px circle at 50% 50%, ${accentColor}15, transparent 70%)`,
        }}
      />

      <div className="flex items-start justify-between mb-4">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-300 group-hover:scale-110"
          style={{
            background: `${accentColor}15`,
            color: accentColor,
          }}
        >
          <Icon size={20} strokeWidth={2} />
        </div>

        {liveBadge && (
          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold"
            style={{
              background: `${accentColor}12`,
              color: accentColor,
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: accentColor,
                boxShadow: `0 0 6px ${accentColor}`,
                animation: "pulse-glow 2s ease-in-out infinite",
              }}
            />
            {liveBadge}
          </div>
        )}
      </div>

      <h3 className="text-base font-bold text-[var(--text-primary)] mb-2">{title}</h3>
      <p className="text-[13px] leading-relaxed text-[var(--text-secondary)] mb-5 min-h-[40px]">
        {description}
      </p>

      <button
        className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-bold transition-all duration-300"
        style={{
          background: `${accentColor}10`,
          color: accentColor,
          border: `1px solid ${accentColor}20`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = `${accentColor}20`;
          e.currentTarget.style.borderColor = `${accentColor}40`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = `${accentColor}10`;
          e.currentTarget.style.borderColor = `${accentColor}20`;
        }}
      >
        Launch <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
      </button>
    </div>
  );
}

/* ──────────────────────────────────────────
   Stat Item
   ────────────────────────────────────────── */
function StatItem({ value, label, suffix = "", prefix = "" }) {
  return (
    <div className="text-center px-6">
      <div className="text-2xl sm:text-3xl font-black text-[var(--text-primary)] tracking-tight">
        <AnimatedCounter target={value} suffix={suffix} prefix={prefix} />
      </div>
      <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mt-1">
        {label}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────
   Status Item
   ────────────────────────────────────────── */
function StatusItem({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
      <Icon size={14} className="text-[var(--text-dim)]" />
      {text}
    </div>
  );
}

/* ──────────────────────────────────────────
   Main HomePage Component
   ────────────────────────────────────────── */
export default function HomePage({ navigate, openModal }) {
  const [scrollY, setScrollY] = useState(0);
  const heroRef = useRef(null);

  // Track scroll for parallax effects
  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Calculate hero opacity and transform based on scroll
  const heroOpacity = Math.max(0, 1 - scrollY / 600);
  const heroScale = Math.max(0.6, 1 - scrollY / 2000);
  const heroTranslateY = scrollY * 0.4;

  // Live telemetry tickers
  const [liveSpeed, setLiveSpeed] = useState(42);
  const [activeFeeds, setActiveFeeds] = useState(254);

  useEffect(() => {
    const interval = setInterval(() => {
      setLiveSpeed(prev => Math.max(30, Math.min(55, prev + (Math.random() > 0.5 ? 1 : -1))));
      setActiveFeeds(250 + Math.floor(Math.random() * 8));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative w-full">
      {/* ═══════════════════════════════════════
          SECTION 1: HERO — Full-Screen Earth Globe
          ═══════════════════════════════════════ */}
      <section ref={heroRef} className="relative h-screen w-full overflow-hidden">
        {/* Radial gradient backdrop */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(59,130,246,0.12),transparent_70%)]" />

        {/* 3D Earth Globe */}
        <div
          className="absolute inset-0 z-0"
          style={{
            opacity: heroOpacity,
            transform: `scale(${heroScale}) translateY(${heroTranslateY}px)`,
            transition: "transform 0.1s linear",
          }}
        >
          <Suspense fallback={<GlobeLoader />}>
            {EarthGlobe && <EarthGlobe />}
          </Suspense>
        </div>

        {/* Hero overlay content */}
        <div className="relative z-10 flex h-full flex-col">
          {/* Navbar */}
          <div className="fade-up px-4 pt-4 sm:px-6 lg:px-8">
            <Navbar page="home" navigate={navigate} openModal={openModal} />
          </div>

          {/* Hero text */}
          <div className="flex flex-1 flex-col items-center justify-center px-4 text-center"
            style={{ opacity: heroOpacity }}
          >
            <div className="fade-up delay-200">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-glass)] px-4 py-1.5 backdrop-blur-xl">
                <span className="live-dot" style={{ width: 6, height: 6 }} />
                <span className="text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                  AI Traffic Intelligence Platform
                </span>
              </div>
            </div>

            <h1 className="fade-up delay-300 text-5xl sm:text-7xl lg:text-8xl font-black tracking-tighter text-[var(--text-primary)] mb-4">
              <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-500 bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(59,130,246,0.4)]">
                TraceNet
              </span>
            </h1>

            <p className="fade-up delay-400 max-w-2xl text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed mb-8">
              City-Wide AI Engine for Multi-Camera ANPR Trajectory Tracking & Urban Traffic Analytics
            </p>

            <div className="fade-up delay-500 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => navigate("dashboard")}
                className="btn-primary text-sm px-6 py-3"
              >
                <Zap size={16} /> Launch Dashboard
              </button>
              <button
                onClick={() => navigate("tracking")}
                className="btn-glass text-sm px-6 py-3"
              >
                <Navigation size={16} /> Track Vehicle
              </button>
            </div>
          </div>

          {/* Scroll indicator */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
            style={{ opacity: Math.max(0, 1 - scrollY / 200) }}
          >
            <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Scroll to explore</span>
            <ChevronDown size={20} className="text-[var(--text-muted)] animate-scroll-hint" />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════
          SECTION 2: Feature Cards
          ═══════════════════════════════════════ */}
      <section className="relative z-10 mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 -mt-20">
        {/* Gradient fade from hero */}
        <div className="absolute -top-40 left-0 right-0 h-40 bg-gradient-to-b from-transparent to-[var(--bg-void)] pointer-events-none" />

        <div className="relative grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard
            icon={LayoutDashboard}
            title="Dashboard"
            description="Real-time city overview. Centralized performance metrics and network speeds."
            onClick={() => navigate("dashboard")}
            accentColor="#8b5cf6"
            delay={0}
            liveBadge={`${liveSpeed} km/h avg`}
          />
          <FeatureCard
            icon={Navigation}
            title="Tracking"
            description="Spatial-temporal vehicle tracking. Reconstruct complete paths from ANPR feeds."
            onClick={() => navigate("tracking")}
            accentColor="#3b82f6"
            delay={100}
            liveBadge={`${activeFeeds} Feeds`}
          />
          <FeatureCard
            icon={TrafficCone}
            title="Traffic Analytics"
            description="City-wide flow analysis. Visualize origin-destination patterns and congestion."
            onClick={() => navigate("traffic")}
            accentColor="#f59e0b"
            delay={200}
            liveBadge="3 Zones Active"
          />
          <FeatureCard
            icon={Bell}
            title="Alert Center"
            description="Blacklist detection and anomaly alerts. Real-time threat monitoring system."
            onClick={() => navigate("alerts")}
            accentColor="#ef4444"
            delay={300}
            liveBadge="3 Priority"
          />
        </div>
      </section>

      {/* ═══════════════════════════════════════
          SECTION 3: Live Stats Strip
          ═══════════════════════════════════════ */}
      <section className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mt-12 mb-6">
        <div className="glass-card-static flex flex-wrap items-center justify-around py-8 px-6 gap-6">
          <StatItem value={254} label="Camera Nodes" />
          <div className="hidden sm:block w-px h-10 bg-[var(--border-subtle)]" />
          <StatItem value={99} suffix=".98%" label="Uptime" />
          <div className="hidden sm:block w-px h-10 bg-[var(--border-subtle)]" />
          <StatItem value={14} suffix="ms" label="Inference Latency" />
          <div className="hidden sm:block w-px h-10 bg-[var(--border-subtle)]" />
          <StatItem value={1428910} label="Plates Indexed Today" />
        </div>
      </section>

      {/* ═══════════════════════════════════════
          SECTION 4: System Status
          ═══════════════════════════════════════ */}
      <section className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mb-16">
        <div className="glass-card-static flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="live-dot" />
            <span className="text-xs font-bold text-[var(--text-primary)]">
              All core AI systems operational
            </span>
          </div>
          <div className="flex flex-wrap gap-6">
            <StatusItem icon={Route} text="Trajectory Engine" />
            <StatusItem icon={Activity} text="Traffic Engine" />
            <StatusItem icon={ShieldAlert} text="Alert Service" />
          </div>
        </div>
      </section>
    </div>
  );
}