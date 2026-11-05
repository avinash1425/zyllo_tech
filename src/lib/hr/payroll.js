// Payroll data layer (migrations 105 + 170). Visible only to payroll.* holders;
// employees see their own released payslips, payment status, salary summary,
// masked bank account, reimbursement claims and payroll queries. Calculation,
// locking, maker-checker and separation of duties are enforced by the server
// (RLS + SECURITY DEFINER RPCs) — the UI only mirrors those rules.
// Payment RPCs only RECORD what happened outside the system; nothing here
// initiates any payment.
import { from, rpc, run } from "./client";

export const RUN_STEPS = ["draft", "calculated", "reviewed", "approved", "finalized", "paid"];
/** Business labels for the stored run states (Draft → Submitted → Approved → Finalized → Payment pending → Paid). */
export const RUN_STEP_LABELS = { draft: "Draft", calculated: "Calculated (preview)", reviewed: "Submitted", approved: "Approved", finalized: "Finalized · payment pending", paid: "Paid" };
export const PAYMENT_STATUSES = ["pending", "processing", "partially_paid", "paid", "failed", "reconciled"];
export const PAYMENT_METHODS = ["bank_transfer", "cheque", "cash", "other"];
export const COMPONENT_KINDS = ["earning", "deduction", "employer_contribution"];
export const CALC_TYPES = ["fixed", "percent_of_basic", "percent_of_gross", "manual"];
export const COMPONENT_TYPES = ["fixed", "variable"];
export const COMPONENT_CATEGORIES = ["basic", "allowance", "bonus", "incentive", "reimbursement", "statutory", "recovery", "advance", "loan", "other_deduction", "employer_cost", "other"];
export const TAX_TREATMENTS = ["not_configured", "taxable", "exempt", "partially_exempt"];
export const STRUCTURE_STATUSES = ["draft", "pending_approval", "active", "rejected", "archived"];
export const STATUTORY_SCHEMES = ["provident_fund", "state_insurance", "professional_tax", "income_tax", "labour_welfare_fund", "other"];
export const STATUTORY_METHODS = ["percent_of_wage", "slab", "fixed", "employee_declared"];
export const STATUTORY_STATUSES = ["draft", "pending_validation", "approved", "retired"];
export const CORRECTION_CATEGORIES = ["missing_earning", "incorrect_deduction", "loss_of_pay", "attendance_change", "leave_change", "reimbursement", "statutory", "other"];
export const CORRECTION_STATUSES = ["submitted", "prepared", "applied", "rejected"];
export const MONEY = /^-?\d+(\.\d{1,2})?$/;
export const REIMBURSEMENT_STATUSES = ["submitted", "approved", "rejected", "paid"];
export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_NO = /^[0-9A-Za-z]{6,34}$/;

const EMP = "id, employee_code, first_name, last_name, display_name, department_id";
const RUN_COLS = `id, period_start, period_end, status, created_by, created_at, calculated_by, calculated_at, reviewed_by, reviewed_at,
  approved_by, approved_at, finalized_by, finalized_at, paid_by, paid_at, payment_reference, notes, updated_at,
  legal_entity_id, returned_by, returned_at, return_reason, payment_status, validation`;

// ------------------------------------------------------------ components
export async function listComponents({ activeOnly = false } = {}) {
  let q = from("hr_salary_components").select("*").order("sort_order").order("code");
  if (activeOnly) q = q.eq("active", true);
  return run(q);
}
export const verifyComponent = (id, note) => rpc("hr_verify_salary_component", { p_id: id, p_note: note?.trim() || null });

// ------------------------------------------------------------ structures
export async function listStructures(employeeId, { status = "" } = {}) {
  let q = from("hr_salary_structures")
    .select(`id, employee_id, effective_from, effective_to, annual_ctc, currency, pay_frequency, status, notes, created_at, created_by,
      submitted_by, submitted_at, approved_by, approved_at, rejected_at, decision_note, revision_of, revision_reason,
      employee:hr_employees!hr_salary_structures_employee_id_fkey(${EMP})`);
  if (employeeId) q = q.eq("employee_id", employeeId);
  if (status) q = q.eq("status", status);
  return run(q.order("effective_from", { ascending: false }).limit(2000));
}

/** Creates/edits a DRAFT structure. Activation goes through submit → approve. */
export async function saveStructure(row) {
  const body = {
    employee_id: row.employee_id, effective_from: row.effective_from, effective_to: row.effective_to || null,
    annual_ctc: Number(row.annual_ctc), currency: (row.currency || "INR").toUpperCase(), notes: row.notes?.trim() || null,
    ...(row.id ? {} : { status: "draft" }),
  };
  return row.id
    ? run(from("hr_salary_structures").update(body).eq("id", row.id).select("id").single())
    : run(from("hr_salary_structures").insert(body).select("id").single());
}

