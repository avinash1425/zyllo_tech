// Single source of truth for SEO-related site facts — sitemap.js,
// robots.js, root layout metadata, and any JSON-LD structured data all
// import from here instead of hardcoding these values in multiple places.
//
// SITE_URL can be overridden with VITE_SITE_URL; it defaults to the live
// production domain so every SEO artifact (sitemap, canonical tags, OG links,
// JSON-LD) stays consistent.
export const SITE_URL = (
  import.meta.env.VITE_SITE_URL || "https://www.zyllotech.com"
).replace(/\/$/, "");

export const SITE_NAME = "Zyllo Tech";

// Full legal name as it appears on the company's own logo artwork
// (public/zyllo-logo.png) — used for Organization structured data.
export const LEGAL_NAME = "Zyllo Tech Software Solutions Private Limited";

export const DEFAULT_DESCRIPTION =
  "Zyllo Tech builds custom software, mobile apps, and AI-powered digital products for ambitious companies. Explore our services, portfolio, and careers.";

export const OG_IMAGE_PATH = "/zyllo-logo.png";
