import { useEffect, useRef, useState } from "react";
import { Activity, Cctv, Radio, ScanLine } from "lucide-react";
import { cameraRegistry, systemMetrics } from "../../data/data";
import { DEMO_PLATE } from "../../data/demoData";
import { EDGES, NODES, curveControl, projectNodes } from "../../data/cityGraph";
import { AnimatedNumber } from "../motion/Motion";

const READS_TODAY = cameraRegistry.reduce((s, c) => s + c.today, 0);
const READS_HOUR = cameraRegistry.reduce((s, c) => s + c.lastHour, 0);
const OCR_AVG = (() => {
  const r = cameraRegistry.filter((c) => c.ocrRate != null);
  return r.reduce((s, c) => s + c.ocrRate, 0) / r.length;
})();

const COLORS = ["#38bdf8", "#60a5fa", "#818cf8", "#22d3ee"];
const TRACKED = "#fbbf24";
const PLATES = ["TS08EJ4892", "TS07FZ1029", "TS10UA9921", "TS09FA3307", "KA05MN8123", "TS08HK2210", "AP28BK8821", "TS09EE9911", "TS28C7745", "MH04EF7710"];

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function glowSprite(color, size = 24) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "#fff");
  grad.addColorStop(0.18, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}

/** Canvas engine: static city layer + additive trail layer + cleared overlay layer. Returns a disposer. */
function startPulse(stage, canvases, { onFrame } = {}) {
  const [baseC, trailC, topC] = canvases;
  const base = baseC.getContext("2d");
  const trail = trailC.getContext("2d");
  const top = topC.getContext("2d");
  const sprites = Object.fromEntries([...COLORS, TRACKED].map((c) => [c, glowSprite(c)]));
  const still = reducedMotion();

  let W = 0;
  let H = 0;
  let dpr = 1;
  let pts = []; // projected node positions
  let curves = []; // per edge: { a, b, c: control point, len }
  let vehicles = [];
  let pops = [];
  const pulses = new Float32Array(NODES.length);

  const bezier = (e, t, forward) => {
    const [A, B] = forward ? [pts[e.a], pts[e.b]] : [pts[e.b], pts[e.a]];
    const u = 1 - t;
    return [u * u * A[0] + 2 * u * t * e.c[0] + t * t * B[0], u * u * A[1] + 2 * u * t * e.c[1] + t * t * B[1]];
  };

  const layout = () => {
    const r = stage.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    for (const c of canvases) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    // wide screens: the network lives on the right, beside the copy
    const wide = W >= 1024;
    const box = wide ? [W * 0.44, H * 0.1, W * 0.53, H * 0.8] : [W * 0.06, H * 0.08, W * 0.88, H * 0.84];
    pts = projectNodes(box);
    curves = EDGES.map(([a, b], i) => {
      const [A, B] = [pts[a], pts[b]];
      return { a, b, c: curveControl(A, B, i % 2), len: Math.hypot(B[0] - A[0], B[1] - A[1]) * 1.05 };
    });
    drawBase(box);
    spawnVehicles(box);
    trail.clearRect(0, 0, W, H);
  };

  const drawBase = (box) => {
    base.clearRect(0, 0, W, H);
    // city lights: dense around the camera junctions, sparse elsewhere
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
    const n = Math.round(Math.min(2600, (box[2] * box[3]) / 110));
    for (let i = 0; i < n; i++) {
      let x;
      let y;
      if (rnd() < 0.75) {
        const p = pts[(rnd() * pts.length) | 0];
        x = p[0] + gauss() * box[2] * 0.14;
        y = p[1] + gauss() * box[3] * 0.14;
      } else {
        x = box[0] - box[2] * 0.1 + rnd() * box[2] * 1.2;
        y = box[1] - box[3] * 0.1 + rnd() * box[3] * 1.2;
      }
      const warm = rnd() < 0.12;
      base.fillStyle = warm ? `rgba(251,191,36,${0.08 + rnd() * 0.22})` : `rgba(148,183,255,${0.06 + rnd() * 0.22})`;
      base.fillRect(x, y, rnd() < 0.1 ? 1.6 : 1, rnd() < 0.1 ? 1.6 : 1);
    }
    // roads: soft glow + thin core
    for (const e of curves) {
      const [A, B] = [pts[e.a], pts[e.b]];
      const dim = !NODES[e.a].online || !NODES[e.b].online;
      base.beginPath();
      base.moveTo(A[0], A[1]);
      base.quadraticCurveTo(e.c[0], e.c[1], B[0], B[1]);
      base.strokeStyle = dim ? "rgba(248,113,113,0.05)" : "rgba(56,189,248,0.07)";
      base.lineWidth = 7;
      base.stroke();
      base.strokeStyle = dim ? "rgba(248,113,113,0.25)" : "rgba(148,163,184,0.28)";
      base.lineWidth = 1;
      base.setLineDash(dim ? [3, 5] : []);
      base.stroke();
      base.setLineDash([]);
    }
    // camera labels
    base.font = "700 9.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    base.textAlign = "left";
    NODES.forEach((n, i) => {
      base.fillStyle = n.online ? "rgba(191,219,254,0.7)" : "rgba(252,165,165,0.7)";
      base.fillText(n.code, pts[i][0] + 10, pts[i][1] - 8);
    });
  };

  const outgoing = (node, from) => {
    const opts = curves
      .map((e, i) => [e, i])
      .filter(([e]) => (e.a === node || e.b === node) && NODES[e.a].online && NODES[e.b].online);
    const noBack = opts.filter(([e]) => from == null || (e.a === node ? e.b : e.a) !== from);
    const pick = (noBack.length ? noBack : opts)[(Math.random() * (noBack.length || opts.length)) | 0];
    return pick ? { edge: pick[1], forward: pick[0].a === node } : null;
  };

  const spawnVehicles = (box) => {
    const scale = Math.sqrt((box[2] * box[3]) / (600 * 400));
    const count = Math.max(36, Math.min(130, Math.round(70 * scale)));
    const usable = curves.map((e, i) => i).filter((i) => NODES[curves[i].a].online && NODES[curves[i].b].online);
    vehicles = Array.from({ length: count }, (_, k) => {
      const edge = usable[(Math.random() * usable.length) | 0];
      return {
        edge,
        forward: Math.random() < 0.5,
        t: Math.random(),
        speed: (55 + Math.random() * 85) * Math.max(0.7, scale),
        color: k === 0 ? TRACKED : COLORS[(Math.random() * COLORS.length) | 0],
        tracked: k === 0,
        prev: null,
        from: null,
      };
    });
  };

  const arrive = (v) => {
    const e = curves[v.edge];
    const node = v.forward ? e.b : e.a;
    const from = v.forward ? e.a : e.b;
    pulses[node] = 1;
    if (!v.tracked && Math.random() < 0.18 && pops.length < 7) {
      const plate = PLATES[(Math.random() * PLATES.length) | 0];
      pops.push({ x: pts[node][0], y: pts[node][1], text: `${plate}  ✓ ${(90 + Math.random() * 9).toFixed(1)}%`, age: 0 });
    }
    const next = outgoing(node, from);
    if (next) {
      v.edge = next.edge;
      v.forward = next.forward;
    } else v.forward = !v.forward;
    v.t = 0;
  };

  const drawOverlay = (dt) => {
    top.clearRect(0, 0, W, H);
    // camera nodes + read ripples
    NODES.forEach((n, i) => {
      const [x, y] = pts[i];
      const p = pulses[i];
      if (p > 0) {
        const r = 6 + (1 - p) * 26;
        top.beginPath();
        top.arc(x, y, r, 0, Math.PI * 2);
        top.strokeStyle = `rgba(96,165,250,${p * 0.7})`;
        top.lineWidth = 1.5;
        top.stroke();
        pulses[i] = Math.max(0, p - dt * 1.4);
      }
      top.beginPath();
      top.arc(x, y, 7, 0, Math.PI * 2);
      top.fillStyle = n.online ? `rgba(37,99,235,${0.25 + p * 0.5})` : "rgba(239,68,68,0.25)";
      top.fill();
      top.beginPath();
      top.arc(x, y, 3.2, 0, Math.PI * 2);
      top.fillStyle = n.online ? (p > 0.3 ? "#fff" : "#93c5fd") : "#f87171";
      top.fill();
    });
    // plate-read pops rising off the cameras
    top.font = "700 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    top.textAlign = "center";
    pops = pops.filter((pp) => (pp.age += dt) < 1.8);
    for (const pp of pops) {
      const a = pp.age < 0.2 ? pp.age / 0.2 : 1 - Math.max(0, pp.age - 1.1) / 0.7;
      const y = pp.y - 16 - pp.age * 16;
      const w = top.measureText(pp.text).width + 14;
      top.globalAlpha = Math.max(0, a);
      roundRect(top, pp.x - w / 2, y - 12, w, 18, 6);
      top.fillStyle = "rgba(6,12,26,0.85)";
      top.fill();
      top.strokeStyle = "rgba(52,211,153,0.55)";
      top.lineWidth = 1;
      top.stroke();
      top.fillStyle = "#a7f3d0";
      top.fillText(pp.text, pp.x, y + 1);
      top.globalAlpha = 1;
    }
    // tracked vehicle: plate tag follows it
    const tv = vehicles[0];
    if (tv?.prev) {
      const [x, y] = tv.prev;
      top.font = "800 10.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      const label = `◉ ${DEMO_PLATE}`;
      const w = top.measureText(label).width + 16;
      roundRect(top, x - w / 2, y - 30, w, 19, 7);
      top.fillStyle = "rgba(24,16,2,0.85)";
      top.fill();
      top.strokeStyle = "rgba(251,191,36,0.85)";
      top.lineWidth = 1.2;
      top.stroke();
      top.fillStyle = "#fde68a";
      top.fillText(label, x, y - 17);
    }
  };

  let raf = 0;
  let last = 0;
  let running = false;

  const frame = (now) => {
    raf = 0;
    // clamp: no catch-up jumps after a pause, and never a negative step
    const dt = Math.max(0, Math.min(0.05, (now - (last || now)) / 1000));
    last = now;
    // time-based fade keeps trail length the same at 60 Hz and 120 Hz
    trail.globalCompositeOperation = "destination-out";
    trail.fillStyle = `rgba(0,0,0,${1 - Math.exp(-dt / 0.28)})`;
    trail.fillRect(0, 0, W, H);
    trail.globalCompositeOperation = "lighter";
    trail.lineCap = "round";
    for (const v of vehicles) {
      const e = curves[v.edge];
      v.t += (v.speed * (v.tracked ? 0.8 : 1) * dt) / e.len;
      if (v.t >= 1) {
        arrive(v);
        v.prev = null;
      }
      const [x, y] = bezier(curves[v.edge], Math.min(1, v.t), v.forward);
      if (v.prev) {
        trail.beginPath();
        trail.moveTo(v.prev[0], v.prev[1]);
        trail.lineTo(x, y);
        trail.strokeStyle = v.color;
        trail.lineWidth = v.tracked ? 2.6 : 1.6;
        trail.stroke();
      }
      const s = v.tracked ? 22 : 13;
      trail.drawImage(sprites[v.color], x - s / 2, y - s / 2, s, s);
      v.prev = [x, y];
    }
    trail.globalCompositeOperation = "source-over";
    drawOverlay(dt);
    onFrame?.();
    if (running) raf = requestAnimationFrame(frame);
  };

  const setRunning = (on) => {
    if (still) return;
    if (on && !running) {
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    } else if (!on && running) {
      running = false;
      cancelAnimationFrame(raf);
    }
  };

  layout();
  if (still) {
    // reduced motion: one composed frame, no animation
    for (let i = 0; i < 20; i++) frame(performance.now() + i * 16);
  }

  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);
  return {
    setRunning,
    dispose() {
      setRunning(false);
      ro.disconnect();
    },
  };
}

