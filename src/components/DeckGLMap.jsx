import { useCallback, useEffect, useMemo, useState } from "react";
import maplibregl from "maplibre-gl";
import { Map, NavigationControl } from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import { FlyToInterpolator } from "@deck.gl/core";
import { Moon, Sun, RotateCcw } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";

// CARTO GL Vector Basemaps (Keyless, ultra high performance)
const STYLES = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};

const DEFAULT_VIEW = {
  longitude: 78.41,
  latitude: 17.485,
  zoom: 12,
  pitch: 0,
  bearing: 0,
};

export default function DeckGLMap({
  layers = [],
  initialViewState,
  flyTo,
  onViewChange,
  onClick,
  children,
  className = "",
  style = {},
  controller = true,
  interactive = true,
  showControls = true,
}) {
  // Theme state: dark (black) vs light (white)
  const [mapTheme, setMapTheme] = useState(() => {
    return localStorage.getItem("tracenet_map_theme") || "dark";
  });

  const initLng = initialViewState?.longitude ?? DEFAULT_VIEW.longitude;
  const initLat = initialViewState?.latitude ?? DEFAULT_VIEW.latitude;
  const initZoom = initialViewState?.zoom ?? DEFAULT_VIEW.zoom;

  const baseView = useMemo(
    () => ({
      ...DEFAULT_VIEW,
      longitude: initLng,
      latitude: initLat,
      zoom: initZoom,
      pitch: 0,
      bearing: 0,
    }),
    [initLng, initLat, initZoom]
  );

  const [viewState, setViewState] = useState(baseView);
  const flyInterpolator = useMemo(() => new FlyToInterpolator(), []);

  // Purge any stale 3D state from previous sessions
  useEffect(() => {
    try {
      localStorage.removeItem("tracenet_map_3d");
    } catch {}
  }, []);

  // Re-synchronize when base coordinates change (e.g. navigation across modules)
  useEffect(() => {
    setViewState({
      longitude: initLng,
      latitude: initLat,
      zoom: initZoom,
      pitch: 0,
      bearing: 0,
    });
  }, [initLng, initLat, initZoom]);

  useEffect(() => {
    localStorage.setItem("tracenet_map_theme", mapTheme);
  }, [mapTheme]);

  // Handle external flyTo requests (e.g. from camera clicks or timeline)
  useEffect(() => {
    if (!flyTo) return;
    setViewState((current) => ({
      ...current,
      ...flyTo,
      pitch: flyTo.pitch ?? 0,
      bearing: flyTo.bearing ?? 0,
      transitionDuration: flyTo.transitionDuration ?? 1600,
      transitionInterpolator: flyInterpolator,
      transitionInterruption: 1,
    }));
  }, [flyTo, flyInterpolator]);

  const onViewStateChange = useCallback(
    ({ viewState: next }) => {
      setViewState(next);
      onViewChange?.(next);
    },
    [onViewChange]
  );

  // Toggle between Dark (Black) and Light (White) basemap
  const toggleTheme = useCallback(() => {
    setMapTheme((curr) => (curr === "dark" ? "light" : "dark"));
  }, []);

  // Reset to default / initial camera viewpoint (Flat 2D top-down)
  const resetView = useCallback(() => {
    setViewState((curr) => ({
      ...curr,
      ...baseView,
      pitch: 0,
      bearing: 0,
      transitionDuration: 1000,
      transitionInterpolator: flyInterpolator,
      transitionInterruption: 1,
    }));
  }, [baseView, flyInterpolator]);

  return (
    <div
      className={`deckgl-map-container ${mapTheme === "light" ? "light-theme" : "dark-theme"} ${className}`}
      style={{ ...style }}
    >
      <DeckGL
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        controller={interactive ? controller : false}
        layers={layers}
        onClick={onClick}
        getCursor={({ isHovering }) =>
          interactive && isHovering ? "pointer" : interactive ? "grab" : "default"
        }
      >
        <Map
          mapLib={maplibregl}
          mapStyle={STYLES[mapTheme] || STYLES.dark}
          attributionControl={false}
          reuseMaps
        >
          {interactive && (
            <NavigationControl
              position="bottom-right"
              showCompass={true}
              visualizePitch={true}
            />
          )}
        </Map>
      </DeckGL>

      {/* Floating Tactical Map Controls */}
      {interactive && showControls && (
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 rounded-xl border border-white/15 bg-black/75 p-1.5 shadow-2xl backdrop-blur-md pointer-events-auto">
          {/* Black / White Style Switcher */}
          <button
            type="button"
            onClick={toggleTheme}
            title={mapTheme === "dark" ? "Switch to Light Map" : "Switch to Dark Map"}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-gray-200 transition-all hover:bg-white/15 hover:text-white"
          >
            {mapTheme === "dark" ? (
              <>
                <Moon size={13} className="text-blue-400" />
                <span className="hidden sm:inline">Dark</span>
              </>
            ) : (
              <>
                <Sun size={13} className="text-amber-400" />
                <span className="hidden sm:inline">Light</span>
              </>
            )}
          </button>

          <div className="h-3.5 w-px bg-white/20" />

          {/* Reset Camera to 2D Top-Down View */}
          <button
            type="button"
            onClick={resetView}
            title="Reset Camera to 2D Top-Down View"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-gray-300 transition-all hover:bg-white/15 hover:text-white"
          >
            <RotateCcw size={12} className="text-cyan-400" />
            <span className="hidden sm:inline">2D Reset</span>
          </button>
        </div>
      )}

      {children && <div className="deckgl-map-overlay">{children}</div>}
    </div>
  );
}
