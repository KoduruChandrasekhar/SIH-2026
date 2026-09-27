import { AlertTriangle, Ban, Car, Construction, Gauge, RefreshCw, Siren, TrendingUp } from "lucide-react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip, useChartTheme } from "../charts/ChartKit";

const clock = (t) => new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const minutes = (sec) => (sec >= 60 ? `${Math.round(sec / 60)} min` : `${sec} s`);

/** Header chip: live source, last update and a manual refresh. */
export function LiveStatusChip({ live }) {
  const refreshing = live.status === "refreshing" || live.status === "loading";
  return (
    <span className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-extrabold text-emerald-600">
      <span className="tn-pulse tn-pulse--green h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
      LIVE · TomTom{live.updatedAt ? ` · ${clock(live.updatedAt)} IST` : ""}
      <button
        type="button"
        onClick={live.refresh}
        disabled={refreshing}
        className="grid h-5 w-5 place-items-center rounded-full hover:bg-emerald-500/15 disabled:opacity-50"
        aria-label="Refresh live traffic"
        data-tip="Refresh now (auto every 5 min)"
        data-tip-pos="bottom"
      >
        <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
      </button>
    </span>
  );
}

/** Current speed vs free-flow speed on the road at every camera junction. */
export function LiveJunctionSpeeds({ probes, onSelect }) {
  const chart = useChartTheme();
  const data = probes.map((p) => ({ id: p.code, name: p.name, speed: p.speed, freeFlow: p.freeFlow, camera: p.camera }));
  return (
    <section className="premium-panel flex h-[320px] flex-col p-5">
      <div className="mb-2">
        <h3 className="flex items-center gap-2 text-sm font-black text-gray-900">
          <Gauge size={16} className="text-blue-500" /> Live speed at each camera junction
        </h3>
        <p className="text-[10px] font-bold text-gray-500">Current speed vs the road's free-flow speed · TomTom live</p>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
            <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="id" tick={chart.tick} axisLine={false} tickLine={false} interval={0} tickFormatter={(v) => v.replace("CAM-", "")} />
            <YAxis tick={chart.tick} axisLine={false} tickLine={false} width={34} label={{ value: "km/h", angle: -90, position: "insideLeft", style: chart.axisLabel }} />
            <Tooltip
              cursor={{ fill: chart.cursor }}
              content={<ChartTooltip units={{ speed: "km/h", freeFlow: "km/h" }} labelFormatter={(id) => `${id} · ${data.find((d) => d.id === id)?.name ?? ""}`} />}
            />
            <Legend wrapperStyle={{ fontSize: 10, fontWeight: 700 }} iconSize={8} />
            <Bar dataKey="freeFlow" name="Free flow" fill="#94a3b8" fillOpacity={0.45} radius={[4, 4, 0, 0]} maxBarSize={16} />
            <Bar
              dataKey="speed"
              name="Current"
              fill="#3b82f6"
              radius={[4, 4, 0, 0]}
              maxBarSize={16}
              cursor={onSelect ? "pointer" : undefined}
              onClick={(d) => onSelect?.(d?.camera)}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

const GROUP_ICON = { jam: Car, closure: Ban, accident: Siren, works: Construction, hazard: AlertTriangle, other: AlertTriangle };
const GROUP_COLOR = { jam: "#f97316", closure: "#ef4444", accident: "#dc2626", works: "#eab308", hazard: "#f59e0b", other: "#94a3b8" };

/** Live incidents across the camera network: counts by type and the most disruptive ones. */
export function LiveIncidents({ incidents }) {
  const counts = incidents.reduce((acc, i) => ({ ...acc, [i.group]: (acc[i.group] ?? 0) + 1 }), {});
  const top = [...incidents].sort((a, b) => b.delay - a.delay || b.magnitudeLevel - a.magnitudeLevel || b.length - a.length).slice(0, 6);
  const groups = [
    ["jam", "Jams"],
    ["closure", "Closures"],
    ["accident", "Accidents"],
    ["works", "Roadworks"],
  ];
  return (
    <section className="premium-panel flex flex-col p-5">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-black text-gray-900">
            <Siren size={16} className="text-red-500" /> Live incidents across the network
          </h3>
          <p className="text-[10px] font-bold text-gray-500">{incidents.length} active right now · TomTom live</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {groups.map(([g, label]) => {
          const Icon = GROUP_ICON[g];
          return (
            <div key={g} className="rounded-xl border border-gray-100 bg-gray-50/70 px-2 py-2 text-center">
              <Icon size={14} className="mx-auto" style={{ color: GROUP_COLOR[g] }} aria-hidden="true" />
              <p className="mt-1 text-lg font-black tabular-nums text-gray-900">{counts[g] ?? 0}</p>
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-500">{label}</p>
            </div>
          );
        })}
      </div>
      <ul className="mt-3 flex flex-col gap-1.5">
        {top.length === 0 && <li className="text-xs font-semibold text-gray-500">No incidents reported right now.</li>}
        {top.map((i) => {
          const Icon = GROUP_ICON[i.group] ?? AlertTriangle;
          return (
            <li key={i.id} className="flex items-start gap-2.5 rounded-xl border border-gray-100 bg-white/70 px-3 py-2">
              <Icon size={14} className="mt-0.5 flex-none" style={{ color: GROUP_COLOR[i.group] }} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-bold text-gray-900">{i.description}</p>
                <p className="truncate text-[10.5px] font-semibold text-gray-500">
                  {i.from ?? "—"} → {i.to ?? "—"}
                </p>
              </div>
              <span className="flex-none text-right text-[10.5px] font-extrabold text-gray-700">
                {i.delay ? `+${minutes(i.delay)}` : i.magnitude}
                <span className="block text-[9.5px] font-semibold text-gray-400">{i.length ? `${Math.round(i.length)} m` : ""}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Network speed and congestion over time, from the live samples collected in this browser. */
export function LiveTrend({ history }) {
  const chart = useChartTheme();
  const data = history.map((h) => ({ ...h, time: clock(h.t) }));
  return (
    <section className="premium-panel flex flex-col p-5">
      <div className="mb-2">
        <h3 className="flex items-center gap-2 text-sm font-black text-gray-900">
          <TrendingUp size={16} className="text-emerald-500" /> Live network trend
        </h3>
        <p className="text-[10px] font-bold text-gray-500">Average junction speed and congestion · one sample every 5 min · last 24 h in this browser</p>
      </div>
      {data.length < 2 ? (
        <div className="grid min-h-[220px] flex-1 place-items-center rounded-2xl border border-dashed border-gray-200 text-center">
          <p className="max-w-xs text-xs font-semibold text-gray-500">
            The trend fills in as live samples arrive — {data.length === 1 ? "1 sample so far" : "waiting for the first sample"}. Keep the page open or come back later.
          </p>
        </div>
      ) : (
        <div className="h-[240px] min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" tick={chart.tick} axisLine={false} tickLine={false} minTickGap={28} />
              <YAxis yAxisId="speed" domain={[0, (max) => Math.ceil((max + 5) / 10) * 10]} tick={chart.tick} axisLine={false} tickLine={false} width={34} />
              <YAxis yAxisId="cong" orientation="right" domain={[0, 100]} tick={chart.tick} axisLine={false} tickLine={false} width={34} tickFormatter={(v) => `${v}%`} />
              <Tooltip cursor={chart.cursorLine} content={<ChartTooltip units={{ speed: "km/h", freeFlow: "km/h", congestion: "%" }} />} />
              <Area yAxisId="cong" type="monotone" dataKey="congestion" name="Congestion" stroke="#f97316" fill="#f97316" fillOpacity={0.12} strokeWidth={1.5} />
              <Line yAxisId="speed" type="monotone" dataKey="freeFlow" name="Free flow" stroke="#94a3b8" strokeDasharray="4 4" dot={false} strokeWidth={1.5} />
              <Line yAxisId="speed" type="monotone" dataKey="speed" name="Avg speed" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
