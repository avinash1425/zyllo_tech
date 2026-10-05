import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Activity } from "lucide-react";
import Card from "./Card";
import EmptyState from "../EmptyState";

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#e7e9ee] bg-white px-3 py-2 shadow-lg">
      <p className="text-xs font-semibold text-[#2b303b]">{label}</p>
      {payload.map((e) => (
        <p key={e.dataKey} className="mt-1 flex items-center gap-1.5 text-xs text-[#676b7a]">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
          {e.name}: <span className="font-semibold tabular-nums text-[#2b303b]">{e.value}</span>
        </p>
      ))}
    </div>
  );
}

export default function WeeklyActivityChart({ weeklyCounts }) {
  const has = weeklyCounts.some((d) => d.contacts > 0 || d.applicants > 0);
  const c = weeklyCounts.reduce((s, d) => s + d.contacts, 0);
  const a = weeklyCounts.reduce((s, d) => s + d.applicants, 0);
  return (
    <Card icon={Activity} title="Weekly activity" subtitle="Contact submissions vs job applications, last 7 days">
      {has ? (
        <div
          className="mt-4 h-64 w-full"
          role="img"
          aria-label={`Area chart of the last 7 days: ${c} contact submissions and ${a} job applications in total.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weeklyCounts} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id="dashContacts" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f7941e" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#f7941e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="dashApplicants" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1f4693" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#1f4693" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#eef0f4" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#676b7a" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#676b7a" }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#d9dce3" }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Area type="monotone" dataKey="contacts" name="Contacts" stroke="#f7941e" strokeWidth={2.5} fill="url(#dashContacts)" isAnimationActive={false} />
              <Area type="monotone" dataKey="applicants" name="Applicants" stroke="#1f4693" strokeWidth={2.5} fill="url(#dashApplicants)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState
          icon={Activity}
          title="No activity in the last 7 days"
          message="New contact submissions and job applications will chart here."
          className="py-14"
        />
      )}
    </Card>
  );
}
