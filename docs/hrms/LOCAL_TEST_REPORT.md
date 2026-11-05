# HRMS local test report

- **Date:** 2026-11-02
- **Repo:** `zyllo-tech-website-intern`, branch `Intern` (uncommitted)
- **Scope:** all 14 HR Operations modules, the 15 Employee Portal pages, and the database layer, tested **without any Supabase project**.
- **Safety:** no live Supabase, no deployment, no commits, synthetic data only. Every browser test ran behind a network guard that **blocked every non-local host**. Across all runs: 0 external requests, 0 writes outside the throwaway local cluster.

## 1. Result labels
| Label | Meaning |
|---|---|
| **Verified locally with PostgreSQL** | Real migrations, constraints, RLS and RPCs executed on a throwaway PostgreSQL 17 cluster |
| **Verified with mocked services** | The unchanged frontend drove real local PostgreSQL through the test-only local API (Auth/Storage/Functions emulated, PostgREST subset reimplemented). RLS is real; the Supabase services are not. |
| **UI verified only** | Rendering, navigation, validation and layout checked; the server outcome was not checked |
| **Requires real Supabase integration** | Cannot be proven locally (real GoTrue, real Storage, deployed Edge Functions, email, cron) |
| **Failed** | Defect found. All failures found in this round were fixed and re-verified (section 7). |

**Nothing here is a complete end-to-end verification.** The API layer is a local emulation written for testing. It reproduces the request/response contracts the app uses, but it is not Supabase.

## 2. Test environment and method
| Layer | Tool | Notes |
|---|---|---|
| Database | `scripts/hr-db-test.mjs`: throwaway PG17 cluster per run, Supabase shim (`auth.*`, `storage.*`, roles) | 774 module assertions; `--seed` adds 27 more |
| Local API (test-only) | `scripts/hrms-local/api-server.mjs` + `postgrest.mjs` (Node built-ins only) | Every request runs as `set local role authenticated` with `request.jwt.claims`, like Supabase, so **real RLS applies** |
| Auth | emulated GoTrue (password and refresh grants, user, logout, bans) | random per-run JWT secret |
| Storage | emulated (bucket size/MIME limits, `storage.objects` RLS as the user, HMAC signed URLs) | 4 synthetic PDFs |
| Edge Functions | local stand-ins for `hr-invite-employee`, `hr-revoke-exit-access`, `hr-email-dispatch` | email never marked "sent" |
| Frontend | **unchanged app code** on a second Vite dev server (port 8090), pointed at the local API through process env | the start script verifies the served `env.js` points locally |
| Data | `supabase/seed/hr_dev_seed.sql` + `supabase/tests/hrms-local/local_fixtures.sql`, created by calling the real RPCs as each role | `@example.com` only |
| Browser | headless Chrome over CDP: `browser-crawl.mjs` (routes and tabs) and `browser-flows.mjs` (scripted workflows) | network guard: non-local hosts blocked |

**How the downloads were avoided:** the plan to use the real PostgREST binary was refused by this environment's policy against running downloaded code. The harness therefore uses only Node built-ins and the installed PostgreSQL. **No production code was changed to make testing possible**, and the production bundle contains no reference to the harness (verified: 0 matches).

**Synthetic accounts.** All use the password `Local-Test-Only-2026!`. **Test-only:** these accounts live only in the throwaway cluster; never reuse this password anywhere.

| Account | Roles / link |
|---|---|
| `superadmin@` | super_admin |
| `hr.admin@` | hr_admin |
| `payroll.admin@`, `payroll.approver@` | payroll_admin |
| `manager@` | manager (Demo Eng Lead) |
| `employee@` | employee (Demo Engineer 03) |
| `employee2@` | employee, different manager |
| `intern@` | intern |
| `noaccess@` | no roles |

