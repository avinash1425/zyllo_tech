import { SITE_URL } from "@/lib/site-config";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import SeoAuditManager from "./SeoAuditManager";

const PLACEHOLDER_DOMAIN = "https://www.zyllotech.com";

// Everything in this function is a REAL check against the live codebase —
// not sample data. It calls the actual sitemap()/robots() route handlers
// and counts their real output, and checks the real env-derived SITE_URL
// against the known placeholder value. This is the one admin page in the
// SEO section that shows genuinely verified facts rather than
// illustrative numbers.
async function getSeoAudit() {
  const [sitemapEntries, robotsConfig] = await Promise.all([
    sitemap(),
    Promise.resolve(robots()),
  ]);

  const isPlaceholderDomain = SITE_URL === PLACEHOLDER_DOMAIN;

  const supabase = createServerSupabaseClient();
  const [{ count: publishedPosts }, { count: openJobs }] = await Promise.all([
    supabase.from("blog_posts").select("id", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("job_postings").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);

  return {
    siteUrl: SITE_URL,
    isPlaceholderDomain,
    sitemapUrlCount: sitemapEntries.length,
    robotsDisallow: robotsConfig.rules.disallow,
    robotsAllow: robotsConfig.rules.allow,
    publishedBlogPosts: publishedPosts ?? 0,
    openJobPostings: openJobs ?? 0,
  };
}

// Static checklist of SEO features actually implemented in this codebase
// this session — file paths and behavior described accurately, but this
// list itself isn't computed by inspecting file contents at runtime
// (Next.js can't introspect "does this JSX render this component" from a
// server component). If one of these is later removed or changed, this
// list needs a matching manual update — it isn't self-verifying the way
// the sitemap/robots counts above are.
const IMPLEMENTED_FEATURES = [
  {
    category: "Root metadata",
    items: [
      { label: "metadataBase, title template, keywords", path: "src/app/layout.js", done: true },
      { label: "Open Graph + Twitter Card defaults", path: "src/app/layout.js", done: true },
      { label: "Site-wide robots: index, follow default", path: "src/app/layout.js", done: true },
      { label: "Organization JSON-LD", path: "src/components/OrganizationJsonLd.js", done: true },
    ],
  },
  {
    category: "Discovery",
    items: [
      { label: "Dynamic sitemap.xml (static + services + blog + careers)", path: "src/app/sitemap.js", done: true },
      { label: "robots.txt with /admin, /login, /api disallowed", path: "src/app/robots.js", done: true },
    ],
  },
  {
    category: "Page-level metadata",
    items: [
      { label: "Homepage title + canonical", path: "src/app/page.js", done: true },
      { label: "Blog post: canonical, OG article type, Article JSON-LD", path: "src/app/blog/[slug]/page.js", done: true },
      { label: "Job posting: canonical, OG, JobPosting JSON-LD", path: "src/app/careers/[id]/page.js", done: true },
    ],
  },
  {
    category: "Indexing control",
    items: [
      { label: "/admin noindex, nofollow", path: "src/app/admin/layout.js", done: true },
      { label: "/login noindex, nofollow", path: "src/app/login/layout.js", done: true },
    ],
  },
];

export default async function AdminSeoPage() {
  const audit = await getSeoAudit();
  return <SeoAuditManager audit={audit} features={IMPLEMENTED_FEATURES} />;
}
