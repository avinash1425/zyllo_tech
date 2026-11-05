# Module 7 — Payroll & Salary

Branch `hrms/module-7-payroll` · migration `supabase/migrations/170_hr_payroll_salary.sql` · tests `supabase/tests/hr/170_payroll_salary.test.sql`, `tests/payroll-payslip-pdf.test.mjs`.

This module **extends** the payroll in `105_hr_payroll.sql`. The runs, items, adjustments, payslips, structures, reimbursements and bank accounts are the same tables. No second payroll system was built.

> **Not production-compliant.** No statutory rate, ceiling, threshold or slab is built in. Statutory rules are templates until they are configured and a payroll approver records a qualified professional's validation. Calculations executing does not mean payroll is legally compliant.

## 1. Security fixes

| # | Defect (before) | Fix (server-side) |
|---|---|---|
| P4 | `hr_add_payroll_adjustment` let a payroll admin add an adjustment to **their own** pay | `payroll_assert_not_self` in every adjustment, correction, hold, payment, settlement and verification RPC |
| P4b | `hr_create_payroll_correction` had the same hole | Same check |
| P4c | RLS on `hr_salary_structures` / `_items` only checked `payroll.manage`, so a payroll admin could **raise their own salary** by writing the table directly | RESTRICTIVE RLS policies (`employee_id <> current employee`) plus trigger checks |
| P4d | A payroll admin could change their **own bank account** (redirect pay) or payroll identifiers | RESTRICTIVE RLS policies on `hr_employee_bank_accounts` and `hr_payroll_employee_identifiers` |
| P4e | Salary structures were active as soon as they were inserted (no approval) | Maker-checker: draft → pending_approval → active. The approver must differ from the preparer and from the subject |
| P4f | A run approver could approve adjustments they created themselves, or adjustments to their own pay | `payroll_check_own_compensation` runs at approve **and** finalize |
| P11 | Bank `verified` flag existed with no workflow | `hr_verify_bank_account` (second person). Changing any account detail voids verification. The flag cannot be set directly |
| — | Statutory/declared-tax amounts could be set for oneself | RESTRICTIVE RLS on `hr_payroll_statutory_enrollments` |

Payment amounts and declared tax amounts are redacted in the audit log, alongside the existing salary and bank redaction. Exports require `payroll.export` and are audited (`PAYROLL_EXPORT`).

## 2. Lifecycle

Stored run states are unchanged, so existing data, reports and dashboards keep working. The UI labels are:

`draft` Draft → `calculated` Calculated (preview) → `reviewed` **Submitted** → `approved` Approved → `finalized` **Finalized · payment pending** → `paid` Paid

* **Return for correction** (`hr_return_payroll_run`): Submitted or Approved → Calculated, with a reason. Only before finalization.
* **Submit** is blocked while any item has validation errors or any variable-pay entry is unapproved.
* **Approve / Finalize**: the person must not have created or calculated the run, must not have created an adjustment in it, and must not be the subject of an adjustment in it.
* **Finalized** runs are frozen. Only the payment-tracking columns change (guard trigger). Payslips are immutable.
* A run becomes **paid** automatically only when **every** employee's payment is paid or reconciled.

## 3. Money and rounding rules

* Money is `numeric` end to end (exact decimal). The browser never computes pay.
* Each payslip line is rounded **once** to 2 decimals, **half away from zero** (`round(numeric, 2)`). Totals are sums of rounded lines, so payslips always add up exactly.
* Statutory lines use the rule's own `rounding_mode` (`half_up` / `up` / `down`) and `rounding_precision` (0 or 2), as configured and validated.
* Proration (unchanged from 105): earnings × payable days ÷ working days of the period. Percentage deductions follow the prorated base. Fixed deductions are split between structure segments by days.
* A statutory wage ceiling is shared across segments by `segment days ÷ period working days`.

## 4. Components (allowances and deductions)

Each component has: code and name, kind, **fixed / variable**, category (allowance, bonus, incentive, reimbursement, statutory, recovery, advance, …), calculation method, **tax treatment**, tax note, eligible employment types, effective dates, and `requires_approval`.

