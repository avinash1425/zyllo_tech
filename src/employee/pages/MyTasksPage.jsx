// Employee: My Tasks & Projects.
//   * My tasks   — assigned tasks with deadlines, status, priority and progress;
//                  filter / sort; an Update dialog posts status, progress % and a
//                  note through hr_post_my_task_update (131) and shows the history.
//   * My projects — project assignments (role, allocation, dates) with my task
//                  progress per project.
//   * Activity   — recent updates on my tasks (mine and HR's), hr_my_task_activity.
import { useMemo, useState } from "react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import {
  TASK_PRIORITIES, TASK_STATUSES, listMyProjects, listMyTaskActivity, listMyTasks, listTaskUpdates, postMyTaskUpdate, validateTaskUpdate,
} from "@/lib/hr/dailyReports";
import {
  Badge, Button, Card, DescriptionList, EmptyState, ErrorState, Field, InlineError, Input, KpiCard, Loading, Modal, PageHeader,
  SearchInput, Select, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";
import { businessToday, useBusinessTimezone } from "@/lib/hr/attendance";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, History, ListTodo } from "lucide-react";

const PRIORITY_TONE = { low: "slate", medium: "blue", high: "orange", urgent: "red" };
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
const TASK_TONE = { todo: "slate", in_progress: "blue", blocked: "red", done: "green" };
const PROJECT_TONE = { active: "green", on_hold: "amber", completed: "blue", archived: "slate" };
const STATUS_LABEL = { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done" };
const label = (s) => STATUS_LABEL[s] ?? String(s ?? "").replace(/_/g, " ");
const DUE_SOON_DAYS = 7;

/** Whole days from `today` to `date` (both YYYY-MM-DD); negative = past. */
const daysUntil = (date, today) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
const isOpen = (t) => t.status !== "done";
const isOverdue = (t, today) => isOpen(t) && t.due_date && t.due_date < today;
const isDueSoon = (t, today) => isOpen(t) && t.due_date && t.due_date >= today && daysUntil(t.due_date, today) <= DUE_SOON_DAYS;
const isClosedProject = (t) => ["completed", "archived"].includes(t.project?.status);

function dueText(t, today) {
  if (!t.due_date) return { text: "No due date", cls: "text-slate-500" };
  if (t.status === "done") return { text: `Due ${formatDate(t.due_date)}`, cls: "text-slate-500" };
  const d = daysUntil(t.due_date, today);
  if (d < 0) return { text: `Overdue by ${-d} day${d === -1 ? "" : "s"}`, cls: "font-semibold text-red-600" };
  if (d === 0) return { text: "Due today", cls: "font-semibold text-orange-600" };
  if (d === 1) return { text: "Due tomorrow", cls: "font-semibold text-orange-600" };
  if (d <= DUE_SOON_DAYS) return { text: `Due in ${d} days · ${formatDate(t.due_date)}`, cls: "font-medium text-amber-700" };
  return { text: `Due ${formatDate(t.due_date)}`, cls: "text-slate-500" };
}

function ProgressBar({ value, status, className = "" }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const color = status === "done" ? "bg-emerald-500" : status === "blocked" ? "bg-rose-500" : "bg-gradient-to-r from-[#f7941e] to-[#f96706]";
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${v}%` }} />
      </div>
      <span className="w-9 text-right text-xs font-semibold tabular-nums text-slate-600">{v}%</span>
    </div>
  );
}

const SHOW_OPTIONS = [
  { value: "open", label: "Open (not done)" },
  { value: "overdue", label: "Overdue" },
  { value: "due_soon", label: `Due in ${DUE_SOON_DAYS} days` },
  ...TASK_STATUSES.map((s) => ({ value: s, label: label(s) })),
  { value: "", label: "All tasks" },
];
const SORT_OPTIONS = [
  { value: "due", label: "Deadline (soonest)" },
  { value: "priority", label: "Priority (highest)" },
  { value: "updated", label: "Recently updated" },
  { value: "progress", label: "Progress (lowest)" },
];

export default function MyTasksPage() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const tz = useBusinessTimezone();
  const today = businessToday(tz);
  const tasks = useHrQuery(() => listMyTasks(me), [me]);
  const projects = useHrQuery(() => listMyProjects(me), [me]);
  const [activityKey, setActivityKey] = useState(0);
  const [tab, setTab] = useState("tasks");
  const [f, setF] = useState({ show: "open", priority: "", project: "", q: "", sort: "due" });
  const [selectedId, setSelectedId] = useState(null);
  const all = tasks.data ?? [];
  const selected = all.find((t) => t.id === selectedId) ?? null;

  const counts = useMemo(() => {
    const c = { open: 0, dueSoon: 0, overdue: 0, blocked: 0, done: 0, progressSum: 0 };
    for (const t of all) {
      if (isOpen(t)) { c.open += 1; c.progressSum += t.progress_pct ?? 0; } else c.done += 1;
      if (isOverdue(t, today)) c.overdue += 1;
      if (isDueSoon(t, today)) c.dueSoon += 1;
      if (t.status === "blocked") c.blocked += 1;
    }
    c.avgOpen = c.open ? Math.round(c.progressSum / c.open) : 0;
    return c;
  }, [all, today]);

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const list = all.filter((t) => {
      if (f.show === "open" && !isOpen(t)) return false;
      if (f.show === "overdue" && !isOverdue(t, today)) return false;
      if (f.show === "due_soon" && !isDueSoon(t, today)) return false;
      if (TASK_STATUSES.includes(f.show) && t.status !== f.show) return false;
      if (f.priority && t.priority !== f.priority) return false;
      if (f.project && t.project_id !== f.project) return false;
      if (q && !`${t.title} ${t.description ?? ""} ${t.project?.code ?? ""} ${t.project?.name ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const byDue = (a, b) => (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31");
    const cmp = {
      due: (a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || byDue(a, b) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
      priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byDue(a, b),
      updated: (a, b) => String(b.last_update_at ?? b.updated_at ?? "").localeCompare(String(a.last_update_at ?? a.updated_at ?? "")),
      progress: (a, b) => (a.progress_pct ?? 0) - (b.progress_pct ?? 0) || byDue(a, b),
    }[f.sort];
    return list.sort(cmp);
  }, [all, f, today]);

  const projectOptions = useMemo(() => {
    const m = new Map();
    for (const t of all) if (t.project) m.set(t.project.id, `${t.project.code} · ${t.project.name}`);
    return [...m].map(([value, l]) => ({ value, label: l })).sort((a, b) => a.label.localeCompare(b.label));
  }, [all]);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }));
  const showFilter = (show) => { setTab("tasks"); setF((s) => ({ ...s, show, priority: "", project: "", q: "" })); };

  return (
    <>
      <PageHeader title="My Tasks & Projects"
        description="Your assigned tasks, deadlines and project assignments. Post progress updates as you work; your manager and HR see the same status and history." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Open tasks" value={counts.open} icon={ListTodo} tone="slate" loading={tasks.loading} hint={counts.open ? `Average progress ${counts.avgOpen}%` : undefined} onClick={() => showFilter("open")} />
        <KpiCard label={`Due in ${DUE_SOON_DAYS} days`} value={counts.dueSoon} icon={CalendarClock} tone="teal" loading={tasks.loading} onClick={() => showFilter("due_soon")} />
        <KpiCard label="Overdue" value={counts.overdue} icon={Clock} tone="orange" loading={tasks.loading} hint="Not done, past due date" onClick={() => showFilter("overdue")} />
        <KpiCard label="Blocked" value={counts.blocked} icon={AlertTriangle} tone="red" loading={tasks.loading} onClick={() => showFilter("blocked")} />
        <KpiCard label="Completed" value={counts.done} icon={CheckCircle2} tone="green" loading={tasks.loading} onClick={() => showFilter("done")} />
      </div>
      <Tabs value={tab} onChange={setTab} label="Tasks and projects" tabs={[
        { value: "tasks", label: "My tasks", count: tasks.data ? counts.open : undefined },
        { value: "projects", label: "My projects", count: projects.data?.length },
        { value: "activity", label: "Updates" },
      ]} />

      {tab === "tasks" && (
        <>
          <Toolbar>
            <SearchInput value={f.q} onChange={set("q")} placeholder="Search tasks or projects…" label="Search tasks" />
            <Field label="Show" className="sm:w-48"><Select value={f.show} onChange={set("show")} options={SHOW_OPTIONS} /></Field>
            <Field label="Priority" className="sm:w-36"><Select placeholder="Any" value={f.priority} onChange={set("priority")} options={TASK_PRIORITIES.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))} /></Field>
            <Field label="Project" className="sm:w-52"><Select placeholder="All projects" value={f.project} onChange={set("project")} options={projectOptions} /></Field>
            <Field label="Sort by" className="sm:w-48"><Select value={f.sort} onChange={set("sort")} options={SORT_OPTIONS} /></Field>
          </Toolbar>
          {tasks.loading && !tasks.data ? <Loading /> : tasks.error ? <ErrorState message={tasks.error} onRetry={tasks.reload} /> : !rows.length ? (
            <Card><EmptyState title={all.length ? "No tasks match" : "No tasks yet"}
              description={all.length ? "Try a different filter." : "Tasks your project lead or HR assigns to you will appear here."} /></Card>
          ) : (
            <Card padded={false}>
              <ul className="divide-y divide-slate-100">
                {rows.map((t) => <TaskRow key={t.id} task={t} today={today} onOpen={() => setSelectedId(t.id)} />)}
              </ul>
            </Card>
          )}
        </>
      )}

      {tab === "projects" && (
        <ProjectsTab projects={projects} tasks={all} today={today}
          onViewTasks={(projectId) => { setTab("tasks"); setF((s) => ({ ...s, show: "", project: projectId, priority: "", q: "" })); }} />
      )}

      {tab === "activity" && <ActivityTab key={activityKey} onOpenTask={(id) => setSelectedId(id)} />}

      {selected && (
        <TaskDialog task={selected} today={today} onClose={() => setSelectedId(null)}
          onSaved={() => { tasks.reload(); setActivityKey((k) => k + 1); }} />
      )}
    </>
  );
}

