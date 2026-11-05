// Onboarding & Employee Exit (HRMS module 4). Tables are read-only for
// clients (RLS); every state change is a SECURITY DEFINER RPC from
// supabase/migrations/130_hr_onboarding_exit.sql. Exit cases themselves stay
// in ./exits.js (Exit Management is reused, not duplicated).
import { from, rpc, run } from "./client";

export const TASK_CATEGORIES = [
  { value: "pre_joining", label: "Pre-joining" },
  { value: "documents", label: "Documents" },
  { value: "it_setup", label: "IT setup" },
  { value: "equipment", label: "Equipment" },
  { value: "orientation", label: "Orientation" },
  { value: "policy", label: "Policy briefing" },
  { value: "induction", label: "Induction session" },
  { value: "compliance", label: "Compliance / acknowledgement" },
  { value: "payroll", label: "Payroll" },
  { value: "other", label: "Other" },
];
export const INDUCTION_CATEGORIES = ["orientation", "policy", "induction", "it_setup", "equipment", "compliance"];
export const TASK_KINDS = [
  { value: "manual", label: "Manual check" },
  { value: "documents", label: "Required documents verified" },
  { value: "training", label: "Linked training" },
  { value: "asset", label: "Equipment (Assets)" },
  { value: "acknowledgement", label: "Employee acknowledgement" },
];
export const OWNER_ROLES = [
  { value: "hr", label: "HR" }, { value: "manager", label: "Reporting manager" }, { value: "it", label: "IT" },
  { value: "payroll", label: "Payroll" }, { value: "employee", label: "Employee" },
];
export const JOINING_STATUSES = [
  { value: "awaiting_joining", label: "Awaiting joining" }, { value: "joined", label: "Joined" },
  { value: "deferred", label: "Deferred" }, { value: "no_show", label: "No-show" },
];
export const SETTLEMENT_LINE_TYPES = [
  { value: "salary_due", label: "Salary due", earning: true },
  { value: "unpaid_salary", label: "Approved unpaid salary", earning: true },
  { value: "leave_encashment", label: "Leave encashment", earning: true },
  { value: "reimbursement", label: "Approved reimbursement", earning: true },
  { value: "notice_pay", label: "Notice pay (in lieu)", earning: true },
  { value: "bonus", label: "Bonus / incentive", earning: true },
  { value: "other_earning", label: "Other earning", earning: true },
  { value: "notice_recovery", label: "Notice period recovery", earning: false },
  { value: "asset_recovery", label: "Asset recovery", earning: false },
  { value: "advance_recovery", label: "Advance / loan recovery", earning: false },
  { value: "other_deduction", label: "Other deduction", earning: false },
];
export const isEarning = (type) => SETTLEMENT_LINE_TYPES.find((t) => t.value === type)?.earning ?? false;
export const lineTypeLabel = (type) => SETTLEMENT_LINE_TYPES.find((t) => t.value === type)?.label ?? String(type ?? "").replace(/_/g, " ");

/** Resignation request status as shown to people (Submitted → Under review → Approved / Rejected / Withdrawn). */
export function resignationStatus(exit) {
  if (!exit) return null;
  if (exit.status === "submitted") return "submitted";
  if (["manager_review", "hr_review"].includes(exit.status)) return "under_review";
  if (["notice_period", "clearance", "final_settlement", "closed"].includes(exit.status)) return "approved";
  return exit.status; // rejected | withdrawn
}

const EMP = "id, employee_code, first_name, last_name, display_name, status, user_id, manager_id, employment_type, probation_end_date, joining_date, confirmation_date";
const CASE_COLS = `*, employee:hr_employees!hr_onboarding_cases_employee_id_fkey(${EMP}),
  coordinator:hr_employees!hr_onboarding_cases_hr_coordinator_id_fkey(id, employee_code, first_name, last_name, display_name),
  manager:hr_employees!hr_onboarding_cases_reporting_manager_id_fkey(id, employee_code, first_name, last_name, display_name),
  department:hr_departments!hr_onboarding_cases_department_id_fkey(id, name),
  designation:hr_designations!hr_onboarding_cases_designation_id_fkey(id, name)`;

