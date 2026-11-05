# Module 5 — Attendance & Time: integration notes

**Worktree:** `D:\Projects\zyllo-tech-website-intern-m5`, branch `hrms/module-5-attendance-time` (from `99fa9b5`).

**How to read the diff:** the uncommitted Intern baseline (as of the start of Module 5) is **staged**. Module 5 is the **unstaged** diff (`git diff`) plus untracked files.

Nothing is committed, pushed, merged or applied to the shared Intern tree.

## 1. Files

| File | Status | Notes |
|---|---|---|
| `supabase/migrations/125_hr_attendance_time.sql` | new | Extends 101. No second attendance or approval system. |
| `supabase/tests/hr/125_attendance_time.test.sql` | new | 119 assertions standalone; 120 with migration 170 present (company-scoped lock branch). |
| `src/lib/hr/attendance.js` | modified | All previous exports kept; new RPC wrappers added. |
| `src/hr/pages/AttendancePage.jsx` | modified | Tabs: Overview (`?tab=daily&date=`), Late, Exceptions, Corrections & regularization (`?tab=corrections`), Working hours, Shifts, Holidays. |
| `src/hr/pages/attendance/common.jsx` | new | Shared status badge and employee cell. |
| `src/hr/pages/attendance/OverviewTab.jsx` | new | |
| `src/hr/pages/attendance/SummaryTab.jsx` | new | |
| `src/hr/pages/attendance/CorrectionsTab.jsx` | new | |
| `src/hr/pages/attendance/ShiftsTab.jsx` | new | |
| `src/hr/pages/attendance/HolidaysTab.jsx` | new | Embeds Session 6's `HolidaysSettings` (import only). |
| `src/hr/pages/attendance/AttendanceCalendar.jsx` | new | |
| `src/hr/pages/attendance/EmployeeCalendarModal.jsx` | new | |
| `src/employee/pages/MyAttendancePage.jsx` | modified | Rewritten; previous behaviour preserved. |
| `scripts/hrms-local/browser-flows-m5-attendance.mjs` | new | 43 UI checks; attaches only to its own Chrome (`--remote-debugging-port=0` + `DevToolsActivePort`). |
| `docs/hrms/integration/module5-holidays-settings.patch` | superseded | Use Session 6's merged patch instead (see §3). |
| `docs/hrms/integration/MODULE5_ATTENDANCE_TIME.md` | new | This file. |

Not touched: HR / Employee navigation, `ui.jsx`, `client.js`, `org.js`, the roles and permissions seed, Edge Functions, and other modules' files.

## 2. Shared database functions (same signatures unless noted)

| Function | Change | Consumers after integration |
|---|---|---|
| `hr_private.employee_shift_on(uuid, date)` | **new**; contract frozen for Session 6 | 125, 160 (`leave_is_weekly_off`) |
| `hr_private.is_weekly_off_rule(jsonb, date)` | **new**; contract frozen for Session 6 | 125, 160 |
| `hr_private.holiday_on(date, uuid, boolean)` | **new** | `is_holiday`; 160 defers to it |
| `hr_private.is_holiday(date, uuid)` | delegates to `holiday_on` (recurring + company + location) | 103/160 leave day counts, 125, 112/117 dashboard |
| `hr_private.attendance_day_type(uuid, date)` | **new**: `holiday` / `weekly_off` / `leave` / `working` | 125; asserted by 160b |
| `hr_private.is_working_day_for(uuid, date)` | now `attendance_day_type in ('working','leave')` | 112/117 dashboard absent counts, 190 reports |
| `hr_private.employee_shift(uuid)`, `hr_private.employee_working_days(uuid)` | effective shift for *today* (assignment > employee > default) | 101–105, 160 `payroll_lop_days` |
| `hr_private.attendance_period_locked(date, uuid)`, `hr_private.assert_attendance_unlocked(date, uuid)` | **signature changed** (added `p_employee`); company-aware | 125 only |
| `hr_private.attendance_write(...)` | recreated with a trailing `p_punch` argument | 125 only (no other callers) |
| `public.hr_check_in` / `hr_check_out` / `hr_my_attendance_today` / `hr_mark_missing_punches` / `hr_request_attendance_correction` / `hr_decide_attendance_correction` / `hr_cancel_attendance_correction` / `hr_upsert_attendance_manual` | bodies extended, signatures unchanged | UI, 117 |

