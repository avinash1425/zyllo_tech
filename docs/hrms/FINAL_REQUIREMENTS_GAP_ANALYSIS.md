# Zyllo Tech HRMS — Final requirements gap analysis (AIMS ERP reference vs actual implementation)

- **Date:** 2026-11-05
- **Branch:** `Intern`, HEAD `99fa9b5` plus uncommitted HRMS work. Nothing was committed, pushed, deployed or reset for this audit.
- **Method:** read-only. The evidence comes from source code (`src/hr`, `src/employee`, `src/lib/hr`), migrations `100`–`116`, DB tests (`supabase/tests/hr`), browser test scripts (`scripts/hrms-local/browser-flows*.mjs`), the test logs and screenshots, and the docs. **Previous completion reports were not trusted on their own;** every claim used here was checked against code.
- **No live Supabase, no AIMS ERP, and no real employee data** were accessed. No application code was changed.

> ### ⚠ PROVISIONAL — the original AIMS ERP analysis is not in the repository
> The owner's original written analysis of the AIMS ERP HR module is **not saved anywhere in this repository**. The only record of it is the summary in `AIMS_REFERENCE_ALIGNMENT.md`: 12 tabs, the Employee Master form, dashboard analytics, 30 report templates and HR Requests.
>
> The requirement list and the A / B / C classification below were therefore reconstructed from that summary, from the 20 areas named in the audit request, and from the code.
>
> **Before this audit is treated as final, the owner needs to supply the original analysis.** Rows will then be added, removed or re-classified, especially the Employee Master field list and the "30 report templates" list. That list was later expanded to 39, and it is not known which of the 39 correspond to the original 30.

---

## 1. Status definitions and how the percentages are calculated

| Status | Meaning |
|---|---|
| **Complete** | Built, server-enforced, DB-tested **and** driven through the real UI in a *passing* browser round (R1 34/34, R2 140/140, R3 201/201). Pure server rules with no UI (e.g. cycle prevention, auto-end on exit) count as Complete when a DB test covers them. |
| **Not Verified** | Built and DB-tested, but no *passing* browser round drives the workflow in the UI. Everything covered **only by Round 4** is in this group, because Round 4 never completed (§2). Items that can only be proven on real Supabase also go here. |
| **Partial** | Built, but part of the requirement is missing or defective. |
| **Missing** | Not built. |
| **Not Applicable** | Category C: an optional AIMS ERP feature the company has not asked for. **Excluded from every denominator.** |

**Classification:**
- **A.** Explicitly requested: the AIMS-reference areas and the 20 areas named in the audit request.
- **B.** Existing Zyllo Tech features we agreed to retain.
- **C.** Optional AIMS ERP or industry features that are not required. C items are listed, not counted.

**Formulas** (applicable requirements = A + B rows; C excluded):
- *Implementation coverage* = (Complete + Not Verified + ½ × Partial) ÷ applicable. "How much is built."
- *Verified completion* = Complete ÷ applicable. "How much is proven end to end."

---

## 2. Test status (from logs; nothing was started or interrupted)

**No test suite is running now.**
- The harness state file `%TEMP%\zyllo-hrms-local.json` (started 2026-11-03 10:03 UTC) names supervisor/API/web PIDs 17016, 25848 and 10236. None of them is alive.
- No `node.exe` or headless Chrome is running.
- The 7 `postgres.exe` processes belong to the Windows PostgreSQL **service** (session "Services"), not to the harness cluster.
- Last browser activity: round 4 profile folders `%TEMP%\hrms-flow4-*`, the newest at 2026-11-03 17:02.
- No application, migration or script file has changed since `LOCAL_TEST_REPORT.md` was last updated (2026-11-04 10:21).

