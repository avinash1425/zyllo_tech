// Live Google Search Console data from the admin-only "search-console"
// Edge Function (read-only connection, credentials server-side only).
// Response status: "ok" | "not_connected" | "selection_required".
import { supabase } from "@/lib/supabase/client";

const SITE_KEY = "zyllo.gsc.siteUrl";

export function getSavedSiteUrl() {
  try { return localStorage.getItem(SITE_KEY) || undefined; } catch { return undefined; }
}

export function saveSiteUrl(siteUrl) {
  try { localStorage.setItem(SITE_KEY, siteUrl); } catch { /* ignore */ }
}

async function invoke(body) {
  const { data, error } = await supabase.functions.invoke("search-console", {
    body: { ...body, siteUrl: getSavedSiteUrl() },
  });
  if (error) {
    let details = error.message;
    try { details = (await error.context?.text?.()) || details; } catch { /* ignore */ }
    throw new Error(details);
  }
  return data;
}

export function getSearchConsolePerformance(range) {
  return invoke({ range });
}

// Google's index status for the URLs in the live sitemap (URL Inspection API).
// Every call spends inspection quota, one request per URL: call it only from
// an explicit admin action, never on page load.
export function getIndexCoverage() {
  return invoke({ mode: "index-coverage" });
}
