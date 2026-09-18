import {
  Bell,
  Home,
  LayoutDashboard,
  LogIn,
  Navigation,
  TrafficCone,
} from "lucide-react";

import tracenetLogo from "../assets/traceforce-logo.png";

export default function Navbar({ page, navigate, openModal }) {
  const navItem = (label, icon, target) => {
    const Icon = icon;
    const isActive =
      String(page).toLowerCase().trim() === String(target).toLowerCase().trim();

    return (
      <button
        key={label}
        onClick={() => navigate(target)}
        className={`nav-link ${isActive ? "active" : ""}`}
      >
        <Icon
          size={15}
          className={`transition-all duration-300 ${
            isActive
              ? "text-[var(--accent-blue)]"
              : "group-hover:text-[var(--text-primary)]"
          }`}
        />
        <span>{label}</span>
      </button>
    );
  };

  const isAlertsActive =
    String(page).toLowerCase().trim() === "alerts";

  return (
    <header className="nav-glass flex flex-col gap-4 px-5 py-3.5 lg:flex-row lg:items-center lg:justify-between">
      {/* BRAND */}
      <div className="flex items-center justify-between lg:justify-start gap-4">
        <button
          onClick={() => navigate("home")}
          className="group flex items-center gap-3 text-left transition-transform active:scale-95"
        >
          <div className="relative flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.1] p-1 shadow-[0_0_15px_rgba(59,130,246,0.3)] transition-all duration-500 group-hover:scale-105 group-hover:border-blue-500/50 group-hover:shadow-[0_0_25px_rgba(59,130,246,0.5)]">
            <img
              src={tracenetLogo}
              alt="Trace Force Logo"
              className="h-full w-full object-contain rounded-lg"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black tracking-tight bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-500 bg-clip-text text-transparent drop-shadow-[0_0_15px_rgba(59,130,246,0.5)]">
                TraceNet
              </h1>
            </div>
            <p className="hidden md:block text-[9px] font-extrabold uppercase tracking-[1.5px] text-[var(--text-muted)]">
              by <span className="text-cyan-400 font-bold">Trace Force</span>
            </p>
          </div>
        </button>
      </div>

      {/* NAV LINKS */}
      <nav className="flex flex-wrap items-center gap-1 sm:gap-1.5 lg:flex-nowrap">
        {navItem("Home", Home, "home")}
        {navItem("Dashboard", LayoutDashboard, "dashboard")}
        {navItem("Tracking", Navigation, "tracking")}
        {navItem("Traffic", TrafficCone, "traffic")}

        {/* Alerts — red accent */}
        <button
          onClick={() => navigate("alerts")}
          className={`nav-link-alert ${isAlertsActive ? "active" : ""}`}
        >
          <Bell
            size={15}
            className={`transition-all duration-300 ${
              isAlertsActive ? "text-[var(--accent-red)]" : ""
            }`}
          />
          <span>Alerts</span>
        </button>

        <div className="mx-1.5 hidden h-5 w-px rounded-full bg-[var(--border-subtle)] sm:block" />

        {/* Operator Login */}
        <button
          onClick={() => navigate("login")}
          className="group relative flex items-center gap-2 overflow-hidden rounded-xl px-4 py-2 text-xs font-bold text-white shadow-[0_4px_14px_rgba(59,130,246,0.2)] transition-all duration-300 hover:scale-105 hover:shadow-[0_6px_20px_rgba(59,130,246,0.35)] active:scale-95 sm:text-sm"
          style={{
            background: "linear-gradient(135deg, var(--accent-blue), #6366f1)",
          }}
        >
          <span className="relative z-10 hidden sm:inline">Login</span>
          <LogIn
            size={16}
            className="relative z-10 transition-transform duration-300 group-hover:translate-x-1"
          />
        </button>
      </nav>
    </header>
  );
}