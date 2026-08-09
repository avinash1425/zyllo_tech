"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  Search,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  MousePointerClick,
  Eye,
  Percent,
  ListOrdered,
} from "lucide-react";
import SearchConsoleTrendChart from "./SearchConsoleTrendChart";
import { SITE_URL } from "@/lib/site-config";

const RANGE_OPTIONS = [
  { value: "7d", label: "7 days", days: 7 },
  { value: "28d", label: "28 days", days: 28 },
  { value: "3m", label: "3 months", days: 90 },
  { value: "12m", label: "12 months", days: 365 },
];

const BREAKDOWN_TABS = [
  { key: "queries", label: "Queries", columnLabel: "Query" },
  { key: "pages", label: "Pages", columnLabel: "Page" },
  { key: "countries", label: "Countries", columnLabel: "Country" },
  { key: "devices", label: "Devices", columnLabel: "Device" },
  { key: "sitemaps", label: "Sitemaps", columnLabel: "Sitemap" },
];

// Deltas are illustrative — real week-over-week deltas need two real
// Search Console queries to diff against each other, same as everything
// else on this page. Kept static regardless of range so the UI shape is
// final now; only the fetch in page.js needs to change later.
const STAT_CARDS = [
  {
    key: "clicks",
    label: "Total clicks",
    icon: MousePointerClick,
    accent: "#1f4693",
    delta: "-4.2%",
    deltaGood: false,
    format: (v) => v.toLocaleString(),
  },
  {
    key: "impressions",
    label: "Total impressions",
    icon: Eye,
    accent: "#7c3aed",
    delta: "-2.1%",
    deltaGood: false,
    format: (v) => v.toLocaleString(),
  },
  {
    key: "ctr",
    label: "Average CTR",
    icon: Percent,
    accent: "#f7941e",
    delta: "-0.3%",
    deltaGood: false,
    format: (v) => `${v.toFixed(2)}%`,
  },
  {
    key: "avgPosition",
    label: "Average position",
    icon: ListOrdered,
    accent: "#3b6d11",
    delta: "+1.8",
    deltaGood: true,
    format: (v) => v.toFixed(1),
  },
];

const INSIGHT_TAGS = [
  {
    label: "Coverage",
    color: "#1f4693",
    text: "A handful of tracked queries currently drive nearly all clicks — expand keyword coverage with more service and location-specific pages.",
  },
  {
    label: "Quick win",
    color: "#f7941e",
    text: "Queries with impressions but low CTR are the fastest wins — tighten titles and meta descriptions to match search intent more closely.",
  },
  {
    label: "Position",
    color: "#3b6d11",
    text: "Average position sits outside page 1 for most tracked queries — internal linking from high-authority pages (homepage, services) can help.",
  },
];

