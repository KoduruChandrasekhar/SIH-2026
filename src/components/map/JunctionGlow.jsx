import { useMemo } from "react";
import { Marker } from "react-leaflet";
import L from "leaflet";

/**
 * Congestion glow at each camera junction: a solid core fading out in the corridor's status colour,
 * sized by how congested it is. Each junction keeps its own colour (no blending into a muddy haze);
 * High and Severe junctions pulse.
 * points: [{ id, lat, lng, color, density 0–100, status }]
 */
export default function JunctionGlow({ points }) {
  const markers = useMemo(
    () =>
      points.map((p) => {
        const size = Math.round(40 + Math.min(100, Math.max(0, p.density)) * 0.5);
        const pulse = p.status === "High" || p.status === "Severe" ? " tn-glow--pulse" : "";
        return {
          ...p,
          icon: L.divIcon({
            className: "tn-glow-icon",
            html: `<span class="tn-glow${pulse}" style="--c:${p.color};--s:${size}px"></span>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          }),
        };
      }),
    [points]
  );

  return markers.map((m) => <Marker key={m.id} position={[m.lat, m.lng]} icon={m.icon} interactive={false} keyboard={false} />);
}
