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
import { areas, cameraRegistry, corridorsFeed } from "../../data/data";
import { CAMERA_NETWORK_NODES, DEMO_PLATE, DEMO_ROUTE_PATH } from "../../data/demoData";
import { EDGES as NETWORK_EDGES, NODES as NETWORK_NODES } from "../../data/cityGraph";

const MAP_MODES = [
  { id: "overview", label: "Overview", title: "Network overview", hint: "City zones & synchronized camera nodes" },
  { id: "trajectory", label: "Trajectory", title: "GIS tracking", hint: `Reconstructed trajectory · ${DEMO_PLATE}` },
  { id: "flow", label: "Traffic", title: "Macro traffic flow", hint: "Origin–destination corridors & zone density" },
  { id: "alerts", label: "Alerts", title: "Alerts & congestion", hint: "Priority flags & congestion zones" },
];

const nodeById = Object.fromEntries(CAMERA_NETWORK_NODES.map((n) => [n.id, [n.lat, n.lng]]));
// Camera zones → mean position (resolves city-centre names the five homepage areas don't cover)
const ZONE_POS = (() => {
  const acc = {};
  cameraRegistry.forEach((c) => {
    const z = (acc[c.zone.toLowerCase()] ??= { lat: 0, lng: 0, n: 0 });
    z.lat += c.lat;
    z.lng += c.lng;
    z.n += 1;
  });
  return Object.fromEntries(Object.entries(acc).map(([k, z]) => [k, [z.lat / z.n, z.lng / z.n]]));
})();
const areaPos = (name) => {
  const key = name.toLowerCase();
  // "Madhapur" and "Cyberabad" both resolve to the "Cyberabad / Madhapur" zone
  return areas.find((a) => a.name.toLowerCase().includes(key))?.position ?? ZONE_POS[key];
};

const SEVERITY_COLOR = { CRITICAL: "#ef4444", HIGH: "#f97316", MEDIUM: "#eab308" };
const NODE_STYLE = {
  online: { color: "#a5b4fc", fill: "#6366f1" },
  degraded: { color: "#fde68a", fill: "#f59e0b" },
  offline: { color: "#fecaca", fill: "#ef4444" },
};
const ROUTE_POINTS = DEMO_ROUTE_PATH.map((id) => nodeById[id]).filter(Boolean);
const ROUTE_SET = new Set(DEMO_ROUTE_PATH);

// The shared camera network, as drawable links
const pos = (i) => [NETWORK_NODES[i].lat, NETWORK_NODES[i].lng];
const NETWORK_LINES = NETWORK_EDGES.map(([a, b]) => ({ key: `${a}-${b}`, a, b, ida: NETWORK_NODES[a].id, idb: NETWORK_NODES[b].id, positions: [pos(a), pos(b)] }));
const nodeIndexById = Object.fromEntries(NETWORK_NODES.map((n, i) => [n.id, i]));

// Traffic layer: every corridor as a road between its cameras, coloured by status
const STATUS_COLOR = { Severe: "#ef4444", High: "#f97316", Moderate: "#eab308", Low: "#22c55e" };
const CORRIDOR_LINES = corridorsFeed
  .map((c) => ({ ...c, positions: c.cameras.map((id) => nodeIndexById[id]).filter((i) => i != null).map(pos) }))
  .filter((c) => c.positions.length > 1);

// Alerts: the camera an alert came from (its own camera, else the nearest one)
const alertNode = (a) =>
  nodeIndexById[a.cameraId] ??
  NETWORK_NODES.reduce((best, n, i) => {
    const d = Math.hypot(n.lat - a.lat, n.lng - a.lng);
    return !best || d < best[1] ? [i, d] : best;
  }, null)?.[0];