* Tax treatment defaults to `not_configured`. Nothing assumes a component is taxable or exempt.
* Seeded components: CONVEYANCE, OTHER_ALLOWANCE, VARIABLE_PAY, BONUS*, INCENTIVE*, SALARY_RECOVERY, ADVANCE_RECOVERY*. Items marked * are disabled until enabled. Statutory labels: PF_EMPLOYEE/EMPLOYER, ESI_EMPLOYEE/EMPLOYER, PROFESSIONAL_TAX, TDS.
* Variable components are entered per run as adjustments. Components with `requires_approval` start **pending** and need a second payroll approver who is not the creator and not the subject.
* Duplicates are rejected: one adjustment per run, employee and component. Statutory components cannot be added as adjustments or as structure lines. A structure line for a rule-managed component is ignored and reported.
* Attendance-based LOP stays **off** (`lop_from_attendance = false`). Only approved unpaid leave reduces pay unless the company enables the policy.

## 5. Statutory rules (`hr_payroll_statutory_rules`)

Rules are effective-dated and scoped by code, state/jurisdiction and company. Each rule defines: calculation method (`percent_of_wage`, `slab`, `fixed`, `employee_declared`), wage-base components, wage ceiling, eligibility wage threshold (on the wage base or on gross), employee and employer rates or amounts, slabs, employee and employer component codes, rounding, and `applies_to` (all / enrolled).

