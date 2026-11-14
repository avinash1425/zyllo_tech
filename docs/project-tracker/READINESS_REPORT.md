# Project Tracker — implementation and deployment readiness report

Updated 14 Nov 2026 · local branch `feature/project-tracker` (worktree `.claude/worktrees/project-tracker`),
based on the live branch `lovable-port` @ `4e7aad3` (unchanged on the remote). **Nothing has been committed,
pushed, published, deployed or applied to any Supabase project. No vault, bucket or migration exists in
production because of this work.**

## What exists now

* **Credentials & Access (this round):** 15 credential types with type-specific fields (provider, hosting type,
  environment, organisation, provider project, server/account reference, renewal date, purpose), type filter
  buttons, multiple records per type. Password column with masked value, Show/Hide (auto-hide), Copy, Change,
  Remove, last updated / by whom, owner and 2FA — also in **Emails & Accounts** and **Hosting & Servers** through
  linked credential records. Re-authentication dialog for stale sign-ins.
* **Password storage is implemented but switched off.** It is designed for Supabase Vault (secret only in
  `vault.secrets`, opaque id mapping, manager-only reveal with recent sign-in and rate limit, audit without
  values). Until `005` is approved and passes on a real vault, the UI shows "Vault not configured", the controls
  are disabled and the server refuses every save and reveal. No custom encryption exists anywhere.
* **Documents & Handover (this round):** drag-and-drop and multi-file upload with per-file progress,
  description, server-side type and size checks taken from the stored file, configurable limit (`max_document_mb`),
  New version / History / previous-version download, image and text preview, access audit (open, download,
  preview), private storage, safe file names.
* **Earlier rounds kept:** company hierarchy, 13 project sections, credential references, backups evidence,
  AMC/renewals, SEO documentation, tasks, evidence-based handover, activity log, reports, roles and RLS.
* **Existing files changed in total:** `src/admin/AdminRoutes.jsx` and `src/admin/AdminShell.jsx` only (as before).

## Existing admin login (info@zyllotech.com)

