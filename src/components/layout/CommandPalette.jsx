import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Car,
  Cpu,
  Cctv,
  CornerDownLeft,
  Home,
  LayoutDashboard,
  Moon,
  Navigation,
  Route,
  Search,
  ShieldCheck,
  Sun,
  TrafficCone,
} from "lucide-react";
import { cameraRegistry, corridorsFeed } from "../../data/data";
import { DEMO_PLATE } from "../../data/demoData";
import { useTheme } from "../../context/ThemeContext";
import { useSession } from "../../hooks/useSession";

// Plates the Tracking page can reconstruct offline (keys of localVehicles in pages/TrackingPage.jsx)
const DEMO_PLATES = [DEMO_PLATE, "TS09EA4512", "AP28BK8821", "TS08EJ4892", "TS09EE9911", "MH04EF7710", "AP28BY5521"];

const PLATE_RE = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}$/;

export const openCommandPalette = () => window.dispatchEvent(new Event("tn:cmdk"));

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// Pages that always render in the dark command-center palette, whatever the theme setting
const ALWAYS_DARK = new Set(["home"]);

export default function CommandPalette({ navigate, page }) {
  const { theme, toggleTheme } = useTheme();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const returnFocus = useRef(null);

  const show = useCallback(() => {
    returnFocus.current = document.activeElement;
    setQuery("");
    setActive(0);
    setClosing(false);
    setOpen(true);
  }, []);

  const hide = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
      returnFocus.current?.focus?.({ preventScroll: true });
    }, 140);
  }, []);

  // Ctrl/⌘+K anywhere, "/" when not typing, plus the navbar button's event
  useEffect(() => {
    const onKey = (e) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        open ? hide() : show();
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        hide();
        return;
      }
      const typing = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]");
      if (e.key === "/" && !open && !typing) {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("tn:cmdk", show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("tn:cmdk", show);
    };
  }, [open, show, hide]);

  const groups = useMemo(() => {
    const pages = [
      { id: "p-home", label: "Home", hint: "Command center overview", icon: Home, run: () => navigate("home") },
      { id: "p-dashboard", label: "Dashboard", hint: "Network KPIs, GIS heatmap, trends", icon: LayoutDashboard, run: () => navigate("dashboard") },
      { id: "p-cameras", label: "Cameras", hint: "Live ANPR camera network", icon: Cctv, run: () => navigate("cameras") },
      { id: "p-tracking", label: "Tracking", hint: "Reconstruct a vehicle trajectory", icon: Navigation, run: () => navigate("tracking") },
      { id: "p-traffic", label: "Traffic", hint: "Corridor density & OD analytics", icon: TrafficCone, run: () => navigate("traffic") },
      { id: "p-alerts", label: "Alerts", hint: "Blacklist, congestion, anomalies", icon: Bell, run: () => navigate("alerts") },
      { id: "p-pipeline", label: "AI Pipeline", hint: "OCR lab, ANPR funnel, model benchmarks", icon: Cpu, keywords: "ocr anpr model detector yolo paddle benchmark engine", run: () => navigate("pipeline") },
      ...(session?.role === "camera_admin"
        ? [{ id: "p-admin", label: "Admin", hint: "Users & camera administration", icon: ShieldCheck, run: () => navigate("admin") }]
        : []),
    ];
    const actions = [
      {
        id: "a-theme",
        label: theme === "light" ? "Switch to dark mode" : "Switch to light mode",
        hint: "Appearance",
        icon: theme === "light" ? Moon : Sun,
        keywords: "theme dark light appearance",
        run: toggleTheme,
      },
    ];
    const plates = DEMO_PLATES.map((p) => ({
      id: `v-${p}`,
      label: p,
      hint: "Trace vehicle trajectory",
      icon: Car,
      mono: true,
      keywords: "plate vehicle track trace",
      run: () => navigate("tracking", { plate: p }),
    }));
    const cams = cameraRegistry.map((c) => ({
      id: `c-${c.id}`,
      label: c.code,
      hint: c.name,
      icon: Cctv,
      mono: true,
      status: c.status,
      keywords: `camera cam ${c.zone} ${c.name}`,
      run: () => navigate("cameras", { camera: c.id }),
    }));
    const corridors = corridorsFeed.map((c) => ({
      id: `r-${c.id}`,
      label: c.name,
      hint: `${c.status} · ${c.density}% capacity · ${c.speed} km/h`,
      icon: Route,
      dot: c.color,
      keywords: `corridor route traffic ${c.id}`,
      run: () => navigate("traffic", { corridor: c.id }),
    }));

    const q = query.trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    const match = (it) => {
      if (!tokens.length) return true;
      const hay = `${it.label} ${it.hint ?? ""} ${it.keywords ?? ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    };

    // A typed plate that is not in the demo list still gets a "trace" entry (the backend may know it)
    const typed = query.trim().toUpperCase().replace(/[\s-]/g, "");
    const tracePlate =
      PLATE_RE.test(typed) && !DEMO_PLATES.includes(typed)
        ? [{ id: `t-${typed}`, label: `Trace ${typed}`, hint: "Search stored journeys for this plate", icon: Search, mono: true, run: () => navigate("tracking", { plate: typed }) }]
        : [];

    const limit = (arr, n) => (tokens.length ? arr.filter(match) : arr.slice(0, n));
    return [
      { title: "Trace", items: tracePlate },
      { title: "Go to", items: limit(pages, 12) },
      { title: "Vehicles", items: limit(plates, 3) },
      { title: "Cameras", items: limit(cams, 3) },
      { title: "Corridors", items: limit(corridors, 2) },
      { title: "Actions", items: limit(actions, 1) },
    ].filter((g) => g.items.length);
  }, [query, navigate, theme, toggleTheme, session]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => setActive(0), [query]);

  // keep the highlighted row in view
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (item) => {
    if (!item) return;
    hide();
    item.run();
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(flat[active]);
    } else if (e.key === "Tab") {
      e.preventDefault(); // focus stays in the palette
    }
  };

  if (!open) return null;

  let index = -1;
  return (
    <div
      className={`tn-cmdk ${closing ? "is-closing" : ""}`}
      data-theme={ALWAYS_DARK.has(page) ? "dark" : undefined}
      onMouseDown={(e) => e.target === e.currentTarget && hide()}
    >
      <div className="tn-cmdk-panel" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="tn-cmdk-search">
          <Search size={17} aria-hidden="true" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search modules, cameras, corridors or type a plate…"
            role="combobox"
            aria-expanded="true"
            aria-controls="tn-cmdk-list"
            aria-activedescendant={flat[active] ? `tn-cmdk-${flat[active].id}` : undefined}
            aria-autocomplete="list"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd>Esc</kbd>
        </div>

        <div ref={listRef} id="tn-cmdk-list" role="listbox" className="tn-cmdk-list">
          {flat.length === 0 && <p className="tn-cmdk-empty">No matches for “{query}”</p>}
          {groups.map((g) => (
            <div key={g.title} role="group" aria-label={g.title}>
              <p className="tn-cmdk-group">{g.title}</p>
              {g.items.map((it) => {
                index += 1;
                const i = index;
                const Icon = it.icon;
                return (
                  <div
                    key={it.id}
                    id={`tn-cmdk-${it.id}`}
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    className={`tn-cmdk-item ${i === active ? "is-active" : ""}`}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => run(it)}
                  >
                    <span className="tn-cmdk-icon">
                      <Icon size={15} aria-hidden="true" />
                    </span>
                    <span className={`tn-cmdk-label ${it.mono ? "font-mono" : ""}`}>{it.label}</span>
                    {it.dot && <span className="tn-cmdk-dot" style={{ background: it.dot }} aria-hidden="true" />}
                    {it.status && <span className={`tn-cmdk-status tn-cmdk-status--${it.status}`}>{it.status}</span>}
                    <span className="tn-cmdk-hint">{it.hint}</span>
                    <CornerDownLeft size={13} className="tn-cmdk-enter" aria-hidden="true" />
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="tn-cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span className="ml-auto"><kbd>{isMac ? "⌘" : "Ctrl"}</kbd><kbd>K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}
