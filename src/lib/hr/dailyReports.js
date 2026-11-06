// Projects, tasks and daily work reports (migrations 102 + 128).
// Employees write their own DRAFT reports/items directly (RLS + guard
// triggers validate project allocation on the report date, task/project
// match, task status rules, links and the 24h cap).
// Status changes only happen through the submit / review / reopen RPCs;
// blockers are written only through their RPCs.
import { from, rpc, run } from "./client";
export { derivePendingTasks, feedbackAttention } from "./dailyReportInsights.js";

export const REPORT_STATUSES = ["draft", "submitted", "under_review", "reviewed", "revision_requested"];
export const EDITABLE_REPORT_STATUSES = ["draft", "revision_requested"];
/** Business labels. DB values are unchanged (dashboards depend on them). */
export const REPORT_STATUS_LABEL = {
  draft: "Draft", submitted: "Submitted", under_review: "Under review", reviewed: "Approved", revision_requested: "Changes requested",
  not_submitted: "Not submitted", not_due: "Not due",
};
export const reportStatusLabel = (s) => REPORT_STATUS_LABEL[s] ?? String(s ?? "").replace(/_/g, " ");

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done"];
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"];
export const PROJECT_STATUSES = ["active", "on_hold", "completed", "archived"];
/** Status of a task inside a daily report (hr_daily_report_items.work_status). */
export const WORK_STATUSES = ["not_started", "in_progress", "completed", "blocked"];
export const WORK_STATUS_LABEL = { not_started: "Not started", in_progress: "In progress", completed: "Completed", blocked: "Blocked" };
export const BLOCKER_SEVERITIES = ["low", "medium", "high", "critical"];
export const BLOCKER_STATUSES = ["open", "in_progress", "resolved"];
export const REVIEW_ACTIONS = [
  { value: "reviewed", label: "Approve", needsComment: false },
  { value: "revision_requested", label: "Request changes", needsComment: true },
  { value: "under_review", label: "Mark under review", needsComment: false },
  { value: "clarification", label: "Ask for clarification", needsComment: true },
  { value: "comment", label: "Add comment", needsComment: true },
];
export const REVIEW_ACTION_LABEL = {
  submitted: "Submitted", comment: "Comment", clarification: "Clarification requested", under_review: "Marked under review",
  reviewed: "Approved", revision_requested: "Changes requested", reopened: "Reopened",
};
export const MAX_DAY_HOURS = 24;
export const MAX_LINKS = 10;
export const LINK_RE = /^https?:\/\/[^\s<>"'`]{3,}$/;

const EMP = "id, employee_code, first_name, last_name, display_name, department_id, manager_id";
const REPORT_COLS = `id, employee_id, report_date, status, summary, pending_work, blockers, support_required, tomorrow_plan, total_hours,
  submitted_at, reviewer_employee_id, reviewed_at, created_at, updated_at`;
const ITEM_COLS = `id, report_id, project_id, task_id, activity, description, hours, progress_pct, work_status, completed_work, deliverables,
  completion_date, links, notes, created_at,
  project:hr_projects!hr_daily_report_items_project_id_fkey(id, code, name), task:hr_tasks!hr_daily_report_items_task_id_fkey(id, title)`;
const TASK_COLS = `id, project_id, assignee_id, title, description, status, priority, start_date, due_date, progress_pct, last_update_at, completed_at, created_at, updated_at,
  project:hr_projects!hr_tasks_project_id_fkey(id, code, name, status)`;
const PROJECT_COLS = "id, code, name, client, description, status, start_date, end_date, manager_employee_id, source, external_ref, created_at";

// ------------------------------------------------------------ projects
export async function listProjects({ status = "" } = {}) {
  let q = from("hr_projects").select(PROJECT_COLS).order("name");
  if (status) q = q.eq("status", status);
  return run(q);
}

export async function saveProject(row) {
  const body = {
    code: row.code?.trim().toUpperCase(), name: row.name?.trim(), client: row.client?.trim() || null,
    description: row.description?.trim() || null, status: row.status || "active",
    start_date: row.start_date || null, end_date: row.end_date || null, manager_employee_id: row.manager_employee_id || null,
  };
  return row.id
    ? run(from("hr_projects").update(body).eq("id", row.id).select("id").single())
    : run(from("hr_projects").insert(body).select("id").single());
}

export async function listProjectMembers(projectId) {
  return run(from("hr_project_members")
    .select(`id, project_id, employee_id, role, start_date, end_date, allocation_pct, notes, added_at, updated_at,
      employee:hr_employees!hr_project_members_employee_id_fkey(${EMP})`)
    .eq("project_id", projectId).order("added_at"));
}
const allocationBody = (a) => ({
  role: a.role?.trim() || "member", start_date: a.start_date || null, end_date: a.end_date || null,
  allocation_pct: a.allocation_pct === "" || a.allocation_pct == null ? null : Number(a.allocation_pct), notes: a.notes?.trim() || null,
});
export const addProjectMember = (projectId, employeeId, roleOrAllocation) =>
  run(from("hr_project_members").insert({
    project_id: projectId, employee_id: employeeId,
    ...allocationBody(typeof roleOrAllocation === "object" && roleOrAllocation ? roleOrAllocation : { role: roleOrAllocation }),
  }).select("id").single());
export const updateProjectMember = (id, allocation) =>
  run(from("hr_project_members").update(allocationBody(allocation)).eq("id", id).select("id").single());
export const removeProjectMember = (id) => run(from("hr_project_members").delete().eq("id", id).select("id"));

export async function listAllocationHistory(projectId) {
  return run(from("hr_project_allocation_history")
    .select(`id, project_id, employee_id, action, role, start_date, end_date, allocation_pct, created_at,
      employee:hr_employees!hr_project_allocation_history_employee_id_fkey(${EMP})`)
    .eq("project_id", projectId).order("created_at", { ascending: false }).limit(500));
}

/** Validate an allocation form (the DB re-validates). */
export function validateAllocation(a) {
  const e = {};
  const role = (a.role ?? "").trim();
  if (role.length < 2 || role.length > 60) e.role = "2–60 characters.";
  if (a.start_date && a.end_date && a.end_date < a.start_date) e.end_date = "End must be on or after start.";
  if (a.allocation_pct !== "" && a.allocation_pct != null) {
    const p = Number(a.allocation_pct);
    if (!Number.isInteger(p) || p < 1 || p > 100) e.allocation_pct = "Whole number 1–100.";
  }
  if ((a.notes ?? "").length > 1000) e.notes = "At most 1000 characters.";
  return e;
}

/** Projects the employee is a member of (with allocation dates). */
export async function listMyProjects(employeeId) {
  if (!employeeId) return { data: [], error: null };
  const res = await run(from("hr_project_members")
    .select("id, role, start_date, end_date, allocation_pct, project:hr_projects!hr_project_members_project_id_fkey(id, code, name, client, description, status, start_date, end_date, manager_employee_id)")
    .eq("employee_id", employeeId));
  return {
    ...res,
    data: res.data ? res.data.filter((m) => m.project).map((m) => ({
      ...m.project, member_role: m.role, allocation_start: m.start_date, allocation_end: m.end_date, allocation_pct: m.allocation_pct,
    })) : null,
  };
}
/** Is the allocation valid on a date (mirrors hr_private.is_project_allocated)? */
export const allocatedOn = (p, date) => (!p.allocation_start || !date || p.allocation_start <= date) && (!p.allocation_end || !date || p.allocation_end >= date);

// ------------------------------------------------------------ tasks
export async function listTasks({ project = "", assignee = "", status = "" } = {}) {
  let q = from("hr_tasks").select(`${TASK_COLS}, assignee:hr_employees!hr_tasks_assignee_id_fkey(${EMP})`);
  if (project) q = q.eq("project_id", project);
  if (assignee) q = q.eq("assignee_id", assignee);
  if (status) q = q.eq("status", status);
  return run(q.order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(2000));
}

export async function listMyTasks(employeeId) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_tasks").select(TASK_COLS).eq("assignee_id", employeeId)
    .order("due_date", { ascending: true, nullsFirst: false }).limit(1000));
}

