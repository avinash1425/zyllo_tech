# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The [Zyllo Tech](https://zyllotech.com) company website — a Vite + React 18 SPA using React Router, shadcn/ui (Radix + Tailwind), and Supabase (auth, Postgres, storage, edge functions). Developed and published through **Lovable**: pushes to the GitHub `main` branch sync into Lovable and vice versa, and production deploys happen via Lovable Publish, not from this machine. Always pull before working — a stale local checkout pushed to `main` will overwrite Lovable-side edits.

**This is NOT a Next.js project.** It was migrated from Next.js to Vite. Ignore `AGENTS.md` (stale Next.js agent rules), the `.next/` directory, and Next.js entries in `.gitignore` — they are leftovers. `src/components/NextCompat.tsx` exists to wrap react-router with Next-style `Link`/hooks APIs for components written during the Next.js era.

## Commands

```bash
npm run dev          # dev server on http://localhost:8080 (not 5173 — see vite.config.ts)
npm run build        # prebuild: sitemap gen → vite build → postbuild: prerender
npm run lint         # eslint .
npm test             # vitest run (jsdom + testing-library, setup in src/test/setup.ts)
npm run test:watch   # vitest watch mode
npx vitest run src/test/example.test.ts   # run a single test file
```

## Architecture

- `src/App.tsx` — the routing table. Every page is lazy-loaded. It also holds **legacy-slug redirects** (old service URLs, `/privacy` → `/privacy-policy`, etc.) that still receive indexed traffic; don't remove them, and add a redirect here when renaming a public URL.
- `src/pages/` — one component per route. `src/sections/` — large page-composition blocks (hero, testimonials, etc.) used by pages. `src/components/` — shared components; `src/components/ui/` is shadcn. The codebase is a `.jsx`/`.tsx` mix; match whichever the file you're touching uses.
- `src/data/` — static content is code, not a CMS: `services.js` + `service-details.js` (service catalog), `articles.ts` (blog posts), `fallback-content.js`, `legal-content.js`. Editing site copy usually means editing these files.
- `src/integrations/supabase/client.ts` — the single Supabase client. It has a **deliberate hard-coded fallback** to the public anon key/URL because Lovable's custom-domain publish pipeline has been observed to skip Connector env injection (`VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`). Do not remove the fallback; it is the public RLS-scoped anon key, safe in the browser.
- Auth: `src/contexts/AuthContext.tsx` + `src/lib/auth.ts`; `/admin` is gated by `ProtectedRoute requireAdmin`.
- Supabase backend: migrations in `supabase/migrations/`, edge function `supabase/functions/notify-admin`. Job postings, contact/application submissions, and the application pipeline live in Postgres and are managed via the admin dashboard.
- Path alias: `@/` → `src/`.

## Build-time SEO pipeline (load-bearing)

SEO is a standing priority for this site; the build has two custom steps in `scripts/`:

- `generate-sitemap.mjs` (prebuild) — fetches live open job postings from Supabase and injects `/careers/:id` URLs into `public/sitemap.xml`.
- `prerender.mjs` (postbuild) — writes `dist/<route>/index.html` for every public route with that route's real title, meta description, canonical, OG tags, JSON-LD, and a semantic HTML body. This is what non-rendering crawlers (Googlebot pre-render, GPTBot, ClaudeBot, etc.) see; the browser SPA replaces `#root` wholesale on top of it, so no hydration concerns.

Both scripts are **deliberately fail-soft** (log and exit 0 on any error) — a missing sitemap entry or prerender is smaller than a broken deploy. Keep that property.

Consequences:
- **Adding a public page** requires four touches: route in `App.tsx`, entry in the `CORE` list (or data-driven section) of `scripts/prerender.mjs`, URL in `public/sitemap.xml`, and an `SEOHead` usage in the page.
- `src/components/SEOHead.tsx` exports the site constants and JSON-LD schema builders used both at runtime (react-helmet-async) and by `prerender.mjs` at build time — changes there affect both.
- Service and blog prerenders derive from the `src/data/` files, so content edits there flow into prerendered HTML automatically on the next build.
