# Module 12 — HR Reports & Analytics

Branch `hrms/module-12-reports` (worktree `zyllo-tech-website-intern-m12`). Not committed, merged or deployed.

## What changed

| Layer | File | Change |
|---|---|---|
| DB | `supabase/migrations/190_hr_reports_analytics.sql` | New. Shared calculation helpers, `hr_report_analytics`, `hr_report_page`, `hr_report_export`, `hr_my_report_summary`; `hr_report` wrapper with audit fixes and 5 new templates; employee/location filters in `hr_private.scoped_employees` |
| DB tests | `supabase/tests/hr/190_reports_analytics.test.sql` | New. 161 assertions |
| UI | `src/hr/pages/ReportsPage.jsx` | Rewritten. Keeps all 39 templates; adds category analytics, charts, URL-persisted filters, server paging, gated exports |
| UI | `src/hr/components/ReportChart.jsx` | New. Recharts, validated palette, table view alongside |
| UI | `src/employee/pages/MyReportsPage.jsx` | New. Self-service summary |
| UI | `src/employee/EmployeeApp.jsx` | **One route line** (`reports`) + icon import. Shared file: merge by hand |
| Lib | `src/lib/hr/reports.js`, `reportFilters.js`, `reportExport.js` | New. API, filter validation/persistence, CSV/XLSX/PDF builders |
| Lib | `src/lib/hr/client.js` | `csvCell`: negative numbers no longer turned into text (audit RP5). Shared file: 2-line change |
| Tests | `tests/hr-reports-export.test.mjs` | New. 11 Node tests |

## Calculation definitions (also returned by the API and shown in the UI)

- **Headcount as of D**: status ≠ onboarding, `coalesce(joining_date, D) ≤ D`, `last_working_date` null or ≥ D; exited/archived records without a last working day are excluded; archived records without a last working day are void (never counted). As-of date = end date, or today if the end date is in the future.
- **Active / inactive**: current status. Active = active, probation, notice period. Inactive = suspended.
- **New joiners**: joining date in the period, including employees who have since left.
- **Exits (completed)**: exited/archived with last working day in the period. Employee Management is the authoritative source.
- **Attrition rate**: completed exits ÷ ((headcount at start + headcount at as-of date) ÷ 2) × 100. Resignation requests are reported separately and never added.
- **Exit category**: latest non-withdrawn `hr_exits.exit_type`. Voluntary = resignation. Otherwise shown as "Not recorded" (never guessed).
- **Attendance %**: attended ÷ expected working days × 100. Expected = employed working days (shift weekly days, location holidays excluded) minus approved-leave days. Attended = present + late + missing punch + 0.5 × half day. Absent = absent + unrecorded working days + 0.5 × half day. Window: at most the last 93 days of the range; today is excluded. Approved corrections are already applied by Module 5.
- **Leave**: requests attributed to the month they start in; drafts excluded. Utilization = used ÷ (accrued + carried forward + adjusted) for the year of the end date. Pending is never counted as used.
- **Payroll**: Final = finalized or paid runs. Provisional runs are shown and labelled separately, never added to final totals. Allowances = earning lines other than `BASIC`. Statutory summary = components flagged `is_statutory` only. Nothing is recalculated. With multiple currencies, money cards are blank and tables split by currency.
- **Hiring**: screened / funnel use stage history (`hr_candidate_stage_events`). Hired = moved to Joined in the period. Time to hire = average days from application to Joined, only where both dates exist. Manager filter = hiring manager. Company, employee and location filters do not apply (reported in `filters_ignored`).
- **Performance**: finalized ratings only, aggregated; the caller's own review is excluded. Not for automated disciplinary decisions.

## Security

- Every function is SECURITY INVOKER (caller RLS). A section the caller can't access is returned in `unavailable` with a reason, never as zeros.
- Attendance: users with only `attendance.view_team` are narrowed to their team before absences are inferred, so hidden rows can't appear as absences.
- Exports go only through `hr_report_export`. It requires `reports.export`, plus `payroll.export` for payroll data, caps exports at 50,000 rows, and writes `report_export` to `hr_audit_log` with filters and row count (no row data). Payroll exports are logged under `hr_payroll_report`, so only audit viewers who also hold `payroll.view` can read them.
- CSV/XLSX: formula-injection guard on text; numbers stay numeric.
- Filters are validated in the browser and again on the server (`ra_validate`: dates, ≤ 366 days, employment-type format; UUIDs typed).

## Integration interface for Modules 4–11 (parallel sessions)

Module 12 reads only base-schema columns, so it works before or after 125/128/130/160/170. When those land:

| Module | Integration point | Action at integration |
|---|---|---|
| 5 Attendance (125) | `hr_shift_assignments`, `weekly_off_rules` | Attendance is now set-based for performance: working weekdays come from `employee_working_days` once per employee, so in-window shift changes and n-th-weekday off rules are not yet applied per day. See `MODULE_12_INTEGRATION_READINESS.md` §3 and §5. |
| 6 Leave (160) | `hr_leave_ledger`, `hr_leave_request_days` | Balances are read from `hr_leave_balances`. If the ledger becomes authoritative, switch `ra_leave` and `hr_my_report_summary` to it. If `is_on_approved_leave` gains half-day awareness, attendance follows automatically. |
| 7 Payroll (170) | component `category`, statutory rules | Replace the "non-BASIC earnings" allowance rule with `category = 'allowance'`. Statutory can read `hr_payroll_statutory_rules`. |
| 4 Onboarding/Exit (130) | exit categories, `confirmation_date` | If exit reason categories are added, map them in `hr_private.ra_exit_category`. |
| 8 Daily work (128) | blockers, versions | Self-service summary counts reports and hours only. |

Migration ordering: 190 must stay the highest-numbered HR migration that redefines `hr_private.scoped_employees` and `public.hr_report`. If another module redefines either, it has to keep the employee/location GUC clauses and the 190 wrapper chain (`hr_report` → `hr_report_v116` → `hr_report_core`).

## Known gaps

- `super_admin` passes every `has_permission` check (foundation design), so it sees confidential reports. Separating this needs a foundation change outside Module 12.
- Browser E2E and mobile screenshots were not run (the shared harness uses a fixed state file that another session owns).
- Attendance analytics cover ≤ 93 days per request; yearly attendance trends need repeated calls.
- `hr_report_page` computes the full result server-side and pages it (rows are never all sent to the browser); it is not a SQL-level LIMIT.
- Location applies to employee-based reports only (not recruitment openings, whose `location` is free text).
