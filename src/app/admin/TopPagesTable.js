import { TrendingUp } from "lucide-react";

// Placeholder page-performance data, using real Zyllo page paths. Swap
// for a live analytics query once a tracking tool is connected.
const TOP_PAGES = [
  {
    title: "Home",
    path: "/",
    views: 5420,
    visitors: 4100,
    avgTime: "2m 14s",
    conversion: "8.3%",
  },
  {
    title: "Custom Software Development",
    path: "/services/custom-software-development",
    views: 4870,
    visitors: 4000,
    avgTime: "2m 14s",
    conversion: "5.2%",
  },
  {
    title: "Careers",
    path: "/careers",
    views: 3580,
    visitors: 3000,
    avgTime: "2m 08s",
    conversion: "9.8%",
  },
  {
    title: "Mobile App Development",
    path: "/services/mobile-app-development",
    views: 2320,
    visitors: 2200,
    avgTime: "1m 57s",
    conversion: "5.7%",
  },
  {
    title: "About Us",
    path: "/about",
    views: 2370,
    visitors: 1750,
    avgTime: "1m 43s",
    conversion: "5.3%",
  },
  {
    title: "Cloud Solutions",
    path: "/services/cloud-solutions",
    views: 1200,
    visitors: 1100,
    avgTime: "2m 05s",
    conversion: "10.0%",
  },
  {
    title: "Contact",
    path: "/contact",
    views: 1000,
    visitors: 900,
    avgTime: "1m 12s",
    conversion: "12.5%",
  },
  {
    title: "AI & Automation",
    path: "/services/ai-automation",
    views: 770,
    visitors: 630,
    avgTime: "2m 21s",
    conversion: "6.9%",
  },
];

export default function TopPagesTable({ days = 30 }) {
  const scale = days / 30;
  const scaledPages = TOP_PAGES.map((page) => ({
    ...page,
    views: Math.max(1, Math.round(page.views * scale)),
    visitors: Math.max(1, Math.round(page.visitors * scale)),
  })).sort((a, b) => b.views - a.views);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-[#e7e9ee] text-xs font-bold uppercase tracking-wide text-[#676b7a]">
            <th className="py-2 pr-3">Page</th>
            <th className="px-3 py-2 text-right">Views</th>
            <th className="px-3 py-2 text-right">Visitors</th>
            <th className="px-3 py-2 text-right">Avg. Time</th>
            <th className="py-2 pl-3 text-right">Conversion</th>
          </tr>
        </thead>
        <tbody>
          {scaledPages.map((page) => (
            <tr
              key={page.path}
              className="border-b border-[#f0f1f4] last:border-0 transition-colors hover:bg-[#fafbfc]"
            >
              <td className="py-2 pr-3">
                <p className="font-semibold text-[#2b303b]">{page.title}</p>
                <p className="mt-0.5 truncate text-xs text-[#676b7a]">{page.path}</p>
              </td>
              <td className="px-3 py-2 text-right font-medium text-[#2b303b]">
                {page.views.toLocaleString()}
              </td>
              <td className="px-3 py-2 text-right text-[#676b7a]">
                {page.visitors.toLocaleString()}
              </td>
              <td className="px-3 py-2 text-right">
                <span className="inline-flex items-center gap-1 text-[#3b6d11]">
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                  {page.avgTime}
                </span>
              </td>
              <td className="py-2 pl-3 text-right font-semibold text-[#f7941e]">
                {page.conversion}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