function TaskRow({ task: t, today, onOpen }) {
  const due = dueText(t, today);
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {t.project && <span className="font-mono text-xs font-bold text-[#1f4693]">{t.project.code}</span>}
          <button type="button" onClick={onOpen} className="text-left font-semibold text-[#101a3a] hover:text-[#f96706] focus-visible:outline-none focus-visible:underline">{t.title}</button>
        </div>
        {t.description && <p className="mt-0.5 line-clamp-1 text-xs text-slate-600">{t.description}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
          <Badge tone={TASK_TONE[t.status]}>{label(t.status)}</Badge>
          <span className={due.cls}>{due.text}</span>
          {t.last_update_at && <span className="text-slate-400">· updated {formatDateTime(t.last_update_at)}</span>}
        </div>
      </div>
      <ProgressBar value={t.progress_pct} status={t.status} className="sm:w-44" />
      <Button size="sm" variant="secondary" onClick={onOpen} className="sm:w-24">{isOpen(t) && !isClosedProject(t) ? "Update" : "View"}</Button>
    </li>
  );
}

function TaskDialog({ task: t, today, onClose, onSaved }) {
  const { notify } = useToast();
  const history = useHrQuery(() => listTaskUpdates(t.id), [t.id, t.updated_at, t.last_update_at]);
  const closed = isClosedProject(t);
  const [v, setV] = useState({ status: t.status, progress: String(t.progress_pct ?? 0), note: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const due = dueText(t, today);

  function setStatus(status) {
    setV((s) => ({
      ...s, status,
      progress: status === "done" ? "100" : status !== "done" && s.progress === "100" ? String(t.status === "done" ? 90 : Math.min(t.progress_pct ?? 0, 99)) : s.progress,
    }));
  }
  function setProgress(progress) {
    setV((s) => ({ ...s, progress, status: progress === "100" ? "done" : s.status === "done" ? (t.status === "done" ? "in_progress" : t.status) : s.status === "todo" && Number(progress) > 0 ? "in_progress" : s.status }));
  }

  async function save() {
    const errs = validateTaskUpdate(t, v);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await postMyTaskUpdate(t.id, {
      status: v.status !== t.status ? v.status : null,
      progress: Number(v.progress) !== t.progress_pct ? Number(v.progress) : null,
      note: v.note,
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(`Update posted on "${t.title}".`);
    setV((s) => ({ ...s, note: "" }));
    onSaved();
  }

  return (
    <Modal open onClose={onClose} size="lg" title={t.title}
      footer={closed ? <Button variant="secondary" onClick={onClose}>Close</Button> : <><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} onClick={save}>Post update</Button></>}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority} priority</Badge>
          <Badge tone={TASK_TONE[t.status]}>{label(t.status)}</Badge>
          <span className={due.cls}>{due.text}</span>
        </div>
        <ProgressBar value={t.progress_pct} status={t.status} />
        <DescriptionList items={[
          { label: "Project", value: t.project ? `${t.project.code} · ${t.project.name}` : "—" },
          { label: "Project status", value: t.project ? label(t.project.status) : "—" },
          { label: "Start date", value: t.start_date ? formatDate(t.start_date) : "—" },
          { label: "Due date", value: t.due_date ? formatDate(t.due_date) : "No due date" },
          { label: "Assigned on", value: formatDate(t.created_at) },
          t.completed_at && { label: "Completed", value: formatDateTime(t.completed_at) },
        ]} />
        {t.description && <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</p><p className="mt-1 whitespace-pre-wrap text-sm text-[#101a3a]">{t.description}</p></div>}

        {closed ? (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">This project is {t.project.status}; task updates are closed.</p>
        ) : (
          <section aria-labelledby="task-update-heading" className="rounded-2xl border border-slate-200 p-4">
            <h3 id="task-update-heading" className="mb-3 text-sm font-bold text-[#101a3a]">Post an update</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Status"><Select value={v.status} onChange={(e) => setStatus(e.target.value)} options={TASK_STATUSES.map((s) => ({ value: s, label: label(s) }))} /></Field>
              <Field label="Progress %" error={errors.progress}>
                {(id) => (
                  <div className="flex items-center gap-3">
                    <input id={id} type="range" min={0} max={100} step={5} value={Number(v.progress) || 0} onChange={(e) => setProgress(e.target.value)}
                      className="flex-1 accent-[#f96706]" aria-describedby={`${id}-n`} />
                    <Input id={`${id}-n`} aria-label="Progress percent" type="number" min={0} max={100} value={v.progress} onChange={(e) => setProgress(e.target.value)} className="w-20" />
                  </div>
                )}
              </Field>
              <Field label={v.status === "blocked" && t.status !== "blocked" ? "What is blocking this task?" : "Note"} required={v.status === "blocked" && t.status !== "blocked"}
                error={errors.note} hint={v.status === "blocked" ? "Your project manager (or reporting manager) is notified." : "What you did, what's next, or anything your lead should know."} className="sm:col-span-2">
                <Textarea rows={3} maxLength={2000} value={v.note} onChange={(e) => setV((s) => ({ ...s, note: e.target.value }))} />
              </Field>
            </div>
            <div className="mt-2"><InlineError message={errors.form || error} /></div>
          </section>
        )}

        <section aria-labelledby="task-history-heading">
          <h3 id="task-history-heading" className="mb-2 flex items-center gap-1.5 text-sm font-bold text-[#101a3a]"><History className="h-4 w-4" aria-hidden="true" />Update history</h3>
          {history.loading && !history.data ? <Loading className="py-3" /> : history.error ? <ErrorState message={history.error} onRetry={history.reload} /> : !history.data?.length ? (
            <p className="text-sm text-slate-500">No updates yet.</p>
          ) : (
            <ol className="flex flex-col gap-3 border-l-2 border-slate-100 pl-4">
              {history.data.map((u) => <UpdateEntry key={u.id} u={u} who={u.author_employee_id === t.assignee_id ? "You" : "HR / manager"} />)}
            </ol>
          )}
        </section>
      </div>
    </Modal>
  );
}

function changeSummary(u) {
  const parts = [];
  if (u.old_status !== u.new_status && u.new_status) parts.push(u.old_status ? `${label(u.old_status)} → ${label(u.new_status)}` : label(u.new_status));
  if (u.old_progress !== u.new_progress && u.new_progress != null) parts.push(`${u.old_progress ?? 0}% → ${u.new_progress}%`);
  return parts.join(" · ") || "Note";
}

function UpdateEntry({ u, who, taskTitle, onOpenTask }) {
  return (
    <li className="relative">
      <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#f96706]" aria-hidden="true" />
      <p className="text-xs text-slate-500"><span className="font-semibold text-[#173a52]">{who}</span> · {formatDateTime(u.created_at)}</p>
      {taskTitle && <button type="button" onClick={onOpenTask} className="text-left text-sm font-semibold text-[#101a3a] hover:text-[#f96706]">{taskTitle}</button>}
      <p className="text-sm font-medium text-[#1f4693]">{changeSummary(u)}</p>
      {u.note && <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{u.note}</p>}
    </li>
  );
}

function ActivityTab({ onOpenTask }) {
  const q = useHrQuery(() => listMyTaskActivity(50), []);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data?.length) return <Card><EmptyState title="No updates yet" description="Status changes, progress and notes on your tasks will appear here." /></Card>;
  return (
    <Card title="Recent updates on your tasks">
      <ol className="flex flex-col gap-4 border-l-2 border-slate-100 pl-4">
        {q.data.map((u) => (
          <UpdateEntry key={u.id} u={u} who={u.author_name} taskTitle={`${u.project_code} · ${u.task_title}`} onOpenTask={() => onOpenTask(u.task_id)} />
        ))}
      </ol>
    </Card>
  );
}

function ProjectsTab({ projects, tasks, today, onViewTasks }) {
  if (projects.loading && !projects.data) return <Loading />;
  if (projects.error) return <ErrorState message={projects.error} onRetry={projects.reload} />;
  if (!projects.data?.length) return <Card><EmptyState title="No projects" description="You are not assigned to any project yet. Ask your manager to add you." /></Card>;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {projects.data.map((p) => {
        const mine = tasks.filter((t) => t.project_id === p.id);
        const done = mine.filter((t) => t.status === "done").length;
        const overdue = mine.filter((t) => isOverdue(t, today)).length;
        const blocked = mine.filter((t) => t.status === "blocked").length;
        const avg = mine.length ? Math.round(mine.reduce((s, t) => s + (t.progress_pct ?? 0), 0) / mine.length) : 0;
        const ended = p.allocation_end && p.allocation_end < today;
        return (
          <Card key={p.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-xs font-bold text-[#1f4693]">{p.code}</p>
                <p className="font-bold text-[#101a3a]">{p.name}</p>
                {p.client && <p className="text-xs text-slate-500">Client: {p.client}</p>}
              </div>
              <Badge tone={PROJECT_TONE[p.status]}>{label(p.status)}</Badge>
            </div>
            {p.description && <p className="mt-2 line-clamp-2 text-xs text-slate-600">{p.description}</p>}
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-slate-500">Your role</dt><dd className="font-semibold capitalize text-[#101a3a]">{p.member_role}{p.allocation_pct ? ` · ${p.allocation_pct}%` : ""}</dd>
              <dt className="text-slate-500">Assigned</dt><dd className="text-[#101a3a]">{p.allocation_start ? formatDate(p.allocation_start) : "—"} – {p.allocation_end ? formatDate(p.allocation_end) : "open"}</dd>
              <dt className="text-slate-500">Project dates</dt><dd className="text-[#101a3a]">{p.start_date ? formatDate(p.start_date) : "—"} – {p.end_date ? formatDate(p.end_date) : "open"}</dd>
            </dl>
            {ended && <p className="mt-2 text-xs font-semibold text-amber-700">Assignment ended — you can no longer log new work on this project.</p>}
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <span>{mine.length ? `${done} of ${mine.length} task${mine.length === 1 ? "" : "s"} done` : "No tasks assigned to you"}</span>
                <span className="flex gap-2">
                  {overdue > 0 && <span className="font-semibold text-red-600">{overdue} overdue</span>}
                  {blocked > 0 && <span className="font-semibold text-rose-600">{blocked} blocked</span>}
                </span>
              </div>
              {mine.length > 0 && <ProgressBar value={avg} status={done === mine.length ? "done" : "in_progress"} />}
              {mine.length > 0 && <Button size="sm" variant="ghost" className="mt-2 -ml-2" onClick={() => onViewTasks(p.id)}>View my tasks</Button>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