export async function listStructureItems(structureId) {
  return run(from("hr_salary_structure_items")
    .select("id, structure_id, component_id, amount, percent, component:hr_salary_components!hr_salary_structure_items_component_id_fkey(id, code, name, kind, calc_type, default_value, is_statutory, requires_verification, active, sort_order)")
    .eq("structure_id", structureId));
}

export async function saveStructureItem(row) {
  const body = {
    structure_id: row.structure_id, component_id: row.component_id,
    amount: row.amount === "" || row.amount == null ? null : Number(row.amount),
    percent: row.percent === "" || row.percent == null ? null : Number(row.percent),
  };
  return row.id
    ? run(from("hr_salary_structure_items").update({ amount: body.amount, percent: body.percent }).eq("id", row.id).select("id").single())
    : run(from("hr_salary_structure_items").insert(body).select("id").single());
}
export const deleteStructureItem = (id) => run(from("hr_salary_structure_items").delete().eq("id", id).select("id"));
export const archiveStructure = (id) => run(from("hr_salary_structures").update({ status: "archived" }).eq("id", id).select("id").single());
export const previewStructure = (id) => rpc("hr_salary_structure_preview", { p_structure: id });
export const submitStructure = (id, note) => rpc("hr_submit_salary_structure", { p_id: id, p_note: note?.trim() || null });
export const approveStructure = (id, note) => rpc("hr_approve_salary_structure", { p_id: id, p_note: note?.trim() || null });
export const rejectStructure = (id, reason) => rpc("hr_reject_salary_structure", { p_id: id, p_reason: reason?.trim() });
export const reviseStructure = ({ id, effectiveFrom, reason, annualCtc }) =>
  rpc("hr_create_salary_revision", { p_structure: id, p_effective_from: effectiveFrom, p_reason: reason?.trim(), p_annual_ctc: annualCtc === "" || annualCtc == null ? null : Number(annualCtc) });
export const endStructure = ({ id, effectiveTo, reason }) => rpc("hr_end_salary_structure", { p_id: id, p_effective_to: effectiveTo, p_reason: reason?.trim() });

// ------------------------------------------------------------ bank accounts
export async function listBankAccounts(employeeId) {
  let q = from("hr_employee_bank_accounts")
    .select(`id, employee_id, bank_name, account_holder, account_number, ifsc, is_primary, verified, verified_at, active, created_at, created_by,
      employee:hr_employees!hr_employee_bank_accounts_employee_id_fkey(${EMP})`);
  if (employeeId) q = q.eq("employee_id", employeeId);
  return run(q.order("created_at", { ascending: false }).limit(2000));
}

export async function saveBankAccount(row) {
  const body = {
    employee_id: row.employee_id, bank_name: row.bank_name?.trim(), account_holder: row.account_holder?.trim(),
    account_number: row.account_number?.replace(/\s+/g, ""), ifsc: row.ifsc?.trim().toUpperCase() || null,
    is_primary: Boolean(row.is_primary), active: row.active !== false,
  };
  return row.id
    ? run(from("hr_employee_bank_accounts").update(body).eq("id", row.id).select("id").single())
    : run(from("hr_employee_bank_accounts").insert(body).select("id").single());
}

export const maskAccount = (n) => (n ? `•••• ${String(n).slice(-4)}` : "—");
export const myBankAccounts = () => rpc("hr_my_bank_accounts");
export const verifyBankAccount = (id, note) => rpc("hr_verify_bank_account", { p_id: id, p_note: note?.trim() || null });

// ------------------------------------------------------------ runs
export const listRuns = () => run(from("hr_payroll_runs").select(RUN_COLS).order("period_start", { ascending: false }).limit(200));
export const getRun = (id) => run(from("hr_payroll_runs").select(RUN_COLS).eq("id", id).maybeSingle());

export async function listRunItems(runId) {
  return run(from("hr_payroll_items")
    .select(`id, run_id, employee_id, structure_id, currency, working_days, payable_days, lop_days, gross, total_deductions,
      employer_contributions, reimbursements, net, breakdown, created_at, employee:hr_employees!hr_payroll_items_employee_id_fkey(${EMP})`)
    .eq("run_id", runId).limit(5000));
}