## 3. Summary of results
| Suite | Result |
|---|---|
| DB module tests (14 files) | **774/774 assertions PASS**. Verified locally with PostgreSQL. |
| DB seed smoke | **27/27 PASS** |
| Harness selftest (API + RLS through the local API) | **94/94 PASS** |
| Browser crawl, desktop: 7 roles × every route, plus every in-page tab | **127 pages, 173 tabs, 0 issues.** 0 exceptions, 0 console errors, 0 failed API calls, 0 error states, 0 overflow. |
| Browser crawl, mobile 390 px: HR admin, manager, employee, intern | **93 pages, 115 tabs.** Overflow found on 21 views, then fixed and re-probed at 390 px (section 7). |
| Scripted UI workflows (round 1) | **34/34 PASS** (after making the script re-runnable) |
| Browser workflows with DB/permission/error/refresh checks (round 2, §9) | **140/140 PASS**, independently re-run on a fresh harness |
| `npm test` (node) | 45/45 PASS |
| Production build | PASS; no harness references, PII, demo tokens or service keys in the bundle |

## 4. HR Operations modules
Screenshots are in `docs/hrms/local-test-screenshots/`. They show Super Admin unless noted.

| # | Module | URL | Tested (method) | Result | Screenshot |
|---|---|---|---|---|---|
| 1 | HR Dashboard | `/hr` | DB: KPI correctness and company vs team scope (54 assertions). Browser: renders for super/hr/manager; manager sees team scope; payroll admin (no dashboard permission) redirected; no errors; filters present. | Verified locally with PostgreSQL + mocked services | `super-desktop-hr.jpg`, `manager-desktop-hr.jpg` |
| 2 | Employee Master | `/hr/employees`, `/hr/employees/:id` | **Flows:** list (16), server search (16 → 6), type filter, empty-form validation, invalid-email validation, Escape closes modal, create (ZT-NNNN generated) → profile, invite via function stand-in, duplicate email rejected with message, manager list limited to reporting line (11 of 16). DB: 60 assertions incl. import. | Verified with mocked services | `super-desktop-hr_employees.jpg`, `flow-hr-employee-created.jpg`, `hr-mobile-hr_employees.jpg` |
| 3 | Attendance & Time | `/hr/attendance` | Tabs (register, late, exceptions, corrections) render; DB calculations (53). Employee check-in UI state (button disabled after check-in, duplicate session prevented). | Verified locally with PostgreSQL; UI verified with mocked services | `super-desktop-hr_attendance.jpg`, `flow-employee-attendance.jpg` |
| 4 | Daily Work Reports | `/hr/daily-reports` | Tabs render with seeded draft, submitted, reviewed and revision states; DB workflow (53). | Verified locally with PostgreSQL; UI verified only | `super-desktop-hr_daily_reports.jpg` |
| 5 | Leave Management | `/hr/leave` | **Flows:** employee applies (validation, then submit); manager queue shows the team request and not other teams'; server overlap rule enforced (second run rejected "dates overlap"). DB: balances, approvals, self-approval refused (63). | Verified with mocked services | `super-desktop-hr_leave.jpg`, `flow-employee-leave.jpg`, `flow-manager-leave.jpg` |
| 6 | Recruitment & Interns | `/hr/recruitment/*` | Openings, pipeline, candidates, interviews and interns tabs render with seeded stages; DB pipeline, offers, conversions (90). | Verified locally with PostgreSQL; UI verified only | `super-desktop-hr_recruitment.jpg` |
| 7 | Payroll | `/hr/payroll`, `/hr/payroll/runs/:id` | Finalized run (calculated by one admin, approved by another) visible to payroll staff. HR admin refused (flow). DB: LOP, proration, separation of duties, locks (60). | Verified locally with PostgreSQL + mocked services | `super-desktop-hr_payroll.jpg` |
| 8 | Performance & KPI | `/hr/performance/*` | Cycles, reviews, goals, plans and feedback tabs render; DB rules (61). | Verified locally with PostgreSQL; UI verified only | `super-desktop-hr_performance.jpg` |
| 9 | Documents | `/hr/documents` | All, expiring and checklist tabs; signed-URL access is RLS-checked in the selftest; upload-retry fix verified via supabase-js against the local API. DB (71). | Verified with mocked services. **Requires real Supabase** for real Storage. | `super-desktop-hr_documents.jpg` |
| 10 | Announcements | `/hr/announcements` | Published and draft render; DB fan-out and receipts (47). | Verified locally with PostgreSQL; UI verified only | `super-desktop-hr_announcements.jpg` |
| 11 | Assets | `/hr/assets` | Inventory, assignments and requests render; DB rules (58). | Verified locally with PostgreSQL; UI verified only | `super-desktop-hr_assets.jpg` |
| 12 | HR Reports | `/hr/reports` | Page renders; all 17 reports execute and totals equal authorised records (DB). | Verified locally with PostgreSQL | `super-desktop-hr_reports.jpg` |
| 13 | Exit Management | `/hr/exits`, `/hr/exits/:id` | Case in clearance renders with stepper; revoke stand-in tested in selftest (invite → revoke → banned login). DB (60). | Verified with mocked services. **Requires real Supabase** for the real auth ban. | `super-desktop-hr_exits.jpg` |
| 14 | HR Settings | `/hr/settings` | All tabs render for super and HR (≥ 8 tabs); **audit log pagination** 407 entries / 9 pages, page 2 loads, detail dialog opens. | Verified with mocked services | `super-desktop-hr_settings.jpg`, `flow-audit-log-page2.jpg` |
| — | HR Requests | `/hr/requests` | Queue renders with internal notes; employee creates a request (flow). DB (44). | Verified with mocked services | `super-desktop-hr_requests.jpg` |

