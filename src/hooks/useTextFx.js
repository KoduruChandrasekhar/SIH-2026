import { useEffect, useRef } from "react";

const GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * OCR-style "decode": the text resolves left → right out of random plate glyphs, like an ANPR read
 * locking on. Writes textContent directly (no re-renders); give the element aria-label={text}.
 */
export function useDecodeText(text, { duration = 750, delay = 0 } = {}) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (reduced()) {
      el.textContent = text;
      return undefined;
    }
    const chars = [...text];
    const start = performance.now() + delay;
    let raf = 0;
    const frame = (now) => {
      const t = Math.max(0, now - start);
      let out = "";
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        const resolveAt = (i / chars.length) * duration * 0.7 + duration * 0.3;
        out += c === " " || t >= resolveAt ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out;
      if (t < duration) raf = requestAnimationFrame(frame);
      else el.textContent = text;
    };
    raf = requestAnimationFrame(frame);
    const settle = setTimeout(() => {
      cancelAnimationFrame(raf);
      el.textContent = text;
    }, delay + duration + 120);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [text, duration, delay]);
  return ref;
}

/** Element drifts a few px toward the pointer while it is near (uses `translate`, so hover transforms still work). */
export function useMagnetic(strength = 0.25, max = 10) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return undefined;
    let raf = 0;
    let target = [0, 0];
    const apply = () => {
      raf = 0;
      el.style.translate = `${target[0]}px ${target[1]}px`;
    };
    const onMove = (e) => {
      if (e.pointerType !== "mouse") return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const clamp = (v) => Math.max(-max, Math.min(max, v * strength));
      target = [clamp(dx), clamp(dy)];
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      target = [0, 0];
      if (!raf) raf = requestAnimationFrame(apply);
    };
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.style.translate = "";
    };
  }, [strength, max]);
  return ref;
}
