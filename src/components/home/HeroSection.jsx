import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Navigation, Pause, Play } from "lucide-react";
import { OCR_ACCURACY_TARGET, SNAPSHOT_TIME, cameraRegistry, hourlyTraffic, systemMetrics } from "../../data";
import { useDecodeText, useMagnetic } from "../fx/textFx";

// ── Hero media sequence ─────────────────────────────────────────────
// Three story stages, four clips: the street stage shows the cameras, then what they see.
const CLIPS = [
  { id: "globe", stage: 0, src: "/hero/globe-india.mp4", poster: "/hero/globe-india-poster.jpg", plays: 1, fallback: 10 },
  { id: "cctv", stage: 1, src: "/hero/cctv-cameras.mp4", poster: "/hero/cctv-cameras-poster.jpg", plays: 1, fallback: 4.9 },
  { id: "street", stage: 1, src: "/hero/city-traffic-timelapse.mp4", poster: "/hero/city-traffic-timelapse-poster.jpg", plays: 2, fallback: 4.9 },
  { id: "aerial", stage: 2, src: "/hero/aerial-city-night.mp4", poster: "/hero/aerial-city-night-poster.jpg", plays: 1, fallback: 14.4 },
];

const now = hourlyTraffic[Number(SNAPSHOT_TIME.slice(0, 2))];
const readsPerHour = cameraRegistry.reduce((s, c) => s + c.lastHour, 0);

const STAGES = [
  {
    short: "Global",
    label: "Global view · India",
    heading: "City-wide AI engine",
    body: "One connected intelligence layer over every ANPR camera in the city — built for Indian urban traffic.",
    ticker: `${systemMetrics.totalNodesActive} ANPR nodes · 5 zones · Hyderabad`,
  },
  {
    short: "Street",
    label: "Street view · Multi-camera",
    heading: "Multi-camera vehicle intelligence",
    body: `ANPR reads linked across cameras to reconstruct each vehicle's path, engineered for a >${OCR_ACCURACY_TARGET}% OCR accuracy target through glare, rain, motion blur and angled or damaged plates.`,
    ticker: `${readsPerHour.toLocaleString("en-IN")} plate reads / hour · OCR target >${OCR_ACCURACY_TARGET}%`,
  },
  {
    short: "City",
    label: "Urban flow · Aerial view",
    heading: "Macro traffic analytics",
    body: "Density, route volumes, congestion and origin–destination movement across the whole city, on one GIS map.",
    ticker: `${(now.flow / 1000).toFixed(1)}k veh/h · ${now.density}% capacity · ${now.speed} km/h at ${now.hour}`,
  },
];

const FADE_S = 1.4; // crossfade overlap before a clip ends

const firstClipOf = (stage) => CLIPS.findIndex((c) => c.stage === stage);