| Suite | Latest result | Completed? | Evidence |
|---|---|---|---|
| DB module tests (100–112) | 774/774 | Yes (with 113–116 applied) | `LOCAL_TEST_REPORT.md` §12 |
| DB module tests (113–116) | 163/163 | Yes (run per file) | same |
| DB seed smoke | 55/55 | Yes | same |
| `npm test` | 45/45 | Yes, but **not re-run** after the last test-script edits | §12.1 |
| `vite build` | PASS | Same caveat | §12.1 |
| Harness selftest | 94/94 | Yes | §12.1 |
| Browser round 1 | 34/34 | Yes | §12; `%TEMP%\hrms-flows\flows.json` (the only saved results JSON) |
| Browser round 2 | 140/140 | Yes. Four workflows passed only on individual re-runs (timing) | §12.1. No results JSON saved |
| **Browser round 3** | **201/201** | **Yes** (one full run) | §12.1. No results JSON saved; screenshots `wf3-*.jpg` |
| **Browser round 4** | **49 pass / 6 fail** on the first run | **No.** 4 failures were test-expectation fixes that were never re-run. **2 training checks are still open** (assign → self-complete → verify). The harness was reaped for low memory | §12.1. The `%TEMP%\hrms-flows4\` results folder is **empty**; screenshots `wf4-*.jpg` exist |
| **Page crawl (desktop + mobile)** | Last run 2026-11-02 | **No.** It has not been re-run since migrations 113–116 and the new pages (Org Structure, Benefits, Training, My Benefits, My Training, regrouped settings) | `%TEMP%\hrms-crawl-5WbXVB` (2026-11-02 16:15) |
| Real Supabase (Auth invite, Storage, Edge Functions, email, cron) | — | **Never run.** No dev project exists (`.env.hr-dev.local` is absent) | `DEPLOYMENT.md` §1 |

---

## 3. Scorecard

| Module | Class | Applicable | Complete | Not Verified | Partial | Missing | N/A (excluded) |
|---|---|---|---|---|---|---|---|
| 1 HR Dashboard | A | 9 | 0 | 7 | 2 | 0 | 0 |
| 2 Employee Master | A | 25 | 5 | 17 | 3 | 0 | 0 |
| 3 Org Structure | A | 7 | 1 | 5 | 0 | 1 | 0 |
| 4 Leave Management | B | 10 | 5 | 4 | 1 | 0 | 1 |
| 5 Attendance & Time | B | 8 | 4 | 0 | 3 | 1 | 1 |
| 6 Payroll | B (+A banking) | 10 | 3 | 4 | 3 | 0 | 2 |
| 7 Benefits | A | 8 | 1 | 5 | 1 | 1 | 0 |
| 8 Visa & Documents | A | 10 | 4 | 3 | 2 | 1 | 1 |
| 9 Recruitment | B | 10 | 4 | 3 | 1 | 2 | 1 |
| 10 Training | A | 9 | 0 | 6 | 1 | 2 | 0 |
| 11 Performance | B | 8 | 5 | 3 | 0 | 0 | 1 |
| 12 HR Reports (cross-cutting) | A | 7 | 2 | 0 | 5 | 0 | 0 |
| 13 HR Requests | A | 12 | 7 | 0 | 2 | 3 | 1 |
| 14 HR Settings | A | 9 | 4 | 4 | 1 | 0 | 0 |
| 15 Employee Portal | A | 14 | 7 | 6 | 0 | 1 | 0 |
| 16 Daily Work Reports | B | 7 | 5 | 2 | 0 | 0 | 0 |
| 17 Intern Management | B | 6 | 0 | 4 | 0 | 2 | 0 |
| 18 Announcements | B | 4 | 2 | 2 | 0 | 0 | 0 |
| 19 Asset Management | B | 3 | 1 | 2 | 0 | 0 | 0 |
| 20 Exit Management | B | 6 | 2 | 1 | 3 | 0 | 0 |
| X Cross-cutting (security, infra, notifications) | A/B | 9 | 2 | 3 | 2 | 2 | 0 |
| — Optional extras (Arabic UI, workflow designer, bank payments) | C | 0 | — | — | — | — | 3 |
| **Total** | | **191** | **64** | **81** | **30** | **16** | **10** |

**Results:**
- Total applicable requirements: **191** (10 category-C items excluded).
- Fully implemented and verified (Complete): **64**.
- Built, not yet verified: **81**.
- Partially implemented: **30**.
- Missing: **16**.
- **Implementation coverage = (64 + 81 + 15) ÷ 191 = 160 ÷ 191 = 83.8 %**.
- **Verified completion = 64 ÷ 191 = 33.5 %**.
- Built in any form (everything except Missing) = 175 ÷ 191 = 91.6 %.

**Why verified completion is low.** 81 items are built and DB-tested, but no *passing* browser run proves them, mostly because Round 4 and the crawl never finished. About 35 of those 81 are checked by `browser-flows-4.mjs`. One clean Round 4 run and a crawl would lift verified completion to roughly 50 %. That is an estimate; actual results depend on the run. The rest need new browser checks or real Supabase.

**The 39 reports are scored separately in §5:** 7 Complete, 9 Partial, 23 Not Verified, 0 Missing. They are represented in the main count by the 7 cross-cutting report requirements in module 12, so that 39 rows do not swamp the other modules.

---

## 4. Detailed requirements table

Priority: **P0** = blocker for approval or go-live · **P1** = finish before approving the HRMS · **P2** = can follow approval.

### 4.1 HR Dashboard (A)

| # | Original requirement | Current implementation | Evidence | Status | Remaining work | Pri |
|---|---|---|---|---|---|---|
| D1 | Headcount KPIs: total, active, interns, probation, notice, contracts ending, new joiners, deployed | `hr_dashboard` wrapper → `hr_private.hr_dashboard_core` | 112:75-80, 116:132-135; tests 116:42-50 | Not Verified | R4 "Total employees = DB" failed on label case; the test was fixed but not re-run | P1 |
| D2 | Filters: company, period, department, type, manager, status | Company passed via a GUC into `scoped_employees`; period capped at 366 days | 116:19-32, 112:62-63; `HrDashboardPage.jsx` | Not Verified | Drive the filters in a passing round | P1 |
| D3 | Breakdowns by company, location, employment type, grade, work arrangement, tenure | 116 sections | 116:137-158; tests 116:47-51 | Not Verified | Same | P1 |
| D4 | Nationality / gender mix (sensitive) | Null without `employees.view_sensitive` | 116:162-208; test 116:61-65 | Not Verified | — | P2 |
| D5 | Deployment by status / client | 116 section | 116:149-158 | Not Verified | — | P2 |
| D6 | Data-completeness scorecard | `completeness_rows()` (one pass) | 116:61-96 | Not Verified | — | P2 |
| D7 | Operational KPIs: attendance today, leave, daily reports, requests, recruitment, documents expiring, birthdays, events | 112 core, each gated by permission (null hides the card) | 112:85-232; 54 assertions | Not Verified | The page changed after the last crawl | P2 |
| D8 | KPIs respect the filters | HR-request and recruitment counts ignore department/company/manager | 112:144, 152-153 | Partial | Scope them, or label them "company-wide" | P2 |
| D9 | Live analytics visualisation | Simple CSS bars; no chart library | `HrDashboardPage.jsx` `Bars` | Partial | Decide whether real charts are required | P2 |

### 4.2 Employee Master (A): field-by-field

The form is `src/hr/components/EmployeeForm.jsx` and the profile is `src/hr/pages/EmployeeDetail.jsx`. Data access is in `src/lib/hr/employees.js`. The employee's own view is `src/employee/pages/MyProfilePage.jsx`.

| # | Field group / requirement | In UI | Stored (table.column) | Editable | Validated (client / DB) | Permissions | Employee Portal | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| EM1 | Employee ID | Yes, read-only | `hr_employees.employee_code` (unique, sequence) | No (immutable) | Server-generated | — | Yes | 100; R1 "create (ZT-NNNN)" | Complete | — | — |
| EM2 | First / last / display name | Yes | `hr_employees.first_name/last_name/display_name` | HR; employee edits display name only | Yes / CHECK length | `employees.edit` | Yes (self-edits display name) | Form:184-186; R1 create | Complete | — | — |
| EM3 | Name in Arabic | Yes (RTL input) | `hr_employees.name_arabic` (113:133) | HR | ≤120 / CHECK | `employees.edit` | **No.** Not shown on My Profile | Form:187; R4 only | Not Verified | Show on My Profile if wanted | P2 |
| EM4 | Gender, date of birth, nationality (ISO-2), marital status | Yes, only with `view_sensitive` | `hr_employee_private.*` (100:353, 113:191) | HR (`view_sensitive` + `edit`) | DOB not in future, ISO-2 / CHECKs | RLS: self or `view_sensitive` | Shown; not self-editable | Form:188-193; R4:260 (failed on regex wording, test fixed, not re-run) | Not Verified | Re-run R4 | P1 |
| EM5 | Photograph | On the profile (avatar modal) | `hr_employees.photo_path` + private `hr-avatars` bucket | HR; employee via My Documents | PNG/JPEG/WebP ≤ 2 MB | `hr_set_employee_photo` / `hr_set_my_photo` | Yes | EmployeeDetail:272-298 | Not Verified | Drive the upload; real Storage | P2 |
| EM6 | Company (work) email | Yes, required on create | `hr_employees.company_email` (citext UNIQUE) | HR; locked once linked to an account | Regex / CHECK + UNIQUE; friendly duplicate check | `employees.edit` | Yes | Form:199-201; R1 "duplicate email rejected" | Complete | — | — |
| EM7 | Personal email, mobile, address (line 1/2, city, state, postal code, **country**), emergency contact (name, relation, phone) | Yes, except **address country**, which has no input | `hr_employee_private.*` | HR; employee via `hr_update_my_contact` | Email/phone regex / CHECK | Self or `view_sensitive` | Yes (self-edit) | Form:202-213; employees.js:68 lists `country` but the form has no field (default `IN`) | Partial | Add an address-country field (needed for AE staff) | P1 |
| EM8a | Department, designation, employment type, location, shift, manager, joining, probation end, status | Yes | `hr_employees.*` | HR; exit/archive go through workflows | Probation ≥ joining; manager cycles rejected (DB) | `employees.edit`; guard trigger 100:648-675 | Yes | Form:219-237; R1 create/list/filter | Complete | — | — |
| EM8b | Company / legal entity, source department, grade / band, work arrangement (WFO/WFH/hybrid) | Yes | `hr_employees.legal_entity_id/source_department_id/grade_id/work_arrangement` (113:130-134) | HR | Source ≠ department / FK + CHECK | `employees.edit` | Company, grade and arrangement shown; source department not shown | Form:218-227; R4:276, 285, 295-297 | Not Verified | Re-run R4 | P1 |
| EM9 | Deployment: status, client, project/job number, start/end | Yes (optional section) | `hr_employees.deployment_*` (113:137-144) | HR | Client required when deployed; dates ordered / DB constraint | `employees.edit` | Status, client and project shown; dates not shown | Form:240-249; R4:260 | Not Verified | — | P1 |
| EM10 | Contract: type, start, end, notice period (0–365) | Yes | `hr_employees.contract_*`, `notice_period_days` | HR | End ≥ start; 0–365 / CHECK | `employees.edit` | Type, end and notice shown; start not shown | Form:251-256 | Not Verified | — | P1 |
| EM11 | HR remarks (confidential) | Yes, only with `view_sensitive` | `hr_employee_confidential.remarks` (113:244) | HR | ≤ 4000 / CHECK | RLS: `view_sensitive` only; never the employee or manager | Hidden (correct) | Form:257-261; R4:312 | Not Verified | — | P1 |
| EM12 | Identification: national ID type/number/expiry, passport number/country/issue/expiry, work permit type/number/expiry, visa type/number/expiry | Yes, only with `view_identity` | `hr_employee_identity.*` (113:197-219) | HR (`view_identity` + `edit`) | Format regexes / CHECK; expiry > issue | RLS: self or `view_identity`; numbers redacted in the audit log | Masked (last 4) **in the UI only**; the API returns full numbers to self | Form:264-290; R4:276-312 | Not Verified | Re-run R4; decide on server-side masking (§7.3) | P1 |
| EM13 | Country identity rules (required documents, foreign-national rules) | Info box in the form; Settings tab | `hr_identity_requirements` (seeded IN, AE) | `settings.manage` | CHECK | — | — | Form:267-273; 113:64-96 | Not Verified | Add rules for other countries if needed | P2 |
| EM14 | Banking: bank name, holder, account number, IFSC, IBAN, SWIFT, branch, primary | Profile "Banking & payroll" tab (payroll users) | `hr_employee_bank_accounts` (105:189, 113:269-271) | `payroll.manage` | IFSC/IBAN/SWIFT regex / CHECK; one primary | RLS `payroll.view`; HR admins excluded; number + IBAN redacted in audit | **Not visible** to the employee | EmployeeDetail:355-360, form at ~400; R4:327 | Not Verified | — | P1 |
| EM15 | Payroll identifiers: payment mode, tax ID, social security / UAN, pension, health insurance, WPS ID, payroll code | Same tab, masked | `hr_payroll_employee_identifiers` (113:276-298) | `payroll.manage` | Regex / CHECK; tax ID UNIQUE | RLS `payroll.view`; redacted in audit | Not visible | EmployeeDetail:370-392; R4:315, 319 | Not Verified | Blank means "keep", so a stored number **cannot be cleared**; full values are loaded into the browser despite the code comment | P2 |
| EM16 | Exit information on profile (type, status, resignation, last working day, reason, clearance) | Profile "Exit" tab | Read from `hr_exits` and clearance items (no second copy) | Via Exit Management | — | `exit.view*` | Via the resignation in My HR Requests | EmployeeDetail:444-460 | Not Verified | — | P2 |
| EM17 | Duplicate passport / national ID prevented | Friendly check plus unique indexes | 113:218-219 | — | Yes | — | — | Form:91-96; R4:303 | Not Verified | — | P1 |
| EM18 | Field-level separation: PII, identity, remarks, payroll | Fields not rendered without permission; RLS on each table | 100:678-685, 113:233-298 | — | — | DB tests 100, 113 | — | R4:283, 312-319 | Not Verified (UI); server side DB-tested | Re-run R4 | P1 |
| EM19 | Change history (legal entity, grade, arrangement, deployment, contract) | History tab | `hr_employee_history` (new change types, 113:150-189) | Triggers only | — | `can_access_employee` | — | R4:295 | Not Verified | — | P2 |
| EM20 | Record completeness score | Profile card and dashboard | `completeness()` = `completeness_rows()` | — | — | Counts only fields the viewer may see | — | employees.js:162-175 | Not Verified | — | P2 |
| EM21 | Bulk import | `hr_import_employees` (dry run, all-or-nothing) | 100:1036-1150 | — | Yes | `employees.create` | — | test 100b (9) | Partial | Import **does not accept** company, grade, arrangement, deployment, contract type, notice or identity | P1 |
| EM22 | List, search, filters (dept, status, type, manager, company, location, grade), pagination | Server-side paging | employees.js:19-36 | — | — | Manager sees reporting line | — | R1: search 16 → 6, manager 11 of 16 | Complete | — | — |
| EM23 | Portal invitation, enable/disable access, roles | Access & roles tab; `hr-invite-employee` Edge Function | 100; functions/hr-invite-employee | — | — | `employees.invite`, `roles.manage` | Activation page | R1 invite via the **local stand-in** only | Not Verified | Run on real Supabase Auth | P0 |
| EM24 | Employee sees an appropriate view of their own master record | My Profile: employment, personal and contact, masked identity | MyProfilePage:31-77 | Contact fields only | Yes | RLS self | — | R4:333 (failed on label case) | Partial | Not shown: Arabic name, source department, contract start, deployment dates, own bank account (masked). Decide what the employee should see | P2 |

### 4.3 Org Structure (A)

| # | Requirement | Implementation | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|---|
| O1 | Legal entities (companies) | `hr_legal_entities`; Settings tab | 113:37-96; tests 113:38-49 | Not Verified | Drive create/edit | P1 |
| O2 | Units tree, table and drill-down with direct and rolled-up headcount | `OrgStructurePage.jsx` (read-only) | page:58-89; R4 `wfOrg` | Not Verified | Re-run R4 | P1 |
| O3 | Unit types (division/department/unit/team) and parent | Settings → Departments | 113:103; SettingsPage:71-79 | Not Verified | — | P2 |
| O4 | **Unit head** | Column read and flagged by checks, but **no field sets it** | SettingsPage.jsx:76-79 (no `head_employee_id` field) | **Missing** | Add a head picker | P1 |
| O5 | No circular units / reporting lines | Triggers | 113:107-123, 100:427-445; tests 113:59, 63 | Complete | — | — |
| O6 | Reporting hierarchy with search; manager sees own line only | RLS-scoped | page; R4:354, 376 (376 failed first run; test fixed) | Not Verified | Re-run R4 | P1 |
| O7 | Hierarchy checks (no manager/department/company, inactive unit with staff, unit without head) | Client-side checks | page:244-256; R4:356 | Not Verified | — | P2 |

### 4.4 Leave Management (B)

| # | Requirement | Implementation | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|---|
| L1 | Apply with validation (overlap, balance, half day, probation, backdating, document threshold) | `hr_apply_leave` 103:371 | test 103; R1; R3 wfLeave | Complete | — | — |
| L2 | Manager → HR approval; team scope; no self-approval | `hr_decide_leave` 103:480 | R3 (self-approve refused; manager cannot give HR approval) | Complete | — | — |
| L3 | Reject with note; pending balance released | same | R3 | Complete | — | — |
| L4 | Clarification request and reply | 103:547/561 | test 103:99-112; not in any browser round | Not Verified | UI flow | P1 |
| L5 | Cancel / withdraw (employee; HR any) | `hr_cancel_leave` 103:587 | R3 (employee only) | Not Verified (HR path) | Drive HR cancel | P2 |
| L7 | Balance adjustment with reason | 103:635 | R3 | Complete | — | — |
| L8 | Leave-year initialisation and carry-forward | 103:670; Leave year tab | test 103 | Not Verified | Drive in UI; schedule or document the year-end run | P1 |
| L9 | Supporting document | Free-text reference only, not an upload | MyLeavePage:202; 103:428 | Partial | Link to `hr_documents` or upload | P1 |
| L10 | Holidays, leave types | Settings | R3 | Complete | — | — |
| L11 | Team leave calendar | `hr_leave_calendar` | test 103 | Not Verified | — | P2 |
| L6 | Edit a pending request | Not built (cancel and re-apply; `draft` status unused) | — | N/A (C) | Optional | — |

### 4.5 Attendance & Time (B)

| # | Requirement | Implementation | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|---|
| A1 | Check in / out, server time, no duplicate punch | 101:228/245 | R2 wfAttendance | Complete | — | — |
| A2 | Late, early, overtime and worked hours from shift | `attendance_compute` | R2 | Complete | — | — |
| A3 | HR manual entry with note; own record blocked | 101:473 | R2 | Complete | — | — |
| A4 | Missing-punch marking | 101:314; manual button works | R2 | Partial | **Daily job not scheduled** | P0 |
| A5 | Correction request, approve, reject, cancel | 101:369-456 | R2 (approve path) | Complete | Reject/cancel not driven (P2) | — |
| A6 | Correction routed to an approver | Notifies only `my_manager_id()`; nobody if no manager | 101:400 | Partial | Fall back to `attendance.approve` holders | P1 |
| A7 | Absent / on-leave days materialised (feeds LOP) | Not built | 101, 105:80 | **Missing** | Daily job | P1 |
| A8 | Login event tracking | `hr_record_login_event` has no caller | 101:526 | Partial | Wire it up or remove it | P2 |
| A9 | Overtime approval, geo/IP punch | — | — | N/A (C) | — | — |

### 4.6 Payroll (B, banking enhancement A)

| # | Requirement | Implementation | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|---|
| P1 | Run Draft → Calculated → Reviewed → Approved → Finalized → Paid, separation of duties, locks | 105:501-800 | test 105; R2 wfPayroll | Complete | — | — |
| P2 | Calculation: structures, LOP, proration; unverified statutory components skipped | 105:525 | test 105:55-109; R2 | Complete | — | — |
| P3 | Payslips for the employee (RLS, print) | MyPayslipsPage | R1, R2 | Complete | Print only, no PDF file (P2) | — |
| P4 | Adjustments with reason | 105:692 | test 105 | Partial | **A payroll admin can add an adjustment to their own pay** (no self-check) | P1 |
| P5 | Corrections after finalization | 105:821 | test 105 | Not Verified | UI flow | P1 |
| P6 | Reimbursements (submit, decide, pay through the run) | 105:416/438 | test 105 | Partial | Receipt is free text, not an upload; UI not driven | P1 |
| P7 | Salary components and statutory verification | 105:111; Settings | test 105 | Not Verified | Statutory values need professional sign-off | P0 |
| P8 | Salary structures | PayrollPage | R2 uses fixtures | Not Verified | UI flow | P1 |
| P11 | Bank account verification | `verified` column, no action | 105:197-199 | Partial | Add a verify action or drop it | P2 |
| P12 | Payroll identifiers used in output | Stored only (see EM15) | 105:525 | Not Verified | Decide whether payslips or exports show them | P2 |
| P10 | WPS / bank payment file; bank payments | Not built (CSV of run items only) | PayrollPage:194 | N/A (C) | Only if UAE WPS is required | — |

### 4.7 Benefits (A)

| # | Requirement | Implementation | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|---|
| B1 | Plan catalogue (category, provider, eligibility, contributions, frequency, dependants) | `hr_benefit_types`; page and Settings | 114; test 114 | Not Verified | Drive create | P2 |
| B2 | Eligibility, override with reason | `hr_benefit_eligibility` | test 114; R4:399 | Not Verified | Re-run R4 | P1 |
| B3 | Enroll; no self-enrollment; one live enrollment per plan | `hr_enroll_benefit` | R4:408 | Not Verified | — | P1 |
| B4 | Suspend / resume / end / cancel with reason | `hr_set_benefit_enrollment_status` | R4:413-416 (suspend only) | Not Verified | — | P2 |
| B5 | Edit an enrollment (coverage, dependants, policy number) | No RPC, no update policy | 114 | **Missing** | Update RPC | P1 |
| B6 | My Benefits | Read-only | R4:425 | Not Verified | — | P1 |
| B7 | Auto-end on exit | Trigger | test 114:93-96 | Complete | — | — |
| B8 | Contributions feed payroll | Stored, never read by the payroll calculation | 105:525, 114:32-51 | Partial | **Design decision** (deduction / employer cost) | P1 |

### 4.8 Visa & Documents (A)

| # | Requirement | Implementation | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|---|
| V1 | HR upload to a private bucket; type/size checks | `hr_register_document_upload` | R2 wfDocuments | Complete | Real Storage not run (X4) | — |
| V2 | Employee self-upload (allowed categories) | MyDocumentsPage | test 107 | Not Verified | UI flow | P1 |
| V3 | HR notified when an employee uploads | Only HR → employee uploads notify | 107:394 | **Missing** | Notify `documents.manage` | P1 |
| V4 | Signed-URL download and access log | `hr_log_document_access` | R2 | Complete | — | — |
| V5 | Verify / reject (own document blocked) | 107:469 | R2 (verify) | Complete | Reject not driven (P2) | — |
| V6 | Versions, archive | 107:403/509 | test 107 | Not Verified | — | P2 |
| V7 | Checklist, expiring list | RPCs | test 107; crawl (old) | Not Verified | — | P2 |
| V8 | Document expiry reminders (in-app + email) | 107:547; manual button | test 107 | Partial | **Cron not scheduled** | P0 |
| V10 | Identity (passport/visa/permit) expiry reminders | 113:371 (in-app only) | test 113 | Partial | No UI trigger; **not in the DEPLOYMENT cron list**; no email | P0 |
| V12 | Passport / work permit / visa / national ID / training certificate categories | Seeded categories | 113, 115 | Complete | — | — |
| V11 | Visa application / renewal workflow | Not built | — | N/A (C) | — | — |

### 4.9 Recruitment (B)

| # | Requirement | Implementation | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|---|
| R1 | Create / publish openings | 104:561/600 | test 104 | Not Verified | UI flow | P1 |
| R2 | Import careers-site applications | 104:647 | test 104 | Not Verified | — | P1 |
| R3 | Candidates and stage machine (illegal jumps refused) | 104:616/711 | R2 wfRecruitment | Complete | — | — |
| R4 | Interviews with panel | 104:743 | R2 | Complete | — | — |
| R5 | Panel feedback | 104:781; My Interviews | test 104; R1 render only | Not Verified | UI flow | P1 |
| R6 | Offers: create → send → response | 104:805-867 | R2 | Complete | — | — |
| R8 | Offer letter document / email to candidate | Not built ("mark as sent" only) | 104 | **Missing** | — | P1 |
| R9 | Convert candidate to employee | 104:907 | R2 | Complete | — | — |
| R10 | Stage synced to legacy `job_applications.status` | Not written back | IMPLEMENTATION_REPORT §2 | Partial | — | P2 |
| R11 | HR résumé upload | Not built | IMPLEMENTATION_REPORT §2 | **Missing** | — | P2 |
| R7 | Offer approval chain | Not built | 104:831 | N/A (C) | Only if company policy requires it | — |

### 4.10 Training (A)

| # | Requirement | Implementation | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|---|
| T1 | Categories and courses (mode, hours, mandatory, pass score, certificate, validity) | 115; TrainingPage | test 115 | Not Verified | — | P2 |
| T2 | Bulk assign (HR any; manager own line; never self) | `hr_assign_training` 115:129 | R4:449 **FAILED, open** | Not Verified | **Re-run `--only training`; find out whether it is timing or a UI defect** | P0 |
| T3 | Employee start and self-complete (stays unverified) | 115 | R4:460-462 failed/blocked | Not Verified | Same | P0 |
| T4 | HR/manager records completion (pass mark, certificate) | `hr_complete_training` 115:173 | test 115 | Not Verified | — | P1 |
| T5 | Verify a self-reported completion | 115:219 | R4:471 | Not Verified | — | P1 |
| T6 | Verifier notified of self-completion | Not notified | 115:~212 | **Missing** | Notify manager / HR | P1 |
| T7 | Certificate attachment | Must be uploaded in Documents first; no upload in the dialog | AIMS §13 | Partial | — | P2 |
| T8 | Overdue / certificate-expiry reminders | Display only | training.js:13 | **Missing** | Job | P2 |
| T9 | Cancel with reason | `hr_cancel_training` | test 115 | Not Verified | — | P2 |

### 4.11 Performance (B)

| # | Requirement | Implementation | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|---|
| PF1 | Review cycles (start via RPC) | 106:405 | R3 wfPerformance | Complete | — | — |
| PF2 | Goals / KPIs, weight ≤ 100 % | trigger | R3 | Complete | — | — |
| PF3 | Self → manager assessment | 106:438/461 | R3 | Complete | — | — |
| PF4 | Scores, finalize; ratings hidden until final | 106:485-508 | R3 | Complete | — | — |
| PF5 | Feedback with visibility | triggers | R3 | Complete | — | — |
| PF6 | Improvement plans (PIP) | PerformancePage:526 | test 106 | Not Verified | UI flow | P1 |
| PF7 | KPI definitions | Settings | test 106 | Not Verified | — | P2 |
| PF9 | Close cycle | direct update | test 106 | Not Verified | — | P2 |
| PF8 | Return review / employee acknowledgement or dispute | Not built | — | N/A (C) | — | — |

### 4.12 HR Reports: cross-cutting (A). The 39 individual reports are in §5.

| # | Requirement | Implementation | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|---|
| RP1 | 39 templates in 14 reference categories, every one with a working data source | UI list = SQL (17 core + 22 new); all tables exist | ReportsPage.jsx:18-57; 112:269-445; 116:226-229; every report executes in tests 112/116/seed | Complete | Confirm the mapping to the original 30 AIMS templates (needs the original analysis) | P1 |
| RP2 | Correct calculations | Only 7 of 39 have a numeric assertion; several logic concerns (§5) | §5 | Partial | Fix the concerns; add value assertions | P1 |
| RP3 | Filters, including company on every report | `recruitment_pipeline` ignores company, manager and type; `payroll_summary` lists runs whatever the filter | 112:381-383, 405-407 | Partial | Fix, or label as company-wide | P1 |
| RP4 | Role permissions | View gating correct (SECURITY INVOKER + permission checks). **`reports.export` is enforced only in the UI**; absence and daily-report compliance return empty instead of refusing; attendance summary returns zeros | ReportsPage:116; 112:298, 323, 355 | Partial | Export is a UI-only control (the data is already viewable); fix the misleading zeros | P1 |
| RP5 | CSV export | Exports all rows; formula-injection guard **turns negative numbers into text** (`'-5`) | client.js:84 | Partial | Exempt numeric values | P2 |
| RP6 | Print / PDF | `window.print()` prints only the **50-row page on screen** | ReportsPage:117, 128; ui.jsx:311 | Partial | Print view with all rows | P1 |
| RP7 | Empty states | "No records for these filters"; buttons disabled | ReportsPage:130 | Complete | — | — |