export async function saveTask(row) {
  const body = {
    project_id: row.project_id, assignee_id: row.assignee_id || null, title: row.title?.trim(),
    description: row.description?.trim() || null, status: row.status || "todo", priority: row.priority || "medium",
    start_date: row.start_date || null, due_date: row.due_date || null,
  };
  return row.id
    ? run(from("hr_tasks").update(body).eq("id", row.id).select("id").single())
    : run(from("hr_tasks").insert(body).select("id").single());
}

export const updateMyTaskStatus = (taskId, status) => rpc("hr_update_my_task_status", { p_task: taskId, p_status: status });

/** Assignee posts an update: any of status, progress (0–100), note. Blocked needs a note (server-enforced). */
export const postMyTaskUpdate = (taskId, { status = null, progress = null, note = null } = {}) =>
  rpc("hr_post_my_task_update", { p_task: taskId, p_status: status, p_progress: progress, p_note: note?.trim() || null });

/** Status / progress / note history of one task (visible when the task is). */
export const listTaskUpdates = (taskId) =>
  run(from("hr_task_updates").select("id, task_id, author_employee_id, old_status, new_status, old_progress, new_progress, note, created_at")
    .eq("task_id", taskId).order("created_at", { ascending: false }).limit(200));

/** Recent updates on the signed-in employee's own tasks. */
export const listMyTaskActivity = (limit = 50) => rpc("hr_my_task_activity", { p_limit: limit });

