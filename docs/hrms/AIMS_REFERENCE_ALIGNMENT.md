# Zyllo Tech HRMS — AIMS ERP reference alignment

- **Date:** 2026-11-03
- **Branch:** `Intern` (uncommitted, not pushed, not deployed)
- **Reference:** the owner's written analysis of the AIMS ERP HR module (structure, 12 tabs, Employee Master form, dashboard analytics, 30 report templates). No AIMS ERP system, data or records were accessed or copied; every person in this repository is synthetic (`Demo …`, `@example.com`).
- **Rule applied to every feature:** keep what works, enhance what is incomplete, add what is missing, consolidate duplicates, remove only when safe. Nothing was removed.

## 1. What the reference established — and what it did not

The reference has a strong **Employee Master** (one long form covering the whole lifecycle) and **Org Structure**, live headcount/diversity/completeness analytics, and a 12-tab workspace plus a separate **HR Requests** console. Everything past "hire to record" (leave, attendance, payroll, benefits, visa, recruitment, training, performance, requests) was **UI-only and empty**, so it shows no workflow behaviour. Where the reference was silent, the tested Zyllo Tech behaviour was kept unchanged. Reference defects that were **not** reproduced: `Showing 1–NaN` pagination, empty decorative modules, optional company assignment with no visibility of the gap.

## 2. Module-by-module comparison

| # | Reference tab | Zyllo Tech before | Gap | Action | Now |
|---|---|---|---|---|---|
| 1 | Dashboard | `hr_dashboard()` KPIs: headcount, attendance, leave, daily reports, requests, recruitment, documents, events | No company / location / nationality / gender / tenure / grade / arrangement breakdowns, no completeness scorecard, no deployment, training or benefits | **Enhance** | Company filter + 14 new sections, all from real rows (§4) |
| 2 | Employee Master | Name, email, department, designation, manager, type, dates, location, shift, contract dates; PII split; history; import | Missing legal entity, grade, source department, Arabic name, WFO/WFH, contract type, notice period, deployment block, nationality, marital status, identity documents, HR remarks, banking/payroll identifiers in the profile, exit details on the profile, completeness | **Enhance** | Sectioned form + 7-tab profile (§3) |
| 3 | Org Structure | Departments with parent/head in Settings only | No module, no legal entities, no tree, no drill-down, department cycles not prevented | **Add** | `/hr/org-structure`: units tree, table, reporting hierarchy, checks (§5) |
| 4 | Leave Management | Full workflow (balances, manager → HR approval, clarifications, holidays, audit) | — | **Keep** | Unchanged |
| 5 | Attendance & Time | Full workflow (punch, corrections, OT, missing punches) | — | **Keep** | Unchanged |
| 6 | Payroll | Full run state machine Draft → Calculated → Reviewed → Approved → Finalized → Paid, payslips | Bank accounts had no UI on the profile; no IBAN/SWIFT; no tax / social-security / WPS identifiers | **Enhance** | Payroll-only "Banking & payroll" tab, IBAN/SWIFT/branch, `hr_payroll_employee_identifiers` |
| 7 | Benefits | None | Entire module | **Add** | Plans, eligibility, enrollments, status changes, auto-end on exit, My Benefits (§6) |
| 8 | Visa & Documents | Versioned private documents, verification, expiry reminders, access log | No structured passport / permit / visa data, no country rules | **Enhance** | Renamed "Visa & Documents"; identity records + country rules + identity expiry reminders; new document categories (passport, work permit, visa, national ID, training certificate) |
| 9 | Recruitment | Openings, pipeline, interviews, offers, conversions, interns | — | **Keep** (label "Recruitment & Interns" → "Recruitment") | Interns also reachable as "Intern Management" |
| 10 | Training | None | Entire module | **Add** | Catalogue, assignments, completion, certificates, verification, My Training (§7) |
| 11 | Performance | Cycles, goals, KPIs, reviews, feedback, PIPs | — | **Keep** (label "Performance & KPI" → "Performance") | Unchanged |
| 12 | HR Reports | 17 reports, CSV + print/PDF | Reference categories; workforce/diversity/org/deployment/compliance/training/benefit templates | **Enhance** | 39 templates in 14 reference categories, company filter (§8) |
| — | HR Requests (sidebar) | Generic helpdesk with categories, SLA, comments, confidential, reopen | Reference request types (profile update, travel, letters, loans) | **Enhance** | Types added; loans off by default; leave stays in Leave Management |
| — | HR Settings | 8 core tabs + 9 module tabs, flat tab bar | Legal entities, grades, identity rules, benefit plans, training categories; one flat 17-tab bar | **Consolidate** | Grouped into 4 sections, 23 tabs (§9) |
| — | Daily Work Reports, Announcements, Assets, Exit Management | Zyllo Tech modules | Not in the reference | **Keep** | "Lifecycle & Operations" sidebar group |

