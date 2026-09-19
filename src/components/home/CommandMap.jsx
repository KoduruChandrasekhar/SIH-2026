import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Maximize2, Minimize2, Radar } from "lucide-react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import { areas } from "../../data";
import { CAMERA_NETWORK_EDGES, CAMERA_NETWORK_NODES, DEMO_PLATE, DEMO_ROUTE_PATH } from "../../demoData";

export const MAP_MODES = [
  { id: "flow", label: "Flow", title: "Macro traffic flow", hint: "Origin–destination corridors & zone density" },
  { id: "overview", label: "Overview", title: "Network overview", hint: "City zones & synchronized camera nodes" },
  { id: "trajectory", label: "Trajectory", title: "GIS tracking", hint: `Reconstructed trajectory · ${DEMO_PLATE}` },
  { id: "alerts", label: "Alerts", title: "Alerts & congestion", hint: "Priority flags & congestion zones" },
];

const nodeById = Object.fromEntries(CAMERA_NETWORK_NODES.map((n) => [n.id, [n.lat, n.lng]]));
const areaPos = (name) => {
  const key = name.toLowerCase();
  // "Madhapur" and "Cyberabad" both resolve to the "Cyberabad / Madhapur" zone
  return areas.find((a) => a.name.toLowerCase().includes(key))?.position;
};

const SEVERITY_COLOR = { CRITICAL: "#ef4444", HIGH: "#f59e0b", MEDIUM: "#eab308" };
const ROUTE_POINTS = DEMO_ROUTE_PATH.map((id) => nodeById[id]).filter(Boolean);
const CITY_BOUNDS = areas.map((a) => a.position).concat(CAMERA_NETWORK_NODES.map((n) => [n.lat, n.lng]));

// Moves the (single, persistent) map to fit the active layer; never re-creates it.
function MapViewController({ bounds, reducedMotion, maximized }) {
  const map = useMap();

  useEffect(() => {
    if (!bounds.length) return;
    const opts = { padding: [56, 56], maxZoom: 14 };
    if (reducedMotion) map.fitBounds(bounds, { ...opts, animate: false });
    else map.flyToBounds(bounds, { ...opts, duration: 1.1 });
  }, [map, bounds, reducedMotion]);

  // Container size changes when maximizing — let Leaflet re-measure
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(t);
  }, [map, maximized]);

  return null;
}

