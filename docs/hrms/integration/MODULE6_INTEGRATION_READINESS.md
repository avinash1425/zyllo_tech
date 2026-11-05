# Module 6 — Leave Management: integration readiness

Worktree `D:/Projects/zyllo-tech-website-intern-m6`, branch `hrms/module-6-leave` (not committed).
Baseline = the Intern working tree at the time the worktree was created, **staged**; Module 6 = unstaged
diff + untracked files. Module description: `docs/hrms/MODULE6_LEAVE_MANAGEMENT.md`.

## 1. Files and migrations

| Kind | Path | Notes |
|---|---|---|
| Migration (new) | `supabase/migrations/160_hr_leave_management.sql` | Applies after 100–150; re-runnable parts use `if not exists`. Creates schema `hr_leave_internal` (no API-role access). |
| DB test (new) | `supabase/tests/hr/160_leave_management.test.sql` | 107 assertions. |
| DB test (new) | `supabase/tests/hr/160b_leave_attendance_integration.test.sql` | Runs only when 125 is applied (13 assertions); skips otherwise. |
| DB test (modified) | `supabase/tests/hr/103_leave.test.sql` | +2 lines: sets `policy_approval: not_required` (it edits leave types directly). |
| Fixture (modified) | `supabase/tests/hrms-local/extra_fixtures_3.sql` | Inserts its synthetic leave type as owner (maker-checker). |
| UI (modified) | `src/lib/hr/leave.js`, `src/hr/pages/LeavePage.jsx`, `src/employee/pages/MyLeavePage.jsx`, `src/hr/settings/LeaveTypesSettings.jsx`, `src/hr/settings/HolidaysSettings.jsx` | |
| UI (new) | `src/hr/leave/LeavePolicies.jsx` | |
| Browser test (new) | `scripts/hrms-local/browser-flows-leave.mjs` | Chrome isolation: `--remote-debugging-port=0` + own profile's `DevToolsActivePort`, attaches only to its own `about:blank`. |
| Integration patch (new) | `docs/hrms/integration/module6-holidays-settings-with-module5.patch` | Module 5 holiday fields on top of Module 6's HolidaysSettings (apply **after** 125). |

Shared baseline files that changed in the Intern tree after the worktree was created: 103/104/105/116 migrations and several tests differ **only in line endings**; `117_hr_dashboard_essentials.sql` and its test have a recruitment-only change (interview feedback status). None affects Module 6.

### Compatibility rehearsal (scratch copy, throwaway PostgreSQL 17 cluster)
All 30 currently available HRMS migrations — Intern 100–118 + 120, and 125 (M5), 128 (M8), 129 (M9), 130 (M4, security-hardened), 141 (M11), **160**, 170 + 171 (M7), 180 (M10), 190 (M12) — applied in order with every module's latest tests (Module 4's 110 test and Module 7's 105 test, Module 6's 103 test):
**33/33 test files pass, 2515 assertions** (final run). `160b` ran against 125 (13 assertions).
An earlier rehearsal found one cross-module conflict, unrelated to leave: 129 (Module 9) vs 130 (Module 4) both notifying HR of employee uploads at different points. Module 4 changed 130 to defer to 129's storage trigger; both now pass (129: 218, 130: 121).

## 2. Module 5 (Attendance & Time, migration 125) dependencies

| Item | State |
|---|---|
| Single holiday master | `hr_holidays` only. 160 and 125 both `add column if not exists legal_entity_id` and create the identical `hr_holidays_scope_unique` index. 160 defines `is_holiday` **only if** `hr_private.holiday_on` is absent, so 125's recurring + company-aware version stays authoritative. |
| Working days | 160's `hr_private.leave_is_weekly_off(emp, date)` uses 125's `employee_shift_on(emp, date)` (date-effective assignments) and `is_weekly_off_rule` when present (checked at call time), otherwise 103's rule. `leave_days` / `leave_day_rows` use it. 160b proves leave counting = `attendance_day_type in ('working','leave')` on every day of a 29-day range (six-day shift with 2nd/4th Saturday off, a dated shift change, a recurring holiday). |
| Recurring holidays in leave | Day counts use `is_holiday` (recurring-aware). Lists (`hr_my_holidays`, overview) expand `is_recurring` rows via `hr_private.leave_holiday_occurrences`, reading the column through `to_jsonb` (works with or without 125). Holiday-change review also re-checks same month/day for recurring rows. |
| Signatures 160 relies on | `hr_private.employee_shift_on(uuid,date)` (columns `working_days`, `weekly_off_rules`), `hr_private.is_weekly_off_rule(jsonb,date)`, `hr_private.is_holiday(date,uuid)`, `hr_private.employee_working_days(uuid)` (fallback). |
| HolidaysSettings | Module 5's own patch no longer applies to Module 6's file (3 overlapping context lines, hunk 1 fails). Use `module6-holidays-settings-with-module5.patch` instead (verified: `git apply --check` clean; result compiles). Apply only together with 125 (it selects `is_recurring`, `description`). |

