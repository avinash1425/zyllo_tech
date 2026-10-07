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

export async function getSearchConsolePerformance(range) {
  const { data, error } = await supabase.functions.invoke("search-console", {
    body: { range, siteUrl: getSavedSiteUrl() },
  });
  if (error) {
    let details = error.message;
    try { details = (await error.context?.text?.()) || details; } catch { /* ignore */ }
    throw new Error(details);
  }
  return data;
}
