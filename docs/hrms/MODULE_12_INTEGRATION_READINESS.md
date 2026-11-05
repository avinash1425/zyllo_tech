# Module 12 — Integration readiness

Worktree `D:\Projects\zyllo-tech-website-intern-m12`, branch `hrms/module-12-reports`. Not committed.
Safety copy (outside the repo): scratchpad `module12-files.tar` + `module12-files.sha256`.

## 1. Files and migrations

| File | Kind | Integration note |
|---|---|---|
| `supabase/migrations/190_hr_reports_analytics.sql` | new | Must be the **last** migration that redefines `hr_private.scoped_employees` and `public.hr_report` (see §2) |
| `supabase/tests/hr/190_reports_analytics.test.sql` | new | 161 assertions |
| `src/hr/pages/ReportsPage.jsx` | rewritten | Only Module 12 edits this file |
| `src/hr/components/ReportChart.jsx`, `src/employee/pages/MyReportsPage.jsx` | new | — |
| `src/lib/hr/reports.js`, `reportFilters.js`, `reportExport.js` | new | — |
| `tests/hr-reports-export.test.mjs` | new | 11 Node tests |
| `src/employee/EmployeeApp.jsx` | **shared**, +2 lines | icon import + `reports` route entry. Merge by hand (CRLF preserved) |
| `src/lib/hr/client.js` | **shared**, 2 lines | `csvCell`: numbers stay numeric (audit RP5). Benefits every module's CSV |
| `docs/hrms/MODULE_12_*.md` | new | — |

No changes to `HrApp.jsx` (the `reports` route already exists), permissions, sidebar or Edge Functions. No new tables.

## 2. Migration order and compatibility (verified)

Rehearsal: all 29 HR migrations (100–118, 120, 125, 128, 129, 130, 141, 160, 170, 180, 190) applied in order to a throwaway local cluster, with every module's test file run.

| Fact | Evidence |
|---|---|
| Base migrations 100–120 are byte-identical in all 9 worktrees | sha comparison. Exception: m4 carries base 118 as `117_hr_employee_management.sql` (comment-only diff); Module 4 must drop or rename it so it isn't applied twice |
| No other module redefines `scoped_employees`, `hr_report`, `hr_report_core` or `hr_report_v116` | grep of 125/128/129/130/141/160/170/180 |
| 190 applies cleanly after all of them, and 190's tests pass with all of them | combined run: 190 PASS |
| 190 does not break any other module | the same 4 non-190 failures (103, 105, 110, 129) occur with and without 190 → they are conflicts between Modules 4/6/7/9 and older base tests, not Module 12 |
| 112 and 116 report/dashboard tests still pass with 190 | combined and worktree runs |

Wrapper chain after 190: `public.hr_report` (190) → `hr_private.hr_report_v116` (116 wrapper) → `hr_private.hr_report_core` (112). A later migration that redefines `scoped_employees` must keep the `hr.filter_employee` / `hr.filter_location` clauses and the scalar-subquery permission check.

## 3. Cross-module calculation dependencies

Module 12 calls the shared helpers by name, so redefinitions with the same signature are picked up automatically.

| Calculation | Shared helper / table used | Owner | Behaviour with the owner's migration applied | Action |
|---|---|---|---|---|
| Working weekdays | `hr_private.employee_working_days(emp)`, **once per employee** | 101 → **125** | 125 returns the shift effective *today* | **Known deviation:** a shift change inside the window and 125's n-th-weekday `weekly_off_rules` are not applied per day (the per-day helper was 40–60× too slow). Integration action for Module 5: expose a set-returning `employee_day_types(emp[], from, to)`, then switch `ra_load_attendance` to it |
| Holidays | `hr_private.is_holiday(date, emp)`, once per (work location, legal entity, date) | 103 → **125** (160 fallback) | 125 adds recurring and per-company holidays | Correct for 103/125/160: every version depends only on location and legal entity. Tested (location holiday) |
| Approved leave days | `ra_approved_leave_days` = set form of `is_on_approved_leave` (103 predicate) | 103 (**160** keeps the predicate) | 160 does not redefine `is_on_approved_leave` | If Module 6 makes leave half-day aware, update both functions together. Half-day leave currently excludes the whole day |
| Leave balances / utilization | `hr_leave_balances` (used, pending, accrued, carried_forward, adjusted) | 103 → **160** | 160 adds `opening`, `cf_expired` and `hr_leave_ledger` | Utilization denominator ignores `opening` / `cf_expired` until switched to the ledger |
| Attendance rows | `ra_attendance_rows` (RLS predicate `can_access_employee(emp,'attendance')` per employee) | 101 / **125** | 125 keeps the same RLS predicate | If 125 changes `hr_attendance_read`, mirror it here |
| Payroll totals | `hr_payroll_runs.status`, `hr_payroll_items` gross / total_deductions / net / employer_contributions, `breakdown` lines | 105 → **170** | 170 adds component `category` and statutory rules | Allowances = non-`BASIC` earning lines until switched to `category = 'allowance'`. Statutory = `is_statutory` components only |
| Exits / attrition | `hr_employees.status` + `last_working_date` (authoritative), `hr_exits.exit_type` (category) | 100/110 → **130** | 130 completes exits through its workflow | Exit category mapping in `hr_private.ra_exit_category` if 130 adds reason categories |
| Hiring | `hr_candidate_stage_events`, `hr_interviews`, `hr_offers` | 104/120 | — | none |