## 5. Employee Portal (each page visited by employee, intern, HR admin and manager; mobile for 4 roles)
| Page | URL | Result | Notes |
|---|---|---|---|
| My Dashboard | `/employee` | Verified with mocked services | Shows own attendance, balances, latest payslip, notifications, assets, requests. **Bug fixed:** "working day" label (§7). Screenshot `employee-desktop-employee.jpg`. |
| My Profile | `/employee/profile` | Verified with mocked services | Own record and contact details only |
| My Attendance | `/employee/attendance` | Verified with mocked services | Check-in state, history, correction form; banner says login ≠ attendance |
| My Daily Reports | `/employee/daily-reports` | UI verified only | Editor and history render |
| My Tasks & Projects | `/employee/tasks` | UI verified only | |
| My Leave | `/employee/leave` | Verified with mocked services | Apply flow, validation, server overlap rule |
| My Payslips | `/employee/payslips` | Verified with mocked services | 1 own payslip; no other employee's name appears (flow). Selftest: HR admin reads 0 payslips. |
| My Documents | `/employee/documents` | Verified with mocked services | Own documents; the confidential document is hidden (selftest) |
| My Assets | `/employee/assets` | UI verified only | Unacknowledged asset badge shown |
| My Performance | `/employee/performance` | UI verified only | |
| My Internship | `/employee/internship` | UI verified only | In nav only for interns (verified) |
| My Interviews | `/employee/interviews` | UI verified only | Renders for non-HR panel members (first crawl hit dev-server lazy compile; re-checked OK) |
| Announcements | `/employee/announcements` | UI verified only | |
| My HR Requests | `/employee/requests` | Verified with mocked services | Create request (flow) |
| Notifications | `/employee/notifications` | UI verified only | Unread badge count shown in header |

**Role navigation (verified):**
- **Super/HR:** 15 HR modules. HR admin has no Payroll, which is correct.
- **Payroll admin:** Employees, Attendance, Leave, Payroll, Reports, Settings (Salary components).
- **Manager:** team modules only.
- **Employee:** 14 portal pages.
- **Intern:** 15 portal pages, adding My Internship.
- **No-access account:** `/account-pending`; `/hr` and `/employee` both refused.

**Isolation:**
- **Mock-level (UI):** an employee is refused `/hr`, sees only their own payslip, and no other names appear.
- **Real RLS through the local API (selftest):** `employee@` cannot read `employee2@`'s attendance, leave, payslips or documents. The manager sees the team only. HR admin reads 0 salary rows. Anon gets 401.
- **Enforced in the database, not the UI:** these protections are RLS in PostgreSQL. The UI gating only adds convenience.

## 6. Database testing (Step 5) — Verified locally with PostgreSQL
Every migration (`100`–`112`) applies on a fresh cluster. The 774 assertions cover:
- **Data integrity:** constraints, foreign keys, unique and immutable employee IDs.
- **Attendance:** calculations (late, early, OT, half-day, overnight).
- **Leave:** balances (accrual, pending/used, carry-forward, negative rules, overlap, weekend/holiday exclusion).
- **Approvals:** never self, team scope, no double decisions.
- **Payroll:** proration, LOP, corrections in the next run, separation of duties, finalized locks.
- **Recruitment:** stage machine, offer gating, idempotent conversions.
- **Performance:** weights ≤ 100, confidentiality until finalized.
- **Assets:** one active assignment per asset, bulk quantities.
- **Exit:** clearance gating, access revocation, roles removed, history kept.
- **Reports:** all 17, team vs company scope, birthday/anniversary date maths.
- **RLS:** anon, employee, manager, HR, payroll, revoked and super admin, per module.

