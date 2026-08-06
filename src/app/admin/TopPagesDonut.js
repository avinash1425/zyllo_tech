"use client";

import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

// Same placeholder page data as before, just visualized as a donut of
// share-of-traffic instead of a row-by-row table. Swap TOP_PAGES for a
// real analytics query once a tracking tool is connected.
const TOP_PAGES = [
  { title: "Home", path: "/", views: 5420 },
  { title: "Custom Software Development", path: "/services/custom-software-development", views: 4870 },
  { title: "Careers", path: "/careers", views: 3580 },
  { title: "Mobile App Development", path: "/services/mobile-app-development", views: 2320 },
  { title: "About Us", path: "/about", views: 2370 },
];

const COLORS = ["#f7941e", "#1f4693", "#5b7fd4", "#db7d17", "#a4b3d6"];

function CustomTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];

  return (
    <div className="rounded-lg border border-[#e7e9ee] bg-white px-3 py-2 shadow-lg">
      <p className="text-xs font-semibold text-[#2b303b]">{entry.name}</p>
      <p className="mt-0.5 text-xs text-[#676b7a]">
        {entry.value.toLocaleString()} views ({entry.payload.percent}%)
      </p>
    </div>
  );
}

export default function TopPagesDonut({ days = 30 }) {
  const scale = days / 30;

  const data = useMemo(() => {
    const scaled = TOP_PAGES.map((page) => ({
      ...page,
      views: Math.max(1, Math.round(page.views * scale)),
    }));
    const total = scaled.reduce((sum, p) => sum + p.views, 0);
    return scaled
      .map((page) => ({
        name: page.title,
        path: page.path,
        value: page.views,
        percent: total > 0 ? Math.round((page.views / total) * 100) : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [scale]);

  const totalViews = data.reduce((sum, d) => sum + d.value, 0);
  const totalLabel =
    totalViews >= 1000 ? `${(totalViews / 1000).toFixed(1)}K` : `${totalViews}`;

  return (
    <div className="flex items-center justify-center py-2">
      <div className="relative h-56 w-56 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="68%"
              outerRadius="100%"
              paddingAngle={2}
              stroke="none"
            >
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              content={<CustomTooltip />}
              position={{ y: -20 }}
              wrapperStyle={{ pointerEvents: "none" }}
              allowEscapeViewBox={{ x: true, y: true }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#676b7a]">
            Total Views
          </p>
          <p className="text-xl font-bold text-[#2b303b]">{totalLabel}</p>
        </div>
      </div>
    </div>
  );
}
