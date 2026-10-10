// Technical SEO audit for Admin -> SEO. Everything here is measured, not
// assumed: robots.txt, sitemap.xml and each page's HTML are fetched from the
// origin that is serving this admin, and blog/job URLs come from the database
// (read-only selects under the signed-in admin's RLS).
//
// Two kinds of page check, kept separate on purpose:
//  - raw:      the HTML exactly as served, no scripts run (fetchSeoAudit).
//  - rendered: the <head> after the React app has run, read from a hidden
//              same-origin iframe (runRenderedAudit, started by the admin).
import { supabase } from "@/lib/supabase/client";
import { SITE_URL, SITE_NAME } from "@/lib/site-config";
import { SERVICES } from "@/data/services";
import { STATIC_PUBLIC_ROUTES, PRIVATE_PATHS } from "@/lib/seo/public-routes";
import {
  compareSitemap,
  evaluatePage,
  extractMeta,
  isPathAllowed,
  looksLikeHtml,
  normalizePath,
  parseRobots,
  parseSitemap,
  rulesFor,
} from "@/lib/seo/audit-core";

const FETCH_TIMEOUT_MS = 15000;
const FETCH_CONCURRENCY = 6;
const MAX_PAGES = 150;
const MAX_CHILD_SITEMAPS = 20;
const RENDER_TIMEOUT_MS = 12000;
const RENDER_SETTLE_MS = 400;
const RENDER_POLL_MS = 200;

// The dev server runs React StrictMode, which makes react-helmet-async drop
// the site's JSON-LD script tags. A production build renders them, so on a
// development build "no JSON-LD after rendering" proves nothing.
const DEV_BUILD = import.meta.env.DEV;
const DEV_JSONLD_MESSAGE =
  "Cannot be verified in development mode. Check a production build or the live site.";
const TIMEOUT_MESSAGE = `Could not verify: the page did not finish rendering within ${RENDER_TIMEOUT_MS / 1000} seconds.`;

const expectedCanonical = (path) => (path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`);

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url,
      redirected: res.redirected,
      contentType: res.headers.get("content-type") || "",
      text: await res.text(),
    };
  } catch (e) {
    return {
      ok: false,
      status: null,
      error:
        e?.name === "AbortError"
          ? "Timed out."
          : "Could not be fetched from this browser (network error or blocked by CORS).",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

// Sitemap/robots URLs are written with the production origin. When the admin
// runs on another origin (localhost, a preview), read the same path from the
// origin being audited so the check reflects that build.
function toAuditedUrl(url, auditedOrigin) {
  try {
    const parsed = new URL(url);
    if (parsed.origin === new URL(SITE_URL).origin && parsed.origin !== auditedOrigin) {
      return `${auditedOrigin}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    /* fetched as written */
  }
  return url;
}

async function loadExpectedPages() {
  const [posts, jobs] = await Promise.all([
    supabase.from("blog_posts").select("slug, title").eq("status", "published"),
    supabase.from("job_postings").select("id, title").eq("status", "open"),
  ]);
  const pages = [
    ...STATIC_PUBLIC_ROUTES.map((r) => ({ path: r.path, label: r.label, kind: "page" })),
    ...SERVICES.map((s) => ({ path: `/services/${s.slug}`, label: s.title, kind: "service" })),
    ...(posts.data ?? []).map((p) => ({ path: `/blog/${p.slug}`, label: p.title, kind: "blog" })),
    ...(jobs.data ?? []).map((j) => ({ path: `/careers/${j.id}`, label: j.title, kind: "job" })),
  ];
  return {
    pages,
    staticCount: STATIC_PUBLIC_ROUTES.length,
    serviceCount: SERVICES.length,
    publishedBlogPosts: posts.error ? null : posts.data.length,
    openJobPostings: jobs.error ? null : jobs.data.length,
    errors: [
      posts.error && `Could not read published blog posts: ${posts.error.message}`,
      jobs.error && `Could not read open job postings: ${jobs.error.message}`,
    ].filter(Boolean),
  };
}

