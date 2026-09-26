import { Cpu, Gauge, Layers } from "lucide-react";
import { DETECTOR_BENCH, DETECTOR_MODELS, OCR_PROFILES, OCR_RUNTIME, TRACENET_CLASSES, UVH26_CLASSES } from "../../data/pipeline";

const maxMs = Math.max(...OCR_PROFILES.map((p) => p.medianMs));
const fastest = Math.min(...OCR_PROFILES.map((p) => p.medianMs));
// log scale so 60 ms and 1.85 s are both readable
const msWidth = (ms) => Math.max(0.04, Math.log10(ms) / Math.log10(maxMs));

// Measured in docs/UPGRADES_OCR_DETECTOR_BENCHMARK.md

/** Detector upgrade: accuracy before/after and how the 14 Indian classes map onto TraceNet's 5. */
export function DetectorUpgrade() {
  return (
      <section className="premium-panel fade-up grid gap-6 p-5 sm:p-6 lg:grid-cols-2" aria-labelledby="tn-det-title">
        <div>
        <p className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.22em] text-blue-600">
          <Layers size={13} aria-hidden="true" />
          Vehicle detector upgrade
        </p>
        <h2 id="tn-det-title" className="mt-1.5 text-xl font-black tracking-tight text-gray-900">
          Built for Indian roads
        </h2>
        <p className="mt-1 text-[12px] font-semibold text-gray-500">
          {DETECTOR_MODELS.before} → {DETECTOR_MODELS.after} · 60 validation frames, 800 labelled vehicles
        </p>

        <div className="mt-4 flex items-center gap-4 text-[11px] font-bold text-gray-500">
          <span className="flex items-center gap-1.5"><span className="tn-bench-key tn-bench-key--before" />Before</span>
          <span className="flex items-center gap-1.5"><span className="tn-bench-key tn-bench-key--after" />After</span>
        </div>
        <ul className="mt-2 flex flex-col gap-2.5">
          {DETECTOR_BENCH.map((m, i) => (
            <li key={m.metric}>
              <div className="flex items-baseline justify-between text-[12px]">
                <span className="font-bold text-gray-700">{m.metric}</span>
                <span className="font-mono text-[11px] font-bold text-gray-500">
                  {m.before}% → <b className="text-emerald-600">{m.after}%</b>
                </span>
              </div>
              <div className="tn-bench-pair">
                <span className="tn-bench-bar tn-bench-bar--before" style={{ "--w": m.before / 100, "--d": `${i * 70}ms` }} />
                <span className="tn-bench-bar tn-bench-bar--after" style={{ "--w": m.after / 100, "--d": `${i * 70 + 120}ms` }} />
              </div>
            </li>
          ))}
        </ul>

        </div>
        <div>
        <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-gray-500">14 Indian classes → 5 tracked classes</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {TRACENET_CLASSES.map((cls) => (
            <div key={cls} className="tn-class-group">
              <span className="tn-class-target">{cls}</span>
              <span className="flex flex-wrap gap-1">
                {UVH26_CLASSES.filter((c) => c.to === cls).map((c) => (
                  <span key={c.name} className="tn-class-chip">{c.name}</span>
                ))}
              </span>
            </div>
          ))}
          <div className="tn-class-group tn-class-group--skip">
            <span className="tn-class-target">Not tracked</span>
            <span className="flex flex-wrap gap-1">
              {UVH26_CLASSES.filter((c) => !c.to).map((c) => (
                <span key={c.name} className="tn-class-chip">{c.name}</span>
              ))}
              <span className="text-[10.5px] font-semibold text-gray-400">no number plate</span>
            </span>
          </div>
        </div>
        </div>
      </section>
  );
}

/** OCR engine upgrade: latency per profile and the runtime fallback plan. */
export function OcrUpgrade() {
  return (
      <section className="premium-panel fade-up p-5 sm:p-6" aria-labelledby="tn-ocrspeed-title">
        <p className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.22em] text-blue-600">
          <Gauge size={13} aria-hidden="true" />
          OCR engine upgrade
        </p>
        <h2 id="tn-ocrspeed-title" className="mt-1.5 text-xl font-black tracking-tight text-gray-900">
          ~{Math.round(maxMs / fastest)}× faster plate reading
        </h2>
        <p className="mt-1 text-[12px] font-semibold text-gray-500">Median time per plate crop on CPU · 60 synthetic + 80 real crops</p>

        <ul className="mt-4 flex flex-col gap-3">
          {OCR_PROFILES.map((p, i) => (
            <li key={p.name}>
              <div className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className={`font-bold ${p.current ? "text-gray-900" : "text-gray-600"}`}>
                  {p.name}
                  {p.current && <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-extrabold text-emerald-600">IN USE</span>}
                </span>
                <span className="font-mono text-[12px] font-black text-gray-900">{p.range}</span>
              </div>
              <div className="tn-speed-track">
                <span className={`tn-speed-bar ${p.current ? "is-current" : ""}`} style={{ "--w": msWidth(p.medianMs), "--d": `${i * 120}ms` }} />
              </div>
              <p className="mt-1 text-[10.5px] font-semibold text-gray-400">
                Exact on synthetic plates {p.exact} · real reads kept {p.kept}
              </p>
            </li>
          ))}
        </ul>

        <p className="mt-5 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-gray-500">
          <Cpu size={13} aria-hidden="true" />
          Runtime plan · tried in order at startup
        </p>
        <ol className="tn-runtime">
          {OCR_RUNTIME.map((r) => (
            <li key={r.name} className={r.active ? "is-active" : ""}>
              <span className="tn-runtime-name">{r.name}</span>
              <span className="tn-runtime-detail">{r.detail}</span>
              {r.active && <span className="tn-runtime-badge">active on the dev machine</span>}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] font-semibold leading-relaxed text-gray-400">
          Each rung runs one real inference before it is accepted, so a missing TensorRT library or GPU falls back cleanly.
        </p>
      </section>
  );
}
