// Training — course catalogue, assignments, completion tracking, certificates.
// HR (training.manage) works with everyone; managers (training.assign_team)
// with their reporting line. All workflow writes are RPCs.
import { useMemo, useState } from "react";
import { AlarmClock, BadgeCheck, BookOpen, Download, GraduationCap, Plus } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { exportCsv, formatDate, fullName, useHrQuery } from "@/lib/hr/client";
import { toOptions, useEmployeeOptions } from "@/lib/hr/org";
import {
  ASSIGNMENT_STATUSES, DELIVERY_MODES, RESULTS, assignTraining, cancelTraining, completeTraining, isOverdue, listAssignments, listCertificateDocuments,
  listCourses, listTrainingCategories, verifyTraining,
} from "@/lib/hr/training";
import {
  Badge, Button, Card, ConfirmDialog, DataTable, Field, InlineError, Input, KpiCard, Modal, PageHeader, SearchInput, Select, StatusBadge, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";
import MasterDataEditor from "@/hr/components/MasterDataEditor";

const opt = (list) => list.map((v) => ({ value: v, label: v.replace(/_/g, " ") }));
const today = () => new Date().toLocaleDateString("en-CA");

export const trainingCategoryConfig = {
  table: "hr_training_categories", title: "Training categories", singular: "training category", orderBy: "sort_order",
  columns: [{ key: "code", header: "Code" }, { key: "name", header: "Name" }, { key: "description", header: "Description" }],
  fields: [{ key: "code", label: "Code", required: true, createOnly: true, pattern: "^[a-z][a-z0-9_]{1,40}$", patternMessage: "lowercase letters, digits and _ (2–41)." },
    { key: "name", label: "Name", required: true }, { key: "sort_order", label: "Sort order", type: "number", min: 0, max: 100 },
    { key: "description", label: "Description", type: "textarea", wide: true }],
  defaults: { sort_order: 10 },
};

function courseConfig(categories) {
  return {
    table: "hr_training_courses", title: "Courses", singular: "course", orderBy: "title", select: "*",
    columns: [
      { key: "code", header: "Code" }, { key: "title", header: "Course" },
      { key: "category_id", header: "Category", render: (r) => categories.find((c) => c.id === r.category_id)?.name ?? "—" },
      { key: "delivery_mode", header: "Mode", render: (r) => r.delivery_mode.replace(/_/g, " ") },
      { key: "duration_hours", header: "Hours", render: (r) => r.duration_hours ?? "—" },
      { key: "flags", header: "Rules", render: (r) => <span className="flex flex-wrap gap-1">{r.is_mandatory && <Badge tone="red">mandatory</Badge>}{r.certificate_required && <Badge tone="violet">certificate</Badge>}{r.validity_months && <Badge>valid {r.validity_months} mo</Badge>}{r.pass_score != null && <Badge>pass {r.pass_score}</Badge>}</span> },
    ],
    fields: [
      { key: "code", label: "Code", required: true, uppercase: true, createOnly: true, pattern: "^[A-Za-z0-9_-]{2,20}$", patternMessage: "2–20 letters, digits, _ or -." },
      { key: "title", label: "Title", required: true },
      { key: "category_id", label: "Category", type: "select", options: toOptions(categories) },
      { key: "delivery_mode", label: "Delivery mode", type: "select", required: true, placeholder: undefined, options: opt(DELIVERY_MODES) },
      { key: "provider", label: "Provider / trainer" },
      { key: "duration_hours", label: "Duration (hours)", type: "number", min: 0.25, max: 1000, step: "0.25" },
      { key: "pass_score", label: "Pass score (0–100)", type: "number", min: 0, max: 100 },
      { key: "validity_months", label: "Certificate validity (months)", type: "number", min: 1, max: 120, hint: "Blank = does not expire." },
      { key: "is_mandatory", label: "Mandatory", type: "checkbox" },
      { key: "certificate_required", label: "Certificate required to pass", type: "checkbox" },
      { key: "description", label: "Description", type: "textarea", wide: true },
    ],
    defaults: { delivery_mode: "online" },
    validate: (v) => (v.title && String(v.title).trim().length < 3 ? { title: "At least 3 characters." } : {}),
  };
}

export default function TrainingPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("training.manage");
  const canAssign = canManage || hasPermission("training.assign_team");
  const [tab, setTab] = useState("assignments");
  const categories = useHrQuery(listTrainingCategories, []);
  return (
    <>
      <PageHeader title="Training" description={canManage ? "Course catalogue, assignments, completion and certificates." : "Training of your reporting line."} />
      <Tabs value={tab} onChange={setTab} label="Training sections" tabs={[
        { value: "assignments", label: "Assignments" },
        { value: "courses", label: "Courses" },
      ]} />
      {tab === "assignments" && <Assignments canAssign={canAssign} />}
      {tab === "courses" && <Card><MasterDataEditor key={`courses-${categories.data?.length ?? 0}`} config={courseConfig(categories.data ?? [])} canEdit={canManage} /></Card>}
    </>
  );
}

