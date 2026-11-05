# HRMS: main project integration plan

This plan is documentation only. Nothing here has been applied to the main Zyllo Tech project.

- **Source:** repo `zyllo-tech-website-intern`, branch `Intern`, uncommitted work from 2026-11-02.
- **Target:** the main Zyllo Tech website (Lovable-hosted, Vite + React + Supabase). The main project was **not opened** while writing this plan, so every point marked **VERIFY** must be checked in the main repo before anything is merged.

## 1. What to transfer

### 1.1 Frontend (copy as-is; no dependencies beyond what the site already uses)
| Path | Purpose |
|---|---|
| `src/hr/**` | HR Operations: `HrApp.jsx` (module registry and routes), `AppShell.jsx`, `ui.jsx` (UI kit), `pages/*` (15 module pages), `components/*`, `settings/*` (9 settings tabs), `settingsExtensions.jsx` |
| `src/employee/**` | Employee Portal: `EmployeeApp.jsx`, `pages/*` (dashboard, profile, attendance, daily reports, tasks, leave, payslips, documents, assets, performance, announcements, HR requests, notifications, interviews, internship, activate) |
| `src/lib/hr/**` | Data layer (supabase-js wrappers), guards, org and employee helpers |
| `src/pages/AccountPending.jsx` | Landing page for signed-in accounts with no HR or employee access |

- **Dependencies:** none new (react, react-router-dom, lucide-react and @supabase/supabase-js are already used).
- **Bundle:** pages are lazy-loaded, so the public site's entry bundle does not grow.

### 1.2 Files that REPLACE or MERGE with main-project files
These are the high-risk files. Merge them by hand; do not overwrite.

| File (Intern) | Change made | Main-project action |
|---|---|---|
| `src/lib/auth.jsx` | Supabase-only auth. Adds `hr` (from `hr_me()`), `isSiteAdmin`, `destination`, `hasPermission`, `refreshProfile`. Removes demo accounts and `/api/auth`. `signUp` is disabled. Wipes legacy localStorage keys. | **VERIFY** the main `auth.jsx` API (`useAuth()` shape). Add the `hr`/`hasPermission`/`destination` fields without breaking existing consumers (AdminRoutes, AccountBar, SiteChrome and any analytics/consent code). |
| `src/App.jsx` | `/hr/*` → HrApp, `/employee/*` → EmployeeApp, `/employee/activate`, `/account-pending`. Legacy portal routes redirect. `/signup` → `/login`. | Add the routes. Keep the main project's other routes, including GA/consent wrappers. |
| `src/pages/Login.jsx` | Role-based post-login redirect (`next` param, or else `destination`). Self-signup toggle removed (it also crashed). | **VERIFY** the main login page and port only the redirect and invitation copy. |
| `src/components/AccountBar.jsx` | "Portals" link uses `destination`; admin pill uses the server `is_admin()`. | Merge. |
| `src/admin/AdminRoutes.jsx` | Guard fails **closed**; no role/email shortcuts; `/admin/hr`, `/admin/employee`, `/admin/approvals` redirect to the new apps. | **VERIFY** whether the main project has the same fail-open guard. If it does, apply the fix there regardless of the HRMS. |
| `src/lib/api/portals.js` | Turned into stubs (no candidate PII import). | If the main project has this file, apply the same change. **Never** ship `src/data/allCandidateEmails.json`. |
| `supabase/functions/_shared/cors.ts` | Adds `http://127.0.0.1:8080`. | Optional. Configure `ALLOWED_ORIGINS` per environment instead. |

### 1.3 Do NOT transfer
- `src/pages/HrPortal.jsx`, `EmployeePortal.jsx`, `Signup.jsx`, `Dashboard.jsx`, `src/admin/approvals/*`, `src/data/portalData.js`, `src/data/allCandidateEmails.json` (legacy demo / PII).
- `server/**` (legacy Express). HR features do not need it.
- `scripts/hrms-local/**`, `supabase/tests/**`, `supabase/seed/hr_dev_seed.sql` (test-only).

## 2. Routes to register

**HR Operations (`/hr/*`)**

| Route | Page |
|---|---|
| `/hr` | HR Dashboard |
| `/hr/employees` and `/hr/employees/:id` | Employee Master |
| `/hr/attendance` | Attendance & Time |
| `/hr/daily-reports` | Daily Work Reports |
| `/hr/leave` | Leave Management |
| `/hr/recruitment/*` | Recruitment & Interns |
| `/hr/performance/*` | Performance & KPI |
| `/hr/payroll` and `/hr/payroll/runs/:id` | Payroll |
| `/hr/documents` | Documents |
| `/hr/assets` | Assets |
| `/hr/announcements` | Announcements |
| `/hr/requests` and `/hr/requests/:id` | HR Requests |
| `/hr/exits` and `/hr/exits/:id` | Exit Management |
| `/hr/reports` | HR Reports |
| `/hr/settings` | HR Settings |

**Employee Portal (`/employee/*`)**

