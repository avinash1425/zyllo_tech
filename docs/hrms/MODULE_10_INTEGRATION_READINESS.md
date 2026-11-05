# Module 10 — HR Requests & Approvals: integration readiness

State on 2026-11-05. All Module 10 work is in worktree `D:\Projects\zyllo-tech-website-intern-m10`, branch
`hrms/module-10-requests` (base `99fa9b5`, the HRMS baseline staged in the index, Module 10 changes unstaged).
Nothing committed, pushed, merged or deployed. The `Intern` worktree is unchanged by this session.
Design and API: see `MODULE_10_REQUESTS_APPROVALS.md`.

## 1. Blocking conflicts (outside Module 10)

### B1 — Module 9 test 129 failed when Module 4's 130 was applied — RESOLVED by Module 4 (re-verified)

Update: Module 4 changed 130 to notify from Module 9's notification point (trigger `hr_documents_object_uploaded` on
`storage.objects`, bucket `hr-documents`) and dropped `hr_document_versions_notify_hr`. Re-run with Module 4's current
130: **30/30 files, 2,371 assertions** (129, 130 and 180 pass). Coordination: 130 detects Module 9 by the trigger name
`hr_documents_object_uploaded`, so Module 9 must keep that name. Original analysis below for the record.

- Failing assertion: `supabase/tests/hr/129_employee_documents.test.sql:75`
  `select test.ok(not exists (select 1 from public.hr_notifications where type = 'document_uploaded' and entity_id = <cert>), 'no HR notification before the file is stored')`
- Cause: `130_hr_onboarding_exit.sql:1081-1105` (Module 4) adds `hr_private.document_upload_notify_hr()` and trigger
  `hr_document_versions_notify_hr AFTER INSERT ON hr_document_versions`. It sends `document_uploaded` to
  `documents.manage` holders (and the onboarding coordinator) when the version row is **registered**, before the file
  object exists. Module 9's 129 (line ~776) sends the same notification type only after the storage object lands.
- Evidence (local, isolated clusters): baseline + 129 → PASS (198); baseline + 129 + 130 → FAIL at line 75; full
  combined run with or without 180 → same failure. Module 10 is not involved. Module 6's session independently
  reported the same root cause.
- Dependencies: tables `hr_documents`, `hr_document_versions`, `hr_notifications`; storage policy "registered upload".
- Recommended resolution (Module 4 + Module 9 owners): one notification point, owned by Module 9 (documents are its
  data). Module 4 drops its trigger/function in 130 and asks Module 9 to add the onboarding-coordinator recipient to
  129's on-store notification, e.g. Module 4: remove `create trigger hr_document_versions_notify_hr ...` and
  `hr_private.document_upload_notify_hr`; Module 9: in its on-store notify, also `notify_employee(<open onboarding case
  coordinator>, ...)` when the coordinator lacks `documents.manage`.
- Regression: 129 (all 198), 130 (120) and 180 pass together.

### B2 — Stale duplicate of Module 2's migration 118 in Module 4's worktree
- `zyllo-tech-website-intern-m4/supabase/migrations/117_hr_employee_management.sql` (staged `A`) is byte-identical to
  baseline `118_hr_employee_management.sql` except the header comments (it is the pre-rename name; Module 4's
  worktree has no 118). It collides with `117_hr_dashboard_essentials.sql` on the prefix, and if merged next to 118
  the same DDL runs twice (`create table public.hr_employee_change_events` → "already exists"); in a combined apply the
  run fails at 118. Same for `supabase/tests/hr/117_employee_management.test.sql` vs `118_employee_management.test.sql`.
- Resolution (Module 4 owner, or at merge): do not merge Module 4's `117_hr_employee_management.sql` or its 117 test;
  keep baseline 118. The combined rehearsal below excludes them.

## 2. Migration ordering

