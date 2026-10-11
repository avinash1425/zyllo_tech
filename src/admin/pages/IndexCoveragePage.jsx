import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Clock, Globe, RefreshCw } from "lucide-react";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import PageHeader from "../PageHeader";
import { getIndexCoverage } from "@/lib/api/admin/searchConsole";

const STAT_CARDS = [
  { key: "tracked", label: "Tracked URLs", icon: Globe, accent: "#1f4693" },
  { key: "indexed", label: "Indexed", icon: CheckCircle2, accent: "#3089a6" },
  { key: "notIndexed", label: "Not indexed", icon: Clock, accent: "#f7941e" },
  { key: "errors", label: "Check errors", icon: AlertTriangle, accent: "#dc2626" },
];

const VERDICT_COLORS = { PASS: "#3b6d11", ERROR: "#dc2626" };

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function pathOf(url) {
  try {
    const { pathname, search } = new URL(url);
    return pathname + search;
  } catch {
    return url;
  }
}

function Notice({ title, children, onRetry }) {
  return (
    <div className="rounded-2xl border border-[#e7e9ee] bg-white p-6 text-sm text-[#2b303b] shadow-sm">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-[#676b7a]">{children}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-4 rounded-full bg-[#1f4693] px-4 py-2 text-xs font-semibold text-white">
          Check again
        </button>
      )}
    </div>
  );
}

/** Google's index status for every URL in the live sitemap. */
export default function AdminIndexCoveragePage() {
  const { data, loading, error, reload } = useAdminData(getIndexCoverage);
  const [filter, setFilter] = useState("");
  const [isPending, startTransition] = useTransition();

  const pages = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = data?.pages ?? [];
    // Problems first, so pages that need attention are at the top.
    const sorted = [...all].sort((a, b) => (a.verdict === "PASS") - (b.verdict === "PASS") || a.url.localeCompare(b.url));
    return needle ? sorted.filter((p) => p.url.toLowerCase().includes(needle) || p.coverageState.toLowerCase().includes(needle)) : sorted;
  }, [data, filter]);

  if (loading) return <AdminLoading label="Asking Google about each page…" />;

  const header = (subtitle, actions) => (
    <PageHeader icon={Globe} title="Index Coverage" subtitle={subtitle} actions={actions} />
  );

  if (error && !data) {
    return (
      <div className="flex flex-col gap-6">
        {header("Could not run the check")}
        <Notice title="The index check failed" onRetry={reload}>{error.message}</Notice>
      </div>
    );
  }

  if (data.status !== "ok") {
    return (
      <div className="flex flex-col gap-6">
        {header("Not connected")}
        <Notice title="Google Search Console is not ready" onRetry={reload}>
          {data.status === "selection_required"
            ? "Choose which Search Console property to use on the Search Console page first."
            : data.message}
        </Notice>
      </div>
    );
  }

  // An older deployed function ignores the index-coverage mode and returns
  // search performance instead.
  if (!data.pages) {
    return (
      <div className="flex flex-col gap-6">
        {header("Not available yet")}
        <Notice title="The index check is not deployed yet">
          Publish the site so the updated search-console function is deployed, then open this page again.
        </Notice>
      </div>
    );
  }

  const firstError = data.pages.find((p) => p.error)?.error;
  const allFailed = data.totals.tracked > 0 && data.totals.errors === data.totals.tracked;

  return (
    <div className="flex flex-col gap-6">
      {header(
        <>
          Google&apos;s index status for every URL in the sitemap · checked {new Date(data.checkedAt).toLocaleString("en-IN")}
        </>,
        <button
          type="button"
          onClick={() => startTransition(async () => { await reload(); })}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-full border border-[#e7e9ee] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#676b7a] transition-colors duration-200 hover:border-[#1f4693]/40 hover:text-[#1f4693] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
          Run check again
        </button>,
      )}

      {allFailed && (
        <Notice title="Google did not answer any of the checks">
          Every URL inspection failed, so the Search Console connection may not allow URL inspection. First error: {firstError}
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STAT_CARDS.map(({ key, label, icon: Icon, accent }) => (
          <div
            key={key}
            className="relative overflow-hidden rounded-2xl border border-[#e7e9ee] p-5 shadow-sm"
            style={{ background: `linear-gradient(150deg, ${accent}14, ${accent}05 55%, transparent)` }}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-[#676b7a]">{label}</p>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${accent}18` }}>
                <Icon className="h-4 w-4" style={{ color: accent }} aria-hidden="true" />
              </span>
            </div>
            <p className="mt-3 text-3xl font-bold tracking-tight text-[#2b303b]">{data.totals[key]}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#2b303b]">URL status</h2>
            <p className="mt-0.5 text-xs text-[#676b7a]">Pages that are not indexed are listed first</p>
          </div>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by URL or status…"
            aria-label="Filter by URL or status"
            className="w-full rounded-lg border border-[#e7e9ee] px-3 py-1.5 text-sm text-[#2b303b] outline-none focus:border-[#1f4693]/50 sm:w-64"
          />
        </div>

        <div className="mt-3 overflow-x-auto">
          {pages.length === 0 ? (
            <p className="mt-4 text-sm text-[#676b7a]">No URLs match.</p>
          ) : (
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#e7e9ee] text-xs font-semibold uppercase tracking-wide text-[#9aa0ac]">
                  <th className="py-2 pr-3 font-semibold">URL</th>
                  <th className="py-2 px-3 font-semibold">Coverage state</th>
                  <th className="py-2 pl-3 text-right font-semibold">Last crawl</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((page) => (
                  <tr key={page.url} className="border-b border-[#e7e9ee] last:border-0">
                    <td className="py-2.5 pr-3 text-[#2b303b]">
                      <a href={page.url} target="_blank" rel="noreferrer" className="hover:text-[#1f4693] hover:underline">
                        {pathOf(page.url)}
                      </a>
                    </td>
                    <td className="py-2.5 px-3 font-medium" style={{ color: VERDICT_COLORS[page.verdict] ?? "#d9650a" }} title={page.error}>
                      {page.coverageState}
                    </td>
                    <td className="py-2.5 pl-3 text-right text-[#676b7a]">{formatDate(page.lastCrawlTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
