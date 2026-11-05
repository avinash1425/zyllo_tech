# Module 8 — Daily Work Reports (integration notes)

Branch / worktree: `hrms/module-8-daily-reports` at `D:\Projects\zyllo-tech-website-intern-m8`
(baseline = uncommitted Intern working tree, staged; Module 8 changes are unstaged on top).

## What was reused (not duplicated)

| Existing (migration 102) | Kept as |
|---|---|
| `hr_daily_reports` (unique employee + date) | the single daily report; status values unchanged |
| `hr_daily_report_items` | the tasks of a report (many per report) |
| `hr_daily_report_reviews` | review history (+ new action `reopened`) |
| `hr_projects`, `hr_project_members`, `hr_tasks` | minimal HR project master / allocation (no Project Tracker clone) |
| `hr_submit_daily_report`, `hr_review_daily_report`, `hr_reply_daily_report` | unchanged submit / review / reply workflow |
| `hr_missing_daily_reports`, reminders, `hr_daily_report_blockers` | unchanged compliance, reminders, free-text blocker notes |
| `daily_reports.*` permissions | reused; **no new permission keys** |

UI labels: DB `reviewed` = **Approved**, DB `revision_requested` = **Changes requested**
(`REPORT_STATUS_LABEL` in `src/lib/hr/dailyReports.js`). Dashboards 112/117 keep working because
the stored values did not change.

## Migration `supabase/migrations/128_hr_daily_work_reports.sql`

Numbered 128 to follow the 120 + module convention (Module 5 uses 125). Depends on 100, 101, 102,
112 (`is_working_day_for`), 113 (`legal_entity_id`). Idempotent `alter … add column if not exists`
/ `drop constraint if exists` where it extends 102.

- **Tasks** (`hr_daily_report_items`): `work_status` (not_started / in_progress / completed / blocked),
  `completed_work`, `deliverables`, `completion_date`, `links text[]` (http(s) only, ≤ 10), `notes`.
  Hours `0..24`, 0 only for not-started tasks; completed ⇒ progress 100 and completion date ≤ report date.
  Backfill: items at 100 % become `completed`.
- **Allocation**: `hr_projects.manager_employee_id`, `source`, `external_ref`;
  `hr_project_members.start_date / end_date / allocation_pct / notes`; an item may reference a project
  only if the employee is allocated **on the report date** (`hr_private.is_project_allocated`).
  Project managers with `daily_reports.review_team` manage allocations of their own projects
  (`hr_private.can_manage_project_allocation`); HR (`daily_reports.manage`) manages all.
  History: `hr_project_allocation_history` (trigger; read = project visibility). Employee is notified in-app on assignment.
- **Blockers**: `hr_work_blockers` (title, description, severity, project/task/report/item, reported date,
  resolution owner, open → in_progress → resolved, resolution notes, resolved date). No direct writes;
  RPCs `hr_save_work_blocker`, `hr_update_work_blocker`, `hr_delete_work_blocker`, `hr_list_work_blockers`.
  Reporting manager gets an **in-app** notification (no email is sent). Audited.
- **Submission rules** (trigger on submit): total hours > 0; each blocked task needs a blocker.
- **Versions**: `hr_daily_report_versions` — immutable snapshot (report + tasks + blockers) per submission.
- **Reopen**: `hr_reopen_daily_report(id, reason)` — approved → changes requested; never self; reviewer scope.
- **Audit**: `hr_daily_reports`, `hr_daily_report_items`, `hr_work_blockers` now use `hr_private.enable_audit`.
- **Read RPCs**: `hr_daily_work_overview` (KPIs, project hours, employee-wise status; filters date/range,
  department, project, manager, company, status), `hr_work_hours_summary` (day/week/month/employee/project),
  `hr_work_hours_vs_attendance` (read-only comparison + flags), `hr_completed_work` (completed work / task history).
- **Project Tracker hook**: `hr_sync_tracker_project(...)` — `service_role` only; upserts by
  (`source='project_tracker'`, `external_ref`); never overwrites an HRMS-created code. Not called by the browser.
- Setting `daily_reports.attendance_variance_hours` (default 1.0) — discrepancy threshold.

