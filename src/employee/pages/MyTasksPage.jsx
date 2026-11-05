// Employee: tasks assigned to me (grouped by project) with status updates
// via hr_update_my_task_status, and the projects I am a member of.
import { useMemo, useState } from "react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, useHrQuery } from "@/lib/hr/client";
import { TASK_STATUSES, listMyProjects, listMyTasks, updateMyTaskStatus } from "@/lib/hr/dailyReports";
import { Badge, Card, EmptyState, ErrorState, Field, KpiCard, Loading, PageHeader, Select, Tabs, useToast } from "@/hr/ui";
import { businessToday, useBusinessTimezone } from "@/lib/hr/attendance";
import { AlertTriangle, Clock, ListTodo, Timer } from "lucide-react";

const PRIORITY_TONE = { low: "slate", medium: "blue", high: "orange", urgent: "red" };
const TASK_TONE = { todo: "slate", in_progress: "blue", blocked: "red", done: "green" };
const PROJECT_TONE = { active: "green", on_hold: "amber", completed: "blue", archived: "slate" };
const label = (s) => s.replace(/_/g, " ");

export default function MyTasksPage() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const tz = useBusinessTimezone();
  const today = businessToday(tz);
  const tasks = useHrQuery(() => listMyTasks(me), [me]);
  const projects = useHrQuery(() => listMyProjects(me), [me]);
  const [tab, setTab] = useState("tasks");
  const [status, setStatus] = useState("open");

  const counts = useMemo(() => {
    const c = { todo: 0, in_progress: 0, blocked: 0, done: 0, overdue: 0 };
    for (const t of tasks.data ?? []) { c[t.status] += 1; if (t.status !== "done" && t.due_date && t.due_date < today) c.overdue += 1; }
    return c;
  }, [tasks.data, today]);

  const groups = useMemo(() => {
    const list = (tasks.data ?? []).filter((t) => (status === "open" ? t.status !== "done" : !status || t.status === status));
    const m = new Map();
    for (const t of list) {
      const k = t.project?.id ?? "none";
      if (!m.has(k)) m.set(k, { project: t.project, tasks: [] });
      m.get(k).tasks.push(t);
    }
    return [...m.values()].sort((a, b) => (a.project?.name ?? "").localeCompare(b.project?.name ?? ""));
  }, [tasks.data, status]);

  return (
    <>
      <PageHeader title="My Tasks & Projects" description="Tasks assigned to you by project leads. Update the status as you work; HR and your manager see the same status." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="To do" value={counts.todo} icon={ListTodo} tone="slate" loading={tasks.loading} />
        <KpiCard label="In progress" value={counts.in_progress} icon={Timer} tone="teal" loading={tasks.loading} />
        <KpiCard label="Blocked" value={counts.blocked} icon={AlertTriangle} tone="red" loading={tasks.loading} />
        <KpiCard label="Overdue" value={counts.overdue} icon={Clock} tone="orange" loading={tasks.loading} hint="Not done, past due date" />
      </div>
      <Tabs value={tab} onChange={setTab} label="Tasks and projects" tabs={[{ value: "tasks", label: "My tasks", count: tasks.data?.length }, { value: "projects", label: "My projects", count: projects.data?.length }]} />
      {tab === "tasks" && (
        <>
          <div className="mb-3 sm:w-56">
            <Field label="Show"><Select value={status} onChange={(e) => setStatus(e.target.value)}
              options={[{ value: "open", label: "Open (not done)" }, { value: "", label: "All tasks" }, ...TASK_STATUSES.map((s) => ({ value: s, label: label(s) }))]} /></Field>
          </div>
          {tasks.loading && !tasks.data ? <Loading /> : tasks.error ? <ErrorState message={tasks.error} onRetry={tasks.reload} /> : !groups.length ? (
            <Card><EmptyState title="No tasks" description={status === "open" ? "You have no open tasks." : "No tasks match this filter."} /></Card>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((g) => (
                <Card key={g.project?.id ?? "none"} title={g.project ? `${g.project.code} · ${g.project.name}` : "No project"} padded={false}>
                  <ul className="divide-y divide-slate-100">
                    {g.tasks.map((t) => <TaskRow key={t.id} task={t} today={today} onChanged={tasks.reload} />)}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
      {tab === "projects" && (
        projects.loading && !projects.data ? <Loading /> : projects.error ? <ErrorState message={projects.error} onRetry={projects.reload} /> : !projects.data?.length ? (
          <Card><EmptyState title="No projects" description="You are not a member of any project yet. Ask your manager to add you." /></Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {projects.data.map((p) => (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-[#1f4693]">{p.code}</p>
                    <p className="font-bold text-[#101a3a]">{p.name}</p>
                    {p.client && <p className="text-xs text-slate-500">Client: {p.client}</p>}
                  </div>
                  <Badge tone={PROJECT_TONE[p.status]}>{label(p.status)}</Badge>
                </div>
                <p className="mt-2 text-xs text-slate-600">Your role: {p.member_role}{p.allocation_pct ? ` · ${p.allocation_pct}%` : ""} · assigned {p.allocation_start || p.allocation_end ? `${formatDate(p.allocation_start)} – ${p.allocation_end ? formatDate(p.allocation_end) : "open"}` : "(no end date)"}</p>
                {p.allocation_end && p.allocation_end < today && <p className="text-xs font-semibold text-amber-700">Assignment ended — you can no longer log new work on this project.</p>}
                <p className="mt-1 text-xs text-slate-500">{(tasks.data ?? []).filter((t) => t.project_id === p.id && t.status !== "done").length} open task(s) assigned to you</p>
              </Card>
            ))}
          </div>
        )
      )}
    </>
  );
}

function TaskRow({ task: t, today, onChanged }) {
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const overdue = t.status !== "done" && t.due_date && t.due_date < today;
  async function change(e) {
    const next = e.target.value;
    if (next === t.status) return;
    setBusy(true); setError(null);
    const res = await updateMyTaskStatus(t.id, next);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(`"${t.title}" is now ${label(next)}.`);
    onChanged();
  }
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-semibold text-[#101a3a]">{t.title}</p>
        {t.description && <p className="line-clamp-2 text-xs text-slate-600">{t.description}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
          <Badge tone={TASK_TONE[t.status]}>{label(t.status)}</Badge>
          <span className={overdue ? "font-semibold text-red-600" : "text-slate-500"}>Due {formatDate(t.due_date)}{overdue ? " (overdue)" : ""}</span>
        </div>
        {error && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{error}</p>}
      </div>
      <div className="sm:w-44">
        <label className="sr-only" htmlFor={`task-${t.id}`}>Status for {t.title}</label>
        <select id={`task-${t.id}`} value={t.status} onChange={change} disabled={busy}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#f96706] focus:outline-none focus:ring-4 focus:ring-[#f96706]/15 disabled:opacity-60">
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      </div>
    </li>
  );
}
