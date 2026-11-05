# HRMS in this repository (alpha branch)

The Zyllo Tech HRMS was built in the internal Vite/React project and ported here on 2026-11-05. This file covers only what is specific to this repo. The module docs in this folder describe the HR functionality itself.

## What was added
- **HR Operations app:** `src/hr/**`, mounted at `/hr/*`. Its pages and modules are:
  - Dashboard and Employee Management
  - Recruitment & Hiring and Onboarding & Exit
  - Attendance & Time, Leave and Payroll
  - Daily Work Reports, Documents, Requests & Approvals and Assets
  - Reports & Analytics and Settings
- **Employee Portal:** `src/employee/**`, mounted at `/employee/*`. `/employee/activate` handles invitation activation.
- **Data layer:** `src/lib/hr/**`. It uses supabase-js only, under Row Level Security.
- **Platform adapters:** `src/hr/platform/`.
  - `auth.jsx` provides `HrAuthProvider` and `useAuth()`.
    - Permissions come from `public.hr_me()`.
    - The site-admin flag comes from `public.has_role(uid, 'admin')`.
    - It is separate from `src/contexts/AuthContext.tsx`, so the website's login, `/dashboard` and `/admin` are unchanged.
  - `HrLoginPage.jsx` is the sign-in page at `/hr/login`. `/employee/login` redirects to it.
  - `AccountPending.jsx` is served at `/account-pending`.
  - `link.jsx`, `image.jsx` and `Seo.jsx` are small shims. HR pages are always `noindex`.
- **Wiring:**
  - `src/App.tsx` defines lazy `/hr/*`, `/employee/*` and `/account-pending` routes. Each is wrapped in `HrAuthProvider`.
  - `src/components/SiteChrome.jsx` hides the site header and footer on these routes.
- **Dependency:** `exceljs` (used for XLSX export; loaded on demand).
- **Database:**
  - `supabase/migrations/100_hr_*` … `198_hr_*`.
  - `supabase/seed/hr_dev_seed.sql` holds synthetic dev data only. Never load it into production.
  - SQL tests live in `supabase/tests/hr`.
- **Edge Functions:** `supabase/functions/hr-*` and `supabase/functions/_shared/{hr,cors}.ts`.
- **Tooling:**
  - `scripts/hr-db-test.mjs` runs the SQL tests on a throwaway local PostgreSQL. The base is this repo's own migrations, then the HR migrations.
  - `scripts/hr-db-apply.mjs` applies the HR migrations to a chosen database.
  - `scripts/hrms-local/` is the local test harness.
  - `tests/hrms/*.test.mjs` are unit tests. Run them with `node --test tests/hrms/`.

## Verified before push
- `npm run build`, including the sitemap and prerender: PASS.
- `npx vitest run`: 35/35, the site's existing tests, unchanged.
- `node --test tests/hrms/`: 24/24.
- `node scripts/hr-db-test.mjs`: 38/38 files, 2,681 assertions on this repo's schema. `--seed`: 55/55.
  - Six of this repo's own Lovable-era migrations do not replay on an empty database, because they assume columns that exist only on the live database. The runner reports them as WARN and continues.
- Headless check of `/hr/login`, `/hr`, `/employee` and `/account-pending`:
  - Signed-out users are redirected to the HR sign-in page.
  - The marketing pages are unaffected.

## Deploying the database (read first)
- **Supabase project:** `src/integrations/supabase/client.ts` points at project `zfjeflpvwizlteflypsx`. The HR pages only work once the HR migrations exist in that project. Until then, signed-in HR pages show errors. Public pages are unaffected.
- **Migration order:** the HR migrations are numbered `100`–`198`, which sorts *before* this repo's timestamped migrations. On a database that already has those timestamped migrations, the Supabase CLI treats 100–198 as out of order (`supabase db push --include-all`). They apply cleanly after the existing schema; this was tested.
- **Test on a staging or branch project first.**
- **After applying:**
  - Deploy the Edge Functions.
  - Bootstrap the Super Admin (see `DEPLOYMENT.md`).
  - Assign roles.
- **Migration 198** removes the old "Public can view resumes" storage policy if it still exists. Candidate resumes must not be publicly readable.
- **Open items:** see `HRMS_FULL_INTEGRATION_REPORT.md` ("Open items").