/** Validate a task update before sending (mirrors hr_post_my_task_update). */
export function validateTaskUpdate(task, { status, progress, note }) {
  const e = {};
  const p = Number(progress);
  if (!Number.isInteger(p) || p < 0 || p > 100) e.progress = "Whole number 0–100.";
  else if (p === 100 && status !== "done") e.progress = "100% means done — mark it Done, or set progress below 100%.";
  const n = (note ?? "").trim();
  if (n.length > 2000) e.note = "At most 2000 characters.";
  if (status === "blocked" && task.status !== "blocked" && !n) e.note = "Say what is blocking this task.";
  if (!Object.keys(e).length && status === task.status && (status === "done" || p === task.progress_pct) && !n) e.form = "Change the status or progress, or add a note.";
  return e;
}

// ------------------------------------------------------------ my reports
const sortItems = (res) => {
  if (res.data?.items) res.data.items.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
  return res;
};

export async function getMyReport(employeeId, date) {
  if (!employeeId || !date) return { data: null, error: null };
  return sortItems(await run(from("hr_daily_reports").select(`${REPORT_COLS}, items:hr_daily_report_items(${ITEM_COLS})`)
    .eq("employee_id", employeeId).eq("report_date", date).maybeSingle()));
}

export async function getReport(id) {
  return sortItems(await run(from("hr_daily_reports")
    .select(`${REPORT_COLS}, items:hr_daily_report_items(${ITEM_COLS}), employee:hr_employees!hr_daily_reports_employee_id_fkey(${EMP})`)
    .eq("id", id).maybeSingle()));
}

export async function listMyReports(employeeId, { from: f, to } = {}) {
  if (!employeeId) return { data: [], error: null };
  let q = from("hr_daily_reports").select(REPORT_COLS).eq("employee_id", employeeId);
  if (f) q = q.gte("report_date", f);
  if (to) q = q.lte("report_date", to);
  return run(q.order("report_date", { ascending: false }).limit(400));
}

const TEXT_FIELDS = ["summary", "pending_work", "blockers", "support_required", "tomorrow_plan"];
const reportBody = (v) => Object.fromEntries(TEXT_FIELDS.map((k) => [k, v[k]?.trim() ? v[k].trim() : null]));
const splitLinks = (s) => (Array.isArray(s) ? s : String(s ?? "").split(/\s*[\n,]\s*/)).map((l) => l.trim()).filter(Boolean);
const itemBody = (it) => {
  const status = it.work_status || "in_progress";
  return {
    project_id: it.project_id || null, task_id: it.project_id && it.task_id ? it.task_id : null, activity: it.activity.trim(),
    description: it.description?.trim() || null, hours: Number(it.hours),
    progress_pct: status === "completed" ? 100 : it.progress_pct === "" || it.progress_pct == null ? null : Number(it.progress_pct),
    work_status: status,
    completed_work: it.completed_work?.trim() || null, deliverables: it.deliverables?.trim() || null,
    completion_date: status === "completed" ? it.completion_date || null : null,
    links: splitLinks(it.links), notes: it.notes?.trim() || null,
  };
};