Reported task hours are not attendance: attendance rows are never written, and nothing feeds payroll.

## Frontend

| File | Change |
|---|---|
| `src/lib/hr/dailyReports.js` | new fields, labels, allocation/blocker/overview/hours/version/reopen wrappers; existing exports kept |
| `src/hr/components/DailyWorkParts.jsx` (new) | badges, task breakdown, versions, blocker table + triage, hours summary, attendance comparison |
| `src/hr/pages/DailyReportsPage.jsx` | tabs: Review queue (default), Overview, Blockers, Hours, Compliance, Recurring blocker notes, Projects; reopen; versions |
| `src/hr/settings/ProjectsSettings.jsx` | project manager, date-bounded allocations, allocation %, edit, history |
| `src/employee/pages/MyDailyReportsPage.jsx` | task status/completed work/links/inline blockers; tabs My blockers, My hours, Completed work |
| `src/employee/pages/MyTasksPage.jsx` | shows allocation period / % |

No shared navigation, `HrApp.jsx`, `EmployeeApp.jsx`, `ui.jsx`, `auth.jsx` or permission catalogue changes.
Routes are unchanged (`/hr/daily-reports`, `/employee/daily-reports`, `/employee/tasks`);
`?tab=blockers` deep links are used by blocker notifications.

## Integration dependencies with Modules 1–7

- **Module 5 (Attendance, `125_hr_attendance_time.sql`)**: 128 reads only `hr_attendance.employee_id,
  work_date, status, check_in_at, check_out_at, worked_minutes` — unchanged by 125. If 125 adds NOT NULL
  columns without defaults, the attendance fixture in `supabase/tests/hr/128_daily_work_reports.test.sql`
  (direct owner insert) may need those columns. Apply order 125 → 128 is fine; 128 does not depend on 125.
- **Employee Management (113/118)**: uses `legal_entity_id`, `department_id`, `manager_id`, `status`,
  `portal_access`; no employee data duplicated.
- **Dashboard / Reports (112/117)**: unchanged; they keep counting `submitted/under_review` and `reviewed`.
- **Performance & KPI (106)**: no change; `hr_work_hours_summary` / `hr_completed_work` are available as
  inputs for reviewers.
- `scripts/hrms-local/browser-flows-3.mjs` labels used for daily reports were preserved
  (Date, Hours, Activity, Progress %, Add item, Save draft, Submit, Action values, Apply, toasts).

## Tests

- `supabase/tests/hr/128_daily_work_reports.test.sql` — 106 assertions (allocation, visibility,
  tasks, hours, blockers, submit rules, versions, changes requested / revision, approval lock, reopen,
  self-approval, hours summaries, attendance comparison, overview scoping, tracker hook).
- `node scripts/hr-db-test.mjs` → 21/21 files, 1140 assertions; `--seed` → 900 smoke passes.

## Verification status and plan (browser testing paused)

### Shared-file change: `scripts/hrms-local/browser-flows-3.mjs`
Two assertions in `wfReports` (lines ~425 and ~435) now accept the new labels:
`/reviewed|Approved/` and `/Revision requested|Changes requested/`. They still accept the old wording,
so the script passes against both the baseline UI and the Module 8 UI. Integration impact: a 2-line
text merge only; no other session's worktree (m4–m7, m9–m12) has modified this file as of 2026-11-05.
Any other flow that asserts the literal badge text `reviewed` / `revision requested` on daily
reports needs the same widening (none found in browser-flows.mjs, -2.mjs, browser-crawl.mjs).

### Employee resubmission failure (regression run 2) — evidence
- DB level: the same item edit + `hr_submit_daily_report` as employee@ on that report succeeds.
- App validation: the real `validateReport` accepts the exact task data (ok, 7 h) — not a silent client block.
- No page exceptions were recorded; no external requests.
- API log: after the employee editor's last load (05:49:39.8) the API received **no request for 127 s**,
  including the next step's manager sign-in (`POST /auth/v1/token`). The flow never waits longer than ~8 s.
- The flow reads the page at a fixed 2.5 s after setting the date; the editor's own queries only started
  ~4.2 s after it (05:49:38.7), so the step ran before the editor existed.