### 4.13 HR Requests (A)

| # | Requirement | Implementation | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|---|
| HR1 | Create with category, subject, description, priority | 111:182 | R3 wfRequests | Complete | — | — |
| HR2 | SLA due date and overdue highlight | 111:26, 199 | R3 | Complete | — | — |
| HR3 | Status lifecycle (resolution required) | 111:274-309 | R3 | Complete | — | — |
| HR4 | Assignment | 111:246 | R3 | Complete | — | — |
| HR5 | Replies and internal notes (hidden from requester) | 111:206-244 | R3 | Complete | — | — |
| HR6 | Confidential (grievance) | `request_can_view` | R3 | Complete | — | — |
| HR7 | Close / reopen / cancel | 111:312-359 | R3 | Complete | Client hardcodes 7 days; server setting is configurable (P2) | — |
| HR8 | SLA breach notification / escalation | Not built | — | **Missing** | Job | P2 |
| HR9 | Reference types: profile update, travel, benefits, training | Categories only (free text; no dates, amounts or approval) | 116:446-460 | Partial | Structured fields where needed | P1 |
| HR10 | Letter / certificate generation (salary letter, NOC, experience) | Category only, no document output | 116:461 | **Missing** | Templates and generated documents | P1 |
| HR11 | Payroll queries routed to payroll admins | Routed to `payroll_admin`, **which has no `hr_requests.*` permission**, so they cannot see these requests | 111:36; 100:288-290 | Partial (defect) | Grant or scope by category | P1 |
| HR12 | Attachments on requests | Not built | — | **Missing** | — | P2 |
| HR13 | Loans / salary advances | Category inactive by default | 116:457 | N/A (C) | — | — |

