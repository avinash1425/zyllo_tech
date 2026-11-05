# HRMS Module 2 — Employee Management

Status: **Tested on the local harness** (2026-11-05). Nothing committed, pushed or deployed. Live Supabase untouched.

Employee Management consolidates the former **Employee Master**. It uses the same tables, RPCs, Edge Functions,
employee records and routes. No duplicate module exists.

## Pages and routes

| Route | What |
|---|---|
| `/hr/employees` | Directory: summary cards, search, filters (department, designation, status, type, reporting manager, company, location, grade, joining date), server pagination, Add / Import / Export |
| `/hr/employees/:id` | Profile tabs: Overview (lifecycle + completeness), Job & reporting, Personal, Identification, Documents, Employment history, Banking & payroll (payroll only), Exit, Access & roles |
| `/hr/employee-management` | New alias → `/hr/employees` |
| `/hr/employee-master` | Existing alias, kept |
| `/employee/profile` | Employee Portal: own profile + own employment timeline |

Navigation: "Employee Management" sits directly after "HR Dashboard".

## Database (migration `118_hr_employee_management.sql`, additive)

- `hr_employee_change_events`: one row per authorised change, with category, effective date, reason, readable before/after values and actor. RLS read: self / `employees.view` / manager scope. No direct writes. Audited.
- `hr_employee_history.event_id`: links the existing trigger-written field rows to their event.
- History immutability trigger: history rows cannot be edited, even by the table owner. The only allowed update attaches a row to its event, inside the change RPC.
- `hr_employees_validate_assignment` trigger checks **changed** values only:
  - the designation must belong to the employee's department (or be company-wide)
  - newly assigned departments and designations must be active
  - a newly assigned manager must be a current employee

  Self-reporting and reporting cycles were already rejected by migration 100.
- `hr_employees.confirmation_date`.
- RPCs:
  - `hr_change_employee_assignment(...)`: needs `employees.edit`. It requires a reason and an effective date (not in the future, not before joining), and the category must match the change. It refuses self-changes (except super admin), refuses notice/exit (those use Exit Management), and runs the update as the caller, so RLS and the guard triggers still apply. It notifies the employee.
  - `hr_employee_timeline(p_employee)`: events plus field history, with actor names.
  - `hr_employee_summary(...)`: SECURITY INVOKER counts, so the caller's RLS scope applies.

## UI behaviour

- In Edit mode, company, department, designation, grade, manager and status are read-only. They change through **Promote / Transfer / Change assignment** or the lifecycle buttons, so every change carries a reason and effective date. Create mode keeps all fields; the designation list follows the chosen department.
- Lifecycle: Onboarding → Probation → Confirmed/active → Resignation/notice → Exit.
  - "Start probation", "Confirm employment", "Suspend/archive" and "Reactivate" go through the change RPC.
  - Resignation and exit link to the existing Exit Management.
  - The onboarding hint links to the existing document checklist and portal invitation.
- The Documents tab reuses the Documents module: private bucket, 60-second signed URLs, upload, verify/reject, versions, the required checklist, and an access-history table (`documents.view` / `documents.manage` only).

## Tests

- `supabase/tests/hr/118_employee_management.test.sql`: 65 assertions. `node scripts/hr-db-test.mjs` runs 20/20 files, 1034 assertions; the seed smoke test passes 55/55.
- `scripts/hrms-local/browser-flows-5.mjs`: 59/59 checks, covering UI, DB, permission, error and refresh for HR admin, manager, employee and payroll admin. No external requests; no page exceptions.
- Regression: browser-flows-4 `employee_master` + `org` 24/24; `npm test` 51/51; `vite build` PASS.

## Known limitations

- Future-dated (scheduled) changes are not supported; changes apply on the day they are recorded and may be back-dated.
- Direct table updates (CSV import, older API callers) still work and write history without a reason. Only the UI routes assignment changes through the reasoned RPC.
- Company / legal entity vs department consistency is not enforced; existing seed data has 3 mismatches.
- Change reasons are visible to the employee in their own timeline.
