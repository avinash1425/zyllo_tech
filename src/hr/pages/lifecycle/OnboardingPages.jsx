// Onboarding cases: list, create, case detail with checklist (owners, due
// dates, evidence, acknowledgement, Assets / Training links), joining status,
// documents, lifecycle timeline and audit history.
import { useMemo, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban, CheckCircle2, Circle, Clock3, Link2, Pencil, Plus, RotateCcw, UserCog } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, fullName, useHrQuery } from "@/lib/hr/client";
import { useEmployeeOptions, useOrg, toOptions } from "@/lib/hr/org";
import { documentChecklist, listEmployeeDocuments } from "@/lib/hr/documents";
import { employeeOpenAssets } from "@/lib/hr/assets";
import { listCourses } from "@/lib/hr/training";
import {
  JOINING_STATUSES, OWNER_ROLES, TASK_CATEGORIES, TASK_KINDS, addOnboardingTask, assignOnboardingTask, cancelOnboarding, completeOnboarding,
  completeOnboardingTask, createOnboardingCase, getOnboardingCase, getOnboardingEvents, getOnboardingTasks, linkTaskAsset, linkTaskTraining,
  listOnboardingCases, listOnboardingTemplates, reopenOnboardingTask, setJoiningStatus, updateOnboardingCase, waiveOnboardingTask,
} from "@/lib/hr/lifecycle";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, DescriptionList, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal,
  SearchInput, Select, StatusBadge, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";
import { DueDate, EventList, LifecycleTimeline, Progress, empText, label, lifecycleSteps, today } from "./shared";

const BASE = "/hr/onboarding-exit/onboarding";
const ownerLabel = (o) => OWNER_ROLES.find((x) => x.value === o)?.label ?? label(o);
const joinLabel = (s) => JOINING_STATUSES.find((x) => x.value === s)?.label ?? label(s);