| # | File | Module (worktree) | Status |
|---|---|---|---|
| 100–118, 120 | baseline (+ 120 recruitment) | Intern | baseline |
| 125 | hr_attendance_time | 5 (m5) | ok |
| 128 | hr_daily_work_reports | 8 (m8) | ok |
| 129 | hr_employee_documents | 9 (m9) | ok (B1 resolved) |
| 130 | hr_onboarding_exit | 4 (m4) | ok; stray 117 still present (B2) |
| 141 | hr_asset_allocation | 11 (m11) | ok |
| 160 | hr_leave_management | 6 (m6) | ok |
| 170 | hr_payroll_salary | 7 (m7) | ok |
| **180** | **hr_requests_approvals** | **10 (m10)** | **unique (renumbered from 190)** |
| 190 | hr_reports_analytics | 12 (m12) | ok |

180 must apply after 105, 107, 111, 113 and 116. 125, 129 and 170 are optional for it (their columns are read
dynamically, so order relative to them does not matter), and 190 does not touch requests or the dashboard functions.
The hr_internal lockdown does not depend on running last.

## 3. Combined rehearsal (scratch copy, local only)

Baseline + all sibling migrations/tests that differ from baseline (125, 128, 129, 130, 141, 160, 170, 190 and their
modified 103/105/110 tests) + 180, excluding B2: first run 29/30 (2,187; 129 failed, B1). After Module 4's 130 fix:
**30/30 files pass, 2,371 assertions**.
180 passes in both configurations: 172 assertions combined, 166 on the Module 10 worktree alone.

## 4. Module 10 security restrictions (preserved, tested)

- `hr_internal` schema: 35 functions, 0 executable/usable by anon/authenticated (asserted, including after a deliberate
  blanket `grant execute on all functions in schema hr_internal to authenticated`). The 111 helpers that were
  re-granted (X7) are removed from `hr_private`.
- Requests readable only by RLS `hr_private.request_row_visible` (requester; `hr_requests.manage`; `hr_requests.view` for
  non-confidential helpdesk/letters; payroll/finance/manager only along their route; grievances never routed).
- No self-approval, distinct approver per stage, idempotent stage decisions, append-only history, immutable decided
  stages, no API writes on request tables, no API read of `hr_request_sensitive`, private bucket `hr-request-files`.

## 5. Other modules' helpers exposed by blanket grants

Catalog query on the combined schema: **342/342** `hr_private` functions are executable by `authenticated`
(blanket `grant execute on all functions in schema hr_private` in 100–120, 125, 128, 130, 160, 170, 190).
37 of them are `SECURITY DEFINER`, volatile, write data, and are not used by any RLS policy or trigger — i.e. they
bypass their module's permission checks if anyone can call them directly:

- Notifications / outbox / audit: `notify_user`, `notify_employee`, `notify_permission_holders`, `queue_email`,
  `audit_event`, `announcement_publish_now`.
- Attendance (5): `attendance_write`, `correction_event`.
- Leave (6): `apply_leave_core`, `decide_leave_core`, `cancel_leave_core`, `ensure_leave_balance`, `leave_event`,
  `leave_link_ledger`, `leave_policy_commit`, `leave_policy_write`, `leave_apply_expiry`.
- Payroll (7): `payroll_post_correction`, `payroll_refresh_payment_status`.
- Documents (9): `doc_apply_details`, `doc_supersede`.
- Recruitment (3): `generate_offer_letter`, `issue_offer`, `hold_application`, `reject_application`,
  `set_candidate_stage`, `publish_opening_posting`.
- Onboarding/exit/probation (4): `onboarding_create_case`, `onboarding_log`, `probation_open_review`, `probation_log`,
  `exit_log`, `settlement_recalc`, `lifecycle_change_event`.
- Assets (11): `asset_assign_full`, `asset_damage_create`, `asset_close_handover`, `asset_event`, `asset_set_state`.

