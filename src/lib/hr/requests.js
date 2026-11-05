// HR helpdesk requests. Reads are RLS-filtered (requester, hr_requests.view
// for non-confidential, hr_requests.manage for all; internal notes hidden
// from the requester). All writes are RPCs; categories are master data.
import { from, rpc, run } from "./client";

export const REQUEST_PRIORITIES = ["low", "medium", "high", "urgent"];
export const REQUEST_STATUSES = ["open", "in_progress", "waiting_on_employee", "pending_approval", "returned", "approved", "rejected", "resolved", "completed", "closed", "cancelled"];
// Still being worked on (helpdesk statuses + Module 10 approval workflow statuses).
export const ACTIVE_REQUEST_STATUSES = ["open", "in_progress", "waiting_on_employee", "pending_approval", "returned", "approved"];
// Statuses the SLA applies to (same list as the server's inbox "overdue").
export const SLA_STATUSES = ["open", "in_progress", "waiting_on_employee", "pending_approval", "approved"];
// Statuses HR may set through hr_update_hr_request_status.
export const STAFF_SETTABLE_STATUSES = ["open", "in_progress", "waiting_on_employee", "resolved", "closed"];
export const REOPEN_WINDOW_DAYS = 7;

const EMP = "id, employee_code, first_name, last_name, display_name";
const COLUMNS = `id, employee_id, category_id, subject, description, priority, status, assigned_to, is_confidential, resolution,
  resolved_at, closed_at, cancelled_at, sla_due_at, created_at, updated_at, last_activity_at,
  workflow, approval_round, submitted_at, decided_at, completed_at,
  category:hr_request_categories!hr_requests_category_id_fkey(id, code, name, sla_hours, is_confidential, workflow),
  employee:hr_employees!hr_requests_employee_id_fkey(${EMP}),
  assignee:hr_employees!hr_requests_assigned_to_fkey(${EMP})`;

export const isOverdue = (r) => Boolean(r?.sla_due_at && SLA_STATUSES.includes(r.status) && new Date(r.sla_due_at).getTime() < Date.now());

export async function listRequestCategories({ activeOnly = false } = {}) {
  let q = from("hr_request_categories").select("id, code, name, description, default_assignee_role, sla_hours, is_confidential, active, sort_order, workflow, approval_stages, requires_attachment").order("sort_order").order("name");
  if (activeOnly) q = q.eq("active", true);
  return run(q);
}

/** status: "" (all) | "active" | a concrete status. assigned: "" | "me" | "unassigned". */
export async function listRequests({ status = "active", category = "", priority = "", assigned = "", me = null, search = "", workflow = "" } = {}) {
  if (assigned === "me" && !me) return { data: [], error: null };
  let q = from("hr_requests").select(COLUMNS).limit(2000);
  if (status === "active") q = q.in("status", ACTIVE_REQUEST_STATUSES);
  else if (status) q = q.eq("status", status);
  if (category) q = q.eq("category_id", category);
  if (workflow) q = q.eq("workflow", workflow);
  if (priority) q = q.eq("priority", priority);
  if (assigned === "me") q = q.eq("assigned_to", me);
  if (assigned === "unassigned") q = q.is("assigned_to", null);
  const s = search.trim().replace(/[%,()]/g, " ");
  if (s) q = q.ilike("subject", `%${s}%`);
  q = q.order("sla_due_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  return run(q);
}

export async function listMyRequests(employeeId) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_requests").select(COLUMNS).eq("employee_id", employeeId).order("created_at", { ascending: false }).limit(500));
}

export async function getRequest(id) {
  return run(from("hr_requests").select(COLUMNS).eq("id", id).maybeSingle());
}

export async function listRequestComments(id) {
  return run(from("hr_request_comments")
    .select(`id, request_id, author_user_id, author_employee_id, body, is_internal, created_at, author:hr_employees!hr_request_comments_author_employee_id_fkey(${EMP})`)
    .eq("request_id", id).order("created_at"));
}

export const createRequest = ({ category, subject, description, priority }) =>
  rpc("hr_create_hr_request", { p_category: category, p_subject: subject?.trim(), p_description: description?.trim(), p_priority: priority || "medium" });
export const commentRequest = (id, body, internal = false) => rpc("hr_comment_hr_request", { p_request: id, p_body: body?.trim(), p_internal: Boolean(internal) });
export const assignRequest = (id, assignee) => rpc("hr_assign_hr_request", { p_request: id, p_assignee: assignee || null });
export const updateRequestStatus = (id, status, resolution) => rpc("hr_update_hr_request_status", { p_request: id, p_status: status, p_resolution: resolution?.trim() || null });
export const closeRequest = (id) => rpc("hr_close_hr_request", { p_request: id });
export const reopenRequest = (id, reason) => rpc("hr_reopen_hr_request", { p_request: id, p_reason: reason?.trim() || null });
export const cancelRequest = (id) => rpc("hr_cancel_hr_request", { p_request: id });

/** Requester may reopen within the window after resolution. */
export const canReopen = (r) => Boolean(r && ["resolved", "closed"].includes(r.status) && r.resolved_at && Date.now() - new Date(r.resolved_at).getTime() <= REOPEN_WINDOW_DAYS * 86400000);