function Assignments({ canAssign }) {
  const { notify } = useToast();
  const [f, setF] = useState({ status: "open", course: "", employee: "", search: "" });
  const courses = useHrQuery(() => listCourses(), []);
  const q = useHrQuery(() => listAssignments(f), [f.status, f.course, f.employee]);
  const employees = useEmployeeOptions();
  const [assigning, setAssigning] = useState(false);
  const [completing, setCompleting] = useState(null);
  const [verifying, setVerifying] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: typeof e === "string" ? e : e.target.value }));
  const rows = useMemo(() => {
    const s = f.search.trim().toLowerCase();
    return (q.data ?? []).filter((r) => !s || fullName(r.employee).toLowerCase().includes(s) || r.course?.title?.toLowerCase().includes(s) || r.employee?.employee_code?.toLowerCase().includes(s));
  }, [q.data, f.search]);
  const k = useMemo(() => ({
    open: rows.filter((r) => ["assigned", "in_progress"].includes(r.status)).length,
    overdue: rows.filter(isOverdue).length,
    completed: rows.filter((r) => r.status === "completed").length,
    unverified: rows.filter((r) => r.status === "completed" && !r.verified_at).length,
  }), [rows]);

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="Open (listed)" value={k.open} icon={BookOpen} tone="navy" loading={q.loading} />
        <KpiCard label="Overdue" value={k.overdue} icon={AlarmClock} tone="red" loading={q.loading} onClick={() => setF((s) => ({ ...s, status: "overdue" }))} />
        <KpiCard label="Completed (listed)" value={k.completed} icon={GraduationCap} tone="green" loading={q.loading} />
        <KpiCard label="Awaiting verification" value={k.unverified} icon={BadgeCheck} tone="orange" loading={q.loading} onClick={() => setF((s) => ({ ...s, status: "unverified" }))} />
      </div>
      <Toolbar>
        <SearchInput value={f.search} onChange={set("search")} placeholder="Search employee or course…" label="Search training" />
        <Select aria-label="Assignment status" className="sm:w-48" value={f.status} onChange={set("status")} options={[
          { value: "open", label: "Open (assigned / in progress)" }, { value: "overdue", label: "Overdue" }, { value: "unverified", label: "Awaiting verification" },
          { value: "", label: "All statuses" }, ...opt(ASSIGNMENT_STATUSES)]} />
        <Select aria-label="Course" className="sm:w-56" placeholder="All courses" value={f.course} onChange={set("course")} options={toOptions(courses.data, "title", "id", { activeOnly: false })} />
        <div className="flex gap-2 sm:ml-auto">
          {rows.length > 0 && <Button variant="secondary" onClick={() => { exportCsv(`training-${today()}`, rows, [
            { label: "Employee ID", value: (r) => r.employee?.employee_code }, { label: "Employee", value: (r) => fullName(r.employee) }, { label: "Course", value: (r) => r.course?.title },
            { label: "Status", key: "status" }, { label: "Due", key: "due_date" }, { label: "Completed", key: "completion_date" }, { label: "Result", key: "result" }, { label: "Score", key: "score" },
            { label: "Verified", value: (r) => (r.verified_at ? "yes" : r.status === "completed" ? "no" : "") }, { label: "Certificate expiry", key: "certificate_expiry" }]); notify(`Exported ${rows.length} assignments.`); }}>
            <Download className="h-4 w-4" aria-hidden="true" />Export CSV</Button>}
          {canAssign && <Button onClick={() => setAssigning(true)}><Plus className="h-4 w-4" aria-hidden="true" />Assign training</Button>}
        </div>
      </Toolbar>
      <DataTable caption="Training assignments" rows={rows} loading={q.loading} error={q.error} onRetry={q.reload} pageSize={25}
        emptyTitle="No training assignments" emptyDescription={canAssign ? "Assign a course to employees to track it here." : undefined}
        columns={[
          { key: "employee", header: "Employee", sortable: true, sortValue: (r) => fullName(r.employee).toLowerCase(), render: (r) => <div><p className="font-semibold text-[#101a3a]">{fullName(r.employee)}</p><p className="font-mono text-xs text-slate-500">{r.employee?.employee_code}</p></div> },
          { key: "course", header: "Course", sortable: true, sortValue: (r) => r.course?.title, render: (r) => <span>{r.course?.title}{r.course?.is_mandatory && <Badge tone="red" className="ml-1">mandatory</Badge>}</span> },
          { key: "due_date", header: "Due", sortable: true, render: (r) => <span className="flex items-center gap-1">{formatDate(r.due_date)}{isOverdue(r) && <Badge tone="red">overdue</Badge>}</span> },
          { key: "status", header: "Status", render: (r) => <span className="flex flex-wrap items-center gap-1"><StatusBadge status={r.status} />{r.status === "completed" && (r.verified_at ? <Badge tone="green">verified</Badge> : <Badge tone="amber">unverified</Badge>)}</span> },
          { key: "result", header: "Result", render: (r) => (r.result ? `${r.result}${r.score != null ? ` · ${r.score}` : ""} · ${formatDate(r.completion_date)}` : "—") },
          { key: "certificate", header: "Certificate", render: (r) => (r.certificate ? <span>{r.certificate.title}{r.certificate_expiry && <span className="block text-xs text-slate-500">valid to {formatDate(r.certificate_expiry)}</span>}</span> : "—") },
          ...(canAssign ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (
            <span className="flex flex-wrap gap-1">
              {["assigned", "in_progress"].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => setCompleting(r)}>Record completion</Button>}
              {["assigned", "in_progress"].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => setCancelling(r)}>Cancel</Button>}
              {r.status === "completed" && !r.verified_at && <Button size="sm" variant="ghost" onClick={() => setVerifying(r)}>Verify</Button>}
            </span>) }] : []),
        ]} />
      {assigning && <AssignModal courses={(courses.data ?? []).filter((c) => c.active)} employees={employees.data ?? []} onClose={() => setAssigning(false)}
        onDone={(n) => { setAssigning(false); q.reload(); notify(n ? `Training assigned to ${n} employee${n === 1 ? "" : "s"}.` : "Everyone selected already has this course open."); }} />}
      {completing && <CompleteModal assignment={completing} onClose={() => setCompleting(null)} onDone={() => { setCompleting(null); q.reload(); notify("Completion recorded."); }} />}
      <ConfirmDialog open={Boolean(verifying)} onClose={() => setVerifying(null)} title="Verify completion" confirmLabel="Verify"
        message={verifying ? `Confirm that ${fullName(verifying.employee)} completed ${verifying.course?.title} (${verifying.result}).` : ""}
        onConfirm={async () => { const r = await verifyTraining(verifying.id); if (!r.error) { notify("Completion verified."); q.reload(); } return r; }} />
      <ConfirmDialog open={Boolean(cancelling)} onClose={() => setCancelling(null)} title="Cancel assignment" tone="danger" confirmLabel="Cancel assignment" requireReason
        message={cancelling ? `${cancelling.course?.title} for ${fullName(cancelling.employee)}` : ""}
        onConfirm={async (reason) => { const r = await cancelTraining(cancelling.id, reason); if (!r.error) { notify("Assignment cancelled."); q.reload(); } return r; }} />
    </>
  );
}

