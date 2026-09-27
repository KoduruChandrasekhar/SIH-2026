import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Cctv, ScanLine, Search, Signal, VideoOff, Wifi, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Navbar from "../components/layout/Navbar";
import CameraFeedCard from "../components/camera/CameraFeedCard";
import { ChartTooltip, hourTicks, useChartTheme } from "../components/charts/ChartKit";
import { anprToOcrEvidence, fetchCameraAnpr, fetchCameras, fetchIngestionCameras, vehicleClassLabel } from "../lib/api";
import OCRPanel from "../components/anpr/OCRPanel";
import { OCR_ACCURACY_TARGET, SNAPSHOT_TIME, cameraById, cameraRegistry, hourlyTraffic } from "../data/data";
import { AnimatedNumber } from "../components/motion/Motion";
import { formatClock, useLiveSim } from "../sim/liveSim";

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "online", label: "Live" },
  { key: "degraded", label: "Degraded" },
  { key: "offline", label: "Offline" },
];

const STATUS_COLOR = { online: "#3b82f6", degraded: "#f59e0b", offline: "#ef4444" };

// Deterministic pseudo-random generator so a camera always shows the same recent reads
function seeded(seed) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const PLATE_SERIES = ["TS07", "TS08", "TS09", "TS10", "TS15", "TS28", "AP28", "AP09", "KA05"];
const CLASSES = ["Car", "Car", "Car", "Two-wheeler", "Two-wheeler", "Auto", "Bus", "LCV"];
const toSec = (hms) => hms.split(":").reduce((acc, v) => acc * 60 + Number(v), 0);
const toHms = (s) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((v) => String(v).padStart(2, "0")).join(":");

function recentReads(camera) {
  const rand = seeded(parseInt(camera.id.replace(/\D/g, ""), 10));
  // average gap between reads follows the camera's hourly volume (offline: the rate before it dropped)
  const gap = 3600 / Math.max(camera.lastHour || 900, 1);
  let t = toSec(camera.lastSeen);
  const base = camera.ocrRate ?? 93;
  return Array.from({ length: 6 }, (_, i) => {
    const series = PLATE_SERIES[Math.floor(rand() * PLATE_SERIES.length)];
    const letters = String.fromCharCode(65 + Math.floor(rand() * 26), 65 + Math.floor(rand() * 26));
    const plate = i === 0 ? camera.lastPlate : `${series}${letters}${String(1000 + Math.floor(rand() * 9000))}`;
    const conf = Math.min(99.4, Math.max(82, base + (rand() - 0.5) * 9)).toFixed(1);
    const row = { time: toHms(Math.round(t)), plate, conf: Number(conf), cls: CLASSES[Math.floor(rand() * CLASSES.length)] };
    t -= gap * (0.5 + rand());
    return row;
  });
}

// Camera's hourly reads: the cluster's daily profile, scaled so the bars add up to `today`.
// Hours after the snapshot (or after an offline camera's last frame) are zero; the cut-off hour is partial.
function hourlyReads(camera) {
  const endSec = toSec(camera.status === "offline" ? camera.lastSeen : `${SNAPSHOT_TIME}:00`);
  const coverage = hourlyTraffic.map((_, i) => Math.min(1, Math.max(0, (endSec - i * 3600) / 3600)));
  const weighted = hourlyTraffic.reduce((s, h, i) => s + h.flow * coverage[i], 0);
  return hourlyTraffic.map((h, i) => ({
    hour: h.hour,
    reads: Math.round((h.flow * coverage[i] * camera.today) / weighted),
  }));
}

