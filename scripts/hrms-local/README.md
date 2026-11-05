# hrms-local — local test harness for the HRMS (TEST ONLY)

Runs the **unchanged** HRMS frontend (Vite + React + supabase-js v2) against a
**throwaway local PostgreSQL 17 cluster** instead of Supabase, so the real Row
Level Security policies, SECURITY DEFINER RPCs, triggers and storage policies
from `supabase/` are exercised end to end in a browser.

- **Test only.** Nothing here is imported by `src/`, nothing is part of `vite build`,
  and no existing file (src, migrations, schema, policies, server, config, .env) is modified.
  The only connection between the app and the harness is the process environment of a
  *second* Vite dev server (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SITE_URL`),
  which overrides `.env` for that process only.
- **Local only.** Everything listens on `127.0.0.1`. Nothing contacts `*.supabase.co`
  or any other network host. No email is ever sent.
- **Synthetic data only.** Every person is fictional (`Demo …`, `@example.com`).
- **Not real Supabase.** PostgREST, GoTrue, Storage and the Edge Functions are
  emulated by a small Node server (built-ins only). It implements the subset the app uses.

## Start / stop

```bash
node scripts/hrms-local/start.mjs                 # API on :54321, test web app on :8090
node scripts/hrms-local/start.mjs --no-web        # API only
node scripts/hrms-local/start.mjs --db-only       # just the seeded cluster (psql)
node scripts/hrms-local/start.mjs --port-api 54321 --port-web 8090
node scripts/hrms-local/selftest.mjs              # against the running harness
node scripts/hrms-local/stop.mjs                  # or Ctrl+C in the start window
```

Then open <http://127.0.0.1:8090/login>. The live-site dev server on port 8080 is never touched.

`start.mjs`:
1. `initdb` a cluster in `%TEMP%\zyllo-hrms-local-XXXX\pgdata` on a free port, then applies
   `supabase/tests/hr/_supabase_local_shim.sql`, `supabase/schema/000_full_schema.sql`,
   `supabase/policies/001_rls_for_browser_app.sql`, every `supabase/migrations/1NN_hr_*.sql`,
   `supabase/seed/hr_dev_seed.sql`, `supabase/tests/hrms-local/local_harness.sql` and
   `supabase/tests/hrms-local/local_fixtures.sql`; writes the fixture PDFs into the storage dir.
2. Generates a random per-run JWT secret (never written to disk; passed to the API process
   through its environment) and an anon key signed with it.
3. Starts `api-server.mjs`, then Vite (`vite --port 8090 --strictPort --host 127.0.0.1`) and refuses
   to continue unless the served `/src/lib/env.js` points at the local API.
4. Writes `%TEMP%\zyllo-hrms-local.json` (pids, ports, dirs, anon key). API requests are logged to
   stdout and `%TEMP%\zyllo-hrms-local-api.log` (method, path, role, status, ms; query strings omitted).

`stop.mjs` stops Vite, the API and PostgreSQL, deletes the cluster directory and the state file,
and reports whether the ports are free.

## Sign-in accounts

Password for all: `Local-Test-Only-2026!` (bcrypt hashes in `hrms_local.passwords`).

| Email | Roles | Linked employee |
|---|---|---|
| superadmin@example.com | super_admin | — |
| hr.admin@example.com | hr_admin, employee | Demo HR Manager |
| payroll.admin@example.com | payroll_admin, employee | Demo Finance |
| payroll.approver@example.com | payroll_admin, employee | Demo Payroll Approver (FIN) |
| manager@example.com | manager, employee | Demo Eng Lead |
| employee@example.com | employee | Demo Engineer 03 (reports to Eng Lead) |
| employee2@example.com | employee | Demo Designer (reports to Design Lead — isolation tests) |
| intern@example.com | intern | Demo Intern 1 |
| noaccess@example.com | — | — (account-pending page) |

Accounts created through the **Invite** button (Edge Function stand-in) get the password
`Local-Invite-Only-2026!`; the activation instruction is printed in the API log instead of emailed.

## Fixture data (created through the real RPCs, as the relevant users)

Attendance for the last 6 working days (manual entries by HR, one absence, one late), today's
self check-in, a pending correction; daily reports (draft / submitted / reviewed / revision
requested); leave year initialised, leave approved (manager → HR), pending at manager level,
rejected, pending at HR level; an extra holiday; last month's payroll run created + calculated by
payroll.admin and reviewed + approved + finalized by payroll.approver (separation of duties) so
payslips exist; reimbursements (approved, submitted); a published opening with 5 candidates across
stages, a past interview awaiting manager@'s feedback, a sent offer; an active review cycle with
goals and a self-assessment; documents (verified offer letter, confidential HR record, employee and
employee2 uploads) with real PDF objects; asset assignments (one unacknowledged) and an asset
request; a published announcement requiring acknowledgement plus drafts; HR requests (open, and
resolved with a public comment and an internal note); an exit case for Demo Engineer 05 in
clearance; and every notification those RPCs produce.

## What is emulated

**PostgREST (`/rest/v1`)** — tables/views and `rpc/` in schema `public` only (validated against the
catalog; extension objects hidden). `select` with columns, `*`, `alias:col`, `col::cast`, JSON paths
`a->b->>c`, embeds `alias:table(...)`, `alias:table!fk_or_column(...)`, `alias:fk_column(...)`,
`!inner`, nested embeds; many-to-one → object/null, one-to-many → array, one-to-one → object;
ambiguous embeds → 300 `PGRST201`. Filters `eq neq gt gte lt lte like ilike match imatch is
isdistinct in cs cd ov sl sr nxl nxr adj fts plfts phfts wfts`, `(any|all)` quantifiers, `not.`,
`or=(…)` / `and=(…)` with nesting, embedded-resource filters/order/limit (`alias.col=…`).
`order` (multi, nullsfirst/nullslast), `limit`, `offset`, `Range` header, `Prefer: count=exact`
→ `Content-Range`, HEAD, `Accept: application/vnd.pgrst.object+json` (406 `PGRST116`; maybeSingle is
handled client-side by supabase-js 2.112), POST insert (object/array, `columns=`), upsert
(`resolution=merge-duplicates|ignore-duplicates`, `on_conflict`, PK fallback), PATCH, DELETE,
`return=representation|minimal`. RPC with named args (overloads by argument names; values cast to the
declared types), void → 204, scalar/json → value, composite → object, setof/TABLE → array (with
select/filters/order/limit/count). Errors `{code,message,details,hint}`; status per PostgREST
(P0001 → 400 with message and hint intact, 42501 → 401 anon / 403 otherwise, 23505/23503 → 409,
unknown function → 404 `PGRST202`, unknown relation → 404).
Not implemented: spread embeds `...`, aggregates, ordering by embedded columns, many-to-many via
junction tables, embeds on RPC results, CSV/plan output, computed columns, `Prefer: missing=default`,
`tx=rollback`, read-only transactions for GET.

**GoTrue (`/auth/v1`)** — `token?grant_type=password|refresh_token` (rotating refresh tokens, in
memory), `GET/PUT /user` (password + metadata), `logout`, `settings`; signup disabled; recover/OTP
accepted but nothing is sent; banned users (`auth.users.banned_until`) cannot sign in or refresh.
HS256 JWTs `{sub, role, aud, email, exp, iat, session_id, …}`. No email confirmation, MFA, OAuth,
admin API (used only internally by the function stand-ins).

**Storage (`/storage/v1`)** — upload (`POST`/`PUT /object/:bucket/*path`, multipart or raw, `x-upsert`),
bucket `file_size_limit` / `allowed_mime_types`, RLS enforced by writing `storage.objects` **as the
user** (bytes are kept in the temp dir only if the row is accepted); `POST /object/sign/:bucket/*path`
(only when the user's RLS-filtered `select` sees the object) and the bulk variant;
`GET /object/sign/...?token=` (HMAC token bound to bucket+path+expiry, `download` param);
authenticated download; `DELETE /object/:bucket {prefixes}` as the user; simple `list`; list buckets.
Not implemented: public object URLs (`/object/public/...`), image transforms, move/copy, folder
entries in `list`, resumable uploads.

**Edge Functions (`/functions/v1`)** — `hr-invite-employee`, `hr-revoke-exit-access`,
`hr-email-dispatch` with the same contracts as `supabase/functions/*/index.ts` (permission checks run
as the caller; privileged steps as `service_role`). Email dispatch marks queued rows `failed` with
`Local test harness: no email provider` — never `sent`. Other functions → 404.

## Files

- `start.mjs`, `stop.mjs`, `api-server.mjs`, `postgrest.mjs` (SQL generator), `lib.mjs`,
  `fixture-files.mjs`, `selftest.mjs`
- `supabase/tests/hrms-local/local_harness.sql` — `authenticator` role, `hrms_local.exec()` (role +
  claims switch, error capture), password table, fixture helpers
- `supabase/tests/hrms-local/local_fixtures.sql` — accounts and module data
