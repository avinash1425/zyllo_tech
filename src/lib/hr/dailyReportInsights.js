// Pure helpers for the employee's Pending tasks and Manager feedback views
// (no Supabase imports, so they are unit-tested in tests/hrms).

const TASK_TO_WORK = { todo: "not_started", in_progress: "in_progress", blocked: "blocked", done: "completed" };
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * Work that is still open. Report items are grouped into one "task" (by the
 * linked task, else project + activity text); a group is pending when its most
 * recent entry is not Completed and the linked task is not Done. Assigned tasks
 * that are not Done and were never reported in the range are added too.
 */
export function derivePendingTasks(items = [], assigned = [], today) {
  const groups = new Map();
  for (const it of items) {
    const key = it.task_id ? `t:${it.task_id}` : `a:${it.project_id ?? ""}:${(it.activity ?? "").trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const taskById = new Map(assigned.map((t) => [t.id, t]));
  const out = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => String(a.report.report_date).localeCompare(String(b.report.report_date)) || String(a.created_at).localeCompare(String(b.created_at)));
    const last = list[list.length - 1];
    const task = last.task_id ? taskById.get(last.task_id) : null;
    if (last.work_status === "completed" || task?.status === "done") continue;
    const first = list[0].report.report_date;
    out.push({
      key, source: "reported", activity: last.activity, project: last.project, task: last.task, task_id: last.task_id,
      work_status: last.work_status, progress_pct: last.progress_pct, hours: list.reduce((s, x) => s + Number(x.hours || 0), 0),
      days: new Set(list.map((x) => x.report.report_date)).size, first_date: first, last_date: last.report.report_date,
      report_status: last.report.status, due_date: task?.due_date ?? null, priority: task?.priority ?? null,
      age_days: today ? dayDiff(first, today) : null, notes: last.notes,
    });
  }
  const reportedTasks = new Set(items.map((i) => i.task_id).filter(Boolean));
  for (const t of assigned) {
    if (t.status === "done" || reportedTasks.has(t.id)) continue;
    out.push({
      key: `t:${t.id}`, source: "assigned", activity: t.title, project: t.project, task: { id: t.id, title: t.title }, task_id: t.id,
      work_status: TASK_TO_WORK[t.status] ?? "not_started", progress_pct: null, hours: 0, days: 0, first_date: null, last_date: null,
      report_status: null, due_date: t.due_date, priority: t.priority, age_days: null, notes: null,
    });
  }
  for (const p of out) p.overdue = Boolean(p.due_date && today && p.due_date < today);
  return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || Number(b.work_status === "blocked") - Number(a.work_status === "blocked")
    || String(b.last_date ?? "").localeCompare(String(a.last_date ?? "")));
}

/**
 * Per-report attention flags: changes requested (report status), or a
 * clarification that the employee has not replied to yet.
 */
export function feedbackAttention(reviews = [], me) {
  const byReport = new Map();
  for (const r of reviews) {
    if (!byReport.has(r.report_id)) byReport.set(r.report_id, []);
    byReport.get(r.report_id).push(r);
  }
  const changes = new Set();
  const awaiting = new Set();
  for (const [id, list] of byReport) {
    if (list[0].report?.status === "revision_requested") changes.add(id);
    const last = list[list.length - 1];
    if (last.action === "clarification" && last.actor_employee_id !== me) awaiting.add(id);
  }
  return { changes, awaiting };
}