* **Authentication:** the website's existing **Supabase Auth** (live project `zfjeflpvwizlteflypsx`): `/login` with email + password,
  session kept and refreshed by supabase-js, admin gate `is_admin()` (Lovable's `user_roles` / `has_role()` model). Project
  Tracker already reuses this session — no separate login, password or auth change.
* **Is info@zyllotech.com an authorized admin on live? Not verified.** There is no read access to the live database from this
  PC, and the live `is_admin()` body is not in the repository. `010_verify_admin_account.sql` (read-only) answers it in the
  live SQL editor.
* **Manager access: prepared, requires approval.** `011_assign_project_tracker_manager.sql` assigns Manager by the
  **user ID** from 010, only after re-checking server-side that the ID matches the email, is confirmed, not banned/deleted
  and passes the project's own `is_admin()`. It needs 001–004 applied first. Without it the account would be an Editor.
* **Tested locally with a SIMULATED stand-in** (`zyllo.admin.sim@example.test`), not the real account: 010/011 database
  tests (21 checks) and `browser-flows.mjs --admin-sim` (36 checks: login → Admin Dashboard → Project Tracker →
  Companies → Projects → project, Manager features, sign-out, unauthorized URLs and API). **The real login with
  info@zyllotech.com has not been verified.**

## Database files (`supabase/project-tracker/`, none applied)

`000` preflight · `001` schema + RLS · `002` private storage · `003` companies · **`004` credentials + documents
(additive; passwords disabled)** · **`005` enable vault (separate approval; refuses unless Supabase Vault exists, is
locked down and passes a ciphertext self-test)** · `900` full rollback · `901` rollback of 003 · **`902` rollback of
004/005** · **`010` verify an existing admin (read-only) · `011` assign Manager by verified user ID (approval)**.
Details and the live verification steps: `supabase/project-tracker/README.md`.

## Test results (all executed 14 Nov 2026, synthetic data only)

| Suite | Result |
|---|---|
| Database (`node scripts/pt-local/db-test.mjs`, PostgreSQL 17) | **389 passed, 0 failed** — existing-admin verification and Manager assignment (010/011: admin, non-admin, unknown, unconfirmed, banned, ID/email mismatch, placeholder left, idempotent, auth.users and user_roles untouched, role void once admin rights end) + security, workflow, company, credentials with vault disabled, documents (allow-lists, stored size/type, versions, cross-project, audit), 005 refuses without a vault, password logic against the labelled test double, 004 re-apply guard, 902 rollback, full rollback and reinstall 001–004 |
| Unit (`npm test`) | **51 passed, 0 failed** — incl. the 004 credential-type constraint, form fields vs columns (password is never a column), no password-value column in 004, upload types and configurable size limit |
| Browser, vault disabled (`browser-flows.mjs`, headless Chrome, local stand-in, all non-local requests blocked) | **191 passed, 0 failed** — every earlier workflow plus: vault-disabled banner, disabled password input/buttons, server refuses save and reveal, no stored passwords; 6-file upload (pptx, docx, xlsx, ppt, txt, png) with progress to 100 %; drag-and-drop; .exe / .svg / 51 MB refused in the browser **and** by the server (bypassing the browser); new version, previous-versions toggle, history, download of the old version byte-identical, replacing an old version refused; text and image preview; persistence after reload; access audit; 390/820/1440 px layouts incl. upload dialog and credentials |
| Browser, **local TEST DOUBLE vault** (`start.mjs --vault-test-double` + `browser-flows.mjs --vault-only`) | **36 passed, 0 failed** — labelled banner/badge; editor saves a password; masked list; editor cannot reveal/copy (UI and server); API rows never contain the value; manager Show, Hide, auto-hide (10 s), Copy without display; change with mismatch check; stale sign-in → re-authentication, wrong password refused, correct password reveals; Emails/Hosting password columns; no value in report, local/session storage, console or audit log; remove; mobile layout. **Plaintext stand-in: proves UI, authorization and audit logic only — not encryption.** |
| Browser, **SIMULATED existing admin** (`browser-flows.mjs --admin-sim`) | **36 passed, 0 failed** — existing `/login`, one Supabase session, Admin Dashboard → Project Tracker → Companies → Company A1 → All Projects → project with no further sign-in, Manager features, deep link after reload, sign-out redirect; signed-out / non-admin / blocked-admin direct URLs refused; anonymous, non-admin and blocked tokens read nothing and cannot assign roles; editors cannot self-promote or write `pt_members` |
| Production build | succeeds; Project Tracker chunk ≈257 kB, lazy-loaded; GA4 loader and Search Console tag present; no test credentials, no HRMS project reference in the bundle |
| Lint | 0 errors, 8 warnings (`react-refresh/only-export-components`, hot-reload only) |

Defects found and fixed this round: browsers often give Office files no content type, which the bucket would refuse —
uploads now send the type for the file's extension (the server still checks it); the local harness re-issued the
sign-in time on token refresh (now kept, as Supabase does), which would have hidden re-authentication problems.

## Status

**Fully tested locally:** credential types/fields and filters; vault-disabled behaviour (UI and server); multi-file
and drag-and-drop upload with progress; type/size rejection in browser and server; versions and history; preview;
document access audit; private storage and signed links (local stand-in); password Show/Hide/Copy/auto-hide/
re-authentication/role checks/audit against the plaintext test double; responsive layouts.

**Requires real Supabase verification (after approval):** Supabase Vault encryption and key management (005
self-test, then a synthetic round-trip on live); that Supabase keeps the original sign-in time in the JWT `amr`
claim after a token refresh (re-authentication depends on it); real Storage bucket limits and signed URLs;
`storage.objects.metadata` size/mimetype as written by real Supabase Storage; the live `is_admin()` body.

**Blocked pending approval:** running 010 (read-only) and 011 (Manager for info@zyllotech.com) on live; applying 001–004 on the live project; creating the `project-tracker-documents`
bucket (002); enabling the `supabase_vault` extension and running 005; an Edge Function to sign document links
(would make the access audit unskippable) and malware scanning (both need deployed server code); first-manager
bootstrap; commit, push, publish.

**Not implemented (by design):** custom encryption of any kind; storing service-role/API keys or tokens;
automatic clipboard clearing (not reliably possible in a browser); previews of Office files; email reminders.

**Actual-password storage is NOT complete:** the whole secure storage, retrieval and authorization workflow has
been verified only against a plaintext local stand-in, never against a real encrypted vault.

**Not production-ready** until the approved SQL is applied on live, the preflight is green, 005 passes (if
passwords are wanted) and a short live smoke test passes.