async function auditRobots(auditedOrigin, expectedPages) {
  const url = `${auditedOrigin}/robots.txt`;
  const res = await fetchText(url);
  const base = { url, status: res.status, found: false, allow: [], disallow: [], sitemaps: [], rules: [], checks: [] };

  if (!res.ok) {
    base.checks.push({
      level: "error",
      message: res.error || `robots.txt returned HTTP ${res.status}.`,
    });
    return base;
  }
  if (looksLikeHtml(res.text)) {
    base.checks.push({
      level: "error",
      message: "The server answered with an HTML page instead of a robots.txt file, so no robots.txt exists at this address.",
    });
    return base;
  }

  const robots = parseRobots(res.text);
  const rules = rulesFor(robots, "*");
  const checks = [{ level: "pass", message: `robots.txt was fetched (HTTP ${res.status}).` }];

  if (!robots.groups.some((g) => g.agents.includes("*"))) {
    checks.push({ level: "info", message: "No rules for all crawlers (User-agent: *). Everything is allowed by default." });
  }

  const blocked = expectedPages.filter((p) => !isPathAllowed(rules, p.path));
  if (blocked.length === expectedPages.length && expectedPages.length > 0) {
    checks.push({ level: "error", message: "robots.txt blocks every public page from being crawled." });
  } else if (blocked.length > 0) {
    checks.push({
      level: "error",
      message: `${blocked.length} public page(s) are blocked from crawling: ${blocked.slice(0, 5).map((p) => p.path).join(", ")}${blocked.length > 5 ? ", …" : ""}`,
    });
  } else {
    checks.push({ level: "pass", message: `All ${expectedPages.length} expected public pages may be crawled.` });
  }

  const openPrivate = PRIVATE_PATHS.filter((p) => isPathAllowed(rules, p));
  checks.push(
    openPrivate.length
      ? { level: "warn", message: `Private path(s) not disallowed: ${openPrivate.join(", ")}.` }
      : { level: "pass", message: `${PRIVATE_PATHS.join(" and ")} are disallowed.` },
  );

  if (robots.sitemaps.length === 0) {
    checks.push({ level: "warn", message: "No Sitemap line. Crawlers are not told where the sitemap is." });
  } else {
    checks.push({ level: "pass", message: `Sitemap referenced: ${robots.sitemaps.join(", ")}` });
  }

  return {
    ...base,
    found: true,
    rules,
    allow: rules.filter((r) => r.type === "allow").map((r) => r.path),
    disallow: rules.filter((r) => r.type === "disallow").map((r) => r.path),
    sitemaps: robots.sitemaps,
    checks,
  };
}

async function fetchSitemap(declaredUrl, auditedOrigin) {
  const fetchedFrom = toAuditedUrl(declaredUrl, auditedOrigin);
  const res = await fetchText(fetchedFrom);
  const source = { url: declaredUrl, fetchedFrom, status: res.status, kind: null, count: 0, entries: [], error: null };
  if (!res.ok) source.error = res.error || `Returned HTTP ${res.status}.`;
  else if (looksLikeHtml(res.text)) source.error = "The server answered with an HTML page instead of XML, so no sitemap exists at this address.";
  else {
    const parsed = parseSitemap(res.text);
    source.kind = parsed.kind;
    source.entries = parsed.entries;
    source.count = parsed.entries.length;
    if (parsed.kind === "invalid") source.error = "The response is not a sitemap (no <urlset> or <sitemapindex>).";
  }
  return source;
}

