"use client";

import {
  Search,
  AlertTriangle,
  CheckCircle2,
  Map,
  ShieldCheck,
  Globe,
  Newspaper,
  Briefcase,
} from "lucide-react";

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
      <p className="mt-3 text-3xl font-bold tracking-tight text-[#2b303b]">{value}</p>
    </div>
  );
}

function FeatureChecklist({ features }) {
  return (
    <div className="rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-[#2b303b]">What's implemented</h2>
      <p className="mt-0.5 text-xs text-[#676b7a]">
        SEO features currently built into the site, with the file that implements each one.
      </p>

      <div className="mt-4 flex flex-col gap-5">
        {features.map((group) => (
          <div key={group.category}>
            <p className="text-xs font-bold uppercase tracking-wide text-[#9aa0ac]">
              {group.category}
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {group.items.map((item) => (
                <li key={item.label} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-[#3b6d11]"
                    aria-hidden="true"
                  />
                  <span>
                    <span className="text-[#2b303b]">{item.label}</span>
                    <code className="ml-2 rounded bg-[#fafbfc] px-1.5 py-0.5 text-[11px] text-[#676b7a]">
                      {item.path}
                    </code>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SeoAuditManager({ audit, features }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5 text-[#f7941e]" aria-hidden="true" />
          <h1 className="text-2xl font-bold tracking-tight text-[#2b303b]">SEO</h1>
        </div>
        <p className="mt-1 text-sm text-[#676b7a]">
          Technical SEO status for this site — real checks against the live sitemap, robots
          rules, and content, not sample data. For search rankings and click performance, see{" "}
          <span className="font-semibold text-[#2b303b]">Search Console</span> instead.
        </p>
      </div>

      {audit.isPlaceholderDomain ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-semibold text-red-800">Placeholder domain still in use</p>
            <p className="mt-1 text-red-700">
              <code className="rounded bg-red-100 px-1.5 py-0.5 text-[13px]">NEXT_PUBLIC_SITE_URL</code>{" "}
              is currently set to <code className="rounded bg-red-100 px-1.5 py-0.5 text-[13px]">{audit.siteUrl}</code> — a
              guess, not the confirmed real domain. Every sitemap URL, canonical tag, and Open
              Graph link below is built from this one value. Update it in{" "}
              <code className="rounded bg-red-100 px-1.5 py-0.5 text-[13px]">.env.local</code> once
              the real production domain is confirmed and everything downstream updates
              automatically.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl border border-[#3b6d11]/25 bg-[#3b6d11]/5 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#3b6d11]" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-semibold text-[#2b6b11]">Real domain configured</p>
            <p className="mt-1 text-[#2b303b]">
              <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">NEXT_PUBLIC_SITE_URL</code> is
              set to <code className="rounded bg-white px-1.5 py-0.5 text-[13px]">{audit.siteUrl}</code>.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatPill icon={Map} label="URLs in sitemap.xml" value={audit.sitemapUrlCount} accent="#1f4693" />
        <StatPill icon={ShieldCheck} label="Paths disallowed" value={audit.robotsDisallow.length} accent="#f7941e" />
        <StatPill icon={Newspaper} label="Published blog posts" value={audit.publishedBlogPosts} accent="#7c3aed" />
        <StatPill icon={Briefcase} label="Open job postings" value={audit.openJobPostings} accent="#3b6d11" />
      </div>

      <div className="rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[#2b303b]">robots.txt rules</h2>
        <p className="mt-0.5 text-xs text-[#676b7a]">Read live from src/app/robots.js</p>

        <div className="mt-4 flex flex-col gap-2 text-sm">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-[#3b6d11]" aria-hidden="true" />
            <span className="text-[#2b303b]">Allow:</span>
            <code className="rounded bg-[#fafbfc] px-2 py-0.5 text-[#676b7a]">{audit.robotsAllow}</code>
          </div>
          {audit.robotsDisallow.map((path) => (
            <div key={path} className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#dc2626]" aria-hidden="true" />
              <span className="text-[#2b303b]">Disallow:</span>
              <code className="rounded bg-[#fafbfc] px-2 py-0.5 text-[#676b7a]">{path}</code>
            </div>
          ))}
        </div>
      </div>

      <FeatureChecklist features={features} />
    </div>
  );
}