// ------------------------------------------------------------- overview
export const lifecycleOverview = () => rpc("hr_lifecycle_overview");
export const myLifecycle = () => rpc("hr_my_lifecycle");

// ------------------------------------------------------------ onboarding
export async function listOnboardingCases({ status = "open" } = {}) {
  let q = from("hr_onboarding_cases").select(`${CASE_COLS}, tasks:hr_onboarding_tasks!hr_onboarding_tasks_case_id_fkey(id, status, mandatory, due_date)`)
    .order("joining_date", { ascending: true, nullsFirst: false }).limit(500);
  if (status) q = q.eq("status", status);
  return run(q);
}
export async function getOnboardingCase(id) {
  return run(from("hr_onboarding_cases").select(CASE_COLS).eq("id", id).maybeSingle());
}
export async function getOnboardingTasks(caseId) {
  return run(from("hr_onboarding_tasks")
    .select("*, assignee:hr_employees!hr_onboarding_tasks_assignee_employee_id_fkey(id, employee_code, first_name, last_name, display_name)")
    .eq("case_id", caseId).order("sort_order"));
}
export async function getOnboardingEvents(caseId) {
  return run(from("hr_onboarding_events").select("id, task_id, event_type, note, actor_user_id, created_at").eq("case_id", caseId).order("created_at"));
}
/** Open induction tasks across open cases (Induction page). */
export async function listInductionTasks({ status = "open" } = {}) {
  let q = from("hr_onboarding_tasks")
    .select(`*, case:hr_onboarding_cases!hr_onboarding_tasks_case_id_fkey!inner(id, status, joining_date, employee:hr_employees!hr_onboarding_cases_employee_id_fkey(${EMP})),
             assignee:hr_employees!hr_onboarding_tasks_assignee_employee_id_fkey(id, employee_code, first_name, last_name, display_name)`)
    .in("category", INDUCTION_CATEGORIES).eq("case.status", "open").order("due_date", { ascending: true, nullsFirst: false }).limit(1000);
  if (status === "open") q = q.in("status", ["pending", "in_progress"]);
  return run(q);
}
export async function listOnboardingTemplates() {
  return run(from("hr_onboarding_templates").select("id, code, name, description, employment_types, active, sort_order").order("sort_order"));
}
export async function listTemplateTasks(templateId) {
  return run(from("hr_onboarding_template_tasks").select("*").eq("template_id", templateId).order("sort_order"));
}
export async function saveTemplateTask(values, id) {
  const row = {
    template_id: values.template_id, title: values.title?.trim(), description: values.description?.trim() || null, category: values.category,
    task_kind: values.task_kind, owner_role: values.owner_role, due_offset_days: Number(values.due_offset_days) || 0,
    mandatory: Boolean(values.mandatory), requires_evidence: Boolean(values.requires_evidence), visible_to_employee: Boolean(values.visible_to_employee),
    active: values.active !== false, sort_order: Number(values.sort_order) || 0,
  };
  return id ? run(from("hr_onboarding_template_tasks").update(row).eq("id", id).select().single())
            : run(from("hr_onboarding_template_tasks").insert(row).select().single());
}

export const createOnboardingCase = ({ employee, template, coordinator, notes }) =>
  rpc("hr_create_onboarding_case", { p_employee: employee, p_template: template || null, p_coordinator: coordinator || null, p_notes: notes?.trim() || null });