async function auditSitemap(auditedOrigin, robots, expectedPages) {
  const declared = robots.sitemaps.length ? robots.sitemaps : [`${SITE_URL}/sitemap.xml`];
  const fromRobots = robots.sitemaps.length > 0;

  const sources = await Promise.all(declared.map((url) => fetchSitemap(url, auditedOrigin)));
  // Follow sitemap index files one level down.
  for (const index of sources.filter((s) => s.kind === "sitemapindex")) {
    const children = index.entries.slice(0, MAX_CHILD_SITEMAPS).map((e) => e.loc);
    sources.push(...(await Promise.all(children.map((url) => fetchSitemap(url, auditedOrigin)))));
  }

  const urlEntries = sources.filter((s) => s.kind === "urlset").flatMap((s) => s.entries);
  const comparison = compareSitemap({
    expectedPaths: expectedPages.map((p) => p.path),
    sitemapUrls: urlEntries.map((e) => e.loc),
    siteUrl: SITE_URL,
  });

  const checks = [];
  if (!fromRobots) {
    checks.push({ level: "info", message: `robots.txt names no sitemap, so ${SITE_URL}/sitemap.xml was checked.` });
  }
  for (const source of sources) {
    checks.push(
      source.error
        ? { level: "error", message: `${source.url}: ${source.error}` }
        : {
            level: "pass",
            message: `${source.url} was fetched and lists ${source.count} ${source.kind === "sitemapindex" ? "sitemap(s)" : "URL(s)"}.`,
          },
    );
  }
  const readable = sources.some((s) => s.kind === "urlset");
  if (readable) {
    checks.push(
      comparison.missing.length
        ? { level: "warn", message: `${comparison.missing.length} expected page(s) are not listed in the sitemap.` }
        : { level: "pass", message: `All ${expectedPages.length} expected pages are listed.` },
    );
    if (comparison.unexpected.length) {
      checks.push({
        level: "warn",
        message: `${comparison.unexpected.length} listed URL(s) are not a known public page (possibly removed or unpublished content).`,
      });
    }
    if (comparison.foreignHost.length) {
      checks.push({
        level: "error",
        message: `${comparison.foreignHost.length} URL(s) are on a different host than ${SITE_URL}.`,
      });
    }
    if (comparison.duplicates.length) {
      checks.push({ level: "warn", message: `${comparison.duplicates.length} URL(s) are listed more than once.` });
    }
    const noLastmod = urlEntries.filter((e) => !e.lastmod).length;
    if (noLastmod) {
      checks.push({ level: "info", message: `${noLastmod} of ${urlEntries.length} URLs have no lastmod date.` });
    }
  }

  return {
    sources: sources.map(({ entries, ...rest }) => rest),
    readable,
    urlCount: readable ? urlEntries.length : null,
    comparison,
    checks,
  };
}

async function auditRawPage(page, auditedOrigin) {
  const res = await fetchText(`${auditedOrigin}${page.path}`);
  const result = { status: res.status, redirectedTo: null, meta: null, checks: [], error: null };
  if (res.status == null) {
    result.error = res.error;
    return result;
  }
  if (res.redirected && normalizePath(new URL(res.finalUrl).pathname) !== normalizePath(page.path)) {
    result.redirectedTo = res.finalUrl;
  }
  if (!res.ok) {
    result.error = `Returned HTTP ${res.status}.`;
    return result;
  }
  const doc = new DOMParser().parseFromString(res.text, "text/html");
  result.meta = extractMeta(doc);
  result.checks = evaluatePage(result.meta, {
    source: "raw",
    expectedCanonical: expectedCanonical(page.path),
    siteName: SITE_NAME,
  });
  return result;
}

