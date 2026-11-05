# HRMS: all 12 modules integrated into Intern (2026-11-05)

Status: **integrated into the `Intern` working tree. Not committed, pushed or deployed.**
Backup of the Intern tree before integration: `D:\Projects\zyllo-tech-website-backups\intern-worktree-before-hrms-integration-20261105-1617.tar`.
Integration was assembled first in the worktree `D:\Projects\zyllo-tech-website-intern-all` (branch `hrms/integration-all`), then synced into Intern.

## Sources

| # | Module | Source | Migration(s) |
|---|---|---|---|
| 1 | HR Dashboard | Intern | 117_hr_dashboard_essentials |
| 2 | Employee Management | Intern | 118_hr_employee_management |
| 3 | Recruitment & Hiring | Intern | 120_hr_recruitment_hiring |
| 4 | Onboarding & Exit | `-m4`, via `-int11` | 130_hr_onboarding_exit |
| 5 | Attendance & Time | `-m5` | 125_hr_attendance_time |
| 6 | Leave Management | `-m6` | 160_hr_leave_management |
| 7 | Payroll & Salary | `-m7` | 170_hr_payroll_salary, 171_hr_payroll_exit_integration |
| 8 | Daily Work Reports | `-m8` | 128_hr_daily_work_reports |
| 9 | Employee Documents | `-m9`, via `-int11` | 129_hr_employee_documents |
| 10 | HR Requests & Approvals | `-m10` | 180_hr_requests_approvals |
| 11 | Asset Allocation | `-m11`, via `-int11` | 141_hr_asset_allocation, 142_hr_asset_lifecycle_gates, 143_hr_asset_cost_clearing |
| 12 | HR Reports & Analytics | `-m12` | 190_hr_reports_analytics |

Apply order is the filename order: 100–118 → 120 → 125 → 128 → 129 → 130 → 141 → 142 → 143 → 160 → 170 → 171 → 180 → 190.

## How it was merged
- **Base:** `-int11`, which is the current Intern plus Modules 4, 9 and 11, already reconciled by the Module 11 integration session. Module 4's source files had not changed since `-int11` was synced.
- **Modules 5, 6, 7, 8, 10 and 12:** only files the module itself changed were taken, identified by mtime after the worktree was created. Stale baseline copies in each worktree were ignored. Where Intern had also changed a file, a 3-way merge was used, with the pre-module snapshot as the base.
- **Excluded:** Module 4's stale `117_hr_employee_management.sql` and its test (a duplicate of 118), Module 4's patch and tar bundles, and Module 5's superseded holidays patch.

### Manual conflict resolutions
- `src/hr/pages/AttendancePage.jsx`: kept Module 5's new tab layout and carried over Session 1's dashboard click-through:
  - `?date`, `?department` and `?status=attended` now go to the Overview tab. `attended` maps to `present_any`.
  - `?from`, `?to` and `?department` now apply on the Late tab.
  - To support this, `attendance/OverviewTab.jsx` gained the `initialDepartment` and `initialStatus` props.
- `src/hr/pages/LeavePage.jsx`: took Module 6's version, which already includes Session 1's URL filters and adds `?review=1`.
- `src/hr/HrApp.jsx`: kept Intern's Recruitment and Onboarding & Exit entries, plus Module 10's "Requests & Approvals" entry with scoped permissions.
- `src/employee/EmployeeApp.jsx`: kept both My Resignation (Module 4) and My Reports (Module 12).
- `src/hr/settings/HolidaysSettings.jsx`: applied `m6/docs/hrms/integration/module6-holidays-settings-with-module5.patch`, as agreed by Modules 5 and 6.

## Verification (Intern tree, after sync)
- `node scripts/hr-db-test.mjs`: **35/35 test files, 2,550 assertions PASS.** 160b runs rather than skips.
- `node scripts/hr-db-test.mjs --seed`: 55/55 PASS.
- `npm test`: 69/69 PASS.
- `npx vite build`: PASS.
- **Not run on the combined tree:** browser flows and mobile checks. The per-module browser flows each passed in their own worktree. Re-run them one at a time on a fresh harness from Intern:
  - `browser-flows-m4`, `-m5-attendance`, `-leave`, `-payroll`, `-m8`, `-m9`, `-m10`, `-assets`
  - Module 12 has a browser plan only, never run.

