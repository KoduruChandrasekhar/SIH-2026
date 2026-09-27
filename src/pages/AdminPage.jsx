import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Cctv, Database, KeyRound, Play, RefreshCw, Search, ShieldCheck, Square, UserPlus, Users, Workflow } from "lucide-react";
import Navbar from "../components/layout/Navbar";
import {
  controlCamera,
  createAdminUser,
  fetchAdminEvents,
  fetchAdminUsers,
  fetchAnalyticsRuns,
  fetchDbHealth,
  fetchIngestionCameras,
  fetchPermissionMatrix,
  fetchPipelineStatus,
  fetchStreams,
  refreshAnalytics,
  updateAdminUser,
} from "../lib/api";
import { useSession } from "../hooks/useSession";

/**
 * Admin console (camera_admin) — completion plan 3.3.
 * Users & roles (operators = law_enforcement, admins = camera_admin), the live permission matrix,
 * camera ingestion control and the health of the live pipeline. Every control calls the real API;
 * the backend enforces the same roles (401/403), this page only hides what a role cannot use.
 */

const ROLE_LABEL = { camera_admin: "Admin", law_enforcement: "Operator", authenticated: "Any signed-in user", public: "Public" };
const ROLE_CHIP = {
  camera_admin: "bg-violet-100 text-violet-700",
  law_enforcement: "bg-blue-100 text-blue-700",
  authenticated: "bg-gray-100 text-gray-600",
  public: "bg-emerald-50 text-emerald-700",
};
const STATE_TONE = { ONLINE: "text-emerald-600", STARTING: "text-blue-600", RECONNECTING: "text-amber-600", DEGRADED: "text-amber-600", COMPLETED: "text-gray-500", ERROR: "text-red-600", OFFLINE: "text-gray-400", IDLE: "text-gray-400" };
const card = "rounded-[26px] border border-white/80 bg-white/80 p-5 shadow-[0_8px_32px_rgba(0,0,0,.04)] backdrop-blur-xl";
const input = "rounded-xl border border-gray-200/80 bg-gray-50/50 px-3 py-2 text-xs font-semibold text-gray-800 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500";
const fmt = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }) : "—");

function Tile({ icon: Icon, label, value, sub, tone = "text-gray-900" }) {
  return (
    <div className={`${card} flex flex-col gap-1`}>
      <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest text-gray-400">
        <Icon size={13} /> {label}
      </span>
      <span className={`text-lg font-black ${tone}`}>{value}</span>
      <span className="text-[11px] font-semibold text-gray-500">{sub}</span>
    </div>
  );
}

