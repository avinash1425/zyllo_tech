import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Activity } from "lucide-react";
import Card from "./Card";
import EmptyState from "../EmptyState";
import { prefersReducedMotion } from "./useCountUp";

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-[#e7e9ee] bg-white px-3 py-2 shadow-[0_12px_28px_-10px_rgba(16,26,58,0.3)]">
      <p className="text-xs font-semibold text-[#101a3a]">{label}</p>
      {payload.map((e) => (
        <p key={e.dataKey} className="mt-1 flex items-center gap-1.5 text-xs text-[#4b4f5c]">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: e.dataKey === "contacts" ? "#f96706" : "#1f4693" }} />
          {e.name}: <span className="font-semibold tabular-nums text-[#101a3a]">{e.value}</span>
        </p>
      ))}
    </div>
  );
}

function Chip({ color, label, value }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-[#f6f7fb] px-3 py-1 text-xs text-[#4b4f5c] ring-1 ring-inset ring-[#e7e9ee]">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {label}
      <span className="font-bold tabular-nums text-[#101a3a]">{value}</span>
    </span>
  );
}

export default function WeeklyActivityChart({ weeklyCounts }) {
  const c = weeklyCounts.reduce((s, d) => s + d.contacts, 0);
  const a = weeklyCounts.reduce((s, d) => s + d.applicants, 0);
  const has = c + a > 0;
  const peak = weeklyCounts.reduce((best, d) => (d.contacts + d.applicants > best.n ? { n: d.contacts + d.applicants, day: d.day } : best), { n: 0, day: "" });
  const animate = !prefersReducedMotion();
  return (
    <Card
      icon={Activity}
      title="Weekly activity"
      subtitle="Contact submissions vs job applications, last 7 days"
      className="h-full"
      action={
        has ? (
          <div className="hidden flex-wrap justify-end gap-2 sm:flex">
            <Chip color="#f96706" label="Contacts" value={c} />
            <Chip color="#1f4693" label="Applicants" value={a} />
          </div>
        ) : null
      }
    >
      {has ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2 sm:hidden">
            <Chip color="#f96706" label="Contacts" value={c} />
            <Chip color="#1f4693" label="Applicants" value={a} />
          </div>
          <div
            className="mt-4 h-72 w-full"
            role="img"
            aria-label={`Bar chart of the last 7 days: ${c} contact submissions and ${a} job applications in total. Busiest day: ${peak.day}.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyCounts} margin={{ top: 8, right: 4, left: -24, bottom: 0 }} barGap={4} barCategoryGap="24%">
                <defs>
                  <linearGradient id="dashBarC" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ffb15c" />
                    <stop offset="100%" stopColor="#f96706" />
                  </linearGradient>
                  <linearGradient id="dashBarA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3089a6" />
                    <stop offset="100%" stopColor="#1f4693" />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#eef0f4" strokeDasharray="3 4" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#676b7a" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#676b7a" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f6f7fb" }} />
                <Bar dataKey="contacts" name="Contacts" fill="url(#dashBarC)" radius={[8, 8, 3, 3]} maxBarSize={22} isAnimationActive={animate} animationDuration={700} />
                <Bar dataKey="applicants" name="Applicants" fill="url(#dashBarA)" radius={[8, 8, 3, 3]} maxBarSize={22} isAnimationActive={animate} animationDuration={700} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <EmptyState icon={Activity} title="No activity in the last 7 days" message="New contact submissions and job applications will chart here." className="py-14" />
      )}
    </Card>
  );
}
