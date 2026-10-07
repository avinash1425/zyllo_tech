// search-console: ADMIN ONLY. POST { range?: "7d"|"28d"|"3m"|"12m", siteUrl?: string }
// Live Google Search Console data via the Lovable connector gateway
// (read-only connection). Credentials stay server-side.
// Responses:
//  { status: "not_connected", message }
//  { status: "selection_required", candidates: string[] }
//  { status: "ok", siteUrl, timeSeries, totals, topQueries, topPages,
//    topCountries, deviceBreakdown, sitemaps, isSampleData: false }
import { json, preflight } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";

const GATEWAY = "https://connector-gateway.lovable.dev/google_search_console";
const RANGE_DAYS: Record<string, number> = { "7d": 7, "28d": 28, "3m": 90, "12m": 365 };
const TARGET_URL = "https://zyllotech.com/";

class GatewayError extends Error {
  constructor(public status: number, public details: string) {
    super(`Search Console request failed [${status}]`);
  }
}

function headers() {
  return {
    Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
    "X-Connection-Api-Key": Deno.env.get("GOOGLE_SEARCH_CONSOLE_API_KEY") ?? "",
    "Content-Type": "application/json",
  };
}

async function gw(path: string, init: RequestInit = {}) {
  const res = await fetch(`${GATEWAY}${path}`, { ...init, headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Gateway ${path} [${res.status}]: ${body}`);
    throw new GatewayError(res.status, body);
  }
  return res.json();
}

function covers(siteUrl: string, target: URL) {
  if (siteUrl.startsWith("sc-domain:")) {
    const d = siteUrl.slice(10).toLowerCase();
    const h = target.hostname.toLowerCase();
    return h === d || h.endsWith(`.${d}`);
  }
  try { return target.href.startsWith(new URL(siteUrl).href); } catch { return false; }
}

async function resolveSite(selected?: string) {
  const { siteEntry = [] } = await gw("/webmasters/v3/sites");
  const target = new URL(TARGET_URL);
  const matches = (siteEntry as { siteUrl: string; permissionLevel?: string }[])
    .filter((e) => e.permissionLevel !== "siteUnverifiedUser" && covers(e.siteUrl, target))
    .map((e) => e.siteUrl);
  if (selected) {
    if (!matches.includes(selected)) throw new GatewayError(403, "Selected property is not verified for this site");
    return { siteUrl: selected };
  }
  if (matches.length === 0) return { none: true };
  if (matches.length === 1) return { siteUrl: matches[0] };
  return { candidates: matches };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

type Row = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };

async function query(siteUrl: string, start: string, end: string, dimensions: string[], rowLimit = 10) {
  const data = await gw(`/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: "POST",
    body: JSON.stringify({ startDate: start, endDate: end, dimensions, rowLimit }),
  });
  return (data.rows ?? []) as Row[];
}

const toRow = (r: Row) => ({
  label: r.keys?.[0] ?? "",
  clicks: r.clicks,
  impressions: r.impressions,
  ctr: r.ctr * 100,
  position: r.position,
});

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
function countryName(code: string) {
  // GSC returns ISO 3166-1 alpha-3; map common ones, else show code.
  const map: Record<string, string> = { ind: "IN", usa: "US", are: "AE", gbr: "GB", can: "CA", aus: "AU", deu: "DE", sgp: "SG", sau: "SA", pak: "PK", bgd: "BD", npl: "NP", lka: "LK", phl: "PH", fra: "FR", nld: "NL" };
  const a2 = map[code.toLowerCase()];
  try { return a2 ? regionNames.of(a2) ?? code.toUpperCase() : code.toUpperCase(); } catch { return code.toUpperCase(); }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const supabase = await requireAdmin(req);
  if (!supabase) return json(req, { error: "Forbidden" }, 403);

  let range = "28d";
  let selected: string | undefined;
  if (req.method === "POST") {
    try {
      const b = await req.json();
      if (typeof b?.range === "string") range = b.range;
      if (typeof b?.siteUrl === "string" && b.siteUrl.length < 300) selected = b.siteUrl;
    } catch { /* no body */ }
  }
  if (!(range in RANGE_DAYS)) range = "28d";

  if (!Deno.env.get("LOVABLE_API_KEY") || !Deno.env.get("GOOGLE_SEARCH_CONSOLE_API_KEY")) {
    return json(req, { status: "not_connected", message: "Google Search Console is not connected." });
  }

  try {
    const site = await resolveSite(selected);
    if ("none" in site) {
      return json(req, { status: "not_connected", message: "The connected Google account has no verified property for zyllotech.com." });
    }
    if ("candidates" in site) return json(req, { status: "selection_required", candidates: site.candidates });
    const siteUrl = site.siteUrl!;

    const days = RANGE_DAYS[range];
    const end = new Date();
    end.setDate(end.getDate() - 2); // GSC data lags ~2 days
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    const s = iso(start), e = iso(end);

    const [totalsRows, dateRows, queries, pages, countries, devices, sitemapsRes] = await Promise.all([
      query(siteUrl, s, e, [], 1),
      query(siteUrl, s, e, ["date"], 500),
      query(siteUrl, s, e, ["query"]),
      query(siteUrl, s, e, ["page"]),
      query(siteUrl, s, e, ["country"]),
      query(siteUrl, s, e, ["device"]),
      gw(`/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`).catch(() => ({ sitemap: [] })),
    ]);

    const t = totalsRows[0];
    return json(req, {
      status: "ok",
      siteUrl,
      startDate: s,
      endDate: e,
      totals: {
        clicks: t?.clicks ?? 0,
        impressions: t?.impressions ?? 0,
        ctr: (t?.ctr ?? 0) * 100,
        avgPosition: t?.position ?? 0,
      },
      timeSeries: dateRows.map((r) => ({ date: r.keys?.[0], clicks: r.clicks, impressions: r.impressions })),
      topQueries: queries.map(toRow),
      topPages: pages.map(toRow),
      topCountries: countries.map((r) => ({ ...toRow(r), label: countryName(r.keys?.[0] ?? "") })),
      deviceBreakdown: devices.map((r) => {
        const row = toRow(r);
        return { ...row, label: row.label.charAt(0) + row.label.slice(1).toLowerCase() };
      }),
      sitemaps: ((sitemapsRes.sitemap ?? []) as any[]).map((m) => ({
        label: m.path,
        submitted: (m.contents ?? []).reduce((n: number, c: any) => n + Number(c.submitted ?? 0), 0),
        status: m.isPending ? "Pending" : Number(m.errors ?? 0) > 0 ? `${m.errors} error(s)` : "Success",
      })),
      isSampleData: false,
    });
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 401 || err.status === 403) {
        return json(req, { status: "not_connected", message: "The Google account can't access this Search Console property. Reconnect Google Search Console.", details: err.details });
      }
      return json(req, { error: "Search Console request failed", status: err.status, details: err.details }, 502);
    }
    console.error(err);
    return json(req, { error: String((err as Error)?.message ?? err) }, 500);
  }
});
