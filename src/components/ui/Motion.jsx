import { Component, useEffect, useLayoutEffect, useRef } from "react";
import { ArrowDownRight, ArrowUpRight, MapPinOff, RotateCw } from "lucide-react";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Number that eases from its previous value to the new one (rAF, writes the DOM directly —
 * no React re-render per frame). On mount it counts up from 0 (`countUp={false}` to skip);
 * after that it only animates when `value` actually changes.
 */
export function AnimatedNumber({ value, format = (v) => v.toLocaleString("en-IN"), duration = 600, countUp = true, className }) {
  const ref = useRef(null);
  // The rendered text is fixed at mount: React never rewrites it, the effect owns textContent
  const initial = useRef(countUp && typeof value === "number" && value !== 0 && !reducedMotion() ? 0 : value);
  const shown = useRef(initial.current);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || value == null || Number.isNaN(value)) return;
    const from = shown.current ?? value;
    const first = !mounted.current;
    mounted.current = true;
    if (from === value || reducedMotion()) {
      shown.current = value;
      el.textContent = format(value);
      return;
    }
    // integer targets never show fractional frames ("1,234.567")
    const integer = Number.isInteger(value);
    const ms = first ? Math.max(duration, 900) : duration;
    let raf;
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, first ? 4 : 3);
      shown.current = from + (value - from) * eased;
      el.textContent = format(t === 1 ? value : integer ? Math.round(shown.current) : shown.current);
      if (t < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // If frames aren't being painted (occluded window, background tab), still land on the true value
    const settle = setTimeout(() => {
      cancelAnimationFrame(raf);
      shown.current = value;
      el.textContent = format(value);
    }, ms + 80);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {value == null ? "—" : format(initial.current ?? value)}
    </span>
  );
}

/**
 * Small change indicator. `good` says which direction is healthy for this metric
 * ("up" for speed, "down" for density/delay); `neutral` for plain volume changes.
 */
export function Delta({ pct, good = "neutral", digits = 1, className = "" }) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const flat = Math.abs(pct) < 0.05;
  const up = pct > 0;
  const tone = flat || good === "neutral" ? "tn-delta--neutral" : (up && good === "up") || (!up && good === "down") ? "tn-delta--good" : Math.abs(pct) >= 5 ? "tn-delta--bad" : "tn-delta--warn";
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`tn-delta ${tone} ${className}`} aria-label={`${up ? "up" : "down"} ${Math.abs(pct).toFixed(digits)} percent since last update`}>
      {!flat && <Icon size={11} aria-hidden="true" />}
      {flat ? "±0" : `${Math.abs(pct).toFixed(digits)}%`}
    </span>
  );
}

/** Adds a class for `ms` whenever `trigger` changes (e.g. a brief "synced" flash). */
export function useFlash(trigger, ms = 700) {
  const ref = useRef(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el) return;
    el.classList.remove("is-flashing");
    void el.offsetWidth; // restart the animation
    el.classList.add("is-flashing");
    const t = setTimeout(() => el.classList.remove("is-flashing"), ms);
    return () => clearTimeout(t);
  }, [trigger, ms]);
  return ref;
}

/** Keeps a failing map/data widget from taking the whole page down. */
export class MapBoundary extends Component {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err) {
    console.warn("[TraceNet] map component failed:", err);
  }
  render() {
    if (!this.state.failed) return <div key={this.state.attempt} className="contents">{this.props.children}</div>;
    return (
      <div className="tn-fallback" role="alert">
        <MapPinOff size={22} aria-hidden="true" />
        <p className="tn-fallback-title">{this.props.label ?? "Map data unavailable"}</p>
        <p className="tn-fallback-sub">The rest of the page keeps working.</p>
        <button type="button" className="tn-fallback-btn" onClick={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))}>
          <RotateCw size={13} /> Retry
        </button>
      </div>
    );
  }
}
