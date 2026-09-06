// Client-side search index over everything public on the site: core pages,
// the service catalog (src/data/services.js + service-details.js), and blog
// articles (src/data/articles.ts). Replaces the old /api/search and
// /api/ai-search backends, which never existed in this Vite SPA — search is
// now a pure in-browser keyword match with no network round-trip.
//
// Bundle note: articles.ts is large, so this module must only ever be loaded
// via dynamic import() from the search UIs (triggered on first open). A static
// import from anything mounted in the Header would drag the whole blog
// archive into the main bundle.
import { articles } from "@/data/articles";
import { SERVICES } from "@/data/services";
import { SERVICE_DETAILS } from "@/data/service-details";

// Core pages that aren't derived from a data file. Keep descriptions short —
// they render as the result subtitle.
const CORE_PAGES = [
  { title: "Home", description: "Zyllo Tech — custom software development company in Hyderabad, India.", url: "/" },
  { title: "About Us", description: "Our story, mission, values, and the team behind Zyllo Tech.", url: "/about" },
  { title: "Services", description: "Everything we build and support — web, mobile, cloud, AI, and more.", url: "/services" },
  { title: "Industries", description: "Sectors we work with, from healthcare to fintech and retail.", url: "/industries" },
  { title: "Portfolio", description: "Case studies and past work delivered for our clients.", url: "/portfolio" },
  { title: "Blog", description: "Articles and practical notes on engineering, design, AI, and product.", url: "/blog" },
  { title: "Careers", description: "Open roles and what it's like to work at Zyllo Tech.", url: "/careers" },
  { title: "Contact Us", description: "Get in touch for a quote, a project inquiry, or anything else.", url: "/contact" },
  { title: "Resources", description: "Guides, checklists, and tools for planning software projects.", url: "/resources" },
  { title: "Startups", description: "MVP development and product engineering for startups.", url: "/startups" },
  { title: "ArthaAI", description: "ArthaAI — our AI-powered finance product.", url: "/arthaai" },
  { title: "Custom Software Development in Hyderabad", description: "Local software development services for businesses in Hyderabad.", url: "/custom-software-development-hyderabad" },
  { title: "Login", description: "Sign in to your Zyllo Tech account.", url: "/login" },
];

// Very common words that carry no signal in queries like
// "what services do you offer?" — dropped before matching.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "for", "in", "on", "at", "by",
  "do", "does", "did", "you", "your", "we", "our", "us", "is", "are", "was",
  "what", "which", "how", "who", "can", "with", "about", "i", "me", "my",
  "it", "this", "that", "get", "have", "offer", "need", "zyllo", "tech",
]);

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function buildEntry({ title, description, url, type, extraText = "" }) {
  return {
    title,
    description,
    url,
    type,
    titleTokens: tokenize(title),
    bodyTokens: tokenize(`${description} ${extraText}`),
  };
}

// The index is built once at module load. It stays small on purpose: article
// entries index title/excerpt/category/tags/meta — not the full content
// blocks, which would slow every keystroke for near-zero relevance gain.
const INDEX = [
  ...CORE_PAGES.map((page) => buildEntry({ ...page, type: "page" })),

  ...SERVICES.map((service) => {
    const details = SERVICE_DETAILS[service.slug] || {};
    return buildEntry({
      title: service.title,
      description: service.description || service.tagline,
      url: `/services/${service.slug}`,
      type: "service",
      extraText: [
        service.tagline,
        service.overview,
        ...(service.subServices || []),
        ...(service.highlights || []),
        ...(details.stack || []),
        details.seoDescription,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }),

  ...articles.map((article) =>
    buildEntry({
      title: article.title,
      description: article.excerpt,
      url: `/blog/${article.slug}`,
      type: "article",
      extraText: [article.category, ...(article.tags || []), article.metaDescription]
        .filter(Boolean)
        .join(" "),
    })
  ),
];

function scoreToken(token, entry) {
  let best = 0;
  for (const word of entry.titleTokens) {
    if (word === token) return 8;
    if (word.startsWith(token) || token.startsWith(word)) best = Math.max(best, 5);
  }
  for (const word of entry.bodyTokens) {
    if (word === token) best = Math.max(best, 3);
    else if (word.startsWith(token)) best = Math.max(best, 2);
  }
  return best;
}

/**
 * Search the site index.
 *
 * Case-insensitive, tokenized keyword match. Title matches rank above body
 * matches, prefix matches count, and results covering more of the query rank
 * higher. Returns [{ title, description, url, type: 'page'|'service'|'article' }].
 */
export function search(query, { limit = 8 } = {}) {
  const rawTokens = tokenize(query);
  if (rawTokens.length === 0) return [];
  // Drop stopwords, but never down to nothing — "about us" must still work.
  const meaningful = rawTokens.filter((t) => !STOPWORDS.has(t));
  const tokens = meaningful.length > 0 ? meaningful : rawTokens;

  const scored = [];
  for (const entry of INDEX) {
    let score = 0;
    let matched = 0;
    for (const token of tokens) {
      const tokenScore = scoreToken(token, entry);
      if (tokenScore > 0) matched += 1;
      score += tokenScore;
    }
    if (matched === 0) continue;
    // Weight by query coverage so results matching more of the query win.
    scored.push({ entry, score: score * (matched / tokens.length) });
  }

  scored.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));

  return scored.slice(0, limit).map(({ entry }) => ({
    title: entry.title,
    description: entry.description,
    url: entry.url,
    type: entry.type,
  }));
}
