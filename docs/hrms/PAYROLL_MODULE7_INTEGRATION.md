# Module 7 — Payroll & Salary: integration readiness

Worktree `D:\Projects\zyllo-tech-website-intern-m7`, branch `hrms/module-7-payroll`. Nothing is committed. Design and behaviour are described in `PAYROLL_MODULE7.md`; this file covers merging into the shared HRMS.

## 1. Files and migrations

| Kind | Path | Notes |
|---|---|---|
| Migration | `supabase/migrations/170_hr_payroll_salary.sql` | Module 7. Extends 105; requires 100, 101, 103, 105, 110, 113 |
| Migration | `supabase/migrations/171_hr_payroll_exit_integration.sql` | Payroll ↔ Module 4 settlement guard. Does nothing if 130 is absent. **Module 4 owner should review** (it adds two triggers on `hr_payroll_settlement*` tables) |
| DB tests | `supabase/tests/hr/170_payroll_salary.test.sql`, `171_payroll_integration.test.sql` | 171 has blocks that only run when Modules 4/5 are present |
| DB test (edited) | `supabase/tests/hr/105_payroll.test.sql` | Structures now need maker-checker approval |
| UI | `src/hr/pages/PayrollPage.jsx`, `src/hr/pages/payroll/*`, `src/hr/settings/SalaryComponentsSettings.jsx`, `src/employee/pages/MyPayslipsPage.jsx` | No shared navigation, routes or shared UI kit changed |
| Data layer | `src/lib/hr/payroll.js`, `src/lib/hr/payslipPdf.js` | |
| Tests | `tests/payroll-payslip-pdf.test.mjs`, `scripts/hrms-local/browser-flows-payroll.mjs` | |
| Docs | `docs/hrms/PAYROLL_MODULE7.md`, this file, `docs/hrms/local-test-screenshots/m7-*.jpg` | |

**Apply order** (numeric, as `hr-db-apply.mjs` / `hr-db-test.mjs` do): 100–118 → 120 → 125 → 128 → 129 → 130 → 141 → 160 → **170 → 171** → 180 → 190.
170 must run after 160 (it calls Leave's `payroll_lop_days` at run time only, so order is not strictly required) and after 130 (171 needs 130's tables, otherwise it does nothing). 180 and 190 read Module 7 objects and must run after 170.