### 4.14 HR Settings (A)

| # | Requirement | Implementation | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|---|
| S1 | Grouped settings (Organisation / Time, leave & approvals / Pay, benefits & talent / Compliance, requests & access) | SettingsPage | R4:517 | Not Verified | — | P2 |
| S2 | Company, employee ID, departments, designations, locations, shifts, employment types | MasterDataEditor under RLS | R3 1048-1164 | Complete | Company and employment-type tabs not driven (P2) | — |
| S3 | Legal entities, grades & bands, identity rules | same | R4:517-526 | Not Verified | — | P1 |
| S4 | Leave types, holidays, module rules (approval flows) | same | R3 1100-1150 | Complete | — | — |
| S5 | Salary components, benefit plans, training categories, review cycles, KPIs, projects | same | none | Not Verified | — | P2 |
| S6 | Document categories, HR request categories | same | none | Not Verified | — | P2 |
| S7 | Notification templates | Editable, but **no code reads them**; all messages are inline text | 100:820-832 | Partial | Use the templates or remove the tab | P1 |
| S8 | Roles & permissions (system roles immutable) | `hr_roles` / `hr_role_permissions` | R3 1204-1224 | Complete | — | — |
| S9 | Audit log (paginated) | `hr_audit_log` | R1, R3 | Complete | — | — |

