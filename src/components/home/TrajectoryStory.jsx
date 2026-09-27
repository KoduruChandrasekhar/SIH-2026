import { useEffect, useRef } from "react";
import { Check, Clock, Gauge, Route, ScanLine } from "lucide-react";
import { cameraById, cameraRegistry } from "../../data/data";
import { DEMO_GLOBAL_ID, DEMO_OBSERVATIONS, DEMO_VEHICLE } from "../../data/demoData";

// ─── Street-level map (SVG user units) ───────────────────────────────────────
// A stylised GIS view — city blocks, arterials, an expressway, a lake and a park — deliberately different
// from the abstract network above. The vehicle's route follows the streets, turning at junctions.
const VIEW = [640, 480];
const PITCH = 40; // one city block + street
const STREET = 6;

const BLOCKS = (() => {
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = [];
  for (let x = 0; x < VIEW[0]; x += PITCH)
    for (let y = 0; y < VIEW[1]; y += PITCH) out.push({ x: x + STREET / 2, y: y + STREET / 2, dense: rnd() < 0.28 });
  return out;
})();
const ARTERIALS = ["M0 120H640", "M0 280H640", "M280 0V480", "M520 0V480"];
const EXPRESSWAY = "M200 0L640 440";
const LAKE = "M540 360c34-22 86-14 108 12s8 70-30 88-96 6-110-24 0-58 32-76z";
const PARK = "M83 203h74v74h-74z";

// Camera positions at junctions: the four journey cameras + the rest of the cluster (dimmed)
const ROUTE_POS = { "CAM #401": [360, 160], "CAM #402": [280, 120], "CAM #403": [520, 280], "CAM #406": [200, 360] };
// label placement per camera: on the side its route segments don't use (dx, dy, text-anchor)
const LABEL = {
  "CAM #401": [16, 30, "start"],
  "CAM #402": [-16, -28, "end"],
  "CAM #403": [16, 30, "start"],
  "CAM #406": [0, 32, "middle"],
};
const OTHER_POS = [[400, 240], [360, 400], [120, 160], [240, 40], [440, 40], [80, 400], [320, 200], [600, 200]];
const OTHER_CAMS = cameraRegistry.filter((c) => !ROUTE_POS[c.id]).map((c, i) => ({ ...c, pos: OTHER_POS[i % OTHER_POS.length] }));

// The driven route (one continuous, non-crossing path): 401 → 402 (two turns), east along the arterial and
// south to 403, then west along the arterial — over the expressway — and south-west to 406
const ROUTE = "M360 160H280V120H520V280H280V360H200";
const HOPS = DEMO_OBSERVATIONS.map((o) => ({ ...o, pos: ROUTE_POS[o.camera], label: LABEL[o.camera], code: cameraById[o.camera]?.code ?? o.camera }));

