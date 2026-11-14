# Project Tracker — database installation, rollback and security notes

**Status: NOT APPLIED to any Supabase project.** Everything here needs explicit approval
before it touches the live (Lovable-managed) project `zfjeflpvwizlteflypsx`. Do **not**
apply it to the HRMS project `whiclllqgxxqhufkduuo`.

These files live outside `supabase/migrations/` on purpose, so that no tool or sync can
apply them automatically.

| File | What it does | Approval gate |
|---|---|---|
| `000_preflight_check.sql` | Read-only checks: `is_admin()` exists, PostgreSQL ≥ 15, no `pt_*` name collisions, bucket absent; prints the live `is_admin()` definition | none (read-only) |
| `001_project_tracker_schema.sql` | Tables, constraints, triggers, RLS, functions, views (all new, prefixed `pt_`) | **live DB migration** |
| `002_project_tracker_storage.sql` | Private bucket `project-tracker-documents` + 3 storage policies | **production storage bucket / policies** |
| `003_project_tracker_companies.sql` | Company hierarchy: new `pt_companies`, nullable `pt_projects.company_id`, company-aware views | **live DB migration** |
| `004_project_tracker_credentials_documents.sql` | Credential types/fields, vault-backed password functions (**installed switched off**), document descriptions, versions, server-side file checks, access audit, settings | **live DB migration** |
| `005_enable_password_vault.sql` | Turns password storage on — only if Supabase Vault is installed, locked down and passes a round-trip + ciphertext self-test | **production vault + security approval** |
| `010_verify_admin_account.sql` | **Read-only.** For one email: number of matching logins, the authenticated user ID, confirmed / banned / deleted, website roles, and the project's own `is_admin()` evaluated for that user ID; current Project Tracker role | none (read-only) |
| `011_assign_project_tracker_manager.sql` | Makes that **user ID** a Project Tracker Manager after re-checking ID↔email, confirmed, not banned/deleted and `is_admin()` server-side; logs it; never touches `auth.users`, passwords or `user_roles` | **production role assignment** |
| `900_rollback.sql` | Removes everything above (destructive: deletes Project Tracker data and this module's vault secrets) | **destructive** |
| `901_rollback_companies.sql` | Removes only 003 (companies + project→company link); every project and record is kept | **destructive for company data** |
| `902_rollback_credentials_documents.sql` | Removes only 004/005 (deletes this module's vault secrets and the new columns; new credential types become *Other*) | **destructive for stored passwords** |

## What 001/002 change — and what they don't

* Creates 22 tables (`pt_projects`, `pt_hosting`, `pt_domains`, `pt_access_records`, `pt_access_refs`,
  `pt_email_accounts`, `pt_backups`, `pt_repositories`, `pt_deployments`, `pt_milestones`, `pt_tasks`,
  `pt_documents`, `pt_updates`, `pt_amc_contracts`, `pt_renewals`, `pt_seo_records`, `pt_handovers`,
  `pt_handover_items`, `pt_handover_events`, `pt_remarks`, `pt_activity_logs`, `pt_members`),
  3 views (`pt_project_health`, `pt_project_list`, `pt_due_items`) and `pt_*` functions.
* Creates one new private storage bucket and three policies on `storage.objects` that only match that bucket.
* **Does not** alter, rename or drop any existing table, function, policy, bucket or auth setting.
  `public.is_admin()` is only *called*. No HRMS object is referenced. Website tables are untouched.
* Aborts without changes if `pt_projects` already exists or `is_admin()` is missing.

## How to apply (after approval)

The Supabase CLI on this PC cannot reach the Lovable-managed project, and Lovable's AI
chat must not be used. The approved route is therefore manual:

1. Take a database backup / note the restore point of the live project.
2. Open the live project's **SQL editor** (Lovable Cloud → Database/SQL, or the Supabase
   dashboard if the project owner has access).
3. Run `000_preflight_check.sql`. Every row must show `ok = true`. Check the printed
   `is_admin()` definition: everyone it returns true for becomes a Project Tracker **editor**.
4. Run `001_project_tracker_schema.sql` (one transaction; all-or-nothing).
5. Run `002_project_tracker_storage.sql` (separate approval).
5b. Run `003_project_tracker_companies.sql` (company hierarchy; can also be applied later on top of a live 001).
5c. Run `004_project_tracker_credentials_documents.sql`. Password storage stays **disabled** (`pt_settings.passwords_enabled = false`);
    the UI shows "Vault not configured" and the server refuses every password save/reveal.
5d. Only with a separate approval: enable the Supabase Vault extension (Dashboard → Database → Extensions → `supabase_vault`),
    then run `005_enable_password_vault.sql`. It aborts without changes unless the vault exists, API roles cannot read it, and a
    self-test secret round-trips and is stored as ciphertext. Then verify on live (see *Credentials and documents* below).
6. Make the existing website admin **info@zyllotech.com** the first Manager (needed to view credential
   references, approve handovers, restore archives and manage roles) — never by email alone:
   1. Run `010_verify_admin_account.sql` (read-only). Continue only if `matching_accounts = 1`,
      `email_confirmed = true`, `banned = false`, `deleted = false` and `is_admin_as_user = true`.
      If the account does not exist or is not an admin, **stop**: creating users or granting the
      website-admin role is a separate decision (no script for it here).
   2. Copy `user_id` into `011_assign_project_tracker_manager.sql` (with the expected email) and run it
      (approval needed). It aborts with nothing changed unless every check passes again server-side.
   3. After that, a Manager adds further managers in the app (Project Overview → Access).
7. Verify (as a signed-in admin, in the app): Admin → Project Tracker opens; create a test
   project, then archive it.

If the frontend is published **before** the SQL is applied, the Project Tracker pages show
"Project Tracker is not installed on this backend yet" and nothing else changes.

If the live SQL editor is not reachable without Lovable AI credits, this is a **blocker**: keep
the frontend unpublished (or publish it — it degrades safely) and ask the project owner for
dashboard access. Do not switch the site to another Supabase project.

## Company hierarchy (003)

* `pt_companies` (Company ID `ZT-CO-0001…` generated; optional unique Company Code; name unique among
  active companies, case-insensitive; validated email/phone/website; country/state/city/address; status;
  remarks; full audit columns). Same RLS, roles, secret detection and audit logging as every `pt_` table;
  no deletes.
* `pt_projects.company_id` → `pt_companies(id)`. Every **new** project needs a company; once set it cannot
  be cleared; moving a project to another company is manager-only and logged. New/moved/restored projects
  cannot target an archived company. A company with active projects cannot be archived.
* **Existing projects are not auto-assigned.** Before 003 there are no companies, so any project created
  under 001 keeps `company_id = NULL` and is shown as *Unassigned* (dashboard tile "Projects without a
  company", All Projects → Company filter → Unassigned). An editor assigns it with *Edit Project*. Project
  ids, child records and history are untouched. (Live has no Project Tracker data yet, so on live this
  list will simply be empty.)
* Views: `pt_project_list` and `pt_due_items` gain company columns; new `pt_company_summary`
  (project counts per company: total, live, in progress, maintenance, completed, other, pending
  handover, archived).

## Credentials and documents (004 / 005)

**Credentials.** Types: Email, Hosting panel, Website admin, Supabase, Database, Domain registrar, GitHub, cPanel,
VPS/SSH, Cloudflare, Vercel, Render, third-party, API service, Other. New metadata columns: login identifier, provider,
hosting type, environment, organisation, provider project name, server/account reference, renewal date, purpose.

**Passwords — designed, not yet verified on a real vault.**

* The value is stored only in `vault.secrets` (Supabase Vault: encrypted, key managed outside the database).
  `pt_access_secrets` maps a credential to the opaque vault id; no API role can read it. `pt_access_records` only has
  `has_password`, `password_updated_at` and `password_updated_by_email` (maintained by the functions).
* `pt_set_access_password` (editor or manager; refuses API-key/token-like values), `pt_reveal_access_password` (manager only,
  signed in within `reauth_minutes` — read from the JWT `amr` timestamp — and under `max_reveals_per_10min`) and
  `pt_clear_access_password` (manager). Refusals are returned, not raised, so they stay in the audit log. The log records
  set, change, reveal, copy, refusal and removal — never the value. Revealed values hide after `reveal_seconds`.
* `pt_ensure_email_credential` / `pt_ensure_hosting_credential` give a mailbox or hosting account its own credential
  record, so the Emails and Hosting tabs show the same password controls.
* Never store Supabase service-role keys, API keys or tokens here (the server refuses values that look like them).

**Without a vault** (the default after 004, and always on a project without `supabase_vault`): the controls are visible but
saving, viewing and copying are disabled, and the server refuses them. Keep passwords in the password manager and use
*Set reference* to note where.

**Documents.** Description; versions (`version_group_id`, `supersedes_id`, `is_current`; only the current, active version
can be replaced; old versions stay downloadable). A trigger checks the extension allow-list and that the object exists in
the private bucket, and takes size and content type **from the stored object** (not from the browser) against the MIME
allow-list and `max_document_mb` (1–50). `pt_log_document_access` logs every open, download and preview. No malware
scanner is connected (it would need deployed server code). Files are never executed or rendered as HTML; previews are
limited to images and plain text.

**Known limits.** The access audit is written by the app before it creates the 60-second signed link; an admin calling
Storage directly could skip the log. Enforcing it needs an Edge Function that signs links (a production deployment,
approval needed). A web page cannot clear the clipboard reliably, so *Copy* tells the user it is not cleared.

**Verify on live after 005 (approval needed):** save a synthetic password, confirm `vault.secrets.secret` holds ciphertext,
reveal it as a manager, confirm an editor is refused, confirm a session older than `reauth_minutes` must re-enter the
password (Supabase must keep the original sign-in time in `amr` after a token refresh), check the audit rows, then remove
the synthetic password.

## Signing in (existing admin authentication)

Project Tracker has **no login of its own**. It lives inside the admin area and uses the website's
existing Supabase Auth session: the same `/login` page (email + password, `signInWithPassword`), the same
browser session (supabase-js stores and refreshes it), and the same gate (`AdminRoutes` → `rpc('is_admin')`;
non-admins see *Not authorised*). Inside, `pt_role()` adds the Project Tracker role on the server:
not an admin → no access at all; admin without a `pt_members` row → Editor; row → its role. Every table is
protected by RLS through these functions, so direct URLs and direct API calls get nothing without them.
No user, password or website-auth setting is created or changed by any Project Tracker file.

## Rollback

* **Credentials/documents only:** `902_rollback_credentials_documents.sql` removes 004/005: deletes this module's vault
  secrets, the new columns and functions, and maps new credential types to *Other*. Verified locally.
* **Companies only:** `901_rollback_companies.sql` removes 003 and keeps every project (export the
  company reports first — assignments are lost). Verified locally.
* **Soft (recommended first):** revert/unpublish the frontend commit. Data stays, protected by RLS.
* **Full:** export what you need (Reports → CSV/Excel; download documents), empty the
  `project-tracker-documents` bucket in Storage, then run `900_rollback.sql`. Verified locally:
  after rollback no `pt_*` object, storage policy or bucket remains, `is_admin()`/`user_roles`
  are untouched, and 001+002 can be applied again cleanly.

## Security model (summary)

* Access = website admin (`is_admin()`) **and** a Project Tracker role. Admins default to
  *editor*; `pt_members` can set *manager*, *viewer* or *no_access*. A `pt_members` row cannot
  give access to a non-admin. Anonymous users have no privileges at all.
* RLS on every table; no role has DELETE or TRUNCATE (records are archived, never deleted).
  Archived projects and their records are read-only; only managers restore.
* Cross-project integrity: every link between records (email → hosting, repository →
  hosting, task → milestone, handover evidence → document, …) uses a composite foreign key
  `(project_id, id)`, so a record can never point at another project's data; `project_id`
  cannot be changed after creation.
* **No password, key or token column exists.** Credential records hold only metadata; the
  account identifier and the password-manager reference live in `pt_access_refs`, which no
  API role can read. Editors set it via `pt_set_access_reference`; only managers read it via
  `pt_reveal_access_reference`, and every read and change is logged. Lists show a masked
  identifier (`ad•••@acme.com`).
* A trigger rejects any text value that looks like a private key, JWT/API key, GitHub/AWS/Google/
  Slack/Stripe/Supabase token or a `password: <value>` assignment, in every Project Tracker table.
  This is a heuristic safety net, not a guarantee — the UI also tells users never to enter secrets.
* No custom or fake encryption. Until 005 is approved and passes on a real Supabase Vault, no password is stored; the
  password manager stays the vault. The local test double (`supabase/tests/project-tracker/vault_test_double.sql`) is
  plaintext, refuses to install where a real vault exists, and is used only by the local tests.
* Activity logs are written only by definer triggers/functions, are append-only (update/delete
  raise errors even for the owner), and contain field *names* and status transitions only —
  never field values.
* Handover: status changes only through `pt_handover_transition`; submission requires all
  15 items evidenced (note or document), recipient, date and a signed approval document;
  approval and completion are manager-only; completion needs a written confirmation; the
  checklist locks once submitted.
* Documents: private bucket; uploads only into `<active project id>/<uuid>/<file>` with an
  extension allow-list (bucket also limits MIME type and 50 MB); reads require a visible
  `pt_documents` row for that exact path (so "restricted" files are manager-only); the app
  uses 60-second signed URLs; saved files cannot be deleted, only orphaned uploads.

## Tests

* `node scripts/pt-local/db-test.mjs` — applies shim + 000 + 001–004 on a throwaway local
  PostgreSQL 17 cluster and runs `supabase/tests/project-tracker/*.sql` (RLS, grants, roles,
  credential references, secret detection, storage, isolation, workflows), then re-apply
  guard, rollback and clean re-install.
* `node scripts/pt-local/start.mjs` then `node scripts/pt-local/browser-flows.mjs` — full UI
  workflows in headless Chrome against a local Supabase stand-in (synthetic data only; all
  non-localhost requests are blocked). Password storage is disabled there, as on a project without a vault.
* `node scripts/pt-local/start.mjs --vault-test-double` then `node scripts/pt-local/browser-flows.mjs --vault-only` —
  the password Show/Hide/Copy/re-authentication/audit UI against the **plaintext** local stand-in (labelled
  "TEST DOUBLE — NOT ENCRYPTED" everywhere). This proves workflow and authorization logic only, never encryption.
* Existing-admin login (simulated): `start.mjs` creates **zyllo.admin.sim@example.test** — a synthetic website admin standing in
  for info@zyllotech.com — and makes it Manager by running 010 and 011 exactly as prepared for live. Then
  `node scripts/pt-local/browser-flows.mjs --admin-sim` signs in through `/login` and walks Admin Dashboard → Project Tracker →
  Companies → company → Projects → project, and checks unauthorized URLs and API calls. This is **not** a login with the real
  account. `db-test.mjs` also runs 010/011 against admin, non-admin, unknown, unconfirmed, banned and mismatched accounts.
* Sign-in lifecycle: `node scripts/pt-local/browser-flows.mjs --auth main` (login → is_admin → Project Tracker for the
  simulated existing admin and the manager; refresh; logout/login; expired session refreshed; unrefreshable session → /login;
  wrong password; token signed with another key rejected), and `--auth before-restart`, restart the harness, `--auth after-restart`.
  The harness keeps its local signing secret in the OS temp folder and gives synthetic users fixed IDs, so a browser session
  survives a harness restart (as on real Supabase); `start.mjs --new-jwt-secret` replaces the secret.
* Real account, local data (`node scripts/pt-local/start.mjs --auth-upstream hr-dev`): emails without a synthetic local
  password sign in through the HRMS dev project `whiclllqgxxqhufkduuo` (public URL + publishable key from `.env.hr.local`;
  the live project is refused). Its ES256 tokens are verified locally with its public key (JWKS); admin rights come from
  that project's own `is_admin()`, called with the user's token at every sign-in and refresh. Sign-up, password reset and
  password changes are never forwarded; passwords are never stored or logged. A local reference row (ID + email, no
  password) lets 010/011 assign Manager in the LOCAL database: `node scripts/pt-local/grant-local-manager.mjs --email …`
  (refuses unless `is_admin()` is true). All Project Tracker data stays local. Tested end to end against a mock project:
  `start.mjs --auth-upstream mock` + `browser-flows.mjs --upstream`.
* `npm test` — unit tests, including a check that every UI option list matches the SQL
  CHECK constraints.

The live `is_admin()` body is not in this repository; the local shim emulates it as
`has_role(auth.uid(), 'admin')` (the Lovable pattern visible in the generated types).
Run the preflight on live to confirm before applying.