export const updateOnboardingCase = (id, v) => rpc("hr_update_onboarding_case", {
  p_case: id, p_joining_date: v.joining_date || null, p_coordinator: v.coordinator || null, p_manager: v.manager || null,
  p_department: v.department || null, p_designation: v.designation || null, p_notes: v.notes === undefined ? null : v.notes,
});
export const setJoiningStatus = (id, status, date, note) => rpc("hr_set_joining_status", { p_case: id, p_status: status, p_date: date || null, p_note: note?.trim() || null });
export const addOnboardingTask = (caseId, v) => rpc("hr_add_onboarding_task", {
  p_case: caseId, p_title: v.title?.trim(), p_category: v.category, p_owner_role: v.owner_role, p_due_date: v.due_date || null,
  p_assignee: v.assignee || null, p_mandatory: Boolean(v.mandatory), p_kind: v.kind, p_visible: Boolean(v.visible),
  p_description: v.description?.trim() || null, p_requires_evidence: Boolean(v.requires_evidence),
});
export const assignOnboardingTask = (id, assignee, due) => rpc("hr_assign_onboarding_task", { p_task: id, p_assignee: assignee || null, p_due_date: due || null });
export const linkTaskAsset = (id, assignment) => rpc("hr_link_onboarding_task", { p_task: id, p_asset_assignment: assignment, p_training_course: null });
export const linkTaskTraining = (id, course) => rpc("hr_link_onboarding_task", { p_task: id, p_asset_assignment: null, p_training_course: course });
export const completeOnboardingTask = (id, note, documentId) => rpc("hr_complete_onboarding_task", { p_task: id, p_evidence_note: note?.trim() || null, p_evidence_document: documentId || null });
export const reopenOnboardingTask = (id, note) => rpc("hr_reopen_onboarding_task", { p_task: id, p_note: note?.trim() || null });
export const waiveOnboardingTask = (id, reason) => rpc("hr_waive_onboarding_task", { p_task: id, p_reason: reason?.trim() });
export const acknowledgeOnboardingTask = (id) => rpc("hr_acknowledge_onboarding_task", { p_task: id });
export const completeOnboarding = (id, note) => rpc("hr_complete_onboarding", { p_case: id, p_note: note?.trim() || null });
export const cancelOnboarding = (id, reason) => rpc("hr_cancel_onboarding", { p_case: id, p_reason: reason?.trim() });
export const onboardingDocumentQueue = () => rpc("hr_onboarding_document_queue");

// -------------------------------------------------------------- probation
export async function listProbationReviews({ scope = "open" } = {}) {
  let q = from("hr_probation_reviews")
    .select(`*, employee:hr_employees!hr_probation_reviews_employee_id_fkey(${EMP}),
             manager:hr_employees!hr_probation_reviews_manager_id_fkey(id, employee_code, first_name, last_name, display_name)`)
    .order("due_date").limit(500);
  if (scope === "open") q = q.in("status", ["pending_manager", "pending_hr"]);
  else if (scope === "decided") q = q.in("status", ["decided", "cancelled"]);
  return run(q);
}
export async function getProbationEvents(reviewId) {
  return run(from("hr_probation_events").select("id, event_type, note, created_at").eq("review_id", reviewId).order("created_at"));
}
export async function listProbationEmployees() {
  return run(from("hr_employees").select("id, employee_code, first_name, last_name, display_name, status, joining_date, probation_end_date, manager_id")
    .in("status", ["onboarding", "probation"]).order("probation_end_date", { ascending: true, nullsFirst: false }).limit(1000));
}
export const openProbationReview = (employee, due) => rpc("hr_open_probation_review", { p_employee: employee, p_due_date: due || null });
export const generateProbationReviews = (days) => rpc("hr_generate_probation_reviews", { p_days: days === "" || days == null ? null : Number(days) });
export const submitProbationFeedback = (id, v) => rpc("hr_submit_probation_feedback", { p_review: id, p_rating: Number(v.rating), p_recommendation: v.recommendation, p_feedback: v.feedback?.trim() });
export const decideProbation = (id, v) => rpc("hr_decide_probation", {
  p_review: id, p_decision: v.decision, p_reason: v.reason?.trim(), p_effective_date: v.effective_date || null,
  p_extend_to: v.extend_to || null, p_last_working_day: v.last_working_day || null, p_hr_comments: v.hr_comments?.trim() || null,
});
export const cancelProbationReview = (id, reason) => rpc("hr_cancel_probation_review", { p_review: id, p_reason: reason?.trim() });

