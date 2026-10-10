# Admin edge function contracts (as implemented in supabase/functions/*)

All called with `supabase.functions.invoke(name, { body })` under the signed-in admin
session; both are admin-only (`is_admin()`).

## seo-audit
No longer called by the app. Admin -> SEO now measures robots.txt, sitemap.xml and
page HTML in the browser (`src/lib/api/admin/seo.js`, `src/lib/seo/audit-core.js`),
because this function only returned hardcoded robots rules and a calculated sitemap
count. The function is left in place and unchanged. No request body.
Response:
```json
{ "siteUrl": "", "isPlaceholderDomain": false, "sitemapUrlCount": 0,
  "robotsDisallow": ["/admin", "/login", "/api"], "robotsAllow": "/",
  "publishedBlogPosts": 0, "openJobPostings": 0 }
```

## search-console
Used by `src/lib/api/admin/searchConsole.js`.
Request: `{ "range": "7d" | "28d" | "3m" | "12m" }`
Response (sample data, `isSampleData: true`):
```json
{ "timeSeries": [{ "date": "YYYY-MM-DD", "clicks": 0, "impressions": 0 }],
  "totals": { "clicks": 0, "impressions": 0, "ctr": 4.54, "avgPosition": 13.1 },
  "topQueries": [{ "label": "", "clicks": 0, "impressions": 0, "ctr": 0, "position": 0 }],
  "topPages": [], "topCountries": [], "deviceBreakdown": [],
  "sitemaps": [{ "label": "", "submitted": 0, "indexed": null, "status": "" }],
  "isSampleData": true }
```

## Not edge functions
- Admin global search: client-side supabase queries (`src/lib/api/admin/search.js`).
- Resumes: private bucket; admin lists and signs with `createSignedUrls` (1h) in
  `src/lib/api/admin/resumeUrls.js`; legacy public URLs in `resume_url` are converted to object paths.
- Admin guard: `supabase.rpc('is_admin')`.