export default function AdminPage({ navigate }) {
  const session = useSession();
  const isAdmin = session?.role === "camera_admin";

  const [users, setUsers] = useState(null);
  const [perm, setPerm] = useState(null);
  const [events, setEvents] = useState([]);
  const [pipeline, setPipeline] = useState(null);
  const [streams, setStreams] = useState(null);
  const [db, setDb] = useState(null);
  const [runs, setRuns] = useState(null);
  const [cameras, setCameras] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState({ username: "", name: "", role: "law_enforcement", password: "" });

  const load = useCallback(async () => {
    const [u, p, e, pl, st, d, r, c] = await Promise.all([
      fetchAdminUsers(), fetchPermissionMatrix(), fetchAdminEvents(15), fetchPipelineStatus(),
      fetchStreams(), fetchDbHealth(), fetchAnalyticsRuns(), fetchIngestionCameras(),
    ]);
    setUsers(u?.users ?? null);
    setPerm(p);
    setEvents(e?.events ?? []);
    setPipeline(pl);
    setStreams(st);
    setDb(d);
    setRuns(r?.runs ?? null);
    setCameras(c);
  }, []);

  useEffect(() => {
    if (!isAdmin) return undefined;
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [isAdmin, load]);

  const act = async (key, fn, okText) => {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    setNotice(res.ok ? { tone: "ok", text: okText } : { tone: "error", text: res.data?.detail ? String(typeof res.data.detail === "string" ? res.data.detail : JSON.stringify(res.data.detail)) : `Request failed (${res.status || "offline"})` });
    load();
    return res.ok;
  };

  const addUser = async (e) => {
    e.preventDefault();
    const ok = await act("create", () => createAdminUser(form), `User ${form.username} created as ${ROLE_LABEL[form.role]}.`);
    if (ok) setForm({ username: "", name: "", role: "law_enforcement", password: "" });
  };

  const resetPassword = (u) => {
    const pw = window.prompt(`New password for ${u.username} (at least 8 characters)`);
    if (pw) act(`pw-${u.username}`, () => updateAdminUser(u.username, { password: pw }), `Password reset for ${u.username}.`);
  };

  const routes = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (perm?.routes ?? []).filter((r) => !q || r.path.toLowerCase().includes(q) || r.roles.some((x) => (ROLE_LABEL[x] ?? x).toLowerCase().includes(q)));
  }, [perm, filter]);

  if (!isAdmin) {
    return (
      <div className="relative flex w-full flex-col gap-5 pb-10">
        <Navbar page="admin" navigate={navigate} />
        <section className={`${card} mx-auto mt-10 flex max-w-lg flex-col items-center gap-3 text-center`}>
          <ShieldCheck size={30} className="text-violet-500" />
          <h1 className="text-lg font-black text-gray-900">Admin access required</h1>
          <p className="text-sm font-medium text-gray-500">
            {session ? `Signed in as ${session.username} (${ROLE_LABEL[session.role] ?? session.role}).` : "Not signed in."} The admin console needs a camera_admin account.
          </p>
          <button type="button" onClick={() => navigate("login")} className="tn-press rounded-xl bg-gray-900 px-4 py-2 text-xs font-bold text-white">
            Sign in as an admin
          </button>
        </section>
      </div>
    );
  }

  const q = pipeline?.queue_stats;
  const w = typeof pipeline?.worker_status === "object" ? pipeline.worker_status : null;
  const lastRun = runs?.[0];

  return (
    <div className="relative flex w-full flex-col gap-5 pb-10">
      <Navbar page="admin" navigate={navigate} />

      <header className="fade-up delay-100 flex flex-col gap-2 rounded-[28px] border border-white/80 bg-white/70 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.22em] text-violet-600">
            <ShieldCheck size={14} /> Administration · access & infrastructure
          </span>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-gray-900">Admin console</h1>
          <p className="mt-1 text-sm font-medium text-gray-500">Operators (law enforcement) query vehicles and receive alerts; admins run cameras, ingestion and user access.</p>
        </div>
        <span className="rounded-full bg-violet-100 px-3 py-1.5 text-[11px] font-bold text-violet-700">
          {session.name} · {session.username} · camera_admin
        </span>
      </header>

      {notice && (
        <p role="status" className={`rounded-2xl px-4 py-2.5 text-xs font-bold ${notice.tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
          {notice.text}
        </p>
      )}

      {/* Infrastructure health */}
      <section aria-label="Live pipeline health" className="fade-up delay-150 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          icon={Workflow}
          label="Fusion pipeline"
          value={pipeline ? `${pipeline.transport}${w ? ` · ${w.state}` : ""}` : "—"}
          sub={q ? `${pipeline.queue}: ${q.ready} queued · ${q.consumers} consumer(s) · ${q.dead_letters} dead-lettered` : pipeline?.reason ?? "API offline"}
          tone={pipeline?.transport === "broker" ? "text-emerald-600" : pipeline?.transport === "direct" ? "text-amber-600" : "text-red-600"}
        />
        <Tile icon={Cctv} label="Live streams" value={streams ? `${streams.live_count} / ${streams.streams.length}` : "—"} sub="MediaMTX RTSP → HLS restreams" tone={streams?.live_count ? "text-emerald-600" : "text-gray-400"} />
        <Tile
          icon={Database}
          label="PostGIS"
          value={db?.database ?? "—"}
          sub={db?.counts ? `${db.counts.observations} observations · ${db.counts.trajectories} trajectories · ${db.counts.audit_rows} audit rows` : "not reachable"}
          tone={db?.database === "ok" ? "text-emerald-600" : "text-red-600"}
        />
        <div className={`${card} flex flex-col gap-1`}>
          <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest text-gray-400">
            <Activity size={13} /> Polars analytics
          </span>
          <span className={`text-lg font-black ${lastRun?.status === "ok" ? "text-emerald-600" : "text-gray-900"}`}>{lastRun ? lastRun.status : "—"}</span>
          <span className="text-[11px] font-semibold text-gray-500">{lastRun ? `last run ${fmt(lastRun.finished_at ?? lastRun.started_at)}` : "no run yet"}</span>
          <button
            type="button"
            disabled={busy === "analytics"}
            onClick={() => act("analytics", refreshAnalytics, "Analytics recomputed.")}
            className="tn-press mt-1 flex w-fit items-center gap-1.5 rounded-lg bg-gray-900 px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-50"
          >
            <RefreshCw size={11} className={busy === "analytics" ? "animate-spin" : ""} /> Run now
          </button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        {/* Users & roles */}
        <section aria-labelledby="users-h" className={`${card} fade-up delay-200`}>
          <h2 id="users-h" className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-gray-800">
            <Users size={15} className="text-violet-500" /> Users & roles
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="py-2 pr-3">User</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Created</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(users ?? []).map((u) => (
                  <tr key={u.username}>
                    <td className="py-2 pr-3">
                      <span className="font-mono font-bold text-gray-900">{u.username}</span>
                      <span className="block text-[10px] text-gray-500">{u.name}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        aria-label={`Role of ${u.username}`}
                        value={u.role}
                        disabled={u.username === session.username || busy === `role-${u.username}`}
                        onChange={(e) => act(`role-${u.username}`, () => updateAdminUser(u.username, { role: e.target.value }), `${u.username} is now ${ROLE_LABEL[e.target.value]}.`)}
                        className={`${input} py-1`}
                      >
                        <option value="law_enforcement">Operator (law_enforcement)</option>
                        <option value="camera_admin">Admin (camera_admin)</option>
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        disabled={u.username === session.username}
                        onClick={() => act(`active-${u.username}`, () => updateAdminUser(u.username, { active: !u.active }), `${u.username} ${u.active ? "deactivated" : "re-activated"}.`)}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold disabled:cursor-not-allowed ${u.active ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-500"}`}
                        aria-label={`${u.active ? "Deactivate" : "Activate"} ${u.username}`}
                      >
                        {u.active ? "Active" : "Disabled"}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-[10px] text-gray-500">{u.created_by} · {fmt(u.created_at)}</td>
                    <td className="py-2 text-right">
                      <button type="button" onClick={() => resetPassword(u)} aria-label={`Reset password of ${u.username}`} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800">
                        <KeyRound size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users === null && <p className="py-3 text-xs font-semibold text-gray-500">User directory unavailable (PostgreSQL offline).</p>}
          </div>

          <form onSubmit={addUser} className="mt-4 grid grid-cols-2 gap-2 border-t border-gray-100 pt-4 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
            <input className={input} required placeholder="username" aria-label="New username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" />
            <input className={input} required placeholder="Full name" aria-label="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className={input} aria-label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="law_enforcement">Operator</option>
              <option value="camera_admin">Admin</option>
            </select>
            <input className={input} required minLength={8} type="password" placeholder="Password (8+)" aria-label="Initial password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
            <button type="submit" disabled={busy === "create"} className="tn-press col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50 md:col-span-1">
              <UserPlus size={14} /> Add
            </button>
          </form>
        </section>

        {/* Camera control */}
        <section aria-labelledby="cams-h" className={`${card} fade-up delay-200`}>
          <h2 id="cams-h" className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-gray-800">
            <Cctv size={15} className="text-violet-500" /> Camera ingestion
          </h2>
          <ul className="mt-3 divide-y divide-gray-100">
            {(cameras ?? []).map((c) => {
              const running = ["ONLINE", "STARTING", "RECONNECTING", "DEGRADED"].includes(c.state);
              return (
                <li key={c.camera_id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-xs font-bold text-gray-900">{c.camera_id}</span>
                    <span className="block truncate text-[10px] text-gray-500">{c.name} · {c.source_type.toUpperCase()}</span>
                  </div>
                  <span className={`text-[10px] font-black ${STATE_TONE[c.state] ?? "text-gray-500"}`}>
                    {c.state}
                    {c.reconnects ? ` · ${c.reconnects} reconnect${c.reconnects > 1 ? "s" : ""}` : ""}
                    {c.measured_fps ? ` · ${c.measured_fps} fps` : ""}
                  </span>
                  <button
                    type="button"
                    disabled={busy === c.camera_id}
                    onClick={() => act(c.camera_id, () => controlCamera(c.camera_id, running ? "stop" : "start"), `${c.camera_id} ${running ? "stopped" : "started"}.`)}
                    aria-label={`${running ? "Stop" : "Start"} ${c.camera_id}`}
                    className={`tn-press flex h-7 w-7 items-center justify-center rounded-lg ${running ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"} disabled:opacity-50`}
                  >
                    {running ? <Square size={12} /> : <Play size={12} />}
                  </button>
                </li>
              );
            })}
          </ul>
          {cameras === null && <p className="py-3 text-xs font-semibold text-gray-500">Ingestion API offline.</p>}

          <h3 className="mt-5 text-[10px] font-extrabold uppercase tracking-widest text-gray-400">Admin activity</h3>
          <ol className="mt-2 flex flex-col gap-1.5">
            {events.length === 0 && <li className="text-[11px] font-semibold text-gray-500">No administrative changes yet.</li>}
            {events.map((e) => (
              <li key={e.id} className="text-[11px] text-gray-600">
                <span className="font-mono text-[10px] text-gray-400">{fmt(e.at)}</span> · <b>{e.actor}</b> {e.action.replace("_", " ")} <b>{e.target}</b>
                {e.detail?.role ? ` → ${ROLE_LABEL[e.detail.role]}` : ""}
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* Permission matrix */}
      <section aria-labelledby="perm-h" className={`${card} fade-up delay-300`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="perm-h" className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-gray-800">
            <ShieldCheck size={15} className="text-violet-500" /> Permission matrix
            <span className="font-semibold normal-case tracking-normal text-gray-400">— read from the live API route guards</span>
          </h2>
          <label className="relative sm:w-64">
            <span className="sr-only">Filter routes</span>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className={`${input} w-full pl-8`} placeholder="Filter path or role…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        </div>
        {perm && (
          <p className="mt-2 text-[11px] font-semibold text-gray-500">
            {Object.entries(perm.summary).map(([role, n]) => `${ROLE_LABEL[role] ?? role}: ${n}`).join(" · ")} routes
          </p>
        )}
        <div className="mt-3 max-h-[360px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-gray-100">
              {routes.map((r) => (
                <tr key={`${r.method} ${r.path}`}>
                  <td className="w-16 py-1.5 font-mono text-[10px] font-bold text-gray-500">{r.method}</td>
                  <td className="py-1.5 font-mono text-[11px] text-gray-800">{r.path}</td>
                  <td className="py-1.5 text-right">
                    {r.roles.map((role) => (
                      <span key={role} className={`ml-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${ROLE_CHIP[role] ?? "bg-gray-100 text-gray-600"}`}>
                        {ROLE_LABEL[role] ?? role}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
