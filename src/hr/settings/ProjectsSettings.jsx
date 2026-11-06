// Minimal HR project master + project allocation used by Daily Work Reports
// (not a Project Tracker). Project writes require daily_reports.manage;
// allocations may also be managed by the project's manager (RLS:
// hr_private.can_manage_project_allocation). Projects are never deleted
// (archive via status); tasks are closed via status "done". Allocation
// changes are kept in hr_project_allocation_history.
import { useMemo, useState } from "react";
import { History, Plus, Users } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, fullName, useHrQuery } from "@/lib/hr/client";
import { useEmployeeOptions } from "@/lib/hr/org";
import {
  PROJECT_STATUSES, TASK_PRIORITIES, TASK_STATUSES, addProjectMember, listAllocationHistory, listProjectMembers, listProjects, listTasks,
  listTaskUpdates, removeProjectMember, saveProject, saveTask, updateProjectMember, validateAllocation,
} from "@/lib/hr/dailyReports";
import {
  Badge, Button, Card, ConfirmDialog, DataTable, Field, InlineError, Input, Loading, Modal, Select, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";

const opt = (list) => list.map((s) => ({ value: s, label: s.replace(/_/g, " ") }));
export const PRIORITY_TONE = { low: "slate", medium: "blue", high: "orange", urgent: "red" };
export const TASK_TONE = { todo: "slate", in_progress: "blue", blocked: "red", done: "green" };
const PROJECT_TONE = { active: "green", on_hold: "amber", completed: "blue", archived: "slate" };

export default function ProjectsSettings({ canEdit }) {
  const { notify } = useToast();
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const q = useHrQuery(() => listProjects(), []);
  const employees = useEmployeeOptions();
  const [editing, setEditing] = useState(null);
  const [members, setMembers] = useState(null);
  const empName = (id) => employees.data?.find((o) => o.value === id)?.label ?? "—";
  return (
    <Card title="Projects" actions={canEdit && <Button size="sm" onClick={() => setEditing({ status: "active" })}><Plus className="h-4 w-4" aria-hidden="true" />Add project</Button>}>
      <p className="mb-3 text-sm text-slate-600">Employees can log daily report hours only against <strong>active</strong> projects they are allocated to on the report date. Projects are archived, never deleted. {!canEdit && "You can manage allocations of projects you manage."}</p>
      <DataTable caption="Projects" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} emptyTitle="No projects yet"
        columns={[
          { key: "code", header: "Code", sortable: true, render: (r) => <span className="font-mono text-xs font-bold text-[#1f4693]">{r.code}</span> },
          { key: "name", header: "Name", sortable: true, render: (r) => <span>{r.name}{r.source === "project_tracker" && <Badge tone="violet" className="ml-1">Project Tracker</Badge>}</span> },
          { key: "manager", header: "Project manager", render: (r) => (r.manager_employee_id ? empName(r.manager_employee_id) : "—") },
          { key: "client", header: "Client", render: (r) => r.client || "—" },
          { key: "status", header: "Status", render: (r) => <Badge tone={PROJECT_TONE[r.status]}>{r.status.replace(/_/g, " ")}</Badge> },
          { key: "dates", header: "Dates", render: (r) => `${formatDate(r.start_date)} – ${formatDate(r.end_date)}` },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setMembers(r)}><Users className="h-4 w-4" aria-hidden="true" />Allocation</Button>
              {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>}
            </div>) },
        ]} />
      {editing && <ProjectModal row={editing} employeeOptions={employees.data ?? []} onClose={() => setEditing(null)} onSaved={(isNew) => { setEditing(null); q.reload(); notify(`Project ${isNew ? "created" : "updated"}.`); }} />}
      {members && <MembersModal project={members} canEdit={canEdit || (Boolean(me) && members.manager_employee_id === me)} onClose={() => setMembers(null)} />}
    </Card>
  );
}