## 4. Security and permissions (reviewed)

- **Viewing:** every entry point requires `reports.view` or `reports.view_team`. All functions are SECURITY INVOKER except four narrow SECURITY DEFINER readers, each applying the module's own predicate: `ra_attendance_rows` (attendance RLS predicate), `ra_approved_leave_days` (same disclosure as the existing definer `is_on_approved_leave`), plus the existing `is_holiday` and `employee_working_days`.
- **Export (`hr_report_export`, the only export path):**
  - `reports.export` is required for everything;
  - `payroll.export` is additionally required for payroll analytics or any `payroll*` template;
  - **new:** an explicit performance permission (`performance.view` / `view_team` / `manage`) is required for performance analytics and `performance_summary`;
  - identity, demographic, benefits, training, attendance and daily-report gates are inherited because the export runs the same report function;
  - format must be one of csv, xlsx or pdf; maximum 50,000 rows.
- **Audit metadata only (tested):** context keys are whitelisted (source, format, rows, from, to, filters, scope). Values are scalars, with no names, amounts or row snapshots (`old_data` / `new_data` are null). Who, which report and when are always present. Payroll exports are logged as `hr_payroll_report`, so they're readable only with `audit.view` + `payroll.view`.
- **Residual risks (not blockers):**
  1. `super_admin` passes every permission check (foundation design).
  2. Export control is a bulk-file control. A user with view access can still page through the same rows via `hr_report_page`, and those reads are not audited.
  3. The legacy `performance_summary` template shows self and manager ratings of unfinalized reviews to holders of `performance.view` (existing behaviour, unchanged).
  4. Refused export attempts are not audited (the transaction rolls back).

## 5. Performance (measured: 2,201 employees, 128,619 attendance rows, all 29 migrations)

| Call | Before fix | After fix |
|---|---|---|
| Attendance analytics, 31 days | 226.8 s | **4.0 s** |
| Attendance analytics, 93 days (cap) | 204.6 s | **5.0 s** |
| Overview (current month) | 51.8 s | **3.3 s** |
| `hr_report_page('attendance_employee')`, 93 days | >60 s | **4.3 s** |
| `hr_report('attendance_summary')` (legacy, now on the fast reader) | 43.5 s | **0.9 s** |
| Export employee-wise attendance (2,094 rows) | — | **5.0 s** |
| Headcount / attrition analytics, 12 months | 0.9 s | **0.74 s / 0.78 s** |
| `late_arrivals` page 1 / page 40 | 0.9 s | **0.66 s / 0.70 s** (same cost: full result built, then sliced) |

Fixes: set-based working days, holidays and leave; attendance rows read with the RLS predicate evaluated per employee instead of per row; caller permission in `scoped_employees` evaluated once per query.

Remaining limits:
- **93-day cap:** cost grows with employees × days. At about 2,000 employees, a 93-day call takes about 5 s, inside Supabase's default authenticated statement timeout (8 s) but with little headroom. Expect to exceed it at about 3,500+ employees for 93 days. 1.6 s of the 5 s is Module 5's per-employee shift lookup. Options at that scale: Module 5's set-returning day-type helper (§3), raising `statement_timeout` for the `authenticated` role on these RPCs, or a derived nightly daily-summary table (would need owner approval because it duplicates attendance data).
- **Paging:** `hr_report_page` builds the full jsonb result and slices it. The browser receives only one page, but server cost is the same for every page and the full result is held in memory (476 kB for 2,201 employees × 11 columns). Acceptable at this size. SQL-level `LIMIT/OFFSET` would require rewriting each of the 44 templates.

## 6. Outstanding browser tests

See `MODULE_12_BROWSER_TEST_PLAN.md`. Sequential: HR Admin → Manager → Payroll Admin (with Super Admin / HR audit checks) → Employee Portal, at 1440×900 and 390×844. **Not started; waiting for approval.** Running it needs a Module 12-only harness instance (`HRMS_LOCAL_INSTANCE=m12`, ports 54412/8112) so the shared `zyllo-hrms-local.json` is never touched.

## 7. Tests to rerun after integration

1. `node scripts/hr-db-test.mjs` on the integration branch: all files. Expected: 190 PASS, plus resolution of the 103/105/110/129 conflicts owned by Modules 4/6/7/9.
2. `node scripts/hr-db-test.mjs --seed` (seed smoke 900 executes every report on the dev seed).
3. `node --test tests/*.test.mjs` (includes `hr-reports-export.test.mjs`).
4. `npx vite build`.
5. Re-run the §5 benchmark if Module 5 changes `employee_working_days` / `is_working_day_for`, or Module 6 changes leave predicates.
6. Browser plan, all roles, both viewports.
7. If 125 or 160 change `is_holiday` / leave semantics, rerun 190's equivalence assertions ("bulk path matches `is_working_day_for` / `is_on_approved_leave`"). Those assertions will flag Module 5's weekly-off rules if the test cycle includes them.
