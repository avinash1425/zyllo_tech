// Module 10 — HR Requests & Approvals: workflow requests (HR letters,
// reimbursements, salary advances, profile changes), the approval inbox and
// request files. Server-side RPCs (190_hr_requests_approvals.sql) enforce
// every rule; nothing here grants access.
//
// Integrations (the owning module stays authoritative):
//   * Attendance corrections: Module 5 table + RPCs. See requestAttendanceCorrection().
//   * Reimbursement payments: Payroll (Module 7) runs; status is read back only.
//   * Issued letters: Employee Documents (Module 9) or a restricted request file.
import { from, rpc, run, supabase } from "./client";
import { decideCorrection, requestCorrection } from "./attendance";
import { MARITAL_STATUSES } from "./employees";

export const REQUEST_FILE_BUCKET = "hr-request-files";
export const REQUEST_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const REQUEST_FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp";
const FILE_TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

export const WORKFLOW_LABELS = {
  helpdesk: "HR question",
  hr_letter: "HR letter",
  profile_change: "Profile change",
  reimbursement: "Reimbursement",
  salary_advance: "Salary advance",
  attendance_correction: "Attendance correction",
};
export const STAGE_LABELS = { manager: "Manager", hr: "HR", payroll: "Payroll", finance: "Finance" };
export const LETTER_TYPES = [
  { value: "employment_certificate", label: "Employment certificate" },
  { value: "experience_letter", label: "Experience letter" },
  { value: "salary_certificate", label: "Salary certificate" },
  { value: "address_confirmation", label: "Address confirmation letter" },
  { value: "other", label: "Other HR letter" },
];
// Values match Payroll's reimbursement categories (Module 7); labels follow Module 10.
export const REIMBURSEMENT_CATEGORIES = [
  { value: "travel", label: "Travel" },
  { value: "meals", label: "Meals" },
  { value: "internet", label: "Communication (phone / internet)" },
  { value: "equipment", label: "Office expenses" },
  { value: "medical", label: "Medical" },
  { value: "training", label: "Training" },
  { value: "other", label: "Other approved business expense" },
];
export const PROFILE_FIELDS = [
  { key: "phone", label: "Phone", type: "tel" },
  { key: "personal_email", label: "Personal email", type: "email" },
  { key: "address_line1", label: "Address line 1" },
  { key: "address_line2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "postal_code", label: "Postal code" },
  { key: "country", label: "Country (2-letter code)" },
  { key: "emergency_contact_name", label: "Emergency contact name" },
  { key: "emergency_contact_relation", label: "Emergency contact relation" },
  { key: "emergency_contact_phone", label: "Emergency contact phone", type: "tel" },
  { key: "nationality", label: "Nationality (2-letter code)" },
  { key: "marital_status", label: "Marital status", options: MARITAL_STATUSES },
];
export const INBOX_BOXES = [
  { value: "assigned", label: "Assigned to me" },
  { value: "pending", label: "Pending" },
  { value: "overdue", label: "Overdue" },
  { value: "approved", label: "Approved" },
  { value: "returned", label: "Returned" },
  { value: "rejected", label: "Rejected" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
];
export const NEXT_ACTION_LABELS = {
  decide: "Decision needed", respond: "Reply needed", issue_letter: "Issue letter",
  record_disbursement: "Record disbursement", verify_disbursement: "Verify disbursement", accept_agreement: "Accept agreement",
};
export const EVENT_LABELS = {
  created: "Draft created", updated: "Details updated", submitted: "Submitted", resubmitted: "Resubmitted",
  stage_approved: "Step approved", stage_rejected: "Step rejected", stage_returned: "Returned for correction", delegated: "Approval delegated",
  approved: "Approved", rejected: "Rejected", returned: "Returned", cancelled: "Cancelled", completed: "Completed",
  letter_issued: "Letter issued", profile_applied: "Changes applied", claim_recorded: "Claim recorded in Payroll", payment_status: "Payment update",
  agreement_accepted: "Agreement accepted", disbursement_recorded: "Disbursement recorded", disbursement_verified: "Disbursement verified",
  repayment_recorded: "Repayment recorded", attachment_added: "File added", attachment_removed: "File removed",
};

const label = (s) => String(s ?? "").replace(/_/g, " ");
export const workflowLabel = (w) => WORKFLOW_LABELS[w] ?? label(w);
export const stageLabel = (s) => STAGE_LABELS[s] ?? label(s);

// ------------------------------------------------------------------ reads
export const getRequestDetail = (id) => rpc("hr_request_detail", { p_request: id });
export const approvalInbox = (box = "assigned", filters = {}) => rpc("hr_approval_inbox", { p_box: box, p_filters: cleanFilters(filters) });
export const requestsOverview = (filters = {}) => rpc("hr_requests_overview", { p_filters: cleanFilters(filters) });
export const salaryAdvanceEligibility = () => rpc("hr_salary_advance_eligibility");
export const requestPolicies = () => rpc("hr_request_policies");
export const letterIssueOptions = (requestId) => rpc("hr_letter_issue_options", { p_request: requestId });
export const delegateOptions = (stageId) => rpc("hr_request_delegate_options", { p_stage: stageId });

function cleanFilters(f) {
  const out = {};
  for (const [k, v] of Object.entries(f ?? {})) if (v !== "" && v !== null && v !== undefined) out[k] = typeof v === "string" ? v.trim() : v;
  return out;
}

export async function listWorkflowCategories() {
  return run(from("hr_request_categories")
    .select("id, code, name, description, workflow, approval_stages, requires_attachment, sla_hours, active, default_assignee_role, sort_order")
    .order("sort_order").order("name"));
}

export async function listProjectOptions() {
  return run(from("hr_projects").select("id, code, name, status").neq("status", "archived").order("name").limit(500));
}

// ----------------------------------------------------------------- writes
/** Create a workflow request. submit=false keeps it as a draft (e.g. to attach receipts first). */
export const createWorkflowRequest = (category, details, sensitive = null, submit = true) =>
  rpc("hr_create_workflow_request", { p_category: category, p_details: details, p_sensitive: sensitive, p_submit: submit });
export const updateWorkflowRequest = (id, details, sensitive = null) =>
  rpc("hr_update_workflow_request", { p_request: id, p_details: details, p_sensitive: sensitive });
export const submitWorkflowRequest = (id, note) => rpc("hr_submit_workflow_request", { p_request: id, p_note: note?.trim() || null });
export const decideStage = (stageId, action, comment) =>
  rpc("hr_decide_request_stage", { p_stage: stageId, p_action: action, p_comment: comment?.trim() || null });
export const delegateStage = (stageId, delegateId, reason) =>
  rpc("hr_delegate_request_stage", { p_stage: stageId, p_delegate: delegateId, p_reason: reason?.trim() || null });
export const issueLetter = (id, { documentId = null, attachmentId = null, note = "" } = {}) =>
  rpc("hr_issue_letter_request", { p_request: id, p_document: documentId, p_attachment: attachmentId, p_note: note?.trim() || null });
export const acceptAdvanceAgreement = (id, authorizeDeduction = false) =>
  rpc("hr_accept_advance_agreement", { p_request: id, p_authorize_payroll_deduction: Boolean(authorizeDeduction) });
export const recordAdvanceDisbursement = (id, { amount, reference, paidOn, attachmentId = null }) =>
  rpc("hr_record_advance_disbursement", { p_request: id, p_amount: Number(amount), p_reference: reference?.trim(), p_paid_on: paidOn, p_attachment: attachmentId });
export const verifyAdvanceDisbursement = (id) => rpc("hr_verify_advance_disbursement", { p_request: id });
export const recordAdvanceRepayment = (id, { amount, method, reference, paidOn, payrollRunId = null, note = "" }) =>
  rpc("hr_record_advance_repayment", { p_request: id, p_amount: Number(amount), p_method: method, p_reference: reference?.trim(),
    p_paid_on: paidOn, p_payroll_run: payrollRunId || null, p_note: note?.trim() || null });
export const setCategoryRouting = (categoryId, stages, requiresAttachment, slaHours) =>
  rpc("hr_set_request_category_routing", { p_category: categoryId, p_stages: stages, p_requires_attachment: requiresAttachment,
    p_sla_hours: slaHours ? Number(slaHours) : null });
export const saveRequestPolicy = (key, value) => rpc("hr_save_request_policy", { p_key: key, p_value: value });

// ------------------------------------------------------------------ files
export function checkRequestFile(file) {
  if (!file) return { error: "Choose a file." };
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const mime = FILE_TYPES[ext];
  if (!mime) return { error: "Only PDF, PNG, JPEG and WEBP files can be attached." };
  if (file.type && file.type !== mime && !(mime === "image/jpeg" && file.type === "image/jpg")) return { error: "The file extension does not match its type." };
  if (file.size <= 0) return { error: "The file is empty." };
  if (file.size > REQUEST_FILE_MAX_BYTES) return { error: "The file is larger than 10 MB." };
  return { mime };
}

async function sha256Hex(file) {
  try {
    if (!globalThis.crypto?.subtle || !file.arrayBuffer) return null;
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;   // duplicate-receipt detection is best effort
  }
}

/**
 * Register a file on the server (which decides who may attach what), then
 * upload it to the exact private path returned. The checksum lets the server
 * refuse a receipt that was already used on another claim.
 */
export async function uploadRequestFile(requestId, kind, file) {
  const chk = checkRequestFile(file);
  if (chk.error) return { data: null, error: chk.error };
  const checksum = await sha256Hex(file);
  const reg = await rpc("hr_register_request_attachment", { p_request: requestId, p_kind: kind, p_file_name: file.name,
    p_mime_type: chk.mime, p_size_bytes: file.size, p_checksum: checksum });
  if (reg.error) return reg;
  try {
    const { error } = await supabase.storage.from(REQUEST_FILE_BUCKET).upload(reg.data.storage_path, file, { upsert: false, contentType: chk.mime });
    if (error) return { data: reg.data, error: `The file was registered, but the upload failed: ${error.message}. Remove it and try again.` };
  } catch (e) {
    return { data: reg.data, error: `The file was registered, but the upload failed: ${e?.message ?? "network error"}. Remove it and try again.` };
  }
  return { data: reg.data, error: null };
}

export const removeRequestFile = (attachmentId) => rpc("hr_remove_request_attachment", { p_attachment: attachmentId });

export async function getRequestFileUrl(attachment, download = false) {
  if (!attachment?.storage_path) return { data: null, error: "No file is available." };
  try {
    const { data, error } = await supabase.storage.from(REQUEST_FILE_BUCKET)
      .createSignedUrl(attachment.storage_path, 60, download ? { download: attachment.file_name } : undefined);
    if (error) return { data: null, error: "You cannot open this file." };
    return { data: data.signedUrl, error: null };
  } catch {
    return { data: null, error: "Network error: could not reach the server." };
  }
}

// ------------------------------------------------- Module 5 adapter (attendance)
/**
 * Attendance corrections stay in Module 5. Use the typed regularization RPC
 * (migration 125) when it is deployed; otherwise the 101 correction RPC.
 * type: missed_punch_in | missed_punch_out | incorrect_time
 */
export async function requestAttendanceCorrection({ workDate, type, checkIn, checkOut, reason, evidence }) {
  const res = await rpc("hr_request_attendance_regularization", {
    p_work_date: workDate, p_request_type: type, p_check_in: checkIn || null, p_check_out: checkOut || null,
    p_requested_status: null, p_reason: reason?.trim(), p_evidence: evidence?.trim() || null,
  });
  if (!res.error || !/could not find the function|PGRST202|function .* does not exist/i.test(res.error)) return res;
  const why = [reason?.trim(), evidence?.trim() ? `Evidence: ${evidence.trim()}` : null].filter(Boolean).join(" — ");
  return requestCorrection({ workDate, checkIn, checkOut, reason: why });
}
export const decideAttendanceCorrection = (id, approve, note) => decideCorrection(id, approve, note);
