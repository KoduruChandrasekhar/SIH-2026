import { useTheme } from "../../ThemeContext";

// Shared Recharts styling so every TraceNet chart reads the same in light and dark mode.
export function useChartTheme() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return {
    dark,
    grid: dark ? "rgba(71, 85, 105, 0.35)" : "#eef1f5",
    tick: { fontSize: 10, fontWeight: 700, fill: dark ? "#7a889c" : "#8a94a6" },
    axisLabel: { fontSize: 10, fontWeight: 700, fill: dark ? "#7a889c" : "#8a94a6" },
    cursor: dark ? "rgba(59, 130, 246, 0.08)" : "rgba(59, 130, 246, 0.06)",
    cursorLine: { stroke: dark ? "rgba(148, 163, 184, 0.35)" : "#cbd5e1", strokeDasharray: "3 3" },
  };
}

// Show every Nth hour label on 24-point hourly axes
export const hourTicks = (step = 3) => (value, index) => (index % step === 0 ? value : "");

/**
 * Tooltip for Recharts. `units` maps a dataKey to its unit label, e.g. { flow: "veh/h" };
 * `format` optionally maps a dataKey to a value formatter.
 */
export function ChartTooltip({ active, payload, label, units = {}, format = {}, labelPrefix = "", labelFormatter }) {
  const { dark } = useChartTheme();
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl border px-3 py-2 shadow-xl"
      style={{
        background: dark ? "rgba(10, 17, 31, 0.96)" : "rgba(255, 255, 255, 0.97)",
        borderColor: dark ? "rgba(71, 85, 105, 0.6)" : "#e5e7eb",
      }}
    >
      <p className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: dark ? "#7a889c" : "#8a94a6" }}>
        {labelPrefix}
        {labelFormatter ? labelFormatter(label, payload) : label}
      </p>
      {payload.map((p) => (
        <div key={p.dataKey} className="mt-1 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill || "#3b82f6" }} />
          <span className="text-[11px] font-semibold" style={{ color: dark ? "#a3b0c2" : "#6b7280" }}>
            {p.name}
          </span>
          <span className="ml-auto pl-3 text-xs font-black tabular-nums" style={{ color: dark ? "#e6edf7" : "#111827" }}>
            {format[p.dataKey] ? format[p.dataKey](p.value) : p.value?.toLocaleString("en-IN")} {units[p.dataKey] ?? ""}
          </span>
        </div>
      ))}
    </div>
  );
}