**Duplicates found and consolidated.** (1) Leave questions vs. leave applications: HR Requests keeps "Leave query" only as a question channel and the request form now links to My Leave — there is one leave approval chain. (2) Department head/parent were only editable in Settings; Org Structure *reads* them (no second editor). (3) Benefit plans and training categories each have one editor reused by both the module page and HR Settings. (4) Exit data on the profile is read from Exit Management (no second copy of termination reason or clearance).

## 3. Employee Master

**Form sections** (`src/hr/components/EmployeeForm.jsx`): Personal · Contact · Employment · Deployment · Contract · Identification. Section buttons show an error marker; an error summary lists every invalid field with a jump link.

| Section | Fields | Storage / protection |
|---|---|---|
| Personal | Employee ID (system generated, read-only), first/last/display name, Arabic name (optional), gender, date of birth, nationality (ISO-2), marital status; photo on the profile | Work record in `hr_employees`; PII in `hr_employee_private` (self + `employees.view_sensitive`) |
| Contact | Company (work) email, personal email, mobile, emergency contact, address | Same split |
| Employment | Company/legal entity, department, source department, designation, grade/band, employment type, location, WFO/WFH/hybrid, shift, manager, joining, probation end, status | `hr_employees` (new nullable columns) |
| Deployment | Status (not deployed / deployed / bench), client, project/job number, start/end | Optional; a deployed employee must have a client (DB constraint) — never required for ordinary staff |
| Contract | Contract type, start/end, notice period (0–365 days), HR remarks | Remarks in `hr_employee_confidential`: HR with `employees.view_sensitive` only — never the employee or manager |
| Identification | National ID type/number/expiry, passport number/country/issue/expiry, work permit type/number/expiry, visa type/number/expiry | `hr_employee_identity`: self + new permission `employees.view_identity`; numbers redacted in the audit log; UNIQUE passport and (type, normalised number) |
| Banking & payroll | Bank accounts (IFSC, IBAN, SWIFT, branch), payment mode, tax ID, social security/UAN, pension, health insurance, WPS person ID, payroll code | Profile tab for `payroll.view` only; writes `payroll.manage`; numbers masked in the UI, redacted in audit; audit rows hidden from non-payroll auditors |
| Exit | Exit type, case status, resignation date, last working day, reason, clearance progress | Read from Exit Management (`hr_exits`, clearance items) with a link to the case |

**Validation & uniqueness:** client-side rules mirror DB checks (email, phone, ISO codes, date ordering, notice bounds, passport/permit formats); friendly duplicate checks for company email and passport, with the database UNIQUE constraints authoritative. **Edit control:** only fields the user may see are rendered and saved; unchanged sections are not written (no audit noise). **History:** new change types `legal_entity`, `grade`, `work_arrangement`, `deployment`, `contract`. **Completeness:** a per-employee score on the profile and a company scorecard on the dashboard, using the same field list, counting only fields the viewer is allowed to see. **Country rules:** `hr_identity_requirements` (seeded IN and AE) decide which documents are required, including "foreign national" rules; `hr_employee_identity_status()` and the *Identity compliance* report list gaps. **Expiry reminders:** `hr_generate_identity_expiry_reminders()` (service role / identity officers) notifies the employee and identity officers once per item and expiry date, without the number.

## 4. Dashboard (`hr_dashboard`)

