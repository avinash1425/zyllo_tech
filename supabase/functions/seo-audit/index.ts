// seo-audit: ADMIN ONLY. GET or POST (no body needed) ->
// { siteUrl, isPlaceholderDomain, sitemapUrlCount, robotsDisallow,
//   robotsAllow, publishedBlogPosts, openJobPostings }
// Port of getSeoAudit() in src/app/admin/seo/page.js. The caller's JWT must
// belong to a row in public.admin_users.
import { json, preflight } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { SERVICES } from "../_shared/services.ts";

const PLACEHOLDER_DOMAIN = "https://www.zyllotech.com";
const STATIC_ROUTE_COUNT = 10; // keep equal to STATIC_ROUTES in ../sitemap/index.ts
// Keep equal to public/robots.txt
const ROBOTS_ALLOW = "/";
const ROBOTS_DISALLOW = ["/admin", "/login", "/api"];

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const supabase = await requireAdmin(req);
  if (!supabase) return json(req, { error: "Forbidden" }, 403);

  const siteUrl = (Deno.env.get("SITE_URL") || "https://zyllotech.com").replace(/\/+$/, "");

  const [posts, jobs] = await Promise.all([
    supabase.from("blog_posts").select("id", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("job_postings").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);

  const publishedBlogPosts = posts.count ?? 0;
  const openJobPostings = jobs.count ?? 0;

  return json(req, {
    siteUrl,
    isPlaceholderDomain: siteUrl === PLACEHOLDER_DOMAIN,
    sitemapUrlCount: STATIC_ROUTE_COUNT + SERVICES.length + publishedBlogPosts + openJobPostings,
    robotsDisallow: ROBOTS_DISALLOW,
    robotsAllow: ROBOTS_ALLOW,
    publishedBlogPosts,
    openJobPostings,
  });
});
