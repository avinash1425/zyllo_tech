import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Globe, RefreshCw } from "lucide-react";
import AdminLoading from "../AdminLoading";
import PageHeader from "../PageHeader";
import { getIndexCoverage } from "@/lib/api/admin/searchConsole";
import {
  cooldownRemainingMs,
  isSuccessfulCheck,
  loadLastRunAt,
  loadSavedCheck,
  recordRun,
  saveCheck,
} from "@/lib/api/admin/indexCoverageCache";

// These count the sitemap URLs this check inspected, not Search Console's
// Page indexing totals, which also cover URLs outside the sitemap.
const STAT_CARDS = [
  { key: "tracked", label: "Sitemap URLs inspected", icon: Globe, accent: "#1f4693" },
  { key: "indexed", label: "Indexed (of inspected)", icon: CheckCircle2, accent: "#3089a6" },
  { key: "notIndexed", label: "Not indexed (of inspected)", icon: Clock, accent: "#f7941e" },
  { key: "errors", label: "Check errors", icon: AlertTriangle, accent: "#dc2626" },
];

const STOPPED_EARLY = {
  quota: {
    title: "Google's inspection quota is used up",
    text: "Google stopped answering because the URL Inspection quota for this property (2,000 a day) has been reached. The remaining URLs were not checked. Try again tomorrow.",
  },
  auth: {
    title: "Google refused the inspection requests",
    text: "The Search Console connection is not allowed to inspect URLs for this property. The remaining URLs were not checked. Reconnect Google Search Console, then run the check again.",
  },
};

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

