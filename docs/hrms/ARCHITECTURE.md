# Zyllo Tech HRMS: architecture decision record

Status: **accepted** (2026-11-02, approved by the project owner in session).

## Decision
**Supabase is the single authoritative store for all HR and Employee Portal data.**

- **Database:** Postgres tables in the `public` schema, all prefixed `hr_`.
- **Authorization:** Row Level Security on every table, keyed to `auth.uid()`.
- **Helpers:** permission and helper functions in the non-exposed `hr_private` schema.
- **Multi-step workflows** (leave approval, payroll, exit, and similar): `SECURITY DEFINER` RPCs that check permissions themselves and run in a single transaction.
- **Identity:** Supabase Auth. HR invites employees through an Edge Function that uses the service role on the server side only.
- **Files:** private Supabase Storage buckets (`hr-documents`, `hr-avatars`), accessed through RLS-checked storage policies and short-lived signed URLs.
- **Email:** an `hr_email_outbox` table, processed by an Edge Function. The UI shows the real delivery state (queued, sent or failed) and never a fake success.

### Rejected alternatives
- **Express + SQLite (`server/`).** It can't run on Lovable hosting. It contradicts `AGENTS.md`, which requires a browser-only app plus Supabase. Its HR endpoints are also unauthenticated (see `docs/hrms/SECURITY.md`). The HR and employee endpoints are retired; see the security remediation log.
- **Browser storage.** It is not shared across users and not secure. All `zyllotech_portal_*` storage for HR and employee data is removed.

## Environments

| Environment | What it is | How migrations get there |
|---|---|---|
| Local test | A throwaway Postgres 17 cluster created per test run by `scripts/hr-db-test.mjs`. It gets a temp directory and a free port, and is destroyed afterwards. | Automatic, together with `supabase/tests/hr/_supabase_local_shim.sql`, which emulates `auth.*`, `storage.*` and the Supabase roles. |
| Dev Supabase | A **separate** Supabase project created by the owner for development. Its credentials live in the untracked `.env.hr-dev.local`. | `node scripts/hr-db-apply.mjs`. The script refuses to run against the live project ref. |
| Production (live) | The existing Zyllo Tech Supabase project. | **Never touched from this work.** Applying there requires explicit owner approval; see `DEPLOYMENT.md`. |

## Migration order
1. `supabase/schema/000_full_schema.sql`, then `supabase/policies/001_rls_for_browser_app.sql`. These are the existing public-site schema; recruitment references `job_postings` and `job_applications`.
2. `supabase/migrations/1NN_hr_*.sql`, in numeric order.
3. `supabase/seed/hr_dev_seed.sql`. This is **synthetic** demo data for local and dev use only. It must never be applied to production.

## Conventions for all HR SQL
- **Tables:**
  - Every table is `public.hr_*` with RLS enabled.
  - Anon access is revoked: `select hr_private.secure_table('public.hr_x')`.
  - Sensitive tables are audited: `select hr_private.enable_audit('public.hr_x', array['redacted_col'])`.
- **Who am I:** `hr_private.current_employee_id()` returns the caller's active employee id, or null.
- **Permissions:**
  - `hr_private.has_permission('module.action')`: super admins pass everything.
  - `hr_private.can_access_employee(target_employee_id, 'module')`: the caller themselves, `module.view` (everyone), or `module.view_team` when the target is in the caller's reporting line.
- **Notifications and email:** `hr_private.notify_employee(employee_id, type, title, body, link, entity_type, entity_id)` and `hr_private.queue_email(...)`.
- **Errors:** raised with `raise exception using errcode = 'P0001', message = '<human message>', hint = '<code>'`. The frontend shows `message`.
- **Time:** server timestamps only (`now()`). Business dates use `hr_private.business_today()` (the company timezone from `hr_settings.company.timezone`).
- **History:** no hard deletes of employee history. Archive with `status` / `archived_at`.

## Frontend
- **Data access:** `src/lib/hr/` (`client.js`, then one module per domain) calls supabase-js tables and RPCs. Every call returns `{ data, error }`, and errors are shown to the user.
- **Pages:** `src/pages/hr/*` (HR Operations) and `src/pages/employee/*` (Employee Portal). They reuse `PortalShell`, `PortalKpiCard` and `PortalHeroBanner`.
- **Authorization in the UI:** route guards in `src/lib/hr/guards.jsx` use `hr_me()`. This is for UX only; RLS is the real enforcement.