## Integration fixes (2026-11-05, after the merge)

| Migration | Fix |
|---|---|
| `195_hr_attendance_half_day_leave.sql` | **Half-day leave now counts as a half day in attendance:** expected minutes are halved, a morning off skips the late check, an afternoon off skips the early-leave check, and no punch gives `half_day`. The 160b last assertion was updated as agreed. Test 195 has 49 assertions. |
| `196_hr_payroll_integration_fixes.sql` | **`hr_submit_reimbursement` now always refuses** (`use_hr_requests`), so claims go only through HR Requests (Module 10). The My Payslips claim form now links to `/employee/requests?new=reimbursement`. **Payroll vs. final settlement:** a lowered settlement line now makes the payroll payment `partially_paid` with the settled amount. A fully settled payslip also marks its attached reimbursements paid. Test 196 has 28 assertions. |
| `197_hr_security_dashboard_role_fixes.sql` | **Write helpers revoked:** `audit_event`, the `notify_*` helpers, `queue_email` and about 40 other owner-run write helpers in `hr_private` are revoked from anon and authenticated, plus every hr_private trigger function. Report export now audits through `hr_private.audit_report_export`. A guard fails the migration if any of these stays callable. **Dashboard:** counts now include Module 10 statuses and approval stages, and managers get a new `team_requests` card. **Roles:** a new `it_admin` role holds `exit.clearance_it`, with an RLS policy so IT can read leavers at clearance. `hr_requests.*` defaults are confirmed. `exit.override` stays super-admin only (break-glass). Test 197 has 53 assertions. |
| `198_hr_resume_privacy.sql` | **Resumes no longer public:** drops the site's old public read policy, "Public can view resumes" from 002, so candidate resumes are not readable by anyone. |

Other fixes:
- `hr-email-dispatch` lint fix.
- `scripts/hr-db-test.mjs` can now build its base from the project's own migrations when there is no schema dump. This is used for the website repo.

**Verification after the fixes:**
- DB: 38/38 files, 2,681 assertions.
- Seed: 55.
- npm: 69/69.
- vite build: PASS.

## Open items carried forward (owner decisions or follow-ups)
1. **Manual entries with no punches:** `hr_upsert_attendance_manual` still stores `absent` on a half-day date. If it should store `half_day`, pass a null status when there are no punches.
2. **Module 12 attendance analytics** (`ra_approved_leave_days` in 190) still treat a half-day leave as a full leave day in the attendance-% denominator.
3. **Partly settled payslips:** they stay linked to the settlement, so the unpaid balance needs a payroll correction.
4. **Payroll Admin dashboard access** is an owner decision.
5. **Future migrations** must not run the blanket `grant execute on all functions in schema hr_private`.
6. **Nothing scheduled yet:** offer expiry, document reminders, probation reminders, revoking access on the last working day, leave year-end, and announcement publishing. Each needs a service-role cron.
7. **Statutory payroll rules** (EPF, ESI, PT, TDS) are templates only and need professional validation.
8. **Module 12:**
   - Attendance analytics use each employee's current shift, so mid-period shift changes and alternate-Saturday rules are not applied.
   - The attendance range is capped at 93 days.
9. **Module 9:** PDFs are generated in the browser and support only Windows-1252 characters. Server-side rendering and e-signature are not built.
10. **Security clean-up (pending approval):** untrack `server/zyllotech.db` and delete `src/data/allCandidateEmails.json`, and purge both from Git history.
11. **Real environment still needed:** create the dev Supabase project, deploy the Edge Functions, and run signed-in end-to-end tests per role.

The per-module worktrees (`-m4` … `-m12`, `-int11`, `-all`) are left in place, unchanged. Remove them only after you have committed Intern.
