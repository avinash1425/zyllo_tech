// Pure technical-SEO audit helpers for Admin -> SEO. No imports and no
// network access: callers pass in fetched text or a Document, so the same
// extractor reads both raw HTML (DOMParser) and a JavaScript-rendered page
// (an iframe's document).
//
// Check levels: "pass" | "info" | "warn" | "error" | "unverified". These
// describe what the site serves. They never state whether Google has indexed
// a page. "unverified" means the check could not be run reliably, so it says
// nothing either way.

const TITLE_MAX = 65;
const DESCRIPTION_MIN = 50;
const DESCRIPTION_MAX = 165;
const REQUIRED_OG = ["og:title", "og:description", "og:url", "og:image", "og:type"];

export const FIELD_LABELS = {
  title: "Title",
  description: "Meta description",
  canonical: "Canonical URL",
  robots: "Robots meta",
  og: "Open Graph",
  jsonld: "JSON-LD",
};

// SPA hosts answer missing files with the app shell (HTTP 200), so a
// "successful" robots.txt / sitemap.xml fetch can really be index.html.
export function looksLikeHtml(text) {
  return /^\s*(<!doctype html|<html[\s>])/i.test(text || "");
}

export function normalizePath(path) {
  const clean = (path || "/").split(/[?#]/)[0].replace(/\/+$/, "");
  return clean === "" ? "/" : clean;
}

function sameUrl(a, b) {
  const strip = (u) => (u || "").trim().replace(/\/+$/, "");
  return strip(a) === strip(b);
}

// ---------------------------------------------------------------- robots.txt

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;

  for (const rawLine of (text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const sep = line.indexOf(":");
    if (!line || sep === -1) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (key === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") sitemaps.push(value);
    else if ((key === "allow" || key === "disallow") && current) {
      // An empty Disallow means "nothing is disallowed"; it carries no rule.
      if (value) current.rules.push({ type: key, path: value });
    }
  }
  return { groups, sitemaps };
}

export function rulesFor(robots, agent = "*") {
  return robots.groups
    .filter((group) => group.agents.includes(agent.toLowerCase()))
    .flatMap((group) => group.rules);
}

function ruleMatches(rulePath, path) {
  const anchored = rulePath.endsWith("$");
  const body = anchored ? rulePath.slice(0, -1) : rulePath;
  const pattern = body
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(path);
}

// Longest matching rule wins; on a tie Allow wins (Google's documented rule).
export function isPathAllowed(rules, path) {
  let best = null;
  for (const rule of rules) {
    if (!ruleMatches(rule.path, path)) continue;
    const longer = !best || rule.path.length > best.path.length;
    const tieAllow = best && rule.path.length === best.path.length && rule.type === "allow";
    if (longer || tieAllow) best = rule;
  }
  return !best || best.type === "allow";
}

// ---------------------------------------------------------------- sitemap.xml

function unescapeXml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tagValue(block, tag) {
  const match = block.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i"));
  return match ? unescapeXml(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim()) : null;
}

// -> { kind: "urlset" | "sitemapindex" | "invalid", entries: [{ loc, lastmod }] }
export function parseSitemap(xml) {
  const text = (xml || "").replace(/<!--[\s\S]*?-->/g, "");
  const isIndex = /<sitemapindex[\s>]/i.test(text);
  const isUrlset = /<urlset[\s>]/i.test(text);
  if (!isIndex && !isUrlset) return { kind: "invalid", entries: [] };

  const tag = isIndex ? "sitemap" : "url";
  const blocks = text.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "gi")) || [];
  const entries = blocks
    .map((block) => ({ loc: tagValue(block, "loc"), lastmod: tagValue(block, "lastmod") }))
    .filter((entry) => entry.loc);
  return { kind: isIndex ? "sitemapindex" : "urlset", entries };
}

// Compares the URLs a sitemap actually lists with the pages the site is
// expected to expose. siteUrl is the canonical production origin.
export function compareSitemap({ expectedPaths, sitemapUrls, siteUrl }) {
  let siteHost = "";
  try {
    siteHost = new URL(siteUrl).host;
  } catch {
    /* compared as empty host */
  }

  const listed = new Set();
  const foreignHost = [];
  const duplicates = [];
  for (const loc of sitemapUrls) {
    let url;
    try {
      url = new URL(loc);
    } catch {
      foreignHost.push(loc);
      continue;
    }
    if (url.host !== siteHost) {
      foreignHost.push(loc);
      continue;
    }
    const path = normalizePath(url.pathname);
    if (listed.has(path)) duplicates.push(path);
    listed.add(path);
  }

  const expected = new Set(expectedPaths.map(normalizePath));
  return {
    matched: [...expected].filter((path) => listed.has(path)),
    missing: [...expected].filter((path) => !listed.has(path)),
    unexpected: [...listed].filter((path) => !expected.has(path)),
    foreignHost,
    duplicates,
  };
}

// ---------------------------------------------------------------- page <head>

function collectTypes(node, out) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectTypes(item, out));
    return;
  }
  if (!node || typeof node !== "object") return;
  const type = node["@type"];
  if (type) out.push(...(Array.isArray(type) ? type : [type]));
  if (node["@graph"]) collectTypes(node["@graph"], out);
}

