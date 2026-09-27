import { useEffect, useState } from "react";
import { Pane, TileLayer } from "react-leaflet";
import { Radio } from "lucide-react";
import { TOMTOM_API_KEY } from "../../lib/config";
import { useTheme } from "../../context/ThemeContext";

export const LIVE_TRAFFIC_AVAILABLE = Boolean(TOMTOM_API_KEY);

const REFRESH_MS = 2 * 60 * 1000; // TomTom flow data updates about every minute

/**
 * Real-time road traffic (TomTom Traffic Flow raster tiles) over a Leaflet map — the same idea as the
 * Google Maps traffic layer. It sits in its own pane, above the base map (so the dark-mode tile filter
 * never recolours it) and below the corridor shapes. Tiles are re-fetched periodically while visible.
 */
export function LiveTrafficLayer({ enabled }) {
  const { theme } = useTheme();
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!enabled || !LIVE_TRAFFIC_AVAILABLE) return undefined;
    const id = setInterval(() => {
      if (!document.hidden) setGeneration((g) => g + 1);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled || !LIVE_TRAFFIC_AVAILABLE) return null;
  const style = theme === "dark" ? "relative0-dark" : "relative0";
  return (
    <Pane name="tnLiveTraffic" style={{ zIndex: 350 }}>
      <TileLayer
        key={`${style}-${generation}`}
        url={`https://api.tomtom.com/traffic/map/4/tile/flow/${style}/{z}/{x}/{y}.png?key=${encodeURIComponent(TOMTOM_API_KEY)}`}
        opacity={0.9}
        maxZoom={22}
        attribution='Traffic &copy; <a href="https://www.tomtom.com" target="_blank" rel="noopener noreferrer">TomTom</a>'
      />
    </Pane>
  );
}

/** Header toggle; disabled (with the reason) when no API key is configured. */
export function LiveTrafficToggle({ enabled, onChange }) {
  const available = LIVE_TRAFFIC_AVAILABLE;
  return (
    <button
      type="button"
      onClick={() => available && onChange(!enabled)}
      aria-pressed={available && enabled}
      aria-disabled={!available}
      data-tip={available ? "Real-time road speeds · TomTom" : "Set VITE_TOMTOM_API_KEY to show real-time traffic"}
      data-tip-pos="bottom"
      className={`tn-live-traffic-toggle ${available && enabled ? "is-on" : ""} ${available ? "" : "is-unavailable"}`}
    >
      <Radio size={11} aria-hidden="true" />
      Live traffic
      <span className="tn-live-traffic-switch" aria-hidden="true" />
    </button>
  );
}

/** Colour key for TomTom's relative flow styles (speed vs free-flow). */
export function LiveTrafficLegend() {
  return (
    <div className="tn-live-traffic-legend" aria-label="Live traffic colours: free flow to standstill">
      <span className="font-extrabold">Live traffic</span>
      <span className="tn-live-traffic-ramp" aria-hidden="true" />
      <span className="flex w-full justify-between">
        <span>Free flow</span>
        <span>Jam</span>
      </span>
    </div>
  );
}