function ProjectModal({ row, employeeOptions, onClose, onSaved }) {
  const [v, setV] = useState({ code: "", name: "", client: "", description: "", start_date: "", end_date: "", manager_employee_id: "", ...row });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    const errs = {};
    if (!/^[A-Z0-9_-]{2,20}$/.test((v.code ?? "").trim().toUpperCase())) errs.code = "2–20 letters, digits, _ or -.";
    const n = (v.name ?? "").trim();
    if (n.length < 2 || n.length > 150) errs.name = "2–150 characters.";
    if ((v.client ?? "").length > 150) errs.client = "At most 150 characters.";
    if (v.start_date && v.end_date && v.end_date < v.start_date) errs.end_date = "End date must be on or after the start date.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await saveProject(v);
    setBusy(false);
    if (res.error) setError(res.error); else onSaved(!row.id);
  }
  return (
    <Modal open onClose={onClose} title={row.id ? "Edit project" : "Add project"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Code" required error={errors.code} hint="e.g. PRJ-001"><Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Status" required><Select value={v.status} onChange={set("status")} options={opt(PROJECT_STATUSES)} /></Field>
        <Field label="Name" required error={errors.name} className="sm:col-span-2"><Input maxLength={150} value={v.name} onChange={set("name")} /></Field>
        <Field label="Client" error={errors.client}><Input maxLength={150} value={v.client ?? ""} onChange={set("client")} /></Field>
        <Field label="Project manager" hint="Can manage this project's allocations (needs the manager role)."><Select placeholder="None" value={v.manager_employee_id ?? ""} onChange={set("manager_employee_id")} options={employeeOptions} /></Field>
        <Field label="Start date"><Input type="date" value={v.start_date ?? ""} onChange={set("start_date")} /></Field>
        <Field label="End date" error={errors.end_date}><Input type="date" value={v.end_date ?? ""} onChange={set("end_date")} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea maxLength={4000} value={v.description ?? ""} onChange={set("description")} /></Field>
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

const EMPTY_ALLOC = { employee: "", role: "member", start_date: "", end_date: "", allocation_pct: "", notes: "" };
const allocPeriod = (r) => (r.start_date || r.end_date ? `${formatDate(r.start_date)} – ${r.end_date ? formatDate(r.end_date) : "open"}` : "No end date");

function MembersModal({ project, canEdit, onClose }) {
  const { notify } = useToast();
  const q = useHrQuery(() => listProjectMembers(project.id), [project.id]);
  const history = useHrQuery(() => listAllocationHistory(project.id), [project.id]);
  const employees = useEmployeeOptions();
  const [tab, setTab] = useState("current");
  const [add, setAdd] = useState(EMPTY_ALLOC);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const memberIds = new Set((q.data ?? []).map((m) => m.employee_id));
  const reloadAll = () => { q.reload(); history.reload(); };
  async function addMember() {
    const errs = validateAllocation(add);
    if (!add.employee) errs.employee = "Choose an employee.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await addProjectMember(project.id, add.employee, add);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setAdd(EMPTY_ALLOC); reloadAll(); notify("Employee allocated.");
  }
  return (
    <Modal open onClose={onClose} title={`Allocation · ${project.code}`} size="lg" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <Tabs value={tab} onChange={setTab} label="Allocation sections" tabs={[{ value: "current", label: "Assigned employees", count: q.data?.length }, { value: "history", label: "History" }]} />
      {tab === "current" && (
        <>
          {canEdit && (
            <div className="mb-4 grid grid-cols-1 gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-3">
              <Field label="Employee" required error={errors.employee} className="sm:col-span-2"><Select placeholder={employees.loading ? "Loading…" : "Choose employee"} value={add.employee} onChange={(e) => setAdd({ ...add, employee: e.target.value })} options={(employees.data ?? []).filter((o) => !memberIds.has(o.value))} /></Field>
              <Field label="Role" required error={errors.role}><Input maxLength={60} value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })} /></Field>
              <Field label="Assignment start"><Input type="date" value={add.start_date} onChange={(e) => setAdd({ ...add, start_date: e.target.value })} /></Field>
              <Field label="Assignment end" error={errors.end_date}><Input type="date" value={add.end_date} onChange={(e) => setAdd({ ...add, end_date: e.target.value })} /></Field>
              <Field label="Allocation %" error={errors.allocation_pct}><Input type="number" min="1" max="100" value={add.allocation_pct} onChange={(e) => setAdd({ ...add, allocation_pct: e.target.value })} /></Field>
              <div className="flex items-end justify-end sm:col-span-3"><Button loading={busy} onClick={addMember}><Plus className="h-4 w-4" aria-hidden="true" />Allocate</Button></div>
              <div className="sm:col-span-3"><InlineError message={error || employees.error} /></div>
            </div>
          )}
          <DataTable caption="Assigned employees" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} emptyTitle="Nobody allocated yet"
            columns={[
              { key: "employee", header: "Employee", render: (r) => (r.employee ? `${fullName(r.employee)} (${r.employee.employee_code})` : "—") },
              { key: "role", header: "Role" },
              { key: "period", header: "Assignment", render: allocPeriod },
              { key: "allocation_pct", header: "Allocation", render: (r) => (r.allocation_pct ? `${r.allocation_pct}%` : "—") },
              ...(canEdit ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (
                <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => setRemoving(r)}>Remove</Button></div>) }] : []),
            ]} />
          <p className="mt-2 text-xs text-slate-500">To end an assignment but keep it visible, set an end date. Removing it keeps the record in History.</p>
        </>
      )}
      {tab === "history" && (
        <DataTable caption="Allocation history" rows={history.data} loading={history.loading} error={history.error} onRetry={history.reload} emptyTitle="No history"
          columns={[
            { key: "created_at", header: "When", render: (r) => formatDateTime(r.created_at) },
            { key: "action", header: "Change", render: (r) => <Badge tone={r.action === "removed" ? "red" : r.action === "assigned" ? "green" : "blue"}><History className="mr-1 inline h-3 w-3" aria-hidden="true" />{r.action}</Badge> },
            { key: "employee", header: "Employee", render: (r) => (r.employee ? fullName(r.employee) : "—") },
            { key: "role", header: "Role" },
            { key: "period", header: "Assignment", render: allocPeriod },
            { key: "allocation_pct", header: "Allocation", render: (r) => (r.allocation_pct ? `${r.allocation_pct}%` : "—") },
          ]} />
      )}
      {editing && <AllocationModal row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reloadAll(); notify("Allocation updated."); }} />}
      <ConfirmDialog open={Boolean(removing)} onClose={() => setRemoving(null)} title="Remove allocation?" tone="danger" confirmLabel="Remove"
        message={removing ? `${fullName(removing.employee)} will no longer be able to log new report tasks against ${project.code}. Existing reports and the allocation history are kept.` : ""}
        onConfirm={async () => {
          const res = await removeProjectMember(removing.id);
          if (res.error) return { error: res.error };
          if (!res.data?.length) return { error: "The allocation could not be removed." };
          reloadAll(); notify("Allocation removed.");
          return {};
        }} />
    </Modal>
  );
}

