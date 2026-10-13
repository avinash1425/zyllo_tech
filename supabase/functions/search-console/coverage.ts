// Index-coverage helpers for search-console, kept free of Deno and network
// code so they can be unit tested (tests/search-console-coverage.test.mjs).

// One run inspects at most this many URLs. Google allows 2,000 inspections a
// day per property, shared by everyone who runs the check.
export const INSPECT_MAX_URLS = 100;

export function parseSitemap(xml: string, max = INSPECT_MAX_URLS) {
  const found = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  const all = [...new Set(found)];
  return { urls: all.slice(0, max), total: all.length, truncated: all.length > max };
}

export type ErrorCode = "quota" | "auth" | "timeout" | "other";

// Google reports an exhausted quota as 429, or as 403 with a quota reason, so
// the body is checked before the status is read as a permission problem.
export function classifyError(status: number | undefined, details: string): ErrorCode {
  if (status === 429 || /quota|rate.?limit|resource_exhausted/i.test(details)) return "quota";
  if (status === 401 || status === 403) return "auth";
  if (/timed? ?out|timeout|abort/i.test(details)) return "timeout";
  return "other";
}

export const ERROR_LABELS: Record<ErrorCode | "skipped", string> = {
  quota: "Quota reached",
  auth: "Not authorized",
  timeout: "Timed out",
  other: "Check failed",
  skipped: "Not checked",
};

export function summarize(pages: { verdict: string }[]) {
  return {
    tracked: pages.length,
    indexed: pages.filter((p) => p.verdict === "PASS").length,
    notIndexed: pages.filter((p) => p.verdict !== "PASS" && p.verdict !== "ERROR").length,
    errors: pages.filter((p) => p.verdict === "ERROR").length,
  };
}

// The API orders by clicks only and returns tied rows alphabetically. Rank
// the way the Search Console UI does: clicks, then impressions.
export function rankRows<T extends { clicks: number; impressions: number }>(rows: T[], limit: number) {
  return [...rows].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, limit);
}
