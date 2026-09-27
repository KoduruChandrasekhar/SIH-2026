import { forwardRef } from "react";
import { ArrowRight, Bell, LayoutDashboard, Navigation, TrafficCone } from "lucide-react";
import { areas } from "../../data/data";
import { DEMO_ROUTE_PATH, cameraDisplayId } from "../../data/demoData";

const SEVERITY_DOT = { CRITICAL: "bg-red-500", HIGH: "bg-orange-500", MEDIUM: "bg-amber-400" };

// Card shell shared by the four modules
const Module = forwardRef(function Module(
  { mode, active, step, icon: Icon, accent, badge, badgeDot, title, description, cta, onCta, onFocus, children },
  ref
) {
  return (
    <article
      ref={ref}
      data-mode={mode}
      onFocus={onFocus}
      className={`tn-module ${active ? "is-active" : ""}`}
      style={{ "--tn-accent": accent }}
      aria-current={active ? "true" : undefined}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="tn-module-icon">
            <Icon size={18} aria-hidden="true" />
          </span>
          <span className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-slate-500">{step}</span>
        </div>
        {badge && (
          <span className="tn-module-badge">
            <span className={`h-1.5 w-1.5 rounded-full ${badgeDot}`} aria-hidden="true" />
            {badge}
          </span>
        )}
      </div>

      <h3 className="mt-4 text-lg font-extrabold leading-snug text-white sm:text-xl">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-slate-400">{description}</p>

      <div className="mt-5">{children}</div>

      <button type="button" onClick={onCta} className="tn-module-cta">
        {cta}
        <ArrowRight size={15} className="tn-btn-arrow" aria-hidden="true" />
      </button>
    </article>
  );
});