function AllocationModal({ row, onClose, onSaved }) {
  const [v, setV] = useState({ role: row.role ?? "member", start_date: row.start_date ?? "", end_date: row.end_date ?? "", allocation_pct: row.allocation_pct ?? "", notes: row.notes ?? "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    const errs = validateAllocation(v);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await updateProjectMember(row.id, v);
    setBusy(false);
    if (res.error) setError(res.error); else onSaved();
  }
  return (
    <Modal open onClose={onClose} title={`Edit allocation · ${row.employee ? fullName(row.employee) : ""}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Role" required error={errors.role}><Input maxLength={60} value={v.role} onChange={set("role")} /></Field>
        <Field label="Allocation %" error={errors.allocation_pct}><Input type="number" min="1" max="100" value={v.allocation_pct} onChange={set("allocation_pct")} /></Field>
        <Field label="Assignment start"><Input type="date" value={v.start_date} onChange={set("start_date")} /></Field>
        <Field label="Assignment end" error={errors.end_date}><Input type="date" value={v.end_date} onChange={set("end_date")} /></Field>
        <Field label="Notes" error={errors.notes} className="sm:col-span-2"><Textarea rows={2} maxLength={1000} value={v.notes} onChange={set("notes")} /></Field>
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

/** Task management (daily_reports.manage). Used by the Daily Reports page. */
export function TasksManager({ canEdit }) {
  const { notify } = useToast();
  const projects = useHrQuery(() => listProjects(), []);
  const employees = useEmployeeOptions();
  const [f, setF] = useState({ project: "", assignee: "", status: "" });
  const q = useHrQuery(() => listTasks(f), [f.project, f.assignee, f.status]);
  const [editing, setEditing] = useState(null);
  const projectOptions = useMemo(() => (projects.data ?? []).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })), [projects.data]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Card title="Tasks" actions={canEdit && <Button size="sm" onClick={() => setEditing({ status: "todo", priority: "medium", project_id: f.project })}><Plus className="h-4 w-4" aria-hidden="true" />Add task</Button>}>
      <Toolbar>
        <Field label="Project" className="sm:w-56"><Select placeholder="All projects" value={f.project} onChange={set("project")} options={projectOptions} /></Field>
        <Field label="Assignee" className="sm:w-56"><Select placeholder="Anyone" value={f.assignee} onChange={set("assignee")} options={employees.data ?? []} /></Field>
        <Field label="Status" className="sm:w-40"><Select placeholder="All" value={f.status} onChange={set("status")} options={opt(TASK_STATUSES)} /></Field>
      </Toolbar>
      <DataTable caption="Tasks" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} emptyTitle="No tasks"
        columns={[
          { key: "title", header: "Task", sortable: true, render: (r) => <div className="min-w-[12rem]"><p className="font-semibold text-[#101a3a]">{r.title}</p><p className="text-xs text-slate-500">{r.project ? `${r.project.code} · ${r.project.name}` : "—"}</p></div> },
          { key: "assignee", header: "Assignee", render: (r) => (r.assignee ? fullName(r.assignee) : "Unassigned") },
          { key: "priority", header: "Priority", render: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{r.priority}</Badge> },
          { key: "status", header: "Status", render: (r) => <Badge tone={TASK_TONE[r.status]}>{r.status.replace(/_/g, " ")}</Badge> },
          { key: "progress_pct", header: "Progress", sortable: true, render: (r) => (
            <div className="flex min-w-[6rem] items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${r.status === "done" ? "bg-emerald-500" : r.status === "blocked" ? "bg-rose-500" : "bg-[#f96706]"}`} style={{ width: `${r.progress_pct ?? 0}%` }} /></div><span className="text-xs tabular-nums text-slate-600">{r.progress_pct ?? 0}%</span></div>
          ) },
          { key: "due_date", header: "Due", sortable: true, render: (r) => <span className={r.status !== "done" && r.due_date && r.due_date < new Date().toISOString().slice(0, 10) ? "font-semibold text-red-600" : ""}>{formatDate(r.due_date)}</span> },
          ...(canEdit ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button> }] : []),
        ]} />
      {editing && (
        <TaskModal row={editing} projectOptions={(projects.data ?? []).filter((p) => p.status === "active" || p.id === editing.project_id).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))}
          onClose={() => setEditing(null)} onSaved={(isNew) => { setEditing(null); q.reload(); notify(`Task ${isNew ? "created" : "updated"}.`); }} />
      )}
    </Card>
  );
}