Added: company filter (applies to *every* existing KPI through `hr_private.scoped_employees`), KPIs *new joiners, deployed employees, passports/visas expiring (60 d), overdue training, active benefit enrollments*; sections *headcount by company, by location, employment type, work arrangement, grade, tenure bands, nationality (top 15), gender, deployment by status and client, training summary, benefits by plan, new joiners list, data completeness scorecard*. Nationality/gender appear only with `employees.view_sensitive`; identity KPI only with `employees.view_identity`; training/benefit sections only with those permissions — otherwise `null` (hidden), never a fake zero. Managers get team scope. Empty sections show empty states.

## 5. Org Structure (`/hr/org-structure`)

Legal entities → organisation units (division / department / unit / team, `hr_departments.parent_id`) with direct and rolled-up headcounts and heads; table view; reporting hierarchy with direct/total reports and person search; drill-down dialogs; company and department filters; *Hierarchy checks* (no manager, no department, no company, inactive unit with staff, unit without company or head). Circular unit parents are rejected by a new trigger; circular reporting lines were already rejected. Source of truth is the Employee Master under RLS (managers see their line).

## 6. Benefits (`/hr/benefits`, `/employee/benefits`)

`hr_benefit_types` (category, provider, eligible employment types, minimum service, employer/employee contribution, frequency, dependants) and `hr_benefit_enrollments` (coverage, dependants, contributions, policy number, override reason, status). RPCs: `hr_benefit_eligibility`, `hr_enroll_benefit` (eligibility checked at the start date; ineligible only with a recorded override reason; no self-enrollment; one live enrollment per plan), `hr_set_benefit_enrollment_status` (suspend/resume/end/cancel with reason). Enrollments end automatically when the employee exits. Permissions `benefits.view` (HR, payroll) and `benefits.manage` (HR); managers do not see team benefits.

## 7. Training (`/hr/training`, `/employee/training`)

