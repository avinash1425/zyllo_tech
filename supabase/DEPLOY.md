# Deploying the Supabase side (Lovable)

Nothing here has been applied. Do these steps in order, ideally first against a **staging copy** of the database. Take a backup (Dashboard > Database > Backups) before step 2.

## 1. Connect Lovable to your existing Supabase project
1. In Lovable: project **Settings > Integrations > Supabase** (or the Supabase button) > connect the **existing** Zyllo Tech project (do not create a new one, your data is in it).
2. Lovable exposes the project URL and anon/publishable key to the app. If you set them by hand, go to **Project Settings > Environment variables** and add:
   - `VITE_SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = the **anon / publishable** key (Supabase Dashboard > Project Settings > API)
   - `VITE_SITE_URL` = `https://zyllotech.com`
   Never put the service-role / secret key in any `VITE_` variable.

## 2. Apply the SQL
Supabase Dashboard > **SQL Editor > New query**: paste all of `supabase/policies/001_rls_for_browser_app.sql` > Run. It is re-runnable. (Migrations 001-011 and the two blog SQL files must already have been run; if the DB is fresh, run them first in order.)
Then walk through the **verification checklist** at the bottom of that file.

## 3. Add the admin user
1. Make sure the admin account exists: Dashboard > **Authentication > Users** (create/invite it; email + password login is what the app uses).
2. SQL Editor:
   ```sql
   insert into public.admin_users (user_id, email)
   select id, email from auth.users where email = 'YOUR_ADMIN_EMAIL'
   on conflict (user_id) do nothing;
   ```
   Repeat per admin. Confirm with `select * from public.admin_users;`.
3. Authentication > Providers/Settings: **disable "Allow new users to sign up"** (customer sign-up was rolled back in migration 011; leaving it on lets strangers create non-admin accounts).

## 4. Set secrets
Dashboard > **Edge Functions > Secrets** (or Lovable: Cloud/Supabase > Edge Functions > Secrets):
- `GEMINI_API_KEY` = Google AI Studio key (required for `ai-search`)
- `SITE_URL` = `https://zyllotech.com` (optional, default is the same)
- `GEMINI_MODEL` (optional, default `gemini-3.6-flash`)
- `ALLOWED_ORIGINS` (optional)
- (Later, only if wiring real Search Console data) `GSC_SERVICE_ACCOUNT_JSON`, `GSC_SITE_URL`

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected automatically into every function.

## 5. Deploy the functions
Lovable normally deploys everything under `supabase/functions/` when you publish/sync; the per-function JWT settings come from `supabase/config.toml`. Otherwise, with the Supabase CLI:
```
supabase link --project-ref <project-ref>
supabase functions deploy ai-search --no-verify-jwt
supabase functions deploy sitemap --no-verify-jwt
supabase functions deploy seo-audit
supabase functions deploy search-console
supabase secrets set GEMINI_API_KEY=...
```
or paste each `index.ts` (plus `_shared/*`) via Dashboard > Edge Functions > Deploy a new function > Via Editor. `ai-search` and `sitemap` MUST have "Verify JWT" **off**; `seo-audit` and `search-console` keep it **on**.

Smoke tests:
```
curl -X POST https://<ref>.supabase.co/functions/v1/ai-search -H "apikey: <anon>" -H "Content-Type: application/json" -d '{"query":"What services do you offer?"}'
curl https://<ref>.supabase.co/functions/v1/sitemap
curl https://<ref>.supabase.co/functions/v1/seo-audit -H "Authorization: Bearer <anon>"   # expect 403
```

## 6. Auth redirect URLs (zyllotech.com)
Dashboard > **Authentication > URL Configuration**:
- Site URL: `https://zyllotech.com`
- Redirect URLs: `https://zyllotech.com/**`, `https://www.zyllotech.com/**`, your `https://<project>.lovable.app/**` preview URL, and `http://localhost:5173/**` for local dev.
Then point the domain at Lovable (Lovable > Settings > Domains) and keep `www` redirecting to the chosen canonical host.

## 7. robots.txt and sitemap.xml
- `public/robots.txt` is a static file (replaces `src/app/robots.js`) and is served as-is by Lovable.
- `/sitemap.xml`: the **sitemap** edge function returns the full dynamic sitemap at `https://<ref>.supabase.co/functions/v1/sitemap`. A static SPA host cannot rewrite paths by itself, so choose one:
  1. **Recommended on Lovable**: keep the committed `public/sitemap.xml` (static pages + services) as the served `/sitemap.xml`, and submit the edge function URL as an additional sitemap in Google Search Console (Sitemaps > add `https://<ref>.supabase.co/functions/v1/sitemap`). Note Search Console accepts a sitemap on another host only if it is referenced from the verified site; add a second line `Sitemap: https://<ref>.supabase.co/functions/v1/sitemap` to `public/robots.txt` to satisfy that.
  2. If the domain sits behind Cloudflare/Vercel/Netlify, add a rewrite `/sitemap.xml -> https://<ref>.supabase.co/functions/v1/sitemap` and delete `public/sitemap.xml`.
- The static fallback lacks blog and job URLs; regenerate it when services change.

## 8. Final checks
- Contact form, job application (with PDF), blog view counter and the careers "remaining openings" work while signed out.
- Admin login at `/login`, then every admin section loads; resumes open through signed URLs; portfolio image upload works.
- Reminder: rotate the old Supabase secret key (Dashboard > Project Settings > API) once the Next.js deployment is retired, since it lived in that app's environment.