export async function listRunAdjustments(runId) {
  return run(from("hr_payroll_adjustments")
    .select(`id, run_id, employee_id, component_id, label, amount, reason, source, source_run_id, created_at, created_by,
      status, decided_by, decided_at, decision_note, correction_request_id,
      employee:hr_employees!hr_payroll_adjustments_employee_id_fkey(${EMP})`)
    .eq("run_id", runId).order("created_at"));
}

/** Variable-pay / recovery entries waiting for a separate approver (all runs). */
export async function listPendingAdjustments() {
  return run(from("hr_payroll_adjustments")
    .select(`id, run_id, employee_id, label, amount, reason, created_at, created_by, status,
      employee:hr_employees!hr_payroll_adjustments_employee_id_fkey(${EMP}), run:hr_payroll_runs!hr_payroll_adjustments_run_id_fkey(id, period_start, period_end, status)`)
    .eq("status", "pending").order("created_at").limit(500));
}
export const decideAdjustment = (id, approve, note) => rpc("hr_decide_payroll_adjustment", { p_id: id, p_approve: approve, p_note: note?.trim() || null });

export async function listRunHolds(runId) {
  return run(from("hr_payroll_run_holds").select(`run_id, employee_id, reason, created_at, employee:hr_employees!hr_payroll_run_holds_employee_id_fkey(${EMP})`).eq("run_id", runId));
}
export const setHold = ({ runId, employee, hold, reason }) => rpc("hr_set_payroll_hold", { p_run: runId, p_employee: employee, p_hold: hold, p_reason: reason?.trim() || null });

/** Corrections recorded against this (finalized) run, wherever they landed. */
export async function listCorrectionsFromRun(runId) {
  return run(from("hr_payroll_adjustments")
    .select(`id, run_id, employee_id, label, amount, reason, source, source_run_id, created_at,
      employee:hr_employees!hr_payroll_adjustments_employee_id_fkey(${EMP})`)
    .eq("source_run_id", runId).order("created_at"));
}

export async function listRunPayslips(runId) {
  return run(from("hr_payslips").select("*").eq("run_id", runId).limit(5000));
}

export const createRun = ({ start, end, notes, legalEntity }) =>
  rpc("hr_create_payroll_run", { p_period_start: start, p_period_end: end, p_notes: notes?.trim() || null, p_legal_entity: legalEntity || null });
export const calculateRun = (id) => rpc("hr_calculate_payroll_run", { p_id: id });
export const reviewRun = (id, note) => rpc("hr_review_payroll_run", { p_id: id, p_note: note?.trim() || null });
export const returnRun = (id, reason) => rpc("hr_return_payroll_run", { p_id: id, p_reason: reason?.trim() });
export const approveRun = (id) => rpc("hr_approve_payroll_run", { p_id: id });
export const finalizeRun = (id) => rpc("hr_finalize_payroll_run", { p_id: id });
export const markRunPaid = (id, reference) => rpc("hr_mark_payroll_paid", { p_id: id, p_reference: reference?.trim() });
export const addAdjustment = ({ runId, employee, amount, reason, label, component }) =>
  rpc("hr_add_payroll_adjustment", {
    p_run_id: runId, p_employee: employee, p_amount: Number(amount), p_reason: reason?.trim(), p_label: label?.trim() || null, p_component: component || null,
  });
export const createCorrection = ({ runId, employee, amount, reason }) =>
  rpc("hr_create_payroll_correction", { p_run_id: runId, p_employee: employee, p_amount: Number(amount), p_reason: reason?.trim() });

// ------------------------------------------------------------ payments (status tracking only)
export async function listPayments({ runId = "", status = "" } = {}) {
  let q = from("hr_payroll_payments")
    .select(`id, run_id, item_id, employee_id, currency, amount, amount_paid, status, method, payment_date, reference, notes, failure_reason,
      recorded_by, recorded_at, reconciled_by, reconciled_at, reconciliation_note, updated_at,
      employee:hr_employees!hr_payroll_payments_employee_id_fkey(${EMP}), run:hr_payroll_runs!hr_payroll_payments_run_id_fkey(id, period_start, period_end, status, payment_status)`);
  if (runId) q = q.eq("run_id", runId);
  if (status) q = q.eq("status", status);
  return run(q.order("updated_at", { ascending: false }).limit(5000));
}
export const listPaymentEvents = (paymentId) =>
  run(from("hr_payroll_payment_events").select("id, from_status, to_status, amount_paid, method, reference, payment_date, note, actor_user_id, created_at")
    .eq("payment_id", paymentId).order("created_at"));