## 7. Issues found in this round
| # | Issue | Where | Status |
|---|---|---|---|
| 1 | Employee dashboard always said "non-working day" (read `t.is_working_day`; RPC returns `shift.is_working_day`) | `src/employee/pages/EmployeeDashboardPage.jsx:39` | **Fixed**, visually verified |
| 2 | **Mobile (390 px) page overflow on 21 table views.** Visually-hidden (`sr-only`, absolutely positioned) header labels escaped the table's scroll container because it was not positioned, widening the whole page. | `src/hr/ui.jsx` DataTable + 5 page-level scroll containers | **Fixed** (`relative` on scroll containers). Re-probe at 390 px: overflow gone. |
| 3 | Leave › Balances toolbar did not wrap on phones (39 px overflow) | `src/hr/pages/LeavePage.jsx:230` | **Fixed** (`flex-wrap`), re-probed 390 px |
| 4 | Document upload retry after a landed upload showed "You do not have permission" (storage policy refuses a second object before "already exists") | `src/lib/hr/documents.js` `uploadDocumentObject` | **Fixed** (confirm via signed URL). Verified with supabase-js against the local API. |
| 5 | Scripted workflows were not re-runnable (fixed email, fixed leave date). The server correctly rejected the duplicates. | test script only | Fixed in `browser-flows.mjs` |
| — | Public object URLs (`getPublicUrl`) and folder `list()` not emulated; affects admin CMS portfolio/careers pages, not the HRMS | local API limitation | Documented |

The mobile screenshot `hr-mobile-hr_leave-tab-balances.jpg` was captured **before** fix 3.

## 8. Not verifiable locally — requires real Supabase integration
- **Real Auth:**
  - invitation email → `/employee/activate` with a real one-time session, then password set
  - token refresh timing
  - "disable sign-up" setting
  - ban enforcement by GoTrue
- **Real Storage:** policies evaluated by the Storage API (the local emulation inserts `storage.objects` as the user), MIME sniffing, signed-URL format, CDN behaviour.
- **Deployed Edge Functions:** service-role behaviour, CORS from the real origin, secrets.
- **Delivery and scheduling:** email delivery (`hr-email-dispatch` with a provider); cron jobs (missing punches, reminders, scheduled announcements, expiry reminders).
- **Real PostgREST:** exact semantics for features the app does not use today (spread embeds, aggregates). The local implementation covers only what the app sends.
- **Environment:** Supabase's `extensions` schema placement of `citext`/`btree_gist` and the live `search_path`.
- **Real browsers:** touch interactions on real phones (only Chrome device emulation was used).
- **Not yet scripted in the UI** (rules proven by DB tests only):
  - daily report review UI
  - leave approval clicks
  - performance review forms
  - HR request replies
  - the remaining settings editors

  The workflows covered in round 2 (section 9) are no longer in this list.

## 9. Round 2: workflows driven through the real browser UI
- **Script:** `scripts/hrms-local/browser-flows-2.mjs`, plus `supabase/tests/hrms-local/extra_fixtures.sql` (a synthetic leaver for each run).
- **Runs:** written and first run by a sub-agent, then **independently re-run on a fresh harness**.
- **Result (both runs):** **140 checks passed, 0 failed, 0 external requests (network guard), 0 page exceptions.**
- **Label:** **Verified with mocked services**. These are real UI clicks, real RLS and RPCs on local PostgreSQL, with the Auth/Storage/Functions stand-ins.

**What each run checks:**
- **UI:** clicks and form fills on the real controls, including the file chooser through CDP `DOM.setFileInputFiles`.
- **DB:** read-only SQL checks as the cluster owner.
- **Permissions:** the UI hides or blocks the action, **and** the same action is attempted directly against the local API with an unauthorised user's token.
- **Errors:** an invalid action shows a message and leaves the database unchanged.
- **Refresh:** a reload shows the persisted state.