**Verified:** a combined copy (scratchpad, not anyone's worktree) with migrations 120, 125, 128, 129, 130, 141, 160, 170, 171, 180 and 190 and every module's own tests passed 33/33 files and 2,480 assertions.

## 2. Cross-module dependencies (verified in the combined run)

| Module | Contract with payroll | Status |
|---|---|---|
| 2 Recruitment (120) | Offer/expected salary tables are separate (recruitment-only). No payroll objects touched | Compatible |
| 4 Onboarding & Exit (130) | `hr_payroll_settlements` + lines (full & final). Payroll excludes days up to `last_working_day` when an approved/paid settlement has a `salary_due` line (170). 171 skips or caps `unpaid_salary` lines for payslips already (partly) paid through payroll, and records the payroll payment as paid when the settlement is paid. Payroll refuses to record a payment for a payslip included in a live settlement | Compatible; **171 needs Module 4 review** |
| 5 Attendance (125) | `attendance_period_locked` blocks attendance changes inside finalized/paid runs (reads `hr_payroll_runs.status`; statuses unchanged). Redefines `hr_private.employee_working_days` with the same signature | Compatible |
| 6 Leave (160) | `hr_private.payroll_lop_days(uuid, date, date, boolean)` reads the per-day leave ledger. Half day = 0.5, unpaid = LOP, paid leave = 0 (tested) | Compatible |
| 9 Documents (129) | Compensation letters read the **active** structure's `annual_ctc` (needs `documents.compensation` + `payroll.view`) | Compatible; see §4 |
| 10 Requests (180) | Approved reimbursements are written to `hr_reimbursements` and paid with the employee's payroll payment. Approved bank changes create **unverified** accounts, so payroll verifies with a second person. Handling your own request is blocked | Compatible; see §5 |
| 12 Reports (190) | Reads stored `hr_payroll_items`/`runs` (never recalculates). Statutory section joins line codes to `hr_salary_components.is_statutory` | Compatible; see §6 |

Shared helpers that 170 does **not** redefine: `payroll_lop_days`, `employee_working_days`, `is_holiday`, `is_privileged_write`, `audit_table_is_payroll`. 170 *does* redefine payroll-owned functions (calculate, add adjustment, review, approve, finalize, mark paid, correction, create run). No other module redefines these. Check this again if any later migration does.

## 3. Payroll security requirements (must survive integration)

Enforced in the database (RLS / SECURITY DEFINER / triggers). Do not weaken.

1. **No self-compensation changes.** RESTRICTIVE RLS and trigger checks stop a user creating or changing their own `hr_salary_structures` and `_items`, `hr_employee_bank_accounts`, `hr_payroll_employee_identifiers` and `hr_payroll_statutory_enrollments` (declared TDS). Every adjustment, correction, hold, payment, settlement-coverage and verification RPC calls `payroll_assert_not_self`.
2. **Maker-checker:**
   - Salary structure: the approver must differ from the preparer/submitter and from the subject.
   - Payroll run: the approver/finalizer must differ from the creator/calculator, must not have created an adjustment in the run, and must not be the subject of one.
   - Variable-pay adjustment: the decider must differ from the creator and the subject.
   - Correction: the approver must differ from the preparer and requester, and from the subject.
   - Statutory rule: the validator must differ from the preparer.
   - Bank verification: the verifier must differ from whoever entered the account.
   - Payment reconciliation: the reconciler must differ from the recorder.
3. **Immutability:** finalized/paid runs are frozen except payment-tracking columns. Items, adjustments and payslips cannot change after approval. Payment history is append-only.
4. **Confidentiality:** payroll tables need `payroll.*`. HR admins cannot read salary data or payroll audit rows. Amounts, account numbers and declared tax are redacted in the audit log. Exports need `payroll.export` and are audited. Payslip PDFs are generated in the browser (no storage objects or public URLs).
5. **No money movement:** payments are status records with evidence (reference, method, date, actor). Nothing initiates a transfer.

Integration checks: the employee self-protection tests in `170`/`171`, the HR-admin/employee RLS tests in `105`/`170`, and browser checks A–C in `browser-flows-payroll.mjs`.

## 4. Module 9 — compensation letters

* Read **only approved** structures (`status = 'active'`) effective on the letter date. Never read `draft`, `pending_approval` or `rejected` rows; they are not approved pay. (129 already does this.)
* Monthly figures: 129 currently prints `annual_ctc / 12` as "monthly gross". CTC includes employer costs and is not the payroll gross. Use `public.hr_salary_structure_preview(structure_id)` (needs `payroll.view`; returns `gross`, `deductions`, `lines`) or label the figure "CTC ÷ 12".
* Salary/increment letters for a **revision** should use the revision's `effective_from` and `revision_reason`. Approval end-dates the previous structure automatically.
* Letters about a payroll user's own salary must be issued by someone else. Generating a letter changes no pay, but issuing it is an HR approval act; recommended rule.

## 5. Module 10 — payroll requests

* **Payroll queries:** Module 7 has a native payslip query flow (`hr_submit_payroll_query` → prepare → approve → correction in the next run). When a Module 10 `payroll_query` needs money corrected, payroll should open a correction via `hr_create_payroll_correction_request(run, employee, category, description, evidence)` and reference the request id in `evidence`. Do not write `hr_payroll_adjustments` directly; table writes are revoked.
* **Reimbursements:** keep inserting an approved row into `hr_reimbursements` (one per claim). Payroll attaches it at calculation and marks it paid when that employee's payroll payment is recorded as paid (or via the settlement).
* **Bank detail changes:** keep creating accounts with `verified = false` (the guard trigger forces this anyway). Verification is `hr_verify_bank_account` by a second payroll approver.
* **Salary advances:** recover through the payroll component `ADVANCE_RECOVERY` (disabled by default; `requires_approval`). Enable it, then add per-run recovery adjustments, which need a second approver. Module 10 must not deduct pay itself.
* **Salary certificates:** take figures from finalized payslips (`hr_payslips`) or the approved structure, not drafts.

## 6. Module 12 — salary component categories for analytics

Classify payroll lines by joining each breakdown line's `code` to `hr_salary_components`.

| Field | Values | Use |
|---|---|---|
| `kind` | `earning`, `deduction`, `employer_contribution` | Gross / deductions / employer cost |
| `component_type` | `fixed`, `variable` | Fixed vs variable pay mix |
| `category` | `basic`, `allowance`, `bonus`, `incentive`, `reimbursement`, `statutory`, `recovery`, `advance`, `loan`, `other_deduction`, `employer_cost`, `other` | Cost breakdowns |
| `is_statutory` | boolean | Statutory section (190 uses this) |
| `tax_treatment` | `not_configured`, `taxable`, `exempt`, `partially_exempt` | Show "not configured" as such; never infer tax |

Breakdown sources in `hr_payroll_items.breakdown` / `hr_payslips.breakdown`:
- `earnings[]`, `deductions[]`, `employer_contributions[]` (each `{code, name, kind, amount[, statutory_rule]}`);
- `adjustments[]` (`{label, amount, source}`: one-off, variable pay or correction; signed);
- `reimbursements[]`;
- `statutory[]` (calculation basis per rule);
- `validation` (items only; removed on payslips).

Use **finalized/paid** runs for "final" figures (190 already labels runs Final / Provisional).

Statutory lines use the rule's component code (`PF_EMPLOYEE`, `PF_EMPLOYER`, `ESI_EMPLOYEE`, `ESI_EMPLOYER`, `PROFESSIONAL_TAX`, `TDS`), all `is_statutory = true`. A rule configured **without** a component code produces `<RULE>_EMPLOYEE` / `<RULE>_EMPLOYER` lines with no component row. Module 12 should treat lines carrying `statutory_rule` as statutory, or the payroll team should always set component codes.

## 7. Statutory calculations that need professional validation before production

Nothing statutory is applied until a payroll approver records a validation reference. In the shipped data:

| Rule | What must be configured and validated |
|---|---|
| EPF | Wage base (basic ± DA etc.), employee rate, employer rate **and its split** (EPS / EPF / EDLI / admin charges are not modelled separately), wage ceiling and whether contributions on higher wages are allowed, eligibility (new joiners, international workers, voluntary higher contribution) |
| ESI | Wage definition, employee/employer rates, eligibility threshold. **Contribution-period rule not modelled** (eligibility is re-evaluated every month rather than fixed per contribution period) |
| Professional Tax | One version per state with that state's slabs. Gender/age exemptions and **February / annual adjustments are not modelled** |
| TDS | **Not computed.** The monthly amount comes from each employee's tax computation (regime, declarations, previous employer income, projections) entered on the enrolment |
| Others | Labour Welfare Fund, gratuity provisioning, bonus (statutory bonus act), leave encashment taxability: only after confirmation |
| Component tax treatment | Every component defaults to `not_configured`; set and validate before using taxable totals |
| Engine assumptions to confirm | Statutory rule in force on the **last day** of each structure segment; wage ceiling shared by segment days ÷ period working days; slab lookup on the unprorated monthly base; fixed/slab amounts split by segment days; rounding per rule |

Calculations executing does **not** make payroll compliant.

## 8. Tests required after integration

1. `node scripts/hr-db-test.mjs`: every module's tests together (expect 33+ files to pass; 170 and 171 must run with 130/125/160 present).
2. `node scripts/hr-db-test.mjs --seed`: seed smoke.
3. `npm test`: includes `tests/payroll-payslip-pdf.test.mjs`.
4. `npx vite build` (or `npm run build`).
5. Local harness plus `node scripts/hrms-local/browser-flows-payroll.mjs --state <state file>` (49 checks), then the other modules' browser flows. **Re-run** them because 171 changes Module 4's settlement behaviour: `browser-flows-m4.mjs`, `browser-flows-m10.mjs` (reimbursement → payroll, bank change → verification), 190 report screens.
6. Manual: an exiting employee with (a) a paid and (b) an unpaid finalized payslip → prepare settlement → confirm no double line, payment synced on settlement paid. Attendance correction inside a finalized period is refused (125).
7. After the dev project is created (not live): apply migrations in order, run the role E2E (Super Admin, Payroll Admin, Payroll Approver, HR Admin, Employee).

## 9. Remaining production blockers

1. **Statutory validation** (§7) by a qualified payroll / tax professional; component tax treatments set.
2. **171 review by the Module 4 owner**, plus a decision that settlements remain the only path for exit pay.
3. **Company-level scoping of payroll users** does not exist in the HRMS (runs can be scoped, users cannot). Needed if one legal entity's payroll staff must not see another's.
4. **Repo ESLint config is broken** (imports the uninstalled `eslint-config-next`); fix so CI lint can run.
5. Real dev-project (not live) E2E per role; Edge Functions unaffected by Module 7.
6. Open design decisions: benefit contributions in payroll (B8); pay frequencies other than monthly; arrears automation for retroactive revisions (flagged, handled as corrections today); bank/WPS file generation (out of scope by design).