const CITY_BOUNDS = areas.map((a) => a.position).concat(cameraRegistry.map((c) => [c.lat, c.lng]));

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
  const activeMode = MAP_MODES.find((m) => m.id === mode) ?? MAP_MODES[0];

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

  // Alerts layer: from each active alert's camera, the links a flagged vehicle can take next (interception)
  const alertLinks = useMemo(() => {
    const rank = { CRITICAL: 3, HIGH: 2, MEDIUM: 1 };
    const colorByNode = {};
    mappedAlerts
      .filter((a) => a.status !== "Resolved")
      .forEach((a) => {
        const i = alertNode(a);
        if (i == null) return;
        const prev = colorByNode[i];
        if (!prev || (rank[a.severity] ?? 0) > prev.rank) colorByNode[i] = { rank: rank[a.severity] ?? 0, color: SEVERITY_COLOR[a.severity] ?? "#94a3b8" };
      });
    const out = {};
    NETWORK_LINES.forEach((l) => {
      const hit = colorByNode[l.a] ?? colorByNode[l.b];
      if (hit) out[l.key] = hit.color;
    });
    return out;
  }, [mappedAlerts]);

  const bounds = useMemo(() => {
    switch (mode) {
      case "flow":
        return odLines.flatMap((r) => [r.from, r.to]).concat(CORRIDOR_LINES.flatMap((c) => c.positions));
      case "trajectory":
        return ROUTE_POINTS;
      case "alerts":
        return mappedAlerts
          .map((a) => [a.lat, a.lng])
          .concat(NETWORK_LINES.filter((l) => alertLinks[l.key]).flatMap((l) => l.positions));
      default:
        return CITY_BOUNDS;
    }
  }, [mode, odLines, mappedAlerts, alertLinks]);

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
            data-tip={maximized ? "Restore (Esc)" : "Maximize map"}
            data-tip-pos="bottom"
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
            center={[17.43, 78.445]}
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

            {/* Camera network links (the shared city graph) — each layer lights the connections it is about:
                overview = the whole mesh · trajectory = handoffs from the tracked route · alerts = interception links */}
            {NETWORK_LINES.map((l) => {
              const march = reducedMotion ? "" : "tn-net-link";
              let role = "dim";
              let style = { color: "#6366f1", weight: 1, opacity: 0.12, dashArray: "2 6" };
              if (mode === "overview") {
                role = "mesh";
                style = { color: "#818cf8", weight: 1.4, opacity: 0.6, dashArray: "2 6", className: march };
              } else if (mode === "trajectory" && (ROUTE_SET.has(l.ida) || ROUTE_SET.has(l.idb))) {
                role = "handoff";
                style = { color: "#60a5fa", weight: 1.5, opacity: 0.6, dashArray: "3 6", className: march };
              } else if (mode === "alerts" && alertLinks[l.key]) {
                role = "alert";
                style = { color: alertLinks[l.key], weight: 2, opacity: 0.85, dashArray: "4 6", className: march };
              }
              // Leaflet applies a path's CSS class only when it is created: a new role re-creates the link
              return <Polyline key={`${l.key}-${role}`} positions={l.positions} pathOptions={style} />;
            })}

            {/* Traffic layer: corridors as roads, coloured by congestion */}
            {mode === "flow" &&
              CORRIDOR_LINES.map((c) => (
                <Polyline key={`cor-${c.id}`} positions={c.positions} pathOptions={{ color: STATUS_COLOR[c.status] ?? "#38bdf8", weight: 4, opacity: 0.9, className: reducedMotion ? "" : "tn-flow-line" }}>
                  <Tooltip sticky className="tn-map-tip">
                    <strong>{c.name}</strong>
                    <br />
                    {c.status} · {c.speed} km/h
                  </Tooltip>
                </Polyline>
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
                    weight: 1.5 + (r.volume / 2103) * 3,
                    opacity: 0.55,
                    dashArray: "6 8",
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

            {/* Camera nodes (all registry cameras, coloured by health) — always on top */}
            {cameraRegistry.map((n) => {
              const onRoute = mode === "trajectory" && DEMO_ROUTE_PATH.includes(n.id);
              const style = NODE_STYLE[n.status] ?? NODE_STYLE.online;
              return (
                <CircleMarker
                  key={n.id}
                  center={[n.lat, n.lng]}
                  radius={onRoute ? 6 : 4.5}
                  pathOptions={{ color: onRoute ? "#dbeafe" : style.color, weight: 1.5, fillColor: onRoute ? "#3b82f6" : style.fill, fillOpacity: 0.95 }}
                >
                  <Tooltip direction="top" className="tn-map-tip">
                    <strong>{n.code}</strong> · {n.name}
                    {n.status !== "online" && <> · {n.status}</>}
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
