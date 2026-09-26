import { useEffect, useState } from "react";
import { Filter } from "lucide-react";
import { fetchAnprRuns } from "../../lib/api";
import { ANPR_RUNS, FUNNEL_STEPS, STATUS_META } from "../../data/pipeline";

const fmt = (v) => (v ?? 0).toLocaleString("en-IN");
// log scale: the funnel spans thousands of detections down to a handful of reads
const width = (v, max) => (v > 0 ? Math.max(0.03, Math.log10(v + 1) / Math.log10(max + 1)) : 0);

/** The Phase 2 ANPR funnel per camera — live from /api/anpr when a backend is connected, else the saved runs. */
export default function AnprFunnel() {
  const [runs, setRuns] = useState(ANPR_RUNS);
  const [live, setLive] = useState(false);
  const [cam, setCam] = useState("CAM-402");

  useEffect(() => {
    let alive = true;
    fetchAnprRuns().then((cameras) => {
      if (!alive || !cameras || !Object.keys(cameras).length) return;
      const next = {};
      for (const [id, c] of Object.entries(cameras)) {
        next[id] = { name: c.camera?.name ?? id, source: c.run?.video ?? "", stats: c.stats ?? {} };
      }
      setRuns(next);
      setLive(true);
      setCam((current) => (next[current] ? current : Object.keys(next)[0]));
    });
    return () => {
      alive = false;
    };
  }, []);

  const run = runs[cam];
  const st = run?.stats ?? {};
  const max = Math.max(1, ...FUNNEL_STEPS.map((s) => st[s.key] ?? 0));
  const statuses = Object.entries(st.status_counts ?? {}).sort((a, b) => b[1] - a[1]);
  const totalObs = statuses.reduce((s, [, n]) => s + n, 0) || 1;
  const perCall = st.ocr_engine_calls ? st.ocr_seconds / st.ocr_engine_calls : null;

  return (
    <section className="premium-panel fade-up flex flex-col p-5 sm:p-6" aria-labelledby="tn-funnel-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.22em] text-blue-600">
            <Filter size={13} aria-hidden="true" />
            ANPR funnel · {live ? "live from the backend" : "saved pipeline runs"}
          </p>
          <h2 id="tn-funnel-title" className="mt-1.5 text-xl font-black tracking-tight text-gray-900">
            From every frame to a readable plate
          </h2>
        </div>
        <div className="flex gap-1.5" role="tablist" aria-label="Camera">
          {Object.keys(runs).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={id === cam}
              onClick={() => setCam(id)}
              className={`tn-press rounded-lg px-2.5 py-1 font-mono text-[11px] font-bold ${id === cam ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-1 text-[12px] font-semibold text-gray-500">
        {run?.name} · {fmt(st.frames_processed)} frames processed{run?.source ? ` · ${run.source}` : ""}
      </p>

      <ol className="mt-4 flex flex-col gap-2">
        {FUNNEL_STEPS.map((s, i) => {
          const v = st[s.key] ?? 0;
          return (
            <li key={s.key} className="tn-funnel-row">
              <div className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="font-bold text-gray-700">
                  {s.label} <span className="font-medium text-gray-400">· {s.hint}</span>
                </span>
                <span className="font-mono font-black tabular-nums text-gray-900">{fmt(v)}</span>
              </div>
              <div className="tn-funnel-track">
                <span className="tn-funnel-bar" style={{ transform: `scaleX(${width(v, max)})`, transitionDelay: `${i * 60}ms` }} />
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-5">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-gray-500">Outcome per tracked vehicle</p>
        <div className="tn-outcome-bar" role="img" aria-label={statuses.map(([k, n]) => `${STATUS_META[k]?.label ?? k}: ${n}`).join(", ")}>
          {statuses.map(([k, n]) => (
            <span key={k} style={{ flexGrow: n, background: STATUS_META[k]?.color ?? "#94a3b8" }} title={`${STATUS_META[k]?.label ?? k}: ${n}`} />
          ))}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-gray-500">
          {statuses.map(([k, n]) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: STATUS_META[k]?.color ?? "#94a3b8" }} />
              {STATUS_META[k]?.label ?? k} · {n} ({Math.round((n / totalObs) * 100)}%)
            </li>
          ))}
        </ul>
      </div>

      {perCall != null && (
        <p className="mt-4 rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[12px] font-semibold leading-relaxed text-gray-600">
          This run averaged <b className="text-gray-900">{perCall.toFixed(1)} s per OCR call</b> (model start-up included) on the older full
          detect+recognise path — the recognition-first hybrid path reads a typical crop in <b className="text-gray-900">~60 ms</b>.
        </p>
      )}
    </section>
  );
}
