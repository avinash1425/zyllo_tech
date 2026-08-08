import { SITE_URL } from "@/lib/site-config";

// Next.js file convention — this generates /robots.txt automatically.
// /admin and /login are login-gated (or login itself), not content
// anyone should land on from search; /api is data endpoints, not pages.
export default function robots() {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/login", "/api"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