### 4.15 Employee Portal (A)

| # | Page / requirement | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|
| EP1 | Dashboard (today, balances, payslip, notifications) | R1 landing only | Not Verified | — | P2 |
| EP2 | My Profile and contact self-edit | R4:333 failed on label case | Not Verified | Re-run R4 | P1 |
| EP3 | My Attendance | R1, R2 | Complete | — | — |
| EP4 | My Leave | R1, R3 | Complete | — | — |
| EP5 | My Payslips | R1, R2 | Complete | Reimbursement submit not driven (see P6) | — |
| EP6 | My Documents | R2 | Complete | — | — |
| EP7 | My Benefits | R4 | Not Verified | — | P1 |
| EP8 | My Training | R4 **failing** | Not Verified | See T2/T3 | P0 |
| EP9 | My Performance | R3 | Complete | — | — |
| EP10 | My Announcements | R2 | Complete | — | — |
| EP11 | My HR Requests | R1, R3 | Complete | — | — |
| EP12 | My Assets (acknowledge, request, report damage) | R2 acknowledge only | Not Verified | Request/damage flows | P2 |
| EP13 | My Tasks, Notifications, My Internship, My Interviews | crawl / R1 render | Not Verified | — | P2 |
| EP14 | Own bank and payroll details (masked) | Not visible to the employee | **Missing** | Decide; common in self-service portals | P2 |