function Notice({ title, children }) {
  return (
    <div className="rounded-2xl border border-[#e7e9ee] bg-white p-6 text-sm text-[#2b303b] shadow-sm">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-[#676b7a]">{children}</p>
    </div>
  );
}

function RunButton({ onRun, running, waitMinutes, primary = false }) {
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={running || waitMinutes > 0}
      title={waitMinutes > 0 ? `Available again in ${waitMinutes} min` : undefined}
      className={
        primary
          ? "mt-4 inline-flex items-center gap-2 rounded-full bg-[#1f4693] px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          : "inline-flex items-center gap-2 rounded-full border border-[#e7e9ee] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#676b7a] transition-colors duration-200 hover:border-[#1f4693]/40 hover:text-[#1f4693] disabled:cursor-not-allowed disabled:opacity-60"
      }
    >
      <RefreshCw className={`h-3.5 w-3.5 ${running ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
      {running ? "Checking…" : waitMinutes > 0 ? `Run check (in ${waitMinutes} min)` : "Run check"}
    </button>
  );
}

function BrowserOnlyNote() {
  return (
    <p className="text-xs leading-relaxed text-[#676b7a]">
      Results are saved in this browser, and a new check can be run from it once an hour. That limit applies to this
      browser only: other admins and other browsers can still run checks, and they all share Google&apos;s quota of
      2,000 URL inspections a day.
    </p>
  );
}

/** Google's index status for the sitemap URLs, checked only when an admin asks. */
export default function AdminIndexCoveragePage() {
  // Opening the page never calls Google: it shows the result saved in this
  // browser. Inspections run only from the "Run check" button.
  const [data, setData] = useState(() => loadSavedCheck());
  const [lastRunAt, setLastRunAt] = useState(() => loadLastRunAt());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [problem, setProblem] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const waitMinutes = Math.ceil(cooldownRemainingMs(lastRunAt, now) / 60_000);

  const runCheck = useCallback(async () => {
    // Re-read the stored time so a check started in another tab also counts.
    if (running || cooldownRemainingMs(loadLastRunAt(), Date.now()) > 0) return;
    setRunning(true);
    setError(null);
    setProblem(null);
    try {
      const result = await getIndexCoverage();
      if (result?.status === "ok" && result.pages) {
        // Google was asked, so the hour starts even if some checks failed.
        const at = Date.now();
        recordRun(at);
        setLastRunAt(at);
        setNow(at);
        if (isSuccessfulCheck(result)) {
          saveCheck(result);
          setData(result);
        } else {
          setProblem({ kind: "failed", result });
        }
      } else {
        setProblem({ kind: result?.status === "ok" ? "not_deployed" : "not_ready", result });
      }
    } catch (e) {
      console.error("Index check failed:", e?.message || e);
      setError(e);
    } finally {
      setRunning(false);
    }
  }, [running]);

  const pages = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = data?.pages ?? [];
    // Problems first, so pages that need attention are at the top.
    const sorted = [...all].sort((a, b) => (a.verdict === "PASS") - (b.verdict === "PASS") || a.url.localeCompare(b.url));
    return needle ? sorted.filter((p) => p.url.toLowerCase().includes(needle) || p.coverageState.toLowerCase().includes(needle)) : sorted;
  }, [data, filter]);

  if (running && !data) return <AdminLoading label="Asking Google about each page…" />;

  const header = (subtitle, actions) => (
    <PageHeader icon={Globe} title="Index Coverage" subtitle={subtitle} actions={actions} />
  );

  let notice = null;
  if (error) {
    notice = <Notice title="The index check failed">{error.message}</Notice>;
  } else if (problem?.kind === "not_ready") {
    notice = (
      <Notice title="Google Search Console is not ready">
        {problem.result?.status === "selection_required"
          ? "Choose which Search Console property to use on the Search Console page first."
          : problem.result?.message}
      </Notice>
    );
  } else if (problem?.kind === "not_deployed") {
    // An older deployed function ignores the index-coverage mode and returns
    // search performance instead.
    notice = (
      <Notice title="The index check is not deployed yet">
        Publish the site so the updated search-console function is deployed, then run the check again.
      </Notice>
    );
  } else if (problem?.kind === "failed") {
    const stopped = STOPPED_EARLY[problem.result.stoppedEarly];
    notice = stopped ? (
      <Notice title={stopped.title}>{stopped.text}</Notice>
    ) : problem.result.totals.tracked === 0 ? (
      <Notice title="The sitemap has no URLs to check">No page URLs were found in the live sitemap.</Notice>
    ) : (
      <Notice title="Google did not answer any of the checks">
        Every URL inspection failed, so the Search Console connection may not allow URL inspection. First error:{" "}
        {problem.result.pages.find((p) => p.error)?.error}
      </Notice>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        {header("No check has been run in this browser yet")}
        {notice}
        <div className="rounded-2xl border border-[#e7e9ee] bg-white p-6 text-sm text-[#2b303b] shadow-sm">
          <p className="font-semibold">Check the sitemap URLs with Google</p>
          <p className="mt-1 text-[#676b7a]">
            This asks Google&apos;s URL Inspection tool about each URL in the sitemap (up to 100 per run). Nothing is
            sent to Google until you press the button.
          </p>
          <RunButton onRun={runCheck} running={running} waitMinutes={waitMinutes} primary />
          <div className="mt-4">
            <BrowserOnlyNote />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header(
        <>
          Saved result for the sitemap URLs · checked {new Date(data.checkedAt).toLocaleString("en-IN")}
        </>,
        <RunButton onRun={runCheck} running={running} waitMinutes={waitMinutes} />,
      )}

      {notice}

      {data.truncated && (
        <p className="-mt-2 rounded-lg border border-[#f7941e]/25 bg-[#fff7ed] px-3.5 py-2 text-xs leading-relaxed text-[#a85a00]">
          The sitemap lists {data.sitemapTotal} URLs, but one run inspects at most {data.maxUrls}. Only the first{" "}
          {data.maxUrls} are shown here.
        </p>
      )}

      <div className="-mt-2 rounded-lg border border-[#e7e9ee] bg-[#fafbfc] px-3.5 py-2.5">
        <p className="text-xs leading-relaxed text-[#676b7a]">
          These figures cover only the sitemap URLs inspected here. Search Console&apos;s Page indexing report also
          counts URLs outside the sitemap, so its indexed and not indexed totals are usually higher and will not match.
        </p>
        <div className="mt-1.5">
          <BrowserOnlyNote />
        </div>
      </div>

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
