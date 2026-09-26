import { useEffect, useRef, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import { AlertTriangle, KeyRound, Radio } from "lucide-react";
import { GOOGLE_MAPS_API_KEY, TOMTOM_API_KEY } from "../../lib/config";
import { GOOGLE_MAPS_AUTH_FAILURE, loadGoogleMaps } from "../../lib/googleMaps";
import { cameraRegistry } from "../../data/data";
import { useTheme } from "../../context/ThemeContext";
import { LiveTrafficLayer } from "./LiveTraffic";

// Areas to jump between (the camera cluster first)
const AREAS = [
  { id: "cluster", label: "Camera cluster", lat: 17.477, lng: 78.405, zoom: 13 },
  { id: "hitech", label: "Hitech City", lat: 17.4474, lng: 78.3762, zoom: 14 },
  { id: "city", label: "Hyderabad centre", lat: 17.405, lng: 78.46, zoom: 12 },
];

const PROVIDER = GOOGLE_MAPS_API_KEY ? "google" : TOMTOM_API_KEY ? "tomtom" : null;
const STATUS_COLOR = { online: "#22d3ee", degraded: "#f59e0b", offline: "#ef4444" };

// Google base map restyled to TraceNet's navy palette (the traffic colours stay Google's own)
const DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0b1220" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8a99b0" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b1220" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1c2a40" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0f1a2c" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#243553" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0a1a33" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
];
const LIGHT_STYLE = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

/** Google Maps + its live TrafficLayer, with the cluster's cameras marked. */
function GoogleTrafficMap({ area }) {
  const { theme } = useTheme();
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const [error, setError] = useState(null);

  // a rejected key is reported by Google after the map has already been created
  useEffect(() => {
    const onAuthFailure = (e) => setError(e.detail);
    window.addEventListener(GOOGLE_MAPS_AUTH_FAILURE, onAuthFailure);
    return () => window.removeEventListener(GOOGLE_MAPS_AUTH_FAILURE, onAuthFailure);
  }, []);

  useEffect(() => {
    let alive = true;
    loadGoogleMaps(GOOGLE_MAPS_API_KEY)
      .then((maps) => {
        if (!alive || !elRef.current) return;
        const map = new maps.Map(elRef.current, {
          center: { lat: area.lat, lng: area.lng },
          zoom: area.zoom,
          disableDefaultUI: true,
          zoomControl: true,
          fullscreenControl: true,
          gestureHandling: "cooperative", // page scrolls normally; Ctrl + scroll zooms the map
          clickableIcons: false,
          styles: document.documentElement.dataset.theme === "dark" ? DARK_STYLE : LIGHT_STYLE,
          backgroundColor: document.documentElement.dataset.theme === "dark" ? "#0b1220" : "#eef2f7",
        });
        new maps.TrafficLayer({ autoRefresh: true }).setMap(map);
        const info = new maps.InfoWindow();
        cameraRegistry.forEach((cam) => {
          const color = STATUS_COLOR[cam.status] ?? STATUS_COLOR.online;
          const dot = new maps.Circle({
            map,
            center: { lat: cam.lat, lng: cam.lng },
            radius: 70,
            strokeColor: "#ffffff",
            strokeWeight: 2,
            fillColor: color,
            fillOpacity: 0.95,
            zIndex: 10,
          });
          dot.addListener("mouseover", () => {
            info.setContent(`<strong>${cam.code}</strong><br>${cam.name} · ${cam.status}`);
            info.setPosition({ lat: cam.lat, lng: cam.lng });
            info.open({ map });
          });
          dot.addListener("mouseout", () => info.close());
        });
        mapRef.current = map;
      })
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
    // the map is created once; area / theme changes are applied below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.panTo({ lat: area.lat, lng: area.lng });
    map.setZoom(area.zoom);
  }, [area]);

  useEffect(() => {
    mapRef.current?.setOptions({ styles: theme === "dark" ? DARK_STYLE : LIGHT_STYLE, backgroundColor: theme === "dark" ? "#0b1220" : "#eef2f7" });
  }, [theme]);

  if (error) return <ProviderError message={error} />;
  return <div ref={elRef} className="h-full w-full" aria-label="Google Maps live traffic" role="region" />;
}

function FlyTo({ area }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([area.lat, area.lng], area.zoom, { duration: 0.8 });
  }, [area, map]);
  return null;
}