### Half-day leave via `hr_private.leave_portion_on` (to be applied in 125, by Module 5)
`hr_private.leave_portion_on(p_employee uuid, p_date date) returns numeric` → `0`, `0.5` or `1` from the stored per-day breakdown of **approved** leave (`hr_leave_request_days`: `portion`, `half` = `'first'` morning off / `'second'` afternoon off / null full day). Stored at application time, so later holiday edits do not change it.

Today 125's `attendance_day_type` returns `'leave'` whenever `is_on_approved_leave` is true, including half days (160b asserts this current behaviour). Required change in 125:

```sql
-- in hr_private.attendance_day_type, replace
--   if hr_private.is_on_approved_leave(p_employee, p_date) then return 'leave'; end if;
-- with
if hr_private.leave_portion_on(p_employee, p_date) >= 1 then return 'leave'; end if;
```
A half-day date then stays `'working'`; where attendance needs expected minutes for that day use
`(1 - hr_private.leave_portion_on(emp, d)) * expected_minutes` (and `hr_leave_request_days.half` to know which half).
Then update the last assertion of `160b` to expect `'working'`. `is_on_approved_leave` itself is unchanged (Dashboard 117, Daily reports 128 and Reports 190 call it).

## 3. Shared-function conflicts

| Object | Defined by | 160 does | Other callers | Status |
|---|---|---|---|---|
| `hr_private.is_holiday` | 103, 125 | fallback only when 125 absent | 101, 112, 125, 128, 190, 160 | Compatible |
| `hr_private.leave_days` | 103 | redefined (same signature, shared weekly-off test) | 103 cores, 105/160 | Compatible (identical results without 125) |
| `hr_private.payroll_lop_days(uuid,date,date,boolean)` | 105 | body only: sums stored per-day unpaid leave | 170 (`hr_calculate_payroll_run`) | Compatible; 105 + 170 tests pass |
| `hr_private.ensure_leave_balance`, `leave_accrued`, `hr_initialize_leave_year`, `hr_my_leave_balances`, `hr_leave_calendar` | 103 | redefined (same purpose; new columns) | leave only | Compatible |
| `hr_apply_leave`, `hr_decide_leave`, `hr_cancel_leave` | 103 | 103 bodies moved to `hr_leave_internal.*_core`, public wrappers | UI, fixtures | Compatible (positional calls still work) |
| `hr_private.document_can_view` | 107 | 107 body + `leave_supporting` excluded from `documents.view_team` | 107, 129 (`document_can_read`) | Compatible; 107 and 129 tests (other than the 130 conflict) pass. If another module later redefines it, keep the exclusion. |
| `hr_private.is_on_approved_leave`, `leave_can_act`, `is_working_day_for` | 103/112/125 | **not changed** | 117, 128, 190 | — |
| `hr_leave_balances.available` (generated) | 103 | **not changed** (opening / expiry post via `adjusted`) | 130 (F&F), 190 | Compatible |

