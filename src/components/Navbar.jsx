import { Bell, Home, LayoutDashboard, LogIn, Navigation, TrafficCone } from "lucide-react";
import traceForceLogo from "../assets/traceforce-logo.png";

const links = [
  ["Home", Home, "home"],
  ["Dashboard", LayoutDashboard, "dashboard"],
  ["Tracking", Navigation, "tracking"],
  ["Traffic", TrafficCone, "traffic"],
  ["Alerts", Bell, "alerts"],
];

export default function Navbar({ page, navigate, launchTracking }) {
  const open = (target) => target === "tracking" && launchTracking ? launchTracking() : navigate(target);
  return (
    <header className="nav-glass">
      <button onClick={() => navigate("home")} className="nav-brand group" aria-label="TraceNet home">
        <span className="nav-logo transition-transform duration-300 group-hover:rotate-6 group-hover:scale-105">
          <img src={traceForceLogo} alt="TraceNet Logo" />
        </span>
        <span><strong>TRACENET</strong><small>AI traffic intelligence · Trace Force</small></span>
      </button>
      <nav className="nav-links" aria-label="Primary navigation">
        {links.map(([label, Icon, target]) => (
          <button key={target} onClick={() => open(target)} className={`nav-link group ${page === target ? "active" : ""}`}>
            <Icon size={14} className="transition-transform duration-300 group-hover:rotate-12 group-hover:scale-125" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <button onClick={() => navigate("login")} className="nav-login group">
        <span>Operator login</span>
        <LogIn size={15} className="transition-transform duration-300 group-hover:translate-x-1 group-hover:scale-110" />
      </button>
    </header>
  );
}