### 4.16 Daily Work Reports (B)

| # | Requirement | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|
| DR1 | Draft → submitted → under review → reviewed / revision requested | R3 wfReports | Complete | — | — |
| DR2 | 24 h cap, no future dates, at least one item | R3 | Complete | — | — |
| DR3 | Review comments, no self-review, team scope | R3 | Complete | — | — |
| DR4 | Reply thread | R3 | Complete | — | — |
| DR5 | Missing-report compliance and reminders | R3 | Complete | Needs cron (X3) | — |
| DR6 | Projects, tasks, members; employee task status | DB only | Not Verified | — | P2 |
| DR7 | Blockers report | DB only | Not Verified | — | P2 |

### 4.17 Intern Management (B)

| # | Requirement | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|
| I1 | Internship records (intern type, one active, mentor ≠ intern) | 104:166-189; crawl only | Not Verified | UI flow | P1 |
| I2 | Mentor evaluations draft → finalized; intern sees finalized | 104:199-215, 386-410 | Not Verified | — | P1 |
| I3 | **Internship certificate issue** | Only an "eligible" checkbox; nothing sets `certificate_issued_at` and no document is produced | **Missing** | Issue action plus certificate document | P1 |
| I4 | Convert intern to employee | 104:974; ConvertInternModal | Not Verified | — | P1 |
| I5 | "Intern Management" navigation entry and alias | R4:511 | Not Verified | — | P2 |
| I6 | End-date reminders | — | **Missing** | — | P2 |

### 4.18 Announcements (B)

| # | Requirement | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|
| AN1 | Draft → publish, department audience, published locked | R2 | Complete | — | — |
| AN2 | Read and acknowledgement receipts | R2 | Complete | — | — |
| AN3 | Scheduled publish, archive | 108; not driven | Not Verified | Cron (X3) | P2 |
| AN4 | Email fan-out with real delivery status | 108:183; needs provider | Not Verified | Real Supabase plus provider | P1 |

### 4.19 Asset Management (B)

| # | Requirement | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|
| AS1 | Inventory, assign, acknowledge, return | R2 wfAssets | Complete | — | — |
| AS2 | Transfer, damage, maintenance, status | DB test 109 | Not Verified | — | P2 |
| AS3 | Employee request → HR decide → fulfil | DB test 109 | Not Verified | UI flow | P1 |

### 4.20 Exit Management (B)

| # | Requirement | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|
| EX1 | HR-initiated exit through clearance, settlement and close (portal off, roles removed, history kept) | R2 wfExit | Complete | — | — |
| EX2 | Employee resignation → manager review → HR review; withdraw | DB test 110 | Not Verified | UI flow | P1 |
| EX3 | Clearance checklist; asset return gate | R2 | Complete | — | — |
| EX4 | Sign-in access revocation | Edge Function run **only as a local stand-in**. The `access_revocation` item **can be marked "not applicable" and skip the ban** (110:388-391) | Partial | Block N/A when a linked user exists; test on real Supabase | P1 |
| EX5 | Exit letters (relieving, experience) | Timestamps only; no document | Partial | Generate documents | P1 |
| EX6 | Final settlement | Free-text notes; no full-and-final calculation | Partial | Payroll link or computation | P1 |

### 4.21 Cross-cutting (A/B)

| # | Requirement | Evidence | Status | Remaining | Pri |
|---|---|---|---|---|---|
| X1 | Server-side authorisation on every table and RPC (RLS, SECURITY DEFINER checks, no self-approval) | 937 DB assertions | Complete | — | — |
| X2 | Email notifications for workflows | Only document expiry and announcements queue email (107:575, 108:183); leave, payroll, recruitment, training and benefits are in-app only | Partial | Decide which events must email | P1 |
| X3 | Scheduled jobs (missing punches, document and identity expiry, daily-report reminders, scheduled announcements, email dispatch, leave year) | **No cron is defined** anywhere; identity expiry is missing from `DEPLOYMENT.md` §5 | **Missing** | Define and schedule | P0 |
| X4 | Real Supabase: Auth invitation, Storage, Edge Functions, CORS | Only local emulation | Not Verified | Dev project run | P0 |
| X5 | Mobile layout (390 px) for all pages | Crawl not re-run on new pages; R4 mobile checks unfinished | Not Verified | Run the crawl with `--mobile` | P1 |
| X6 | Audit log with redaction of identity and bank numbers | tests 113 | Complete | — | — |
| X7 | Private helper functions not callable by API users | 111:368 revokes two helpers, but 113/114/115/116 re-run `grant execute on all functions in schema hr_private to authenticated`, re-granting them | Partial | Re-issue the revokes, or stop blanket grants | P1 |
| X8 | Legacy personal data removed (`server/zyllotech.db`, `src/data/allCandidateEmails.json`) | Not imported, but still tracked in Git | **Missing** | Owner approval for untrack / history purge | P1 |
| X9 | Pagination never shows NaN | DataTable fix; R4:502-506 | Not Verified | — | P2 |

