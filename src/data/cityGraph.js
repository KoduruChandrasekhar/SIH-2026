import { cameraRegistry } from "./data";
import { CAMERA_NETWORK_EDGES } from "./demoData";

/**
 * The Hyderabad camera graph shared by the homepage visuals: every registry camera, the surveyed road links,
 * the arterial roads joining the west cluster to the city centre, plus each camera's two nearest neighbours.
 * The graph is always one connected network — so every visual draws the same city.
 */
export const NODES = cameraRegistry.map((c) => ({ id: c.id, code: c.code, lat: c.lat, lng: c.lng, online: c.status !== "offline" }));
const nodeIndex = Object.fromEntries(NODES.map((n, i) => [n.id, i]));

const COS_LAT = Math.cos((17.47 * Math.PI) / 180);

// Arterial roads between the west cluster and the city centre
const CITY_LINKS = [
  ["CAM #412", "CAM #413"], // Bharat Nagar → Erragadda → Ameerpet (NH65)
  ["CAM #403", "CAM #415"], // Balanagar → Sanathnagar → Begumpet
  ["CAM #405", "CAM #414"], // Jubilee Hills Checkpost → Road No. 1 → Panjagutta
  ["CAM #405", "CAM #422"], // Jubilee Hills → Banjara Hills → Masab Tank → Mehdipatnam
];

const dist = (a, b) => Math.hypot((a.lng - b.lng) * COS_LAT, a.lat - b.lat);

export const EDGES = (() => {
  const set = new Set();
  const add = (a, b) => a !== b && set.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  const link = (a, b) => nodeIndex[a] != null && nodeIndex[b] != null && add(nodeIndex[a], nodeIndex[b]);
  CAMERA_NETWORK_EDGES.forEach(([a, b]) => link(a, b));
  CITY_LINKS.forEach(([a, b]) => link(a, b));
  NODES.forEach((n, i) => {
    NODES.map((m, j) => [j, dist(n, m)])
      .filter(([j]) => j !== i)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 2)
      .forEach(([j]) => add(i, j));
  });

  // Safety net: any camera group still cut off joins the network at its closest pair
  const parent = NODES.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  set.forEach((k) => {
    const [a, b] = k.split("|").map(Number);
    parent[find(a)] = find(b);
  });
  for (;;) {
    const root = find(0);
    let best = null;
    NODES.forEach((n, i) => {
      if (find(i) !== root) return;
      NODES.forEach((m, j) => {
        if (find(j) === root) return;
        const d = dist(n, m);
        if (!best || d < best[2]) best = [i, j, d];
      });
    });
    if (!best) break;
    add(best[0], best[1]);
    parent[find(best[1])] = root;
  }
  return [...set].map((k) => k.split("|").map(Number));
})();

/**
 * Fit the camera coordinates into box [x, y, w, h] (equirectangular, aspect preserved). With `focusIds`
 * only those cameras are fitted — the rest keep the same scale and may fall outside the box (zoomed view).
 */
export function projectNodes([bx, by, bw, bh], focusIds = null) {
  const xs = NODES.map((n) => n.lng * COS_LAT);
  const ys = NODES.map((n) => -n.lat);
  const fit = focusIds ? NODES.map((n, i) => (focusIds.includes(n.id) ? i : -1)).filter((i) => i >= 0) : NODES.map((_, i) => i);
  const fx = fit.map((i) => xs[i]);
  const fy = fit.map((i) => ys[i]);
  const [x0, x1, y0, y1] = [Math.min(...fx), Math.max(...fx), Math.min(...fy), Math.max(...fy)];
  const s = Math.min(bw / (x1 - x0), bh / (y1 - y0));
  const ox = bx + (bw - (x1 - x0) * s) / 2;
  const oy = by + (bh - (y1 - y0) * s) / 2;
  return NODES.map((_, i) => [ox + (xs[i] - x0) * s, oy + (ys[i] - y0) * s]);
}

/** Road between two projected points as a gentle quadratic curve: its control point. */
export function curveControl(A, B, flip) {
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
  const bend = (flip ? 1 : -1) * len * 0.16;
  return [(A[0] + B[0]) / 2 + (-(B[1] - A[1]) / len) * bend, (A[1] + B[1]) / 2 + ((B[0] - A[0]) / len) * bend];
}