const toSec = (t) => t.split(":").reduce((s, v) => s * 60 + Number(v), 0);
const TOTAL_KM = HOPS.reduce((s, h) => s + parseFloat(h.distance), 0);
const TOTAL_MIN = Math.round((toSec(HOPS.at(-1).time) - toSec(HOPS[0].time)) / 60);

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function TrajectoryStory() {
  const sectionRef = useRef(null);
  const routeRef = useRef(null);
  const glowRef = useRef(null);
  const cometRef = useRef(null);
  const cameraRef = useRef(null);
  const summaryRef = useRef(null);
  const hopRefs = useRef([]);
  const markerRefs = useRef([]);

  useEffect(() => {
    const section = sectionRef.current;
    const route = routeRef.current;
    // the reveal uses pathLength="1" (normalised dashes); positions along the path use real lengths
    const len = route.getTotalLength();
    // path length at which each camera is reached (nearest sample to each hop, in order)
    const reachAt = [];
    let from = 0;
    for (const h of HOPS) {
      const [hx, hy] = h.pos;
      let best = from;
      let bestD = Infinity;
      for (let l = from; l <= len; l += 2) {
        const pt = route.getPointAtLength(l);
        const d = (pt.x - hx) ** 2 + (pt.y - hy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = l;
        }
      }
      reachAt.push(best);
      from = best;
    }

    const [VW, VH] = VIEW;
    const render = (p) => {
      const drawn = p * len;
      // cinematic camera: pushes in and follows the vehicle mid-journey, pulls back to reveal the whole route
      const pt0 = route.getPointAtLength(drawn);
      const s = Math.pow(Math.sin(Math.PI * p), 0.8);
      const z = 1 + 0.6 * s;
      const clamp = (v, half, max) => Math.min(max - half, Math.max(half, v));
      const cx = clamp(VW / 2 + (pt0.x - VW / 2) * s, VW / (2 * z), VW);
      const cy = clamp(VH / 2 + (pt0.y - VH / 2) * s, VH / (2 * z), VH);
      cameraRef.current.setAttribute(
        "transform",
        `translate(${VW / 2} ${VH / 2}) scale(${z.toFixed(4)}) translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})`
      );
      route.style.strokeDashoffset = `${1 - p}`;
      glowRef.current.style.strokeDashoffset = `${1 - p}`;
      const pt = route.getPointAtLength(drawn);
      cometRef.current.setAttribute("transform", `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
      cometRef.current.style.opacity = p > 0.002 && p < 0.998 ? "1" : "0";
      const reached = reachAt.filter((l) => drawn >= l - 1).length - 1;
      HOPS.forEach((_, i) => {
        const state = i < reached || (i === reached && p >= 0.998) ? "done" : i === reached ? "active" : "idle";
        hopRefs.current[i]?.setAttribute("data-state", state);
        markerRefs.current[i]?.setAttribute("data-state", state);
      });
      summaryRef.current.setAttribute("data-state", p >= 0.985 ? "on" : "off");
    };

    if (reducedMotion()) {
      render(1);
      return undefined;
    }

    let raf = 0;
    let current = null;
    let target = 0;
    let last = 0;
    const measure = () => {
      const r = section.getBoundingClientRect();
      const vh = window.innerHeight;
      // starts as the section rises into view, completes as its end reaches the bottom of the screen
      target = Math.min(1, Math.max(0, (vh * 0.45 - r.top) / Math.max(1, r.height - vh * 0.55)));
    };
    const tick = (now) => {
      raf = 0;
      const dt = Math.max(0, Math.min(0.05, (now - (last || now)) / 1000));
      last = now;
      current = current == null ? target : current + (target - current) * (1 - Math.exp(-dt * 7));
      if (Math.abs(target - current) < 0.0006) current = target;
      render(current);
      if (current !== target) raf = requestAnimationFrame(tick);
      else last = 0;
    };
    const update = () => {
      measure();
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onScroll = update;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll, { passive: true });
        onScroll();
      } else {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
      }
    });
    io.observe(section);
    measure();
    current = target;
    render(current);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <section ref={sectionRef} className="tn-story" aria-labelledby="tn-story-title">
      <div className="tn-story-sticky">
        <div className="tn-story-grid">
          <div className="tn-story-copy">
            <header data-reveal>
              <p className="tn-eyebrow">
                <span className="tn-eyebrow-dot tn-eyebrow-dot--amber" aria-hidden="true" />
                Trajectory reconstruction
              </p>
              <h2 id="tn-story-title" className="tn-section-title">
                One vehicle.
                <span>Four cameras, one journey.</span>
              </h2>
              <p className="tn-section-body">
                Scroll to replay how separate ANPR reads become a single path — each camera hop re-identified and stitched
                into one trajectory as the vehicle moves across the city.
              </p>
            </header>

            <ol className="tn-story-hops" data-reveal>
              {HOPS.map((h, i) => (
                <li key={h.camera} ref={(el) => (hopRefs.current[i] = el)} className="tn-story-hop" data-state="idle">
                  <span className="tn-story-hop-dot" aria-hidden="true">
                    <span className="tn-story-hop-num">{i + 1}</span>
                    <Check size={13} className="tn-story-hop-check" />
                  </span>
                  <div className="min-w-0">
                    <p className="tn-story-hop-head">
                      <span>{h.code}</span>
                      <span className="tn-story-hop-time">
                        <Clock size={11} aria-hidden="true" />
                        {h.time}
                      </span>
                    </p>
                    <p className="tn-story-hop-name">{h.name}</p>
                    <p className="tn-story-hop-meta">
                      <span><Gauge size={11} aria-hidden="true" />{h.speedLabel}</span>
                      <span><ScanLine size={11} aria-hidden="true" />{h.confidence}% match</span>
                      {i > 0 && <span><Route size={11} aria-hidden="true" />+{h.distance}</span>}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="tn-story-map" data-reveal>
            <p className="tn-story-chip">
              <span className="tn-story-chip-dot" aria-hidden="true" />
              Global ID {DEMO_GLOBAL_ID} · {DEMO_VEHICLE.vehicleColor} {DEMO_VEHICLE.vehicleType.toLowerCase()}
            </p>

            <svg viewBox={`0 0 ${VIEW[0]} ${VIEW[1]}`} role="img" aria-label={`Route across ${HOPS.map((h) => h.code).join(", ")}`}>
              <defs>
                <linearGradient id="tn-story-route" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#fde68a" />
                  <stop offset="55%" stopColor="#fbbf24" />
                  <stop offset="100%" stopColor="#f97316" />
                </linearGradient>
                <radialGradient id="tn-story-halo">
                  <stop offset="0%" stopColor="rgba(251,191,36,0.55)" />
                  <stop offset="100%" stopColor="rgba(251,191,36,0)" />
                </radialGradient>
              </defs>
              <g ref={cameraRef}>
              <g className="tn-story-blocks">
                {BLOCKS.map((bl, i) => (
                  <rect key={i} x={bl.x} y={bl.y} width={PITCH - STREET} height={PITCH - STREET} rx="3" className={bl.dense ? "is-dense" : undefined} />
                ))}
              </g>
              <path d={PARK} className="tn-story-park" />
              <path d={LAKE} className="tn-story-lake" />
              {ARTERIALS.map((d) => (
                <path key={d} d={d} className="tn-story-artery" />
              ))}
              <path d={EXPRESSWAY} className="tn-story-expressway" />
              <path d={EXPRESSWAY} className="tn-story-expressway-line" />

              {OTHER_CAMS.map((c) => (
                <g key={c.id} className={`tn-story-node ${c.status === "offline" ? "is-offline" : ""}`}>
                  <circle cx={c.pos[0]} cy={c.pos[1]} r="3.5" />
                  <text x={c.pos[0] + 8} y={c.pos[1] - 7}>{c.code}</text>
                </g>
              ))}
              {HOPS.map((h) => (
                <text key={h.camera} className="tn-story-route-label" x={h.pos[0] + h.label[0]} y={h.pos[1] + h.label[1]} textAnchor={h.label[2]}>
                  {h.code}
                </text>
              ))}

              <path ref={glowRef} d={ROUTE} pathLength="1" className="tn-story-route-glow" />
              <path ref={routeRef} d={ROUTE} pathLength="1" className="tn-story-route" />

              {HOPS.map((h, i) => (
                <g key={h.camera} ref={(el) => (markerRefs.current[i] = el)} className="tn-story-marker" data-state="idle">
                  <circle className="tn-story-marker-ring" cx={h.pos[0]} cy={h.pos[1]} r="22" />
                  <circle className="tn-story-marker-core" cx={h.pos[0]} cy={h.pos[1]} r="9.5" />
                  <text className="tn-story-marker-time" x={h.pos[0] + h.label[0]} y={h.pos[1] + h.label[1] + 16} textAnchor={h.label[2]}>
                    {h.time}
                  </text>
                </g>
              ))}

              <g ref={cometRef} className="tn-story-comet" style={{ opacity: 0 }}>
                <circle r="30" fill="url(#tn-story-halo)" />
                <circle r="7" fill="#fff" />
              </g>
              </g>
            </svg>

            <dl ref={summaryRef} className="tn-story-summary" data-state="off">
              <div><dt>Cameras</dt><dd>{HOPS.length}</dd></div>
              <div><dt>Distance</dt><dd>{TOTAL_KM.toFixed(1)} km</dd></div>
              <div><dt>Travel time</dt><dd>{TOTAL_MIN} min</dd></div>
              <div><dt>OCR confidence</dt><dd>{DEMO_VEHICLE.ocrConfidence}%</dd></div>
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
