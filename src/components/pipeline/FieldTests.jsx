import { useEffect, useRef, useState } from "react";
import { Car, CheckCircle2, Clapperboard, Pause, Play, ScanLine, ShieldCheck, Vote } from "lucide-react";
import { FIELD_TESTS } from "../../data/fieldTests";
import { AnimatedNumber } from "../ui/Motion";

// The pipeline's stages, each tied to the funnel rows it produces (labels match FIELD_TESTS[].funnel)
const STAGES = [
  { icon: Car, title: "Detect & classify", rows: ["Vehicles in view"],
    body: "The YOLO11 detector finds every vehicle and names its class: hatchback, SUV, auto, two-wheeler, bus." },
  { icon: Clapperboard, title: "Track", rows: ["Vehicles tracked"],
    body: "ByteTrack links the boxes frame to frame, so each vehicle keeps one ID for as long as it stays in view." },
  { icon: ScanLine, title: "Find the plate", rows: ["Plate located"],
    body: "On sampled frames the plate localiser searches each vehicle; a plate belongs to the nearest vehicle whose box holds it." },
  { icon: ShieldCheck, title: "Quality gate → OCR", rows: ["Clear enough to read"],
    body: "Each crop is scored for size, sharpness, skew and exposure; only a vehicle's best few crops are enhanced and read." },
  { icon: Vote, title: "Validate & vote", rows: ["Plates read"],
    body: "Reads are checked against Indian formats and real state codes, then the vehicle's frames vote on one plate." },
];
const STAGE_MS = 3600;

const fmt = (v) => v.toLocaleString("en-IN");
// log scale: the funnel runs from thousands of detections down to a handful of plates
const width = (v, max) => (v > 0 ? Math.max(0.03, Math.log10(v + 1) / Math.log10(max + 1)) : 0);

// Indian registration plate → labelled parts (standard or BH series)
function plateParts(text) {
  const bh = text.match(/^(\d{2})(BH)(\d{4})([A-Z]{1,2})$/);
  if (bh) return [[bh[1], "Year"], [bh[2], "Bharat series"], [bh[3], "Number"], [bh[4], "Series"]];
  const m = text.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{4})$/);
  if (!m) return [[text, "Plate"]];
  return [[m[1], "State code"], [m[2], "RTO"], ...(m[3] ? [[m[3], "Series"]] : []), [m[4], "Number"]];
}

function PlateCard({ plate, selected, onSelect }) {
  return (
    <li>
      <button type="button" onClick={onSelect} aria-pressed={selected} className={`tn-field-plate ${selected ? "is-selected" : ""}`}>
      <img src={plate.view} alt={`Plate ${plate.text} on the vehicle`} loading="lazy" className="tn-field-plate-view" />
      <div className="flex items-center gap-2 p-2.5 text-left">
        <img src={plate.crop} alt="" loading="lazy" className="h-7 w-auto max-w-[45%] rounded border border-gray-200 object-contain" />
        <div className="min-w-0">
          <p className="font-mono text-[13px] font-black tracking-[0.08em] text-gray-900">{plate.text}</p>
          <p className="text-[10.5px] font-semibold text-gray-500">
            {plate.reads > 1 ? `${plate.reads} frames agree` : "Read and validated"}
          </p>
        </div>
        <CheckCircle2 size={15} className="ml-auto flex-none text-emerald-500" aria-label="Valid Indian plate" />
      </div>
      </button>
    </li>
  );
}