| Route | Page |
|---|---|
| `/employee` | My Dashboard |
| `/employee/profile` | My Profile |
| `/employee/attendance` | My Attendance |
| `/employee/daily-reports` | My Daily Reports |
| `/employee/tasks` | My Tasks & Projects |
| `/employee/leave` | My Leave |
| `/employee/payslips` | My Payslips |
| `/employee/documents` | My Documents |
| `/employee/assets` | My Assets |
| `/employee/performance` | My Performance |
| `/employee/internship` | My Internship (interns) |
| `/employee/interviews` | My Interviews |
| `/employee/announcements` | Announcements |
| `/employee/requests` and `/employee/requests/:id` | My HR Requests |
| `/employee/notifications` | Notifications |

**Other routes**
- **Public (no auth):** `/employee/activate` (invitation landing page).
- **Signed in, no HR access:** `/account-pending`.
- **Redirects:** `/hr-portal/*`, `/employee-portal/*`, `/hr/login`, `/employee/login`, `/signup`, `/portal/employee`, `/admin/hr`, `/admin/employee`, `/admin/approvals`.

**Housekeeping**
- **SEO:** HR and employee pages render `<Seo noindex>`. Add `Disallow: /hr` and `Disallow: /employee` to `public/robots.txt`, and keep these routes out of the sitemap generator. **VERIFY** the main project's `scripts/generate-sitemap.mjs`.
- **Analytics:** **VERIFY** the main project's GA4 consent integration. HR/employee routes should be excluded from page-view tracking, or at least must never send personal data (employee names, IDs) in page titles or events. Page titles are generic (e.g. "HR Operations"), but confirm the analytics wrapper does not log query strings such as `?id=`.

## 3. Database migrations (target: the live Supabase project, owner-approved rollout)
**Prerequisite:** `supabase/schema/000_full_schema.sql` and `supabase/policies/001_rls_for_browser_app.sql` already applied. They define `job_postings`, `job_applications`, the `resumes` bucket and `is_admin()`. **VERIFY** this on live.

**Apply in order, each in a transaction, after a backup:**

| Migration | Contents | Depends on |
|---|---|---|
| `100_hr_foundation.sql` | hr_private schema; settings; org; roles/permissions; employees (+ private PII); history; audit; notifications; email outbox; import RPC | pgcrypto, citext |
| `101_hr_attendance.sql` | Attendance, corrections, login events | 100 |
| `102_hr_daily_reports.sql` | Projects, tasks, daily reports, reminders | 100, 101 helpers |
| `103_hr_leave.sql` | Holidays, leave types/balances/requests | 100 |
| `104_hr_recruitment.sql` | Openings, candidates, interviews, offers, internships, mentor visibility | 100 + public careers tables |
| `105_hr_payroll.sql` | Salary components/structures, bank accounts, runs, payslips, reimbursements | 100, 101, 103; btree_gist |
| `106_hr_performance.sql` | Review cycles, KPIs, goals, reviews, feedback, PIPs | 100 |
| `107_hr_documents.sql` | Document categories/versions, **storage buckets and policies** | 100 |
| `108_hr_announcements.sql` | Announcements, receipts, fan-out | 100 |
| `109_hr_assets.sql` | Assets, assignments, events, requests | 100 |
| `110_hr_exit.sql` | Exits, clearance, access revocation | 100, 109 |
| `111_hr_requests.sql` | HR helpdesk | 100 |
| `112_hr_dashboard_reports.sql` | Dashboard + 17 reports (security invoker) | all |

Use `scripts/hr-db-apply.mjs`-style bookkeeping, with a different target guard for production. **Never** apply `supabase/seed/hr_dev_seed.sql` to production; it writes a `seed_marker` setting, which a pre-flight check should refuse.

**Extensions:** on Supabase, install with `create extension if not exists … with schema extensions`. **VERIFY** that `citext`, `pgcrypto` and `btree_gist` resolve under the live `search_path`. The functions avoid schema-qualified `citext` casts on purpose.

**Live tables the HRMS writes to:** `job_postings` gets new rows (publish) and status sync. No schema changes are made to any existing table, and `job_applications` rows are only read.

## 4. Authentication integration requirements
1. **Supabase Auth with email + password.** Disable public sign-up (Dashboard > Authentication) so accounts exist only through HR invitations.
2. **Redirect URLs:** add `https://zyllotech.com/employee/activate`, the `www` variant and the Lovable preview domain(s).
3. **Bootstrap:** grant the first Super Admin via SQL (`insert into hr_user_roles … 'super_admin'`). Decide whether existing `admin_users` members should also get HRMS roles (they are separate systems on purpose).
4. **Two admin concepts:** `is_admin()` (website CMS) and HRMS roles stay independent. `destination` sends HR users to `/hr`, employees to `/employee`, site admins to `/admin`.
5. **Session handling:** `hr_me()` runs on sign-in and is used for UX only. All enforcement is RLS/RPC-side.

## 5. Supabase Storage requirements
| Bucket | Visibility | Size limit | Allowed types | Created by |
|---|---|---|---|---|
| `hr-documents` | private | 10 MB | pdf, png, jpeg, webp, doc, docx, xlsx | migration 107 |
| `hr-avatars` | private | 2 MB | png, jpeg, webp | migration 107 |
| `resumes` | private (existing) | — | — | migration 104 adds an additive HR read policy |

