# HRMS Module 4: Onboarding & Employee Exit

**Status:** built and tested in an isolated worktree. **Not committed. Not merged. Not deployed.**

- **Worktree:** `D:\Projects\zyllo-tech-website-intern-m4`
- **Branch:** `hrms/module-4-onboarding-exit`
- **Base:** created from `Intern` @ 99fa9b5. The uncommitted HRMS snapshot of the shared Intern tree was copied in at 2026-11-05 10:33:53 and **staged (not committed)** as the baseline, so `git diff` in the worktree shows only Module 4 changes.

## 1. What is reused (no duplicate systems)

| Need | Reused existing implementation |
|---|---|
| Hire confirmation | `hr_convert_candidate_to_employee` (104) is unchanged. An `AFTER INSERT` trigger on `hr_employees` (source = `candidate`) opens the onboarding case and links the accepted `hr_offers` row. |
| Documents | `hr_documents`, private `hr-documents` bucket, signed URLs, `hr_register_document_upload`, `hr_verify_document`, `hr_document_checklist` (107). No new file storage. |
| Induction training | `hr_training_assignments` (115). Linking a task assigns the course, and completing the training completes the task (trigger). |
| Equipment | `hr_asset_assignments` / `hr_employee_open_assets` (109). |
| Employee status | `hr_employees` (100) and `confirmation_date`. `hr_employee_change_events` and the history `event_id` link come from Employee Management (117/118) when installed. |
| Resignation, clearance, closure | `hr_exits`, `hr_exit_clearance_items`, `hr_exit_events` and the exit RPCs (110). Four RPCs were replaced in place with stricter, backward-compatible versions. |
| Access revocation | The `hr-revoke-exit-access` Edge Function, which now also records failures. |
| Payroll data | `hr_payroll_items/runs`, `hr_reimbursements`, `hr_leave_balances`, `hr_salary_structures` (read-only) as the settlement prefill. |
| Notifications / audit | `notify_employee`, `notify_permission_holders`, `audit_event`, `enable_audit`. |

## 2. Database: `supabase/migrations/130_hr_onboarding_exit.sql`

**New tables** (RLS on, anon revoked, audited):
- `hr_onboarding_templates`, `hr_onboarding_template_tasks`: checklist master data. A `standard` template with 10 tasks is seeded.
- `hr_onboarding_cases`: one live case per employee and per offer (unique partial indexes).
- `hr_onboarding_tasks`, `hr_onboarding_events`.
- `hr_probation_reviews` (one open review per employee), `hr_probation_events`.
- `hr_exit_access_revocations`: every revocation attempt, failure and exception.
- `hr_payroll_settlements`, `hr_payroll_settlement_lines`. These are named `hr_payroll_*` so their audit rows are payroll-restricted, and amounts are redacted in the audit log.

**Changed tables (additive):**
- `hr_exit_clearance_items`:
  - New item key `it_clearance` and new status `waived` (an authorised exception).
  - New columns `department`, `due_date`, `mandatory`, `assignee_employee_id`, `evidence_document_id`, `exception_*`.
- `hr_exits`: new columns `access_revocation_status` (not_started / revoked / failed / exception / not_applicable), `access_revocation_error` and `access_exception_*`.
- `hr_employees.confirmation_date`: `add column if not exists`, so it is idempotent with module 2.

**Settings** (`hr_settings.lifecycle`):
- `default_onboarding_template`
- `probation_reminder_days` (14)
- `resignation_withdrawal`: `before_hr_approval` (default, the previous behaviour), `before_clearance` or `never`
- `access_revocation_timing`: `on_last_working_day` (default) or `from_clearance`

