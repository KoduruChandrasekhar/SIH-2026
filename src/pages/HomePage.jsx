import { Activity, Route, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Navbar from "../components/Navbar";
import HeroSection from "../components/home/HeroSection";
import FeatureModules from "../components/home/FeatureModules";
import CommandMap from "../components/home/CommandMap";
import usePrefersReducedMotion from "../hooks/usePrefersReducedMotion";
import { alertsFeed, systemMetrics, trafficSummary } from "../data";
import { fetchAlerts, fetchDashboard, fetchTraffic } from "../api";

// Real values from the TraceNet API when it is reachable, otherwise the local demo dataset.
function useHomeTelemetry() {
  const [telemetry, setTelemetry] = useState({
    source: "demo",
    nodes: systemMetrics.totalNodesActive,
    avgSpeed: trafficSummary.networkAverageSpeed,
    odRoutes: trafficSummary.odRoutes,
    alerts: alertsFeed,
  });

  useEffect(() => {
    let alive = true;
    Promise.all([fetchDashboard(), fetchTraffic(), fetchAlerts()]).then(([dashboard, traffic, alerts]) => {
      if (!alive || (!dashboard && !traffic && !alerts)) return;
      setTelemetry((prev) => ({
        source: "api",
        nodes: dashboard?.systemMetrics?.totalNodesActive ?? prev.nodes,
        avgSpeed: traffic?.metrics?.networkAverageSpeed ?? prev.avgSpeed,
        odRoutes: traffic?.odRoutes ?? prev.odRoutes,
        alerts: alerts ?? prev.alerts,
      }));
    });
    return () => {
      alive = false;
    };
  }, []);

  return telemetry;
}

export default function HomePage({ navigate, openModal }) {
  const reducedMotion = usePrefersReducedMotion();
  const telemetry = useHomeTelemetry();
  const [mapMode, setMapMode] = useState("overview");
  const contentRef = useRef(null);

  // Stable callback refs for the four feature modules
  const moduleEls = useRef({});
  const refSetters = useRef({});
  const setModuleRef = useCallback((mode) => {
    if (!refSetters.current[mode]) {
      refSetters.current[mode] = (el) => {
        if (el) moduleEls.current[mode] = el;
        else delete moduleEls.current[mode];
      };
    }
    return refSetters.current[mode];
  }, []);

  // The module crossing the middle of the viewport drives the map layer
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setMapMode(entry.target.dataset.mode);
        });
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );
    Object.values(moduleEls.current).forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Reveal cards / map as they enter the viewport (class toggled directly — no re-renders)
  useEffect(() => {
    const root = contentRef.current;
    if (!root || reducedMotion) return;
    const targets = root.querySelectorAll("[data-reveal]");
    root.classList.add("tn-reveal-ready");
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-revealed");
            io.unobserve(e.target);
          }
        }),
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 }
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [reducedMotion]);

  const enterCommandCenter = () => {
    contentRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  };

  return (
    // The homepage is always rendered in TraceNet's dark command-center palette
    <div data-theme="dark" className="tn-home">
      <div className="tn-home-nav">
        <div className="mx-auto max-w-[1400px] px-3 pt-3 sm:px-6 lg:px-8">
          <Navbar page="home" navigate={navigate} openModal={openModal} />
        </div>
      </div>

      <HeroSection navigate={navigate} onEnter={enterCommandCenter} reducedMotion={reducedMotion} />

      <main
        ref={contentRef}
        id="command-center"
        aria-labelledby="tn-cc-title"
        className="tn-analytics relative scroll-mt-[var(--tn-nav-h)]"
      >
        <div className="mx-auto max-w-[1400px] px-4 pb-20 pt-16 sm:px-6 lg:px-8 lg:pt-20">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
            {/* LEFT — feature modules */}
            <div className="lg:col-span-5">
              <header data-reveal className="mb-10 max-w-[30rem]">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.3em] text-blue-400">Command Center</p>
                <h2 id="tn-cc-title" className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
                  One intelligence layer across every camera in the city.
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">
                  From the city overview down to a single vehicle's path — each module below drives the live GIS view.
                </p>
              </header>

              <FeatureModules
                activeMode={mapMode}
                setModuleRef={setModuleRef}
                onFocusModule={setMapMode}
                navigate={navigate}
                telemetry={telemetry}
                reducedMotion={reducedMotion}
              />
            </div>

            {/* RIGHT — sticky GIS map */}
            <div className="lg:col-span-7">
              <div data-reveal className="tn-map-sticky">
                <CommandMap
                  mode={mapMode}
                  onModeChange={setMapMode}
                  telemetry={telemetry}
                  navigate={navigate}
                  reducedMotion={reducedMotion}
                />
              </div>
            </div>
          </div>

          {/* System status strip */}
          <section
            aria-label="System status"
            className="mt-16 flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-center gap-3">
              <span
                className={`tn-live-dot h-2.5 w-2.5 rounded-full ${telemetry.source === "api" ? "bg-emerald-500" : "bg-amber-400"}`}
                aria-hidden="true"
              />
              <span className="text-xs font-extrabold text-slate-200">
                {telemetry.source === "api"
                  ? "All core AI systems operational"
                  : "Demo mode — backend offline, showing the local TraceNet dataset"}
              </span>
            </div>
            <div className="flex flex-wrap gap-6">
              <StatusItem icon={Route} text="Trajectory Engine" />
              <StatusItem icon={Activity} text="Traffic Engine" />
              <StatusItem icon={ShieldAlert} text="Alert Service" />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function StatusItem({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[1px] text-slate-400">
      <Icon size={14} className="text-slate-500" aria-hidden="true" />
      {text}
    </div>
  );
}
