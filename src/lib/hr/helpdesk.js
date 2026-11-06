// Helpdesk & Support (migration 181). Tickets are hr_requests rows with
// workflow = 'helpdesk'; this module only adds the helpdesk view of them.
// Visibility is enforced on the server: the requester, HR request staff
// (hr_requests.view / .manage, payroll for payroll queries) and the IT desk
// (helpdesk.it: non-confidential IT tickets only). Writes reuse the request
// RPCs from lib/hr/requests.js plus the helpdesk-specific ones below.
import { from, rpc, run } from "./client";

export const SUPPORT_AREAS = [
  { value: "hr", label: "HR support", short: "HR", description: "Policies, payroll, leave, benefits, letters and any HR question" },
  { value: "it", label: "IT support", short: "IT", description: "Laptop and hardware, software, network, email and access problems" },
  { value: "workplace", label: "Workplace issues", short: "Workplace", description: "Facilities, health and safety, conduct concerns and grievances" },
];
export const areaLabel = (a) => SUPPORT_AREAS.find((x) => x.value === a)?.label ?? a ?? "—";
export const areaShort = (a) => SUPPORT_AREAS.find((x) => x.value === a)?.short ?? a ?? "—";

export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"];
export const ACTIVE_TICKET_STATUSES = ["open", "in_progress", "waiting_on_employee"];
export const TICKET_STATUSES = ["open", "in_progress", "waiting_on_employee", "resolved", "closed", "cancelled"];
// Statuses a handler may set (hr_update_hr_request_status).
export const STAFF_TICKET_STATUSES = ["open", "in_progress", "waiting_on_employee", "resolved", "closed"];
export const TICKET_STATUS_LABELS = {
  open: "Open", in_progress: "In progress", waiting_on_employee: "Waiting on you", resolved: "Resolved", closed: "Closed", cancelled: "Cancelled",
};
// Staff wording for the same status.
export const STAFF_STATUS_LABELS = { ...TICKET_STATUS_LABELS, waiting_on_employee: "Waiting on employee" };

export const TICKET_EVENT_LABELS = {
  submitted: "Ticket raised", updated: "Status changed", assigned: "Assigned", unassigned: "Unassigned",
  priority_changed: "Priority changed", category_changed: "Category changed", closed: "Closed by requester",
  reopened: "Reopened", rated: "Rated", cancelled: "Cancelled", attachment_added: "File added", attachment_removed: "File removed",
};

const MY_COLUMNS = `id, ticket_no, subject, status, priority, is_confidential, created_at, last_activity_at, resolved_at, closed_at,
  sla_due_at, satisfaction_rating, assigned_to, category:hr_request_categories!hr_requests_category_id_fkey(id, code, name, support_area)`;

/** Helpdesk categories for the ticket form (active only). */
export async function listHelpdeskCategories() {
  return run(from("hr_request_categories")
    .select("id, code, name, description, sla_hours, is_confidential, support_area, sort_order")
    .eq("workflow", "helpdesk").eq("active", true).order("sort_order").order("name"));
}

/** The signed-in employee's own tickets (RLS). */
export async function listMyTickets(employeeId) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_requests").select(MY_COLUMNS).eq("employee_id", employeeId).eq("workflow", "helpdesk")
    .order("last_activity_at", { ascending: false }).limit(500));
}

function clean(f) {
  const out = {};
  for (const [k, v] of Object.entries(f ?? {})) if (v !== "" && v !== null && v !== undefined && v !== false) out[k] = typeof v === "string" ? v.trim() : v;
  return out;
}

/** Staff queue. Filters: area, status ('active' | 'all' | status), priority, category (code), assigned ('me' | 'unassigned' | id), overdue, search, from, to. */
export const helpdeskQueue = (filters = {}) => rpc("hr_helpdesk_queue", { p_filters: clean(filters) });
export const helpdeskSummary = (filters = {}) => rpc("hr_helpdesk_summary", { p_filters: clean(filters) });
export const getTicket = (id) => rpc("hr_helpdesk_ticket", { p_request: id });
export const ticketAssignees = (id) => rpc("hr_helpdesk_assignees", { p_request: id });

export const rateTicket = (id, rating, comment) => rpc("hr_rate_helpdesk_ticket", { p_request: id, p_rating: rating, p_comment: comment?.trim() || null });
export const updateTicket = (id, { priority = null, category = null, note = "" } = {}) =>
  rpc("hr_update_helpdesk_ticket", { p_request: id, p_priority: priority || null, p_category: category || null, p_note: note?.trim() || null });

export const isTicketOverdue = (t) => Boolean(t?.sla_due_at && ACTIVE_TICKET_STATUSES.includes(t.status) && new Date(t.sla_due_at).getTime() < Date.now());

/** "3 h", "2 d 4 h" from a number of hours. */
export function formatHours(h) {
  if (h === null || h === undefined || h === "") return "—";
  const n = Number(h);
  if (!Number.isFinite(n)) return "—";
  if (n < 1) return `${Math.max(1, Math.round(n * 60))} min`;
  if (n < 48) return `${Math.round(n * 10) / 10} h`;
  const d = Math.floor(n / 24);
  const rest = Math.round(n - d * 24);
  return rest ? `${d} d ${rest} h` : `${d} d`;
}