### 4.22 Category C: optional, not counted

| # | Feature | Why optional |
|---|---|---|
| L6 | Edit a pending leave request | Cancel and re-apply works |
| A9 | Overtime approval, geo/IP punch | Not requested |
| P10 | WPS / bank payment file, bank transfers | Only needed for UAE WPS; no bank payments by design |
| V11 | Visa application / renewal workflow | Identity data and expiry reminders cover the need |
| R7 | Offer approval chain | Not company policy so far |
| PF8 | Review return / employee dispute | Not requested |
| HR13 | Loans / salary advances | Category disabled by default |
| C1 | Arabic / RTL localisation of the whole UI | Only the Arabic name is stored |
| C2 | Free-form workflow designer | Fixed, tested approval chains were kept |
| C3 | Bank payment integration | Out of scope by design |

---

## 5. The 39 HR reports, individually

Common to all 39:
- **Security:** SECURITY INVOKER (caller RLS) plus `reports.view` / `reports.view_team`.
- **Export and print:** CSV needs `reports.export` (UI-only); print/PDF via `window.print()`.
- **Empty state:** "No records for these filters".
- **Company filter:** applied through `scoped_employees` unless noted.

**Filters column:**
- **Emp** = the department, direct manager, employment type and company filters apply.
- **D** = both From and To dates are used.

| # | Report (key) | Category | Data source | Calculation / concern | Filters | Extra gate | Test evidence | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | headcount | Workforce | hr_employees, departments | Current headcount by department and type | Emp | — | 112:54, 73; 116:43 | Complete |
| 2 | workforce_by_company | Workforce | employees, legal entities | Count, active, interns, % | Emp | — | 116:68 (one value) | Partial |
| 3 | workforce_by_location | Workforce | locations | Count with WFO/WFH split | Emp | — | executes only | Not Verified |
| 4 | workforce_by_grade | Workforce | grades | Count by grade | Emp | — | executes only | Not Verified |
| 5 | employment_type_breakdown | Workforce | employment types | Count and % | Emp | — | executes only | Not Verified |
| 6 | department_distribution | Workforce | employees, departments | Tenure measured to today, not To; future joiners give negative tenure | Emp | — | executes only | Not Verified |
| 7 | employee_status | Workforce | employees incl. former | All-time count by status | Emp | — | executes only | Not Verified |
| 8 | new_joiners | Workforce | employees | Joiners who already left are excluded (undercount) | Emp + D | — | 116:75, 94 (gating) | Partial |
| 9 | tenure_bands | Workforce | employees | Bands to To date on the current population (mixed basis) | Emp; To | — | executes only | Not Verified |
| 10 | nationality_mix | Diversity | employee_private | Count and % | Emp | view_sensitive | executes only | Not Verified |
| 11 | gender_mix | Diversity | employee_private | Count and % | Emp | view_sensitive | 116:67 (gating) | Partial |
| 12 | age_bands | Diversity | employee_private | Age at To; no % | Emp; To | view_sensitive | executes only | Not Verified |
| 13 | org_units | Org structure | departments | Direct headcount only, no roll-up | Dept/Company | — | executes only | Not Verified |
| 14 | reporting_lines | Org structure | employees | Direct reports per manager | Emp | — | executes only | Not Verified |
| 15 | deployment_summary | Deployment | employees `deployment_*` | Deployed per client | Emp | — | executes only | Not Verified |
| 16 | deployment_roster | Deployment | employees | All deployment statuses | Emp | — | 116:88 | Complete |
| 17 | data_completeness | Compliance | `completeness_rows()` | Filled ÷ total per field | Emp | field-level | executes only | Not Verified |
| 18 | document_expiry | Compliance | hr_documents | No lower bound (every past expiry listed); includes former employees | Emp; To | RLS | executes only | Not Verified |
| 19 | identity_expiry | Compliance | `hr_expiring_identity_documents` | Window relative to today | Emp; To | view_identity | 116:92, 70 | Complete |
| 20 | identity_compliance | Compliance | `identity_missing` | National-ID expiry never checked | Emp | view_identity | 116:89 (loose) | Partial |
| 21 | contract_expiry | Compliance | employees | End date in range | Emp + D | — | executes only | Not Verified |
| 22 | probation_due | Compliance | employees | No status filter: confirmed staff still listed | Emp + D | — | executes only | Not Verified |
| 23 | asset_assignment | Compliance | asset assignments | Leavers' unreturned assets disappear | Emp | RLS | executes only | Not Verified |
| 24 | leave_balances | Leave | leave balances | Year of the To date | Emp; year | RLS | executes only | Not Verified |
| 25 | leave_history | Leave | leave requests | Overlap, all statuses | Emp + D | RLS | 112:58 | Complete |
| 26 | attendance_summary | Attendance | hr_attendance | **Zeros instead of a refusal** without attendance access | Emp + D | none | executes only | Not Verified |
| 27 | late_arrivals | Attendance | hr_attendance | late_minutes > 0 | Emp + D | RLS | 112:55 | Complete |
| 28 | absence | Attendance | date series × attendance/leave/holidays | ≤ 93 days; silent empty without permission | Emp + D | attendance (silent) | 112:56, 74, 61 | Complete |
| 29 | daily_report_compliance | Daily work | daily reports | Mixed day bases; silent empty | Emp + D | daily_reports (silent) | executes only | Not Verified |
| 30 | project_activity | Daily work | report items, projects | Excludes former employees | Emp + D | RLS | executes only | Not Verified |
| 31 | payroll_summary | Payroll | runs, items | Lists draft/cancelled runs and runs with nobody in scope | Items only; D | payroll.view | 112:59, 79 | Partial |
| 32 | recruitment_pipeline | Recruitment | openings, applications | **Ignores company, manager, type and From** | Dept; To | recruitment | 112:75 (gating) | Partial |
| 33 | intern_progress | Recruitment | internships, evaluations | Exited interns excluded | Emp + D | RLS | executes only | Not Verified |
| 34 | training_completion | Training | courses, assignments | % mixes time bases; failed results counted as completed | Emp; D (completions) | training | 116:71 (gating) | Partial |
| 35 | training_overdue | Training | assignments | Open and past due | Emp | training | executes only | Not Verified |
| 36 | benefits_enrollment | Benefits | benefit types, enrollments | Snapshot; inactive plans not filtered | Emp; D (ended) | benefits | 116:72 (trivial) | Not Verified |
| 37 | benefits_roster | Benefits | enrollments | Overlap, includes cancelled | Emp + D | benefits | executes only | Not Verified |
| 38 | performance_summary | Performance | reviews, cycles | Excludes former employees | Emp + D | RLS | executes only | Not Verified |
| 39 | exit_summary | Exit | hr_exits | Overlap on resignation date / last working day | Emp + D | RLS | executes only | Not Verified |

**Report tally:** 7 Complete · 9 Partial · 23 Not Verified · 0 Missing.

"Executes only" means the loops in `112_dashboard_reports.test.sql:106-112`, `116_aims_dashboard_reports.test.sql:79-87` and `900_seed_smoke.test.sql`. They only assert that a rows array comes back.

