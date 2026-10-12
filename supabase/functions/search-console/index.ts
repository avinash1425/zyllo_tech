// search-console: ADMIN ONLY. POST { range?: "7d"|"28d"|"3m"|"12m", siteUrl?: string,
//   mode?: "index-coverage" }
// With mode "index-coverage" the "ok" response is instead
//  { status: "ok", siteUrl, checkedAt, totals: { tracked, indexed, notIndexed, errors },
//    pages: [{ url, verdict, coverageState, lastCrawlTime, googleCanonical, error? }] }
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

// The API orders by clicks only and returns tied rows alphabetically, so a
// small rowLimit cuts off high-impression rows that have no clicks. Fetch a
// wide set and rank it the way the Search Console UI does: clicks, then
// impressions.
const BREAKDOWN_FETCH = 1000;
const BREAKDOWN_ROWS = 50;

async function ranked(siteUrl: string, start: string, end: string, dimension: string) {
  const rows = await query(siteUrl, start, end, [dimension], BREAKDOWN_FETCH);
  return rows
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, BREAKDOWN_ROWS);
}

const toRow = (r: Row) => ({
  label: r.keys?.[0] ?? "",
  clicks: r.clicks,
  impressions: r.impressions,
  ctr: r.ctr * 100,
  position: r.position,
});

// Index coverage: asks Google's URL Inspection API about every URL in the
// live sitemap. Read-only, and well inside the 2,000 inspections/day quota
// for a site of this size.
const INSPECT_CONCURRENCY = 5;
const INSPECT_MAX_URLS = 200;

async function sitemapUrls() {
  const res = await fetch(`${TARGET_URL}sitemap.xml`);
  if (!res.ok) throw new Error(`Could not read the sitemap [${res.status}]`);
  const xml = await res.text();
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  return [...new Set(urls)].slice(0, INSPECT_MAX_URLS);
}

async function inspect(siteUrl: string, url: string) {
  try {
    const data = await gw("/v1/urlInspection/index:inspect", {
      method: "POST",
      body: JSON.stringify({ inspectionUrl: url, siteUrl, languageCode: "en-US" }),
    });
    const r = data?.inspectionResult?.indexStatusResult ?? {};
    return {
      url,
      verdict: r.verdict ?? "VERDICT_UNSPECIFIED",
      coverageState: r.coverageState ?? "Unknown",
      lastCrawlTime: r.lastCrawlTime ?? null,
      googleCanonical: r.googleCanonical ?? null,
    };
  } catch (err) {
    return {
      url,
      verdict: "ERROR",
      coverageState: "Check failed",
      lastCrawlTime: null,
      googleCanonical: null,
      error: err instanceof GatewayError ? `${err.status}: ${err.details.slice(0, 300)}` : String(err),
    };
  }
}

