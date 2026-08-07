"use client";

import { useMemo, useState } from "react";
import { Eye, Users, Clock } from "lucide-react";
import TrafficChart from "./TrafficChart";
import DateRangeSelect from "./DateRangeSelect";

// Placeholder summary numbers per range, roughly scaled with day count.
// Swap for real aggregates once analytics is connected.
function getSummaryStats(days) {
  const scale = days / 30;
  const visitors = Math.round(10400 * scale);
  const uniqueUsers = Math.round(8100 * scale);
  const avgSeconds = 150 + Math.round(Math.sin(days) * 10);

  return [
    {
      label: "Total Visitors",
      value: visitors >= 1000 ? `${(visitors / 1000).toFixed(1)}K` : `${visitors}`,
      icon: Eye,
      accent: "#f7941e",
    },
    {
      label: "Unique Users",
      value: uniqueUsers >= 1000 ? `${(uniqueUsers / 1000).toFixed(1)}K` : `${uniqueUsers}`,
      icon: Users,
      accent: "#1f4693",
    },
    {
      label: "Avg. Session Duration",
      value: `${Math.floor(avgSeconds / 60)}m ${avgSeconds % 60}s`,
      icon: Clock,
      accent: "#f7941e",
    },
  ];
}

export default function TrafficPanel() {
  const [days, setDays] = useState(30);
  const stats = useMemo(() => getSummaryStats(days), [days]);

  return (
    <div className="rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#2b303b]">Website Traffic Overview</h2>
          <p className="mt-0.5 text-xs text-[#676b7a]">Last {days} days</p>
        </div>
        <DateRangeSelect value={days} onChange={setDays} />
      </div>

      <div className="mt-3">
        <TrafficChart days={days} />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        {stats.map(({ label, value, icon: Icon, accent }) => (
          <div key={label} className="rounded-lg border border-[#e7e9ee] bg-[#fafbfc] px-2.5 py-2">
            <div className="flex items-center justify-between">
              <p className="truncate text-[10px] text-[#676b7a]">{label}</p>
              <Icon className="h-3 w-3 shrink-0" style={{ color: accent }} aria-hidden="true" />
            </div>
            <p className="mt-0.5 text-base font-bold text-[#2b303b]">{value}</p>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-[#676b7a]/70">
        Sample data — connect an analytics tool to show real traffic here.
      </p>
    </div>
  );
}