export default function HeroSection({ navigate, onEnter, reducedMotion }) {
  const heroRef = useRef(null);
  const videoRefs = useRef([]);
  const barRefs = useRef([]);
  const playCount = useRef(0);
  const primed = useRef(new Set([0]));

  const [active, setActive] = useState(0);
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  // Reduced-motion users start on the still poster; the play control opts in
  const [paused, setPaused] = useState(reducedMotion);

  useEffect(() => setPaused(reducedMotion), [reducedMotion]);

  // Mouse parallax: -1…1 offsets written as CSS variables (no re-renders); CSS moves the layers
  useEffect(() => {
    const el = heroRef.current;
    if (!el || reducedMotion) return;
    let raf = 0;
    let px = 0;
    let py = 0;
    const apply = () => {
      raf = 0;
      el.style.setProperty("--hx", px.toFixed(3));
      el.style.setProperty("--hy", py.toFixed(3));
    };
    const onMove = (e) => {
      if (e.pointerType !== "mouse") return;
      const r = el.getBoundingClientRect();
      px = ((e.clientX - r.left) / r.width - 0.5) * 2;
      py = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      px = 0;
      py = 0;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [reducedMotion]);

  // Only decode video while the hero is on screen and the tab is visible
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    const onVis = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const playing = inView && pageVisible && !paused;
  const stage = CLIPS[active].stage;

  const goTo = useCallback((index) => {
    const v = videoRefs.current[index];
    if (v) v.currentTime = 0;
    playCount.current = 0;
    setActive(index);
  }, []);

  const advance = useCallback(() => goTo((active + 1) % CLIPS.length), [active, goTo]);

  // Play the active clip; pause the others once the crossfade has finished
  useEffect(() => {
    const vids = videoRefs.current;
    if (!playing) {
      vids.forEach((v) => v?.pause());
      return;
    }
    vids[active]?.play().catch((err) => {
      if (err?.name === "NotAllowedError") setPaused(true);
    });
    const t = setTimeout(() => vids.forEach((v, i) => i !== active && v?.pause()), FADE_S * 1000 + 200);
    return () => clearTimeout(t);
  }, [active, playing]);

  // Fetch the next clip only once the current one is actually playing
  const primeNext = () => {
    const next = (active + 1) % CLIPS.length;
    const v = videoRefs.current[next];
    if (!v || primed.current.has(next)) return;
    primed.current.add(next);
    v.preload = "auto";
    v.load();
  };

  const onTime = (i) => (e) => {
    if (i !== active) return;
    const v = e.currentTarget;
    const clip = CLIPS[i];
    if (playCount.current >= clip.plays - 1 && v.duration && v.duration - v.currentTime <= FADE_S) advance();
  };

  const onEnded = (i) => (e) => {
    if (i !== active) return;
    playCount.current += 1;
    if (playCount.current < CLIPS[i].plays) {
      e.currentTarget.currentTime = 0;
      e.currentTarget.play().catch(() => {});
    } else advance();
  };

  // Stage progress bars — written straight to the DOM (no React re-renders per frame).
  // Snap them on every stage change (also while paused), then animate while playing.
  useEffect(() => {
    barRefs.current.forEach((bar, s) => {
      if (bar) bar.style.transform = `scaleX(${s < stage ? 1 : 0})`;
    });
  }, [stage]);

  useEffect(() => {
    if (!playing) return;
    let raf;
    const tick = () => {
      const clipsInStage = CLIPS.map((c, i) => ({ ...c, i })).filter((c) => c.stage === stage);
      const len = (c) => (videoRefs.current[c.i]?.duration || c.fallback) * c.plays;
      const total = clipsInStage.reduce((s, c) => s + len(c), 0);
      let done = 0;
      for (const c of clipsInStage) {
        if (c.i < active) done += len(c);
        if (c.i === active) {
          const v = videoRefs.current[c.i];
          done += (v?.duration || c.fallback) * playCount.current + (v?.currentTime || 0);
        }
      }
      barRefs.current.forEach((bar, s) => {
        if (bar) bar.style.transform = `scaleX(${s < stage ? 1 : s > stage ? 0 : Math.min(1, done / total)})`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, active, stage]);

  const copy = STAGES[stage];
  // each stage's headline and data ticker "lock on" like a plate read
  const headingRef = useDecodeText(copy.heading, { duration: 800, delay: 150 });
  const tickerRef = useDecodeText(copy.ticker, { duration: 1100, delay: 350 });
  const primaryRef = useMagnetic();
  const secondaryRef = useMagnetic();

  return (
    <section ref={heroRef} aria-labelledby="tn-hero-title" className="tn-hero" data-stage={stage}>
      {/* Media: full-bleed clips, crossfading */}
      <div className="tn-hero-media" aria-hidden="true">
        {CLIPS.map((clip, i) => (
          <video
            key={clip.id}
            ref={(el) => (videoRefs.current[i] = el)}
            className={`tn-hero-clip tn-hero-clip--${clip.id} ${i === active ? "is-active" : ""}`}
            src={clip.src}
            poster={clip.poster}
            muted
            playsInline
            autoPlay={i === 0 && !reducedMotion}
            preload={i === 0 ? "auto" : "none"}
            disablePictureInPicture
            onPlaying={i === active ? primeNext : undefined}
            onTimeUpdate={onTime(i)}
            onEnded={onEnded(i)}
          />
        ))}
      </div>

      {/* Knockout: navy tint everywhere, white letterforms → the video shows through TRACE NET */}
      <div className="tn-hero-knockout" aria-hidden="true">
        <div className="tn-hero-stage">
          <p className="tn-hero-title">
            <span>Trace</span> <span>Net</span>
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="tn-hero-content">
        <div className="tn-hero-stage">
          <h1 id="tn-hero-title" className="tn-hero-title tn-hero-title--outline">
            <span className="sr-only">TraceNet — city-wide AI engine for multi-camera ANPR trajectory tracking and urban traffic analytics</span>
            <span aria-hidden="true">Trace</span> <span aria-hidden="true">Net</span>
          </h1>

          <div key={stage} className="tn-hero-copy">
            <p className="tn-hero-label">
              <span className="tn-hero-label-dot" aria-hidden="true" />
              {copy.label}
            </p>
            <h2 className="tn-hero-heading" aria-label={copy.heading}>
              <span ref={headingRef} aria-hidden="true">{copy.heading}</span>
            </h2>
            <p className="tn-hero-body">{copy.body}</p>
            <p className="tn-hero-ticker" aria-label={copy.ticker}>
              <span ref={tickerRef} aria-hidden="true">{copy.ticker}</span>
            </p>
          </div>

          <div className="mt-7 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
            <button ref={primaryRef} type="button" onClick={() => navigate("dashboard")} className="tn-btn-primary tn-btn-glow">
              Open Command Center
              <ArrowRight size={16} className="tn-btn-arrow" />
            </button>
            <button ref={secondaryRef} type="button" onClick={() => navigate("tracking")} className="tn-btn-secondary">
              <Navigation size={15} />
              Track a Vehicle
            </button>
          </div>

          {/* Stage navigation + progress */}
          <div className="tn-hero-stages" role="group" aria-label="Hero video sequence">
            {STAGES.map((s, i) => (
              <button
                key={s.short}
                type="button"
                onClick={() => goTo(firstClipOf(i))}
                aria-pressed={stage === i}
                className={`tn-hero-stage-btn ${stage === i ? "is-active" : ""}`}
              >
                <span className="tn-hero-stage-num">0{i + 1}</span>
                {s.short}
                <span className="tn-hero-stage-track" aria-hidden="true">
                  <span ref={(el) => (barRefs.current[i] = el)} className="tn-hero-stage-bar" />
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              className="tn-hero-play"
              aria-label={paused ? "Play hero video" : "Pause hero video"}
            >
              {paused ? <Play size={13} /> : <Pause size={13} />}
            </button>
          </div>
        </div>

        <button type="button" onClick={onEnter} className="tn-scroll-cue" aria-label="Scroll to explore the live camera network">
          <span>Scroll to explore</span>
          <ChevronDown size={16} className="tn-scroll-cue-arrow" />
        </button>
      </div>
    </section>
  );
}
