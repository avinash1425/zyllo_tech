import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { articles } from "@/data/articles";
import { SERVICES } from "@/data/services";

const root = resolve(__dirname, "..", "..");
const sitemapXml = readFileSync(resolve(root, "public/sitemap.xml"), "utf8");
const prerenderSrc = readFileSync(resolve(root, "scripts/prerender.mjs"), "utf8");

const ORIGIN = "https://zyllotech.com";
const locs = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

// Redirect sources from the prerender REDIRECTS map — must never be listed.
function redirectSources(): string[] {
  const block = prerenderSrc.match(/const REDIRECTS\s*=\s*\{([\s\S]*?)\}/);
  expect(block, "REDIRECTS map not found in scripts/prerender.mjs").toBeTruthy();
  return [...block![1].matchAll(/["'](\/[^"']*)["']\s*:/g)].map((m) => m[1]);
}

describe("public/sitemap.xml", () => {
  it("contains URLs", () => {
    expect(locs.length).toBeGreaterThan(20);
  });

  it(`every <loc> starts with ${ORIGIN}`, () => {
    for (const loc of locs) {
      expect(loc.startsWith(ORIGIN), `unexpected origin in ${loc}`).toBe(true);
    }
  });

  it("no URL appears twice", () => {
    const seen = new Set<string>();
    for (const loc of locs) {
      expect(seen.has(loc), `duplicate sitemap URL ${loc}`).toBe(false);
      seen.add(loc);
    }
  });

  it("no trailing-slash URLs except the root", () => {
    for (const loc of locs) {
      if (loc === `${ORIGIN}/`) continue;
      expect(loc.endsWith("/"), `trailing slash on ${loc}`).toBe(false);
    }
  });

  it("no redirect source paths are listed", () => {
    const sources = redirectSources();
    expect(sources.length).toBeGreaterThanOrEqual(6);
    for (const path of sources) {
      expect(locs, `redirect source ${path} must not be in the sitemap`).not.toContain(
        `${ORIGIN}${path}`,
      );
    }
  });

  it("every /blog/<slug> URL matches a real article slug", () => {
    const articleSlugs = new Set(articles.map((a) => a.slug));
    const blogLocs = locs.filter((l) => l.startsWith(`${ORIGIN}/blog/`));
    expect(blogLocs.length).toBeGreaterThan(0);
    for (const loc of blogLocs) {
      const slug = loc.slice(`${ORIGIN}/blog/`.length);
      expect(articleSlugs.has(slug), `sitemap blog slug ${slug} not in articles.ts`).toBe(true);
    }
  });

  it("every /services/<slug> URL matches a real service slug", () => {
    const serviceSlugs = new Set(SERVICES.map((s: { slug: string }) => s.slug));
    const serviceLocs = locs.filter((l) => l.startsWith(`${ORIGIN}/services/`));
    expect(serviceLocs.length).toBeGreaterThan(0);
    for (const loc of serviceLocs) {
      const slug = loc.slice(`${ORIGIN}/services/`.length);
      expect(serviceSlugs.has(slug), `sitemap service slug ${slug} not in services.js`).toBe(true);
    }
  });
});