/** Leaflet + TomTom Traffic Flow tiles (same road colouring, free key). */
function TomTomTrafficMap({ area }) {
  return (
    <MapContainer center={[area.lat, area.lng]} zoom={area.zoom} scrollWheelZoom={false} style={{ width: "100%", height: "100%" }}>
      <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <LiveTrafficLayer enabled />
      {cameraRegistry.map((cam) => (
        <CircleMarker key={cam.id} center={[cam.lat, cam.lng]} radius={6} pathOptions={{ color: "#fff", weight: 2, fillColor: STATUS_COLOR[cam.status] ?? STATUS_COLOR.online, fillOpacity: 1 }}>
          <Tooltip>{cam.code} · {cam.name}</Tooltip>
        </CircleMarker>
      ))}
      <FlyTo area={area} />
    </MapContainer>
  );
}

function ProviderError({ message }) {
  return (
    <div className="tn-live-road-empty">
      <AlertTriangle size={22} className="text-amber-500" aria-hidden="true" />
      <p className="text-sm font-bold text-gray-900">Live traffic couldn't load</p>
      <p className="max-w-md text-xs font-medium text-gray-500">{message}</p>
    </div>
  );
}

/** No key configured: explain exactly how to switch the live map on. */
function SetupPanel() {
  return (
    <div className="tn-live-road-empty">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600">
        <KeyRound size={20} aria-hidden="true" />
      </span>
      <p className="text-sm font-extrabold text-gray-900">Add a map key to see live road speeds</p>
      <p className="max-w-lg text-xs font-medium leading-relaxed text-gray-500">
        Live traffic colours every road by its current speed, the same as Google Maps. It needs one environment variable in
        <code className="mx-1 rounded bg-gray-100 px-1 font-mono">.env.local</code>or in Vercel → Settings → Environment Variables:
      </p>
      <div className="grid w-full max-w-xl gap-2 text-left sm:grid-cols-2">
        <div className="tn-live-road-option">
          <p className="font-extrabold text-gray-900">Google Maps traffic</p>
          <code>VITE_GOOGLE_MAPS_API_KEY</code>
          <p>Google Cloud → enable “Maps JavaScript API” → create an API key (needs a billing account; the monthly free credit covers light use).</p>
        </div>
        <div className="tn-live-road-option">
          <p className="font-extrabold text-gray-900">TomTom traffic</p>
          <code>VITE_TOMTOM_API_KEY</code>
          <p>developer.tomtom.com → free account → copy the API key (no card needed).</p>
        </div>
      </div>
      <p className="text-[11px] font-semibold text-gray-400">Restrict the key to your site's domain — any key in a web page is visible to visitors.</p>
    </div>
  );
}

/**
 * Real-time road traffic for Hyderabad: Google Maps' traffic layer (or TomTom's) with the cluster's
 * cameras on top — roads coloured green → red by their current speed.
 */
export default function LiveRoadTraffic() {
  const [area, setArea] = useState(AREAS[0]);

  return (
    <section className="premium-panel fade-up p-5 sm:p-6" aria-labelledby="tn-live-road-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.22em] text-emerald-600">
            <span className={`h-1.5 w-1.5 rounded-full ${PROVIDER ? "tn-pulse tn-pulse--green bg-emerald-500" : "bg-gray-400"}`} aria-hidden="true" />
            <Radio size={12} aria-hidden="true" />
            Live road traffic
          </p>
          <h2 id="tn-live-road-title" className="mt-1.5 text-xl font-black tracking-tight text-gray-900">
            Real-time traffic across Hyderabad
          </h2>
          <p className="mt-1 max-w-2xl text-[12.5px] font-medium text-gray-500">
            Every road coloured by its current speed, with TraceNet's cameras on top — a city-wide view alongside the cameras' own readings.
          </p>
        </div>
        {PROVIDER && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Map area">
            {AREAS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setArea(a)}
                aria-pressed={a.id === area.id}
                className={`tn-press rounded-lg px-2.5 py-1 text-[11px] font-bold ${a.id === area.id ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`tn-live-road ${PROVIDER ? "" : "tn-live-road--setup"}`}>
        {PROVIDER === "google" && <GoogleTrafficMap area={area} />}
        {PROVIDER === "tomtom" && <TomTomTrafficMap area={area} />}
        {!PROVIDER && <SetupPanel />}
      </div>

      {PROVIDER && (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 text-[11px] font-semibold text-gray-500">
          <div className="flex items-center gap-2" aria-label="Traffic colours">
            <span>Fast</span>
            <span className="tn-live-road-ramp" aria-hidden="true" />
            <span>Slow</span>
            <span className="ml-3 flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-white bg-cyan-400 shadow" aria-hidden="true" />
              TraceNet camera
            </span>
          </div>
          <span className="text-gray-400">
            Live data © {PROVIDER === "google" ? "Google" : "TomTom"} · updates automatically{PROVIDER === "google" ? " · Ctrl + scroll to zoom" : ""}
          </span>
        </div>
      )}
    </section>
  );
}