| Workflow | UI action | DB result | Permission enforcement | Error handling | Refresh | Checks |
|---|---|---|---|---|---|---|
| **Attendance** | PASS | PASS | PASS | PASS | PASS | 39/39 |
| **Payroll** | PASS | PASS | PASS | PASS | PASS | 22/22 |
| **Documents** | PASS | PASS | PASS | PASS | PASS | 17/17 |
| **Recruitment** | PASS | PASS | PASS | PASS | PASS | 13/13 |
| **Assets** | PASS | PASS | PASS | PASS | PASS | 16/16 |
| **Announcements** | PASS | PASS | PASS | PASS | PASS | 12/12 |
| **Exit clearance** | PASS | PASS | PASS | PASS | PASS | 21/21 |

### 9.1 Attendance (Priority 1)
**Punch in**
- `/employee/attendance` → Check in → confirm shows a server-time toast.
- One `hr_attendance` row, with `check_in_at` set by the server and source `self`.
- Late minutes and status follow the shift (09:30–18:30, grace 10, break 60).

**Duplicate punch in**
- The button is disabled after checking in.
- A direct `hr_check_in` call returns "You have already checked in today." and there is still exactly 1 row.

**Punch out and working hours**
- Real UI punches seconds apart give worked = max(span − break, 0) = 0, so status `half_day` and early-leave minutes set. This matches `attendance_compute` in `101_hr_attendance.sql`.
- Realistic case via HR manual entry, 09:40→18:45:

  | Field | Value |
  |---|---|
  | Worked | **485 min** (545 − 60) |
  | Late | 0 (10 minutes is within the grace) |
  | Early leave | 0 |
  | Overtime | **5 min** (485 − 480 net shift) |
  | Status | present |
- After reload, the register shows `09:40 / 18:45 / 8h 05m`.

**Persistence after refresh:** the checked-in state, then the checked-out state, survive reload.

**History:** the month history shows today's row, the missing-punch day and the corrected day.

**HR visibility**
- HR admin's daily register shows the row.
- The manager's register shows their team member (Engineer 03) but not employee2 (another team), and the API agrees.

**Isolation**
- employee2 and employee@ each read 0 of the other's attendance rows through the API.
- An employee cannot call `hr_upsert_attendance_manual` or `hr_mark_missing_punches`, cannot decide another employee's correction, and `/hr/attendance` shows "Not authorised".

**Missing punch out**
1. A past day with a check-in only is set up.
2. HR runs "Mark missing punches" for that date.
3. Status becomes `missing_punch` and the employee is notified (`hr_notifications`). The row appears in the HR Exceptions tab and the employee history.
4. The employee requests a correction. A second pending correction for the same date is refused.
5. HR approves it. The row is recalculated with `source = correction`, the correction is marked approved, and the employee is notified.
6. Marking today or a future date is refused.

**Errors:** second check-out refused; check-out without check-in rejected; manual entry with out-before-in refused by the server.

### 9.2 Payroll
**Workflow**
1. payroll.admin creates the November run → Calculate (7 employees) → Mark reviewed.
2. payroll.approver approves → finalizes (the irreversible tick is required) → records it as paid with a reference.

**DB**
- Status goes draft → calculated → reviewed → approved → finalized → paid.
- 7 items and 7 published payslips; `paid_by` = the approver.
- Notifications go only to payslip employees with linked accounts (2), by design.

**Permission**
- payroll.admin approving their own run is refused: "Payroll must be approved by a different person…".
- hr.admin is redirected away from `/hr/payroll`; through the API its create is refused and it reads 0 runs.
- An employee reads 0 of another employee's payslips.

**Errors**
- A run overlapping the finalized October run is refused.
- Finalize before approval is refused ("Only approved runs can be finalized").
- A payment reference shorter than 3 characters is rejected.

**Refresh:** the run shows Paid with its reference, and the employee's payslip list goes from 1 to 2.

**Recording only:** "Record as paid" only records the status; no payment is made.

### 9.3 Documents
**Upload:** HR uploads a PDF through the real file chooser. This creates the `hr_documents` + `hr_document_versions` + `storage.objects` rows (owner hr.admin), and the bytes are stored.

