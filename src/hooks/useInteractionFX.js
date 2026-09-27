import { useEffect } from "react";

// Cards that get the cursor spotlight (a glow + border light that follows the pointer): the named card
// classes, plus the pages' Tailwind glass cards (rounded-[2x] + border + bg-white; index.css gives those
// a positioning context — keep the two selectors in sync)
const SPOT_SEL = [
  ".premium-panel, .tn-kpi, .tn-module, .metric-tile, [data-spot]",
  '.tn-inner [class*="rounded-[2"][class*="bg-white"][class*="border"]:not(.tn-navbar, .overflow-auto, .overflow-x-auto, .overflow-y-auto)',
].join(", ");
// Small tiles that also tilt a few degrees toward the pointer
const TILT_SEL = ".tn-kpi, [data-tilt]";
// Buttons that emit a press ripple
const RIPPLE_SEL = ".tn-btn-primary, .tn-btn-secondary, .tn-module-cta, .tn-press, button.bg-blue-600, button.bg-gray-900, [data-ripple]";

const MAX_TILT = 4; // degrees

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * App-wide pointer effects. One passive listener, rAF-throttled, and only the card under the
 * pointer is written to. State lives in data-* attributes and CSS variables so React re-renders
 * (which rewrite className) never wipe it.
 */
export default function useInteractionFX() {
  useEffect(() => {
    let lit = null;
    let raf = 0;
    let last = null;

    const unlight = () => {
      if (!lit) return;
      lit.removeAttribute("data-lit");
      lit = null;
    };

    const frame = () => {
      raf = 0;
      const e = last;
      if (!e) return;
      const target = e.target instanceof Element ? e.target.closest(SPOT_SEL) : null;
      // absolutely positioned glow needs a positioned host; skip static ones rather than restyle them
      // (only measured when the hovered card changes — no style recalcs while moving within one)
      const host = target === lit ? lit : target && getComputedStyle(target).position !== "static" ? target : null;
      if (host !== lit) {
        unlight();
        if (host) {
          host.setAttribute("data-spot", "");
          host.setAttribute("data-lit", "");
          lit = host;
        }
      }
      if (!lit) return;
      const r = lit.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      lit.style.setProperty("--mx", `${x}px`);
      lit.style.setProperty("--my", `${y}px`);
      if (lit.matches(TILT_SEL) && !reduced()) {
        lit.style.setProperty("--tn-rx", `${((x / r.width) - 0.5) * 2 * MAX_TILT}deg`);
        lit.style.setProperty("--tn-ry", `${(0.5 - y / r.height) * 2 * MAX_TILT}deg`);
      }
    };

    const onMove = (e) => {
      if (e.pointerType !== "mouse") return;
      last = e;
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const onLeaveWindow = (e) => {
      if (!e.relatedTarget) unlight();
    };

    const onDown = (e) => {
      if (e.button !== 0 || reduced()) return;
      const btn = e.target instanceof Element ? e.target.closest(RIPPLE_SEL) : null;
      if (!btn || btn.disabled) return;
      if (getComputedStyle(btn).position === "static") btn.style.position = "relative";
      const r = btn.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2.2;
      // clip inside a wrapper so the button itself never needs overflow:hidden (badges stay visible)
      const wrap = document.createElement("span");
      wrap.className = "tn-ripple-wrap";
      wrap.setAttribute("aria-hidden", "true");
      const dot = document.createElement("span");
      dot.className = "tn-ripple";
      dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      wrap.appendChild(dot);
      btn.appendChild(wrap);
      const done = () => wrap.remove();
      dot.addEventListener("animationend", done, { once: true });
      setTimeout(done, 900); // in case the animation never runs (hidden tab)
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerout", onLeaveWindow, { passive: true });
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      unlight();
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onLeaveWindow);
      document.removeEventListener("pointerdown", onDown);
    };
  }, []);
}
