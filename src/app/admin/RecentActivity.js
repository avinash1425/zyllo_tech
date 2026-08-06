"use client";

import { MessageSquare, UserPlus } from "lucide-react";
import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip } from "recharts";

function timeAgo(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  return new Date(isoString).toLocaleDateString("en-IN", {
    month: "short",
    day: "numeric",
  });
}

function WeeklyTooltip({ active, payload, label }) {
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

export default function RecentActivity({ items, weeklyCounts = [] }) {
  const hasAnyActivity = weeklyCounts.some((d) => d.contacts > 0 || d.applicants > 0);

  return (
    <div className="rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#2b303b]">Recent activity</h2>
        <span className="text-xs font-medium text-[#676b7a]">Last 7 days</span>
      </div>

      {hasAnyActivity && (
        <div className="mt-2 h-20 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeklyCounts} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} barGap={3}>
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10, fill: "#676b7a" }}
                axisLine={{ stroke: "#e7e9ee" }}
                tickLine={false}
              />
              <Tooltip content={<WeeklyTooltip />} cursor={{ fill: "#fafbfc" }} />
              <Bar dataKey="contacts" name="Contacts" fill="#f7941e" radius={[3, 3, 0, 0]} />
              <Bar dataKey="applicants" name="Applicants" fill="#1f4693" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {items.length === 0 ? (
        <p className="mt-3 py-6 text-center text-xs text-[#676b7a]">
          Nothing yet — new contact submissions and job applicants will show up here.
        </p>
      ) : (
        <ul className="mt-2 flex max-h-[240px] flex-col overflow-y-auto">
          {items.map((item, index) => {
            const Icon = item.type === "applicant" ? UserPlus : MessageSquare;
            return (
              <li
                key={`${item.type}-${item.id}`}
                className={`flex items-start gap-2.5 py-2.5 ${
                  index !== items.length - 1 ? "border-b border-[#e7e9ee]" : ""
                }`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f5f6f8] text-[#676b7a]">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[#2b303b]">{item.text}</p>
                  <p className="mt-0.5 truncate text-[10px] text-[#676b7a]">{item.detail}</p>
                </div>
                <span className="shrink-0 text-[10px] text-[#676b7a]/70">
                  {timeAgo(item.createdAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