* Workflow: draft → `hr_submit_statutory_rule` (completeness checks) → `hr_approve_statutory_rule(validation_reference)` by a **different** approver. Returning a rule sends it back to draft.
* Approved rules are immutable. To change one, end-date or retire it and create a new version. Approved versions cannot overlap.
* Only approved rules are applied. Rules pending validation are listed on each item as *not applied*, with a warning.
* Each applied line stores its calculation basis: rule, version date, wage base, prorated base, ceiling, contribution base, rates, slab, amounts, rounding and validation reference.
* Employee enrolment (`hr_payroll_statutory_enrollments`) records eligibility, opt-out, jurisdiction (state) and declared monthly amounts (TDS from the employee's tax computation; this system does **not** compute income tax).
* Seeded templates: **EPF, ESI, PT, TDS** with **no rates**. They cannot be submitted until configured.

**Required before production:** a qualified payroll / tax professional must configure and validate every rule. That includes current EPF/ESI rates, wage ceilings and thresholds, PT slabs per state, TDS computation and employer contribution splits (EPS/EDLI/admin charges), and any other legally required components (LWF, gratuity provisioning). The ESI half-month and contribution-period rules and PT annual/February adjustments are **not modelled** and need a decision.

## 6. Payments (status tracking only)

`hr_payroll_payments` holds one row per employee item, created at finalization. Statuses: pending, processing, paid, partially_paid, failed, reconciled. Each change is appended to `hr_payroll_payment_events`.

* **paid / partially paid** require a reference, method and payment date (not in the future). These are the recorded evidence. The system never claims a bank transfer happened by itself.
* **failed** requires a reason and keeps any amount already paid. Retry is failed → processing / paid.
* **Reconciliation** needs a bank-statement note and a **different** person from the recorder.
* `hr_mark_payroll_paid` (one batch reference for the whole run) refuses if any payment failed or was partially paid.
* Nobody records the status of their own salary payment individually. The batch action covers the whole run.
* Reimbursements are marked paid with that employee's salary payment.

## 7. Corrections and final settlements

* **Employee query** (`hr_submit_payroll_query`) on own payslip → payroll **prepares** the amount and calculation (not the subject) → a **different approver** approves (not the preparer, not the requester) → booked as a `correction` adjustment in the next open run, or parked until one exists. Finalized data is never edited. Payroll staff can raise corrections too.
* `hr_payroll_post_finalization_changes(run)` lists leave and attendance changed after finalization as candidates for a controlled correction.
* **Final-settlement coverage** (`hr_record_settlement_coverage`): days up to `covered_through` were paid in the exit settlement, so payroll excludes them (no double payment). The calculator warns when an employee is in clearance or final settlement without coverage.
* **Holds** (`hr_set_payroll_hold`) leave an employee out of a run, with a reason.

## 8. Runs: scope and validation

* Optional **legal-entity scope**. Same-scope runs cannot overlap, and a company-wide run cannot overlap any company run (RPC check plus exclusion constraint).
* Item validation: **errors** (negative net, mixed currency, unapproved variable pay) block submission. **Warnings**: zero gross, unverified components, statutory rules pending validation, statutory line ignored, no or unverified bank account, pending attendance corrections, pending leave, unreconciled exit, settlement coverage applied, attendance-based LOP enabled.

## 9. Employee portal (My Payslips)

Tabs: Payslips (payment status, **PDF download**, print, **Query**), **My salary** (current structure lines and revision history, if `employee_can_view_salary_structure`), **Payroll queries**, Bank account (masked), Reimbursements.
The PDF is generated in the browser from the RLS-scoped payslip row (`src/lib/hr/payslipPdf.js`, dependency-free). Nothing goes to storage and there is no public URL.

## 10. API (new / changed RPCs)

New: `hr_salary_structure_preview`, `hr_submit_salary_structure`, `hr_approve_salary_structure`, `hr_reject_salary_structure`, `hr_create_salary_revision`, `hr_end_salary_structure`, `hr_verify_bank_account`, `hr_set_payroll_hold`, `hr_decide_payroll_adjustment`, `hr_return_payroll_run`, `hr_record_payroll_payments`, `hr_reconcile_payroll_payments`, `hr_submit_statutory_rule`, `hr_approve_statutory_rule`, `hr_return_statutory_rule`, `hr_submit_payroll_query`, `hr_create_payroll_correction_request`, `hr_prepare_payroll_correction`, `hr_decide_payroll_correction`, `hr_record_settlement_coverage`, `hr_void_settlement_coverage`, `hr_payroll_overview`, `hr_payroll_statutory_report`, `hr_payroll_post_finalization_changes`, `hr_log_payroll_export`, `hr_my_salary_structure`, `hr_my_payroll_payments`.

Changed (same name): `hr_create_payroll_run` (+ `p_legal_entity`, default null; positional 3-argument calls still work), `hr_calculate_payroll_run`, `hr_add_payroll_adjustment`, `hr_review_payroll_run`, `hr_approve_payroll_run`, `hr_finalize_payroll_run`, `hr_mark_payroll_paid`, `hr_create_payroll_correction`.

## 11. Dependencies on other modules

| Module | Used for | Contract |
|---|---|---|
| Employee Management (1) | `hr_employees`, legal entity, employment type, bank accounts UI in EmployeeDetail | Bank account self-edit is now refused by RLS in that UI too |
| Attendance (5) | Pending-correction warnings; attendance LOP only when the policy is on | Reads `hr_attendance`, `hr_attendance_corrections` |
| Leave (6) | Unpaid leave → LOP | Calls `hr_private.payroll_lop_days(uuid, date, date, boolean)`. Leave session 6 confirmed the signature is unchanged in its migration 160 |
| Onboarding & Exit (4) | Exit status warnings; settlement coverage links `hr_exits`; Module 4's full & final settlements (130) are honoured: an approved/paid `salary_due` line excludes those days, and `171_hr_payroll_exit_integration.sql` prevents settlement lines from re-paying payroll and syncs payroll payments when a settlement is paid | Reads `hr_exits`, `hr_payroll_settlements` + lines (guarded; no-op without 130). See `PAYROLL_MODULE7_INTEGRATION.md` |
| Benefits | Contributions are still **not** fed into payroll (B8, design decision pending) | — |
| HR requests | `payroll_query` HR requests remain invisible to payroll admins (HR11, owned by the Requests module). Payroll queries now have a native flow here | — |
| Dashboards (112/117) | Unchanged run statuses | — |

## 12. Known gaps

* Company-level **user scoping** for payroll roles (restricting a payroll admin to one legal entity) does not exist anywhere in the HRMS. Runs can be scoped, but users are not.
* Pay frequency is monthly only. Arrears from retroactive revisions are flagged (`retroactive: true`) and must be raised as corrections.
* No bank or WPS file generation, and no payment initiation (by design).
* Statutory engine limitations are listed in §5.
* Receipts for reimbursements are still a free-text reference (P6).