// Reads SEO-relevant head tags from a Document (raw or rendered).
export function extractMeta(doc) {
  const content = (selector) => {
    const value = doc.querySelector(selector)?.getAttribute("content");
    return value == null ? null : value.trim();
  };
  const collect = (selector, attr) => {
    const out = {};
    doc.querySelectorAll(selector).forEach((el) => {
      const key = el.getAttribute(attr);
      if (key && !(key in out)) out[key] = (el.getAttribute("content") || "").trim();
    });
    return out;
  };

  const canonicals = [...doc.querySelectorAll('link[rel="canonical"]')]
    .map((el) => (el.getAttribute("href") || "").trim())
    .filter(Boolean);

  const jsonLdTypes = [];
  let jsonLdInvalid = 0;
  const jsonLdBlocks = doc.querySelectorAll('script[type="application/ld+json"]');
  jsonLdBlocks.forEach((el) => {
    try {
      collectTypes(JSON.parse(el.textContent || ""), jsonLdTypes);
    } catch {
      jsonLdInvalid += 1;
    }
  });

  return {
    title: (doc.querySelector("title")?.textContent || "").trim() || null,
    description: content('meta[name="description"]'),
    canonical: canonicals[0] || null,
    canonicalCount: canonicals.length,
    robots: content('meta[name="robots"]'),
    og: collect('meta[property^="og:"]', "property"),
    twitter: collect('meta[name^="twitter:"]', "name"),
    jsonLdTypes,
    jsonLdBlocks: jsonLdBlocks.length,
    jsonLdInvalid,
  };
}