export default function CamerasPage({ navigate, openModal, params }) {
  const chart = useChartTheme();
  const [cameraList, setCameraList] = useState(cameraRegistry);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [zone, setZone] = useState("all");
  // Opening from the Dashboard ("Open CAM-xxx feed") shows that camera straight away
  const [selected, setSelected] = useState(() => (params?.camera ? cameraById[params.camera] ?? null : null));
  const sim = useLiveSim();
  // camera_id (CAM-401) → live ingestion row from the Phase 1 backend, or null when offline
  const [ingestion, setIngestion] = useState(null);

  // Backend cameras (if running) only update matching registry entries' live fields
  useEffect(() => {
    fetchCameras().then((data) => {
      if (!data?.cameras) return;
      setCameraList((prev) =>
        prev.map((c) => {
          const live = data.cameras.find((a) => a.id === c.id);
          return live ? { ...c, fps: live.fps ?? c.fps, lastPlate: live.lastPlateRead ?? c.lastPlate } : c;
        })
      );
    });
  }, []);

  // Phase 1: when the ingestion backend is running, show its REAL camera state
  // (state, source type, decoded frames) instead of the local demo status.
  useEffect(() => {
    let alive = true;
    const poll = () =>
      fetchIngestionCameras().then((rows) => {
        if (!alive) return;
        setIngestion(rows ? Object.fromEntries(rows.map((r) => [r.camera_id, r])) : null);
      });
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const zones = useMemo(() => [...new Set(cameraList.map((c) => c.zone))].sort(), [cameraList]);

  const counts = useMemo(() => {
    const by = (s) => cameraList.filter((c) => c.status === s).length;
    return {
      total: cameraList.length,
      online: by("online"),
      degraded: by("degraded"),
      offline: by("offline"),
      readsLastHour: cameraList.reduce((s, c) => s + (sim.cameras[c.id]?.status === "offline" ? 0 : sim.cameras[c.id]?.lastHour ?? c.lastHour ?? 0), 0),
      readsToday: cameraList.reduce((s, c) => s + (sim.cameras[c.id]?.today ?? c.today ?? 0), 0),
      belowTarget: cameraList.filter((c) => c.ocrRate != null && c.ocrRate < OCR_ACCURACY_TARGET).length,
    };
  }, [cameraList, sim.cameras]);

  // Ingestion state wins over the demo dataset whenever the Phase 1 backend is up
  const INGEST_STATE_TO_STATUS = { ONLINE: "online", STARTING: "online", DEGRADED: "degraded", RECONNECTING: "degraded", COMPLETED: "online", ERROR: "offline", OFFLINE: "offline", IDLE: null };
  const withIngestion = (c) => {
    const row = ingestion?.[c.code];
    if (!row) return c;
    const mapped = INGEST_STATE_TO_STATUS[row.state];
    return {
      ...c,
      status: mapped ?? c.status,
      fps: row.measured_fps ? Math.round(row.measured_fps) : c.fps,
      ingestion: row,
    };
  };

  const filtered = cameraList.map(withIngestion).filter((c) => {
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || [c.code, c.id, c.name, c.zone, c.lastPlate].some((v) => v?.toLowerCase().includes(q));
    return matchesQuery && (statusFilter === "all" || c.status === statusFilter) && (zone === "all" || c.zone === zone);
  });

  const activity = [...cameraList]
    .map((c) => ({ code: c.code, reads: c.status === "offline" ? 0 : sim.cameras[c.id]?.lastHour ?? c.lastHour, status: c.status, name: c.name }))
    .sort((a, b) => b.reads - a.reads);

  return (
    <div className="relative flex w-full flex-col gap-5 pb-10">
      <div className="w-full">
        <Navbar page="cameras" navigate={navigate} openModal={openModal} />
      </div>

      {/* Header with the CCTV clip as an ambient backdrop */}
      <header className="tn-cam-banner fade-up delay-100 p-6 sm:p-8">
        <video src="/hero/cctv-cameras.mp4" poster="/hero/cctv-cameras-poster.jpg" autoPlay muted loop playsInline preload="metadata" aria-hidden="true" />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2.5">
              <Cctv size={16} className="text-blue-400" />
              <span className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-blue-300">Cameras · Live camera network</span>
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">Hyderabad ANPR network</h1>
            <p className="mt-2 text-sm font-medium text-slate-300">
              Monitor connected ANPR/CCTV feeds across the city network — {counts.total} of 254 network nodes, from Miyapur to Dilsukhnagar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-blue-400/30 bg-blue-500/10 px-3 py-1.5 text-[11px] font-bold text-blue-200">
              OCR accuracy target &gt;{OCR_ACCURACY_TARGET}%
            </span>
            {ingestion && (
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-200" data-tip="Live camera ingestion (Phase 1 backend)" data-tip-pos="bottom">
                <span className="tn-pulse tn-pulse--green h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                Ingestion {Object.values(ingestion).filter((r) => r.state === "ONLINE").length}/{Object.keys(ingestion).length} live
              </span>
            )}
            <span className="flex items-center gap-1.5 rounded-full border border-slate-500/40 bg-slate-900/60 px-3 py-1.5 font-mono text-[11px] font-bold text-slate-300">
              <span className="tn-pulse tn-pulse--green h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
              {formatClock(sim.simSec)} IST · demo data
            </span>
          </div>
        </div>
      </header>

      {/* Metrics */}
      <section aria-label="Camera network metrics" className="fade-up delay-150 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Metric icon={Cctv} label="Total cameras" value={counts.total} sub="in this cluster" />
        <Metric icon={Wifi} label="Online" value={counts.online} sub={`${counts.degraded} degraded`} tone="text-emerald-600" />
        <Metric icon={VideoOff} label="Offline" value={counts.offline} sub="field team assigned" tone="text-red-600" />
        <Metric icon={ScanLine} label="Active ANPR" value={counts.online + counts.degraded} sub={`${counts.belowTarget} below OCR target`} tone="text-blue-600" />
        <Metric icon={Activity} label="Plate reads (last hour)" value={<AnimatedNumber value={counts.readsLastHour} />} sub={<><AnimatedNumber value={counts.readsToday} /> today</>} />
      </section>

      {/* Controls */}
      <div className="fade-up delay-200 flex flex-col gap-3 rounded-[20px] border border-white/80 bg-white/80 p-3 shadow-sm backdrop-blur-xl md:flex-row md:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search cameras</span>
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search camera ID, location or last plate…"
            className="w-full rounded-xl border border-gray-200/80 bg-gray-50/50 py-2.5 pl-10 pr-4 text-xs font-semibold text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                aria-pressed={statusFilter === f.key}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${statusFilter === f.key ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-gray-500">
            Zone
            <select
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-bold text-gray-800 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All zones</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Camera grid */}
      <section aria-label="Camera feeds">
        <p className="mb-3 px-1 text-[11px] font-bold text-gray-500">
          Showing {filtered.length} of {cameraList.length} cameras · hover a tile to preview, click for details
        </p>
        {filtered.length === 0 ? (
          <div className="tn-empty">
            <p className="tn-empty-title">No matching cameras</p>
            <p className="tn-empty-sub">{query ? <>No camera matches “{query}”{statusFilter !== "all" || zone !== "all" ? " with the current filters" : ""}.</> : "No cameras match the current filters."}</p>
          </div>
        ) : (
          <div key={statusFilter + zone} className="tn-list-in grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((cam, i) => (
              <CameraFeedCard key={cam.id} camera={cam} live={sim.cameras[cam.id]} simSec={sim.simSec} index={i} onSelect={setSelected} selected={selected?.id === cam.id} />
            ))}
          </div>
        )}
      </section>

      {/* ANPR activity by camera */}
      <section className="premium-panel p-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-black text-gray-900">ANPR activity by camera</h2>
            <p className="text-[11px] font-bold text-gray-500">Plate reads in the last hour (to {SNAPSHOT_TIME})</p>
          </div>
          <div className="tn-chart-legend">
            <span><i style={{ background: STATUS_COLOR.online }} />Live</span>
            <span><i style={{ background: STATUS_COLOR.degraded }} />Degraded</span>
            <span><i style={{ background: STATUS_COLOR.offline }} />Offline (0)</span>
          </div>
        </div>
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={activity} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
              <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="code" tick={chart.tick} axisLine={false} tickLine={false} interval={0} angle={-35} textAnchor="end" height={48} />
              <YAxis tick={chart.tick} axisLine={false} tickLine={false} width={44} label={{ value: "reads / h", angle: -90, position: "insideLeft", dx: -2, style: chart.axisLabel }} />
              <Tooltip cursor={{ fill: chart.cursor }} content={<ChartTooltip units={{ reads: "reads/h" }} />} />
              <Bar dataKey="reads" name="Plate reads" radius={[4, 4, 0, 0]} maxBarSize={34}>
                {activity.map((a) => (
                  <Cell key={a.code} fill={STATUS_COLOR[a.status]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {selected && <CameraDetail camera={selected} live={sim.cameras[selected.id]} simSec={sim.simSec} onClose={() => setSelected(null)} navigate={navigate} />}
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub, tone = "text-gray-900" }) {
  return (
    <div className="tn-kpi fade-up delay-100 rounded-[20px] border border-white/80 bg-white/80 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">{label}</span>
        <Icon size={15} className="text-gray-400" />
      </div>
      <p className={`tn-kpi-value mt-2 text-2xl font-black tabular-nums tracking-tight ${tone}`}>{value}</p>
      <p className="mt-0.5 text-[10px] font-bold text-gray-500">{sub}</p>
    </div>
  );
}

function CameraDetail({ camera, live, simSec, onClose, navigate }) {
  const chart = useChartTheme();
  const closeRef = useRef(null);
  const hourly = useMemo(() => hourlyReads(camera), [camera]);
  const offline = camera.status === "offline";

  // Phase 2: real ANPR observations for this camera when the backend has a run; null → demo reads
  const [anpr, setAnpr] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchCameraAnpr(camera.code).then((data) => alive && setAnpr(data));
    return () => {
      alive = false;
    };
  }, [camera.code]);
  const anprReads = useMemo(() => {
    // Same 6-row size as the demo table: validated plates first, then newest
    const rank = { DETECTED: 0, INVALID_FORMAT: 1, OCR_FAILED: 2 };
    const read = (anpr?.observations ?? []).filter((o) => o.frames_used > 0);
    return read.length
      ? read
          .slice()
          .sort((a, b) => rank[a.plate_status] - rank[b.plate_status] || b.timestamp.localeCompare(a.timestamp))
          .slice(0, 6)
          .map((o) => ({
            time: o.timestamp.slice(11, 19),
            plate: o.plate ?? `${o.consensus_text || "—"} · ${o.plate_status.replace("_", " ").toLowerCase()}`,
            cls: vehicleClassLabel(o.vehicle_class),
            conf: o.ocr_confidence != null ? o.ocr_confidence * 100 : null,
            obs: o,
          }))
      : null;
  }, [anpr]);
  const reads = useMemo(() => anprReads ?? recentReads(camera), [anprReads, camera]);
  const bestEvidence = useMemo(() => {
    const withReads = (anpr?.observations ?? []).filter((o) => o.frames_used > 0);
    const best =
      withReads.filter((o) => o.plate_status === "DETECTED").sort((a, b) => b.ocr_confidence - a.ocr_confidence)[0] ??
      withReads.sort((a, b) => (b.ocr_confidence ?? 0) - (a.ocr_confidence ?? 0))[0];
    return anprToOcrEvidence(best);
  }, [anpr]);
  const anprStats = anpr?.stats;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cam-detail-title"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-5xl rounded-[24px] border border-white/80 bg-white p-5 shadow-2xl sm:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-black tracking-wider text-blue-600">{camera.code}</p>
            <h2 id="cam-detail-title" className="text-xl font-black text-gray-900">
              {camera.name}
            </h2>
            <p className="text-xs font-bold text-gray-500">
              {camera.zone} · {camera.lat.toFixed(4)}°N, {camera.lng.toFixed(4)}°E
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close camera details" className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200">
            <X size={16} />
          </button>
        </div>

        {camera.note && (
          <p className={`mb-4 rounded-xl border px-3 py-2 text-xs font-bold ${offline ? "border-red-500/30 bg-red-50 text-red-600" : "border-amber-500/30 bg-amber-50 text-amber-700"}`}>{camera.note}</p>
        )}

        <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
          <CameraFeedCard camera={camera} live={live} simSec={simSec} alwaysPlay compact />

          <dl className="grid grid-cols-2 content-start gap-3">
            <Detail label="Status" value={<span className={`tn-status tn-status--${camera.status}`}>{camera.status}</span>} />
            <Detail label="Last seen" value={camera.lastSeen} mono />
            <Detail label="Resolution / FPS" value={`${camera.resolution} · ${camera.fps || 0} fps`} />
            <Detail label="Stream latency" value={camera.latencyMs ? `${camera.latencyMs} ms` : "—"} mono />
            {camera.ingestion && (
              <Detail
                label="Phase 1 ingestion"
                value={`${camera.ingestion.state} · ${camera.ingestion.source_type} · ${camera.ingestion.frames_processed} frames`}
                mono
                wide
              />
            )}
            {anprStats && (
              <Detail
                label="Phase 2 ANPR (last run)"
                value={`${anprStats.status_counts?.DETECTED ?? 0} plates read · ${anprStats.observations} transits · ${anprStats.crops_sent_to_ocr} crops OCR'd`}
                mono
                wide
              />
            )}
            <Detail label="Uptime (30 d)" value={`${camera.uptime}%`} mono />
            <Detail label="Reads today" value={<AnimatedNumber value={live?.today ?? camera.today} />} mono />
            <Detail
              label={`OCR read rate (target >${OCR_ACCURACY_TARGET}%)`}
              value={
                camera.ocrRate == null ? "—" : (
                  <span className={camera.ocrRate >= OCR_ACCURACY_TARGET ? "text-emerald-600" : "text-amber-600"}>
                    {camera.ocrRate.toFixed(1)}% {camera.ocrRate >= OCR_ACCURACY_TARGET ? "· meets target" : "· below target"}
                  </span>
                )
              }
              wide
            />
            <div className="col-span-2">
              <button
                type="button"
                onClick={() => navigate("tracking", { plate: camera.lastPlate })}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white hover:bg-blue-700"
              >
                <Signal size={14} /> Trace {camera.lastPlate} (last plate here)
              </button>
            </div>
          </dl>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <section>
            <h3 className="mb-2 text-xs font-black uppercase tracking-wider text-gray-500">
              Recent ANPR detections{anprReads ? " · Phase 2 pipeline" : ""}
            </h3>
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-400">
                  <tr>
                    <th className="px-3 py-2 font-extrabold">Time</th>
                    <th className="px-3 py-2 font-extrabold">Plate</th>
                    <th className="px-3 py-2 font-extrabold">Class</th>
                    <th className="px-3 py-2 text-right font-extrabold">OCR conf.</th>
                  </tr>
                </thead>
                <tbody>
                  {reads.map((r) => (
                    <tr key={r.obs?.observation_id ?? r.time + r.plate} className="border-t border-gray-100">
                      <td className="px-3 py-1.5 font-mono text-gray-500">{r.time}</td>
                      <td className="px-3 py-1.5 font-mono font-black text-gray-900">{r.plate}</td>
                      <td className="px-3 py-1.5 font-semibold text-gray-600">{r.cls}</td>
                      <td className={`px-3 py-1.5 text-right font-mono font-bold ${r.conf == null ? "text-gray-400" : r.conf >= OCR_ACCURACY_TARGET ? "text-emerald-600" : "text-amber-600"}`}>{r.conf == null ? "—" : `${r.conf.toFixed(1)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {offline && <p className="mt-2 text-[10px] font-bold text-gray-500">Reads shown are the last ones received before the link dropped.</p>}
            {bestEvidence && <OCRPanel ocrData={bestEvidence} isActive />}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-black uppercase tracking-wider text-gray-500">Plate reads per hour (today)</h3>
            <div className="h-[210px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="hour" tick={chart.tick} tickFormatter={hourTicks(4)} interval={0} axisLine={false} tickLine={false} />
                  <YAxis tick={chart.tick} axisLine={false} tickLine={false} width={40} />
                  <Tooltip cursor={{ fill: chart.cursor }} content={<ChartTooltip units={{ reads: "reads" }} />} />
                  <Bar dataKey="reads" name="Plate reads" fill={offline ? "#ef4444" : "#3b82f6"} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, mono, wide }) {
  return (
    <div className={`rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2 ${wide ? "col-span-2" : ""}`}>
      <dt className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className={`mt-0.5 text-xs font-black capitalize text-gray-900 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
