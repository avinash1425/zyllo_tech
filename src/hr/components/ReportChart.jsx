// Module 12 — chart for one analytics section. Renders exactly the rows of the
// section's table (same dataset, same definitions); every chart has a table
// view next to it in ReportsPage.
// Palette: validated categorical order (dataviz reference palette, light mode);
// colours follow the series key, never its rank. One axis per chart.
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const GRID = "#e7e5e4";
const AXIS = "#52514e";
const MAX_SLICES = 7;

export function formatValue(v, type) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (type === "pct") return `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
  if (type === "money") return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
const compact = (type) => (v) => (type === "pct" ? `${v}%` : type === "money"
  ? new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(v) : Number(v).toLocaleString("en-IN"));

export default function ReportChart({ section }) {
  const chart = section.chart;
  const cols = useMemo(() => Object.fromEntries((section.columns ?? []).map((c) => [c.key, c])), [section.columns]);
  const ys = chart?.y ?? [];
  const yType = cols[ys[0]]?.type;
  const label = (k) => cols[k]?.label ?? k;
  const data = useMemo(() => (section.rows ?? []).map((r) => {
    const o = { ...r };
    for (const k of ys) o[k] = r[k] === null || r[k] === undefined ? null : Number(r[k]);
    return o;
  }), [section.rows, ys]);

  if (!chart || !data.length) return null;
  const tip = <Tooltip formatter={(v, k) => [formatValue(v, cols[k]?.type), label(k)]} contentStyle={{ borderRadius: 12, borderColor: GRID, fontSize: 12 }} />;
  const legend = ys.length > 1 ? <Legend formatter={(k) => <span style={{ color: AXIS, fontSize: 12 }}>{label(k)}</span>} /> : null;
  const axisProps = { tick: { fill: AXIS, fontSize: 11 }, tickLine: false, axisLine: { stroke: GRID } };
  const desc = `${section.title}: ${chart.type} chart of ${ys.map(label).join(", ")} by ${label(chart.x)}. The table view lists the same values.`;

  let body;
  if (chart.type === "pie") {
    const sorted = [...data].sort((a, b) => (b[ys[0]] ?? 0) - (a[ys[0]] ?? 0));
    const slices = sorted.length > MAX_SLICES
      ? [...sorted.slice(0, MAX_SLICES - 1), { [chart.x]: "Other", [ys[0]]: sorted.slice(MAX_SLICES - 1).reduce((s, r) => s + (r[ys[0]] ?? 0), 0) }]
      : sorted;
    // Colour by entity: stable index from the original row order, "Other" grey.
    const order = data.map((r) => r[chart.x]);
    body = (
      <PieChart>
        <Pie data={slices} dataKey={ys[0]} nameKey={chart.x} innerRadius="55%" outerRadius="85%" paddingAngle={1} stroke="#fff" strokeWidth={2} isAnimationActive={false}>
          {slices.map((s) => <Cell key={s[chart.x]} fill={s[chart.x] === "Other" ? "#a8a29e" : SERIES_COLORS[order.indexOf(s[chart.x]) % SERIES_COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v, n) => [formatValue(v, yType), n]} contentStyle={{ borderRadius: 12, borderColor: GRID, fontSize: 12 }} />
        <Legend formatter={(v) => <span style={{ color: AXIS, fontSize: 12 }}>{v}</span>} />
      </PieChart>
    );
  } else if (chart.type === "line") {
    body = (
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={chart.x} {...axisProps} minTickGap={16} />
        <YAxis {...axisProps} width={56} tickFormatter={compact(yType)} domain={yType === "pct" ? [0, 100] : [0, "auto"]} allowDecimals={false} />
        {tip}{legend}
        {ys.map((k, i) => <Line key={k} type="monotone" dataKey={k} stroke={SERIES_COLORS[i]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />)}
      </LineChart>
    );
  } else {
    const horizontal = chart.type === "funnel" || data.length > 8;
    body = (
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 16, left: horizontal ? 8 : 0, bottom: 0 }} barCategoryGap="20%" barGap={2}>
        <CartesianGrid stroke={GRID} vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...axisProps} tickFormatter={compact(yType)} domain={yType === "pct" ? [0, 100] : [0, "auto"]} />
            <YAxis type="category" dataKey={chart.x} {...axisProps} width={140} interval={0} />
          </>
        ) : (
          <>
            <XAxis dataKey={chart.x} {...axisProps} interval={0} angle={data.length > 5 ? -20 : 0} textAnchor={data.length > 5 ? "end" : "middle"} height={data.length > 5 ? 56 : 30} />
            <YAxis {...axisProps} width={56} tickFormatter={compact(yType)} domain={yType === "pct" ? [0, 100] : [0, "auto"]} />
          </>
        )}
        {tip}{legend}
        {ys.map((k, i) => (
          <Bar key={k} dataKey={k} fill={SERIES_COLORS[i]} stackId={chart.stacked ? "s" : undefined} maxBarSize={36} isAnimationActive={false}
            radius={chart.stacked && i < ys.length - 1 ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} stroke="#fff" strokeWidth={chart.stacked ? 1 : 0} />
        ))}
      </BarChart>
    );
  }

  const height = chart.type === "funnel" || (chart.type === "bar" && data.length > 8) ? Math.min(520, 60 + data.length * 32) : 280;
  return (
    <figure className="m-0" role="img" aria-label={desc}>
      <div style={{ width: "100%", height }}><ResponsiveContainer>{body}</ResponsiveContainer></div>
    </figure>
  );
}
