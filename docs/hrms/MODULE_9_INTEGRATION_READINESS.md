# Module 9 — Employee Documents: integration readiness

Worktree `D:\Projects\zyllo-tech-website-intern-m9`, branch `hrms/module-9-documents` (from `99fa9b5`).
Uncommitted, unmerged, undeployed. The shared `Intern` branch and every other worktree were only read.
Module overview: `MODULE_9_DOCUMENTS.md`.

## 1. Files

**New**
| File | Purpose |
|---|---|
| `supabase/migrations/129_hr_employee_documents.sql` | Module 9 schema, RLS, storage policies, RPCs |
| `supabase/tests/hr/129_employee_documents.test.sql` | 218 assertions |
| `supabase/functions/hr-document-reminders/index.ts` | Scheduler-ready reminder job |
| `src/lib/hr/documentCenter.js` | Module 9 API layer (offer filing, letters, policies, acknowledgements…) |
| `src/lib/hr/pdf.js` | Deterministic letter PDF writer (no dependency) |
| `src/hr/pages/documents/{DocumentFilters,OverviewTab,DirectoryTab,LettersTab,TemplatesTab,PoliciesTab,AcknowledgementsTab,ExpiryTab}.jsx` | HR tabs |
| `tests/hr-documents-pdf.test.mjs` | PDF writer unit tests |
| `scripts/hrms-local/browser-flows-m9.mjs` | 75 browser checks on the local harness |
| `docs/hrms/MODULE_9_DOCUMENTS.md`, this file, `docs/hrms/local-test-screenshots/wf9-*.jpg` | Docs / evidence |

**Modified** (relative to the shared HR snapshot)
| File | Change |
|---|---|
| `src/hr/pages/DocumentsPage.jsx` | Tabbed Module 9 page; existing exports + props unchanged |
| `src/employee/pages/MyDocumentsPage.jsx` | Documents / Acknowledgements / Policies / Expiring tabs |
| `src/lib/hr/documents.js` | `replaced` status; category + document selects include new columns |
| `scripts/hrms-local/lib.mjs` | Optional `HRMS_LOCAL_INSTANCE` (separate state/log per harness; default unchanged) |
| `scripts/hrms-local/api-server.mjs` | Stand-in for `hr-document-reminders` |

Not modified: routes, navigation, auth, `src/hr/ui.jsx`, `package.json`, `supabase/config.toml`,
Recruitment / Onboarding / Employee / Payroll pages and their migrations.
`node_modules` in the worktree is a junction to the main worktree's (as in sessions 4–8); do not merge it.

## 2. Migration dependencies and compatibility

129 depends on 100 (foundation, audit, notifications), 103 (`notify_permission_holders`), 104
(offers, internships), 105 (salary structures), 107 (documents), 113 (legal entities, `contract_type`),
118 (`confirmation_date`). It reads 120 (`hr_offer_letter_versions`, `hr_offers.current_version`,
`hr_offers.issued_on`) **at run time only** and degrades to "not available" without it.

**Compatibility rehearsal (scratch copy, throwaway cluster), final:** base 100–118 + latest 117 (main) +
120 (main) + 125 (M5) + 128 (M8) + 129 + 130 (M4, 15:50) + 141 (M11) + 160 (M6) + 170 + 171 (M7) +
180 (M10) + 190 (M12), with every owner's latest tests including the updated base tests they ship
(M4 `110_exit`, M6 `103_leave`, M7 `105_payroll`): **31/31 files, 2 415 assertions; 129 passes (218)**.
Integration note: the merged tree must take those updated 103 / 105 / 110 tests from their owners —
with Intern's old copies they fail (behaviour intentionally changed by 160 / 170 / 130), not because of 129.