**Replaced 110 RPCs:**
- **`hr_start_exit_clearance`:** 9 items, adding IT clearance, department owners, due date = approved LWD, and the manager assigned to handovers. It notifies IT and payroll owners.
- **`hr_complete_clearance_item`:**
  - Item owners may now act: HR (`exit.manage`), IT (`exit.clearance_it`), asset managers, payroll for finance/settlement, and the line manager for handovers.
  - The leaver can never act on their own exit.
  - Access revocation can no longer be skipped as "not applicable" while a portal account exists.
  - `final_settlement` completes only through an approved settlement (or a payroll approver's N/A).
- **`hr_withdraw_resignation`:** follows the withdrawal policy and cancels any draft settlement.
- **`hr_can_revoke_exit_access`:** allows `exit.clearance_it` and applies the timing policy.
- **`hr_record_auth_access_revoked`:** also logs the attempt.

**New permissions:**
- `onboarding.view`, `onboarding.view_team`, `onboarding.manage`
- `probation.view`, `probation.view_team`, `probation.review_team`, `probation.decide`
- `exit.clearance_it`, `exit.override`

**Default grants:**
- **hr_admin:** onboarding.view, onboarding.manage, probation.view, probation.decide
- **manager:** onboarding.view_team, probation.view_team, probation.review_team
- **super_admin:** all

`exit.clearance_it` and `exit.override` are not granted to any other role by default. Assign them in HR Settings → Roles.

## 3. Security rules enforced on the server
- Nobody acts on their own onboarding, probation, clearance or settlement (`self_action`).
- Joiners read their onboarding only through `hr_my_lifecycle()`. It omits HR notes, evidence notes, internal events, manager feedback, HR comments, internal tasks, and settlement amounts until approval.
- Mandatory clearance blocks settlement and closure, except through `hr_grant_clearance_exception`. That needs `exit.override`, is never for one's own exit, requires a 10+ character reason, is audited (`CLEARANCE_EXCEPTION`) and notifies HR. Assets still assigned can never be excepted.
- **Access revocation:**
  - Timing follows policy.
  - A failure is recorded by the Edge Function (`hr_record_access_revocation_failure`, service role only) and shown as a blocking state.
  - Closure stays blocked until revocation succeeds or an exception is recorded. `hr_close_exit` still turns portal access off and removes roles.
- **Settlement:**
  - Preparation needs `payroll.manage`.
  - Approval needs `payroll.approve` and a different person from the preparer, the submitter and every editor (the `editors[]` array).
  - The leaver can never approve their own settlement.
  - HR without payroll access sees only status (`hr_exit_settlement_status`).
  - "Mark paid" records a reference only. No transfer is made.
- **No invented statutory rules:**
  - Salary due = working days since the last finalized payroll × the daily rate from the last finalized payslip (a reviewable suggestion).
  - Finalized-unpaid payroll and approved reimbursements use exact amounts.
  - Leave encashment and notice recovery are listed with quantities, and the **amount is 0** until the preparer applies company policy.
- Probation decisions update `hr_employees` in the same transaction and record a module-2 change event (when installed), linked to the history rows written in that transaction (max-id watermark).

## 4. Routes

**HR Operations:** `/hr/onboarding-exit/*`. The nav item "Onboarding & Exit" goes directly after "Recruitment & Hiring".

| Route | Section | Visible with |
|---|---|---|
| `/hr/onboarding-exit` | Overview (permission-scoped counts) | any module permission |
| `…/onboarding`, `…/onboarding/:id` | Onboarding cases, case detail and checklist | onboarding.* |
| `…/documents` | Document verification for joiners | onboarding.view/manage **and** documents.view/manage |
| `…/induction` | Induction tracker | onboarding.* |
| `…/probation` | Reviews, reminders, feedback, decisions | probation.* |
| `…/resignations` | Resignations by request status (links to `/hr/exits/:id`) | exit.* |
| `…/clearance` | Clearance tracker (links to `/hr/exits/:id`) | exit.*, exit.clearance_it, payroll.manage/approve |
| `…/settlement`, `…/settlement/:id` | F&F queue, editor, approval, payment, statement/PDF | payroll.view |

Aliases: `/hr/onboarding`, `/hr/probation`, `/hr/final-settlement`. The existing `/hr/exits` module also opens to `exit.clearance_it`.

**Employee Portal** (existing routes untouched):
- `/employee/onboarding`: My Onboarding (checklist, induction + acknowledgements, documents, probation).
- `/employee/resignation`: My Resignation (submit/withdraw per policy, clearance status, settlement status and statement).
- The old notification link `/employee/exit` now redirects to `/employee/resignation`.
- Document upload stays in **My Documents**.

## 5. Files

**New:**
- `supabase/migrations/130_hr_onboarding_exit.sql`
- `supabase/tests/hr/130_onboarding_exit.test.sql` (120 assertions)
- `src/lib/hr/lifecycle.js`
- `src/lib/hr/settlementStatement.js`
- `src/hr/pages/lifecycle/`: `OnboardingExitPage.jsx`, `permissions.js`, `shared.jsx`, `OnboardingPages.jsx`, `DocumentVerificationPage.jsx`, `InductionPage.jsx`, `ProbationPage.jsx`, `ResignationsPage.jsx`, `ClearancePage.jsx`, `SettlementPages.jsx`
- `src/employee/pages/MyOnboardingPage.jsx`, `src/employee/pages/MyResignationPage.jsx`
- `scripts/hrms-local/browser-flows-m4.mjs` (test only)
- this document

**Modified (shared files, apply at integration):**
- `src/hr/HrApp.jsx`: icon import, `LIFECYCLE_PERMISSIONS` import, the module entry after recruitment, `exit.clearance_it` added to the exits entry, 3 aliases.
- `src/employee/EmployeeApp.jsx`: 2 icons, 2 pages, the `exit` redirect.
- `src/hr/pages/ExitsPage.jsx`: owner-aware clearance actions, waived/exception display, the Exception action, the revocation-failed banner and attempts, the settlement status card, due dates and departments.
- `src/lib/hr/exits.js`: the `it_clearance` label, "Finance clearance" label, and the `canActOnClearance` helper.
- `supabase/functions/hr-revoke-exit-access/index.ts`: records failures.
- `supabase/tests/hr/110_exit.test.sql`: now expects 9 items, completes IT clearance, and completes the final settlement through a payroll-approved settlement.

## 6. Integration steps (when the owner approves)
1. Re-read each shared file in the Intern tree first. Modules 1–3 have changed `HrApp.jsx`; Recruitment & Hiring now sits right after Employee Management.
2. Copy the new files. Apply the shared-file hunks from `git -C D:\Projects\zyllo-tech-website-intern-m4 diff --cached`-relative changes (`git diff` in the worktree), or from `docs/hrms/module4-integration.patch`.
3. Run `node scripts/hr-db-test.mjs` in the Intern tree. Migration 130 sorts after 118 (Employee Management) and 120 (Recruitment & Hiring), and depends on neither.
4. Deploy order (dev project first, never live without approval): migration 130, then the updated `hr-revoke-exit-access` function, then the frontend.

## 7. Known gaps
- **No scheduler:** probation reminders and access revocation are run by HR/IT (buttons and RPCs). No cron is configured; a scheduled Edge Function could call `hr_generate_probation_reviews`.
- **Settlement statement:** a printable HTML page saved through the browser's "Save as PDF". No server-side PDF is generated or stored in Documents.
- **Duplicate resignation UI:** `MyHrRequestsPage` still has its own resignation card. It works, and the server enforces the withdrawal policy, but a pointer to My Resignation would remove the duplicate.
- **Local harness:** the emulation of `hr-revoke-exit-access` does not emulate the new failure recording.
- **No template editor:** templates are edited via table policies (`saveTemplateTask` in `lifecycle.js`), but there is no HR Settings screen for them yet.
- **Statutory items:** gratuity, tax and similar items are deliberately not calculated. They can be added as manual lines.
