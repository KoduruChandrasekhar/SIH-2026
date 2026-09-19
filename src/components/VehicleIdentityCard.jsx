import { Activity, MapPin, Zap } from "lucide-react";
import { formatConfidence } from "../demoData";

export default function VehicleIdentityCard({ vehicle, currentObservation, isTracking }) {
  if (!vehicle) return null;
  return <section className={`glass-card-static p-5 ${isTracking ? "border-blue-500/45 shadow-[0_0_26px_rgba(59,130,246,.12)]" : ""}`}>
    <div className="mb-4 flex items-center justify-between"><span className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-[var(--text-muted)]"><Zap size={13} className="text-blue-400" /> Global vehicle</span><span className="badge badge-blue"><span className={isTracking ? "live-dot-blue" : "h-1.5 w-1.5 rounded-full bg-blue-400"} />{isTracking ? "Tracking active" : "Idle"}</span></div>
    <h2 className="font-mono text-2xl font-black tracking-tight text-blue-400">{vehicle.globalId}</h2>
    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--border-subtle)] pt-4"><Field label="Plate number" value={vehicle.plate} mono /><Field label="Type / colour" value={`${vehicle.vehicleType} · ${vehicle.vehicleColor}`} /></div>
    <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-[var(--text-muted)]"><Activity size={12} className="text-cyan-400" /> Current observation</div>
      {currentObservation ? <div className="space-y-3"><div className="flex justify-between gap-3"><div><Field label="Camera" value={currentObservation.camera} blue mono /><p className="mt-1 text-[10px] text-[var(--text-secondary)]">{currentObservation.name}</p></div><Field label="Timestamp" value={currentObservation.time} mono right /></div><div className="grid grid-cols-3 gap-2 border-t border-[var(--border-subtle)] pt-3"><Field label="Speed" value={currentObservation.speedLabel} /><Field label="Direction" value={currentObservation.direction} /><Field label="Match" value={formatConfidence(currentObservation.confidence)} emerald /></div></div> : <div className="flex items-center justify-center gap-2 py-4 text-[11px] font-semibold text-[var(--text-muted)]"><MapPin size={13} /> Awaiting observation data</div>}
    </div>
  </section>;
}

function Field({ label, value, mono, blue, emerald, right }) { return <div className={right ? "text-right" : ""}><span className="text-[9px] font-extrabold uppercase tracking-wider text-[var(--text-muted)]">{label}</span><p className={`mt-1 text-[11px] font-bold text-[var(--text-primary)] ${mono ? "font-mono" : ""} ${blue ? "text-blue-400" : ""} ${emerald ? "text-emerald-400" : ""}`}>{value}</p></div>; }
