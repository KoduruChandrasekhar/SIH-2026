import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

/**
 * Canvas heat layer (leaflet.heat) for react-leaflet maps.
 * points: [[lat, lng, weight 0..1], …] — here, one point per ANPR junction weighted by the Polars
 * analytics (congestion index or vehicle volume). Overlapping junctions blend into one hot area.
 * The plugin registers on the global `L`, so it is loaded on demand after `window.L` is set.
 */
const GRADIENT = { 0.2: "#22c55e", 0.45: "#eab308", 0.7: "#f97316", 0.9: "#ef4444" };

export default function HeatLayer({ points, radius = 55, blur = 38, gradient = GRADIENT, fullIntensityZoom = 11 }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window !== "undefined" && !window.L) window.L = L;
      await import("leaflet.heat");
      if (cancelled || !L.heatLayer) return;
      // maxZoom: leaflet.heat divides intensity by 2^(maxZoom - zoom); city-level zooms get the full weight
      layerRef.current = L.heatLayer([], { radius, blur, max: 1, minOpacity: 0.28, gradient, maxZoom: fullIntensityZoom }).addTo(map);
      layerRef.current.setLatLngs(points);
    })();
    return () => {
      cancelled = true;
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, radius, blur, gradient, fullIntensityZoom]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    layerRef.current?.setLatLngs(points);
  }, [points]);

  return null;
}