**Download**
- The employee's View and Download produce signed URLs that return the PDF bytes (HTTP 200, starts with `%PDF-`).
- Access-log rows are written for view and download.

**Verify:** HR verifies → status `verified`, and the employee is notified. After a refresh the employee sees "verified".

**Permission**
- employee2 cannot see the document, and through the API a signed URL, download or select is refused.
- As a control, the owner's identical call succeeds.
- employee2's upload into employee@'s folder gets 403 (storage RLS).
- An employee cannot verify documents.

**Errors**
- A .txt file and an 11 MB file are rejected with messages, and nothing is written.
- The server independently refuses a bad MIME type or oversize registration.

### 9.4 Recruitment
**Pipeline**
1. Add candidate → screening → shortlisted.
2. Schedule interview with a manager on the panel. The stage moves to interview and the panel is notified.
3. Selected → create offer → send (stage offered) → accept → convert to employee.

**DB**
- Full stage-event trail, ending at `joined`.
- New employee with `source='candidate'` and `source_ref` = the application.

**Errors**
- The UI offers only legal next stages.
- An API jump from screening to selected is refused: "A candidate cannot move from screening to selected."
- Moving to Offered without a sent offer is refused.

**Permission:** an employee is blocked in the UI; through the API, moving a stage is refused and reading applications returns 0.

**Refresh:** the application shows Joined and the new employee code.

### 9.5 Assets
**Workflow:** HR assigns DEMO-LT-004 to employee@ → the employee sees it and acknowledges (`acknowledged_at` set) → HR records the return with condition *good*. The assignment is then `returned` and the asset is `available`.

**Errors**
- Re-assigning the non-bulk asset to employee2 is refused ("This asset is already assigned"), with still one active assignment.
- The UI hides "Assign" for it.
- Assigning with no employee, or returning with no condition, is rejected.

**Permission:** employee2 cannot see or acknowledge the assignment (UI + API), and an employee cannot record a return.

**Refresh:** the acknowledged and returned states persist.

### 9.6 Announcements
**Workflow:** HR saves a draft for the Engineering department with acknowledgement required → Publish now.

**Notifications:** 3 portal notifications, only to ENG employees with portal access.

**Receipts:** the employee opens the announcement (`read_at`) and acknowledges it (`acknowledged_at`).

**Errors:** empty title or no department is rejected. A published announcement has no Edit button, and an API PATCH is refused ("Published announcements cannot be edited") with the title unchanged.

**Permission:** an employee's API insert gets 403 and publish is refused; employee2 (Design) cannot see or acknowledge the Engineering announcement.

**Refresh:** the card shows acknowledged and is no longer "New".

### 9.7 Exit clearance
**Test subject:** a synthetic leaver created per run with an account and an assigned asset. The seeded case for Engineer 05 cannot be closed yet, because its last working day is in the future, which `hr_close_exit` correctly enforces.

**Workflow**
1. HR initiates the exit → start clearance (8 items).
2. Completing *asset return* while the asset is out is refused: "Assets are still assigned… Record their return first."
3. The asset is returned, then the item completes.
4. *Access revocation*: Complete stays disabled until "Revoke sign-in access" (Edge Function stand-in) runs. Then `auth.users.banned_until` and `auth_access_revoked_at` are set.
5. "Move to final settlement" stays disabled while items are pending.
6. Letters are recorded.
7. Closing with pending items is refused: "Complete these clearance items first: final settlement, relieving letter." Nothing changes.
8. Close (confirm).

**DB:** the employee is `exited` with `portal_access=false` and 0 roles. **History is retained**: 15 exit events, 8 items, role-revocation history and the asset history.

**Permission:** the leaver's sign-in fails, both via the API ("User is banned") and on the login page. An employee cannot initiate or close an exit, and `/hr/exits` is blocked.

**Refresh:** the case shows closed, the letters issued and every item done.

### 9.8 Screenshots (round 2)
All are in `docs/hrms/local-test-screenshots/` and show synthetic data:
- **Attendance:** `wf2-attendance-checked-in`, `-checked-out`, `-hr-register`, `-hr-exceptions`, `-employee-corrected`
- **Payroll:** `wf2-payroll-separation-of-duties`, `-run-paid`, `-employee-payslips`
- **Documents:** `wf2-documents-hr-uploaded`, `-employee-verified`
- **Recruitment:** `wf2-recruitment-offer-required-error`, `-converted`
- **Assets:** `wf2-assets-assigned`, `-employee-acknowledged`, `-returned`
- **Announcements:** `wf2-announcements-published`, `-employee-ack`
- **Exit:** `wf2-exit-asset-return-blocked`, `-close-blocked`, `-closed`, `-leaver-login-refused`

