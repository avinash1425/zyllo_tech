// Leave management data layer (migrations 103 + 160). Day counts, balances,
// policy rules and the approval flow are computed by the server; the browser
// only previews the day count via hr_leave_calculate_days. Holidays are
// master data (leave.manage). Leave policies change only through the
// maker-checker RPCs (hr_propose_leave_policy / hr_decide_leave_policy);
// everything else is RPC-only.
import { from, rpc, run } from "./client";

export const LEAVE_STATUSES = ["pending_approval", "approved", "rejected", "cancelled"];
export const HOLIDAY_TYPES = ["national", "regional", "optional", "company"];
export const LEAVE_EVENT_LABELS = {
  applied: "Applied", manager_approved: "Approved by manager", approved: "Approved", rejected: "Rejected",
  clarification_requested: "Clarification requested", clarification_response: "Clarification response", cancelled: "Cancelled",
  holiday_changed: "Holiday calendar changed", recalculated: "Recalculated",
};
export const ACCRUAL_LABELS = { annual: "Annual (full entitlement on 1 Jan)", quarterly: "Quarterly (1/4 per quarter)", monthly: "Monthly (1/12 per month)", none: "None (no balance)" };
export const LEDGER_LABELS = {
  create: "Balance created", accrual: "Accrual", opening: "Opening balance", carry_forward: "Carry forward", adjustment: "Adjustment",
  reserve: "Reserved (pending)", release: "Released", consume: "Approved (used)", restore: "Restored", expiry: "Expired",
  recalculation: "Recalculated", year_end: "Year-end", system: "System",
};
export const LEAVE_DOC_CATEGORY = "leave_supporting";

const EMP = "id, employee_code, first_name, last_name, display_name, department_id, manager_id";
const TYPE_COLS = "id, code, name, description, paid, annual_entitlement, accrual, carry_forward_max, carry_forward_expiry_months, allow_half_day, requires_document_after_days, allow_during_probation, allow_negative, max_negative, counts_weekends, counts_holidays, active, sort_order, eligible_employment_types, min_days_per_request, max_days_per_request, min_notice_days, effective_from, effective_to, policy_version";
const REQ_COLS = `id, employee_id, leave_type_id, start_date, end_date, start_half, end_half, days, year, reason, document_path, status,
  current_level, manager_approved_at, decided_at, decision_note, cancelled_at, created_at, updated_at, document_id, policy_version,
  holiday_review_required`;

export async function listLeaveTypes({ activeOnly = false } = {}) {
  let q = from("hr_leave_types").select(TYPE_COLS).order("sort_order").order("code");
  if (activeOnly) q = q.eq("active", true);
  return run(q);
}

export async function listHolidays({ from: f, to } = {}) {
  let q = from("hr_holidays").select("id, holiday_date, name, type, location_id, legal_entity_id").order("holiday_date");
  if (f) q = q.gte("holiday_date", f);
  if (to) q = q.lte("holiday_date", to);
  return run(q);
}

// ------------------------------------------------------------ self service
export const myBalances = (year) => rpc("hr_my_leave_balances", { p_year: year ?? null });
/** Active leave types with my eligibility (eligibility_issue / probation_restricted). */
export const myLeaveTypes = () => rpc("hr_my_leave_types");
/** Holidays that apply to me (my location and company), recurring ones expanded. `all` (HR): every holiday. */
export const myHolidays = (fromDate, toDate, { all = false } = {}) => rpc("hr_my_holidays", { p_from: fromDate, p_to: toDate, p_all: all });

export const calculateDays = ({ type, start, end, startHalf, endHalf, employee }) =>
  rpc("hr_leave_calculate_days", {
    p_leave_type: type, p_start: start, p_end: end, p_start_half: Boolean(startHalf), p_end_half: Boolean(endHalf), p_employee: employee || null,
  });

