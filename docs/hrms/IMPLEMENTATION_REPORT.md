# Zyllo Tech HRMS: implementation report

- **Date:** 2026-11-02
- **Branch:** `Intern` (HEAD `99fa9b5`)
- **State:** uncommitted, not pushed, not deployed. The live Supabase project was never touched.
- **Companion documents:** `ARCHITECTURE.md`, `PROGRESS.md` (checkpoint), `SECURITY.md`, `DEPLOYMENT.md`.

## 1. Summary
All 14 HR Operations modules and 15 Employee Portal pages are implemented on a single authoritative store: Supabase Postgres with Row Level Security and SECURITY DEFINER workflow RPCs.
- **Database:** every migration (`100`–`112`) passes **774 assertions in 14 test files** on a throwaway local Postgres 17 cluster, plus **27 seed-smoke assertions**.
- **Frontend:** the build compiles and an anonymous browser smoke test passes.
- **Not yet verified:** the signed-in UI has **not** been exercised in a browser, because that needs the isolated dev Supabase project the owner still has to create (`DEPLOYMENT.md` §1). Until then, UI workflows are *implemented and compiled* but not *verified end to end*.

## 2. Status per module
"DB tested" means the database layer (tables, RLS, workflow RPCs and their permission and validation rules) is covered by automated tests. "UI" means pages are built, compiled and registered, but not yet exercised against a real Supabase Auth and Storage.

| # | Module | DB tested (assertions) | UI (HR / Employee) | Remaining gaps |
|---|---|---|---|---|
| 1 | HR Dashboard | 112 (54, shared with reports) | HrDashboardPage / EmployeeDashboardPage | Charts are simple bars, not a chart library |
| 2 | Employee Master | 100 + 100b (60) | Employees list, detail, form, import / My Profile, Activate | Invitation needs the deployed Edge Function and SMTP on the dev project |
| 3 | Attendance & Time | 101 (53) | AttendancePage / MyAttendancePage | Missing-punch job must be scheduled |
| 4 | Daily Work Reports | 102 (53) | DailyReportsPage / MyDailyReportsPage, MyTasksPage | Reminder job must be scheduled |
| 5 | Leave Management | 103 (63) | LeavePage / MyLeavePage | Leave year = calendar year. Document attachment is a reference, not an upload. |
| 6 | Recruitment & Interns | 104 (90) | RecruitmentPage / MyInterviewsPage, MyInternshipPage | HR stage is not written back to the legacy `job_applications.status`. No HR résumé upload. Certificate issue date not settable. |
| 7 | Payroll | 105 (60) | PayrollPage / MyPayslipsPage | **Statutory components must be configured and verified by a qualified professional.** No bank payments, by design. |
| 8 | Performance & KPI | 106 (61) | PerformancePage / MyPerformancePage | — |
| 9 | Documents | 107 (71) | DocumentsPage / MyDocumentsPage | Expiry-reminder job must be scheduled |
| 10 | Announcements | 108 (47) | AnnouncementsPage / MyAnnouncementsPage | Scheduler job and an email provider must be configured |
| 11 | Assets | 109 (58) | AssetsPage / MyAssetsPage | — |
| 12 | HR Reports | 112 (all 17 reports execute) | ReportsPage (CSV, print/PDF) | — |
| 13 | Exit Management | 110 (60) + Edge Function | ExitsPage / resignation in MyHrRequestsPage | Access revocation needs the deployed Edge Function |
| 14 | HR Settings | 100 (51) | SettingsPage plus 9 module tabs | — |
| — | HR Requests (Employee page 12) | 111 (44) | HrRequestsPage / MyHrRequestsPage | — |
| — | Notifications (Employee page 13) | 100 | NotificationsPage | — |

## 3. Architecture
- **Data:** `public.hr_*` tables, about 70 in all.
  - Every table has RLS enabled, and anon access is revoked.
  - Helpers live in the non-exposed `hr_private` schema.
- **Roles:** Super Admin, HR Admin, Payroll Admin, Manager / Team Lead, Employee, Intern, plus custom roles. There are 67 permission keys, including view, view_team, create, edit, approve, export and manage.
  - Payroll is separated from HR Admin, and payroll audit rows are hidden from HR Admins.
  - Managers are scoped to their recursive reporting line.
- **Workflows:** about 120 `public.hr_*` RPCs. They check permissions inside, take row locks, and record history or events. Self-approval is blocked everywhere.
- **Edge Functions:**
  - `hr-invite-employee`: secure Supabase Auth invite and account link.
  - `hr-revoke-exit-access`: bans the auth user at exit clearance.
  - `hr-email-dispatch`: delivers the email outbox and stores the real delivery status.
