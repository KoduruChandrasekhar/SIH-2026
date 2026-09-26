import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Pause, Play, ScanLine } from "lucide-react";
import { OCR_READ as R } from "../../data/pipeline";
import { useDecodeText } from "../fx/textFx";

const STEPS = [
  {
    title: "Detect & track",
    body: `YOLO finds the vehicle and ByteTrack follows it across frames — track #${R.trackId}, seen in ${R.trackHits} frames.`,
  },
  {
    title: "Find the plate · score quality",
    body: `The plate localiser proposed ${R.candidatesFound} candidates; each crop is scored for size, sharpness, skew and exposure before OCR.`,
  },
  {
    title: `Enhance (${R.preprocessing})`,
    body: `The ${R.reads[0].size[0]} × ${R.reads[0].size[1]} px crop gets local contrast enhancement so the characters separate from the plate.`,
  },
  {
    title: "Recognise · hybrid OCR",
    body: "PP-OCRv5 recognition reads the text line first; the full detect+recognise pass runs only when a read is unsure. Stray symbols are normalised.",
  },
  {
    title: "Consensus & validate",
    body: `${R.reads.length} of ${R.reads.length} frames agree, and the text matches the Indian registration format — state, RTO, series, number.`,
  },
];

const STEP_MS = 3400;
const [SW, SH] = R.source;
const pct = (v, total) => `${((v / total) * 100).toFixed(2)}%`;
// zoom that centres the plate in the viewport
const PLATE_CX = (R.plateBox[0] + R.plateBox[2]) / 2 / SW;
const PLATE_CY = (R.plateBox[1] + R.plateBox[3]) / 2 / SH;
const ZOOM = 5.5;
const ZOOM_TRANSFORM = `translate(${((0.5 - PLATE_CX) * 100).toFixed(2)}%, ${((0.5 - PLATE_CY) * 100).toFixed(2)}%) scale(${ZOOM})`;

function Meter({ label, value, display }) {
  return (
    <div className="tn-ocr-meter">
      <div className="flex justify-between text-[10px] font-bold">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono text-emerald-300">{display}</span>
      </div>
      <div className="tn-ocr-meter-track">
        <span style={{ transform: `scaleX(${Math.max(0.04, Math.min(1, value))})` }} />
      </div>
    </div>
  );
}

function ReadRow({ read, active, delay }) {
  const ref = useDecodeText(active ? read.raw : " ", { duration: 900, delay });
  return (
    <div className="tn-ocr-read">
      <img src={read.crop} alt="" className="tn-ocr-read-crop" />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[15px] font-black tracking-[0.12em] text-white" aria-label={read.raw}>
          <span ref={ref} aria-hidden="true">{read.raw}</span>
        </p>
        <div className="tn-ocr-conf">
          <span style={{ transform: `scaleX(${active ? read.conf / 100 : 0})`, transitionDelay: `${delay}ms` }} />
        </div>
      </div>
      <span className="font-mono text-[11px] font-bold text-emerald-300">{read.conf.toFixed(1)}%</span>
    </div>
  );
}