**Cross-report issues:**
1. Former employees are handled inconsistently: some reports include them, others silently drop them for past periods.
2. Several reports accept From/To but ignore them.
3. No thousands separators or "%" formatting, and raw codes such as `full_time` are shown.
4. Money is always INR.
5. No charts.
6. No server-side row limit.

---

## 6. Gap lists by category

### 6.1 Functional gaps
- Unit head cannot be set (O4).
- Benefit enrollments cannot be edited (B5); benefit contributions are not used in payroll (B8).
- Absent / on-leave attendance rows are never created, so LOP from attendance depends on manual entries (A7).
- Payroll admins can adjust their own pay (P4).
- Bulk import ignores every new Employee Master field (EM21).
- Address country cannot be entered (EM7).
- No generated documents anywhere: offer letters (R8), HR letters / certificates (HR10), internship certificate (I3), exit letters (EX5).
- Final settlement is notes only (EX6).
- HR is not notified of employee document uploads (V3); verifiers are not told about training self-completion (T6); attendance corrections reach nobody when the employee has no manager (A6).
- Payroll-routed HR requests are invisible to payroll admins (HR11).
- Supporting documents and receipts are free text, not uploads (L9, P6).
- No HR résumé upload (R11); no request attachments (HR12); no SLA escalation (HR8).
- Notification templates are editable but unused (S7).

### 6.2 UI/UX gaps
- Report print prints only the visible 50 rows (RP6); CSV turns negative numbers into text (RP5).
- Report numbers unformatted, raw codes shown, no charts (§5); dashboard uses simple bars (D9).
- Dashboard request/recruitment KPIs ignore the filters without saying so (D8).
- Training page renders 3–7 s after a cold navigation on the dev server (R4 investigation); not yet known whether production is affected.
- A stored payroll identifier cannot be cleared from the UI (EM15).
- HR-request reopen window is hardcoded in the client (HR7).

### 6.3 Security gaps
- Blanket `grant execute on all functions in schema hr_private` in 113–116 re-grants helpers that 111 deliberately revoked (X7). This is safe only while `hr_private` stays out of the exposed API schemas.
- Exit access revocation can be skipped by marking the item "not applicable" (EX4).
- `reports.export` is a UI-only control (RP4). The rows are already viewable with `reports.view`, so this is a policy-clarity issue, not a leak.
- Identity numbers are masked client-side only; the API returns full numbers to self and to `view_identity` holders (EM12).
- Payroll-identifier form loads full values into the browser (EM15).
- Notification link regex accepts `//host` (100:782). Only server code writes links today.
- CORS default allows any `*.lovable.app` origin unless `ALLOWED_ORIGINS` is set (`_shared/cors.ts`).
- Legacy personal data still tracked in Git (X8). Legacy Express `/api/inquiries`, `/api/schedule/*`, `/api/portal/*` remain unauthenticated (outside the HRMS).

### 6.4 Employee Portal gaps
- My Training: the workflow is unproven and failing in R4 (EP8).
- The employee cannot see their own bank account / payroll identifiers (EP14).
- My Profile omits the Arabic name, source department, contract start and deployment dates (EM24).
- Resignation submit/withdraw, asset requests and damage reports, reimbursement submit, interview feedback and internship view are not driven in any passing round.
- Leave supporting document and reimbursement receipt are free text.

### 6.5 Reporting gaps
- Only 7/39 reports have numeric assertions; 23 only "execute" (§5).
- Company filter not honoured by `recruitment_pipeline`, and only partly by `payroll_summary`.
- Misleading zeros or empty results instead of refusals: `attendance_summary`, `absence`, `daily_report_compliance`.
- Logic concerns: `document_expiry` has no lower bound; `probation_due` has no status filter; `training_completion` uses mixed bases; `identity_compliance` never checks national-ID expiry; `new_joiners` undercounts; former employees handled inconsistently.
- The mapping of the 39 templates to the original **30** AIMS templates is unconfirmed (needs the original analysis).

### 6.6 Testing gaps
- **Round 4 incomplete:** 49/55, with 2 training failures open and 4 test fixes never re-run. No results JSON saved.
- **Page crawl not re-run** since migrations 113–116; the new pages have never been crawled on desktop or mobile.
- `npm test` and `vite build` not re-run after the last test-script edits (no app code changed).
- No results JSON saved for rounds 2–4. Evidence is the report text and screenshots only.
- Workflows never driven in any browser round:
  - leave clarification and leave-year initialisation
  - payroll adjustments, corrections, reimbursements and salary structures
  - recruitment openings, careers import and panel feedback
  - internships, evaluations and intern conversion
  - PIPs
  - employee resignation path
  - asset requests
  - document self-upload and versions
  - scheduled announcements
  - most of the newer Settings tabs
- Harness defect: `browser-flows-2.mjs` leaves Chrome and Node running when a workflow throws.

### 6.7 Production integration gaps
- No dev Supabase project yet (`.env.hr-dev.local` absent). Not yet exercised on real infrastructure:
  - Auth invitation and activation
  - GoTrue ban at exit
  - Storage policies and signed URLs
  - all three Edge Functions
  - CORS
  - `search_path` / extension placement
- **No scheduled jobs defined** (X3): missing punches, document expiry, **identity expiry** (absent from `DEPLOYMENT.md`), daily-report reminders, scheduled announcements, email dispatch, leave-year rollover, training overdue.
- Email provider (Resend) not configured; only two event types queue email at all.
- Statutory payroll components need professional verification (P7).
- Country identity rules seeded for IN and AE only; the legal decision on storing national-ID numbers (e.g. Aadhaar) is still open.

---

## 7. Recommended "finish before approval" list

**P0, required to approve:**
1. Re-run Round 4 on a fresh harness (`--only training` first). Fix the training assign → complete → verify path if it is a real defect, then run the full Round 4 to green.
2. Re-run the page crawl, desktop and `--mobile`, covering the new pages; then `npm test` and `vite build`.
3. Create the dev Supabase project and run the role-by-role signed-in E2E on real Auth, Storage and Edge Functions (`DEPLOYMENT.md`).
4. Define the scheduled jobs, including identity-expiry reminders.
5. Statutory payroll sign-off by a qualified professional.

**P1, should be fixed before approval:**
- **Security / correctness:** X7 re-grant; EX4 revocation skip; P4 self-adjustment; HR11 payroll request routing.
- **Employee Master:** O4 unit head; EM7 address country; EM21 import of new fields.
- **Benefits:** B5 edit enrollment; B8 payroll link (decision).
- **Reports:** RP2/RP3/RP4/RP6 (calculation concerns, company filter, misleading zeros, full-row print).
- **Notifications:** V3, T6, A6; X2 decide which events send email; S7 templates.
- **Documents:** generated letters, certificates and offer letters (R8, HR10, I3, EX5), if the company wants them in-system.
- **UI flows** for the Not Verified P1 items listed in §6.6.

**Owner decisions needed:**
- Supply the original AIMS ERP analysis so this audit can be finalised.
- Confirm the category-C list (§4.22).
- Benefits-to-payroll design.
- Which events must email.
- What employees may see of their own banking/identity data.
- Approval to untrack and purge the legacy data files.