Categories, courses (mode, hours, mandatory, pass score, certificate required, validity months) and assignments. RPCs: `hr_assign_training` (bulk, idempotent, HR for anyone / managers with `training.assign_team` for their line, never self), `hr_start_training` (self), `hr_complete_training` (pass-mark and certificate rules; certificate must be the same employee's `training_certificate` document; certificate expiry from validity; self-reported completions stay unverified), `hr_verify_training_completion`, `hr_cancel_training`. Overdue = open past due date.

## 8. HR Reports

39 templates in the reference categories: Workforce & headcount (9), Diversity & demographics (3, need `employees.view_sensitive`), Organisation structure (2), Deployment (2), Compliance & documents (7; identity reports need `employees.view_identity`), Leave (2), Attendance (3), Daily work (2), Payroll (1), Recruitment (2), Training (2), Performance (1), Benefits (2), Exit management (1). The original 17 run unchanged through `hr_private.hr_report_core`; the 22 new ones only read data that exists. Company filter on every report; CSV export (`reports.export`) and print/PDF unchanged.

**Pagination:** the shared `DataTable` sanitises totals/page sizes (never `NaN`), clamps the page, shows `Showing a–b · Page x of y · n records`, shows `0 records` for empty server-paged lists, and disables navigation while loading or at the ends.

## 9. Navigation, routes and settings

Sidebar: **HR Workspace** (Dashboard, Employee Master, Org Structure, Leave Management, Attendance & Time, Payroll, Benefits, Visa & Documents, Recruitment, Training, Performance, HR Reports) · **Requests** (HR Requests) · **Lifecycle & Operations** (Daily Work Reports, Intern Management, Announcements, Assets, Exit Management) · **Administration** (HR Settings). Items appear only with permission.

| Route | Change |
|---|---|
| `/hr/org-structure`, `/hr/benefits`, `/hr/training` | **New** |
| `/employee/benefits`, `/employee/training` | **New** |
| All existing `/hr/*` and `/employee/*` URLs | **Unchanged** |
| `/hr/dashboard`, `/hr/employee-master`, `/hr/org`, `/hr/organization`, `/hr/leave-management`, `/hr/attendance-time`, `/hr/visa-documents`, `/hr/interns`, `/hr/hr-reports`, `/hr/hr-requests`, `/hr/hr-settings`, `/hr/exit-management` | **Aliases** redirecting to the existing URLs |

**HR Settings groups:** Organisation (company, employee ID, legal entities, departments & units, designations, grades & bands, locations, employment types) · Time, leave & approvals (shifts, holidays, leave types, leave balances link, attendance/report/leave/payroll rules incl. the leave approval flow) · Pay, benefits & talent (salary components, benefit plans, training categories, review cycles, KPI definitions, projects) · Compliance, requests & access (document categories, identity document rules, HR request categories, notification templates, roles & permissions, audit log). Every write is enforced by RLS with the existing or new permission.

## 10. Database migrations (additive only)

| File | Contents |
|---|---|
| `113_hr_employee_master_org.sql` | `employees.view_identity`; `hr_legal_entities`, `hr_grades`, `hr_identity_requirements`; department `legal_entity_id`, `unit_type`, cycle trigger; 12 nullable employee columns + 2 constraints; history types; PII `nationality`, `marital_status`; `hr_employee_identity`, `hr_employee_confidential`, `hr_payroll_employee_identifiers`; bank `iban`, `swift_code`, `branch`; identity document categories; identity expiry list / compliance / reminders |
| `114_hr_benefits.sql` | `benefits.*`; plans, enrollments, eligibility + workflow RPCs, auto-end on exit |
| `115_hr_training.sql` | `training.*`; categories, courses, assignments, workflow RPCs, `training_certificate` category |
| `116_hr_aims_dashboard_reports.sql` | Company filter in `scoped_employees`; `hr_dashboard` / `hr_report` moved to `hr_private.*_core` and wrapped; new sections and 22 templates; new HR request types |

The only non-additive statements: the `hr_employee_history.change_type` CHECK is dropped and re-created as a **superset**; the bank-account audit trigger is re-created to also redact `iban`; `hr_dashboard`/`hr_report` are renamed into `hr_private` and replaced by wrappers with the same arguments plus an optional `p_legal_entity`. No table, column or row is dropped. The synthetic seed gained a separate idempotent block (one demo legal entity, three grades, two benefit plans, three courses — no identity or payroll numbers).

## 11. Permissions added

| Permission | Granted to |
|---|---|
| `employees.view_identity` | super_admin, hr_admin |
| `benefits.view` | super_admin, hr_admin, payroll_admin |
| `benefits.manage` | super_admin, hr_admin |
| `training.view`, `training.manage` | super_admin, hr_admin |
| `training.view_team`, `training.assign_team` | super_admin, hr_admin, manager |

## 12. Testing

See `LOCAL_TEST_REPORT.md` §12. Summary:

| Suite | Result |
|---|---|
| DB module tests | 774/774 existing (with 113–116 applied) + **163/163 new** (113 = 62, 114 = 30, 115 = 34, 116 = 37), new files run per file |
| DB seed smoke | **55/55** (27 existing + 28 new) |
| `npm test` | 45/45 |
| `vite build` | PASS |
| Browser round 1 | 34/34 |
| Browser round 2 | 140/140 |
| Browser round 3 | 201/201 |
| Browser round 4 | 49/55 on first run; 4 failures were test-expectation errors (fixed), 2 training checks still open |
| Page crawl (desktop + mobile) | not yet run — see `LOCAL_TEST_REPORT.md` §12.1 |

## 13. Remaining limitations

- **Not real Supabase.** Browser checks ran against the local emulation harness; real GoTrue/Storage/Edge Functions still need the dev project (unchanged blocker).
- **Scheduled jobs:** `hr_generate_identity_expiry_reminders()` must be scheduled (daily) like the existing reminder jobs.
- **Bulk import** (`hr_import_employees`) does not yet accept the new columns (company, grade, arrangement, deployment, identity); they are edited per employee. Extending the CSV template is a follow-up.
- **Country rules** are seeded for IN and AE only; HR adds others in Settings. Whether a national ID number may be stored at all is a legal decision for the company (the IN rule note warns about Aadhaar).
- **Benefit contributions** are recorded, not fed into payroll calculation; linking them to salary components needs a payroll design decision.
- **Training certificates** must be uploaded in Documents first and then attached; there is no in-dialog upload.
- **Arabic name** is stored and displayed right-to-left; the UI itself is not localised.
- **Approval workflows** remain the tested fixed chains (manager → HR, payroll separation of duties) configured through the existing module rules — no free-form workflow designer was added.
