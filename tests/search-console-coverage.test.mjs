// Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyError,
  ERROR_LABELS,
  INSPECT_MAX_URLS,
  parseSitemap,
  rankRows,
  summarize,
} from "../supabase/functions/search-console/coverage.ts";

const sitemap = (urls) =>
  `<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("\n")}</urlset>`;

test("one run inspects at most 100 URLs", () => {
  assert.equal(INSPECT_MAX_URLS, 100);
});

test("parseSitemap reads, trims, de-duplicates and decodes URLs", () => {
  const xml = `<urlset>
    <url><loc> https://zyllotech.com/ </loc><lastmod>2026-10-10</lastmod></url>
    <url><loc>https://zyllotech.com/about</loc></url>
    <url><loc>https://zyllotech.com/about</loc></url>
    <url><loc>https://zyllotech.com/search?a=1&amp;b=2</loc></url>
  </urlset>`;
  assert.deepEqual(parseSitemap(xml), {
    urls: ["https://zyllotech.com/", "https://zyllotech.com/about", "https://zyllotech.com/search?a=1&b=2"],
    total: 3,
    truncated: false,
  });
});

test("parseSitemap caps a large sitemap and reports the real size", () => {
  const urls = Array.from({ length: 140 }, (_, i) => `https://zyllotech.com/p/${i}`);
  const parsed = parseSitemap(sitemap(urls));
  assert.equal(parsed.urls.length, 100);
  assert.equal(parsed.total, 140);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.urls[99], "https://zyllotech.com/p/99");
});

test("parseSitemap at exactly the cap is not truncated", () => {
  const parsed = parseSitemap(sitemap(Array.from({ length: 100 }, (_, i) => `https://zyllotech.com/p/${i}`)));
  assert.equal(parsed.urls.length, 100);
  assert.equal(parsed.truncated, false);
});

test("parseSitemap counts duplicates once when deciding truncation", () => {
  const urls = Array.from({ length: 150 }, (_, i) => `https://zyllotech.com/p/${i % 60}`);
  assert.deepEqual(
    (({ total, truncated }) => ({ total, truncated }))(parseSitemap(sitemap(urls))),
    { total: 60, truncated: false },
  );
});

test("parseSitemap on empty or non-sitemap content", () => {
  assert.deepEqual(parseSitemap(""), { urls: [], total: 0, truncated: false });
  assert.deepEqual(parseSitemap("<html><body>Not found</body></html>"), { urls: [], total: 0, truncated: false });
});

test("classifyError recognises an exhausted quota", () => {
  assert.equal(classifyError(429, "Too Many Requests"), "quota");
  assert.equal(classifyError(403, '{"error":{"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}}'), "quota");
  assert.equal(classifyError(403, "rateLimitExceeded"), "quota");
});

test("classifyError separates permission, timeout and other failures", () => {
  assert.equal(classifyError(401, "Unauthorized"), "auth");
  assert.equal(classifyError(403, "User does not have sufficient permission for site"), "auth");
  assert.equal(classifyError(undefined, "TimeoutError: Signal timed out."), "timeout");
  assert.equal(classifyError(undefined, "AbortError: The operation was aborted"), "timeout");
  assert.equal(classifyError(500, "Internal error"), "other");
  assert.equal(classifyError(404, "Not found"), "other");
  assert.equal(classifyError(undefined, "TypeError: network unreachable"), "other");
});

test("every error code has a label", () => {
  for (const code of ["quota", "auth", "timeout", "other", "skipped"]) {
    assert.equal(typeof ERROR_LABELS[code], "string");
  }
});

test("summarize counts indexed, not indexed and failed checks", () => {
  const pages = [
    { verdict: "PASS" },
    { verdict: "PASS" },
    { verdict: "NEUTRAL" },
    { verdict: "FAIL" },
    { verdict: "VERDICT_UNSPECIFIED" },
    { verdict: "ERROR" },
  ];
  assert.deepEqual(summarize(pages), { tracked: 6, indexed: 2, notIndexed: 3, errors: 1 });
  assert.deepEqual(summarize([]), { tracked: 0, indexed: 0, notIndexed: 0, errors: 0 });
});

test("summarize totals always add up to the URLs inspected", () => {
  const verdicts = ["PASS", "NEUTRAL", "ERROR", "FAIL", "PASS", "ERROR", "PARTIAL"];
  const t = summarize(verdicts.map((verdict) => ({ verdict })));
  assert.equal(t.indexed + t.notIndexed + t.errors, t.tracked);
});

test("rankRows orders by clicks, then impressions", () => {
  const rows = [
    { label: "a", clicks: 0, impressions: 1 },
    { label: "b", clicks: 0, impressions: 9 },
    { label: "c", clicks: 2, impressions: 3 },
    { label: "d", clicks: 2, impressions: 7 },
  ];
  assert.deepEqual(rankRows(rows, 50).map((r) => r.label), ["d", "c", "b", "a"]);
});

test("rankRows keeps the top 50 and leaves its input untouched", () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ label: `q${i}`, clicks: 0, impressions: i }));
  const first = rows[0];
  const top = rankRows(rows, 50);
  assert.equal(top.length, 50);
  assert.equal(top[0].impressions, 119);
  assert.equal(top[49].impressions, 70);
  assert.equal(rows[0], first);
  assert.equal(rows.length, 120);
});