export const recordPayments = ({ ids, status, method, reference, paymentDate, amountPaid, note }) =>
  rpc("hr_record_payroll_payments", {
    p_payment_ids: ids, p_status: status, p_method: method || null, p_reference: reference?.trim() || null,
    p_payment_date: paymentDate || null, p_amount_paid: amountPaid === "" || amountPaid == null ? null : Number(amountPaid), p_note: note?.trim() || null,
  });
export const reconcilePayments = (ids, note) => rpc("hr_reconcile_payroll_payments", { p_payment_ids: ids, p_note: note?.trim() });

// ------------------------------------------------------------ statutory rules
export async function listStatutoryRules() {
  return run(from("hr_payroll_statutory_rules").select("*").order("code").order("effective_from", { ascending: false }));
}
export async function saveStatutoryRule(row) {
  const num = (v) => (v === "" || v == null ? null : Number(v));
  const body = {
    code: row.code?.trim().toUpperCase(), name: row.name?.trim(), scheme: row.scheme, country: (row.country || "IN").toUpperCase(),
    state_code: row.state_code?.trim().toUpperCase() || null, legal_entity_id: row.legal_entity_id || null,
    effective_from: row.effective_from, effective_to: row.effective_to || null, calc_method: row.calc_method,
    wage_base_components: row.wage_base_components ?? [], wage_ceiling: num(row.wage_ceiling), eligibility_wage_max: num(row.eligibility_wage_max),
    eligibility_basis: row.eligibility_basis || "wage_base", employee_rate: num(row.employee_rate), employer_rate: num(row.employer_rate),
    employee_amount: num(row.employee_amount), employer_amount: num(row.employer_amount), slabs: row.slabs ?? [],
    employee_component_code: row.employee_component_code || null, employer_component_code: row.employer_component_code || null,
    rounding_mode: row.rounding_mode || "half_up", rounding_precision: Number(row.rounding_precision ?? 2), applies_to: row.applies_to || "enrolled",
    legal_reference: row.legal_reference?.trim() || null, notes: row.notes?.trim() || null,
  };
  return row.id
    ? run(from("hr_payroll_statutory_rules").update(body).eq("id", row.id).select("id").single())
    : run(from("hr_payroll_statutory_rules").insert(body).select("id").single());
}
export const retireStatutoryRule = (id) => run(from("hr_payroll_statutory_rules").update({ status: "retired" }).eq("id", id).select("id").single());
export const endStatutoryRule = (id, effectiveTo) => run(from("hr_payroll_statutory_rules").update({ effective_to: effectiveTo }).eq("id", id).select("id").single());
export const submitStatutoryRule = (id) => rpc("hr_submit_statutory_rule", { p_id: id });
export const approveStatutoryRule = (id, reference) => rpc("hr_approve_statutory_rule", { p_id: id, p_validation_reference: reference?.trim() });
export const returnStatutoryRule = (id, reason) => rpc("hr_return_statutory_rule", { p_id: id, p_reason: reason?.trim() });

export async function listStatutoryEnrollments(ruleCode = "") {
  let q = from("hr_payroll_statutory_enrollments")
    .select(`id, employee_id, rule_code, enrolled, state_code, declared_monthly_amount, effective_from, effective_to, note, updated_at,
      employee:hr_employees!hr_payroll_statutory_enrollments_employee_id_fkey(${EMP})`);
  if (ruleCode) q = q.eq("rule_code", ruleCode);
  return run(q.order("effective_from", { ascending: false }).limit(5000));
}
export async function saveStatutoryEnrollment(row) {
  const body = {
    employee_id: row.employee_id, rule_code: row.rule_code, enrolled: row.enrolled !== false, state_code: row.state_code?.trim().toUpperCase() || null,
    declared_monthly_amount: row.declared_monthly_amount === "" || row.declared_monthly_amount == null ? null : Number(row.declared_monthly_amount),
    effective_from: row.effective_from, effective_to: row.effective_to || null, note: row.note?.trim() || null,
  };
  return row.id
    ? run(from("hr_payroll_statutory_enrollments").update(body).eq("id", row.id).select("id").single())
    : run(from("hr_payroll_statutory_enrollments").insert(body).select("id").single());
}

// ------------------------------------------------------------ correction requests
export async function listCorrectionRequests({ status = "" } = {}) {
  let q = from("hr_payroll_correction_requests")
    .select(`id, employee_id, run_id, payslip_id, raised_by, raised_via, category, description, evidence_note, status, proposed_amount,
      prepared_by, prepared_at, preparation_note, decided_by, decided_at, decision_note, adjustment_id, created_at,
      employee:hr_employees!hr_payroll_correction_requests_employee_id_fkey(${EMP}), run:hr_payroll_runs!hr_payroll_correction_requests_run_id_fkey(id, period_start, period_end)`);
  if (status) q = q.eq("status", status);
  return run(q.order("created_at", { ascending: false }).limit(2000));
}
export const createCorrectionRequest = ({ runId, employee, category, description, evidence }) =>
  rpc("hr_create_payroll_correction_request", { p_run: runId, p_employee: employee, p_category: category, p_description: description?.trim(), p_evidence: evidence?.trim() || null });
