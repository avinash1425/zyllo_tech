"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const COLORS = {
  "Contact Forms": "#1f4693",
  "Job Applications": "#3b6d11",
};

function renderOuterLabel({ cx, cy, midAngle, outerRadius, percent, name }) {
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 26;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  const anchor = x > cx ? "start" : "end";

  if (percent === 0) return null;

  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      dominantBaseline="central"
      className="text-[11px] font-medium"
      fill={COLORS[name]}
    >
      {`${name}: ${Math.round(percent * 100)}%`}
    </text>
  );
}

function DonutTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  return (
    <div className="rounded-lg border border-[#e7e9ee] bg-white px-3 py-2 shadow-lg">
      <p className="flex items-center gap-1.5 text-xs text-[#676b7a]">
        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.payload.fill }} />
        {entry.name}: <span className="font-semibold text-[#2b303b]">{entry.value}</span>
      </p>
    </div>
  );
}

// Real breakdown of the two submission types this admin panel actually
// tracks — no placeholder "Downloads" slice, since Zyllo Tech doesn't have
// a downloadable-asset feature to attach real numbers to.
export default function LeadDistributionDonut({ contactsTotal, applicantsTotal }) {
  const total = contactsTotal + applicantsTotal;

  if (total === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-center text-xs text-[#676b7a]">
        No submissions yet — the breakdown will appear once contact forms or
        job applications start coming in.
      </div>
    );
  }

  const data = [
    { name: "Contact Forms", value: contactsTotal },
    { name: "Job Applications", value: applicantsTotal },
  ];

  return (
    <div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={2}
              label={renderOuterLabel}
              labelLine={false}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={COLORS[entry.name]} />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
        {data.map((entry) => (
          <span key={entry.name} className="inline-flex items-center gap-1.5 text-xs text-[#676b7a]">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: COLORS[entry.name] }}
              aria-hidden="true"
            />
            {entry.name}
          </span>
        ))}
      </div>
    </div>
  );
}