### 9.9 Round 2 findings
**Application bugs:** none found in these seven workflows.

**Test-infrastructure note:** harness instances share one state file (`%TEMP%\zyllo-hrms-local.json`). Two concurrent `start.mjs` runs therefore interfere, and `stop.mjs` stops whichever instance the file names.
- **Effect this round:** during the sub-agent's run, a second instance was started and left running. The sub-agent switched to an isolated `TEMP` and separate ports; I later confirmed the leftover was our own harness and stopped it.
- **Workaround:** run one harness at a time, or set a separate `TEMP` per instance. `browser-flows-2.mjs` accepts `--state <file>`.

**Still requires real Supabase for these workflows:**
- real GoTrue sessions and bans
- the Storage API's own policy evaluation and signed-URL format
- the deployed `hr-revoke-exit-access` and `hr-invite-employee` functions
- email delivery of payslip and announcement notices
- cron jobs: automatic missing-punch marking, scheduled announcements, expiry reminders

## 10. How to re-run
```
node scripts/hr-db-test.mjs            # 774 DB assertions
node scripts/hr-db-test.mjs --seed     # seed smoke
node scripts/hrms-local/start.mjs      # local harness (API :54321, web :8090)
node scripts/hrms-local/selftest.mjs   # 94 API/RLS checks
node scripts/hrms-local/browser-crawl.mjs --out <dir> [--mobile] [--roles super,employee]
node scripts/hrms-local/browser-flows.mjs --out <dir>
node scripts/hrms-local/browser-flows-2.mjs --out <file.json> [--only attendance,payroll,documents,recruitment,assets,announcements,exit]
node scripts/hrms-local/stop.mjs
```
**Test-only:** the harness must never be deployed. It lives in `scripts/hrms-local/` and `supabase/tests/hrms-local/`, outside `src/`, and is never imported by the app.

## 11. Recommended next steps
1. **Script the remaining UI paths** (daily report review, leave approval clicks, performance forms, HR request replies) in the same style as `browser-flows-2.mjs`. Already covered in round 2:
   - payroll run through the UI
   - document upload via the file chooser (CDP `DOM.setFileInputFiles`)
   - recruitment stage moves and conversion
   - exit clearance and close
   - announcement publish
   - asset assign and acknowledge
2. **Add the crawl and flows to a pre-merge checklist** (see `MAIN_PROJECT_INTEGRATION_PLAN.md` §10).
3. **Before production:** run the section-8 items on a staging Supabase project. The only alternative is the main project's own staging; creating another project was ruled out by the owner.

## 12. Round 4 (2026-11-03): AIMS ERP reference alignment

Scope: migrations 113–116, the structured Employee Master, Org Structure, Benefits, Training, dashboard/report extensions, navigation and settings changes. Details: `AIMS_REFERENCE_ALIGNMENT.md`.

| Suite | Result |
|---|---|
| DB module tests — existing 14 files with 113–116 applied | **774/774 PASS** (no regression) |
| DB module tests — new files | **113: 62, 114: 30, 115: 34, 116: 37 — 163/163 PASS** (run per file) |
| DB seed smoke (`--seed`) | **55/55 PASS** (27 existing + 28 new) |
| `npm test` | 45/45 PASS |
| `vite build` | PASS |
| Harness selftest | 94/94 PASS (twice) |
| Browser round 1 (`browser-flows.mjs`) | **34/34 PASS** on a warm dev server. Earlier attempts failed on first-load timing (Vite compiling just-edited chunks); two real findings were fixed: validation messages of non-visible form sections are now listed in an error summary, and dashboard completeness was rewritten as one pass (89 ms → 8 ms in the DB). |
| Browser round 2 (`browser-flows-2.mjs`, 140 checks) | **Not completed.** First run (concurrent with other jobs, orphaned headless Chrome left over): 84 pass / 10 fail with "Chrome did not start" and sign-ins stuck on `/login`. The clean sequential re-run was **stopped by the host because the machine ran low on memory**. Neither run is a valid result; re-run on a fresh harness. |
| Browser round 3 (`browser-flows-3.mjs`) | **Not run** in this round (same stop). |
| Browser round 4 (`browser-flows-4.mjs`, new) | **Written, not yet executed.** Covers Employee Master (sections, validation, PII/identity/remarks persistence, audit redaction, masking, history, refresh, duplicate passport, payroll separation, bank account), Org Structure (tree/table/hierarchy/checks, cycle refusals, manager scope), Benefits (eligibility, override, enroll, suspend, refresh, permissions, My Benefits), Training (assign, self-complete, verify, scope), dashboard/report/pagination/alias/nav/settings checks and 390 px mobile overflow. |
| Crawl (`browser-crawl.mjs`) | Route list extended with the new pages; **not re-run** in this round. |