export default function CommandMap({ mode, onModeChange, telemetry, navigate, reducedMotion }) {
  const [maximized, setMaximized] = useState(false);
  const { nodes, alerts, odRoutes, source } = telemetry;
  const activeMode = MAP_MODES.find((m) => m.id === mode) ?? MAP_MODES[1];

  // Touch devices: don't let the map swallow page scrolling
  const [coarsePointer] = useState(() => window.matchMedia?.("(pointer: coarse)").matches ?? false);

  useEffect(() => {
    if (!maximized) return;
    const onKey = (e) => e.key === "Escape" && setMaximized(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [maximized]);

  const odLines = useMemo(
    () =>
      odRoutes
        .map((r) => ({
          ...r,
          from: areaPos(r.origin),
          to: areaPos(r.destination),
          volume: parseInt(String(r.count).replace(/\D/g, ""), 10) || 1000,
        }))
        .filter((r) => r.from && r.to),
    [odRoutes]
  );

  const mappedAlerts = useMemo(() => alerts.filter((a) => a.lat && a.lng), [alerts]);

  const bounds = useMemo(() => {
    switch (mode) {
      case "flow":
        return odLines.flatMap((r) => [r.from, r.to]);
      case "trajectory":
        return ROUTE_POINTS;
      case "alerts":
        return mappedAlerts.map((a) => [a.lat, a.lng]);
      default:
        return CITY_BOUNDS;
    }
  }, [mode, odLines, mappedAlerts]);

  return (
    <div className={`tn-map-panel ${maximized ? "is-maximized" : ""}`}>
      {maximized && <div className="tn-map-backdrop" onClick={() => setMaximized(false)} aria-hidden="true" />}

      <div className="tn-map-frame">
        {/* Header overlay */}
        <div className="tn-map-header">
          <div className="flex min-w-0 items-center gap-3">
            <span className="tn-live-pill">
              <span className="tn-live-dot" aria-hidden="true" />
              Live
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold text-white">Network Overview / GIS Tracking</p>
              <p className="truncate text-[11px] font-semibold text-slate-400">{activeMode.hint}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMaximized((m) => !m)}
            className="tn-icon-btn"
            aria-label={maximized ? "Restore map size" : "Maximize map"}
            title={maximized ? "Restore (Esc)" : "Maximize map"}
          >
            {maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>

        {/* Layer switcher (mirrors the feature card in view) */}
        <div className="tn-map-modes" role="group" aria-label="Map layer">
          {MAP_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onModeChange(m.id)}
              aria-pressed={mode === m.id}
              className={`tn-map-mode ${mode === m.id ? "is-active" : ""}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="tn-map-canvas" role="region" aria-label={`City GIS map — ${activeMode.title}`}>
          <MapContainer
            center={[17.475, 78.41]}
            zoom={12}
            scrollWheelZoom={false}
            dragging={!coarsePointer}
            zoomControl={!coarsePointer}
            attributionControl
            style={{ width: "100%", height: "100%" }}
          >
            {/* Same OSM tiles as the rest of the app, rendered dark via CSS (.tn-map-canvas .leaflet-tile-pane) */}
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapViewController bounds={bounds} reducedMotion={reducedMotion} maximized={maximized} />

            {/* Camera mesh links — always visible, faint */}
            {CAMERA_NETWORK_EDGES.map(([a, b]) => (
              <Polyline
                key={`${a}-${b}`}
                positions={[nodeById[a], nodeById[b]]}
                pathOptions={{ color: "#6366f1", weight: 1, opacity: mode === "overview" ? 0.45 : 0.18, dashArray: "2 6" }}
              />
            ))}

            {(mode === "flow" || mode === "overview") &&
              areas.map((a) => (
                <Circle
                  key={a.name}
                  center={a.position}
                  radius={mode === "flow" ? 1100 : 850}
                  pathOptions={{ color: a.color, weight: 1, opacity: 0.55, fillColor: a.color, fillOpacity: mode === "flow" ? 0.16 : 0.1 }}
                >
                  <Tooltip direction="top" className="tn-map-tip">
                    <strong>{a.title}</strong>
                    <br />
                    {a.density} · {a.speed}
                  </Tooltip>
                </Circle>
              ))}

            {mode === "flow" &&
              odLines.map((r) => (
                <Polyline
                  key={`${r.origin}-${r.destination}`}
                  positions={[r.from, r.to]}
                  pathOptions={{
                    color: "#38bdf8",
                    weight: 2 + (r.volume / 2103) * 4,
                    opacity: 0.85,
                    className: reducedMotion ? "" : "tn-flow-line",
                  }}
                >
                  <Tooltip sticky className="tn-map-tip">
                    {r.origin} → {r.destination}: {r.count}
                  </Tooltip>
                </Polyline>
              ))}

            {mode === "trajectory" && (
              <>
                <Polyline positions={ROUTE_POINTS} pathOptions={{ color: "#1d4ed8", weight: 10, opacity: 0.25 }} />
                <Polyline
                  positions={ROUTE_POINTS}
                  pathOptions={{ color: "#60a5fa", weight: 3.5, opacity: 0.95, className: reducedMotion ? "" : "tn-flow-line" }}
                />
                <CircleMarker
                  center={ROUTE_POINTS[ROUTE_POINTS.length - 1]}
                  radius={9}
                  pathOptions={{ color: "#bfdbfe", weight: 2, fillColor: "#2563eb", fillOpacity: 1, className: reducedMotion ? "" : "tn-vehicle-pulse" }}
                >
                  <Tooltip direction="top" permanent className="tn-map-tip">
                    {DEMO_PLATE}
                  </Tooltip>
                </CircleMarker>
              </>
            )}

            {mode === "alerts" &&
              mappedAlerts.map((a) => (
                <Circle
                  key={`zone-${a.id}`}
                  center={[a.lat, a.lng]}
                  radius={a.type === "traffic" ? 750 : 320}
                  pathOptions={{
                    color: SEVERITY_COLOR[a.severity] ?? "#94a3b8",
                    weight: 1,
                    fillColor: SEVERITY_COLOR[a.severity] ?? "#94a3b8",
                    fillOpacity: a.type === "traffic" ? 0.18 : 0.1,
                    dashArray: a.type === "traffic" ? undefined : "4 4",
                  }}
                />
              ))}
            {mode === "alerts" &&
              mappedAlerts.map((a) => (
                <CircleMarker
                  key={a.id}
                  center={[a.lat, a.lng]}
                  radius={7}
                  pathOptions={{
                    color: "#fff",
                    weight: 1.5,
                    fillColor: SEVERITY_COLOR[a.severity] ?? "#94a3b8",
                    fillOpacity: 1,
                    className: a.status === "Active" && !reducedMotion ? "tn-alert-pulse" : "",
                  }}
                >
                  <Tooltip direction="top" className="tn-map-tip">
                    <strong>{a.category}</strong>
                    <br />
                    {a.plateNumber} · {a.severity}
                  </Tooltip>
                </CircleMarker>
              ))}

            {/* Camera nodes — always on top */}
            {CAMERA_NETWORK_NODES.map((n) => {
              const onRoute = mode === "trajectory" && DEMO_ROUTE_PATH.includes(n.id);
              return (
                <CircleMarker
                  key={n.id}
                  center={[n.lat, n.lng]}
                  radius={onRoute ? 6 : 4.5}
                  pathOptions={{ color: onRoute ? "#dbeafe" : "#a5b4fc", weight: 1.5, fillColor: onRoute ? "#3b82f6" : "#6366f1", fillOpacity: 0.95 }}
                >
                  <Tooltip direction="top" className="tn-map-tip">
                    <strong>{n.id}</strong> · {n.name}
                  </Tooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>

        {/* Footer status */}
        <div className="tn-map-footer">
          <div className="flex min-w-0 items-center gap-2">
            <Radar size={15} className="shrink-0 text-blue-400" aria-hidden="true" />
            <span className="truncate text-xs font-bold text-slate-300">{nodes} camera nodes synchronized</span>
            <span className={`tn-source-chip ${source === "api" ? "is-api" : ""}`}>
              {source === "api" ? "TraceNet API" : "Demo data"}
            </span>
          </div>
          <button type="button" onClick={() => navigate("tracking")} className="tn-link-btn">
            Full Trajectory Mode <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
