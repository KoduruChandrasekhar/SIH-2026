import { useEffect, useRef } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { EDGES, NODES } from "../cityGraph";

/**
 * Road links between the cluster cameras, each coloured / paced by the congestion of the corridor its
 * cameras belong to (`corridors`: [{ cameras: ["CAM #401", …], color, speed, density }]).
 */
export function flowLinks(corridors = []) {
  const byCam = {};
  for (const c of corridors) for (const id of c.cameras ?? []) byCam[id] ??= c;
  return EDGES.filter(([a, b]) => NODES[a].online && NODES[b].online).map(([a, b]) => {
    const ca = byCam[NODES[a].id];
    const cb = byCam[NODES[b].id];
    // both ends on one corridor → that corridor; otherwise the more congested end governs the link
    const c = ca && cb ? ((ca.density ?? 0) >= (cb.density ?? 0) ? ca : cb) : ca ?? cb;
    return {
      from: [NODES[a].lat, NODES[a].lng],
      to: [NODES[b].lat, NODES[b].lng],
      color: c?.color ?? "#38bdf8",
      speed: c?.speed ?? 32,
      density: c?.density ?? 45,
    };
  });
}

const spriteCache = {};
function sprite(color) {
  if (spriteCache[color]) return spriteCache[color];
  const size = 20;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "#fff");
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return (spriteCache[color] = c);
}

/**
 * Live traffic flow on a Leaflet map: glowing vehicles travelling both ways along each link — slow and dense
 * on congested roads, fast and sparse on free-flowing ones. Canvas in its own pane (above the corridor
 * shapes, below markers / popups, never catches clicks); animates only while the map is on screen.
 */
export default function FlowLayer({ links }) {
  const map = useMap();
  const linksRef = useRef(links);
  linksRef.current = links;
  const relayoutRef = useRef(null);

  useEffect(() => {
    const pane = map.getPane("tnFlow") ?? map.createPane("tnFlow");
    pane.style.zIndex = "450";
    pane.style.pointerEvents = "none";
    const canvas = L.DomUtil.create("canvas", "tn-flow-canvas", pane);
    const g = canvas.getContext("2d");
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let W = 0;
    let H = 0;
    let segs = [];
    let parts = [];

    const layout = () => {
      const size = map.getSize();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = size.x;
      H = size.y;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const zoomScale = Math.pow(2, map.getZoom() - 13);
      segs = linksRef.current.map((l) => {
        const A = map.latLngToContainerPoint(l.from);
        const B = map.latLngToContainerPoint(l.to);
        const len = Math.max(1, Math.hypot(B.x - A.x, B.y - A.y));
        const ux = (B.x - A.x) / len;
        const uy = (B.y - A.y) / len;
        return { ...l, ax: A.x, ay: A.y, len, ux, uy, pxs: (10 + l.speed * 1.4) * Math.min(1.6, Math.max(0.6, zoomScale)) };
      });
      // keep particle phases across re-layouts when the network is unchanged
      const want = segs.reduce((s, sg) => s + 2 * Math.round(2 + sg.density / 14), 0);
      if (parts.length !== want) {
        parts = [];
        segs.forEach((sg, si) => {
          const n = Math.round(2 + sg.density / 14);
          for (const dir of [1, -1]) for (let k = 0; k < n; k++) parts.push({ si, dir, t: Math.random() });
        });
      }
    };

    const draw = (dt) => {
      g.clearRect(0, 0, W, H);
      g.lineCap = "round";
      for (const p of parts) {
        const s = segs[p.si];
        if (!s) continue;
        p.t = (p.t + (s.pxs * dt) / s.len) % 1;
        const along = (p.dir === 1 ? p.t : 1 - p.t) * s.len;
        // two lanes: each direction offset to its own side of the road
        const x = s.ax + s.ux * along - s.uy * 2.6 * p.dir;
        const y = s.ay + s.uy * along + s.ux * 2.6 * p.dir;
        const tail = Math.min(16, 4 + s.pxs * 0.18);
        g.globalAlpha = 0.5;
        g.strokeStyle = s.color;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x - s.ux * tail * p.dir, y - s.uy * tail * p.dir);
        g.lineTo(x, y);
        g.stroke();
        g.globalAlpha = 1;
        g.drawImage(sprite(s.color), x - 7, y - 7, 14, 14);
      }
    };

    let raf = 0;
    let last = 0;
    let running = false;
    let visible = false;
    let zooming = false;
    const frame = (now) => {
      const dt = Math.max(0, Math.min(0.05, (now - (last || now)) / 1000));
      last = now;
      draw(dt);
      if (running) raf = requestAnimationFrame(frame);
    };
    const sync = () => {
      const on = !still && visible && !zooming && !document.hidden;
      if (on && !running) {
        running = true;
        last = 0;
        raf = requestAnimationFrame(frame);
      } else if (!on && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    };

    const onZoomStart = () => {
      zooming = true;
      canvas.style.visibility = "hidden";
      sync();
    };
    const onViewChange = () => {
      zooming = false;
      layout();
      canvas.style.visibility = "";
      draw(0);
      sync();
    };
    map.on("zoomstart", onZoomStart);
    map.on("moveend zoomend resize", onViewChange);

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      sync();
    });
    io.observe(map.getContainer());
    document.addEventListener("visibilitychange", sync);

    layout();
    draw(0);
    relayoutRef.current = () => {
      layout();
      draw(0);
    };

    return () => {
      relayoutRef.current = null;
      running = false;
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      map.off("zoomstart", onZoomStart);
      map.off("moveend zoomend resize", onViewChange);
      canvas.remove();
    };
  }, [map]);

  // colours / speeds follow live corridor data without restarting the animation (or touching other layers)
  useEffect(() => {
    relayoutRef.current?.();
  }, [links]);

  return null;
}
