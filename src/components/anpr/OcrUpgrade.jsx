import { Cpu, Gauge } from "lucide-react";
import { OCR_PROFILES, OCR_RUNTIME } from "../../data/pipeline";

const maxMs = Math.max(...OCR_PROFILES.map((p) => p.medianMs));
const fastest = Math.min(...OCR_PROFILES.map((p) => p.medianMs));
// log scale so 60 ms and 1.85 s are both readable
const msWidth = (ms) => Math.max(0.04, Math.log10(ms) / Math.log10(maxMs));

// Measured in docs/UPGRADES_OCR_DETECTOR_BENCHMARK.md

/** OCR engine upgrade: latency per profile and the runtime fallback plan. */
export default function OcrUpgrade() {
  return (
      <section className="premium-panel fade-up grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.4fr_1fr]" aria-labelledby="tn-ocrspeed-title">
        <div>
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
        </div>

        <div>
        <p className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-gray-500">
          <Cpu size={13} aria-hidden="true" />
          Runtime plan · tried in order at startup
        </p>
        <ol className="tn-runtime tn-runtime--stack">
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
        </div>
      </section>
  );
}