// ------------------------------------------------------------- clearance
export async function listClearanceExits({ scope = "clearance" } = {}) {
  let q = from("hr_exits").select(`id, employee_id, exit_type, status, approved_last_working_day, access_revocation_status, auth_access_revoked_at,
      employee:hr_employees!hr_exits_employee_id_fkey(id, employee_code, first_name, last_name, display_name, user_id),
      items:hr_exit_clearance_items!hr_exit_clearance_items_exit_id_fkey(id, item_key, status, department, due_date, mandatory)`)
    .order("approved_last_working_day", { ascending: true, nullsFirst: false }).limit(500);
  q = scope === "clearance" ? q.in("status", ["clearance", "final_settlement"]) : q.eq("status", "closed");
  return run(q);
}
export const grantClearanceException = (itemId, reason) => rpc("hr_grant_clearance_exception", { p_item: itemId, p_reason: reason?.trim() });
export async function listAccessRevocationAttempts(exitId) {
  return run(from("hr_exit_access_revocations").select("id, outcome, detail, created_at").eq("exit_id", exitId).order("created_at"));
}

// ------------------------------------------------------------- settlement
export async function listSettlements({ status = "" } = {}) {
  let q = from("hr_payroll_settlements")
    .select("id, exit_id, employee_id, status, currency, net_amount, total_earnings, total_deductions, last_working_day, prepared_at, submitted_at, approved_at, paid_on, employee:hr_employees!hr_payroll_settlements_employee_id_fkey(id, employee_code, first_name, last_name, display_name)")
    .neq("status", "cancelled").order("created_at", { ascending: false }).limit(500);
  if (status) q = q.eq("status", status);
  return run(q);
}
export async function getSettlement(id) {
  return run(from("hr_payroll_settlements")
    .select("*, employee:hr_employees!hr_payroll_settlements_employee_id_fkey(id, employee_code, first_name, last_name, display_name), exit:hr_exits!hr_payroll_settlements_exit_id_fkey(id, status, exit_type, resignation_date, notice_period_days, approved_last_working_day)")
    .eq("id", id).maybeSingle());
}
export async function getSettlementLines(id) {
  return run(from("hr_payroll_settlement_lines").select("*").eq("settlement_id", id).order("sort_order"));
}
/** Exits that reached clearance and have no live settlement yet. */
export async function listExitsAwaitingSettlement() {
  const [exits, settlements] = await Promise.all([
    run(from("hr_exits").select("id, employee_id, status, approved_last_working_day, employee:hr_employees!hr_exits_employee_id_fkey(id, employee_code, first_name, last_name, display_name)")
      .in("status", ["clearance", "final_settlement"]).order("approved_last_working_day")),
    run(from("hr_payroll_settlements").select("exit_id").neq("status", "cancelled")),
  ]);
  if (exits.error || settlements.error) return { data: null, error: exits.error || settlements.error };
  const taken = new Set((settlements.data ?? []).map((s) => s.exit_id));
  return { data: (exits.data ?? []).filter((x) => !taken.has(x.id)), error: null };
}
export const prepareSettlement = (exitId) => rpc("hr_prepare_settlement", { p_exit: exitId });
export const saveSettlementLine = (settlementId, lineId, v) => rpc("hr_save_settlement_line", {
  p_settlement: settlementId, p_line: lineId || null, p_line_type: v.line_type, p_label: v.label?.trim(), p_amount: Number(v.amount),
  p_quantity: v.quantity === "" || v.quantity == null ? null : Number(v.quantity), p_rate: v.rate === "" || v.rate == null ? null : Number(v.rate),
  p_note: v.note?.trim() || null,
});
export const deleteSettlementLine = (lineId) => rpc("hr_delete_settlement_line", { p_line: lineId });
export const submitSettlement = (id, notes) => rpc("hr_submit_settlement", { p_settlement: id, p_notes: notes?.trim() || null });
export const approveSettlement = (id, approve, note) => rpc("hr_approve_settlement", { p_settlement: id, p_approve: approve, p_note: note?.trim() || null });
export const markSettlementPaid = (id, reference, paidOn) => rpc("hr_mark_settlement_paid", { p_settlement: id, p_reference: reference?.trim(), p_paid_on: paidOn || null });
export const cancelSettlement = (id, reason) => rpc("hr_cancel_settlement", { p_settlement: id, p_reason: reason?.trim() });
export const settlementStatement = (id) => rpc("hr_settlement_statement", { p_settlement: id });
export const exitSettlementStatus = (exitId) => rpc("hr_exit_settlement_status", { p_exit: exitId });