function TaskModal({ row, projectOptions, onClose, onSaved }) {
  const [v, setV] = useState({ title: "", description: "", assignee_id: "", start_date: "", due_date: "", project_id: "", ...row });
  const history = useHrQuery(() => (row.id ? listTaskUpdates(row.id) : Promise.resolve({ data: [], error: null })), [row.id]);
  const members = useHrQuery(() => (v.project_id ? listProjectMembers(v.project_id) : Promise.resolve({ data: [], error: null })), [v.project_id]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const memberOptions = (members.data ?? []).map((m) => ({ value: m.employee_id, label: m.employee ? `${fullName(m.employee)} (${m.employee.employee_code})` : m.employee_id }));
  if (v.assignee_id && row.assignee && !memberOptions.some((o) => o.value === v.assignee_id)) memberOptions.push({ value: v.assignee_id, label: `${fullName(row.assignee)} (not a member)` });
  async function save() {
    const errs = {};
    if (!v.project_id) errs.project_id = "Choose a project.";
    const t = (v.title ?? "").trim();
    if (t.length < 2 || t.length > 200) errs.title = "2–200 characters.";
    if (v.start_date && v.due_date && v.due_date < v.start_date) errs.due_date = "Due date must be on or after the start date.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await saveTask(v);
    setBusy(false);
    if (res.error) setError(res.error); else onSaved(!row.id);
  }
  return (
    <Modal open onClose={onClose} title={row.id ? "Edit task" : "Add task"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Project" required error={errors.project_id} className="sm:col-span-2">
          <Select placeholder="Choose project" value={v.project_id} disabled={Boolean(row.id)} onChange={(e) => setV({ ...v, project_id: e.target.value, assignee_id: "" })} options={projectOptions} />
        </Field>
        <Field label="Title" required error={errors.title} className="sm:col-span-2"><Input maxLength={200} value={v.title} onChange={set("title")} /></Field>
        <Field label="Assignee" hint="Only project members can log hours against the task.">
          {members.loading && v.project_id ? <Loading className="py-2" /> : <Select placeholder="Unassigned" value={v.assignee_id ?? ""} onChange={set("assignee_id")} options={memberOptions} />}
        </Field>
        <Field label="Start date"><Input type="date" value={v.start_date ?? ""} onChange={set("start_date")} /></Field>
        <Field label="Due date" error={errors.due_date}><Input type="date" value={v.due_date ?? ""} onChange={set("due_date")} /></Field>
        <Field label="Status"><Select value={v.status} onChange={set("status")} options={opt(TASK_STATUSES)} /></Field>
        <Field label="Priority"><Select value={v.priority} onChange={set("priority")} options={opt(TASK_PRIORITIES)} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea maxLength={4000} value={v.description ?? ""} onChange={set("description")} /></Field>
      </div>
      <div className="mt-3"><InlineError message={error || members.error} /></div>
      {row.id && (
        <section className="mt-4 border-t border-slate-100 pt-3" aria-label="Update history">
          <p className="mb-2 text-sm font-bold text-[#101a3a]">Progress {row.progress_pct ?? 0}% · update history</p>
          {history.loading && !history.data ? <Loading className="py-2" /> : history.error ? <InlineError message={history.error} /> : !history.data?.length ? (
            <p className="text-sm text-slate-500">No updates yet.</p>
          ) : (
            <ol className="flex max-h-60 flex-col gap-2 overflow-y-auto">
              {history.data.map((u) => (
                <li key={u.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <p className="text-xs text-slate-500">{formatDateTime(u.created_at)}{u.author_employee_id === row.assignee_id ? " · assignee" : ""}</p>
                  <p className="font-medium text-[#1f4693]">
                    {[u.old_status !== u.new_status && `${(u.old_status ?? "").replace(/_/g, " ")} → ${(u.new_status ?? "").replace(/_/g, " ")}`,
                      u.old_progress !== u.new_progress && `${u.old_progress ?? 0}% → ${u.new_progress}%`].filter(Boolean).join(" · ") || "Note"}
                  </p>
                  {u.note && <p className="whitespace-pre-wrap text-slate-700">{u.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </Modal>
  );
}
