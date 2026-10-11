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
Live Google Search Console data through the Lovable connector gateway. Besides
`"status": "ok"` it can answer `"not_connected"` or `"selection_required"`.

Request: `{ "range": "7d" | "28d" | "3m" | "12m" }`
Response:
```json
{ "status": "ok", "siteUrl": "", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD",
  "timeSeries": [{ "date": "YYYY-MM-DD", "clicks": 0, "impressions": 0 }],
  "totals": { "clicks": 0, "impressions": 0, "ctr": 4.54, "avgPosition": 13.1 },
  "topQueries": [{ "label": "", "clicks": 0, "impressions": 0, "ctr": 0, "position": 0 }],
  "topPages": [], "topCountries": [], "deviceBreakdown": [],
  "sitemaps": [{ "label": "", "submitted": 0, "lastDownloaded": null, "errors": 0, "status": "" }],
  "isSampleData": false }
```

Request: `{ "mode": "index-coverage" }` (Admin -> Index Coverage). Inspects every URL in
the live sitemap with the URL Inspection API.
Response:
```json
{ "status": "ok", "siteUrl": "", "checkedAt": "ISO date",
  "totals": { "tracked": 0, "indexed": 0, "notIndexed": 0, "errors": 0 },
  "pages": [{ "url": "", "verdict": "PASS", "coverageState": "", "lastCrawlTime": null,
              "googleCanonical": null }] }
```

## Not edge functions
- Admin global search: client-side supabase queries (`src/lib/api/admin/search.js`).
- Resumes: private bucket; admin lists and signs with `createSignedUrls` (1h) in
  `src/lib/api/admin/resumeUrls.js`; legacy public URLs in `resume_url` are converted to object paths.
- Admin guard: `supabase.rpc('is_admin')`.