export const prepareCorrection = (id, amount, note) => rpc("hr_prepare_payroll_correction", { p_id: id, p_amount: Number(amount), p_note: note?.trim() });
export const decideCorrection = (id, approve, note) => rpc("hr_decide_payroll_correction", { p_id: id, p_approve: approve, p_note: note?.trim() || null });

// ------------------------------------------------------------ settlements, overview, reports
export async function listSettlementCoverage() {
  return run(from("hr_payroll_settlement_coverage")
    .select(`id, employee_id, exit_id, covered_through, settlement_reference, note, status, recorded_by, created_at, voided_at, void_reason,
      employee:hr_employees!hr_payroll_settlement_coverage_employee_id_fkey(${EMP})`)
    .order("created_at", { ascending: false }).limit(1000));
}
export const recordSettlementCoverage = ({ employee, coveredThrough, reference, note, exitId }) =>
  rpc("hr_record_settlement_coverage", { p_employee: employee, p_covered_through: coveredThrough, p_reference: reference?.trim(), p_note: note?.trim() || null, p_exit: exitId || null });
export const voidSettlementCoverage = (id, reason) => rpc("hr_void_settlement_coverage", { p_id: id, p_reason: reason?.trim() });

export const payrollOverview = ({ month, legalEntity, department, employee, status } = {}) =>
  rpc("hr_payroll_overview", { p_month: month || null, p_legal_entity: legalEntity || null, p_department: department || null, p_employee: employee || null, p_status: status || null });
export const statutoryReport = (runId) => rpc("hr_payroll_statutory_report", { p_run: runId });
export const postFinalizationChanges = (runId) => rpc("hr_payroll_post_finalization_changes", { p_run: runId });
/** Records an audit event for a payroll export (requires payroll.export). Call BEFORE downloading. */
export const logExport = (kind, runId, rows) => rpc("hr_log_payroll_export", { p_kind: kind, p_run: runId || null, p_rows: rows ?? null });

// ------------------------------------------------------------ employee self-service
export const mySalaryStructure = () => rpc("hr_my_salary_structure");
export const myPayrollPayments = () => rpc("hr_my_payroll_payments");
export const submitPayrollQuery = ({ payslipId, category, description, evidence }) =>
  rpc("hr_submit_payroll_query", { p_payslip: payslipId, p_category: category, p_description: description?.trim(), p_evidence: evidence?.trim() || null });
export async function listMyPayrollQueries(employeeId) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_payroll_correction_requests")
    .select("id, payslip_id, run_id, category, description, status, proposed_amount, decision_note, created_at, decided_at")
    .eq("employee_id", employeeId).order("created_at", { ascending: false }).limit(200));
}

// ------------------------------------------------------------ reimbursements
export async function listReimbursements({ status = "" } = {}) {
  let q = from("hr_reimbursements")
    .select(`id, employee_id, claim_date, category, amount, description, receipt_path, status, payroll_run_id, decided_at, decision_note, created_at,
      employee:hr_employees!hr_reimbursements_employee_id_fkey(${EMP})`);
  if (status) q = q.eq("status", status);
  return run(q.order("created_at", { ascending: status === "submitted" }).limit(2000));
}
export const decideReimbursement = (id, approve, note) => rpc("hr_decide_reimbursement", { p_id: id, p_approve: approve, p_note: note?.trim() || null });

export async function listMyReimbursements(employeeId) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_reimbursements")
    .select("id, claim_date, category, amount, description, receipt_path, status, decided_at, decision_note, created_at")
    .eq("employee_id", employeeId).order("created_at", { ascending: false }).limit(500));
}
// New claims are filed through HR Requests (Module 10, createWorkflowRequest("reimbursement", ...));
// the legacy hr_submit_reimbursement RPC refuses self-service submissions (migration 196).

// ------------------------------------------------------------ payslips
/** RLS returns only the caller's own payslips from finalized/paid runs (payroll.view sees all). */
export async function listMyPayslips(employeeId) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_payslips").select("*").eq("employee_id", employeeId).not("published_at", "is", null)
    .order("period_start", { ascending: false }).limit(240));
}