export async function fetchSeoAudit() {
  const auditedOrigin = window.location.origin;
  const expected = await loadExpectedPages();
  const robots = await auditRobots(auditedOrigin, expected.pages);
  const sitemap = await auditSitemap(auditedOrigin, robots, expected.pages);

  const listed = new Set(sitemap.comparison.matched);
  const audited = expected.pages.slice(0, MAX_PAGES);
  const raw = await mapLimit(audited, FETCH_CONCURRENCY, (page) => auditRawPage(page, auditedOrigin));

  return {
    generatedAt: new Date().toISOString(),
    auditedOrigin,
    siteUrl: SITE_URL,
    // False when VITE_SITE_URL is unset and site-config.js fell back to its default.
    siteUrlConfigured: Boolean(import.meta.env.VITE_SITE_URL),
    auditingLiveSite: auditedOrigin === new URL(SITE_URL).origin,
    devBuild: DEV_BUILD,
    expected: {
      total: expected.pages.length,
      staticCount: expected.staticCount,
      serviceCount: expected.serviceCount,
      publishedBlogPosts: expected.publishedBlogPosts,
      openJobPostings: expected.openJobPostings,
      errors: expected.errors,
    },
    robots,
    sitemap,
    pagesTruncated: expected.pages.length > audited.length,
    pages: audited.map((page, i) => ({
      ...page,
      inSitemap: sitemap.readable ? listed.has(normalizePath(page.path)) : null,
      crawlAllowed: robots.found ? isPathAllowed(robots.rules, page.path) : null,
      // Opening a blog post or job page records a view in the database, so
      // those are never loaded by the rendered check.
      renderable: page.kind === "page" || page.kind === "service",
      raw: raw[i],
    })),
  };
}

// ---------------------------------------------------------------- rendered

function renderInFrame(path) {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText =
      "position:fixed;left:-10000px;top:0;width:1280px;height:800px;border:0;visibility:hidden";
    const started = Date.now();
    let settledAt = null;

    const finish = (result) => {
      clearInterval(timer);
      frame.remove();
      resolve(result);
    };

    const timer = setInterval(() => {
      let doc;
      try {
        doc = frame.contentDocument;
      } catch {
        doc = null;
      }
      const timedOut = Date.now() - started > RENDER_TIMEOUT_MS;
      // Not waiting for readyState "complete": that also waits for every image.
      const onPage = doc && frame.contentWindow.location.pathname !== "blank";
      // <Seo> always writes a canonical or a robots tag, so either one
      // appearing means the page's metadata has been applied.
      const ready = onPage && doc.querySelector('link[rel="canonical"], meta[name="robots"]');
      if (ready && settledAt == null) settledAt = Date.now();

      if (settledAt != null && Date.now() - settledAt >= RENDER_SETTLE_MS) {
        finish({ meta: extractMeta(doc), timedOut: false, error: null });
      } else if (timedOut) {
        // A half-rendered head would make present tags look missing, so a
        // page that never settles is reported as unverified, not as failing.
        finish({ meta: null, timedOut: true, error: TIMEOUT_MESSAGE });
      }
    }, RENDER_POLL_MS);

    frame.src = path;
    document.body.appendChild(frame);
  });
}

// Loads each renderable page in a hidden iframe, one at a time, and reads the
// <head> the React app produced. Returns { [path]: { meta, checks, timedOut, error } }.
// A page with an error has no checks: it could not be verified.
export async function runRenderedAudit(pages, onProgress) {
  const targets = pages.filter((p) => p.renderable);
  const results = {};
  for (let i = 0; i < targets.length; i++) {
    const page = targets[i];
    onProgress?.({ done: i, total: targets.length, path: page.path });
    const rendered = await renderInFrame(page.path);
    const checks = rendered.meta
      ? evaluatePage(rendered.meta, {
          source: "rendered",
          expectedCanonical: expectedCanonical(page.path),
          siteName: SITE_NAME,
        })
      : [];
    results[page.path] = {
      ...rendered,
      checks: checks.map((check) =>
        DEV_BUILD && check.field === "jsonld" && rendered.meta.jsonLdBlocks === 0
          ? { field: "jsonld", value: null, level: "unverified", message: DEV_JSONLD_MESSAGE }
          : check,
      ),
    };
  }
  onProgress?.({ done: targets.length, total: targets.length, path: null });
  return results;
}