export const applyLeave = ({ type, start, end, reason, startHalf, endHalf, documentPath, documentId }) =>
  rpc("hr_apply_leave", {
    p_leave_type: type, p_start: start, p_end: end, p_reason: reason?.trim(), p_start_half: Boolean(startHalf),
    p_end_half: Boolean(endHalf), p_document_path: documentPath?.trim() || null, p_document_id: documentId || null,
  });

export const cancelLeave = (id, note) => rpc("hr_cancel_leave", { p_id: id, p_note: note?.trim() || null });
export const respondClarification = (id, note) => rpc("hr_respond_leave_clarification", { p_id: id, p_note: note?.trim() });

export async function listMyRequests(employeeId) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_leave_requests")
    .select(`${REQ_COLS}, leave_type:hr_leave_types!hr_leave_requests_leave_type_id_fkey(id, code, name, paid)`)
    .eq("employee_id", employeeId).order("start_date", { ascending: false }).limit(500));
}

export async function listRequestEvents(requestId) {
  return run(from("hr_leave_request_events").select("id, request_id, action, from_status, to_status, level, note, actor_employee_id, created_at")
    .eq("request_id", requestId).order("created_at"));
}

/** Requests with an outstanding clarification (last clarification event is a question). */
export function pendingClarification(events) {
  const relevant = (events ?? []).filter((e) => e.action === "clarification_requested" || e.action === "clarification_response");
  return relevant.length > 0 && relevant[relevant.length - 1].action === "clarification_requested";
}

/** Team calendar, scoped by the server. Rows with visibility "limited" carry no leave type. */
export const leaveCalendar = (fromDate, toDate, { department = null, employee = null, legalEntity = null, includePending = true } = {}) =>
  rpc("hr_leave_calendar", { p_from: fromDate, p_to: toDate, p_department: department || null, p_employee: employee || null,
    p_legal_entity: legalEntity || null, p_include_pending: includePending });

// ------------------------------------------------------------ HR / approvers
export const leaveOverview = ({ from: f = null, to = null, department = "", type = "", legalEntity = "", employee = "" } = {}) =>
  rpc("hr_leave_overview", { p_from: f || null, p_to: to || null, p_department: department || null, p_leave_type: type || null,
    p_legal_entity: legalEntity || null, p_employee: employee || null });

export async function listRequests({ status = "", type = "", employee = "", from: f, to, review = false } = {}) {
  let q = from("hr_leave_requests").select(`${REQ_COLS},
    employee:hr_employees!hr_leave_requests_employee_id_fkey(${EMP}),
    leave_type:hr_leave_types!hr_leave_requests_leave_type_id_fkey(id, code, name, paid)`);
  if (status) q = q.eq("status", status);
  if (type) q = q.eq("leave_type_id", type);
  if (employee) q = q.eq("employee_id", employee);
  if (f) q = q.gte("end_date", f);
  if (to) q = q.lte("start_date", to);
  if (review) q = q.eq("holiday_review_required", true);
  return run(q.order("start_date", { ascending: status === "pending_approval" }).limit(3000));
}

export const recalculateLeave = (id, note) => rpc("hr_recalculate_leave_request", { p_id: id, p_note: note?.trim() || null });

export const decideLeave = (id, approve, note) => rpc("hr_decide_leave", { p_id: id, p_approve: approve, p_note: note?.trim() || null });
export const requestClarification = (id, note) => rpc("hr_request_leave_clarification", { p_id: id, p_note: note?.trim() });

export async function listBalances({ year, employee = "", type = "" } = {}) {
  let q = from("hr_leave_balances").select(`id, employee_id, leave_type_id, year, entitled, accrued, carried_forward, adjusted, used, pending, available, opening, cf_expires_on, cf_expired,
    employee:hr_employees!hr_leave_balances_employee_id_fkey(${EMP}),
    leave_type:hr_leave_types!hr_leave_balances_leave_type_id_fkey(id, code, name, sort_order)`).eq("year", year);
  if (employee) q = q.eq("employee_id", employee);
  if (type) q = q.eq("leave_type_id", type);
  return run(q.limit(5000));
}