// source: "raw" (HTML as served, no scripts run) | "rendered" (after JS).
// A tag missing from raw HTML is a warning, not a failure: this site adds its
// metadata with JavaScript, which Google renders but many other crawlers
// (AI assistants, social link previews) do not.
export function evaluatePage(meta, { source, expectedCanonical, siteName, indexable = true }) {
  const raw = source === "raw";
  const missing = (what, verb = "is") =>
    raw
      ? {
          level: "warn",
          message: `${what} ${verb} not in the raw HTML. Crawlers that do not run JavaScript will not see ${verb === "is" ? "it" : "them"}.`,
        }
      : { level: "error", message: `${what} ${verb} missing after the page has rendered.` };
  const checks = [];
  const add = (field, check, value = null) => checks.push({ field, value, ...check });

  // Title
  if (!meta.title) add("title", missing("A title"));
  else if (siteName && meta.title === siteName)
    add(
      "title",
      { level: "warn", message: "Title is only the site name, with nothing describing this page." },
      meta.title,
    );
  else if (meta.title.length > TITLE_MAX)
    add(
      "title",
      { level: "warn", message: `Title is ${meta.title.length} characters and may be cut off in search results.` },
      meta.title,
    );
  else add("title", { level: "pass", message: `${meta.title.length} characters.` }, meta.title);

  // Description
  if (!meta.description) add("description", missing("A meta description"));
  else if (meta.description.length < DESCRIPTION_MIN)
    add(
      "description",
      { level: "warn", message: `Description is short (${meta.description.length} characters).` },
      meta.description,
    );
  else if (meta.description.length > DESCRIPTION_MAX)
    add(
      "description",
      { level: "warn", message: `Description is ${meta.description.length} characters and may be cut off.` },
      meta.description,
    );
  else add("description", { level: "pass", message: `${meta.description.length} characters.` }, meta.description);

  // Canonical
  if (!meta.canonical) {
    add(
      "canonical",
      indexable ? missing("A canonical URL") : { level: "info", message: "No canonical URL (page is not meant to be indexed)." },
    );
  } else if (meta.canonicalCount > 1)
    add("canonical", { level: "error", message: `${meta.canonicalCount} canonical tags found; there must be one.` }, meta.canonical);
  else if (expectedCanonical && !sameUrl(meta.canonical, expectedCanonical))
    add("canonical", { level: "error", message: `Canonical does not match the expected URL ${expectedCanonical}.` }, meta.canonical);
  else add("canonical", { level: "pass", message: "Matches the expected URL." }, meta.canonical);

  // Robots meta
  const noindex = /noindex/i.test(meta.robots || "");
  if (!meta.robots)
    add("robots", {
      level: indexable ? "info" : raw ? "info" : "warn",
      message: indexable
        ? "No robots meta tag. Search engines default to index, follow."
        : "No robots meta tag, although this page is not meant to be indexed.",
    });
  else if (noindex && indexable)
    add("robots", { level: "error", message: "Page is marked noindex but is expected to be indexable." }, meta.robots);
  else add("robots", { level: "pass", message: noindex ? "Marked noindex, as intended." : "Allows indexing." }, meta.robots);

  // Open Graph
  const ogKeys = Object.keys(meta.og);
  const ogMissing = REQUIRED_OG.filter((key) => !meta.og[key]);
  const ogValue = ogKeys.length ? ogKeys.join(", ") : null;
  if (ogKeys.length === 0) add("og", missing("Open Graph tags", "are"));
  else if (ogMissing.length) add("og", { level: "warn", message: `Missing ${ogMissing.join(", ")}.` }, ogValue);
  else if (!/^https?:\/\//i.test(meta.og["og:image"]))
    add("og", { level: "warn", message: "og:image is not an absolute URL." }, ogValue);
  else if (expectedCanonical && !sameUrl(meta.og["og:url"], expectedCanonical))
    add("og", { level: "warn", message: `og:url (${meta.og["og:url"]}) differs from the expected URL.` }, ogValue);
  else add("og", { level: "pass", message: "Title, description, URL, image and type are present." }, ogValue);

  // JSON-LD
  const types = [...new Set(meta.jsonLdTypes)].join(", ") || null;
  if (meta.jsonLdInvalid > 0)
    add("jsonld", { level: "error", message: `${meta.jsonLdInvalid} JSON-LD block(s) are not valid JSON.` }, types);
  else if (meta.jsonLdBlocks === 0) add("jsonld", missing("Structured data (JSON-LD)"));
  else add("jsonld", { level: "pass", message: `${meta.jsonLdBlocks} block(s).` }, types);

  return checks;
}

export function countLevels(checks) {
  const counts = { pass: 0, info: 0, warn: 0, error: 0, unverified: 0 };
  for (const check of checks || []) counts[check.level] += 1;
  return counts;
}

export function worstLevel(checks) {
  const counts = countLevels(checks);
  if (counts.error) return "error";
  if (counts.warn) return "warn";
  if (counts.unverified) return "unverified";
  if (counts.pass) return "pass";
  return "info";
}
