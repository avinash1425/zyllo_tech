# Module 12 — Browser test plan (NOT YET RUN, awaiting approval)

Synthetic data only. Local harness only. Run the steps in order, because later steps check audit rows written by earlier exports.

## 0. Environment (isolated; nothing shared is restarted)

1. Make the harness instance-aware in the **Module 12 worktree only**. Copy the `HRMS_LOCAL_INSTANCE` lines that Module 9 already uses in `scripts/hrms-local/lib.mjs` (state file becomes `%TEMP%\zyllo-hrms-local-m12.json`), so the two versions are identical at integration.
2. `set HRMS_LOCAL_INSTANCE=m12` and `node scripts/hrms-local/start.mjs --port-api 54412 --port-web 8112` from the Module 12 worktree. Refuse to continue if either port is in use. Never touch `zyllo-hrms-local.json` (another session's) or ports 54321 / 8090 / 8080.
3. Seed extra synthetic rows for reporting (as owner, in the m12 cluster only): one exited employee with last working day this month, one approved leave day last week, one draft payroll run next to the fixture's finalized run.
4. Viewports: **desktop 1440×900** and **mobile 390×844** (DPR 3). Capture a screenshot per step marked 📷 into `docs/hrms/local-test-screenshots/m12-*.jpg`.
5. Stop with `HRMS_LOCAL_INSTANCE=m12 node scripts/hrms-local/stop.mjs`. That deletes only the m12 cluster.

Password for all accounts: `Local-Test-Only-2026!`

## 1. HR Admin — `hr.admin@example.com` (desktop)

| # | Step | Expected |
|---|---|---|
| 1.1 | Open `/hr/reports` 📷 | Tabs: Overview, Headcount, Attendance, Leave, Hiring, Attrition, Performance, All reports. **No Payroll tab.** Loading state, then cards. "last refreshed" timestamp shown. |
| 1.2 | Overview | Cards: total employees, joiners, exits, attendance rate, on leave, pending recruitment, attrition rate, review completion. No payroll card, no "unavailable" notice for HR-visible categories. |
| 1.3 | Headcount 📷 | 8 cards. Department, designation, employment-type and trend sections. Chart ⇄ Table toggle. Department table totals = Total employees card. Trend latest point = card. |
| 1.4 | Set Department = one department, Apply | URL gains `department=`. Cards, charts and tables all shrink consistently. |
| 1.5 | Browser **refresh** | Same tab, filters and numbers (URL persistence). |
| 1.6 | Reset filters | URL cleared to the current month; numbers return to step 1.3. |
| 1.7 | From > To, Apply | Inline error "end date is before the start date"; no request sent. |
| 1.8 | Range of 400 days | Inline error "at most one year". |
| 1.9 | Attendance 📷 | Window note (≤ 93 days, today excluded). Attendance % = attended ÷ expected from the daily table totals (check by hand). Regularizations section lists the fixture's pending correction. |
| 1.10 | Attendance with a 6-month range | Note says day-level data is limited to the last 93 days; no error. |
| 1.11 | Leave | Utilization card. Type table: available = credited − used − pending. Upcoming-leave card matches the "Upcoming leave" template row count. |
| 1.12 | Hiring | Funnel (horizontal bars), pipeline, trend, requisitions. "Filters that do not apply: company, employee, location". Time to hire shows a basis count or "No hires with both dates". |
| 1.13 | Attrition | Rate card hint shows opening/closing headcount; recompute by hand. Category pie has "Not recorded" for exits without a case. Resignations section is separate. |
| 1.14 | Performance | Completion %, rating distribution, department, trend, KPI table. Definitions mention "not for automated disciplinary decisions". |
| 1.15 | Export Headcount → CSV, Excel, PDF 📷 (open each file) | CSV: title, period, generated (IST), scope, filters lines, then tables with totals; numbers unquoted. Excel: Summary sheet + one sheet per section, numeric cells are numbers, dates are dates, header row frozen. PDF: landscape, all rows, totals, "Page x of y", filters listed. Toast mentions the audit log. |
| 1.16 | All reports → every group in the selector | All 39 legacy templates + 5 new ones visible for HR (except payroll; identity/demographic depend on HR permissions). |
| 1.17 | All reports → Leave history, Status = rejected | Only rejected rows. Status options come from the data. Totals row covers all rows. |
| 1.18 | All reports → Employee-wise attendance, page 2 | Server paging ("Page 2 of N"), 50 rows per page. Export PDF contains **all** rows, not just one page. |
| 1.19 | Detailed records buttons on a category | Open the template tab with that report preselected; URL has `tab=templates&report=`. |
| 1.20 | DevTools console: `supabase.rpc('hr_report_export',{p_source:'report',p_key:'payroll_summary',p_format:'csv'})` | Error "payroll" (server-enforced). |

## 2. Manager — `manager@example.com` (desktop, then 390px)

| # | Step | Expected |
|---|---|---|
| 2.1 | `/hr/reports` 📷 | Tabs: Overview, Headcount, Attendance, Leave, Attrition, Performance, All reports. No Payroll, no Hiring. Header says "your team". |
| 2.2 | Headcount | Only the reporting line (compare with the Employees page team count). |
| 2.3 | Attendance | Team only; employees outside the team never appear in the employee-wise template. |
| 2.4 | Overview | Amber notices for categories without access (e.g. hiring), never zero cards. |
| 2.5 | Export buttons | **Not shown** (no `reports.export`). Console call to `hr_report_export` → "permission to export". |
| 2.6 | Performance | Team reviews only; manager's own review excluded. |
| 2.7 | 390px 📷 | Filters stack in one column; tabs scroll horizontally; cards one per row; charts fit width with no horizontal page scroll; tables scroll inside their card. |

## 3. Payroll Admin — `payroll.admin@example.com`

| # | Step | Expected |
|---|---|---|
| 3.1 | `/hr/reports` | Payroll tab present. Performance tab absent. |
| 3.2 | Payroll 📷 | Gross/allowances/deductions/net from **finalized** runs only. Provisional runs card + "Provisional" label in the period table. Statutory section lists only `is_statutory` components (or is empty). Department cost totals reconcile to gross. |
| 3.3 | Export Payroll → Excel and PDF | Allowed (payroll.export). Money cells numeric with 2 decimals. |
| 3.4 | As `superadmin@example.com`: Audit log page | Payroll export rows present (table `hr_payroll_report`). Context has filters and row count only, no amounts or names. |
| 3.5 | As `hr.admin@example.com`: Audit log page | The payroll export rows are **not** visible; HR's own `hr_report` export rows are. |
| 3.6 | Console: `hr_report_export('report','performance_summary','csv')` as payroll admin | Error "performance access". |
| 3.7 | 390px 📷 | Payroll period table scrolls inside its card; money stays right-aligned. |

## 4. Employee Portal — `employee@example.com` (desktop, then 390px)

| # | Step | Expected |
|---|---|---|
| 4.1 | Sidebar | "My Reports" under Records. No HR Reports link. |
| 4.2 | `/employee/reports` 📷 | Attendance summary (same formula note), leave balances with pending shown separately, payslip history (finalized fixture month), daily-work counts, performance (finalized only, or empty state). |
| 4.3 | Change period, Show | Figures update. From > To shows the inline error. |
| 4.4 | Visit `/hr/reports` directly | Denied by the HR guard. Console `hr_report_analytics('overview')` → "access to HR reports". |
| 4.5 | As `employee2@example.com` | Sees only their own figures. None of employee@'s payslips or reviews. |
| 4.6 | As `noaccess@example.com` | Account-pending page; reports unreachable. |
| 4.7 | 390px 📷 | Stat tiles two per row, tables scroll in their card, no horizontal page scroll. |

## 5. Cross-cutting checks

- Error state: stop the m12 API briefly. The Reports page shows the error card with Retry, and Retry recovers after restart (m12 instance only).
- Keyboard: tabs, Chart/Table toggles and export buttons reachable with Tab; focus is visible.
- Charts: tooltip on hover; legend only for multi-series charts; table view always available.
- Long names: designations > 40 characters wrap or truncate without overlapping in charts and PDF.

## Pass criteria

Every row matches its expected result on both viewports where marked, all 📷 screenshots are saved, and the m12 harness is stopped and its temp directory removed.
