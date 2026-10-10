// Single source of truth for SEO-related site facts — sitemap.js,
// robots.js, root layout metadata, and any JSON-LD structured data all
// import from here instead of hardcoding these values in multiple places.
//
// SITE_URL is a PLACEHOLDER (see .env.local) until the real production
// domain is confirmed. Update VITE_SITE_URL there and every SEO
// artifact (sitemap, robots.txt, canonical tags, OG links) picks it up
// automatically — nothing else needs to change.
export const SITE_URL = (
  import.meta.env.VITE_SITE_URL || "https://www.zyllotech.com"
).replace(/\/$/, "");

export const SITE_NAME = "Zyllo Tech";

// Full legal name as it appears on the company's own logo artwork
// (public/zyllo-logo.png) — used for Organization structured data.
export const LEGAL_NAME = "Zyllo Tech Software Solutions Private Limited";

export const DEFAULT_DESCRIPTION =
  "Zyllo Tech is a custom software, web, mobile app and AI development company in India, delivering projects remotely to startups and businesses worldwide.";

// Homepage <title>. Also the static fallback <title> in index.html.
export const HOME_TITLE = "Custom Software & AI Development Company | Zyllo Tech";

export const OG_IMAGE_PATH = "/zyllo-logo.png";
