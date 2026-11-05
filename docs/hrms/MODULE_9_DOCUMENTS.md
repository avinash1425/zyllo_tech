# Module 9 — Employee Documents

Branch `hrms/module-9-documents` (worktree `zyllo-tech-website-intern-m9`). Not committed, not merged, not deployed.

Employee Documents is the **central document service** of the HRMS. It extends the
existing documents module (`107_hr_documents.sql`) — same `hr_documents` record, same
private `hr-documents` bucket, same register-then-upload flow, same signed-URL + access-log
reads. Nothing in 107 was removed or renamed.

## Ownership

| Concern | Owner |
|---|---|
| Offer status, offer templates, offer issue / acceptance / rejection | Recruitment & Hiring (104 / 120) |
| Joining verification tasks | Onboarding & Exit |
| Employee identity and employment details | Employee Management |
| Files, document metadata, letter templates, verification, acknowledgements, expiry tracking | **Employee Documents (this module)** |

## What was added (`supabase/migrations/129_hr_employee_documents.sql`)

* **Categories**: `doc_group` (offer_letter, appointment_letter, contract, certificate, letter,
  policy, identity, attachment, confidential, other), `contains_compensation`, per-category
  `reminder_days`. New categories: appointment letter, internship certificate, employment
  confirmation, experience letter (issued), relieving letter, contract attachment.
* **Document metadata**: source (`upload` / `generated` / `recruitment` + `source_ref`),
  issue / effective / renewal dates, contract type + status, `supersedes_document_id`
  (renewals), `parent_document_id` (attachments), notes, verification notes,
  `requires_acknowledgement`, `includes_compensation`, and a new `replaced` status.
* **Compensation restriction**: documents that include compensation are readable only by the
  employee themself and holders of the new permission `documents.compensation` (granted to
  HR Admin; Super Admin passes every check). Managers (`documents.view_team`) and HR users
  without it cannot see the record, its text or its file. Auto-filling salary figures from payroll
  additionally needs `payroll.view`.
* **Verification history** (`hr_document_reviews`, every status change, with notes / reason);
  `hr_review_document()` adds notes; self-verification stays blocked. HR gets an in-app
  notification when an employee's own upload **lands in storage** (trigger on `storage.objects`).
* **Templates** (`hr_document_templates` + immutable approved snapshots): plain text with
  `{{placeholder}}` from a fixed allow-list (`hr_private.doc_placeholders()`); any other
  placeholder or template syntax (`{% %}`, `${}`, `<script`) is rejected; values cannot inject
  placeholders. Draft → approved (HR administrators, `settings.manage`) → archived; editing an
  approved template opens a new draft while the approved version stays in use.
  Seeded (approved): appointment letter, appointment letter with compensation, employment
  contract, experience letter, employment confirmation, internship certificate, relieving letter.
* **Letters**: `hr_preview_document_letter()` (writes nothing) and `hr_issue_document_letter()`
  render on the server; employee data comes from Employee Management and cannot be
  overridden; the issuer supplies only signatory, terms, dates, etc. The rendered text is stored
  immutably (`hr_document_letter_content`); the browser builds the PDF from that text
  (`src/lib/hr/pdf.js`, deterministic, no dependency) and stores it as a normal document version
  (`hr_register_letter_file()`). Re-issuing adds a version; old versions are kept. HR cannot issue
  letters to themselves. An interrupted issue can be resumed ("Store PDF").
* **Offer letters**: `hr_offer_letters_for_documents()` lists Recruitment's offers;
  `hr_file_offer_letter()` files the letter of an **accepted** offer, for a candidate already
  converted to an employee, into that employee's documents (one record per offer, a new
  version per new letter version; never the same version twice). The offer row is never changed.
* **Contracts**: upload with details (`hr_register_document_upload_ex`), renewal as a **new
  record** that supersedes the old one (`hr_renew_contract`, or a generated contract with
  `renews_document_id`) — the old record, versions and file are untouched and marked
  `replaced` / `renewed`; supporting attachments (`hr_register_document_attachment`).
* **Certificates**: employee upload (internship / education / experience / training), HR
  verification, and generated experience / confirmation / internship certificates.
* **Policies** (`hr_policies`, `hr_policy_versions`): Draft → Published → Archived, audience
  (all / departments / locations / employment types / employees), visibility, optional PDF in
  the same private bucket under `policies/…`. Published versions are immutable (trigger);
  editing creates a new draft; publishing v2+ needs a change summary and asks for fresh
  acknowledgements. Employees see only the current published version of policies addressed to them.
* **Acknowledgements** (`hr_document_acknowledgements`, append-only, per version) for policies
  and documents, with tracker (pending / completed, by item, by employee, reminder status) and
  throttled reminders. The stored statement says explicitly that it is a record of receipt and
  **not a digital signature**.
* **Renewal requests** (`hr_document_renewal_requests`), fulfilled automatically by a new version
  or a superseding record.
* **Reminder engine** — see below.
* **Overview / directory**: `hr_documents_overview()` and `hr_search_documents()` count and list
  real rows under the same read rule as the tables, with filters for employee, department,
  company (legal entity), category, document type, verification status, expiry status, upload
  date range, search and archived.

## Reminders and scheduling

`public.hr_run_document_reminders(p_as_of date default null, p_trigger text default 'manual')`:

1. marks documents past their expiry date `expired`, updates contract status;
2. for each document's expiry date (and contract renewal date) sends **one reminder per stage
   reached** — the most urgent configured stage at or below the days left — once per
   document + event + date + stage (`hr_document_reminder_log`). A missed stage is skipped
   rather than sent late in bulk;
3. recipients: employee (expiry, non-confidential), HR (`documents.manage` holders), manager
   (optional, never for confidential or compensation documents); renewal reminders go to HR;
4. email only when the `email_reminders` setting is on — queued in `hr_email_outbox` and shown as
   sent only after `hr-email-dispatch` reports delivery with a configured provider;
5. logs the run in `hr_document_reminder_runs` (trigger, counts).

Settings (`hr_settings.documents`, editable in *Expiry & reminders*): `expiry_reminder_days`
(default 30, 15, 7, 0), `renewal_reminder_days` (60, 30, 15, 0), `expiring_soon_days`,
`notify_employee`, `notify_hr`, `notify_manager`, `email_reminders` (default off),
`acknowledgement_reminder_hours`. Categories may override the expiry schedule. Nothing is hard-coded.

**Scheduler status: NOT configured.** The job is scheduler-ready:

* Edge Function `supabase/functions/hr-document-reminders` — service-role bearer runs it as
  `scheduler` (optional `{ "as_of": "YYYY-MM-DD" }` for controlled tests); a signed-in
  `documents.manage` user runs it as `manual`.
* After approval, an administrator may schedule it daily, e.g. with Supabase Cron + `pg_net`
  (run in the SQL editor of the **target** project only; keep the key in Vault):

```sql
-- NOT APPLIED. Example only; requires approval and the pg_cron + pg_net extensions.
select cron.schedule('hr-document-reminders', '30 1 * * *', $$
  select net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/hr-document-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
                                  'Content-Type', 'application/json'),
    body    := '{}'::jsonb)
$$);
```

The legacy single-shot `hr_generate_document_expiry_reminders()` from 107 is kept unchanged for
compatibility (test 107) but the UI uses the staged engine.

## Frontend

* `src/lib/hr/documentCenter.js` — Module 9 API layer (builds on `documents.js`).
* `src/lib/hr/pdf.js` — dependency-free deterministic PDF writer (Helvetica, A4, wrapping,
  pagination, letterhead, footer). No change to `package.json`.
* `src/hr/pages/DocumentsPage.jsx` — tabs: Overview, Directory, Verification, Letters, Contracts,
  Certificates, Templates, Policies, Acknowledgements, Expiry & reminders, Checklist. Existing
  exports (`ExpiryText`, `openVersion`, `openLatestOf`, `UploadDocumentModal`, `NewVersionModal`,
  `VersionList`, `DocumentDetailModal`) keep their props; the detail modal adds history, issued
  text, attachments, acknowledgements, renewal requests, details, renewal and contract actions.
* `src/hr/pages/documents/*` — tab components.
* `src/employee/pages/MyDocumentsPage.jsx` — Documents (by type), Acknowledgements, Company
  policies, Expiring (with renewal requests). Deep links `?tab=` are used by notifications.
* No route, navigation, auth or shared UI-kit file was changed.

## Integration notes for Modules 1–8

* **Migration number 129.** Depends on 100, 103, 104, 105, 107, 113; reads 120 at run time only
  (`hr_offer_letter_versions`, `hr_offers.current_version / issued_on`). If Module 3 renames those,
  update `hr_offer_letters_for_documents()` / `hr_file_offer_letter()`.
* **Recruitment UI** (not modified here): may call `fileOfferLetter(offerId)` from
  `src/lib/hr/documentCenter.js` after conversion, and `letterPdf()` for offer PDFs.
* **Onboarding / Exit**: can link to `/hr/documents?tab=letters` to issue appointment, experience
  or relieving letters; checklist RPC unchanged.
* **Employee Management**: `EmployeeProfileSections.jsx` keeps working unchanged (same exports).
* **Dashboard / Reports (112 / 117)**: unchanged; their expiring-document counts still read `hr_documents`.
* **Harness**: `scripts/hrms-local/lib.mjs` now honours `HRMS_LOCAL_INSTANCE` (separate state +
  log file per instance; default unchanged); `api-server.mjs` has a stand-in for `hr-document-reminders`.

## Tests

* `supabase/tests/hr/129_employee_documents.test.sql` — 218 assertions (run with `node scripts/hr-db-test.mjs`),
  including direct-helper-call security regressions and audit-history checks.
  Integration readiness, cross-module contracts and proposals: `MODULE_9_INTEGRATION_READINESS.md`.
* `tests/hr-documents-pdf.test.mjs` — PDF structure / determinism / wrapping.
* `scripts/hrms-local/browser-flows-m9.mjs` — end-to-end browser checks on the local harness.

## Known gaps

* The PDF is rendered in the browser from server-stored text; the stored text is authoritative.
  An HR user could in principle upload a different PDF to the registered path (as with any HR
  upload). A server-side renderer (Edge Function) would close this.
* No e-signature: acknowledgements are records of receipt only.
* Template approval does not enforce a second approver (single-HR organisations).
* PDF fonts are the standard Helvetica set (Windows-1252); other scripts are replaced.
* Policy versions are not exported as a combined history PDF.
* No production scheduler is configured (by design).