| Module / migration | Finding |
|---|---|
| Recruitment 120 (main) | Byte-identical to the copy 129 was built against; 120's test passes with 129. |
| Employee Management 118 (main) | Identical; 118 test passes. (M4's worktree carries it as `117_hr_employee_management.sql` — same content, older name.) |
| Onboarding & Exit 130 (M4) | **Resolved conflict.** 130 originally notified HR on version *registration* (duplicate of 129's notification on file *landing*). M4 changed 130: its storage trigger now defers to 129 when trigger `hr_documents_object_uploaded` exists and only notifies the onboarding coordinator. **Contract: keep that trigger name.** Both tests pass together. |
| Leave 160 (M6) | Redefines `hr_private.document_can_view` (managers excluded from `leave_supporting`). 129's `document_can_read` wraps it, so both restrictions apply. (An earlier copy was taken mid-edit; the current file applies cleanly and passes.) |
| Requests 180 (M10) | Optional dependency on 129 (`includes_compensation`, `documents.compensation`), read dynamically; its test passes with 129. |
| Assets 141, Payroll 170, Reports 190, Attendance 125, Daily reports 128 | No conflicts; tests pass. |
| Onboarding & Exit 130 (M4, latest) | Its internal helpers moved to schema `hr_lifecycle_internal` (no API usage) and it no longer runs a blanket `hr_private` grant. |
| Payroll 171 (M7) | New exit-payroll integration; passes with 129. |

Ordering: 129 must run after 120 and before 130/160/180 (it does by number). Several later migrations
(130, 170, 190, …) run `grant execute on all functions in schema hr_private to authenticated` — see §4.3.

## 3. Cross-module integration points

### 3.1 Recruitment → file accepted offer letters (exact)

Recruitment keeps the offer, its template, status, issue and acceptance. Documents only files a copy.

Preconditions (enforced by `hr_file_offer_letter`):
1. `hr_offers.status = 'accepted'` (recorded by Recruitment).
2. `hr_offers.current_version >= 1` and the row `hr_offer_letter_versions(offer_id, current_version)` exists.
3. The candidate was converted: `hr_employees.source = 'candidate' and source_ref = hr_offers.application_id`
   (created by `hr_convert_candidate_to_employee`).
4. Caller holds **`documents.manage` and `documents.compensation`** (HR Admin / Super Admin).
   The `recruiter` role holds neither, so a recruiter cannot file; the button must be shown only when
   `hasPermission('documents.manage') && hasPermission('documents.compensation')`.
5. Caller is not the hired employee.

Call (browser, after a successful conversion or from the offer row):
```js
import { fileOfferLetter } from "@/lib/hr/documentCenter";
const res = await fileOfferLetter(offerId);   // hr_file_offer_letter + PDF build + hr_register_letter_file + upload
if (res.error) { /* res.pendingDocument set => text filed, PDF not stored; resume with resumeLetterPdf(id) */ }
```
Result: one `hr_documents` row per offer (`category = offer_letter`, `source = 'recruitment'`,
`source_ref = offer id`, `includes_compensation = true`), one version per filed letter version, verified
when the PDF lands; the employee is notified. Filing the same letter version twice is refused; a new
Recruitment letter version can be filed as version n+1. The offer row is never written.
Listing for a UI: `offerLettersForDocuments()` (`hr_offer_letters_for_documents()`), also usable in Recruitment.
Recruitment may reuse `letterPdf({ title, body, reference })` for its own offer PDF previews.
Already available to HR without Recruitment changes: Documents → Letters → "Offer letters (Recruitment)".
Recommended Recruitment UI change (M3, not done here): after `convertCandidate` succeeds and the offer is
accepted, show "File offer letter to employee documents" calling `fileOfferLetter`.

### 3.2 Onboarding & Exit → appointment, confirmation, experience, relieving letters (exact)

Templates (seeded, approved): `appointment_letter`, `appointment_letter_with_ctc` (needs
`documents.compensation`), `employment_confirmation`, `experience_letter`, `relieving_letter`.
Caller: `documents.manage`, not the subject employee. Identity / employment fields come from
`hr_employees`; the caller supplies only the values below.

```js
import { issueLetter, listTemplates } from "@/lib/hr/documentCenter";
const tpl = (await listTemplates()).data.find((t) => t.code === "relieving_letter");   // approved snapshot is used
const res = await issueLetter(tpl.id, employeeId, { signatory_name, signatory_title, issue_date /* optional */ });
// res.data: { document_id, version, storage_path, title, body, reference }; res.pendingDocument on PDF failure
```

| Event (owner) | Template | Required record fields | Values to pass |
|---|---|---|---|
| Joined / onboarding case (M4) | `appointment_letter` | designation, department, joining_date, employment_type, work_location, manager | `signatory_name`, `signatory_title`, `terms_and_conditions` |
| Probation confirmed — `confirmation_date` set by 130 (M4) | `employment_confirmation` | designation, department, joining_date | `effective_date` = the confirmation date, `signatory_*` |
| Exit at `final_settlement` (110/130) | `relieving_letter` | `last_working_date` (set by 110), designation, department, joining_date | `signatory_*` |
| Exit at `final_settlement` | `experience_letter` | `last_working_date`, joining_date, designation | `signatory_*`, optional `additional_notes` |

Exit wiring (M4): `hr_record_exit_letter(exit, 'relieving'|'experience')` today only stamps
`relieving_letter_issued_at` / `experience_letter_issued_at`; no document exists. Recommended:
issue with `issueLetter`, then call `hr_record_exit_letter`; optionally add
`hr_exits.relieving_document_id / experience_document_id` (FK `hr_documents`) and require it before the
`relieving_letter` clearance item can be completed. Issue **before** `hr_close_exit`: closing disables
portal access, after which the leaver can no longer open the letter in the portal (HR can still download
and send it). Issuing to an `exited` employee is allowed; to `archived` is refused.
Preview first (`previewLetter(tpl.id, employeeId, values)`): `missing` lists unfilled placeholders; issue
fails until they are filled. Links: `/hr/documents?tab=letters`.

### 3.3 Other points
* Employee Management: `EmployeeProfileSections.jsx` keeps using the unchanged `DocumentsPage` exports.
* Training (115) certificate category gets `doc_group = certificate`.
* Requests (180): salary certificates must be `includes_compensation` documents — produced by
  `appointment_letter_with_ctc`-style templates or `hr_set_document_details(..., {includes_compensation:true})`.
* Dashboard / Reports (112, 117, 190): unchanged counts on `hr_documents`; new `replaced` status should
  be excluded from "expiring" style widgets (129's own overview already does).
* Notification links used by 129: `/hr/documents?tab=verification|expiry`, `/employee/documents?tab=policies|acknowledgements|expiring`.

## 4. Permissions and security controls

### 4.1 Salary letters — layered controls (verified by test 129 and the browser flows)
1. **Permission** `documents.compensation`: HR Admin (explicit), Super Admin (implicit). Not managers,
   payroll admins, recruiters or the custom "doc clerk" test role.
2. **Marking**: categories with `contains_compensation` (offer letters) force
   `includes_compensation = true` in a BEFORE INSERT trigger; a non-holder cannot add one for someone else.
   Templates using `annual_ctc / monthly_gross / currency` are marked and can only be saved, approved,
   previewed or issued by holders; compensation values passed by a non-holder are refused.
   Auto-fill from payroll additionally requires `payroll.view`.
3. **Row level**: `hr_private.document_can_read()` = category visibility **and** (not compensation **or**
   the document's own employee **or** `documents.compensation`). It is the policy of `hr_documents`,
   `hr_document_versions`, `hr_document_letter_content` (the rendered text, which contains the amounts),
   `hr_document_reviews`, `hr_document_renewal_requests`; and the filter of the directory / overview RPCs.
4. **Storage level**: bucket `hr-documents` is private; SELECT policy `document_object_readable(name)` →
   `document_can_read`, so `createSignedUrl` fails for anyone else (manager / clerk download refused in
   tests); INSERT only to the exact path the caller registered within 24 h; no UPDATE / DELETE policies.
5. **Other channels**: managers are never sent reminders about compensation documents; emails contain
   titles and dates only; audit rows of `hr_documents` hold no amounts and the letter text table is not
   copied into the audit log; every view / download is logged (`hr_document_access_log`).

### 4.2 Gaps (metadata, not amounts) — proposed, not implemented
| Gap | Effect | Proposed fix |
|---|---|---|
| 107 `hr_expiring_documents`, `hr_document_checklist` use `document_can_view` (no compensation check) | A documents.view holder without compensation, or a manager, sees the *title / status / expiry* of an offer letter | Wrap with `document_can_read` in 129 |
| 107 `hr_verify_document`, `hr_archive_document` check only `documents.manage` | A manager of documents without compensation can verify, reject or archive a salary letter blind | Add `document_can_read` check (changes a 107 RPC that M4 also calls — needs approval) |
| `hr_document_access_log` readable by `documents.view` | Reveals that a compensation document was opened | Filter by `document_can_read` |
| Signed URLs (60 s) are bearer links | Anyone given the link within 60 s can download | Accepted Supabase pattern; keep TTL short |

### 4.3 Hardened in this preparation pass — internal helpers (defence in depth)
Finding: `100_hr_foundation.sql` sets default privileges granting EXECUTE on every new `hr_private`
function to `authenticated`, and 130 / 170 / 190 re-run blanket grants, so revoking is not a control.
At the **SQL level**, a session running as an ordinary employee could call `hr_private.doc_apply_details()`
(and `doc_supersede`) and change another employee's document metadata, and the read-only helpers
revealed colleagues' pending items, names and policy audiences.
**Reachability:** not from clients today. `supabase/config.toml` keeps the default exposed schemas
(`public`, `graphql_public`) and the local harness rejects any other schema (PGRST106), so the Data API
cannot call `hr_private` functions. The risk materialises only if `hr_private` is ever exposed, or if
other server-side code (dynamic SQL in a SECURITY DEFINER function, a future Edge Function using SQL)
passes user input into these helpers. Keep `hr_private` out of the exposed schemas.
**Hardening (129 only):** each such helper now enforces access itself —
`doc_apply_details` (HR, or the employee dating their own fresh upload), `doc_supersede` (HR + read),
`doc_merge_data` (HR), `doc_current_letter` / `doc_letter_reference` (HR), `pending_acknowledgements`
and `policy_targets` (HR or self only), `doc_employee_name` (self / HR / employee access).
10 regression assertions added. The same SQL-level pattern exists in the foundation (100):
`hr_private.audit_event` (forged audit rows) and `notify_user` / `notify_employee` /
`notify_permission_holders` (forged notifications) — confirmed by M4's probe; also not API-reachable while
`hr_private` stays unexposed, but it needs an **HRMS-wide decision** (owner: foundation / integration lead); M10 documents it as X7 and moved its
helpers to an `hr_internal` schema; M6 added an in-function check to `hr_private.leave_policy_write`.
**Recommendation for integration:** keep `hr_private` unexposed (a release check on `config.toml` /
dashboard API settings), and either adopt the `hr_internal` pattern for write helpers or drop the
default-privilege grant and grant only the RLS helpers explicitly.

### 4.4 Other permissions
`documents.manage`: issue letters, register letter PDFs, templates (save), policies, contracts, renewals,
reminders, acknowledgement reminders. `settings.manage`: approve templates, edit reminder settings.
`documents.view`: read-only directory, tracker. Employees: own documents, own acknowledgements,
published policies for their audience. Self-actions blocked: verifying own documents, issuing letters
to oneself, filing one's own offer letter.

## 5. Proposed server-side PDF generation (NOT implemented — needs approval)

Problem: the browser builds the PDF from server-stored text and uploads it to the registered path; an HR
user could upload a different PDF there.

**Proposal: Edge Function `hr-render-letter` (service-side render + upload; clients can no longer upload letter files).**
1. Storage lock: change `hr_private.document_object_can_upload(name)` so a path whose
   `hr_document_versions.letter_content_id is not null` is **never** uploadable by `authenticated`.
2. `hr_register_letter_file` becomes service-role only (or checks `auth.role() = 'service_role'`).
3. Function flow: verify the caller's JWT and `documents.manage` (+ `documents.compensation` when the
   letter includes compensation) via `callerClient` → read the pending `hr_document_letter_content` row
   with the service client → render with the same deterministic writer (`src/lib/hr/pdf.js` is pure JS
   and runs unchanged in Deno; or pdf-lib + embedded font, see §6) → compute SHA-256 → call
   `hr_register_letter_file(doc, size, sha256)` as service → upload with the service client
   (`upsert: false`) → return the version. The issuer's identity is passed in and recorded as `uploaded_by`.
4. Integrity on read: store the SHA-256 (already a column); an optional nightly job re-hashes stored
   letter objects and flags mismatches.
5. Client change: `issueLetter` / `fileOfferLetter` call the function instead of `storeLetterPdf`.
Lighter alternative (if a renderer in Edge Functions is not wanted): keep client upload but have a
service job download each new letter object, re-render from the stored text, compare SHA-256 and only
then mark it verified; on mismatch delete the object and flag it. Weaker (a window exists before the check).
Effort: ~1 day incl. tests; requires deploying one more function.

## 6. Unicode and separation of duties (identified, not implemented)
* **Unicode:** data and templates are full Unicode, but `pdf.js` uses the standard Helvetica font with
  Windows-1252 encoding: Devanagari / Tamil / Arabic (113's `name_arabic`) etc. become `?`; `₹` becomes
  `Rs.`; the issue is silent. Indic scripts also need shaping, which a simple font embed does not do.
  Options: (a) block/warn before issuing when text has characters outside Windows-1252 (small, immediate);
  (b) server-side renderer with embedded Noto fonts and shaping (e.g. HarfBuzz-based, or an HTML→PDF
  service) as part of §5. The in-app letter text (HTML) already displays all scripts correctly.
* **Template approval:** the same `settings.manage` user (HR Admin) can edit a draft and approve it —
  no four-eyes rule. Proposal: record the editor per revision (`updated_by` exists) and require
  `approved_by <> updated_by` unless a setting `documents.allow_self_approval` (for single-HR companies) is on.
  Same for policies (draft and publish by one user) and for letter issue (no approval step by design).

## 7. Audit history (verified — test 129 §"audit history retained")
* Letter versions: `hr_document_versions` and `hr_document_letter_content` are immutable (triggers);
  re-issue adds rows; every version insert is in `hr_audit_log`.
* Contract renewals: a new record supersedes the old; the old record, its versions and file are kept;
  the status change (→ `replaced` / `renewed`) is in `hr_audit_log` with before/after and in `hr_document_reviews`.
* Policies: published versions immutable (trigger); supersede/archive transitions audited; v1 text kept.
* Acknowledgements: append-only (trigger), one row per version, each insert audited.
* Template approved snapshots: immutable.

## 8. Production prerequisites
**Database:** apply 129 after 100–120 and before 130 / 160 / 180; 129 needs no new extension (uses
core `gen_random_uuid` / `md5` and the `citext` already required by 100). A trigger is created on `storage.objects` (`hr_documents_object_uploaded`) —
the migration role must be allowed to create triggers there (true for the Supabase `postgres` role).

**`hr-document-reminders` Edge Function**
* Deploy with JWT verification **on** (default; not listed in `config.toml`).
* Secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (platform-provided);
  `ALLOWED_ORIGINS` = production origins (the shared default also allows localhost and Lovable previews).
* Schedule (after approval): daily via `pg_cron` + `pg_net`, service-role key read from Vault (example in
  `MODULE_9_DOCUMENTS.md`). Cron runs in UTC; reminders use the business date (Asia/Kolkata):
  `30 1 * * *` = 07:00 IST.
* Idempotent: per document/event/date/stage log with a unique key; a concurrent duplicate run fails on the
  unique key and rolls back, so no duplicate notifications. A failed run rolls back its run row too —
  monitor `cron.job_run_details` / function logs, and alert when no `completed` row in
  `hr_document_reminder_runs` for > 26 h.
* Review `hr_settings.documents` before go-live (reminder days, recipients, `email_reminders` = false).

**`hr-email-dispatch`**
* Secrets: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` on a domain with SPF / DKIM / DMARC.
* Schedule after the reminder job (e.g. every 5–10 min); 25 rows per call.
* Without a provider, rows are marked `failed` with an explicit reason — never "sent". Failed rows are not
  retried automatically (re-queue manually after fixing the provider).
* Turn on `email_reminders` only after a test message to a synthetic address is confirmed delivered.

## 9. Remaining limitations
Client-side PDF upload (§5); Windows-1252-only PDFs (§6); no four-eyes approval (§6); metadata gaps (§4.2);
acknowledgement ≠ e-signature; no production scheduler; offer-letter filing needs an HR Admin (recruiters
lack `documents.compensation`); the legacy 107 reminder function still exists (unused by the UI).

## 10. Tests required after integration
1. `node scripts/hr-db-test.mjs` on the merged tree — all files, including 129 (218), 130, 160, 180;
   resolve 105 / 110 with M7 / M4 first; `--seed` smoke.
2. `node --test "tests/*.test.mjs"` (PDF writer).
3. `vite build`.
4. Harness: `node scripts/hrms-local/browser-flows-m9.mjs --state <state json>` (75 checks) plus the
   other modules' flows; verify one HR notification per employee upload with 129 + 130 together.
5. Cross-module manual / scripted: Recruitment accept → convert → file offer letter → employee sees it,
   manager and recruiter cannot; probation confirm → confirmation letter; exit → relieving + experience
   letters before close; leave supporting document (160) still hidden from managers.
6. Security regression: direct `hr_private.*` calls as an employee (the 129 assertions) after **all**
   blanket grants have run; storage signed-URL denial for compensation letters as manager / clerk.
7. After any scheduler set-up in a non-production project: one scheduled run logged as `scheduler`,
   idempotent second run, email dispatch to a synthetic mailbox.