/** Client-side validation that mirrors the DB checks (the DB re-validates). */
export function validateReport(v, items, { date } = {}) {
  const errors = {};
  const itemErrors = items.map((it) => {
    const e = {};
    const status = it.work_status || "in_progress";
    const a = it.activity?.trim() ?? "";
    if (a.length < 2 || a.length > 200) e.activity = "2–200 characters.";
    const h = Number(it.hours);
    if (it.hours === "" || it.hours == null || Number.isNaN(h)) e.hours = "Enter the hours spent.";
    else if (h < 0 || h > 24) e.hours = "Between 0 and 24.";
    else if (h === 0 && status !== "not_started") e.hours = "Only a task that has not started can have 0 hours.";
    else if (Math.round(h * 100) !== h * 100) e.hours = "At most 2 decimals.";
    if (it.progress_pct !== "" && it.progress_pct != null && status !== "completed") {
      const p = Number(it.progress_pct);
      if (!Number.isInteger(p) || p < 0 || p > 100) e.progress_pct = "Whole number 0–100.";
      else if (status === "not_started" && p !== 0) e.progress_pct = "Not started: no progress yet.";
    }
    if (status === "completed" && it.completion_date && date && it.completion_date > date) e.completion_date = "Cannot be after the report date.";
    if (status === "blocked" && !it.has_blocker && !(it.blocker_title ?? "").trim()) e.blocker_title = "Describe what is blocking this task.";
    if (status === "blocked" && (it.blocker_title ?? "").trim() && ((it.blocker_title.trim().length < 2) || it.blocker_title.length > 200)) e.blocker_title = "2–200 characters.";
    if (it.task_id && !it.project_id) e.task_id = "Choose the project first.";
    if ((it.description ?? "").length > 4000) e.description = "At most 4000 characters.";
    if ((it.completed_work ?? "").length > 4000) e.completed_work = "At most 4000 characters.";
    if ((it.deliverables ?? "").length > 2000) e.deliverables = "At most 2000 characters.";
    if ((it.notes ?? "").length > 2000) e.notes = "At most 2000 characters.";
    const links = splitLinks(it.links);
    if (links.length > MAX_LINKS) e.links = `At most ${MAX_LINKS} links.`;
    else if (links.some((l) => !LINK_RE.test(l) || l.length > 500)) e.links = "Each link must start with http:// or https://.";
    return e;
  });
  const total = items.reduce((s, it) => s + (Number(it.hours) || 0), 0);
  if (total > MAX_DAY_HOURS) errors.total = `Total hours (${total}) cannot exceed ${MAX_DAY_HOURS}.`;
  for (const k of TEXT_FIELDS) if ((v[k] ?? "").length > 4000) errors[k] = "At most 4000 characters.";
  const ok = !Object.keys(errors).length && itemErrors.every((e) => !Object.keys(e).length);
  return { ok, errors, itemErrors, total };
}

/**
 * Save a draft (create the report if needed, update its text, then sync items:
 * deletes, updates, inserts — in that order so the 24h cap is never exceeded
 * transiently), then record blockers typed on blocked tasks.
 * Returns { data: reportId, error }.
 */
