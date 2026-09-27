import { useState } from "react";
import {
  Bell,
  Cctv,
  Cpu,
  Home,
  LayoutDashboard,
  LogIn,
  Menu,
  Moon,
  Navigation,
  Search,
  ShieldCheck,
  Sun,
  TrafficCone,
  X,
} from "lucide-react";

import tracenetLogo from "../../assets/tracenet-logo.jpg"; 
import { useTheme } from "../../context/ThemeContext";
import { useAlerts } from "../../context/AlertsContext";
import { useSession } from "../../hooks/useSession";
import { isMac, openCommandPalette } from "./CommandPalette";

export default function Navbar({ page, navigate }) {
  const { unread, connected } = useAlerts();
  const session = useSession();
  const { theme, toggleTheme } = useTheme();
  // Below xl the links collapse behind a menu button
  const [menuOpen, setMenuOpen] = useState(false);
  const go = (target) => {
    setMenuOpen(false);
    navigate(target);
  };

  const item = (label, icon, target) => {
    const Icon = icon;
    
    // BULLETPROOF ACTIVE CHECK: ignores capitals, spaces, and undefined errors
    const isActive = String(page).toLowerCase().trim() === String(target).toLowerCase().trim();

    return (
      <button
        key={label}
        onClick={() => go(target)}
        aria-current={isActive ? "page" : undefined}
        className={`
          group
          relative
          flex
          items-center
          gap-2
          rounded-xl
          px-2.5 2xl:px-3.5
          py-2
          text-xs
          sm:text-sm
          font-bold
          transition-all
          duration-300
          overflow-hidden
          ${
            isActive
              ? "text-blue-700"
              : "text-[#636366] hover:bg-blue-50 hover:text-blue-600"
          }
        `}
      >
        {/* Active pill — one view-transition-name, so it slides between tabs on page change */}
        {isActive && <span className="tn-nav-pill" aria-hidden="true" />}
        <Icon
          size={16}
          className={`
            relative
            z-10
            transition-all
            duration-300
            ${isActive ? "text-blue-600" : "group-hover:text-blue-600"}
          `}
        />
        <span className="relative z-10">{label}</span>

        {/* Hover Indicator Slide Bar */}
        <span 
          className={`absolute bottom-0 left-0 h-[2px] w-full bg-blue-600 origin-left transition-transform duration-300 ${
            isActive ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
          }`} 
        />
      </button>
    );
  };

  const isAlertsActive = String(page).toLowerCase().trim() === "alerts";

  return (
    <header
      className="
        tn-navbar
        relative
        flex
        flex-col
        gap-4
        rounded-[24px]
        border
        border-white/80
        bg-white/80
        px-5
        py-3.5
        shadow-[0_8px_32px_rgba(0,0,0,0.06)]
        backdrop-blur-2xl
        xl:flex-row
        xl:items-center
        xl:justify-between
        transition-all
      "
    >
      {/* BRAND LOGO & TITLE */}
      <div className="flex items-center justify-between xl:justify-start gap-4">
        <button
          onClick={() => go("home")}
          className="group flex items-center gap-3 text-left transition-transform active:scale-95"
        >
          {/* Logo Image */}
          <img 
            src={tracenetLogo} 
            alt="TraceNet Icon" 
            className="h-10 w-10 sm:h-12 sm:w-12 object-contain transition-transform duration-500 group-hover:scale-110 drop-shadow-md"
          />

          <div>
            <div className="flex items-center gap-2">
              <h1
                className="
                  text-2xl
                  sm:text-3xl
                  font-black
                  tracking-tighter
                  text-transparent
                  bg-clip-text
                  bg-gradient-to-r
                  from-blue-500
                  via-cyan-400
                  to-blue-600
                  drop-shadow-[0_0_15px_rgba(59,130,246,0.8)]
                  transition-all
                  duration-300
                  group-hover:drop-shadow-[0_0_25px_rgba(59,130,246,1)]
                "
              >
                TraceNet
              </h1>
            </div>
            <p
              className="
                hidden
                text-[10px]
                font-extrabold
                uppercase
                tracking-[2px]
                text-blue-500
                drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]
                md:block xl:hidden 2xl:block
              "
            >
              AI Traffic Intelligence
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="tn-nav-toggle flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-[#636366] transition hover:text-blue-600"
          aria-expanded={menuOpen}
          aria-controls="tn-primary-nav"
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* NAVIGATION LINKS & CONTROLS */}
      <nav
        id="tn-primary-nav"
        aria-label="Primary"
        className={`
          tn-nav-menu
          flex-wrap
          items-center
          gap-1
          sm:gap-1.5
          xl:flex-nowrap
          ${menuOpen ? "is-open" : ""}
        `}
      >
        {item("Home", Home, "home")}
        {item("Dashboard", LayoutDashboard, "dashboard")}
        {item("Cameras", Cctv, "cameras")}
        {item("Tracking", Navigation, "tracking")}
        {item("Traffic", TrafficCone, "traffic")}
        {item("Pipeline", Cpu, "pipeline")}
        {session?.role === "camera_admin" && item("Admin", ShieldCheck, "admin")}

        {/* Alerts Route Button with Red FX */}
        <button
          onClick={() => go("alerts")}
          aria-current={isAlertsActive ? "page" : undefined}
          className={`
            group
            relative
            flex
            items-center
            gap-1.5
            rounded-xl
            px-2.5 2xl:px-3.5
            py-2
            text-xs
            font-bold
            transition-all
            duration-300
            sm:text-sm
            overflow-hidden
            ${
              isAlertsActive
                ? "text-red-600"
                : "text-[#636366] hover:bg-red-500/10 hover:text-red-600 hover:shadow-[inset_0_0_0_1px_rgba(239,68,68,0.2)]"
            }
          `}
        >
          {isAlertsActive && <span className="tn-nav-pill tn-nav-pill--alert" aria-hidden="true" />}
          <span className="relative z-10">
            <Bell size={16} className="text-red-500" />
            {unread > 0 && (
              <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black leading-none text-white" aria-label={`${unread} new alerts`}>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
          <span className="relative z-10" data-tip={connected ? "Live alert stream connected" : undefined}>Alerts</span>
          <span 
            className={`absolute bottom-0 left-0 h-[2px] w-full bg-red-500 origin-left transition-transform duration-300 ${isAlertsActive ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"}`} 
          />
        </button>

        <div className="mx-1.5 hidden h-5 w-[1px] rounded-full bg-gray-200 sm:block" />

        {/* Command palette */}
        <button
          type="button"
          onClick={() => {
            setMenuOpen(false);
            openCommandPalette();
          }}
          className="tn-cmdk-trigger"
          aria-label="Open command palette"
          aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
          data-tip="Search modules, cameras, plates"
          data-tip-pos="bottom"
        >
          <Search size={15} aria-hidden="true" />
          <kbd>{isMac ? "⌘" : "Ctrl"} K</kbd>
        </button>

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="theme-toggle-btn"
          data-tip={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          data-tip-pos="bottom"
          aria-label="Toggle theme"
        >
          {theme === "light" ? (
            <Moon size={16} className="transition-transform duration-300 hover:rotate-12" />
          ) : (
            <Sun size={16} className="text-amber-400 transition-transform duration-300 hover:rotate-45" />
          )}
        </button>

        {/* Operator Login Button */}
        <button
          onClick={() => go("login")}
          aria-label={session ? `Signed in as ${session.username} — switch user` : "Operator login"}
          data-tip={session ? `${session.name} · ${session.role === "camera_admin" ? "Admin" : "Operator"}` : undefined}
          data-tip-pos="bottom"
          className="
            group
            relative
            flex
            items-center
            gap-2
            overflow-hidden
            rounded-xl
            bg-gray-900
            px-4
            py-2
            text-xs
            font-bold
            text-white
            shadow-[0_4px_14px_rgba(0,0,0,0.15)]
            transition-all
            duration-300
            hover:shadow-[0_6px_20px_rgba(37,99,235,0.3)]
            active:scale-[0.97]
            sm:text-sm
          "
        >
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <span className="relative z-10 hidden sm:inline">{session ? session.username : "Login"}</span>
          <LogIn
            size={16}
            className="relative z-10 transition-transform duration-300 group-hover:translate-x-1"
          />
        </button>
      </nav>
    </header>
  );
}