**New tables:** `hr_shift_assignments`, `hr_attendance_punches`, `hr_attendance_correction_events`.

**New public functions:** `hr_attendance_overview`, `hr_attendance_summary`, `hr_my_attendance_calendar`, `hr_holiday_calendar`, `hr_assign_shift`, `hr_end_shift_assignment`, `hr_cancel_shift_assignment`, `hr_request_attendance_regularization`.

## 3. Session 6 (Leave, migration 160) — agreed contracts

- **Holiday master:** `hr_holidays` stays the single holiday master, owned by Leave.
  - Both 125 and 160 add `legal_entity_id` with `IF NOT EXISTS` and create the identical `hr_holidays_scope_unique` index, so they are idempotent in either order.
  - 160 only defines its fallback `is_holiday` when `holiday_on` is absent, so 125's definition stays authoritative.
- **Working days:** 160's `leave_is_weekly_off` calls `employee_shift_on` + `is_weekly_off_rule` per date when 125 is present. Leave day counting and attendance therefore agree, and 160b asserts this for 29 days. Keep those signatures.
- **Recurring holidays:** 160's `hr_my_holidays` and its Leave overview expand `is_recurring` rows, read through `to_jsonb` so they also work without 125. 125's `hr_holiday_calendar` expands them the same way. Both calendars show the same occurrences.
- **Holiday-change trigger:** 160's `hr_holidays_leave_review` flags affected leave (including same month-day for recurring rows) via `leave_days → is_holiday`, which is compatible with `holiday_on`.
- **Settings form:** apply Session 6's merged patch `m6/docs/hrms/integration/module6-holidays-settings-with-module5.patch`, which contains both the legal-entity field and Module 5's `is_recurring` / `description` fields, **after** 125 and 160. Do **not** apply `module5-holidays-settings.patch`; it does not apply cleanly over 160's version.

### Half-day leave (agreed; apply only when 125 and 160 are both merged)

Current contract: any approved leave date, including a 0.5 day, is `'leave'`. 160b asserts this today.

Change to apply in `125_hr_attendance_time.sql` (or a follow-up migration after 160). Then update the last assertion of `160b_leave_attendance_integration.test.sql` to expect `'working'` for the half-day date (Session 6 owns that file).

1. `hr_private.attendance_day_type`: replace
   `if hr_private.is_on_approved_leave(p_employee, p_date) then return 'leave'; end if;`
   with
   `if hr_private.leave_portion_on(p_employee, p_date) >= 1 then return 'leave'; end if;`
   A 0.5 day stays `'working'`.
2. `hr_private.attendance_compute` and `hr_private.attendance_day`: read `v_portion := hr_private.leave_portion_on(emp, date)` and `v_half` from `hr_leave_request_days.half` (`'first'` = morning off, `'second'` = afternoon off).
   - Expected minutes = `(1 - v_portion) * shift expected minutes`; also used for short hours and the half-day threshold.
   - `v_half = 'first'`: skip the late-arrival calculation.
   - `v_half = 'second'`: skip the early-leave calculation.
   - No punch on a 0.5 leave day: status `half_day`, not `absent`.
3. Tests to add to 125 (in a post-160 integration test): a first-half leave plus a 13:30 punch-in is not late; a second-half leave plus a 13:30 punch-out has no early leave; expected minutes are halved; no punch gives `half_day`.

Until that change, a half-day leave date shows as on-leave in attendance (no late or half-day penalty) and is counted as a leave day in totals.

## 4. Payroll (migration 170) compatibility

