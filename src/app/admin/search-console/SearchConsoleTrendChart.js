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

function formatTick(isoDate) {
  const [, month, day] = isoDate.split("-");
  return `${Number(day)} ${MONTH_NAMES[Number(month) - 1]}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-[#e7e9ee] bg-white px-3 py-2 shadow-lg">
      <p className="text-xs font-semibold text-[#2b303b]">{formatTick(label)}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="mt-1 flex items-center gap-1.5 text-xs text-[#676b7a]">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          {entry.name}: <span className="font-semibold text-[#2b303b]">{entry.value.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

// Same gradient-AreaChart-with-dot-legend approach as admin/TrafficChart.js,
// applied to Search Console-shaped clicks/impressions data instead of
// visitors/pageViews. Kept as a separate component (not a reuse of
// TrafficChart) since the data shape, colors, and tooltip formatting are
// specific to search performance rather than site traffic.
export default function SearchConsoleTrendChart({ data }) {
  const tickInterval = useMemo(() => {
    const days = data.length;
    return days <= 7 ? 0 : days <= 30 ? 3 : 9;
  }, [data.length]);

  return (
    <div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="seoClicksGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f7941e" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#f7941e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="seoImpressionsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1f4693" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#1f4693" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e9ee" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatTick}
              tick={{ fontSize: 11, fill: "#676b7a" }}
              axisLine={{ stroke: "#e7e9ee" }}
              tickLine={false}
              interval={tickInterval}
            />
            {/* Two Y-axes on purpose — impressions typically run ~15-20x
                higher than clicks, so a shared scale would flatten the
                clicks line to near-invisible. Clicks (left, orange) reads
                against its own small-number scale; impressions (right,
                blue) against its own larger one. */}
            <YAxis
              yAxisId="clicks"
              tick={{ fontSize: 11, fill: "#f7941e" }}
              axisLine={false}
              tickLine={false}
              width={36}
              domain={[0, (max) => Math.ceil((max * 1.2) / 10) * 10]}
            />
            <YAxis
              yAxisId="impressions"
              orientation="right"
              tick={{ fontSize: 11, fill: "#1f4693" }}
              axisLine={false}
              tickLine={false}
              width={44}
              domain={[0, (max) => Math.ceil((max * 1.2) / 100) * 100]}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              yAxisId="impressions"
              type="monotone"
              dataKey="impressions"
              name="Impressions"
              stroke="#1f4693"
              strokeWidth={2}
              fill="url(#seoImpressionsGradient)"
            />
            <Area
              yAxisId="clicks"
              type="monotone"
              dataKey="clicks"
              name="Clicks"
              stroke="#f7941e"
              strokeWidth={2.5}
              fill="url(#seoClicksGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-[#676b7a]">
          <span className="inline-block h-2 w-2 rounded-full bg-[#f7941e]" aria-hidden="true" />
          Clicks
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-[#676b7a]">
          <span className="inline-block h-2 w-2 rounded-full bg-[#1f4693]" aria-hidden="true" />
          Impressions
        </span>
      </div>
    </div>
  );
}
