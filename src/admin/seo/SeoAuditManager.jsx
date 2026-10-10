
import { Fragment, useState } from "react";
import PageHeader from "../PageHeader";
import {
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  HelpCircle,
  Map,
  ShieldCheck,
  Globe,
  Newspaper,
  Briefcase,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Play,
} from "lucide-react";
import { runRenderedAudit } from "@/lib/api/admin/seo";
import { FIELD_LABELS, countLevels, worstLevel } from "@/lib/seo/audit-core";

const LEVEL_STYLE = {
  pass: { icon: CheckCircle2, color: "#3089a6", label: "OK" },
  info: { icon: Info, color: "#9aa0ac", label: "Note" },
  warn: { icon: AlertTriangle, color: "#d9650a", label: "Warning" },
  error: { icon: XCircle, color: "#dc2626", label: "Issue" },
  unverified: { icon: HelpCircle, color: "#9aa0ac", label: "Not verified" },
};

const KIND_LABELS = { page: "Page", service: "Service", blog: "Blog post", job: "Job posting" };

function StatPill({ icon: Icon, label, value, accent }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-[#e7e9ee] p-5 shadow-sm"
      style={{ background: `linear-gradient(150deg, ${accent}14, ${accent}05 55%, transparent)` }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-[#676b7a]">{label}</p>
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${accent}18` }}
        >
          <Icon className="h-4 w-4" style={{ color: accent }} aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight text-[#2b303b]">{value ?? "—"}</p>
    </div>
  );
}

function CheckList({ checks }) {
  return (
    <ul className="flex flex-col gap-2">
      {checks.map((check, i) => {
        const style = LEVEL_STYLE[check.level];
        const Icon = style.icon;
        return (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: style.color }} aria-hidden="true" />
            <span className="min-w-0 break-words text-[#2b303b]">
              <span className="sr-only">{style.label}: </span>
              {check.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function PathList({ title, paths }) {
  if (paths.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-bold uppercase tracking-wide text-[#9aa0ac]">
        {title} ({paths.length})
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {paths.map((path) => (
          <code key={path} className="rounded bg-[#fafbfc] px-2 py-0.5 text-xs text-[#676b7a]">
            {path}
          </code>
        ))}
      </div>
    </div>
  );
}

// Compact status for one page under one source (raw or rendered).
function StatusBadge({ checks, fallback }) {
  if (!checks || checks.length === 0) {
    return <span className="text-xs text-[#9aa0ac]">{fallback}</span>;
  }
  const counts = countLevels(checks);
  const level = worstLevel(checks);
  const style = LEVEL_STYLE[level];
  const Icon = style.icon;
  const text =
    level === "error"
      ? `${counts.error} issue${counts.error === 1 ? "" : "s"}`
      : level === "warn"
        ? `${counts.warn} warning${counts.warn === 1 ? "" : "s"}`
        : level === "unverified"
          ? `${counts.unverified} not verified`
          : "OK";
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: style.color }}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {text}
    </span>
  );
}

function FieldCell({ check, empty }) {
  if (!check) return <span className="text-xs text-[#9aa0ac]">{empty}</span>;
  const style = LEVEL_STYLE[check.level];
  const Icon = style.icon;
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: style.color }} aria-hidden="true" />
      <div className="min-w-0">
        {check.value && <p className="break-words text-xs font-medium text-[#2b303b]">{check.value}</p>}
        <p className="break-words text-xs text-[#676b7a]">{check.message}</p>
      </div>
    </div>
  );
}

function PageDetail({ page, rendered }) {
  const renderedEmpty = !page.renderable
    ? "Not rendered: opening this page records a view."
    : rendered?.error || "Not run yet.";
  return (
    <div className="rounded-xl bg-[#fafbfc] p-3">
      {page.raw.redirectedTo && (
        <p className="mb-2 text-xs text-[#d9650a]">Redirects to {page.raw.redirectedTo}</p>
      )}
      <table className="w-full table-fixed text-left">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-[#9aa0ac]">
            <th className="w-32 py-1.5 pr-3 font-semibold">Check</th>
            <th className="py-1.5 pr-3 font-semibold">Raw HTML</th>
            <th className="py-1.5 font-semibold">After JavaScript</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(FIELD_LABELS).map(([field, label]) => (
            <tr key={field} className="border-t border-[#e7e9ee] align-top">
              <td className="py-2 pr-3 text-xs font-semibold text-[#2b303b]">{label}</td>
              <td className="py-2 pr-3">
                <FieldCell
                  check={page.raw.checks.find((c) => c.field === field)}
                  empty={page.raw.error || "Not checked."}
                />
              </td>
              <td className="py-2">
                <FieldCell check={rendered?.checks.find((c) => c.field === field)} empty={renderedEmpty} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PageRow({ page, rendered }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  const httpOk = page.raw.status === 200;
  return (
    <Fragment>
      <tr className="border-b border-[#e7e9ee] last:border-0">
        <td className="py-2.5 pr-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex min-w-0 items-start gap-1.5 text-left"
          >
            <Chevron className="mt-0.5 h-4 w-4 shrink-0 text-[#9aa0ac]" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block break-all text-sm text-[#2b303b]">{page.path}</span>
              <span className="block text-xs text-[#9aa0ac]">
                {KIND_LABELS[page.kind]} · {page.label}
              </span>
            </span>
          </button>
        </td>
        <td className="py-2.5 px-3 text-xs" style={{ color: httpOk ? "#676b7a" : "#dc2626" }}>
          {page.raw.status ?? "No response"}
        </td>
        <td className="py-2.5 px-3 text-xs text-[#676b7a]">
          {page.inSitemap == null ? "—" : page.inSitemap ? "Yes" : <span className="text-[#d9650a]">No</span>}
        </td>
        <td className="py-2.5 px-3">
          <StatusBadge checks={page.raw.checks} fallback={page.raw.error || "—"} />
        </td>
        <td className="py-2.5 pl-3">
          <StatusBadge
            checks={rendered?.checks}
            fallback={!page.renderable ? "Skipped" : rendered?.error ? "Could not verify" : "Not run"}
          />
        </td>
      </tr>
      {open && (
        <tr className="border-b border-[#e7e9ee] last:border-0">
          <td colSpan={5} className="pb-3">
            <PageDetail page={page} rendered={rendered} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// "n of m pages" for one metadata field under one source.
function Coverage({ lists, field }) {
  if (lists.length === 0) return <span className="text-[#9aa0ac]">Not run</span>;
  const found = lists.map((checks) => checks.find((c) => c.field === field));
  // Unverified results are left out of the count rather than shown as failures.
  const levels = found.filter((c) => c.level !== "unverified").map((c) => c.level);
  if (levels.length === 0) {
    const UnverifiedIcon = LEVEL_STYLE.unverified.icon;
    return (
      <span className="inline-flex items-start gap-1.5 text-[#676b7a]">
        <UnverifiedIcon
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: LEVEL_STYLE.unverified.color }}
          aria-hidden="true"
        />
        {found[0].message}
      </span>
    );
  }
  const ok = levels.filter((l) => l === "pass" || l === "info").length;
  const errors = levels.filter((l) => l === "error").length;
  const level = errors ? "error" : ok === levels.length ? "pass" : "warn";
  const style = LEVEL_STYLE[level];
  const Icon = style.icon;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-4 w-4 shrink-0" style={{ color: style.color }} aria-hidden="true" />
      <span className="text-[#2b303b]">
        {ok} of {levels.length} pages
      </span>
    </span>
  );
}

function MetadataCoverage({ pages, rendered }) {
  const rawLists = pages.filter((p) => p.raw.checks.length).map((p) => p.raw.checks);
  const renderedLists = Object.values(rendered || {})
    .filter((r) => r.checks.length)
    .map((r) => r.checks);
  const couldNotVerify = Object.values(rendered || {}).filter((r) => r.error).length;

  return (
    <div className="rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-[#2b303b]">What's verified</h2>
      <p className="mt-0.5 text-xs text-[#676b7a]">
        Pages where each tag is present and correct. Raw HTML is what crawlers that do not run
        JavaScript receive (most AI assistants and social link previews). After JavaScript is what
        a browser, and Google's renderer, ends up with.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead>
            <tr className="border-b border-[#e7e9ee] text-xs font-semibold uppercase tracking-wide text-[#9aa0ac]">
              <th className="py-2 pr-3 font-semibold">Check</th>
              <th className="py-2 px-3 font-semibold">Raw HTML</th>
              <th className="py-2 pl-3 font-semibold">After JavaScript</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(FIELD_LABELS).map(([field, label]) => (
              <tr key={field} className="border-b border-[#e7e9ee] last:border-0">
                <td className="py-2.5 pr-3 text-[#2b303b]">{label}</td>
                <td className="py-2.5 px-3">
                  <Coverage lists={rawLists} field={field} />
                </td>
                <td className="py-2.5 pl-3">
                  <Coverage lists={renderedLists} field={field} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {couldNotVerify > 0 && (
        <p className="mt-3 text-xs text-[#676b7a]">
          {couldNotVerify} page{couldNotVerify === 1 ? "" : "s"} could not be verified after
          JavaScript because {couldNotVerify === 1 ? "it" : "they"} did not finish rendering in
          time, and {couldNotVerify === 1 ? "is" : "are"} left out of these counts. Run the
          rendered check again and keep this tab open in front while it runs.
        </p>
      )}
    </div>
  );
}

export default function SeoAuditManager({ audit, onReload }) {
  const [rendered, setRendered] = useState(null);
  const [progress, setProgress] = useState(null);
  const [reloading, setReloading] = useState(false);
  const rendering = progress !== null;
  const renderableCount = audit.pages.filter((p) => p.renderable).length;
  const { comparison } = audit.sitemap;

  async function handleReload() {
    setReloading(true);
    setRendered(null);
    await onReload?.();
    setReloading(false);
  }

  async function handleRender() {
    setProgress({ done: 0, total: renderableCount });
    try {
      setRendered(await runRenderedAudit(audit.pages, setProgress));
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Search}
        title="SEO"
        subtitle={
          <>
            Technical SEO status measured from {audit.auditedOrigin}: its robots.txt, sitemap and
            page HTML are fetched each time this page loads. These checks show what the site
            serves, not whether Google has indexed it. For rankings and clicks, see{" "}
            <span className="font-semibold text-[#2b303b]">Search Console</span>.
          </>
        }
        actions={
          <button
            type="button"
            onClick={handleReload}
            disabled={reloading || rendering}
            aria-label="Run checks again"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#e7e9ee] bg-white text-[#676b7a] transition-colors duration-200 hover:border-[#1f4693]/40 hover:text-[#1f4693] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${reloading ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
          </button>
        }
      />

      {!audit.siteUrlConfigured ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-semibold text-red-800">Site URL is not configured</p>
            <p className="mt-1 text-red-700">
              <code className="rounded bg-red-100 px-1.5 py-0.5 text-[13px]">VITE_SITE_URL</code>{" "}
              is not set, so the site is using the built-in default{" "}
              <code className="rounded bg-red-100 px-1.5 py-0.5 text-[13px]">{audit.siteUrl}</code>.
              Every canonical tag and Open Graph link is built from this value. Set it to the real
              production domain.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl border border-[#3089a6]/25 bg-[#3089a6]/5 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#3089a6]" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-semibold text-[#216478]">Site URL configured</p>
            <p className="mt-1 text-[#2b303b]">
              <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">VITE_SITE_URL</code> is
              set to <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">{audit.siteUrl}</code>.
              Canonical and sitemap URLs are compared against it.
            </p>
          </div>
        </div>
      )}

      {!audit.auditingLiveSite && (
        <div className="flex items-start gap-3 rounded-2xl border border-[#f7941e]/25 bg-[#fff7ed] p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#d9650a]" aria-hidden="true" />
          <p className="text-sm text-[#a85a00]">
            <span className="font-semibold">Not the live site.</span> This admin is running on{" "}
            <code className="rounded bg-[#f7941e]/15 px-1 py-0.5 text-[13px]">{audit.auditedOrigin}</code>,
            so the results below describe this build, not {audit.siteUrl}. Open the admin on the
            live domain to check production.
            {audit.devBuild && (
              <>
                {" "}
                This is also a development build, which does not render the site&apos;s structured
                data, so JSON-LD cannot be verified here. Check it on a production build (
                <code className="rounded bg-[#f7941e]/15 px-1 py-0.5 text-[13px]">vite build</code>{" "}
                then{" "}
                <code className="rounded bg-[#f7941e]/15 px-1 py-0.5 text-[13px]">vite preview</code>
                ) or on the live website.
              </>
            )}
          </p>
        </div>
      )}

      {audit.expected.errors.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {audit.expected.errors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatPill icon={Map} label="URLs in sitemap.xml" value={audit.sitemap.urlCount} accent="#1f4693" />
        <StatPill
          icon={ShieldCheck}
          label="Paths disallowed"
          value={audit.robots.found ? audit.robots.disallow.length : null}
          accent="#f7941e"
        />
        <StatPill icon={Newspaper} label="Published blog posts" value={audit.expected.publishedBlogPosts} accent="#173a52" />
        <StatPill icon={Briefcase} label="Open job postings" value={audit.expected.openJobPostings} accent="#3089a6" />
      </div>

      <div className="rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[#2b303b]">robots.txt rules</h2>
        <p className="mt-0.5 break-all text-xs text-[#676b7a]">
          Read from {audit.robots.url} · rules for all crawlers (User-agent: *)
        </p>

        {audit.robots.found && (
          <div className="mt-4 flex flex-col gap-2 text-sm">
            {audit.robots.allow.map((path) => (
              <div key={`allow-${path}`} className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-[#3089a6]" aria-hidden="true" />
                <span className="text-[#2b303b]">Allow:</span>
                <code className="rounded bg-[#fafbfc] px-2 py-0.5 text-[#676b7a]">{path}</code>
              </div>
            ))}
            {audit.robots.disallow.map((path) => (
              <div key={`disallow-${path}`} className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[#dc2626]" aria-hidden="true" />
                <span className="text-[#2b303b]">Disallow:</span>
                <code className="rounded bg-[#fafbfc] px-2 py-0.5 text-[#676b7a]">{path}</code>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 border-t border-[#e7e9ee] pt-4">
          <CheckList checks={audit.robots.checks} />
        </div>
      </div>

      <div className="rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[#2b303b]">Sitemap</h2>
        <p className="mt-0.5 text-xs text-[#676b7a]">
          Compared with the {audit.expected.total} pages the site should expose:{" "}
          {audit.expected.staticCount} main pages, {audit.expected.serviceCount} services,{" "}
          {audit.expected.publishedBlogPosts ?? "?"} published blog posts and{" "}
          {audit.expected.openJobPostings ?? "?"} open job postings.
        </p>

        <div className="mt-4">
          <CheckList checks={audit.sitemap.checks} />
        </div>

        {audit.sitemap.readable && (
          <>
            <PathList title="Expected but not in the sitemap" paths={comparison.missing} />
            <PathList title="In the sitemap but not a known public page" paths={comparison.unexpected} />
            <PathList title="On a different host" paths={comparison.foreignHost} />
          </>
        )}
      </div>

      <MetadataCoverage pages={audit.pages} rendered={rendered} />

      <div className="rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[#2b303b]">Page checks</h2>
            <p className="mt-0.5 max-w-2xl text-xs text-[#676b7a]">
              Title, description, canonical, robots, Open Graph and JSON-LD for each expected page.
              Raw HTML is checked automatically. The rendered check loads {renderableCount} main and
              service pages in the background; blog posts and job pages are left out because
              opening them records a view.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRender}
            disabled={rendering || reloading || renderableCount === 0}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#f7941e] bg-[#f7941e] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors duration-200 hover:bg-[#d9650a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            {rendering
              ? `Rendering ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
              : rendered
                ? "Run rendered check again"
                : "Run rendered check"}
          </button>
        </div>

        {audit.pagesTruncated && (
          <p className="mt-3 text-xs text-[#d9650a]">
            Only the first {audit.pages.length} of {audit.expected.total} pages are checked here.
          </p>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#e7e9ee] text-xs font-semibold uppercase tracking-wide text-[#9aa0ac]">
                <th className="py-2 pr-3 font-semibold">Page</th>
                <th className="py-2 px-3 font-semibold">HTTP</th>
                <th className="py-2 px-3 font-semibold">In sitemap</th>
                <th className="py-2 px-3 font-semibold">Raw HTML</th>
                <th className="py-2 pl-3 font-semibold">After JavaScript</th>
              </tr>
            </thead>
            <tbody>
              {audit.pages.map((page) => (
                <PageRow key={page.path} page={page} rendered={rendered?.[page.path]} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