export async function listAdjustments({ employee, year }) {
  let q = from("hr_leave_balance_adjustments")
    .select("id, employee_id, leave_type_id, year, kind, delta, reason, created_at, leave_type:hr_leave_types!hr_leave_balance_adjustments_leave_type_id_fkey(code, name)")
    .eq("year", year);
  if (employee) q = q.eq("employee_id", employee);
  return run(q.order("created_at", { ascending: false }).limit(500));
}

export const adjustBalance = ({ employee, type, year, delta, reason }) =>
  rpc("hr_adjust_leave_balance", { p_employee: employee, p_leave_type: type, p_year: Number(year), p_delta: Number(delta), p_reason: reason?.trim() });
export const initializeLeaveYear = (year) => rpc("hr_initialize_leave_year", { p_year: Number(year) });
export const setOpeningBalance = ({ employee, type, year, days, reason }) =>
  rpc("hr_set_opening_leave_balance", { p_employee: employee, p_leave_type: type, p_year: Number(year), p_days: Number(days), p_reason: reason?.trim() });
export const processLeaveExpiry = (year) => rpc("hr_process_leave_expiry", { p_year: year ? Number(year) : null });
export const closeLeaveYear = (year) => rpc("hr_close_leave_year", { p_year: Number(year) });
export const listLeaveYears = () => run(from("hr_leave_years").select("year, status, closed_at, summary").order("year", { ascending: false }));

/** Balance ledger (every change to every bucket), newest first. */
export async function listLedger({ employee, year, type = "" }) {
  let q = from("hr_leave_ledger").select("id, balance_id, leave_type_id, year, bucket, entry_type, amount, effect, available_after, request_id, reason, created_at, leave_type:hr_leave_types!hr_leave_ledger_leave_type_id_fkey(code, name)")
    .eq("employee_id", employee).eq("year", year);
  if (type) q = q.eq("leave_type_id", type);
  return run(q.order("id", { ascending: false }).limit(500));
}

// ------------------------------------------------------------ policies (maker-checker)
export const POLICY_FIELDS = ["name", "description", "paid", "annual_entitlement", "accrual", "carry_forward_max", "carry_forward_expiry_months",
  "allow_half_day", "requires_document_after_days", "allow_during_probation", "allow_negative", "max_negative", "counts_weekends",
  "counts_holidays", "active", "sort_order", "eligible_employment_types", "min_days_per_request", "max_days_per_request", "min_notice_days",
  "effective_from", "effective_to"];

export const proposePolicy = ({ leaveType = null, changes, reason, effectiveFrom = null }) =>
  rpc("hr_propose_leave_policy", { p_leave_type: leaveType, p_changes: changes, p_reason: reason?.trim(), p_effective_from: effectiveFrom || null });
export const decidePolicy = (id, approve, note) => rpc("hr_decide_leave_policy", { p_change: id, p_approve: approve, p_note: note?.trim() || null });
export const withdrawPolicy = (id) => rpc("hr_withdraw_leave_policy_change", { p_change: id });
export function listPolicyChanges({ status = "" } = {}) {
  let q = from("hr_leave_policy_changes").select("id, leave_type_id, action, proposed, previous, base_version, reason, effective_from, status, proposed_by, proposed_at, decided_by, decided_at, decision_note, applied_version");
  if (status) q = q.eq("status", status);
  return run(q.order("proposed_at", { ascending: false }).limit(200));
}
export const listPolicyVersions = (leaveType) =>
  run(from("hr_leave_policy_versions").select("id, version, snapshot, effective_from, change_id, created_at").eq("leave_type_id", leaveType).order("version", { ascending: false }));

/** "Full day" / "2nd half" style labels for a request. */
export function halfLabel(r) {
  if (!r) return "";
  if (r.start_date === r.end_date) return r.start_half ? "Second half" : r.end_half ? "First half" : "Full day";
  const parts = [];
  if (r.start_half) parts.push("starts 2nd half");
  if (r.end_half) parts.push("ends 1st half");
  return parts.join(", ");
}