// ------------------------------------------------------------------ list
function NewCaseModal({ onClose, onDone }) {
  const { notify } = useToast();
  const { hr } = useAuth();
  const employees = useEmployeeOptions();
  const templates = useHrQuery(listOnboardingTemplates, []);
  const [v, setV] = useState({ employee: "", template: "", coordinator: hr?.employee?.id ?? "", notes: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const eligible = (employees.data ?? []).filter((o) => ["onboarding", "probation", "active"].includes(o.row.status) && o.value !== hr?.employee?.id);
  async function submit() {
    if (!v.employee) { setError("Choose the employee."); return; }
    setBusy(true); setError(null);
    const res = await createOnboardingCase(v);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Onboarding case created with its checklist.");
    onDone(res.data);
  }
  return (
    <Modal open onClose={onClose} title="New onboarding case"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Create case</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">Hires converted from Recruitment get a case automatically. Use this for employees added another way. One case per employee.</p>
        <InlineError message={employees.error || templates.error} />
        <Field label="Employee" required><Select placeholder="Choose an employee" value={v.employee} onChange={set("employee")} options={eligible} /></Field>
        <Field label="Checklist template" hint="Empty = the template for the employment type, or the default."><Select placeholder="Automatic" value={v.template} onChange={set("template")} options={toOptions(templates.data)} /></Field>
        <Field label="HR coordinator"><Select placeholder="None" value={v.coordinator} onChange={set("coordinator")} options={employees.data ?? []} /></Field>
        <Field label="Notes (internal)"><Textarea value={v.notes} maxLength={4000} onChange={set("notes")} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function CaseList() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState("open");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const list = useHrQuery(() => listOnboardingCases({ status }), [status]);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (list.data ?? []).filter((c) => !s || `${fullName(c.employee)} ${c.employee?.employee_code}`.toLowerCase().includes(s));
  }, [list.data, search]);
  return (
    <>
      <Toolbar>
        <Tabs value={status} onChange={setStatus} label="Case status" tabs={[{ value: "open", label: "Open" }, { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" }, { value: "", label: "All" }]} />
        <div className="flex flex-1 gap-2 sm:justify-end">
          <SearchInput value={search} onChange={setSearch} placeholder="Search joiners…" />
          {hasPermission("onboarding.manage") && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden="true" />New case</Button>}
        </div>
      </Toolbar>
      <DataTable caption="Onboarding cases" rows={rows} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle={status === "open" ? "No open onboarding" : "No onboarding cases"} emptyDescription="Cases appear when HR converts a candidate with an accepted offer."
        onRowClick={(r) => navigate(`${BASE}/${r.id}`)}
        columns={[
          { key: "employee", header: "Joiner", render: (r) => <div className="min-w-[10rem]"><p className="font-semibold text-[#101a3a]">{fullName(r.employee)}</p><p className="font-mono text-xs text-slate-500">{r.employee?.employee_code}</p></div> },
          { key: "joining_date", header: "Joining date", sortable: true, render: (r) => formatDate(r.joining_date) },
          { key: "joining_status", header: "Joining", render: (r) => <Badge tone={r.joining_status === "joined" ? "green" : r.joining_status === "no_show" ? "red" : r.joining_status === "deferred" ? "orange" : "blue"}>{joinLabel(r.joining_status)}</Badge> },
          { key: "progress", header: "Checklist", render: (r) => { const t = r.tasks ?? []; const done = t.filter((x) => ["completed", "waived"].includes(x.status)).length; return <Progress done={done} total={t.length} tone={done === t.length && t.length ? "green" : "orange"} />; } },
          { key: "overdue", header: "Overdue", render: (r) => { const n = (r.tasks ?? []).filter((x) => ["pending", "in_progress"].includes(x.status) && x.due_date && x.due_date < today()).length; return n ? <Badge tone="red">{n}</Badge> : <span className="text-slate-400">0</span>; } },
          { key: "department", header: "Department", render: (r) => r.department?.name ?? "—" },
          { key: "coordinator", header: "HR coordinator", render: (r) => (r.coordinator ? fullName(r.coordinator) : "—") },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
        ]} />
      {creating && <NewCaseModal onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); list.reload(); if (id) navigate(`${BASE}/${id}`); }} />}
    </>
  );
}

// ---------------------------------------------------------------- detail
function EditCaseModal({ c, onClose, onDone }) {
  const { notify } = useToast();
  const employees = useEmployeeOptions();
  const org = useOrg();
  const [v, setV] = useState({ joining_date: c.joining_date ?? "", coordinator: c.hr_coordinator_id ?? "", manager: c.reporting_manager_id ?? "",
    department: c.department_id ?? "", designation: c.designation_id ?? "", notes: c.notes ?? "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const designations = (org.data?.designations ?? []).filter((d) => d.active !== false && (!d.department_id || !v.department || d.department_id === v.department));
  async function submit() {
    setBusy(true); setError(null);
    const res = await updateOnboardingCase(c.id, { ...v, notes: v.notes });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Onboarding details saved. Employee record updated.");
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Edit onboarding details"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">Joining date, reporting manager, department and designation are also changed on the Employee Management record. Pending task due dates move with the joining date.</p>
        <InlineError message={employees.error || org.error} />
        <Field label="Joining date"><Input type="date" value={v.joining_date} onChange={set("joining_date")} /></Field>
        <Field label="HR coordinator"><Select placeholder="Unchanged" value={v.coordinator} onChange={set("coordinator")} options={employees.data ?? []} /></Field>
        <Field label="Reporting manager"><Select placeholder="Unchanged" value={v.manager} onChange={set("manager")} options={(employees.data ?? []).filter((o) => o.value !== c.employee_id)} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Department"><Select placeholder="Unchanged" value={v.department} onChange={set("department")} options={toOptions(org.data?.departments)} /></Field>
          <Field label="Designation"><Select placeholder="Unchanged" value={v.designation} onChange={set("designation")} options={toOptions(designations)} /></Field>
        </div>
        <Field label="Notes (internal — never shown to the employee)"><Textarea value={v.notes} maxLength={4000} onChange={set("notes")} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function JoiningModal({ c, onClose, onDone }) {
  const { notify } = useToast();
  const [status, setStatus] = useState(c.joining_status === "awaiting_joining" ? "joined" : c.joining_status);
  const [date, setDate] = useState(c.joining_date ?? today());
  const [note, setNote] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (status === "joined" && date > today()) { setError("The joining date is in the future."); return; }
    if (["deferred", "no_show"].includes(status) && !note.trim()) { setError("Add a note."); return; }
    setBusy(true); setError(null);
    const res = await setJoiningStatus(c.id, status, ["joined", "deferred"].includes(status) ? date : null, note);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Joining status updated.");
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Joining status" size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)} options={JOINING_STATUSES} /></Field>
        {["joined", "deferred"].includes(status) && <Field label={status === "joined" ? "Actual joining date" : "New joining date"}><Input type="date" value={date} max={status === "joined" ? today() : undefined} onChange={(e) => setDate(e.target.value)} /></Field>}
        <Field label="Note" required={["deferred", "no_show"].includes(status)}><Textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function AddTaskModal({ caseId, employees, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ title: "", category: "other", kind: "manual", owner_role: "hr", assignee: "", due_date: "", mandatory: true, visible: true, requires_evidence: false, description: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  async function submit() {
    if (v.title.trim().length < 2) { setError("Enter a task title."); return; }
    setBusy(true); setError(null);
    const res = await addOnboardingTask(caseId, v);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Task added."); onDone();
  }
  return (
    <Modal open onClose={onClose} title="Add checklist task"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Add task</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Title" required><Input value={v.title} maxLength={200} onChange={set("title")} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Category"><Select value={v.category} onChange={set("category")} options={TASK_CATEGORIES} /></Field>
          <Field label="Completion rule"><Select value={v.kind} onChange={set("kind")} options={TASK_KINDS} /></Field>
          <Field label="Owner"><Select value={v.owner_role} onChange={set("owner_role")} options={OWNER_ROLES} /></Field>
          <Field label="Responsible person"><Select placeholder="Unassigned" value={v.assignee} onChange={set("assignee")} options={employees} disabled={v.owner_role === "employee"} /></Field>
          <Field label="Due date"><Input type="date" value={v.due_date} onChange={set("due_date")} /></Field>
        </div>
        <Field label="Description"><Textarea value={v.description} maxLength={2000} onChange={set("description")} /></Field>
        <div className="flex flex-wrap gap-4">
          <Checkbox label="Mandatory" checked={v.mandatory} onChange={set("mandatory")} />
          <Checkbox label="Requires evidence" checked={v.requires_evidence} onChange={set("requires_evidence")} />
          <Checkbox label="Visible to the employee" checked={v.visible} onChange={set("visible")} />
        </div>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function CompleteTaskModal({ task, employeeId, onClose, onDone }) {
  const { notify } = useToast();
  const docs = useHrQuery(() => listEmployeeDocuments(employeeId), [employeeId]);
  const [note, setNote] = useState("");
  const [doc, setDoc] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError(null);
    const res = await completeOnboardingTask(task.id, note, doc);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Task completed."); onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Complete: ${task.title}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="success" loading={busy} onClick={submit}>Complete task</Button></>}>
      <div className="flex flex-col gap-3">
        {task.task_kind === "documents" && <p className="text-sm text-slate-600">All required checklist documents must be verified first.</p>}
        {task.task_kind === "asset" && !task.asset_assignment_id && <p className="text-sm text-slate-600">Link the assigned equipment, or record what was handed over below.</p>}
        <Field label={`Completion evidence${task.requires_evidence ? "" : " (optional)"}`} required={task.requires_evidence}><Textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></Field>
        <Field label="Supporting document (optional)" hint="From the employee's secure documents.">
          <Select placeholder={docs.loading ? "Loading…" : "None"} value={doc} onChange={(e) => setDoc(e.target.value)}
            options={(docs.data ?? []).map((d) => ({ value: d.id, label: `${d.title} · ${d.category?.name ?? ""} (${d.verification_status})` }))} />
        </Field>
        <InlineError message={error || docs.error} />
      </div>
    </Modal>
  );
}

function AssignTaskModal({ task, employees, onClose, onDone }) {
  const { notify } = useToast();
  const [assignee, setAssignee] = useState(task.assignee_employee_id ?? "");
  const [due, setDue] = useState(task.due_date ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError(null);
    const res = await assignOnboardingTask(task.id, assignee, due);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Task updated."); onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Owner & due date: ${task.title}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Responsible person"><Select placeholder="Unassigned" value={assignee} onChange={(e) => setAssignee(e.target.value)} options={employees} /></Field>
        <Field label="Due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function LinkTaskModal({ task, employeeId, onClose, onDone }) {
  const { notify } = useToast();
  const isAsset = task.task_kind === "asset" || task.category === "equipment";
  const assets = useHrQuery(() => (isAsset ? employeeOpenAssets(employeeId) : Promise.resolve({ data: [], error: null })), [employeeId, isAsset]);
  const courses = useHrQuery(() => (isAsset ? Promise.resolve({ data: [], error: null }) : listCourses({ activeOnly: true })), [isAsset]);
  const [value, setValue] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!value) { setError(isAsset ? "Choose an asset assignment." : "Choose a training course."); return; }
    setBusy(true); setError(null);
    const res = isAsset ? await linkTaskAsset(task.id, value) : await linkTaskTraining(task.id, value);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(isAsset ? "Equipment linked." : "Training assigned and linked."); onDone();
  }
  const options = isAsset
    ? (assets.data ?? []).map((a) => ({ value: a.assignment_id, label: `${a.asset_tag} · ${a.asset_type} ${[a.brand, a.model].filter(Boolean).join(" ")}` }))
    : (courses.data ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.title}` }));
  return (
    <Modal open onClose={onClose} title={isAsset ? "Link assigned equipment" : "Link induction training"} size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Link</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">{isAsset ? "Assign the equipment in Assets first; it then appears here." : "The course is assigned to the employee in Training. The task completes automatically when the training is completed."}</p>
        <Field label={isAsset ? "Asset assignment" : "Training course"}><Select placeholder={(assets.loading || courses.loading) ? "Loading…" : "Choose…"} value={value} onChange={(e) => setValue(e.target.value)} options={options} /></Field>
        {isAsset && !assets.loading && !options.length && <p className="text-xs text-amber-800"><Link className="font-semibold underline" to="/hr/assets">Open Assets</Link> to assign equipment to this employee.</p>}
        <InlineError message={error || assets.error || courses.error} />
      </div>
    </Modal>
  );
}

function TaskRow({ task, c, canManage, canComplete, onAction }) {
  const closed = ["completed", "waived"].includes(task.status);
  const Icon = task.status === "completed" ? CheckCircle2 : task.status === "waived" ? Ban : task.status === "in_progress" ? Clock3 : Circle;
  const open = c.status === "open";
  return (
    <li className="rounded-xl border border-slate-100 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-[#101a3a]">
            <Icon className={task.status === "completed" ? "h-4 w-4 text-emerald-600" : task.status === "waived" ? "h-4 w-4 text-slate-400" : "h-4 w-4 text-amber-500"} aria-hidden="true" />
            {task.title}
            {task.mandatory && <Badge tone="orange">Mandatory</Badge>}
            {task.task_kind === "acknowledgement" && <Badge tone="violet">Employee acknowledgement</Badge>}
            {task.task_kind === "training" && <Badge tone="blue">Training</Badge>}
            {task.task_kind === "asset" && <Badge tone="blue">Assets</Badge>}
            {!task.visible_to_employee && <Badge>Internal</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {ownerLabel(task.owner_role)}{task.assignee ? ` · ${fullName(task.assignee)}` : ""} · Due <DueDate value={task.due_date} status={task.status} /> · <StatusBadge status={task.status} />
            {task.completed_at ? ` · ${formatDateTime(task.completed_at)}` : ""}
          </p>
          {task.description && <p className="mt-1 text-sm text-slate-600">{task.description}</p>}
          {task.evidence_note && <p className="mt-1 text-sm text-slate-700"><span className="font-semibold">Evidence:</span> {task.evidence_note}</p>}
          {task.waived_reason && <p className="mt-1 text-sm text-slate-700"><span className="font-semibold">Waived:</span> {task.waived_reason}</p>}
          {task.task_kind === "acknowledgement" && !task.acknowledged_at && !closed && <p className="mt-1 text-xs text-violet-700">Waiting for the employee to acknowledge in the Employee Portal.</p>}
          {task.acknowledged_at && <p className="mt-1 text-xs text-emerald-700">Acknowledged by the employee {formatDateTime(task.acknowledged_at)}.</p>}
          {(task.asset_assignment_id || task.training_assignment_id) && <p className="mt-1 text-xs text-slate-500">{task.asset_assignment_id ? "Equipment linked from Assets. Can be completed once the joiner acknowledges the handover in My Assets." : "Training linked; completes with the training."}</p>}
        </div>
        {open && (
          <span className="flex flex-wrap gap-1">
            {!closed && canComplete && task.task_kind !== "acknowledgement" && <Button size="sm" variant="success" onClick={() => onAction("complete_task", task)}>Complete</Button>}
            {!closed && canManage && ["asset", "training"].includes(task.task_kind) && <Button size="sm" variant="secondary" onClick={() => onAction("link", task)}><Link2 className="h-4 w-4" aria-hidden="true" />Link</Button>}
            {!closed && canManage && <Button size="sm" variant="ghost" onClick={() => onAction("assign", task)} aria-label={`Change owner of ${task.title}`}><UserCog className="h-4 w-4" aria-hidden="true" /></Button>}
            {!closed && canManage && <Button size="sm" variant="ghost" onClick={() => onAction("waive", task)}>Waive</Button>}
            {closed && canManage && <Button size="sm" variant="ghost" onClick={() => onAction("reopen", task)}><RotateCcw className="h-4 w-4" aria-hidden="true" />Reopen</Button>}
          </span>
        )}
      </div>
    </li>
  );
}

function DocumentsPanel({ employeeId }) {
  const q = useHrQuery(() => documentChecklist(employeeId), [employeeId]);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data?.length) return <p className="text-sm text-slate-600">No required documents for this employment type.</p>;
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {q.data.map((d) => (
        <li key={d.category_code} className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">{d.is_complete ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : <Circle className="h-4 w-4 text-amber-500" aria-hidden="true" />}{d.category_name}</span>
          <span className="flex items-center gap-2">{d.expiry_date && <span className="text-xs text-slate-500">expires {formatDate(d.expiry_date)}</span>}<StatusBadge status={d.verification_status ?? "missing"} /></span>
        </li>
      ))}
    </ul>
  );
}

function CaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission, hr } = useAuth();
  const { notify } = useToast();
  const kase = useHrQuery(() => getOnboardingCase(id), [id]);
  const tasks = useHrQuery(() => getOnboardingTasks(id), [id]);
  const events = useHrQuery(() => getOnboardingEvents(id), [id]);
  const employees = useEmployeeOptions();
  const [dialog, setDialog] = useState(null);
  const [task, setTask] = useState(null);
  const [catFilter, setCatFilter] = useState("");
  const refresh = () => { kase.reload(); tasks.reload(); events.reload(); };

  if (kase.loading && !kase.data) return <Loading />;
  if (kase.error) return <ErrorState message={kase.error} onRetry={kase.reload} />;
  if (!kase.data) return <EmptyState title="Onboarding case not found" description="It does not exist or you are not allowed to view it." action={<Button variant="secondary" onClick={() => navigate(BASE)}>Back to list</Button>} />;

  const c = kase.data;
  const me = hr?.employee?.id;
  const own = c.employee_id === me;
  const canManage = hasPermission("onboarding.manage") && !own;
  const isLineManager = hasPermission("onboarding.view_team") && c.reporting_manager_id === me;
  const canCompleteTask = (t) => !own && (canManage || t.assignee_employee_id === me || (t.owner_role === "manager" && isLineManager));
  const all = tasks.data ?? [];
  const shown = catFilter ? all.filter((t) => t.category === catFilter) : all;
  const done = all.filter((t) => ["completed", "waived"].includes(t.status)).length;
  const pendingMandatory = all.filter((t) => t.mandatory && ["pending", "in_progress"].includes(t.status));
  const act = (kind, t) => { setTask(t); setDialog(kind); };
  const closeDialog = () => { setDialog(null); setTask(null); };
  const afterDialog = () => { closeDialog(); refresh(); };
  const empOptions = employees.data ?? [];

  return (
    <>
      <button type="button" onClick={() => navigate(BASE)} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All onboarding cases
      </button>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-extrabold text-[#101a3a]">{fullName(c.employee)}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm"><span className="font-mono font-bold text-[#1f4693]">{c.employee?.employee_code}</span><StatusBadge status={c.status} /><Badge tone={c.joining_status === "joined" ? "green" : "blue"}>{joinLabel(c.joining_status)}</Badge>{c.offer_id && <Badge tone="violet">From accepted offer</Badge>}</p>
        </div>
        {canManage && c.status === "open" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDialog("joining")}>Joining status</Button>
            <Button variant="secondary" onClick={() => setDialog("edit")}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>
            <Button variant="secondary" onClick={() => setDialog("cancel")}>Cancel case</Button>
            <Button onClick={() => setDialog("complete")} disabled={c.joining_status !== "joined" || pendingMandatory.length > 0}
              title={c.joining_status !== "joined" ? "Record the joining first" : pendingMandatory.length ? "Mandatory tasks are pending" : undefined}>Complete onboarding</Button>
          </div>
        )}
      </div>
      {own && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This is your own onboarding; another HR user must manage it.</p>}

      <Card className="mb-4"><LifecycleTimeline steps={lifecycleSteps({ employee: c.employee, onboarding: c })} /></Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          <Card title="Joining details">
            <DescriptionList items={[
              { label: "Joining date", value: formatDate(c.joining_date) },
              { label: "Actual joining date", value: formatDate(c.actual_joining_date) },
              { label: "Department", value: c.department?.name },
              { label: "Designation", value: c.designation?.name },
              { label: "Reporting manager", value: c.manager ? empText(c.manager) : null },
              { label: "HR coordinator", value: c.coordinator ? empText(c.coordinator) : null },
              { label: "Employee record", value: <Link className="font-semibold text-[#1f4693] hover:underline" to={`/hr/employees/${c.employee_id}`}>Open in Employee Master</Link> },
              c.completed_at && { label: "Completed", value: formatDateTime(c.completed_at) },
              c.cancel_reason && { label: "Cancelled", value: c.cancel_reason },
              c.notes && { label: "Notes (internal)", value: <span className="whitespace-pre-line">{c.notes}</span> },
            ]} />
          </Card>
          <Card title={<span className="flex items-center gap-3">Joining checklist <Progress done={done} total={all.length} tone={done === all.length && all.length ? "green" : "orange"} /></span>}
            actions={<div className="flex gap-2">
              <Select aria-label="Filter by category" className="h-8 text-xs sm:w-44" placeholder="All categories" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} options={TASK_CATEGORIES} />
              {canManage && c.status === "open" && <Button size="sm" onClick={() => setDialog("add")}><Plus className="h-4 w-4" aria-hidden="true" />Task</Button>}
            </div>}>
            {tasks.loading && !tasks.data ? <Loading /> : tasks.error ? <ErrorState message={tasks.error} onRetry={tasks.reload} /> : !shown.length ? (
              <EmptyState title="No tasks" description={catFilter ? "No tasks in this category." : "This case has no checklist tasks yet."} />
            ) : (
              <ul className="flex flex-col gap-2">
                {shown.map((t) => <TaskRow key={t.id} task={t} c={c} canManage={canManage} canComplete={canCompleteTask(t)} onAction={act} />)}
              </ul>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Required documents" actions={<Link to="/hr/onboarding-exit/documents" className="text-xs font-semibold text-[#1f4693] hover:underline">Verify</Link>}>
            <DocumentsPanel employeeId={c.employee_id} />
          </Card>
          <Card title="History">
            {events.loading && !events.data ? <Loading /> : events.error ? <ErrorState message={events.error} onRetry={events.reload} /> : <EventList events={events.data} />}
          </Card>
        </div>
      </div>

      {dialog === "edit" && <EditCaseModal c={c} onClose={closeDialog} onDone={afterDialog} />}
      {dialog === "joining" && <JoiningModal c={c} onClose={closeDialog} onDone={afterDialog} />}
      {dialog === "add" && <AddTaskModal caseId={c.id} employees={empOptions} onClose={closeDialog} onDone={afterDialog} />}
      {dialog === "complete_task" && task && <CompleteTaskModal task={task} employeeId={c.employee_id} onClose={closeDialog} onDone={afterDialog} />}
      {dialog === "assign" && task && <AssignTaskModal task={task} employees={empOptions} onClose={closeDialog} onDone={afterDialog} />}
      {dialog === "link" && task && <LinkTaskModal task={task} employeeId={c.employee_id} onClose={closeDialog} onDone={afterDialog} />}
      <ConfirmDialog open={dialog === "waive"} onClose={closeDialog} title={`Waive: ${task?.title ?? ""}`}
        message={task?.mandatory ? "This is a mandatory task. Waiving it is recorded in the audit log." : "Record why this task does not apply."}
        confirmLabel="Waive task" requireReason reasonLabel="Reason"
        onConfirm={async (reason) => { const res = await waiveOnboardingTask(task.id, reason); if (!res.error) { notify("Task waived."); refresh(); } return res; }} />
      <ConfirmDialog open={dialog === "reopen"} onClose={closeDialog} title={`Reopen: ${task?.title ?? ""}`} message="Set this task back to pending?" confirmLabel="Reopen" requireReason={false} reasonLabel="Note (optional)"
        onConfirm={async (note) => { const res = await reopenOnboardingTask(task.id, note); if (!res.error) { notify("Task reopened."); refresh(); } return res; }} />
      <ConfirmDialog open={dialog === "complete"} onClose={closeDialog} tone="success" title="Complete onboarding"
        message={`The case is closed and ${fullName(c.employee)} moves from onboarding to ${c.employee?.probation_end_date && c.employee.probation_end_date >= today() ? "probation" : "active"} in Employee Management.`}
        confirmLabel="Complete onboarding" requireReason={false} reasonLabel="Note (optional)"
        onConfirm={async (note) => { const res = await completeOnboarding(c.id, note); if (!res.error) { notify("Onboarding completed."); refresh(); } return res; }} />
      <ConfirmDialog open={dialog === "cancel"} onClose={closeDialog} tone="danger" title="Cancel onboarding case" message="The case is kept as history. A new case can be opened later."
        confirmLabel="Cancel case" requireReason reasonLabel="Reason"
        onConfirm={async (reason) => { const res = await cancelOnboarding(c.id, reason); if (!res.error) { notify("Onboarding case cancelled."); refresh(); } return res; }} />
    </>
  );
}

export default function OnboardingPages() {
  return (
    <Routes>
      <Route index element={<CaseList />} />
      <Route path=":id" element={<CaseDetail />} />
    </Routes>
  );
}
