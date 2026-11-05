# Module 6 — Leave Management (session 6)

Worktree `D:/Projects/zyllo-tech-website-intern-m6`, branch `hrms/module-6-leave`.
The uncommitted Intern baseline is **staged** in the worktree; Module 6 work is the **unstaged** diff
(`git diff`) plus the untracked files below. Nothing is committed, pushed or deployed.

## 1. Kept from the existing implementation (103)
Leave types, yearly balances with an adjustment trail, `hr_apply_leave` validation (dates, year boundary, backdating /
advance window, half days, probation, overlap, document threshold, balance / negative rules), the level-aware
manager → HR approval (`approval_flow` setting), clarification request / reply, cancellation rules, balance
adjustments, leave-year initialisation with carry-forward, the employee page, notifications, the HR Dashboard
integration (`is_on_approved_leave`, `leave_can_act`, `/hr/leave?tab=…&status=&from=&to=` links) and all RLS.
103's apply / decide / cancel bodies are unchanged: they moved to `hr_leave_internal.*_core` (no API-role access) and the public RPCs wrap them.

## 2. New (migration `160_hr_leave_management.sql`)
| Area | What |
|---|---|
| Policies | New columns: eligible employment types, min/max days per request, advance notice, carry-forward expiry (months), effective from/to, quarterly accrual, "document always" (`requires_document_after_days = 0`). Maker-checker: `hr_propose_leave_policy` → a **different** HR user `hr_decide_leave_policy` (setting `leave.policy_approval`, default `required`); dry-run validation; stale-proposal check; direct table writes refused for signed-in users. Every applied change is snapshotted in `hr_leave_policy_versions`; requests record `policy_version`. Maternity / Paternity / Comp-off seeded **inactive with 0 days** (no statutory values). |
| Ledger | `hr_leave_ledger`: a trigger records every change to every balance bucket (any code path) with the effect on `available`; request entries are linked and **unique per request** (reserve / consume / release / restore) → no double deduction. |
| Per-day leave | `hr_leave_request_days` (portion 1 / 0.5, half first/second) written at apply; `hr_private.leave_portion_on(emp, date)` for attendance; `payroll_lop_days` (same signature) now sums this stored breakdown. |
| Holidays | `hr_holidays.legal_entity_id` (company scope; same column/index as Attendance 125). Holiday edits **flag** affected pending/approved requests (`holiday_review_required`, event, HR notification); approval is blocked until `hr_recalculate_leave_request` (audited, ledgered, employee notified). |
| Balances | Opening balance (`hr_set_opening_leave_balance`), carry-forward expiry (`hr_process_leave_expiry`, also lazy on read), year-end close (`hr_close_leave_year`: finalise accrual, true-up next year's carry-forward, record lapsed days, freeze the year). `available` is unchanged (opening/expiry post through `adjusted`). |
| Requests | Real supporting documents: `p_document_id` on `hr_apply_leave` (category `leave_supporting`); line managers cannot open them (`document_can_view` excludes the category from `documents.view_team`). Status guard trigger: no backwards transitions; dates/type immutable. |
| Read RPCs | `hr_leave_overview`, `hr_leave_calendar` (+ department / employee / company / pending filters; colleagues' rows masked as "On leave"; no reasons), `hr_my_leave_types`, `hr_my_holidays`, `hr_leave_attendance_days`, `hr_leave_payroll_summary` (read-only; no automatic deduction). |

UI: Leave Management gains **Overview** (KPIs, on leave today, upcoming, by type, balance summary, holidays; filters),
**Policies** (propose / approve / history), **Holidays** (shared master), approval filters, holiday-review flag +
Recalculate, balance **ledger**, opening balance, expiry + year close. HR Settings → Leave types uses the same policy
screen. My Leave: eligibility-aware apply form (balance for the request's year, rules, file upload), balance history,
company holidays, privacy-aware team calendar.

## 3. Files
Modified: `src/lib/hr/leave.js`, `src/hr/pages/LeavePage.jsx`, `src/employee/pages/MyLeavePage.jsx`,
`src/hr/settings/LeaveTypesSettings.jsx`, `src/hr/settings/HolidaysSettings.jsx`, `supabase/tests/hr/103_leave.test.sql`
(sets `policy_approval: not_required` because it edits types directly), `supabase/tests/hrms-local/extra_fixtures_3.sql`
(fixture leave type inserted as owner).
New: `supabase/migrations/160_hr_leave_management.sql`, `supabase/tests/hr/160_leave_management.test.sql`, `supabase/tests/hr/160b_leave_attendance_integration.test.sql`, `docs/hrms/integration/*`,
`src/hr/leave/LeavePolicies.jsx`, `scripts/hrms-local/browser-flows-leave.mjs`, this file.

## 4. Tests (local only, synthetic data)
* `node scripts/hr-db-test.mjs` — 22/22 files, 1142 assertions (160: 107; 160b skips without 125). Integration rehearsal with all 30 HRMS migrations: 33/33 files, 2515 assertions (160b: 13). See `integration/MODULE6_INTEGRATION_READINESS.md`.
* `npx vite build` — passes. `eslint` cannot run in any tree (config imports the missing `eslint-config-next`) — pre-existing.
* `node scripts/hrms-local/browser-flows-leave.mjs` on an isolated harness — 51/51 (UI, DB, permission, error, refresh, 390 px mobile), 0 page exceptions, 0 external requests.

## 5. Integration notes
* **Attendance 125** applies before 160: 160 defines `is_holiday` only if `hr_private.holiday_on` is absent; column and unique index are idempotent. Merge Module 5's `module5-holidays-settings.patch` (recurring, description) into `HolidaysSettings.jsx` after this one. Module 5 follow-up: switch `attendance_day_type`'s leave branch to `leave_portion_on` (half days).
* **Payroll 170** keeps calling `payroll_lop_days(uuid, date, date, boolean)`; signature unchanged.
* **Onboarding/Exit 130** reads `hr_leave_balances.available` / `hr_leave_types.paid` — unchanged.
* **HR Dashboard 117** uses `is_on_approved_leave`, `is_working_day_for`, `leave_can_act` — unchanged; `?tab=` links preserved (default tab is now Overview).
* Migration number 160 was chosen to stay clear of 118–1xx used by other sessions.

## 6. Remaining gaps
* HR scope is permission-based (single tenant); "company" is a filter, not a security boundary — a company-scoped HR role needs a foundation change.
* Approval route is the global `approval_flow`; no per-type routing. Repeated approvals are refused with an error (no state change), not silently accepted.
* Expiry / year-end are manual buttons (expiry also lazy); no scheduler is defined (project-wide gap X3).
* Approved policy changes apply immediately; future-dated proposals are refused (no scheduled activation). Use a type's "leave can be taken from/until" window to start or end a type on a date.
* Leave emails are in-app notifications only (project-wide gap X2).