- **Access rules:** storage policies in 107 depend on `hr_document_versions` rows, so uploads must go through `hr_register_document_upload`.
- **VERIFY on real Supabase:** the policy helpers read `storage.objects` as definer (`postgres`). This was only tested on the local emulation.

## 6. Edge Functions
| Function | JWT | Secrets |
|---|---|---|
| `hr-invite-employee` | verify on | `SUPABASE_SERVICE_ROLE_KEY` (auto), `HR_PORTAL_URL` |
| `hr-revoke-exit-access` | verify on | service role (auto) |
| `hr-email-dispatch` | verify on; invoke from cron with the service key | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` |

Shared files: `_shared/hr.ts` and `_shared/cors.ts`. Add each function to `supabase/config.toml` with `verify_jwt = true`.

**Scheduled jobs** (Supabase Cron or pg_cron, service role):
- **Daily:**
  - `hr_mark_missing_punches(current_date-1)`
  - `hr_generate_daily_report_reminders(current_date)`
  - `hr_generate_document_expiry_reminders(30)`
- **Every 5 minutes:** `hr_process_scheduled_announcements()` and the `hr-email-dispatch` function.

## 7. Environment variables
| Where | Variable | Notes |
|---|---|---|
| Frontend (Lovable env) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SITE_URL` | Already used by the site. No new frontend variables. |
| Edge Functions | `HR_PORTAL_URL`, `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`, optional `ALLOWED_ORIGINS` | Function secrets, never `VITE_` |
| Migration tooling | production DB URL | Kept in an untracked file; the apply script must hard-guard the target |

## 8. Potential conflicts with the main project (VERIFY each)
1. **`auth.jsx` divergence.** The main branch may have changed auth (e.g. consent/analytics hooks). Merge field-by-field.
2. **GA4 consent integration.** Main has consent-based GA4 commits (`94e49f0`, `ad6d762` on `lovable-port`). Keep HR pages out of analytics, or at least out of personal-data collection.
3. **Route collisions.** Any existing `/hr`, `/employee`, `/portal`, `/signup` or `/account-pending` routes, and existing `/admin/hr|employee|approvals` pages.
4. **`AdminRoutes` guard.** If main still has the fail-open/email-domain guard, fix it in main first; it is a security issue independent of the HRMS.
5. **Express `server/`.** If main hosts it anywhere, the HR endpoints there are unauthenticated. Apply the retirement guard from `server/server.js` here, or don't host it.
6. **Public careers.** The HRMS writes `job_postings` status on publish/close. Coordinate with the website admin Careers page so the two don't fight over the same posting.
7. **`robots.txt` / sitemap / `llms.txt`.** Exclude `/hr` and `/employee`.
8. **Tailwind v4 classes.** The HR UI uses standard utilities plus arbitrary values; no config changes needed. **VERIFY** the main `globals.css` doesn't override `table`/`dialog` defaults.
9. **Location facts.** The HR seed and copy use the single Guntur office. Keep the company facts consistent.

## 9. Security prerequisites (before production)
- [ ] Remove `src/data/allCandidateEmails.json` and `server/zyllotech.db` from the repo and Git history (owner approval; force-push implications).
- [ ] Rotate any secret that ever lived in `server/.env` or the old Next.js deployment.
- [ ] Disable public sign-up; configure redirect URLs.
- [ ] Have statutory payroll components configured and verified by a qualified professional before running real payroll.
- [ ] Configure the email provider. Until then, outbox rows show `failed`, never `sent`.
- [ ] Run the signed-in role matrix (section 10) against a staging copy before production.
- [ ] Back up the live database before the migrations.

## 10. Regression test plan
1. **Database:** `node scripts/hr-db-test.mjs` (774+ assertions) and `--seed` (27). Add any main-project policy changes to the local run (`000`/`001` files).
2. **Static/security:** `npm test` (includes `tests/hr-security-remediation.test.mjs`), plus the bundle scan for PII, demo tokens and service keys.
3. **Local integration:** `node scripts/hrms-local/start.mjs`, then `node scripts/hrms-local/selftest.mjs`, then the browser role matrix (see `LOCAL_TEST_REPORT.md`).
4. **Staging (real Supabase, after approval):** repeat the role matrix with real Auth, Storage and Edge Functions:
   - invitation → activation
   - check-in/out
   - daily report → review
   - leave apply → manager → HR approve
   - payroll run with separation of duties → payslip visible to the employee only
   - document upload → verify → signed download
   - asset assign → acknowledge
   - announcement publish → receipt
   - HR request → reply
   - resignation → clearance → access revocation → close
5. **Public site regression:** home, services, careers (apply with a test PDF on staging only), contact form (staging only), blog, admin CMS login. Check GA consent behaviour, `robots.txt` and the sitemap.
6. **Mobile:** 390 px pass over the main HR and employee pages (no horizontal page scroll; tables scroll inside their containers).
