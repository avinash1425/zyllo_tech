// Build-time prerender: writes dist/<route>/index.html for every public
// route with that route's real <title>, meta description, canonical, Open
// Graph tags, JSON-LD, and a semantic HTML body rendered from the same data
// files the React app uses.
//
// Why this exists: the SPA serves one identical HTML shell (homepage title +
// canonical, empty <div id="root">) for every URL. Googlebot reads that raw
// HTML *before* deciding whether to spend render budget, and non-rendering
// crawlers (GPTBot, ClaudeBot, PerplexityBot, CCBot) never execute JS at all
// — so to them every page was a blank duplicate of the homepage. The host
// serves static directory index files ahead of the SPA fallback (proven by
// public/arthaai/index.html being live at /arthaai), so these files become
// what crawlers see, while the browser app boots identically on top of them
// (src/main.tsx uses createRoot().render(), which replaces #root wholesale —
// no hydration mismatch is possible).
//
// Head tags are written with data-rh="true" so react-helmet-async adopts and
// replaces them cleanly at runtime, same convention as index.html.
//
// DELIBERATELY FAIL-SOFT: any error leaves the normal SPA build untouched
// and exits 0. A missing prerender is a much smaller problem than a broken
// production deploy.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const SITE_URL = process.env.VITE_SITE_URL || "https://zyllotech.com";

const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

// JSON-LD may contain "</script>"-like sequences in text; escape the slash.
const ldjson = (obj) => JSON.stringify(obj).replaceAll("</", "\\u003c/");

