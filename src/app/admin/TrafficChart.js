"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Deterministic pseudo-random placeholder generator so the chart doesn't
// jump around on every render, but still varies by day count. Swap this
// whole function for a real analytics query once a tracking tool is wired
// in — the chart component itself won't need to change.
function generateTrafficData(days) {
  const data = [];
  const today = new Date();

  let seed = days * 37;
  function nextRandom() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const label = `${MONTH_NAMES[date.getMonth()]} ${String(date.getDate()).padStart(2, "0")}`;

    const base = 500 + Math.sin((days - i) / 4) * 150 + nextRandom() * 200;
    const visitors = Math.round(base);
    // Page views run ahead of visitors (multi-page sessions) — matches
    // the "pages/visit" ratio shown on the stat card above this chart.
    const pageViews = Math.round(visitors * (2.1 + nextRandom() * 0.9));

    data.push({ day: label, visitors, pageViews });
  }

  return data;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-[#e7e9ee] bg-white px-3 py-2 shadow-lg">
      <p className="text-xs font-semibold text-[#2b303b]">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="mt-1 flex items-center gap-1.5 text-xs text-[#676b7a]">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          {entry.name}: <span className="font-semibold text-[#2b303b]">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

export default function TrafficChart({ days = 30 }) {
  const data = useMemo(() => generateTrafficData(days), [days]);
  const tickInterval = days <= 7 ? 0 : days <= 30 ? 3 : 9;

  return (
    <div>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="visitorsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1f4693" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#1f4693" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="pageViewsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e9ee" vertical={false} />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 11, fill: "#676b7a" }}
              axisLine={{ stroke: "#e7e9ee" }}
              tickLine={false}
              interval={tickInterval}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#676b7a" }}
              axisLine={false}
              tickLine={false}
              width={40}
              domain={[0, (max) => Math.ceil((max * 1.15) / 100) * 100]}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="pageViews"
              name="Page Views"
              stroke="#7c3aed"
              strokeWidth={2.5}
              fill="url(#pageViewsGradient)"
            />
            <Area
              type="monotone"
              dataKey="visitors"
              name="Visitors"
              stroke="#1f4693"
              strokeWidth={2.5}
              fill="url(#visitorsGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-[#676b7a]">
          <span className="inline-block h-2 w-2 rounded-full bg-[#1f4693]" aria-hidden="true" />
          Visitors
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-[#676b7a]">
          <span className="inline-block h-2 w-2 rounded-full bg-[#7c3aed]" aria-hidden="true" />
          Page Views
        </span>
      </div>
    </div>
  );
}