export async function saveMyReport({ employeeId, date, report, values, items }) {
  let id = report?.id;
  if (!id) {
    const ins = await run(from("hr_daily_reports").insert({ employee_id: employeeId, report_date: date, ...reportBody(values) }).select("id").single());
    if (ins.error) return { data: null, error: ins.error };
    id = ins.data.id;
  } else {
    const up = await run(from("hr_daily_reports").update(reportBody(values)).eq("id", id).select("id").single());
    if (up.error) return { data: id, error: up.error };
  }
  const existing = report?.items ?? [];
  const keep = new Set(items.filter((i) => i.id).map((i) => i.id));
  const removed = existing.filter((i) => !keep.has(i.id));
  if (removed.length) {
    // Open blockers of removed tasks would otherwise stay orphaned on the report.
    for (const b of (report?.blockers ?? []).filter((x) => removed.some((r) => r.id === x.item_id) && x.status === "open")) {
      const del = await deleteBlocker(b.id);
      if (del.error) return { data: id, error: del.error };
    }
    const del = await run(from("hr_daily_report_items").delete().in("id", removed.map((i) => i.id)).select("id"));
    if (del.error) return { data: id, error: del.error };
  }
  for (const it of items.filter((i) => i.id)) {
    const up = await run(from("hr_daily_report_items").update(itemBody(it)).eq("id", it.id).select("id").single());
    if (up.error) return { data: id, error: `Task "${it.activity}": ${up.error}` };
  }
  const added = items.filter((i) => !i.id);
  let addedIds = [];
  if (added.length) {
    const ins = await run(from("hr_daily_report_items").insert(added.map((it) => ({ report_id: id, ...itemBody(it) }))).select("id"));
    if (ins.error) return { data: id, error: ins.error };
    addedIds = ins.data ?? [];
  }
  // Blockers typed inline on blocked tasks (one per task).
  const withIds = [...items.filter((i) => i.id), ...added.map((it, n) => ({ ...it, id: addedIds[n]?.id }))];
  for (const it of withIds) {
    if (it.id && (it.work_status === "blocked") && !it.has_blocker && it.blocker_title?.trim()) {
      const b = await saveBlocker({ report: id, item: it.id, title: it.blocker_title, description: it.blocker_description, severity: it.blocker_severity || "medium" });
      if (b.error) return { data: id, error: `Blocker for "${it.activity}": ${b.error}` };
    }
  }
  return { data: id, error: null };
}

export const deleteMyDraft = (id) => run(from("hr_daily_reports").delete().eq("id", id).eq("status", "draft").select("id"));
export const submitReport = (id) => rpc("hr_submit_daily_report", { p_id: id });
export const replyReport = (id, comment) => rpc("hr_reply_daily_report", { p_id: id, p_comment: comment?.trim() });

export async function listReviews(reportId) {
  return run(from("hr_daily_report_reviews")
    .select(`id, report_id, actor_employee_id, action, from_status, to_status, comment, created_at,
      actor:hr_employees!hr_daily_report_reviews_actor_employee_id_fkey(id, employee_code, first_name, last_name, display_name)`)
    .eq("report_id", reportId).order("created_at"));
}

// ------------------------------------------------------------ my pending tasks / my feedback
/** All of the employee's report items (any report status) whose report date is in range. */
export async function listMyReportItems(employeeId, { from: f, to } = {}) {
  if (!employeeId) return { data: [], error: null };
  let q = from("hr_daily_report_items")
    .select(`${ITEM_COLS}, report:hr_daily_reports!inner(id, report_date, status, employee_id)`)
    .eq("report.employee_id", employeeId);
  if (f) q = q.gte("report.report_date", f);
  if (to) q = q.lte("report.report_date", to);
  return run(q.limit(3000));
}

/** Review activity on the employee's own reports (report date in range), oldest first. */
export async function listMyFeedback(employeeId, { from: f, to } = {}) {
  if (!employeeId) return { data: [], error: null };
  let q = from("hr_daily_report_reviews")
    .select(`id, report_id, actor_employee_id, action, from_status, to_status, comment, created_at,
      actor:hr_employees!hr_daily_report_reviews_actor_employee_id_fkey(id, employee_code, first_name, last_name, display_name),
      report:hr_daily_reports!inner(id, report_date, status, employee_id)`)
    .eq("report.employee_id", employeeId).neq("action", "submitted");
  if (f) q = q.gte("report.report_date", f);
  if (to) q = q.lte("report.report_date", to);
  return run(q.order("created_at", { ascending: true }).limit(2000));
}

export async function listVersions(reportId) {
  return run(from("hr_daily_report_versions").select("id, report_id, version, total_hours, snapshot, created_at")
    .eq("report_id", reportId).order("version", { ascending: false }));
}

