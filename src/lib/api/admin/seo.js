import { supabase } from "@/lib/supabase/client";

// Real checks computed by the admin-only "seo-audit" Edge Function.
// Response: { siteUrl, isPlaceholderDomain, sitemapUrlCount, robotsDisallow,
//             robotsAllow, publishedBlogPosts, openJobPostings }
export async function fetchSeoAudit() {
  const { data, error } = await supabase.functions.invoke("seo-audit");
  if (error) throw error;
  return data;
}

// Static checklist of SEO features implemented in the codebase (not
// self-verifying — update manually if one is removed or changed).
export const IMPLEMENTED_FEATURES = [
  {
    category: "Root metadata",
    items: [
      { label: "metadataBase, title template, keywords", path: "src/components/Seo.jsx", done: true },
      { label: "Open Graph + Twitter Card defaults", path: "src/components/Seo.jsx", done: true },
      { label: "Site-wide robots: index, follow default", path: "src/components/Seo.jsx", done: true },
      { label: "Organization JSON-LD", path: "src/components/OrganizationJsonLd.jsx", done: true },
    ],
  },
  {
    category: "Discovery",
    items: [
      { label: "Dynamic sitemap.xml (static + services + blog + careers)", path: "sitemap", done: true },
      { label: "robots.txt with /admin, /login, /api disallowed", path: "public/robots.txt", done: true },
    ],
  },
  {
    category: "Page-level metadata",
    items: [
      { label: "Homepage title + canonical", path: "src/pages/Home.jsx", done: true },
      { label: "Blog post: canonical, OG article type, Article JSON-LD", path: "src/pages/BlogPost.jsx", done: true },
      { label: "Job posting: canonical, OG, JobPosting JSON-LD", path: "src/pages/CareerDetail.jsx", done: true },
    ],
  },
  {
    category: "Indexing control",
    items: [
      { label: "/admin noindex, nofollow", path: "src/admin/AdminRoutes.jsx", done: true },
      { label: "/login noindex, nofollow", path: "src/pages/Login.jsx", done: true },
    ],
  },
];
