// sitemap: public. GET -> application/xml sitemap (port of src/app/sitemap.js).
// Reads published blog_posts + open job_postings through the ANON key, so
// RLS guarantees only public rows are included. Secrets: none.
// Optional secret: SITE_URL (default https://zyllotech.com).
import { corsHeaders, preflight } from "../_shared/cors.ts";
import { anonClient } from "../_shared/auth.ts";
import { SERVICES } from "../_shared/services.ts";

// /admin and /login deliberately excluded (see public/robots.txt).
const STATIC_ROUTES = [
  { path: "/", priority: 1.0, changefreq: "weekly" },
  { path: "/about", priority: 0.8, changefreq: "monthly" },
  { path: "/services", priority: 0.9, changefreq: "monthly" },
  { path: "/industries", priority: 0.7, changefreq: "monthly" },
  { path: "/portfolio", priority: 0.7, changefreq: "weekly" },
  { path: "/blog", priority: 0.8, changefreq: "daily" },
  { path: "/careers", priority: 0.7, changefreq: "weekly" },
  { path: "/contact", priority: 0.6, changefreq: "yearly" },
  { path: "/privacy", priority: 0.2, changefreq: "yearly" },
  { path: "/terms", priority: 0.2, changefreq: "yearly" },
];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders(req) });
  }

  const site = (Deno.env.get("SITE_URL") || "https://zyllotech.com").replace(/\/+$/, "");
  const supabase = anonClient();
  const today = new Date().toISOString();

  const [posts, jobs] = await Promise.all([
    supabase.from("blog_posts").select("slug, created_at").eq("status", "published"),
    supabase.from("job_postings").select("id, created_at").eq("status", "open"),
  ]);
  if (posts.error) console.error("sitemap: blog_posts:", posts.error.message);
  if (jobs.error) console.error("sitemap: job_postings:", jobs.error.message);

  type Entry = { loc: string; lastmod: string; changefreq: string; priority: number };
  const entries: Entry[] = [
    ...STATIC_ROUTES.map((r) => ({ loc: `${site}${r.path}`, lastmod: today, changefreq: r.changefreq, priority: r.priority })),
    ...SERVICES.map((s) => ({ loc: `${site}/services/${s.slug}`, lastmod: today, changefreq: "monthly", priority: 0.7 })),
    ...(posts.data ?? []).map((p) => ({ loc: `${site}/blog/${p.slug}`, lastmod: p.created_at ?? today, changefreq: "monthly", priority: 0.6 })),
    ...(jobs.data ?? []).map((j) => ({ loc: `${site}/careers/${j.id}`, lastmod: j.created_at ?? today, changefreq: "weekly", priority: 0.5 })),
  ];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries
      .map(
        (e) =>
          `  <url><loc>${esc(e.loc)}</loc><lastmod>${new Date(e.lastmod).toISOString()}</lastmod>` +
          `<changefreq>${e.changefreq}</changefreq><priority>${e.priority.toFixed(1)}</priority></url>`,
      )
      .join("\n") +
    `\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=900, s-maxage=3600",
    },
  });
});
