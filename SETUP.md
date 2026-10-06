# Zyllo Tech website: complete setup

Everything needed to run or rebuild this project. Nothing secret is stored in Git.

## 1. What lives where

| Piece | Where it lives | In Git? |
|---|---|---|
| App source code (Vite + React) | `src/`, `public/`, `index.html`, `vite.config.js` | Yes |
| Package list + exact versions | `package.json`, `package-lock.json` | Yes |
| Installed packages | `node_modules/` (created by `npm install`) | No (rebuilt from the lock file) |
| Browser-safe settings | `.env` (`VITE_` values) and `.env.example` | Yes |
| Local overrides | `.env.local` | No |
| Database structure (tables, functions, triggers, buckets) | `supabase/schema/000_full_schema.sql` | Yes |
| Database security (RLS, `is_admin()`, storage policies) | `supabase/policies/001_rls_for_browser_app.sql` | Yes |
| Older migrations (history only) | `supabase/migrations/` | Yes |
| Backend functions (AI search, sitemap, SEO audit, Search Console) | `supabase/functions/` + `supabase/config.toml` | Yes |
| **Database rows** (blog posts, jobs, applicants, contacts, users) | The Supabase project itself | No (data, not code) |
| **Secrets** (Gemini key, Supabase service key) | Supabase function secrets / your password manager | No |

## 2. Run the website locally

Requirements: Node.js 18 or newer (tested on Node 24) and npm.

```bash
npm install          # installs everything in package-lock.json
npm run dev          # http://localhost:3000
npm run build        # production build into dist/
```

`.env` already holds the three browser-safe values (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SITE_URL`). To use different values on one machine,
create `.env.local` (ignored by Git); it overrides `.env`.

## 3. Database on a NEW Supabase project (only if you ever move)

The live project already has all of this applied. For a new project, in the Supabase
SQL Editor run, in order:

1. `supabase/schema/000_full_schema.sql`: tables, functions, triggers, storage buckets.
2. `supabase/policies/001_rls_for_browser_app.sql`: row-level security and `is_admin()`.
3. Add each admin (they must already exist under Authentication > Users):

   ```sql
   insert into public.admin_users (user_id, email)
   select id, email from auth.users where lower(email) = lower('ADMIN-EMAIL')
   on conflict (user_id) do nothing;
   ```

Both SQL files are safe to re-run. Row data (posts, jobs, applicants, contacts) is not in
Git; export it from Supabase if you need a backup.

## 4. Edge Functions (backend)

```bash
npx supabase login
npx supabase functions deploy --project-ref <PROJECT_REF> --use-api
npx supabase secrets set GEMINI_API_KEY=<your-key> --project-ref <PROJECT_REF>
```

Functions: `ai-search` (needs `GEMINI_API_KEY`), `sitemap`, `seo-audit`, `search-console`.
Details: `supabase/functions/README.md` and `supabase/DEPLOY.md`.

## 5. Supabase dashboard settings (cannot be stored in Git)

- Authentication > Sign In / Providers: turn **off** "Allow new users to sign up".
- Authentication > URL Configuration: Site URL `https://zyllotech.com`; add
  `http://localhost:3000` and any Lovable preview URL to Redirect URLs.
- Storage: buckets `resumes` (private) and `portfolio-images` (public) are created by
  `000_full_schema.sql`.

## 6. Lovable

Lovable builds from `package.json`, so it installs packages itself. Set the three `VITE_`
values in the project settings. This project uses Vite 6, React 19 and Tailwind 4; see
`LOVABLE_COMPATIBILITY.md` for the known differences from Lovable's defaults.

## 7. Never commit

`SUPABASE_SECRET_KEY` / service-role key, `GEMINI_API_KEY`, passwords, `.env.local`,
`node_modules/`. The old Next.js project's secret key should be rotated.