async function indexCoverage(siteUrl: string) {
  const urls = await sitemapUrls();
  const pages: Awaited<ReturnType<typeof inspect>>[] = [];
  for (let i = 0; i < urls.length; i += INSPECT_CONCURRENCY) {
    pages.push(...(await Promise.all(urls.slice(i, i + INSPECT_CONCURRENCY).map((u) => inspect(siteUrl, u)))));
  }
  return {
    status: "ok",
    siteUrl,
    checkedAt: new Date().toISOString(),
    totals: {
      tracked: pages.length,
      indexed: pages.filter((p) => p.verdict === "PASS").length,
      notIndexed: pages.filter((p) => p.verdict !== "PASS" && p.verdict !== "ERROR").length,
      errors: pages.filter((p) => p.verdict === "ERROR").length,
    },
    pages,
  };
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const ALPHA3_TO_ALPHA2: Record<string, string> = Object.fromEntries(
  ("afg:AF,alb:AL,dza:DZ,ago:AO,arg:AR,arm:AM,aus:AU,aut:AT,aze:AZ,bhr:BH,bgd:BD,blr:BY,bel:BE,btn:BT,bol:BO,bih:BA," +
    "bwa:BW,bra:BR,brn:BN,bgr:BG,khm:KH,cmr:CM,can:CA,chl:CL,chn:CN,col:CO,cri:CR,hrv:HR,cub:CU,cyp:CY,cze:CZ,dnk:DK," +
    "dom:DO,ecu:EC,egy:EG,slv:SV,est:EE,eth:ET,fin:FI,fra:FR,geo:GE,deu:DE,gha:GH,grc:GR,gtm:GT,hnd:HN,hkg:HK,hun:HU," +
    "isl:IS,ind:IN,idn:ID,irn:IR,irq:IQ,irl:IE,isr:IL,ita:IT,jam:JM,jpn:JP,jor:JO,kaz:KZ,ken:KE,kor:KR,kwt:KW,kgz:KG," +
    "lao:LA,lva:LV,lbn:LB,lby:LY,ltu:LT,lux:LU,mac:MO,mys:MY,mdv:MV,mlt:MT,mus:MU,mex:MX,mda:MD,mng:MN,mne:ME,mar:MA," +
    "moz:MZ,mmr:MM,nam:NA,npl:NP,nld:NL,nzl:NZ,nic:NI,nga:NG,mkd:MK,nor:NO,omn:OM,pak:PK,pan:PA,pry:PY,per:PE,phl:PH," +
    "pol:PL,prt:PT,pri:PR,qat:QA,rou:RO,rus:RU,rwa:RW,sau:SA,sen:SN,srb:RS,sgp:SG,svk:SK,svn:SI,zaf:ZA,esp:ES,lka:LK," +
    "sdn:SD,swe:SE,che:CH,syr:SY,twn:TW,tjk:TJ,tza:TZ,tha:TH,tun:TN,tur:TR,tkm:TM,uga:UG,ukr:UA,are:AE,gbr:GB,usa:US," +
    "ury:UY,uzb:UZ,ven:VE,vnm:VN,yem:YE,zmb:ZM,zwe:ZW")
    .split(",")
    .map((pair) => pair.split(":")),
);
function countryName(code: string) {
  // GSC returns ISO 3166-1 alpha-3; unmapped codes are shown as the code.
  const a2 = ALPHA3_TO_ALPHA2[code.toLowerCase()];
  try { return a2 ? regionNames.of(a2) ?? code.toUpperCase() : code.toUpperCase(); } catch { return code.toUpperCase(); }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const supabase = await requireAdmin(req);
  if (!supabase) return json(req, { error: "Forbidden" }, 403);

  let range = "28d";
  let selected: string | undefined;
  let mode = "performance";
  if (req.method === "POST") {
    try {
      const b = await req.json();
      if (typeof b?.range === "string") range = b.range;
      if (b?.mode === "index-coverage") mode = b.mode;
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

    if (mode === "index-coverage") return json(req, await indexCoverage(siteUrl));

    const days = RANGE_DAYS[range];
    // Anchor the window on the latest day Google has actually published, as
    // the Search Console UI does for "Last N days". Assuming a fixed lag
    // shifted the window by a day and left its last day empty.
    const today = new Date();
    const probeStart = new Date(today);
    probeStart.setDate(probeStart.getDate() - 10);
    const recent = await query(siteUrl, iso(probeStart), iso(today), ["date"], 25);
    const latest = recent.map((r) => r.keys?.[0] ?? "").sort().pop();
    const end = latest ? new Date(`${latest}T00:00:00Z`) : new Date(today);
    if (!latest) end.setDate(end.getDate() - 3);
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    const s = iso(start), e = iso(end);

    const [totalsRows, dateRows, queries, pages, countries, devices, sitemapsRes] = await Promise.all([
      query(siteUrl, s, e, [], 1),
      query(siteUrl, s, e, ["date"], 500),
      ranked(siteUrl, s, e, "query"),
      ranked(siteUrl, s, e, "page"),
      ranked(siteUrl, s, e, "country"),
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
        lastDownloaded: m.lastDownloaded ?? null,
        errors: Number(m.errors ?? 0),
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
