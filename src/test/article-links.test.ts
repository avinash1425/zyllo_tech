import { describe, expect, it } from "vitest";
import { articles } from "@/data/articles";
import { fallbackPosts } from "@/data/fallback-content";
import { SERVICES } from "@/data/services";

// Same syntax accepted by renderInline (BlogPostPage.jsx), the prerender
// `inline` helper (scripts/prerender.mjs), and stripLinks (fallback-content.js).
const INLINE_LINK = /\[([^\]]+)\]\((\/[^)\s]*|https?:\/\/[^)\s]+)\)/g;

function blockTexts(content: (typeof articles)[number]["content"]): string[] {
  return content.flatMap((block) => {
    if ("text" in block) return [block.text];
    if (block.type === "ul" || block.type === "ol") return block.items;
    return [];
  });
}

function extractLinks(text: string): Array<{ label: string; href: string }> {
  return [...text.matchAll(INLINE_LINK)].map((m) => ({ label: m[1], href: m[2] }));
}

describe("article inline links", () => {
  const serviceSlugs = new Set(SERVICES.map((s: { slug: string }) => s.slug));
  const articleSlugs = new Set(articles.map((a) => a.slug));
  // Static routes that article bodies are allowed to point at.
  const staticPaths = new Set(["/contact", "/resources", "/about", "/portfolio", "/industries", "/careers", "/blog", "/services"]);

  const allLinks = articles.flatMap((a) =>
    blockTexts(a.content).flatMap((text) =>
      extractLinks(text).map((link) => ({ ...link, slug: a.slug })),
    ),
  );

  it("finds links to validate", () => {
    expect(allLinks.length).toBeGreaterThan(0);
  });

  it("every internal link resolves to a real route", () => {
    for (const { href, slug } of allLinks) {
      if (!href.startsWith("/")) continue;
      const service = href.match(/^\/services\/([^/?#]+)$/);
      const blog = href.match(/^\/blog\/([^/?#]+)$/);
      const ok = service
        ? serviceSlugs.has(service[1])
        : blog
          ? articleSlugs.has(blog[1])
          : staticPaths.has(href);
      expect(ok, `dead internal link ${href} in article ${slug}`).toBe(true);
    }
  });

  it("external links are https", () => {
    for (const { href, slug } of allLinks) {
      if (href.startsWith("/")) continue;
      expect(href.startsWith("https://"), `non-https link ${href} in article ${slug}`).toBe(true);
    }
  });

  it("flattened fallback content has link syntax stripped", () => {
    for (const post of fallbackPosts) {
      expect(extractLinks(post.content), `unstripped link syntax in ${post.slug}`).toEqual([]);
    }
  });
});