function OdBars({ odRoutes }) {
  const max = Math.max(...odRoutes.map((r) => parseInt(String(r.count).replace(/\D/g, ""), 10) || 0), 1);
  return (
    <ul className="space-y-2.5" aria-label="Top origin–destination routes">
      {odRoutes.slice(0, 3).map((r) => {
        const v = parseInt(String(r.count).replace(/\D/g, ""), 10) || 0;
        return (
          <li key={`${r.origin}-${r.destination}`}>
            <div className="flex items-baseline justify-between gap-3 text-[11.5px] font-semibold">
              <span className="truncate text-slate-300">
                {r.origin} <span className="text-slate-500">→</span> {r.destination}
              </span>
              <span className="shrink-0 tabular-nums text-slate-400">{r.count}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div className="tn-bar h-full rounded-full bg-gradient-to-r from-sky-500 to-blue-500" style={{ width: `${(v / max) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ZoneSpeeds() {
  const max = Math.max(...areas.map((a) => parseInt(a.speed, 10)));
  return (
    <div className="flex h-24 items-end gap-2.5" role="img" aria-label="Average speed by city zone, km/h at the evening peak">
      {areas.map((a) => {
        const speed = parseInt(a.speed, 10);
        return (
          <div key={a.name} className="flex flex-1 flex-col items-center gap-1.5" data-tip={`${a.title}: ${a.speed}`}>
            <span className="text-[10px] font-bold tabular-nums text-slate-400">{speed}</span>
            <div className="w-full rounded-t-md" style={{ height: `${(speed / max) * 44}px`, background: a.color, opacity: 0.75 }} />
            <span className="w-full truncate text-center text-[9.5px] font-semibold text-slate-500">{a.name.split(" /")[0]}</span>
          </div>
        );
      })}
    </div>
  );
}

function TrajectoryStrip({ reducedMotion }) {
  const xs = [14, 98, 182, 266];
  const path = "M14 30 C 50 8, 62 8, 98 30 S 146 52, 182 30 S 230 8, 266 30";
  return (
    <svg viewBox="0 0 280 62" className="h-16 w-full" role="img" aria-label={`Trajectory across ${DEMO_ROUTE_PATH.map(cameraDisplayId).join(", ")}`}>
      <path d={path} fill="none" stroke="rgba(96,165,250,0.25)" strokeWidth="6" strokeLinecap="round" />
      <path d={path} fill="none" stroke="#60a5fa" strokeWidth="2" strokeDasharray="5 6" className={reducedMotion ? "" : "tn-svg-dash"} />
      {xs.map((x, i) => (
        <g key={x}>
          <circle cx={x} cy="30" r="6" fill="#0b1220" stroke="#818cf8" strokeWidth="2" />
          <text x={x} y="58" textAnchor="middle" className="fill-slate-400" fontSize="9" fontWeight="700">
            {cameraDisplayId(DEMO_ROUTE_PATH[i])}
          </text>
        </g>
      ))}
      <circle r="4.5" fill="#fff" stroke="#3b82f6" strokeWidth="2" cx={reducedMotion ? 266 : undefined} cy={reducedMotion ? 30 : undefined}>
        {!reducedMotion && <animateMotion dur="5s" repeatCount="indefinite" path={path} />}
      </circle>
    </svg>
  );
}

function PriorityAlerts({ alerts }) {
  return (
    <ul className="divide-y divide-slate-800/80 rounded-xl border border-slate-800/80 bg-slate-950/40">
      {alerts.slice(0, 3).map((a) => (
        <li key={a.id} className="flex items-center gap-3 px-3 py-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[a.severity] ?? "bg-slate-500"}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-300">{a.category}</span>
          <span className="shrink-0 font-mono text-[11px] text-slate-500">{a.plateNumber}</span>
        </li>
      ))}
    </ul>
  );
}

export default function FeatureModules({ activeMode, setModuleRef, onFocusModule, navigate, telemetry, reducedMotion }) {
  const { avgSpeed, nodes, alerts, odRoutes } = telemetry;
  const priority = alerts.filter((a) => a.status === "Active" && (a.severity === "CRITICAL" || a.severity === "HIGH"));

  const common = (mode) => ({ mode, active: activeMode === mode, ref: setModuleRef(mode), onFocus: () => onFocusModule(mode) });

  return (
    <div className="tn-module-stack">
      <div className="tn-module-slot" data-reveal>
        <Module
          {...common("overview")}
          step="01 · Dashboard"
          icon={LayoutDashboard}
          accent="#a78bfa"
          badge={`${avgSpeed} avg`}
          badgeDot="bg-violet-400"
          title="Dashboard"
          description="Real-time city overview with centralized performance metrics, average network speed and active urban nodes."
          cta="View Dashboard"
          onCta={() => navigate("dashboard")}
        >
          <ZoneSpeeds />
        </Module>
      </div>

      <div className="tn-module-slot" data-reveal>
        <Module
          {...common("trajectory")}
          step="02 · Tracking"
          icon={Navigation}
          accent="#60a5fa"
          badge={`${nodes} Feeds Active`}
          badgeDot="bg-blue-400"
          title="Tracking"
          description="Spatial-temporal vehicle tracking that reconstructs complete vehicle trajectories from multiple ANPR camera feeds."
          cta="Launch Tracking"
          onCta={() => navigate("tracking")}
        >
          <TrajectoryStrip reducedMotion={reducedMotion} />
        </Module>
      </div>

      <div className="tn-module-slot" data-reveal>
        <Module
          {...common("flow")}
          step="03 · Traffic"
          icon={TrafficCone}
          accent="#38bdf8"
          badge={`${odRoutes.length} OD corridors`}
          badgeDot="bg-sky-400"
          title="Traffic — Macro Flow & Origin Analytics"
          description="City-wide analytics that aggregates live feeds to understand corridor density, origin-destination movement patterns and traffic bottlenecks."
          cta="Analyze Traffic"
          onCta={() => navigate("traffic")}
        >
          <OdBars odRoutes={odRoutes} />
        </Module>
      </div>

      <div className="tn-module-slot" data-reveal>
        <Module
          {...common("alerts")}
          step="04 · Alerts"
          icon={Bell}
          accent="#f87171"
          badge={`${priority.length} Priority Flags`}
          badgeDot="bg-red-500 tn-live-dot"
          title="Alerts & Congestion Zones"
          description="Anomalous route detection, blacklist alerts and high-priority notifications for vehicles requiring attention."
          cta="View Alerts"
          onCta={() => navigate("alerts")}
        >
          <PriorityAlerts alerts={priority.length ? priority : alerts} />
        </Module>
      </div>
    </div>
  );
}
