import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Navigation, Pause, Play } from "lucide-react";

// Hero media sequence: global view (Earth zooming into India) → city view (street-level traffic).
const CLIPS = {
  globe: {
    src: "/hero/globe-india.mp4",
    poster: "/hero/globe-india-poster.jpg",
    caption: "Global view · India",
  },
  city: {
    src: "/hero/city-traffic-timelapse.mp4",
    poster: "/hero/city-traffic-timelapse-poster.jpg",
    caption: "City view · Street level",
  },
};

const CROSSFADE_S = 1.6; // start the crossfade this many seconds before the globe clip ends
const CITY_HOLD_MS = 9800; // two passes of the ~4.9s traffic loop, then back to the globe

const CAPABILITIES = [
  "Multi-camera ANPR",
  "Trajectory reconstruction",
  "City-wide traffic analytics",
  "GIS intelligence",
];

export default function HeroSection({ navigate, onEnter, reducedMotion }) {
  const heroRef = useRef(null);
  const globeRef = useRef(null);
  const cityRef = useRef(null);
  const cityPrimed = useRef(false);

  const [phase, setPhase] = useState("globe");
  const [inView, setInView] = useState(true);
  // Reduced-motion users start on the still poster and can opt in with the play control
  const [paused, setPaused] = useState(reducedMotion);

  useEffect(() => {
    setPaused(reducedMotion);
  }, [reducedMotion]);

  // Stop decoding video while the hero is scrolled out of view
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.05,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Browsers defer media in background tabs — resume once the page is visible again
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const playing = inView && pageVisible && !paused;

  // Play the visible clip; pause the hidden one once the crossfade has finished
  useEffect(() => {
    const globe = globeRef.current;
    const city = cityRef.current;
    if (!globe || !city) return;
    if (!playing) {
      globe.pause();
      city.pause();
      return;
    }
    const [current, other] = phase === "globe" ? [globe, city] : [city, globe];
    current.play().catch((err) => {
      // Autoplay blocked (e.g. power-saving mode): fall back to the poster + play control
      if (err?.name === "NotAllowedError") setPaused(true);
    });
    const t = setTimeout(() => other.pause(), CROSSFADE_S * 1000);
    return () => clearTimeout(t);
  }, [phase, playing]);

  // Hold on the city view, then return to the globe
  useEffect(() => {
    if (phase !== "city" || !playing) return;
    const t = setTimeout(() => {
      if (globeRef.current) globeRef.current.currentTime = 0;
      setPhase("globe");
    }, CITY_HOLD_MS);
    return () => clearTimeout(t);
  }, [phase, playing]);

  const goToCity = useCallback(() => {
    if (cityRef.current) cityRef.current.currentTime = 0;
    setPhase("city");
  }, []);

  // Only fetch the traffic clip once the globe is actually playing
  const primeCity = () => {
    const city = cityRef.current;
    if (cityPrimed.current || !city) return;
    cityPrimed.current = true;
    city.preload = "auto";
    city.load();
  };

  const onGlobeTime = (e) => {
    const v = e.currentTarget;
    if (phase === "globe" && v.duration && v.duration - v.currentTime <= CROSSFADE_S) goToCity();
  };

  const clip = CLIPS[phase];

  return (
    <section
      ref={heroRef}
      aria-labelledby="tn-hero-title"
      className="tn-hero relative isolate flex min-h-[88svh] flex-col overflow-hidden lg:min-h-[100svh] lg:pt-[var(--tn-nav-h)]"
    >
      <div className="tn-hero-grid" aria-hidden="true" />
      <div className="tn-hero-glow" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex w-full max-w-[1600px] flex-1 flex-col items-center justify-center px-4 pb-24 pt-6 sm:px-8 lg:pb-28">
        <h1 id="tn-hero-title" className="sr-only">
          TraceNet — City-wide AI engine for multi-camera vehicle intelligence
        </h1>

        {/* TRACE  [ media ]  NET */}
        <div className="tn-hero-lockup">
          <span className="tn-hero-word tn-hero-word--left" aria-hidden="true">
            Trace
          </span>

          <div className="tn-portal" data-phase={phase}>
            <div className="tn-portal-ring tn-portal-ring--sweep" aria-hidden="true" />
            <div className="tn-portal-ring tn-portal-ring--ticks" aria-hidden="true" />
            <div className="tn-portal-lens" aria-hidden="true">
              <video
                ref={globeRef}
                className={`tn-portal-media tn-portal-media--globe ${phase === "globe" ? "is-active" : ""}`}
                src={CLIPS.globe.src}
                poster={CLIPS.globe.poster}
                autoPlay={!reducedMotion}
                muted
                playsInline
                preload="auto"
                disablePictureInPicture
                onPlaying={primeCity}
                onTimeUpdate={onGlobeTime}
                onEnded={() => phase === "globe" && goToCity()}
              />
              <video
                ref={cityRef}
                className={`tn-portal-media tn-portal-media--city ${phase === "city" ? "is-active" : ""}`}
                src={CLIPS.city.src}
                poster={CLIPS.city.poster}
                muted
                loop
                playsInline
                preload="none"
                disablePictureInPicture
              />
              <div className="tn-portal-vignette" />
            </div>

            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              className="tn-portal-control"
              aria-label={paused ? "Play hero video" : "Pause hero video"}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>

            <div className="tn-portal-caption" aria-live="polite">
              <span className={`tn-portal-caption-dot ${phase === "city" ? "is-city" : ""}`} />
              {clip.caption}
            </div>
          </div>

          <span className="tn-hero-word tn-hero-word--right" aria-hidden="true">
            Net
          </span>
        </div>

        {/* Supporting message */}
        <p className="mt-8 max-w-[40rem] text-center text-[13px] font-extrabold uppercase leading-relaxed tracking-[0.28em] text-slate-100 sm:text-sm md:mt-16">
          City-wide AI engine for
          <br />
          <span className="text-blue-300">multi-camera vehicle intelligence</span>
        </p>

        <ul className="mt-4 flex max-w-[44rem] flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[12px] font-semibold text-slate-400">
          {CAPABILITIES.map((c, i) => (
            <li key={c} className="flex items-center gap-3">
              {i > 0 && <span className="h-1 w-1 rounded-full bg-blue-500/70" aria-hidden="true" />}
              {c}
            </li>
          ))}
        </ul>

        <div className="mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
          <button type="button" onClick={() => navigate("dashboard")} className="tn-btn-primary">
            Open Command Center
            <ArrowRight size={16} className="tn-btn-arrow" />
          </button>
          <button type="button" onClick={() => navigate("tracking")} className="tn-btn-secondary">
            <Navigation size={15} />
            Track a Vehicle
          </button>
        </div>
      </div>

      <button type="button" onClick={onEnter} className="tn-scroll-cue" aria-label="Scroll to enter the command center">
        <span>Scroll to enter</span>
        <ChevronDown size={16} className="tn-scroll-cue-arrow" />
      </button>

      <div className="tn-hero-fade" aria-hidden="true" />
    </section>
  );
}
