import { useState } from "react";
import { BarChart3, BellRing, Car, CheckCheck, Crop, Database, GitMerge, ScanText, Video } from "lucide-react";

// The backend, stage by stage (backend/ingestion → anpr → fusion → db → analytics → alerts)
const STAGES = [
  {
    id: "ingest",
    icon: Video,
    title: "Ingestion",
    metric: "12 cameras",
    tech: "RTSP via MediaMTX or MP4 files",
    detail: "One worker per camera pulls frames from its RTSP restream (MediaMTX) or recorded MP4 and samples them for the detectors. Live streams are also restreamed as HLS for the browser.",
    code: "backend/ingestion",
  },
  {
    id: "detect",
    icon: Car,
    title: "Detect & track",
    metric: "78.5% recall",
    tech: "YOLOv11-S (IISc UVH-26) + ByteTrack",
    detail: "A regional detector trained on 14 Indian vehicle classes finds vehicles; ByteTrack keeps one identity per vehicle across frames. Two-wheeler recall rose from 8.8% to 74.4% over the COCO model.",
    code: "backend/ai/vehicle_tracker.py",
  },
  {
    id: "plate",
    icon: Crop,
    title: "Plate & quality gate",
    metric: "q-score gate",
    tech: "Plate localiser + crop scoring",
    detail: "Each tracked vehicle is searched for plate-shaped regions. Crops are scored for size, sharpness, skew and exposure; only the best crops per track go on to OCR.",
    code: "backend/ai/plate_detector.py",
  },
  {
    id: "ocr",
    icon: ScanText,
    title: "OCR",
    metric: "~60 ms / crop",
    tech: "PaddleOCR 3 · PP-OCRv5 hybrid",
    detail: "Recognition-first: the crop is read as one text line, and the full detect+recognise pass only runs when that read is unsure. Runtime tries TensorRT FP16, then GPU, then CPU.",
    code: "backend/ai/ocr_engine.py",
  },
  {
    id: "consensus",
    icon: CheckCheck,
    title: "Consensus & validate",
    metric: "multi-frame vote",
    tech: "Normalise · vote · Indian format",
    detail: "Reads from several frames of the same track are normalised and voted on, then checked against the Indian registration format (state · RTO · series · number).",
    code: "backend/anpr/recognizer.py",
  },
  {
    id: "fusion",
    icon: GitMerge,
    title: "Fusion & Re-ID",
    metric: "cross-camera",
    tech: "RabbitMQ q.fusion · Redis window",
    detail: "Sightings from every camera are fused into one journey per vehicle, checking that time and road distance between cameras are physically possible — impossible hops raise cloned-plate alerts.",
    code: "backend/fusion",
  },
  {
    id: "store",
    icon: Database,
    title: "Trajectory store",
    metric: "PostGIS",
    tech: "PostgreSQL 16 + PostGIS 3.4",
    detail: "Journeys, waypoints and an audit log are stored spatially, so the API can answer fuzzy plate search, trajectory and map queries — every lookup is audited against the officer who made it.",
    code: "backend/db · backend/api/spatial.py",
  },
  {
    id: "analytics",
    icon: BarChart3,
    title: "Traffic analytics",
    metric: "every 45 s",
    tech: "Polars jobs",
    detail: "A background scheduler rolls sightings up into corridor speed, density and the origin–destination matrix that drive the Dashboard and Traffic pages.",
    code: "backend/analytics",
  },
  {
    id: "alerts",
    icon: BellRing,
    title: "Live alerts",
    metric: "WebSocket",
    tech: "JWT-secured alert bus",
    detail: "Cloned plates, blacklist hits and invalid-format reads are pushed to every connected officer in real time — the toasts and the Alerts page.",
    code: "backend/alerts · /ws/alerts",
  },
];

export default function PipelineFlow({ live }) {
  const [selected, setSelected] = useState("ocr");
  const stage = STAGES.find((s) => s.id === selected);
  const Icon = stage.icon;

  return (
    <section className="premium-panel fade-up p-5 sm:p-6" aria-labelledby="tn-flow-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-blue-600">End-to-end pipeline</p>
          <h2 id="tn-flow-title" className="mt-1.5 text-xl font-black tracking-tight text-gray-900 sm:text-2xl">
            From camera frame to live alert
          </h2>
        </div>
        <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${live ? "border-emerald-500/30 text-emerald-600" : "border-gray-200 text-gray-500"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-amber-400"}`} aria-hidden="true" />
          {live ? "Backend connected" : "Demo mode · measured results from the repo"}
        </span>
      </div>

      <div className="tn-flow-track" role="tablist" aria-label="Pipeline stages">
        <span className="tn-flow-line" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="tn-flow-packet" style={{ animationDelay: `${i * -1.6}s` }} />
          ))}
        </span>
        {STAGES.map((s, i) => {
          const StageIcon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === selected}
              onClick={() => setSelected(s.id)}
              className={`tn-flow-stage ${s.id === selected ? "is-active" : ""}`}
              style={{ "--i": i }}
            >
              <span className="tn-flow-node">
                <StageIcon size={18} aria-hidden="true" />
              </span>
              <span className="tn-flow-name">{s.title}</span>
              <span className="tn-flow-metric">{s.metric}</span>
            </button>
          );
        })}
      </div>

      <div key={stage.id} className="tn-flow-detail" role="tabpanel">
        <span className="tn-flow-detail-icon">
          <Icon size={20} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold text-gray-900">
            {stage.title}
            <span className="ml-2 text-[12px] font-bold text-blue-600">{stage.tech}</span>
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-600">{stage.detail}</p>
          <p className="mt-1.5 font-mono text-[11px] font-semibold text-gray-400">{stage.code}</p>
        </div>
      </div>
    </section>
  );
}
