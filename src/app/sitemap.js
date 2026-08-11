import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SERVICES } from "@/data/services";
import { SITE_URL } from "@/lib/site-config";

// Static, always-present public routes. /admin and /login are
// deliberately excluded — see robots.js for the matching disallow rules.
const STATIC_ROUTES = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/about", priority: 0.8, changeFrequency: "monthly" },
  { path: "/services", priority: 0.9, changeFrequency: "monthly" },
  { path: "/industries", priority: 0.7, changeFrequency: "monthly" },
  { path: "/portfolio", priority: 0.7, changeFrequency: "weekly" },
  { path: "/blog", priority: 0.8, changeFrequency: "daily" },
  { path: "/careers", priority: 0.7, changeFrequency: "weekly" },
  { path: "/contact", priority: 0.6, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
];

// This route runs at BUILD time, so anything it throws fails the whole
// deploy — not just this one URL. When the Supabase credentials are
// missing from the build environment, createServerSupabaseClient()
// throws from the constructor ("Your project's URL and Key are
// required"), which is *before* the `if (error)` checks below can catch
// anything. So each helper is wrapped: a broken/absent backend degrades
// the sitemap to its static routes instead of taking the build down.
// The env vars still need to be set for the site to actually work — this
// guard only stops a config problem from masquerading as a build error.
async function getPublishedBlogSlugs() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("blog_posts")
      .select("slug, created_at")
      .eq("status", "published");

    if (error) {
      console.error("sitemap: failed to load blog posts:", error.message);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error("sitemap: skipping blog posts —", err.message);
    return [];
  }
}

async function getOpenJobIds() {
  try {
    const supabase = await createServerSupabaseClient();
    // job_postings has no updated_at column (confirmed against every other
    // query in the codebase that touches this table) — created_at is the
    // only real timestamp available.
    const { data, error } = await supabase
      .from("job_postings")
      .select("id, created_at")
      .eq("status", "open");

    if (error) {
      console.error("sitemap: failed to load job postings:", error.message);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error("sitemap: skipping job postings —", err.message);
    return [];
  }
}

export default async function sitemap() {
  const [blogPosts, openJobs] = await Promise.all([
    getPublishedBlogSlugs(),
    getOpenJobIds(),
  ]);

  const staticEntries = STATIC_ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
  }));

  const serviceEntries = SERVICES.map((service) => ({
    url: `${SITE_URL}/services/${service.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  const blogEntries = blogPosts.map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: post.created_at ? new Date(post.created_at) : new Date(),
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  const jobEntries = openJobs.map((job) => ({
    url: `${SITE_URL}/careers/${job.id}`,
    lastModified: job.created_at ? new Date(job.created_at) : new Date(),
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  return [...staticEntries, ...serviceEntries, ...blogEntries, ...jobEntries];
}