/** The selected plate, broken into its registration parts, with the checks it passed. */
function PlateAnatomy({ plate }) {
  const checks = [
    "Matches the Indian registration format",
    "Recognised state / series code",
    plate.reads > 1 ? `${plate.reads} frames voted for the same text` : "Best-quality crop read and confirmed",
  ];
  return (
    <div key={plate.text} className="tn-field-anatomy tn-new-item">
      <p className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-emerald-600">
        <Vote size={13} aria-hidden="true" /> Validate &amp; vote
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-10 gap-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <img src={plate.crop} alt={`Plate crop reading ${plate.text}`} className="h-14 w-auto max-w-[240px] rounded-lg border border-gray-200 object-contain" />
          <span className="text-lg font-black text-gray-300" aria-hidden="true">→</span>
          <ol className="flex flex-wrap gap-1.5" aria-label={`${plate.text}, split into its parts`}>
            {plateParts(plate.text).map(([part, label]) => (
              <li key={label} className="tn-field-part">
                <span className="font-mono text-[17px] font-black tracking-[0.06em] text-gray-900">{part}</span>
                <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-gray-500">{label}</span>
              </li>
            ))}
          </ol>
        </div>
        <ul className="flex flex-col gap-1.5">
          {checks.map((c) => (
            <li key={c} className="flex items-center gap-2 text-[12px] font-semibold text-gray-600">
              <CheckCircle2 size={14} className="flex-none text-emerald-500" aria-hidden="true" />
              {c}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Field test: the same pipeline run on recorded Indian street footage — the annotated output video,
 * a guided walk through the stages with that clip's own numbers, and the plates it read.
 */
export default function FieldTests() {
  const [clipIdx, setClipIdx] = useState(0);
  const [plateIdx, setPlateIdx] = useState(0);
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(false);
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const clip = FIELD_TESTS[clipIdx];
  const plate = clip.plates[plateIdx] ?? clip.plates[0];
  const max = Math.max(1, ...clip.funnel.map((f) => f.value));
  const active = STAGES[stage];

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(rootRef.current);
    return () => io.disconnect();
  }, []);

  // the video only plays while the section is on screen
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (visible && !reduced) v.play().catch(() => {});
    else v.pause();
  }, [visible, clipIdx, reduced]);

  useEffect(() => {
    if (!playing || !visible || reduced) return undefined;
    const t = setTimeout(() => setStage((s) => (s + 1) % STAGES.length), STAGE_MS);
    return () => clearTimeout(t);
  }, [stage, playing, visible, reduced]);

  const pickClip = (i) => {
    setClipIdx(i);
    setPlateIdx(0);
    setStage(0);
  };
  const pickStage = (i) => {
    setStage(i);
    setPlaying(false);
  };

  return (
    <section ref={rootRef} className="premium-panel fade-up p-5 sm:p-6" aria-labelledby="tn-field-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.22em] text-emerald-600">
            <Clapperboard size={14} aria-hidden="true" />
            Field test · recorded street footage
          </p>
          <h2 id="tn-field-title" className="mt-1.5 text-xl font-black tracking-tight text-gray-900 sm:text-2xl">
            The pipeline on real Indian traffic
          </h2>
          <p className="mt-1 max-w-2xl text-[12.5px] font-medium text-gray-500">
            Four recorded clips of Indian traffic, each run end to end: the video is the pipeline's own annotated output,
            the numbers are that run's.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="tn-press flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-[11px] font-bold text-gray-600 hover:text-emerald-600"
          aria-label={playing ? "Pause the walkthrough" : "Play the walkthrough"}
        >
          {playing ? <Pause size={12} /> : <Play size={12} />}
          {playing ? "Auto-playing" : "Paused"}
        </button>
      </div>

      {/* clip picker */}
      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4" role="tablist" aria-label="Test clip">
        {FIELD_TESTS.map((c, i) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={i === clipIdx}
            onClick={() => pickClip(i)}
            className={`tn-field-clip ${i === clipIdx ? "is-active" : ""}`}
          >
            <img src={c.poster} alt="" loading="lazy" />
            <span className="relative z-[1] flex flex-col items-start text-left">
              <span className="text-[12.5px] font-black text-white">{c.title}</span>
              <span className="text-[10.5px] font-bold text-white/75">
                {c.source.seconds} s clip
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        {/* annotated output video */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="tn-field-video">
            <video
              key={clip.id}
              ref={videoRef}
              src={clip.video}
              poster={clip.poster}
              muted
              loop
              playsInline
              preload="metadata"
              aria-label={`${clip.title}: annotated pipeline output`}
            />
            <span className="tn-field-video-chip">
              <span className="tn-pulse tn-pulse--green h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
              YOLO11 detector + ByteTrack
            </span>
            <span className="tn-field-video-chip tn-field-video-chip--right">
              {clip.source.width}×{clip.source.height} · {Math.round(clip.source.fps)} fps
            </span>
          </div>
          <p className="text-[12.5px] font-medium leading-relaxed text-gray-500">{clip.scene}</p>

          {/* vehicle mix from the detector's Indian classes */}
          <div>
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-gray-500">Vehicles tracked, by class</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {clip.mix.slice(0, 8).map((m) => (
                <li key={m.label} className="rounded-full border border-gray-200 bg-white/60 px-2.5 py-1 text-[11px] font-bold text-gray-700">
                  {m.label} <span className="font-mono text-gray-400">{fmt(m.count)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* stages + this clip's funnel */}
        <div className="flex min-w-0 flex-col gap-3">
          <ol className="grid grid-cols-5 gap-1.5" aria-label="Pipeline stages">
            {STAGES.map((s, i) => {
              const Icon = s.icon;
              return (
                <li key={s.title}>
                  <button
                    type="button"
                    onClick={() => pickStage(i)}
                    aria-current={i === stage ? "step" : undefined}
                    aria-label={`Stage ${i + 1}: ${s.title}`}
                    className={`tn-field-stage ${i === stage ? "is-active" : i < stage ? "is-done" : ""}`}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span className="font-mono text-[10px] font-black">{i + 1}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div key={`${clip.id}-${stage}`} className="tn-field-stage-note tn-new-item">
            <p className="text-[13px] font-black text-gray-900">
              {stage + 1}. {active.title}
            </p>
            <p className="mt-0.5 text-[12px] font-medium leading-snug text-gray-500">{active.body}</p>
          </div>

          <ol className="flex flex-col gap-1.5">
            {clip.funnel.map((f, i) => {
              const lit = active.rows.includes(f.label);
              return (
                <li key={f.label} className={`tn-funnel-row tn-field-row ${lit ? "is-lit" : ""}`}>
                  <div className="flex items-baseline justify-between gap-3 text-[12px]">
                    <span className="font-bold text-gray-700">
                      {f.label} <span className="font-medium text-gray-400">· {f.hint}</span>
                    </span>
                    <span className="font-mono font-black tabular-nums text-gray-900">
                      <AnimatedNumber key={clip.id} value={f.value} />
                    </span>
                  </div>
                  <div className="tn-funnel-track">
                    <span className="tn-funnel-bar" style={{ transform: `scaleX(${width(f.value, max)})`, transitionDelay: `${i * 50}ms` }} />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {/* plates read */}
      <div className="mt-5">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-gray-500">Plates read in this clip</p>
        {clip.plates.length ? (
          <div className="tn-field-results mt-2" style={{ "--n": clip.plates.length }}>
            <ul className="contents">
              {clip.plates.map((p, i) => (
                <PlateCard key={p.text} plate={p} selected={p === plate} onSelect={() => setPlateIdx(i)} />
              ))}
            </ul>
            <PlateAnatomy plate={plate} />
          </div>
        ) : (
          <p className="mt-2 rounded-xl border border-dashed border-gray-200 px-3 py-4 text-[12px] font-medium text-gray-500">
            A traffic-counting view: from this height every vehicle is detected, classified and tracked, and plate reading
            is left to the junction cameras closer to the road.
          </p>
        )}
      </div>
    </section>
  );
}