- Run 3 executed the same employee save → submit path successfully in the browser (06:00:09–11, all 200),
  then stalled with 48 s / 236 s / 110 s idle gaps; Claude Code later stopped it for low system memory.
- Conclusion: the evidence points to the test runner / headless Chrome stalling under memory pressure, not
  to an application defect. This is **not yet proven by a clean rerun**; it stays an open verification item.

### Sequential browser test plan (run only after approval, one step at a time)
1. Confirm free memory ≥ 4 GB and CPU < 60 % sustained; confirm no other harness uses ports 54388/8098.
2. Start the private harness: `TEMP=<m8 scratch> TMP=<m8 scratch> node scripts/hrms-local/start.mjs --port-api 54388 --port-web 8098`.
3. Run `browser-flows-3.mjs --only reports --state <m8 state>` once. Expected 39/39.
4. If the resubmit step fails again: inspect the API log for a gap (runner stall) vs. a 4xx on
   PATCH/`hr_submit_daily_report` (app defect) before any rerun.
5. Run `browser-flows-m8.mjs --state <m8 state>` (condition-based waits, includes mobile 390 px checks).
6. Stop the private harness (`stop.mjs` with the same TEMP); restore any `wf3-*.jpg` screenshots the
   regression script overwrote in docs/.
Never run 3 and 5 concurrently (both write to employee@'s reports).

### Responsiveness checks still outstanding (not yet run)
- 390 px: employee report editor (6-column task grid collapses to 1 column; inline blocker panel;
  links textarea), My blockers / My hours / Completed work tables (horizontal scroll inside the table only).
- 390 px: HR Overview toolbar (7 filters stack), KPI grid (2 columns), "Submission status" card header
  with its select, review modal (bottom sheet, task breakdown with links), allocation modal.
- Desktop 1440 px: review queue with both toolbars, Overview two-column cards (xl), Hours tab.
- Pass criterion: `document.documentElement.scrollWidth - innerWidth <= 1`, no clipped buttons; screenshots.

### Compatibility
- **Module 5 (125 Attendance & Time):** adds only nullable columns to `hr_attendance` (original punches,
  timezone) and keeps `worked_minutes`, `status`, `check_in_at`, `check_out_at`, `work_date` — exactly the
  columns `hr_work_hours_vs_attendance` reads. No trigger in 125 blocks the test's owner insert. 128 does
  not depend on 125 and never writes attendance. Run the 128 test after applying 125 to confirm.
- **Employee Management (113 / 118):** reads `manager_id`, `department_id`, `legal_entity_id`, `status`,
  `portal_access`, `joining_date`, `last_working_date`; scope uses the existing `can_access_employee` /
  `is_manager_of`. No employee data is copied.
- **Later sessions:** no other worktree uses number 128; later migrations (129–190) do not redefine any
  function 128 replaces. Module 12's `190_hr_reports_analytics.sql` counts `reviewed` / `revision_requested`
  — compatible because stored status values are unchanged.

## Final browser verification (2026-11-05, private harness :8098 / :54388, sequential)

| Run | Result | Notes |
|---|---|---|
| browser-flows-3 `reports` #1 | 33/39 | 0 page exceptions; failures = sessions that never reached the API (114 s / 76 s silent gaps); all API responses as expected |
| browser-flows-m8 #1 | 23/35 | 3 bugs in the new test script (picker-options race, review-row race, case-sensitive match on uppercase labels); no app defect; one run reopened fixture report 11-05 on the throwaway DB |
| browser-flows-m8 #2 (script fixed, no app change) | **35/35** | allocation, multi-task draft, inline blocker, submit, changes requested, revision v2, approve, reopen, triage/resolve, overview, hours, role limits, 390 px |
| browser-flows-3 `reports` #2 (no app change) | **39/39** | |

Visual review: 390 px employee editor and manager overview, 1440 px blocker tracker and employee editor —
no clipping, no page-level horizontal scroll, controls reachable.
Cosmetic: sortable DataTable headers not uppercase (shared `DataTable`); Blockers "Status" filter label truncated
("Open + in prog") at `sm:w-40`; on mobile the Overview's six filters push the KPIs below the fold.
Not visually inspected: 390 px review / allocation modals and the Hours tab (functionally passed at 1440 px).
