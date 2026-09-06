import { describe, expect, it } from "vitest";
import { search } from "@/lib/site-search-index";
import { articles } from "@/data/articles";
import { SERVICES } from "@/data/services";

// Route patterns the search index is allowed to emit. Mirrors the index
// sources: core pages, /services/<slug> from services.js, /blog/<slug>
// from articles.ts.
const CORE_URLS = new Set([
  "/",
  "/about",
  "/services",
  "/industries",
  "/portfolio",
  "/blog",
  "/careers",
  "/contact",
  "/resources",
  "/startups",
  "/arthaai",
  "/custom-software-development-hyderabad",
  "/login",
]);
const serviceSlugs = new Set(SERVICES.map((s: { slug: string }) => s.slug));
const articleSlugs = new Set(articles.map((a) => a.slug));

function isKnownRoute(url: string): boolean {
  if (CORE_URLS.has(url)) return true;
  const service = url.match(/^\/services\/([^/?#]+)$/);
  if (service) return serviceSlugs.has(service[1]);
  const blog = url.match(/^\/blog\/([^/?#]+)$/);
  if (blog) return articleSlugs.has(blog[1]);
  return false;
}

describe("site search index", () => {
  it('ranks the mobile app service first for "mobile app"', () => {
    const results = search("mobile app");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].url).toBe("/services/mobile-app-development");
    expect(results[0].type).toBe("service");
  });

  it("returns articles for a known article topic", () => {
    const results = search("kubernetes cost optimization");
    const articleHits = results.filter((r) => r.type === "article");
    expect(articleHits.length).toBeGreaterThan(0);
    expect(articleHits.map((r) => r.url)).toContain("/blog/kubernetes-cost-optimization");
  });

  it("returns [] for empty queries", () => {
    expect(search("")).toEqual([]);
    expect(search("   ")).toEqual([]);
    expect(search(undefined)).toEqual([]);
  });

  it("returns [] for nonsense queries", () => {
    expect(search("xqzzyvw blorptastic")).toEqual([]);
  });

  it("every result has title, description, url, and type", () => {
    const queries = ["mobile app", "web development", "cloud", "react", "design"];
    for (const q of queries) {
      const results = search(q);
      expect(results.length, `no results for "${q}"`).toBeGreaterThan(0);
      for (const r of results) {
        expect(typeof r.title, `title missing for a "${q}" result`).toBe("string");
        expect(r.title.length).toBeGreaterThan(0);
        expect(typeof r.description, `description missing on ${r.url}`).toBe("string");
        expect(typeof r.url).toBe("string");
        expect(["page", "service", "article"]).toContain(r.type);
      }
    }
  });

  it("every result url starts with / and matches a known route", () => {
    const queries = ["mobile app", "ai", "security", "kubernetes", "hyderabad", "careers"];
    for (const q of queries) {
      for (const r of search(q)) {
        expect(r.url.startsWith("/"), `url ${r.url} for "${q}" is not root-relative`).toBe(true);
        expect(isKnownRoute(r.url), `url ${r.url} for "${q}" is not a known route`).toBe(true);
      }
    }
  });
});