Risk today: low only while `hr_private` is NOT in the Data API "Exposed schemas" (Supabase default exposes `public`
only; verify in Dashboard → API settings before go-live). Recommended (each owning module): move write helpers to a
schema without API usage (as Module 10 did with `hr_internal`), or `revoke execute ... from authenticated` on the
helpers above and stop running blanket grants. Callers are SECURITY DEFINER RPCs and are unaffected.
Regression: each module's DB tests + a catalog assertion like 180's section A.

## 6. Retire the legacy Payroll reimbursement entry point (Module 7)

`public.hr_submit_reimbursement` (105:416) creates `hr_reimbursements` rows in `submitted` state that payroll staff
approve directly (`hr_decide_reimbursement`), skipping the manager stage. Used by:
`src/lib/hr/payroll.js` (`submitReimbursement`; m7 line 303), `src/employee/pages/MyPayslipsPage.jsx`
(`ClaimModal`; m7 line ~307), `supabase/tests/hr/105_payroll.test.sql` (1 call),
`supabase/tests/hrms-local/local_fixtures.sql:272-273`.

Required changes (Module 7 owns the files; apply in a migration after 105/170, e.g. 171 or within 180 at merge):

```sql
create or replace function public.hr_submit_reimbursement(p_claim_date date, p_category text, p_amount numeric,
                                                          p_description text, p_receipt_path text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform hr_private.fail('Reimbursement claims are submitted in My HR Requests (New request → Reimbursement claim), '
    || 'which routes them for manager and finance approval.', 'use_hr_requests');
  return null;
end $$;
```
- Keep `hr_decide_reimbursement` for claims already in `submitted` state (backlog); request-created claims are
  inserted `approved`, so it cannot act on them.
- Frontend: delete `submitReimbursement` from `payroll.js`; in `MyPayslipsPage.jsx` remove `ClaimModal` and replace the
  "New claim" button with a link to `/employee/requests` (Module 10 chooser). Keep the claims list (it shows
  request-created claims and their payment status).
- Tests: 105 test and the harness fixtures must create claims through `hr_create_workflow_request('reimbursement', ...)`
  (+ receipt) or insert approved claims as owner; add a test asserting `hr_submit_reimbursement` raises `use_hr_requests`.

## 7. Bank changes stay unverified until a separate Payroll user confirms

Approved bank changes insert a new primary account with `verified = false`; the approving payroll user is the maker
(`created_by`). With Module 7 (170) applied, `hr_verify_bank_account` refuses the maker and the employee and accepts a
different `payroll.approve` holder — asserted in 180 (combined run). Without 170 the account simply stays unverified.
The request history notes "awaits verification by a second Payroll user"; payroll pre-run checks (170:1333) warn on
unverified primary accounts.

## 8. Module 9 letter issuance and compensation permissions

- Ordinary letters: HR (`hr_requests.manage`) approves; issue by `hr_issue_letter_request(request, document)` with an
  active, employee-viewable, non-confidential `hr_documents` record of the same employee — typically generated with
  Module 9's `hr_issue_document_letter(template, employee, values)` (needs `documents.manage`) — or an uploaded file.
- Salary certificates: issuer must be compensation-authorised = (`hr_requests.payroll` AND `payroll.view`) OR
  `documents.compensation` (129; granted to hr_admin by 129). Allowed sources: a document with
  `includes_compensation = true` (129 sets it from `contains_compensation` categories, readable only by the employee
  and `documents.compensation` holders), or a restricted request file. Plain documents are refused.
  `hr_letter_issue_options(request)` returns only eligible sources. All asserted in 180 when 129 is present.
- Policy note: 129 grants `documents.compensation` to hr_admin, so HR admins can issue salary certificates once 129 is
  merged. If compensation must stay payroll-only, Module 9 should not grant it to hr_admin.

## 9. HR Dashboard request counts (owner: dashboard / Module 1, no active session)

New statuses `pending_approval`, `returned`, `approved` (awaiting fulfilment) are not counted:
- `112_hr_dashboard_reports.sql:144` KPI `pending_hr_requests`: use
  `q.status in ('open','in_progress','waiting_on_employee','pending_approval','approved')`.