function AssignModal({ courses, employees, onClose, onDone }) {
  const [course, setCourse] = useState("");
  const [picked, setPicked] = useState([]);
  const [filter, setFilter] = useState("");
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const visible = employees.filter((e) => !filter || e.label.toLowerCase().includes(filter.toLowerCase()));
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  async function save() {
    const errs = {};
    if (!course) errs.course = "Choose a course.";
    if (!picked.length) errs.employees = "Choose at least one employee.";
    if (due && due < today()) errs.due = "The due date is in the past.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const r = await assignTraining(course, picked, due, notes);
    setBusy(false);
    if (r.error) setError(r.error); else onDone(r.data);
  }
  return (
    <Modal open onClose={onClose} title="Assign training" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Assign to {picked.length || ""} employee{picked.length === 1 ? "" : "s"}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Course" required error={errors.course}><Select placeholder="Choose a course" value={course} onChange={(e) => setCourse(e.target.value)} options={courses.map((c) => ({ value: c.id, label: `${c.title}${c.is_mandatory ? " (mandatory)" : ""}` }))} /></Field>
        <Field label="Due date" error={errors.due}><Input type="date" min={today()} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-sm font-semibold text-[#173a52]">Employees <span className="text-red-600" aria-hidden="true">*</span> <span className="font-normal text-slate-500">({picked.length} selected)</span></legend>
          <Input placeholder="Filter employees…" aria-label="Filter employees" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-slate-200 p-2">
            {visible.length ? visible.map((e) => (
              <label key={e.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={picked.includes(e.value)} onChange={() => toggle(e.value)} className="h-4 w-4 rounded border-slate-300 text-[#f96706]" />{e.label}
              </label>)) : <p className="px-2 py-1 text-sm text-slate-500">No employees match.</p>}
          </div>
          {errors.employees && <p className="mt-1 text-xs font-medium text-red-600" role="alert">{errors.employees}</p>}
          <p className="mt-1 text-xs text-slate-500">Managers can assign only to their reporting line; nobody can assign to themselves. Existing open assignments are skipped.</p>
        </fieldset>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

export function CompleteModal({ assignment, onClose, onDone, self = false }) {
  const [v, setV] = useState({ completion_date: today(), result: "passed", score: "", certificate_document_id: "", notes: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const certs = useHrQuery(() => listCertificateDocuments(assignment.employee_id), [assignment.employee_id]);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const c = assignment.course ?? {};
  async function save() {
    const errs = {};
    if (!v.completion_date) errs.completion_date = "Enter the completion date.";
    else if (v.completion_date > today()) errs.completion_date = "Cannot be in the future.";
    if (v.score !== "" && (Number(v.score) < 0 || Number(v.score) > 100)) errs.score = "0–100.";
    if (v.result === "passed" && c.pass_score != null && v.score !== "" && Number(v.score) < Number(c.pass_score)) errs.score = `Below the pass mark of ${c.pass_score}.`;
    if (c.certificate_required && v.result === "passed" && !v.certificate_document_id) errs.certificate_document_id = "This course requires a certificate.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const r = await completeTraining(assignment.id, v);
    setBusy(false);
    if (r.error) setError(r.error); else onDone();
  }
  return (
    <Modal open onClose={onClose} title={`${self ? "Mark complete" : "Record completion"}: ${c.title ?? ""}`} size="md" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Completion date" required error={errors.completion_date}><Input type="date" max={today()} value={v.completion_date} onChange={set("completion_date")} /></Field>
        <Field label="Result" required><Select value={v.result} onChange={set("result")} options={opt(RESULTS)} /></Field>
        <Field label="Score (0–100)" error={errors.score} hint={c.pass_score != null ? `Pass mark ${c.pass_score}` : undefined}><Input type="number" min={0} max={100} value={v.score} onChange={set("score")} /></Field>
        <Field label="Certificate" required={c.certificate_required && v.result === "passed"} error={errors.certificate_document_id}
          hint={!certs.data?.length ? "Upload it first in Documents under “Training certificate”." : undefined}>
          <Select placeholder="— None —" value={v.certificate_document_id} onChange={set("certificate_document_id")} options={(certs.data ?? []).map((d) => ({ value: d.id, label: d.title }))} />
        </Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={v.notes} onChange={set("notes")} /></Field>
      </div>
      {self && <p className="mt-2 text-xs text-slate-500">Self-reported completions are marked unverified until HR or your manager verifies them.</p>}
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}