export default function OcrLab() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(false);
  const rootRef = useRef(null);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const finalRef = useDecodeText(step === 4 ? R.plate : " ", { duration: 700, delay: 200 });

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 });
    io.observe(rootRef.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !visible || reduced) return undefined;
    const t = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), step === STEPS.length - 1 ? STEP_MS * 1.6 : STEP_MS);
    return () => clearTimeout(t);
  }, [step, playing, visible, reduced]);

  const pick = (i) => {
    setStep(i);
    setPlaying(false);
  };

  const zoomed = step >= 1;

  return (
    <section ref={rootRef} className="premium-panel fade-up p-5 sm:p-6" aria-labelledby="tn-ocr-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.22em] text-blue-600">
            <ScanLine size={14} aria-hidden="true" />
            OCR lab · a real read from the pipeline
          </p>
          <h2 id="tn-ocr-title" className="mt-1.5 text-xl font-black tracking-tight text-gray-900 sm:text-2xl">
            How one number plate gets read
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-gray-500">
          <span className="rounded-full border border-gray-200 px-2.5 py-1 font-mono">{R.camera} · {R.cameraName}</span>
          <span className="rounded-full border border-gray-200 px-2.5 py-1">Track #{R.trackId} · {R.vehicleClass}</span>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="tn-press flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-gray-600 hover:text-blue-600"
            aria-label={playing ? "Pause the walkthrough" : "Play the walkthrough"}
          >
            {playing ? <Pause size={12} /> : <Play size={12} />}
            {playing ? "Auto-playing" : "Paused"}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* ── stage ── */}
        <div className="tn-ocr-stage" data-step={step}>
          <div className="tn-ocr-frame" style={{ transform: zoomed ? ZOOM_TRANSFORM : "none", transformOrigin: `${(PLATE_CX * 100).toFixed(2)}% ${(PLATE_CY * 100).toFixed(2)}%` }}>
            <img src={R.frame} alt={`${R.camera} frame with the tracked ${R.vehicleClass.toLowerCase()}`} />
            <svg viewBox={`0 0 ${SW} ${SH}`} preserveAspectRatio="none" aria-hidden="true">
              <rect
                className="tn-ocr-vbox"
                x={R.vehicleBox[0]}
                y={R.vehicleBox[1]}
                width={R.vehicleBox[2] - R.vehicleBox[0]}
                height={R.vehicleBox[3] - R.vehicleBox[1]}
                pathLength="1"
              />
              <rect
                className="tn-ocr-pbox"
                x={R.plateBox[0] - 4}
                y={R.plateBox[1] - 4}
                width={R.plateBox[2] - R.plateBox[0] + 8}
                height={R.plateBox[3] - R.plateBox[1] + 8}
                pathLength="1"
              />
            </svg>
            <span className="tn-ocr-vlabel" style={{ left: pct(R.vehicleBox[0], SW), top: pct(R.vehicleBox[1], SH) }}>
              {R.vehicleClass} · #{R.trackId}
            </span>
          </div>

          {/* step 2: quality gate */}
          <div className="tn-ocr-layer tn-ocr-layer--quality">
            <p className="tn-ocr-layer-title">Quality gate · q = {R.reads[0].q.toFixed(2)} ✓</p>
            <Meter label="Sharpness" value={R.reads[0].sharpness} display={R.reads[0].sharpness.toFixed(2)} />
            <Meter label="Skew" value={1 - R.reads[0].skew / 20} display={`${R.reads[0].skew}°`} />
            <Meter label="Exposure" value={R.reads[0].exposure} display={R.reads[0].exposure.toFixed(2)} />
            <Meter label="Size" value={R.reads[0].size[0] / 120} display={`${R.reads[0].size[0]}×${R.reads[0].size[1]} px`} />
          </div>

          {/* step 3: raw vs enhanced */}
          <div className="tn-ocr-layer tn-ocr-layer--enhance">
            <figure>
              <img src={R.reads[0].crop} alt="Raw plate crop" className="tn-ocr-pixel" />
              <figcaption>Raw crop · {R.reads[0].size[0]}×{R.reads[0].size[1]} px</figcaption>
            </figure>
            <span className="tn-ocr-arrow" aria-hidden="true">→</span>
            <figure>
              <img src={R.reads[0].prep} alt={`${R.preprocessing} enhanced plate crop`} />
              <figcaption>{R.preprocessing} enhanced</figcaption>
            </figure>
          </div>

          {/* step 4: three reads */}
          <div className="tn-ocr-layer tn-ocr-layer--reads">
            <p className="tn-ocr-layer-title">Per-frame OCR reads</p>
            {R.reads.map((r, i) => (
              <ReadRow key={r.frame} read={r} active={step === 3} delay={i * 280} />
            ))}
            <p className="text-[10.5px] font-semibold text-slate-400">
              <span className="font-mono text-rose-300">AP.09…</span> → the stray “.” is normalised before voting
            </p>
          </div>

          {/* step 5: consensus + format */}
          <div className="tn-ocr-layer tn-ocr-layer--final">
            <div className="tn-ocr-plate" aria-label={`Final read ${R.plate}`}>
              <span className="tn-ocr-plate-ind">IND</span>
              <span ref={finalRef} className="tn-ocr-plate-text" aria-hidden="true">{R.plate}</span>
            </div>
            <div className="tn-ocr-segments">
              {R.segments.map((s) => (
                <div key={s.label}>
                  <b>{s.text}</b>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
            <ul className="tn-ocr-checks">
              <li><CheckCircle2 size={13} /> {R.reads.length}/{R.reads.length} frames agree</li>
              <li><CheckCircle2 size={13} /> Format {R.plateFormat}</li>
              <li><CheckCircle2 size={13} /> {R.validation} · {R.confidence}%</li>
            </ul>
          </div>
        </div>

        {/* ── steps ── */}
        <ol className="flex flex-col gap-1.5">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <button type="button" onClick={() => pick(i)} className={`tn-ocr-step ${i === step ? "is-active" : i < step ? "is-done" : ""}`} aria-current={i === step ? "step" : undefined}>
                <span className="tn-ocr-step-num">{i + 1}</span>
                <span className="min-w-0 text-left">
                  <span className="block text-[13px] font-extrabold text-gray-900">{s.title}</span>
                  <span className="tn-ocr-step-body block text-[12px] leading-relaxed text-gray-500">{s.body}</span>
                </span>
                {i === step && playing && !reduced && <span key={step} className="tn-ocr-step-progress" style={{ animationDuration: `${i === STEPS.length - 1 ? STEP_MS * 1.6 : STEP_MS}ms`, animationPlayState: visible ? "running" : "paused" }} />}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