- `117_hr_dashboard_essentials.sql:137-140` approvals card: gate on any of `hr_requests.manage|payroll|finance|approve_team`
  and count `(public.hr_requests_overview() ->> 'awaiting_me')::int` (same rules as the inbox; includes attendance
  corrections only via Module 10 if the attendance card is removed — otherwise filter `'workflow'` to non-attendance).
- `117_hr_dashboard_essentials.sql:233-235` SLA alert: same status list as above; path `/hr/requests?tab=inbox&box=overdue`.
Apply as a later migration redefining `hr_dashboard` (do not edit 112/117 in place). Regression: 112, 116, 117 tests +
a test that a pending reimbursement increments the KPI.

## 10. Employee contact-edit bypass (owner: Employee Management; page touched by Module 7)

`public.hr_update_my_contact` (100:912) lets an employee overwrite phone, personal email, address, emergency contact
and display name immediately (audited with PII redacted), from `MyProfilePage.jsx` (~line 102). This bypasses the
Module 10 rule "do not modify authoritative records before approval".

Recommended policy: **approval required for identity-relevant fields, instant self-service only for low-risk ones.**
- Through Module 10 profile-change requests (HR review): personal email, phone, address (used for payroll / statutory
  communication and as recovery channels), plus bank (already payroll-only).
- Instant self-service: emergency contact name/relation/phone and display name.
Implementation (owner session): add setting `employee_self_service.contact_requires_approval` (default true); when true,
`hr_update_my_contact` fails with `use_profile_request` for the approval-required fields; `MyProfilePage` shows those
fields read-only with a "Request change" button opening the Module 10 profile-change form. Regression: 100/118 tests,
180 section J, browser check of My Profile.

## 11. Permission changes introduced by Module 10

| Permission | Granted to | Purpose |
|---|---|---|
| `hr_requests.approve_team` | manager, super_admin | Manager-stage approvals assigned/delegated to the caller |
| `hr_requests.payroll` | payroll_admin, super_admin | Payroll-routed requests (payroll queries, advances, bank changes, salary certificates) |
| `hr_requests.finance` | payroll_admin, super_admin | Finance stage; record/verify advance disbursements |

Unchanged: `hr_requests.view`, `hr_requests.manage`. Nav entry `/hr/requests` now unlocks with any of the five.

## 12. Affected files (Module 10)

- New: `supabase/migrations/180_hr_requests_approvals.sql`, `supabase/tests/hr/180_requests_approvals.test.sql`,
  `src/lib/hr/requestWorkflows.js`, `src/hr/requests/{RequestWidgets,HrApprovals,HrWorkflowDetail}.jsx`, `src/hr/requests/time.js`,
  `src/employee/requests/{NewRequestForms,MyWorkflowDetail}.jsx`, `scripts/hrms-local/browser-flows-m10.mjs`, these docs.
- Modified (Module 10's own): `src/lib/hr/requests.js`, `src/hr/pages/HrRequestsPage.jsx`, `src/employee/pages/MyHrRequestsPage.jsx`.
- Modified (shared): `src/hr/HrApp.jsx` (one nav line), `scripts/hrms-local/lib.mjs` (same `HRMS_LOCAL_INSTANCE` change as m9).

## 13. Required regression tests at integration

1. `node scripts/hr-db-test.mjs` on the merged tree: all files incl. 125, 128, 129, 130, 141, 160, 170, 180, 190 (after B2).
2. `node scripts/hr-db-test.mjs --seed` (seed smoke).
3. `npm test`; `npx vite build`.
4. Browser: `HRMS_LOCAL_INSTANCE=<x> node scripts/hrms-local/browser-flows-m10.mjs` on a fresh harness (47 checks), plus
   each module's own flows.
5. After §6: legacy `hr_submit_reimbursement` refused; claims only via requests; 105/170 tests updated.
6. After §9/§10: dashboard counts and My Profile behaviour.
7. Pre-go-live: confirm `hr_private`/`hr_internal` are not exposed API schemas (§5).