- 170 adds `legal_entity_id` to `hr_payroll_runs` (company-scoped runs, no overlapping runs per company).
- 125's lock now matches finalized or paid runs that are **company-wide** (`legal_entity_id` null) **or for the employee's company**. Without 170, every run is company-wide.
  - Verified in the rehearsal: a run for one company does not lock another company's attendance.
- Locked actions:
  - Approving a correction or regularization.
  - HR manual entries.
  - Submitting a request for a locked date (refused up front).
  - Self check-in/out is not affected (it is always today).
- Working days per date (`is_working_day_for`) follow dated shift assignments.
  - 160's `payroll_lop_days` still checks `extract(isodow …) = any(employee_working_days(emp))`, i.e. *today's* shift days.
  - Recommended (Session 6 / 7 owner): use `hr_private.is_working_day_for(p_employee, a.work_date)` there, so attendance-based loss-of-pay follows historical shift assignments and weekly-off rules.
  - Not required for correctness while `lop_from_attendance` is off (the default).
- 125 never creates deductions, payouts or overtime pay. Payroll may read `hr_attendance_summary` / `hr_private.attendance_totals` under its own approved rules.

## 5. HR Dashboard (117 / 112) — consuming the overview without breaking metrics

**Current state (no change required):**
- 117 computes `absent_today` and missing records with `is_working_day_for` + `is_on_approved_leave` + `hr_attendance`. Through 125's redefinition these now honour weekly-off rules, dated shift assignments and recurring / company holidays.
- Deep links `/hr/attendance?tab=daily&date=…`, `?tab=corrections` and `?tab=exceptions` all resolve in the new page (`daily` = Overview, which honours `date`).

**Optional adoption:** call `public.hr_attendance_overview(p_date, p_department, null, null, p_legal_entity)` and read `kpis`. Field mapping:

| Dashboard metric | Overview field | Note |
|---|---|---|
| `present_today` | `kpis.present` | Rows with a check-in (identical). |
| `late_today` | `kpis.late` | `late_minutes > 0` (identical). |
| `absent_today` | `kpis.absent` | **Differs today:** the overview reports employees whose shift (plus grace) has not started yet as `not_started`, not absent. For an unchanged number use `kpis.absent + kpis.not_started`. Past dates are identical. |
| `on_leave_today` | `kpis.on_leave` | Overview counts approved leave **without** a punch; employees on leave who punched in count as present. |
| missing punches | `kpis.missing_punch_out` | Overview uses shift end + `missing_punch_after_hours` (default 4); 117 uses the view (any past open record). Keep 117's predicate if the number must not change. |
| pending corrections | `kpis.pending_corrections` | Overview counts all pending corrections in view scope; 117's approvals widget counts only those the caller can act on. Keep 117 for "my approvals". |

**Scope and permissions:** the overview requires `attendance.view` or `attendance.view_team` (same as 117's `v_att`) and applies all / team scope itself.

## 6. Remaining functional limitations

- Half-day leave is treated as a full leave day in attendance until the §3 change is applied.
- Regularization evidence is a text reference; there is no file upload.
- Changing a shift does not recalculate stored days; an approved correction or a manual entry recalculates a day.
- Overtime and short hours are informational only; nothing is paid or deducted.
- `hr_attendance_summary` is limited to 93 days per call.

## 7. Tests to rerun after integration

1. `node scripts/hr-db-test.mjs` on the integrated tree. Rehearsal result (29 migrations, owners' latest tests): **32/32 files, 2447 assertions**. Includes 101, 125 (120), 160b (13), 117, 170, 190.
2. Half-day change (when applied): 125 + updated 160b.
3. `node --test tests/hr-security-remediation.test.mjs`.
4. `vite build`.
5. Browser: `node scripts/hrms-local/browser-flows-m5-attendance.mjs --base <harness web url> --out <dir>` (43 checks) on a harness started from the integrated tree. Then spot-check Leave holiday lists for a recurring holiday, and the HR Dashboard attendance tiles.