- **Storage:** private `hr-documents` and `hr-avatars` buckets, with storage policies tied to document permissions. Downloads use 60-second signed URLs and are logged.
- **Reports and dashboard:** SECURITY INVOKER functions, so totals always equal the caller's authorised records.

## 4. API inventory
The authoritative list is the migrations themselves; each RPC is listed per module in `PROGRESS.md`. To regenerate it from the test database:
```sql
select p.proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'hr\_%' order by 1;
```

## 5. Tests run (final)
| Check | Result |
|---|---|
| `node scripts/hr-db-test.mjs` | 14/14 files, 774 assertions PASS |
| `node scripts/hr-db-test.mjs --seed` | 27 assertions PASS (dashboard, all reports and a payroll run on synthetic data) |
| `npm test` | 45/45 PASS (37 existing plus 8 security-remediation tests) |
| `vite build` | PASS. 145 chunks; no personal-domain emails, demo tokens or service-role keys in the bundle |
| Browser smoke (anonymous, all Supabase writes blocked) | Public pages render with no exceptions and no horizontal overflow (desktop and mobile). Every `/hr*` and `/employee*` route redirects to `/login?next=`. Legacy routes redirect. Invitation page handles an invalid link. |
| Signed-in E2E (UI) | **Not run.** Blocked on the dev Supabase project. |

## 6. Security findings
See `SECURITY.md`. Every finding from the analysis report has been remediated except two that need owner approval:
- untracking and purging `server/zyllotech.db`;
- deleting and purging `src/data/allCandidateEmails.json` from Git history.

**Out of scope but noted:**
- The Client Portal still uses browser-storage demo data, and its demo login has been removed.
- Legacy Express endpoints `/api/inquiries`, `/api/schedule/*` and `/api/portal/*` are still unauthenticated.

## 7. Deployment prerequisites
See `DEPLOYMENT.md`:
1. Create the dev Supabase project.
2. Fill in `.env.hr-dev.local` and `.env.local`.
3. Run `node scripts/hr-db-apply.mjs --with-base --seed`.
4. Deploy the three Edge Functions.
5. Set the auth redirect URLs and disable self sign-up.
6. Bootstrap the Super Admin.
7. Schedule the cron jobs.
8. Run signed-in E2E per role.

Production requires a separate, owner-approved rollout.

## 8. Git changes (uncommitted)
- **Modified (9):**
  - `server/server.js`, `server/mailer.js`
  - `src/App.jsx`, `src/admin/AdminRoutes.jsx`, `src/components/AccountBar.jsx`
  - `src/lib/api/portals.js`, `src/lib/auth.jsx`, `src/pages/Login.jsx`
  - `supabase/functions/_shared/cors.ts`
- **Added:**
  - `docs/hrms/*`
  - `scripts/hr-db-test.mjs`, `scripts/hr-db-apply.mjs`
  - `supabase/migrations/100–112_hr_*.sql`, `supabase/seed/hr_dev_seed.sql`, `supabase/tests/hr/*`
  - `supabase/functions/{hr-invite-employee,hr-revoke-exit-access,hr-email-dispatch,_shared/hr.ts}`
  - `src/hr/**`, `src/employee/**`, `src/lib/hr/**`, `src/pages/AccountPending.jsx`
  - `tests/hr-security-remediation.test.mjs`
- **No secrets** in the changes; `.env*.local` files are gitignored and none exist.
- **Legacy pages left unrouted:** `src/pages/HrPortal.jsx`, `EmployeePortal.jsx`, `Signup.jsx`, `Dashboard.jsx` and the `src/admin/approvals/*` files are no longer routed. They are left in place for the owner to delete.

## 9. Update 2026-11-03: AIMS ERP reference alignment
See `AIMS_REFERENCE_ALIGNMENT.md` for the full comparison. In short:
- **Added:** Org Structure, Benefits, Training (HR + Employee Portal pages), legal entities, grades, identity documents with country rules and expiry reminders, payroll identifiers, HR-only remarks, 22 report templates, dashboard analytics, HR request types.
- **Enhanced:** Employee Master (sectioned form, 7-tab profile, completeness, photo), dashboard, reports, Visa & Documents, HR Settings (grouped), pagination.
- **Kept unchanged:** leave, attendance, payroll workflow, recruitment, performance, daily reports, announcements, assets, exit, all existing URLs.
- **Migrations:** `113`–`116` (additive). **Tests:** DB 774 + 163 new, seed 55, npm 45/45, build PASS, browser round 1 34/34; browser rounds 2–4 and the crawl still need a re-run (stopped for low memory).
