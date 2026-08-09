import { SITE_URL } from "@/lib/site-config";
import SearchConsoleManager from "./SearchConsoleManager";

const RANGE_DAYS = { "7d": 7, "28d": 28, "3m": 90, "12m": 365 };

// Deterministic pseudo-random generator, same approach as
// admin/TrafficChart.js's generateTrafficData — varies by day count
// without jumping around on every render.
function nextRandomFactory(seed) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

function generateDailySeries(days) {
  const data = [];
  const today = new Date();
  const nextRandom = nextRandomFactory(days * 17);

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const label = date.toISOString().slice(0, 10);

    const base = 18 + Math.sin((days - i) / 5) * 8 + nextRandom() * 6;
    const clicks = Math.max(0, Math.round(base));
    const impressions = Math.round(clicks * (18 + nextRandom() * 10));

    data.push({ date: label, clicks, impressions });
  }

  return data;
}

// Placeholder Search Console-style metrics. Real numbers require the
// site to be verified in Google Search Console and indexed live — see
// src/lib/site-config.js's SITE_URL placeholder note, same underlying
// blocker. Until then this returns clearly-labeled sample data shaped
// like the real Search Console Search Analytics API response (query,
// clicks, impressions, ctr, position — same fields for pages, countries,
// devices), so swapping in the real API call later only touches this one
// function, not the UI.
//
// Real integration path (for whenever this is picked up):
//   1. Verify property in Search Console (search.google.com/search-console)
//   2. Enable the Search Console API in Google Cloud Console
//   3. Service account with domain read access, credentials stored server-only
//   4. Call searchanalytics.query once per dimension (query/page/country/device)
//      for the selected date range, plus sitemaps.list for the Sitemaps tab
async function getSearchConsolePerformance(range) {
  const days = RANGE_DAYS[range] ?? 28;
  const scale = days / 28;

  // Capped at 90 daily points even for the 12-month range — 365 daily
  // dots would be unreadably dense on this chart width regardless of
  // whether the data is real or sample. A real Search Console integration
  // should bucket by week/month past ~90 days rather than lift this cap.
  const timeSeries = generateDailySeries(Math.min(days, 90));

  const totals = {
    clicks: Math.round(572 * scale),
    impressions: Math.round(12596 * scale),
    ctr: 4.54,
    avgPosition: 13.1,
  };

  const topQueries = [
    { label: "zyllo tech", clicks: 45, impressions: 422, ctr: 10.66, position: 1.1 },
    { label: "custom software development company", clicks: 23, impressions: 137, ctr: 16.79, position: 5.1 },
    { label: "zyllo tech software solutions", clicks: 12, impressions: 75, ctr: 16.0, position: 1.3 },
    { label: "ai software development india", clicks: 11, impressions: 42, ctr: 26.19, position: 2.6 },
    { label: "mobile app development company", clicks: 10, impressions: 117, ctr: 8.55, position: 1.4 },
    { label: "zyllo tech careers", clicks: 8, impressions: 161, ctr: 4.97, position: 2.7 },
    { label: "software solutions provider", clicks: 6, impressions: 96, ctr: 6.25, position: 4.2 },
  ];

  const topPages = [
    { label: `${SITE_URL}/`, clicks: 210, impressions: 4890, ctr: 4.29, position: 6.8 },
    { label: `${SITE_URL}/services`, clicks: 98, impressions: 2210, ctr: 4.43, position: 9.2 },
    { label: `${SITE_URL}/about`, clicks: 61, impressions: 1340, ctr: 4.55, position: 11.4 },
    { label: `${SITE_URL}/careers`, clicks: 54, impressions: 1580, ctr: 3.42, position: 14.7 },
    { label: `${SITE_URL}/contact`, clicks: 39, impressions: 890, ctr: 4.38, position: 8.9 },
    { label: `${SITE_URL}/blog`, clicks: 28, impressions: 1102, ctr: 2.54, position: 19.3 },
  ];

  const topCountries = [
    { label: "India", clicks: 388, impressions: 8340, ctr: 4.65, position: 10.2 },
    { label: "United States", clicks: 74, impressions: 1890, ctr: 3.91, position: 16.8 },
    { label: "United Arab Emirates", clicks: 41, impressions: 920, ctr: 4.46, position: 12.1 },
    { label: "United Kingdom", clicks: 26, impressions: 610, ctr: 4.26, position: 18.4 },
    { label: "Canada", clicks: 18, impressions: 470, ctr: 3.83, position: 21.6 },
    { label: "Australia", clicks: 12, impressions: 330, ctr: 3.64, position: 24.0 },
  ];

  const deviceBreakdown = [
    { label: "Mobile", clicks: 349, impressions: 7610, ctr: 4.59, position: 13.8 },
    { label: "Desktop", clicks: 189, impressions: 4120, ctr: 4.59, position: 11.9 },
    { label: "Tablet", clicks: 34, impressions: 866, ctr: 3.93, position: 15.2 },
  ];

  const sitemaps = [
    { label: `${SITE_URL}/sitemap.xml`, submitted: 34, indexed: null, status: "Not submitted yet" },
  ];

  return {
    timeSeries,
    totals,
    topQueries,
    topPages,
    topCountries,
    deviceBreakdown,
    sitemaps,
    isSampleData: true,
  };
}

export default async function AdminSearchConsolePage({ searchParams }) {
  const params = await searchParams;
  const range = params?.range ?? "28d";
  const performance = await getSearchConsolePerformance(range);

  return <SearchConsoleManager performance={performance} range={range} />;
}