**To finish verification** (≈30–40 min, needs several GB of free memory; close other dev servers/test runners first):
```bash
node scripts/hrms-local/start.mjs            # fresh harness
node scripts/hrms-local/selftest.mjs
node scripts/hrms-local/browser-flows-2.mjs --out <dir>/flows2.json
node scripts/hrms-local/browser-flows-3.mjs --out <dir>/flows3.json
node scripts/hrms-local/browser-flows.mjs
node scripts/hrms-local/browser-flows-4.mjs --out <dir>/flows4.json
node scripts/hrms-local/browser-crawl.mjs --out <dir>/crawl  (and --mobile)
node scripts/hrms-local/stop.mjs
```

### 12.1 Verification run (2026-11-03 / 04)

Fresh harness, suites run strictly one at a time with a memory watchdog (stop below 1.5 GB free); free memory stayed 7–10 GB during every suite. Selftest 94/94.

| Suite | Result | Notes |
|---|---|---|
| Round 2 (`browser-flows-2.mjs`) | **140/140 PASS** | Full run: documents 17, recruitment 13, assets 16 passed; attendance, payroll, announcements and exit failed on timing (pages navigated after the fixed waits; every sign-in returned 200, no 5xx). Re-run individually with **unchanged assertions**: attendance 39/39, payroll 22/22, announcements 12/12, exit 21/21. |
| Round 3 (`browser-flows-3.mjs`) | **201/201 PASS** | One full run, including HR Settings against the new grouped settings navigation. |
| Round 4 (`browser-flows-4.mjs`, new) | **49 pass / 6 fail (first run) — not finished** | Investigated each failure in the browser: |
| | 4 × test expectation errors (fixed in the test) | (a) app message is "Use the **two**-letter country code" — regex used "Two-letter"; (b) and (c) My Profile labels and dashboard KPI labels are CSS-uppercased and `innerText` returns "COMPANY" / "TOTAL EMPLOYEES" — regexes now case-insensitive; data verified correct (dashboard 19 = DB 19). (d) The manager hierarchy opens one level deep, so the check now searches the person first (as the HR check does); probe confirmed no Design-team member is visible to the manager. |
| | 2 × training (assign → self-complete → verify) | **Open.** Server behaviour verified directly (RPC errors correct, certificate lookup OK, permissions pass). The UI step did not complete inside the test: the Training page renders 3–7 s after a cold navigation on the dev server. Readiness waits were added (timing only, no assertion change), but the last re-run still failed at HR's assign step, and the harness was stopped by the host for low memory right after, so it is **not yet known** whether this is test timing or a UI defect. Re-run `--only training` first. |
| Crawl, desktop + mobile (`browser-crawl.mjs`) | **Not run** | Harness stopped (host low-memory reap) before this step. |
| `npm test`, `vite build` (final) | **Not re-run** after the test-script changes; last results 45/45 and PASS. No application code changed in this round. |

Harness defect noted (test script, not the app): when a workflow throws, `browser-flows-2.mjs` leaves its Chrome open and the Node process keeps running after printing the summary; those processes had to be stopped by hand.

**Remaining, in order:** start a fresh harness → `browser-flows-4.mjs --only training` (investigate if it still fails) → full `browser-flows-4.mjs` → `browser-crawl.mjs` desktop and `--mobile` → `npm test` → `vite build`.