## 4. Permissions and security considerations
* Policy edits: signed-in users cannot write `hr_leave_types` directly while `leave.policy_approval = required` (default); proposals need `leave.manage`, a **different** user approves; stale and future-dated proposals are refused. Single-HR companies must set `policy_approval: not_required` (settings.manage) — changes are still validated and versioned.
* Ledger, per-day rows, policy changes/versions, leave years: RLS read only; writes only through SECURITY DEFINER RPCs/triggers. Request status can only move forward; dates/type immutable; a request can reserve/consume/release/restore at most once (unique index).
* Closed leave years are frozen for all signed-in users.
* Calendars never return reasons; colleagues see "On leave" only. Medical documents: `leave_supporting` excluded from line managers (`documents.view_team`).
* `hr_my_holidays(p_all)` returns every holiday only to `leave.view` / `leave.manage`.
* `hr_leave_payroll_summary` needs `payroll.view` or `leave.view`; read-only, no automatic deduction.
* HR scope is permission-based (single tenant); company (`legal_entity_id`) is a filter, not a boundary.
* Holidays may also be written by `attendance.manage` (125 policies) — every write fires 160's leave review trigger.
* `hr_private` is not exposed by the API (`supabase/config.toml` keeps the default `public`/`graphql_public`), but EXECUTE on it is granted broadly (100's default privileges and blanket grants in 170, 171, 190), so a revoke there is not a control.
  * 160 **no longer issues a blanket `grant … in schema hr_private`** (it previously did, re-exposing helpers other migrations restricted).
  * Helpers that write data or bypass a wrapper's checks live in **`hr_leave_internal`** (no grants to API roles, immune to blanket `hr_private` grants): the moved 103 cores `apply_leave_core` / `decide_leave_core` / `cancel_leave_core`, `leave_policy_write` / `leave_policy_dry_run` / `leave_policy_commit`, `leave_ctx_set` / `leave_ctx_clear` / `leave_ctx`, `leave_link_ledger`, `leave_ledger_mark`, `leave_apply_expiry`. `leave_policy_write` also checks `leave.manage` itself. 160's tests assert signed-in users get "permission denied" on them, and pass after all later migrations.
  * 160's new `hr_private` read helpers and trigger functions are explicitly revoked from `public, anon, authenticated` (later blanket grants re-grant them; they are read-only).
  * Redefined existing `hr_private` functions (`leave_days`, `ensure_leave_balance`, `leave_accrued`, `payroll_lop_days`, `document_can_view`, `is_holiday` fallback) keep their existing grants.
  * The HRMS-wide fix (stop blanket `hr_private` grants in 100/170/171/190, or move foundation writers such as `audit_event` / `notify_user` to an internal schema) is outside Module 6.

## 5. Outstanding functional limitations
* **Scheduler dependency (not automated).** No job runs leave maintenance:
  * carry-forward expiry — `hr_process_leave_expiry(year)` (button "Process carry-forward expiry"); also applied lazily per balance when it is read/applied against;
  * year-end close — `hr_close_leave_year(year)` (button), after all pending requests in that year are decided;
  * next-year balances — `hr_initialize_leave_year(year)` (button; also created lazily on first view/apply).
  These RPCs require `leave.manage` via `auth.uid()`, so a scheduler (pg_cron / Edge Function) needs a service-role entry point that runs them with an audited system identity. Recommended schedule: expiry daily; initialise next year in December; close the previous year in early January after pending requests are cleared. Until then HR runs them from Leave Management → Leave year. Tracked with the project-wide gap X3.
* **Policy effective dates (reviewed).** Approved changes apply immediately. 160 now refuses future-dated proposals (UI and server) so nothing implies a deferred start; a past date is only recorded as the decision date. To start a leave type later use the type's own "Leave can be taken from / until" window, which is enforced. Deferred activation (scheduled policy versions) is **not** implemented. Also note: for monthly/quarterly/annual accrual an entitlement **increase** raises the current year's accrued amount on next refresh, a **decrease** never reduces it (accrual never decreases) — decide before production whether mid-year entitlement changes should apply only from the next leave year.
* Approval route is the global `approval_flow`; no per-type routing. Repeated approvals are refused with an error (no state change).
* Leave notifications are in-app only (project-wide gap X2).
* Half-day attendance needs the 125 change above. Module 5 has documented it (m5 `docs/hrms/integration/MODULE5_ATTENDANCE_TIME.md` §3: portion swap, expected minutes × (1 − portion), 'first' skips late, 'second' skips early leave) to be applied at integration together with the 160b last-assertion change.
* Suggested by Module 5, for Module 7 / integration to decide: in `payroll_lop_days`' optional attendance branch (`lop_from_attendance`), use `hr_private.is_working_day_for(emp, work_date)` instead of the `isodow = any(employee_working_days(...))` test so attendance-based LOP follows dated shifts and weekly-off rules. Not changed in 160 (payroll behaviour; only matters when that setting is on).

## 6. Tests required after integration
1. `node scripts/hr-db-test.mjs` on the merged Intern tree — all files, in particular `103`, `105`, `107`, `112`, `117`, `125`, `128`, `129`, `130`, `160`, **`160b` (must run, not skip)**, `170`, `190`.
2. Resolve and re-run the 129 ↔ 130 document notification conflict.
3. After Module 5 applies the half-day change: update and re-run `160b` (half-day date = `'working'`, portion 0.5).
4. `npx vite build` (lint is broken repo-wide by the missing `eslint-config-next`).
5. Browser: `node scripts/hrms-local/browser-flows-leave.mjs --state <harness state>` on a harness started from the merged tree (Module 6 tree: 51/51); plus Module 5's attendance flows. Manually: create a recurring holiday in Settings → Holidays (merged patch) and confirm it appears in My Leave → Holidays and flags overlapping leave; 2nd-Saturday leave counts 0 for a six-day shift with that rule; a half-day leave shows as half-day in attendance.
6. Mobile 390 px: `/employee/leave`, `/hr/leave?tab=overview`, `/hr/leave?tab=calendar`, Settings → Holidays.
7. Release check (agreed with Module 9): the API's exposed schemas must not include `hr_private` (Supabase Dashboard → API → Exposed schemas / `supabase/config.toml` `[api] schemas`); a request with `Accept-Profile: hr_private` must be refused (PGRST106).
