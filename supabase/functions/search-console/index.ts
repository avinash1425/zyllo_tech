// search-console: ADMIN ONLY. GET/POST { range?: "7d"|"28d"|"3m"|"12m" } ->
// { timeSeries, totals, topQueries, topPages, topCountries, deviceBreakdown,
//   sitemaps, isSampleData }
// The Next version only ever returned clearly-labelled SAMPLE data
// (isSampleData: true). This port keeps that exact behaviour. To go live,
// add secrets GSC_SERVICE_ACCOUNT_JSON and GSC_SITE_URL and replace sample()
// with calls to the Search Analytics API (searchanalytics.query once per
// dimension query/page/country/device, plus sitemaps.list).
import { json, preflight } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";

const RANGE_DAYS: Record<string, number> = { "7d": 7, "28d": 28, "3m": 90, "12m": 365 };

function rng(seed: number) {
  let v = seed;
  return () => {
    v = (v * 9301 + 49297) % 233280;
    return v / 233280;
  };
}

function dailySeries(days: number) {
  const out = [];
  const today = new Date();
  const next = rng(days * 17);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const base = 18 + Math.sin((days - i) / 5) * 8 + next() * 6;
    const clicks = Math.max(0, Math.round(base));
    const impressions = Math.round(clicks * (18 + next() * 10));
    out.push({ date: d.toISOString().slice(0, 10), clicks, impressions });
  }
  return out;
}

function sample(range: string, site: string) {
  const days = RANGE_DAYS[range] ?? 28;
  const scale = days / 28;
  return {
    timeSeries: dailySeries(Math.min(days, 90)),
    totals: { clicks: Math.round(572 * scale), impressions: Math.round(12596 * scale), ctr: 4.54, avgPosition: 13.1 },
    topQueries: [
      { label: "zyllo tech", clicks: 45, impressions: 422, ctr: 10.66, position: 1.1 },
      { label: "custom software development company", clicks: 23, impressions: 137, ctr: 16.79, position: 5.1 },
      { label: "zyllo tech software solutions", clicks: 12, impressions: 75, ctr: 16.0, position: 1.3 },
      { label: "ai software development india", clicks: 11, impressions: 42, ctr: 26.19, position: 2.6 },
      { label: "mobile app development company", clicks: 10, impressions: 117, ctr: 8.55, position: 1.4 },
      { label: "zyllo tech careers", clicks: 8, impressions: 161, ctr: 4.97, position: 2.7 },
      { label: "software solutions provider", clicks: 6, impressions: 96, ctr: 6.25, position: 4.2 },
    ],
    topPages: [
      { label: `${site}/`, clicks: 210, impressions: 4890, ctr: 4.29, position: 6.8 },
      { label: `${site}/services`, clicks: 98, impressions: 2210, ctr: 4.43, position: 9.2 },
      { label: `${site}/about`, clicks: 61, impressions: 1340, ctr: 4.55, position: 11.4 },
      { label: `${site}/careers`, clicks: 54, impressions: 1580, ctr: 3.42, position: 14.7 },
      { label: `${site}/contact`, clicks: 39, impressions: 890, ctr: 4.38, position: 8.9 },
      { label: `${site}/blog`, clicks: 28, impressions: 1102, ctr: 2.54, position: 19.3 },
    ],
    topCountries: [
      { label: "India", clicks: 388, impressions: 8340, ctr: 4.65, position: 10.2 },
      { label: "United States", clicks: 74, impressions: 1890, ctr: 3.91, position: 16.8 },
      { label: "United Arab Emirates", clicks: 41, impressions: 920, ctr: 4.46, position: 12.1 },
      { label: "United Kingdom", clicks: 26, impressions: 610, ctr: 4.26, position: 18.4 },
      { label: "Canada", clicks: 18, impressions: 470, ctr: 3.83, position: 21.6 },
      { label: "Australia", clicks: 12, impressions: 330, ctr: 3.64, position: 24.0 },
    ],
    deviceBreakdown: [
      { label: "Mobile", clicks: 349, impressions: 7610, ctr: 4.59, position: 13.8 },
      { label: "Desktop", clicks: 189, impressions: 4120, ctr: 4.59, position: 11.9 },
      { label: "Tablet", clicks: 34, impressions: 866, ctr: 3.93, position: 15.2 },
    ],
    sitemaps: [{ label: `${site}/sitemap.xml`, submitted: 34, indexed: null, status: "Not submitted yet" }],
    isSampleData: true,
  };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const supabase = await requireAdmin(req);
  if (!supabase) return json(req, { error: "Forbidden" }, 403);

  let range = new URL(req.url).searchParams.get("range") ?? "";
  if (req.method === "POST") {
    try {
      range = String((await req.json())?.range ?? range);
    } catch { /* no body */ }
  }
  if (!(range in RANGE_DAYS)) range = "28d";

  const site = (Deno.env.get("SITE_URL") || "https://zyllotech.com").replace(/\/+$/, "");
  return json(req, sample(range, site));
});