export default function NetworkPulse({ sectionRef }) {
  const stageRef = useRef(null);
  const baseRef = useRef(null);
  const trailRef = useRef(null);
  const topRef = useRef(null);
  const ownRef = useRef(null);
  const statsRef = useRef(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const section = ownRef.current;
    const engine = startPulse(stageRef.current, [baseRef.current, trailRef.current, topRef.current]);
    let visible = false;
    const sync = () => engine.setRunning(visible && !document.hidden);
    const io = new IntersectionObserver(
      ([e]) => {
        visible = e.isIntersecting;
        sync();
      },
      { threshold: 0.08 }
    );
    io.observe(section);
    // counters start when the stats themselves come into view
    const statsIo = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          statsIo.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    statsIo.observe(statsRef.current);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      statsIo.disconnect();
      document.removeEventListener("visibilitychange", sync);
      engine.dispose();
    };
  }, []);

  const setRefs = (el) => {
    ownRef.current = el;
    if (sectionRef) sectionRef.current = el;
  };

  const stats = [
    { icon: ScanLine, value: READS_TODAY, label: "Plate reads today", format: (v) => Math.round(v).toLocaleString("en-IN") },
    { icon: Activity, value: READS_HOUR, label: "Reads in the last hour", format: (v) => Math.round(v).toLocaleString("en-IN") },
    { icon: Radio, value: OCR_AVG, label: "Average OCR confidence", format: (v) => `${v.toFixed(1)}%` },
    { icon: Cctv, value: systemMetrics.totalNodesActive, label: "ANPR nodes city-wide", format: (v) => Math.round(v).toLocaleString("en-IN") },
  ];

  return (
    <section ref={setRefs} id="network-pulse" className="tn-netpulse" aria-labelledby="tn-netpulse-title">
      <div ref={stageRef} className="tn-netpulse-stage" data-reveal aria-hidden="true">
        <canvas ref={baseRef} />
        <canvas ref={trailRef} />
        <canvas ref={topRef} />
      </div>
      <div className="tn-netpulse-shade" aria-hidden="true" />

      <div className="tn-netpulse-content">
        <header data-reveal>
          <p className="tn-eyebrow">
            <span className="tn-eyebrow-dot tn-eyebrow-dot--live" aria-hidden="true" />
            Live network pulse
          </p>
          <h2 id="tn-netpulse-title" className="tn-section-title">
            Every camera, every read
            <span>in one living network.</span>
          </h2>
          <p className="tn-section-body">
          Each light-trail is a vehicle moving between ANPR cameras across West Hyderabad. Every junction it passes is a
          plate read, fused into one trajectory — the amber trail is a vehicle being tracked in real time.
          </p>
        </header>

        <dl ref={statsRef} className="tn-netpulse-stats" data-reveal>
          {stats.map(({ icon: Icon, value, label, format }) => (
            <div key={label} className="tn-netpulse-stat" data-spot="">
              <dt>
                <Icon size={14} aria-hidden="true" />
                {label}
              </dt>
              <dd>{seen ? <AnimatedNumber value={value} format={format} duration={1400} /> : format(0)}</dd>
            </div>
          ))}
        </dl>

        <ul className="tn-netpulse-legend" aria-label="Legend" data-reveal>
          <li><span className="tn-dot tn-dot--trail" />Vehicle trail</li>
          <li><span className="tn-dot tn-dot--tracked" />Tracked vehicle</li>
          <li><span className="tn-dot tn-dot--read" />Plate read</li>
        </ul>
      </div>
    </section>
  );
}