async function main() {
  const templatePath = path.join(DIST, "index.html");
  if (!existsSync(templatePath)) {
    console.warn("[prerender] dist/index.html not found — skipping.");
    return;
  }
  const template = readFileSync(templatePath, "utf8");

  // ── Load app data through Vite so TS + aliases resolve identically to the
  //    app build, regardless of the Node version running this script.
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: ROOT,
    logLevel: "error",
    server: { middlewareMode: true },
    appType: "custom",
  });

  let SERVICES = [], SERVICE_DETAILS = {}, fallbackPosts = [];
  let organizationSchema = null, webSiteSchema = null, serviceSchema = null, breadcrumbSchema = null;
  try {
    ({ SERVICES } = await vite.ssrLoadModule("/src/data/services.js"));
    ({ SERVICE_DETAILS } = await vite.ssrLoadModule("/src/data/service-details.js"));
    ({ fallbackPosts } = await vite.ssrLoadModule("/src/data/fallback-content.js"));
    ({ organizationSchema, webSiteSchema, serviceSchema, breadcrumbSchema } =
      await vite.ssrLoadModule("/src/components/SEOHead.tsx"));
  } finally {
    await vite.close();
  }

  const crumbs = (items) =>
    breadcrumbSchema
      ? breadcrumbSchema(items)
      : {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
        };

  // ── Head + body assembly ──────────────────────────────────────────────────
  function renderPage({ title, description, canonicalPath, ogImage, schemas, body }) {
    let html = template;
    const canonical = `${SITE_URL}${canonicalPath}`;
    html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
    html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(description)}$2`);
    html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${esc(canonical)}$2`);
    html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${esc(canonical)}$2`);
    html = html.replace(/(<meta property="og:title" content=")[^"]*(")/g, `$1${esc(title)}$2`);
    html = html.replace(/(<meta name="twitter:title" content=")[^"]*(")/g, `$1${esc(title)}$2`);
    html = html.replace(/(<meta property="og:description" content=")[^"]*(")/g, `$1${esc(description)}$2`);
    html = html.replace(/(<meta name="twitter:description" content=")[^"]*(")/g, `$1${esc(description)}$2`);
    if (ogImage) {
      html = html.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${esc(ogImage)}$2`);
      html = html.replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${esc(ogImage)}$2`);
    }
    const allSchemas = [organizationSchema, webSiteSchema, ...(schemas || [])].filter(Boolean);
    const ld = allSchemas
      .map((s) => `<script type="application/ld+json" data-rh="true">${ldjson(s)}</script>`)
      .join("\n");
    html = html.replace("</head>", `${ld}\n</head>`);
    if (body) {
      html = html.replace(
        /<div id="root"><\/div>/,
        `<div id="root"><div style="font-family:system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:2.5rem 1.5rem;line-height:1.65;color:#1d2735">${body}</div></div>`,
      );
    }
    return html;
  }

  function writeRoute(routePath, html) {
    const dir = routePath === "/" ? DIST : path.join(DIST, routePath.replace(/^\//, ""));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "index.html"), html);
  }

  const navLinks = `<nav><p><a href="/">Home</a> · <a href="/about">About</a> · <a href="/services">Services</a> · <a href="/industries">Industries</a> · <a href="/portfolio">Portfolio</a> · <a href="/blog">Blog</a> · <a href="/careers">Careers</a> · <a href="/contact">Contact</a></p></nav>`;

  let written = 0;

  // ── Core pages ────────────────────────────────────────────────────────────
  const CORE = [
    { p: "/", t: "Zyllo Tech | Software Development, AI & Cloud Engineering", d: "Zyllo Tech builds scalable web, mobile, AI and cloud solutions for growing businesses and enterprises.", h1: "Zyllo Tech Software Solutions — Web, Mobile, AI & Cloud Engineering" },
    { p: "/about", t: "About Us | Zyllo Tech", d: "Zyllo Tech is an India-based software company partnering with businesses to design, build, and support intelligent digital products.", h1: "Building Digital Solutions That Drive Growth" },
    { p: "/services", t: "Software Development Services | Web, Mobile, AI, Cloud | Zyllo Tech", d: "Web, mobile, AI, cloud, and security engineering services from Zyllo Tech — end-to-end software delivery under one team.", h1: "Technology Solutions for Modern Businesses" },
    { p: "/industries", t: "Industries | Zyllo Tech", d: "Zyllo Tech builds software for startups, healthcare, finance, retail, logistics, and more — solutions shaped around how each industry actually works.", h1: "Software shaped around how your industry actually works" },
    { p: "/portfolio", t: "Portfolio | Zyllo Tech", d: "A look at the kind of web, mobile, AI, and cloud projects Zyllo Tech builds — from featured work to case studies and our development process.", h1: "A look at what we build" },
    { p: "/resources", t: "Technical Resources & Industry Software Implementation Guides | Zyllo Tech", d: "Free engineering playbooks and implementation blueprints for Banking, Healthcare, E-Commerce, EdTech, Logistics, Manufacturing, Gaming, Real Estate, Travel, Telecom, Media, and AgriTech software development.", h1: "Resources Hub" },
    { p: "/blog", t: "Blog | Zyllo Tech", d: "Practical notes on engineering, design, AI, and product strategy from the Zyllo Tech team.", h1: "Ideas, lessons, and notes from the team" },
    { p: "/careers", t: "Careers | Zyllo Tech", d: "Join the team building software at Zyllo Tech. Explore open roles, life at the company, and the benefits of working with us.", h1: "Grow Your Career with Zyllo Tech" },
    { p: "/contact", t: "Contact | Zyllo Tech", d: "Get in touch with Zyllo Tech to discuss your next web, mobile, AI, or cloud project.", h1: "Let's talk about your project" },
    { p: "/startups", t: "Startups by Zyllo Tech | ArthaAI — AI-Powered Finance for India", d: "Discover startups incubated and built by Zyllo Tech. ArthaAI is India's first multilingual AI-powered personal finance platform, democratising financial guidance for 400M+ Indians.", h1: "Our Startups" },
    { p: "/sitemap", t: "Sitemap | Zyllo Tech", d: "A complete overview of every page on the Zyllo Tech website — services, industries, blog, careers, and legal pages.", h1: "Sitemap" },
    { p: "/privacy-policy", t: "Privacy Policy | Zyllo Tech", d: "How Zyllo Tech collects, uses, and protects information when you visit zyllotech.com, including our use of cookies.", h1: "Privacy Policy" },
    { p: "/terms-of-service", t: "Terms of Service | Zyllo Tech", d: "The terms governing use of zyllotech.com and Zyllo Tech's software design, development, and support services.", h1: "Terms of Service" },
    { p: "/cookie-policy", t: "Cookie Policy | Zyllo Tech", d: "Understand how Zyllo Tech uses cookies and similar technologies on our website. Learn what cookies we set, why, and how to manage your preferences.", h1: "Cookie Policy" },
  ];

  const serviceLinkList = SERVICES.map(
    (s) => `<li><a href="/services/${esc(s.slug)}">${esc(s.title)}</a> — ${esc(s.tagline)}</li>`,
  ).join("");

  for (const page of CORE) {
    const isHome = page.p === "/";
    const schemas = isHome
      ? []
      : [crumbs([{ name: "Home", url: SITE_URL }, { name: page.h1, url: `${SITE_URL}${page.p}` }])];
    let body = `<header>${navLinks}<h1>${esc(page.h1)}</h1><p>${esc(page.d)}</p></header>`;
    if (isHome || page.p === "/services") {
      body += `<section><h2>Our Services</h2><ul>${serviceLinkList}</ul></section>`;
    }
    if (page.p === "/blog" || page.p === "/resources") {
      body += `<section><h2>Latest Articles</h2><ul>${fallbackPosts
        .map((post) => `<li><a href="/blog/${esc(post.slug)}">${esc(post.title)}</a></li>`)
        .join("")}</ul></section>`;
    }
    writeRoute(page.p, renderPage({ title: page.t, description: page.d, canonicalPath: page.p, schemas, body }));
    written++;
  }

  // ── Service pages ─────────────────────────────────────────────────────────
  for (const s of SERVICES) {
    const det = SERVICE_DETAILS[s.slug] || {};
    const routePath = `/services/${s.slug}`;
    const title = det.seoTitle || `${s.title} | Zyllo Tech`;
    const description = det.seoDescription || s.description;
    const schemas = [
      crumbs([
        { name: "Home", url: SITE_URL },
        { name: "Services", url: `${SITE_URL}/services` },
        { name: s.title, url: `${SITE_URL}${routePath}` },
      ]),
      serviceSchema
        ? serviceSchema({ name: s.title, description: s.description, url: `${SITE_URL}${routePath}` })
        : null,
    ];
    let body = `<header>${navLinks}<h1>${esc(s.title)}</h1><p><em>${esc(s.tagline)}</em></p><p>${esc(s.description)}</p></header>`;
    body += `<section><h2>What We Deliver</h2><p>${esc(s.overview)}</p><ul>${s.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul></section>`;
    if (det.process) {
      body += `<section><h2>Our ${esc(s.title)} Process</h2><ol>${det.process
        .map((st) => `<li><strong>${esc(st.title)}.</strong> ${esc(st.text)}</li>`)
        .join("")}</ol></section>`;
    }
    if (det.deliverables) {
      body += `<section><h2>What You Get</h2><ul>${det.deliverables.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>`;
    }
    if (det.stack) {
      body += `<section><h2>Technology We Use</h2><p>${det.stack.map(esc).join(" · ")}</p></section>`;
    }
    if (det.faqs) {
      body += `<section><h2>${esc(s.title)} — Common Questions</h2>${det.faqs
        .map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`)
        .join("")}</section>`;
    }
    body += `<footer><p><a href="/services">All services</a> · <a href="/contact">Contact Zyllo Tech</a></p></footer>`;
    writeRoute(routePath, renderPage({ title, description, canonicalPath: routePath, schemas, body }));
    written++;
  }

  // ── Blog posts ────────────────────────────────────────────────────────────
  // Inline [label](href) links inside block text — mirrors renderInline in
  // src/pages/BlogPostPage.jsx. Escape the whole string first; the link
  // syntax uses only [ ] ( ) so it survives esc() untouched.
  const inline = (s) =>
    esc(s).replace(/\[([^\]]+)\]\((\/[^)\s]*|https?:\/\/[^)\s]+)\)/g, (_, label, href) =>
      href.startsWith("/")
        ? `<a href="${href}">${label}</a>`
        : `<a href="${href}" rel="noopener noreferrer">${label}</a>`,
    );
  const blockHtml = (b) => {
    switch (b.type) {
      case "h2": return `<h2>${esc(b.text)}</h2>`;
      case "h3": return `<h3>${esc(b.text)}</h3>`;
      case "ul": return `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`;
      case "ol": return `<ol>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ol>`;
      case "callout": return `<aside><p>${inline(b.text)}</p></aside>`;
      case "metrics": return `<ul>${b.items.map((i) => `<li>${esc(i.label)}: ${esc(i.value)}</li>`).join("")}</ul>`;
      default: return `<p>${inline(b.text)}</p>`;
    }
  };

  for (const post of fallbackPosts) {
    const routePath = `/blog/${post.slug}`;
    const title = `${post.title} | Zyllo Tech`;
    const description = post.excerpt || "";
    const image = post.featured_image_url?.startsWith("/")
      ? `${SITE_URL}${post.featured_image_url}`
      : post.featured_image_url;
    const articleSchema = {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: post.title,
      description: post.excerpt || undefined,
      image: [image],
      datePublished: post.created_at,
      dateModified: post.updated_at || post.created_at,
      author: post.author ? { "@type": "Person", name: post.author } : { "@type": "Organization", name: "Zyllo Tech" },
      publisher: { "@id": `${SITE_URL}/#organization` },
      mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}${routePath}` },
    };
    const schemas = [
      crumbs([
        { name: "Home", url: SITE_URL },
        { name: "Blog", url: `${SITE_URL}/blog` },
        { name: post.title, url: `${SITE_URL}${routePath}` },
      ]),
      articleSchema,
    ];
    const related = fallbackPosts
      .filter((p) => p.category === post.category && p.slug !== post.slug)
      .slice(0, 3);
    let body = `<header>${navLinks}<p><a href="/blog">← Blog</a></p><h1>${esc(post.title)}</h1><p>${esc(post.excerpt || "")}</p><p><small>${esc(post.author || "Zyllo Tech")} · ${esc((post.created_at || "").slice(0, 10))} · ${esc(post.category)}</small></p></header>`;
    body += `<article>${(post.blocks || []).map(blockHtml).join("")}</article>`;
    if (related.length) {
      body += `<section><h2>Related Reading</h2><ul>${related
        .map((p) => `<li><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></li>`)
        .join("")}</ul></section>`;
    }
    writeRoute(routePath, renderPage({ title, description, canonicalPath: routePath, ogImage: image, schemas, body }));
    written++;
  }

  console.log(`[prerender] wrote ${written} routes into dist/`);
}

main().catch((err) => {
  console.warn("[prerender] failed (build continues, SPA fallback intact):", err?.message || err);
  process.exitCode = 0;
});