function formatDateLabel(date) {
  // Explicit component extraction rather than parsing a locale-formatted
  // string — en-US toLocaleDateString gives MM/DD/YYYY, and naively
  // reversing that split silently swaps month and day (e.g. Aug 9 would
  // render as 2026-09-08 instead of 2026-08-09). Building the ISO string
  // directly from getMonth()/getDate()/getFullYear() avoids that trap.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function StatCard({ card, value }) {
  const Icon = card.icon;
  const DeltaIcon = card.deltaGood ? ArrowUpRight : ArrowDownRight;
  const deltaColor = card.deltaGood ? "#3b6d11" : "#dc2626";

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-[#e7e9ee] p-5 shadow-sm"
      style={{ background: `linear-gradient(150deg, ${card.accent}14, ${card.accent}05 55%, transparent)` }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-[#676b7a]">{card.label}</p>
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${card.accent}18` }}
        >
          <Icon className="h-4 w-4" style={{ color: card.accent }} aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight text-[#2b303b]">
        {card.format(value)}
      </p>
      <p className="mt-2 inline-flex items-center gap-0.5 text-xs font-semibold" style={{ color: deltaColor }}>
        <DeltaIcon className="h-3 w-3" aria-hidden="true" />
        {card.delta}
        <span className="ml-1 font-normal text-[#676b7a]">vs prior period</span>
      </p>
    </div>
  );
}

function BreakdownTable({ rows, columnLabel }) {
  if (rows.length === 0) {
    return <p className="mt-4 text-sm text-[#676b7a]">No data for this range yet.</p>;
  }

  // Sitemaps rows carry a different shape (submitted/indexed/status)
  // rather than clicks/impressions/ctr/position — render them with their
  // own columns instead of forcing search-performance fields onto a
  // concept that doesn't have them.
  const isSitemapShape = "status" in rows[0];

  if (isSitemapShape) {
    return (
      <table className="w-full min-w-[420px] text-left text-sm">
        <thead>
          <tr className="border-b border-[#e7e9ee] text-xs font-semibold uppercase tracking-wide text-[#9aa0ac]">
            <th className="py-2 pr-3 font-semibold">{columnLabel}</th>
            <th className="py-2 px-3 text-right font-semibold">URLs submitted</th>
            <th className="py-2 pl-3 text-right font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-[#e7e9ee] last:border-0">
              <td className="py-2.5 pr-3 text-[#2b303b]">{row.label}</td>
              <td className="py-2.5 px-3 text-right text-[#676b7a]">{row.submitted}</td>
              <td className="py-2.5 pl-3 text-right text-[#676b7a]">{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <table className="w-full min-w-[480px] text-left text-sm">
      <thead>
        <tr className="border-b border-[#e7e9ee] text-xs font-semibold uppercase tracking-wide text-[#9aa0ac]">
          <th className="py-2 pr-3 font-semibold">{columnLabel}</th>
          <th className="py-2 px-3 text-right font-semibold">Clicks</th>
          <th className="py-2 px-3 text-right font-semibold">Impr.</th>
          <th className="py-2 px-3 text-right font-semibold">CTR</th>
          <th className="py-2 pl-3 text-right font-semibold">Pos.</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-b border-[#e7e9ee] last:border-0">
            <td className="py-2.5 pr-3 text-[#2b303b]">{row.label}</td>
            <td className="py-2.5 px-3 text-right text-[#2b303b]">{row.clicks}</td>
            <td className="py-2.5 px-3 text-right text-[#676b7a]">{row.impressions}</td>
            <td className="py-2.5 px-3 text-right text-[#676b7a]">{row.ctr.toFixed(2)}%</td>
            <td className="py-2.5 pl-3 text-right text-[#676b7a]">{row.position.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TAB_DATA_KEYS = {
  queries: "topQueries",
  pages: "topPages",
  countries: "topCountries",
  devices: "deviceBreakdown",
  sitemaps: "sitemaps",
};

function BreakdownPanel({ performance }) {
  const [activeTab, setActiveTab] = useState("queries");
  const activeTabConfig = BREAKDOWN_TABS.find((tab) => tab.key === activeTab);
  const rows = performance[TAB_DATA_KEYS[activeTab]] ?? [];

  return (
    <div className="rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-[#2b303b]">Breakdown</h2>
      <p className="mt-0.5 text-xs text-[#676b7a]">Top queries, pages, countries and devices</p>

      <div className="mt-3 inline-flex flex-wrap gap-1 rounded-xl bg-[#fafbfc] p-1">
        {BREAKDOWN_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
              activeTab === tab.key
                ? "bg-white text-[#2b303b] shadow-sm"
                : "text-[#676b7a] hover:text-[#2b303b]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-3 overflow-x-auto">
        <BreakdownTable rows={rows} columnLabel={activeTabConfig.columnLabel} />
      </div>
    </div>
  );
}

export default function SearchConsoleManager({ performance, range }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const rangeConfig = RANGE_OPTIONS.find((option) => option.value === range) ?? RANGE_OPTIONS[1];
  const dateRangeLabel = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - rangeConfig.days);
    return `${formatDateLabel(start)} → ${formatDateLabel(end)}`;
  }, [rangeConfig.days]);

  function handleRangeChange(value) {
    startTransition(() => {
      router.push(`/admin/search-console?range=${value}`);
    });
  }

  function handleRefresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-[#f7941e]" aria-hidden="true" />
            <h1 className="text-2xl font-bold tracking-tight text-[#2b303b]">Google Search Console</h1>
          </div>
          <p className="mt-1 text-sm text-[#676b7a]">
            {SITE_URL}/ · {dateRangeLabel}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleRangeChange(option.value)}
              disabled={isPending}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
                range === option.value
                  ? "border-[#f7941e] bg-[#f7941e] text-white"
                  : "border-[#e7e9ee] bg-white text-[#676b7a] hover:border-[#f7941e]/40 hover:text-[#f7941e]"
              }`}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isPending}
            aria-label="Refresh"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#e7e9ee] bg-white text-[#676b7a] transition-colors duration-200 hover:border-[#1f4693]/40 hover:text-[#1f4693] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {performance.isSampleData && (
        <p className="-mt-2 rounded-lg border border-[#f7941e]/25 bg-[#fff7ed] px-3.5 py-2 text-xs leading-relaxed text-[#8a5a12]">
          Sample data — connect Google Search Console to show real search performance here. See the
          setup note in <code className="rounded bg-[#f7941e]/15 px-1 py-0.5">admin/search-console/page.js</code>.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STAT_CARDS.map((card) => (
          <StatCard key={card.key} card={card} value={performance.totals[card.key]} />
        ))}
      </div>

      <div className="rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-[#2b303b]">Clicks & impressions</h2>
        <p className="mt-0.5 text-xs text-[#676b7a]">Daily performance in Google Search</p>
        <div className="mt-3">
          <SearchConsoleTrendChart data={performance.timeSeries} />
        </div>
      </div>

      <div className="rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[#2b303b]">What to optimize next</h2>
        <p className="mt-0.5 text-xs text-[#676b7a]">Automatic reading of current search performance</p>

        <ul className="mt-4 flex flex-col gap-3">
          {INSIGHT_TAGS.map((insight) => (
            <li key={insight.label} className="flex items-start gap-3 text-sm">
              <span
                className="mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white"
                style={{ backgroundColor: insight.color }}
              >
                {insight.label}
              </span>
              <span className="text-[#2b303b]">{insight.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <BreakdownPanel performance={performance} />
    </div>
  );
}
