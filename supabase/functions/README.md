# Edge Functions

All server-side logic of the old Next.js app. Deno runtime, `supabase-js` via esm.sh. Nothing here uses the service-role key: admin functions act with the **caller's JWT** and RLS (`public.is_admin()`), public functions use the anon key.

| Function | Access | Method / request | Response | Secrets |
|---|---|---|---|---|
| `ai-search` | public (`verify_jwt=false`) | POST `{ "query": string }` (max 500 chars, body max 4 KB) | `{ "reply": string }` or `{ "error": string }` (400/413/502/503) | `GEMINI_API_KEY` (required), `GEMINI_MODEL` (optional) |
| `sitemap` | public (`verify_jwt=false`) | GET | `application/xml` sitemap: static routes + services + published blog posts + open jobs | `SITE_URL` (optional) |
| `seo-audit` | admin only | GET/POST, no body | `{ siteUrl, isPlaceholderDomain, sitemapUrlCount, robotsDisallow, robotsAllow, publishedBlogPosts, openJobPostings }` | `SITE_URL` (optional) |
| `search-console` | admin only | GET/POST `{ "range": "7d"\|"28d"\|"3m"\|"12m" }` (or `?range=`) | `{ timeSeries, totals, topQueries, topPages, topCountries, deviceBreakdown, sitemaps, isSampleData }` | none today (see below) |

Admin functions need the header `Authorization: Bearer <user access token>`; `supabase.functions.invoke("seo-audit")` adds it automatically when the user is signed in. Non-admins get `403 {"error":"Forbidden"}`.

Client usage:

```js
const { data, error } = await supabase.functions.invoke("ai-search", { body: { query } });
const { data } = await supabase.functions.invoke("search-console", { body: { range: "28d" } });
```

Shared code lives in `_shared/` (`cors.ts`, `auth.ts`, `services.ts`). `_shared/services.ts` is a **generated copy** of `src/data/services.js`; update it when services change (used by the AI prompt, the sitemap and the SEO audit).

Optional secret `ALLOWED_ORIGINS` (comma-separated) overrides the CORS allow-list (default: zyllotech.com, www.zyllotech.com, localhost:5173/8080 and `*.lovable.app` / `*.lovableproject.com`).

## Why there is no `search` function

The old `/api/search` and `/api/admin/search` only read data that the anon key can already read (published posts, open jobs) or that an admin can read (everything), so they need no privileged access. Port them to the browser: filter the static page/service lists client-side and query Supabase directly, e.g.

```js
supabase.from("blog_posts").select("title, slug, category, excerpt").eq("status","published")
  .or(`title.ilike.${like},category.ilike.${like},excerpt.ilike.${like}`).limit(5);
```

RLS (`supabase/policies/001_rls_for_browser_app.sql`) guarantees anonymous visitors only ever get published/open rows, and admin search works because the signed-in admin passes `is_admin()`. Avoid interpolating raw user input into `.or()` without stripping commas/parentheses.

## search-console

The Next version only returned labelled sample data (`isSampleData: true`) and so does this one. Real data needs the site verified in Google Search Console, the Search Console API enabled, and a service account added as a property user; then store its JSON as secret `GSC_SERVICE_ACCOUNT_JSON`, the property as `GSC_SITE_URL`, and replace `sample()` with Search Analytics API calls.

## Other behaviour moved elsewhere

- `increment_blog_post_views`, `job_openings_remaining()` (remaining slots for open jobs, replaces the old service-key query of `hired` applications) are SQL functions callable with `supabase.rpc(...)`.
- Contact/apply/view inserts are plain browser inserts guarded by RLS check constraints; no function needed.
