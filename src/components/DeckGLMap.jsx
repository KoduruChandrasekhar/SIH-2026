import { useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { Map } from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import "maplibre-gl/dist/maplibre-gl.css";

/* ──────────────────────────────────────────
   Free dark map style (CARTO Dark Matter)
   No API key needed
   ────────────────────────────────────────── */
const MAP_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/* ──────────────────────────────────────────
   Default view: Hyderabad city center
   ────────────────────────────────────────── */
const DEFAULT_VIEW = {
  longitude: 78.41,
  latitude: 17.485,
  zoom: 12,
  pitch: 0,
  bearing: 0,
};

/**
 * DeckGLMap — Reusable dark-themed map component
 *
 * Props:
 *   layers       – Array of deck.gl Layer instances
 *   viewState    – Optional initial viewState override
 *   onViewChange – Optional callback when view changes
 *   onClick      – Optional click handler
 *   children     – Optional overlay elements
 *   className    – Optional CSS class for container
 *   style        – Optional inline styles for container
 *   controller   – Optional controller config (default: true)
 */
export default function DeckGLMap({
  layers = [],
  viewState: initialViewState,
  onViewChange,
  onClick,
  children,
  className = "",
  style = {},
  controller = true,
}) {
  const [viewState, setViewState] = useState({
    ...DEFAULT_VIEW,
    ...initialViewState,
  });

  const onViewStateChange = useCallback(
    ({ viewState: vs }) => {
      setViewState(vs);
      onViewChange?.(vs);
    },
    [onViewChange]
  );

  return (
    <div
      className={`deckgl-map-container ${className}`}
      style={{ position: "relative", width: "100%", height: "100%", ...style }}
    >
      <DeckGL
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        controller={controller}
        layers={layers}
        onClick={onClick}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
      >
        <Map
          mapLib={maplibregl}
          mapStyle={MAP_STYLE}
          attributionControl={false}
        />
      </DeckGL>

      {/* Overlay children (badges, legends, etc.) */}
      {children && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          <div style={{ pointerEvents: "auto" }}>{children}</div>
        </div>
      )}
    </div>
  );
}