// ------------------------------------------------------------ HR / reviewers
/** Non-draft reports visible to the caller (RLS: all / team). */
export async function listReports({ from: f, to, status = "", statuses = null, employee = "" } = {}) {
  let q = from("hr_daily_reports")
    .select(`${REPORT_COLS}, employee:hr_employees!hr_daily_reports_employee_id_fkey(${EMP}), items:hr_daily_report_items(project_id, hours, work_status)`)
    .neq("status", "draft");
  if (f) q = q.gte("report_date", f);
  if (to) q = q.lte("report_date", to);
  if (status) q = q.eq("status", status);
  else if (statuses?.length) q = q.in("status", statuses);
  if (employee) q = q.eq("employee_id", employee);
  return run(q.order("report_date", { ascending: false }).order("submitted_at", { ascending: true }).limit(3000));
}

export const reviewReport = (id, action, comment) =>
  rpc("hr_review_daily_report", { p_id: id, p_action: action, p_comment: comment?.trim() || null });
export const reopenReport = (id, reason) => rpc("hr_reopen_daily_report", { p_id: id, p_reason: reason?.trim() || null });
export const missingReports = (date) => rpc("hr_missing_daily_reports", { p_date: date || null });
export const generateReminders = (date) => rpc("hr_generate_daily_report_reminders", { p_date: date || null });
export const reportBlockers = ({ from: f, to, employee, project }) =>
  rpc("hr_daily_report_blockers", { p_from: f, p_to: to, p_employee: employee || null, p_project: project || null });

export const workOverview = ({ date, from: f, to, department, project, manager, company, status } = {}) =>
  rpc("hr_daily_work_overview", {
    p_date: date || null, p_from: f || null, p_to: to || null, p_department: department || null, p_project: project || null,
    p_manager: manager || null, p_company: company || null, p_status: status || null,
  });
export const hoursSummary = ({ from: f, to, group = "employee", employee, department, project, manager, company }) =>
  rpc("hr_work_hours_summary", {
    p_from: f, p_to: to, p_group: group, p_employee: employee || null, p_department: department || null,
    p_project: project || null, p_manager: manager || null, p_company: company || null,
  });
export const hoursVsAttendance = ({ from: f, to, employee, department, manager, onlyFlagged = false }) =>
  rpc("hr_work_hours_vs_attendance", {
    p_from: f, p_to: to, p_employee: employee || null, p_department: department || null, p_manager: manager || null, p_only_flagged: onlyFlagged,
  });
export const completedWork = ({ from: f, to, employee, project, task, completedOnly = true }) =>
  rpc("hr_completed_work", { p_from: f, p_to: to, p_employee: employee || null, p_project: project || null, p_task: task || null, p_completed_only: completedOnly });

export const DISCREPANCY_LABEL = {
  no_attendance: "Hours reported, no attendance", attendance_incomplete: "Attendance not checked out",
  reported_exceeds_attendance: "Reported > attended", under_reported: "Attended > reported", no_report: "Attendance, no report",
};

// ------------------------------------------------------------ blockers
export const listBlockers = ({ status, from: f, to, employee, project, department, mine = false } = {}) =>
  rpc("hr_list_work_blockers", {
    p_status: status || null, p_from: f || null, p_to: to || null, p_employee: employee || null, p_project: project || null,
    p_department: department || null, p_mine: mine,
  });
export async function listReportBlockers(reportId) {
  if (!reportId) return { data: [], error: null };
  return run(from("hr_work_blockers").select("id, report_id, item_id, project_id, task_id, title, description, severity, status, owner_employee_id, resolution_notes, resolved_date, reported_date, created_at")
    .eq("report_id", reportId).order("created_at"));
}
export const saveBlocker = ({ id, report, item, project, task, title, description, severity = "medium" }) =>
  rpc("hr_save_work_blocker", {
    p_id: id || null, p_report: report || null, p_item: item || null, p_project: project || null, p_task: task || null,
    p_title: title?.trim(), p_description: description?.trim() || null, p_severity: severity,
  });
export const deleteBlocker = (id) => rpc("hr_delete_work_blocker", { p_id: id });
export const updateBlocker = (id, { status, owner, notes, clearOwner = false } = {}) =>
  rpc("hr_update_work_blocker", { p_id: id, p_status: status || null, p_owner: owner || null, p_notes: notes?.trim() || null, p_clear_owner: clearOwner });
