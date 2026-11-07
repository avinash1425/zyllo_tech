// Training catalogue: courses, categories, programs (groups of courses) and
// trainers (internal employee or external name). Direct table writes that
// RLS allows only with training.manage; deactivate instead of delete.
import { useMemo, useState } from "react";
import { ExternalLink, Pencil, Plus, Send } from "lucide-react";
import { DELIVERY_MODES, saveCategory, saveCourse, saveProgram, saveTrainer, trainerName } from "@/lib/hr/training";
import { Badge, Button, Checkbox, DataTable, Field, Input, SearchInput, Select, Textarea, Toolbar, useToast } from "@/hr/ui";
import { ActionModal, courseText, label, opts } from "./shared";

const dup = (res, what) => (/duplicate|unique/i.test(res.error ?? "") ? { error: `Another ${what} already uses this code or name.` } : res);
const ActiveBadge = ({ active }) => <Badge tone={active ? "green" : "slate"}>{active ? "active" : "inactive"}</Badge>;

// ------------------------------------------------------------------ courses
function CourseModal({ course, categories, trainers, onClose, onDone }) {
  const { notify } = useToast();
  const isNew = !course?.id;
  const [v, setV] = useState({
    code: "", title: "", category_id: "", description: "", provider: "", delivery_mode: "online", duration_hours: "", is_mandatory: false,
    certificate_required: false, validity_months: "", pass_score: "", trainer_id: "", content_url: "", active: true, ...(course ?? {}),
  });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  return (
    <ActionModal title={isNew ? "Add course" : `Edit ${course.code}`} submitLabel={isNew ? "Add course" : "Save"} size="lg" onClose={onClose}
      onSubmit={async () => {
        if (isNew && !/^[A-Z0-9_-]{2,20}$/.test((v.code ?? "").trim().toUpperCase())) return { error: "Code: 2–20 characters, letters, digits, _ or -." };
        if ((v.title ?? "").trim().length < 3) return { error: "Title is required (3–200 characters)." };
        if (v.duration_hours !== "" && v.duration_hours != null && !(Number(v.duration_hours) > 0 && Number(v.duration_hours) <= 1000)) return { error: "Duration must be between 0 and 1000 hours." };
        if (v.validity_months !== "" && v.validity_months != null && !(Number(v.validity_months) >= 1 && Number(v.validity_months) <= 120)) return { error: "Validity must be 1–120 months (empty = no expiry)." };
        if (v.pass_score !== "" && v.pass_score != null && !(Number(v.pass_score) >= 0 && Number(v.pass_score) <= 100)) return { error: "Pass mark must be 0–100." };
        if (v.content_url && !/^https?:\/\//i.test(v.content_url.trim())) return { error: "The content link must start with http:// or https://." };
        const res = await saveCourse(v, course?.id);
        if (res.error) return dup(res, "course");
        notify(isNew ? "Course added." : "Course saved."); onDone(); return {};
      }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Code" required hint="e.g. SEC-101"><Input value={v.code} disabled={!isNew} maxLength={20} onChange={set("code")} /></Field>
        <Field label="Title" required><Input value={v.title} maxLength={200} onChange={set("title")} /></Field>
        <Field label="Category"><Select placeholder="— None —" value={v.category_id ?? ""} onChange={set("category_id")} options={(categories ?? []).filter((c) => c.active || c.id === v.category_id).map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Mode"><Select value={v.delivery_mode} onChange={set("delivery_mode")} options={opts(DELIVERY_MODES)} /></Field>
        <Field label="Duration (hours)"><Input type="number" min={0.25} step="0.25" value={v.duration_hours ?? ""} onChange={set("duration_hours")} /></Field>
        <Field label="Provider" hint="Internal team or external institute"><Input value={v.provider ?? ""} maxLength={120} onChange={set("provider")} /></Field>
        <Field label="Default trainer"><Select placeholder="— None —" value={v.trainer_id ?? ""} onChange={set("trainer_id")} options={(trainers ?? []).filter((t) => t.active || t.id === v.trainer_id).map((t) => ({ value: t.id, label: trainerName(t) }))} /></Field>
        <Field label="Validity (months)" hint="For recertification; empty = never expires"><Input type="number" min={1} max={120} value={v.validity_months ?? ""} onChange={set("validity_months")} /></Field>
        <Field label="Pass mark (%)" hint="Assessment courses only"><Input type="number" min={0} max={100} step="0.01" value={v.pass_score ?? ""} onChange={set("pass_score")} /></Field>
        <Field label="Content link" hint="LMS / video / slides (optional)"><Input value={v.content_url ?? ""} maxLength={500} onChange={set("content_url")} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea value={v.description ?? ""} maxLength={4000} onChange={set("description")} /></Field>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Checkbox label="Mandatory course" checked={Boolean(v.is_mandatory)} onChange={set("is_mandatory")} />
          <Checkbox label="Certificate required to pass" checked={Boolean(v.certificate_required)} onChange={set("certificate_required")} />
          <Checkbox label="Active (can be assigned)" checked={v.active !== false} onChange={set("active")} />
        </div>
      </div>
    </ActionModal>
  );
}

export function CoursesTab({ courses, categories, trainers, canManage, canAssign, onAssign, reload }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [modal, setModal] = useState(null);
  const rows = useMemo(() => (courses.data ?? []).filter((c) => (!cat || c.category_id === cat) && (!q.trim() || courseText(c).toLowerCase().includes(q.trim().toLowerCase()))), [courses.data, q, cat]);
  return (
    <>
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search courses…" />
        <Select aria-label="Category" className="sm:w-56" placeholder="All categories" value={cat} onChange={(e) => setCat(e.target.value)} options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        {canManage && <Button onClick={() => setModal({})}><Plus className="h-4 w-4" aria-hidden="true" />Add course</Button>}
      </Toolbar>
      <DataTable caption="Course catalogue" rows={rows} loading={courses.loading} error={courses.error} onRetry={courses.reload}
        emptyTitle="No courses" emptyDescription={canManage ? "Add the first course to the catalogue." : "HR maintains the catalogue."}
        columns={[
          { key: "title", header: "Course", sortable: true, render: (c) => (
            <div className="min-w-[12rem]"><p className="font-medium text-[#101a3a]">{c.title}</p><p className="text-xs text-slate-500">{c.code}{c.provider ? ` · ${c.provider}` : ""}</p>
              {c.content_url && <a href={c.content_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[#1f4693] hover:underline"><ExternalLink className="h-3 w-3" aria-hidden="true" />Content</a>}</div>) },
          { key: "category", header: "Category", render: (c) => c.category?.name ?? "—" },
          { key: "delivery_mode", header: "Mode", render: (c) => label(c.delivery_mode) },
          { key: "duration_hours", header: "Hours", sortable: true, render: (c) => c.duration_hours ?? "—" },
          { key: "trainer", header: "Trainer", render: (c) => trainerName(c.trainer) || "—" },
          { key: "validity_months", header: "Validity", render: (c) => (c.validity_months ? `${c.validity_months} mo` : "No expiry") },
          { key: "flags", header: "Rules", render: (c) => <span className="flex flex-wrap gap-1">{c.is_mandatory && <Badge tone="orange">mandatory</Badge>}{c.certificate_required && <Badge tone="blue">certificate</Badge>}{c.pass_score != null && <Badge tone="violet">pass {c.pass_score}%</Badge>}</span> },
          { key: "active", header: "Status", render: (c) => <ActiveBadge active={c.active} /> },
          ...((canManage || canAssign) ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (c) => (
            <span className="flex gap-1">
              {canAssign && c.active && <Button size="sm" variant="secondary" onClick={() => onAssign({ course: c.id })}><Send className="h-4 w-4" aria-hidden="true" />Assign</Button>}
              {canManage && <Button size="sm" variant="ghost" onClick={() => setModal(c)}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>}
            </span>) }] : []),
        ]} />
      {modal && <CourseModal course={modal.id ? modal : null} categories={categories} trainers={trainers} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
    </>
  );
}

// ------------------------------------------------------------------ categories
function CategoryModal({ category, onClose, onDone }) {
  const { notify } = useToast();
  const isNew = !category?.id;
  const [v, setV] = useState({ code: "", name: "", description: "", sort_order: 0, active: true, ...(category ?? {}) });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  return (
    <ActionModal title={isNew ? "Add category" : `Edit ${category.name}`} onClose={onClose} submitLabel={isNew ? "Add" : "Save"}
      onSubmit={async () => {
        if (isNew && !/^[a-z][a-z0-9_]{1,40}$/.test(v.code ?? "")) return { error: "Code: lowercase letters, digits and _, starting with a letter." };
        if ((v.name ?? "").trim().length < 2) return { error: "Name is required." };
        const res = await saveCategory(v, category?.id);
        if (res.error) return dup(res, "category");
        notify("Category saved."); onDone(); return {};
      }}>
      <Field label="Code" required hint="e.g. leadership"><Input value={v.code} disabled={!isNew} maxLength={41} onChange={set("code")} /></Field>
      <Field label="Name" required><Input value={v.name} maxLength={120} onChange={set("name")} /></Field>
      <Field label="Description"><Textarea value={v.description ?? ""} maxLength={1000} onChange={set("description")} /></Field>
      <Field label="Sort order"><Input type="number" value={v.sort_order} onChange={set("sort_order")} /></Field>
      <Checkbox label="Active" checked={v.active !== false} onChange={set("active")} />
    </ActionModal>
  );
}

export function CategoriesTab({ categories, courses, canManage, reload }) {
  const [modal, setModal] = useState(null);
  const counts = useMemo(() => (courses.data ?? []).reduce((m, c) => m.set(c.category_id, (m.get(c.category_id) ?? 0) + 1), new Map()), [courses.data]);
  return (
    <>
      {canManage && <Toolbar><Button onClick={() => setModal({})}><Plus className="h-4 w-4" aria-hidden="true" />Add category</Button></Toolbar>}
      <DataTable caption="Training categories" rows={categories.data} loading={categories.loading} error={categories.error} onRetry={categories.reload} emptyTitle="No categories"
        columns={[
          { key: "name", header: "Category", render: (c) => <div><p className="font-medium text-[#101a3a]">{c.name}</p><p className="text-xs text-slate-500">{c.code}</p></div> },
          { key: "description", header: "Description", render: (c) => <p className="max-w-md text-sm">{c.description ?? "—"}</p> },
          { key: "courses", header: "Courses", render: (c) => counts.get(c.id) ?? 0 },
          { key: "active", header: "Status", render: (c) => <ActiveBadge active={c.active} /> },
          ...(canManage ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (c) => <Button size="sm" variant="ghost" onClick={() => setModal(c)}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button> }] : []),
        ]} />
      {modal && <CategoryModal category={modal.id ? modal : null} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
    </>
  );
}

// ------------------------------------------------------------------ programs
function ProgramModal({ program, categories, courses, onClose, onDone }) {
  const { notify } = useToast();
  const isNew = !program?.id;
  const [v, setV] = useState({ code: "", title: "", description: "", category_id: "", active: true, ...(program ?? {}) });
  const [picked, setPicked] = useState(() => [...(program?.courses ?? [])].sort((a, b) => a.sort_order - b.sort_order).map((x) => x.course_id));
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const byId = new Map((courses ?? []).map((c) => [c.id, c]));
  const move = (i, d) => setPicked((p) => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n; });
  return (
    <ActionModal title={isNew ? "Add program" : `Edit ${program.code}`} submitLabel={isNew ? "Add program" : "Save"} size="lg" onClose={onClose}
      onSubmit={async () => {
        if (isNew && !/^[A-Z0-9_-]{2,20}$/.test((v.code ?? "").trim().toUpperCase())) return { error: "Code: 2–20 characters, letters, digits, _ or -." };
        if ((v.title ?? "").trim().length < 3) return { error: "Title is required (3–200 characters)." };
        if (!picked.length) return { error: "Add at least one course." };
        const res = await saveProgram(v, program?.id, picked);
        if (res.error) return dup(res, "program");
        notify("Program saved."); onDone(); return {};
      }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Code" required><Input value={v.code} disabled={!isNew} maxLength={20} onChange={set("code")} /></Field>
        <Field label="Title" required><Input value={v.title} maxLength={200} onChange={set("title")} /></Field>
        <Field label="Category"><Select placeholder="— None —" value={v.category_id ?? ""} onChange={set("category_id")} options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <div className="flex items-end"><Checkbox label="Active" checked={v.active !== false} onChange={set("active")} /></div>
        <Field label="Description" className="sm:col-span-2"><Textarea value={v.description ?? ""} maxLength={4000} onChange={set("description")} /></Field>
      </div>
      <Field label="Add a course">
        <Select placeholder="Choose a course to add" value="" onChange={(e) => e.target.value && setPicked((p) => (p.includes(e.target.value) ? p : [...p, e.target.value]))}
          options={(courses ?? []).filter((c) => c.active && !picked.includes(c.id)).map((c) => ({ value: c.id, label: courseText(c) }))} />
      </Field>
      <ol className="flex flex-col gap-1">
        {picked.map((id, i) => (
          <li key={id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-2 py-1.5 text-sm">
            <span>{i + 1}. {courseText(byId.get(id))}</span>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</Button>
              <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === picked.length - 1} aria-label="Move down">↓</Button>
              <Button size="sm" variant="ghost" onClick={() => setPicked((p) => p.filter((x) => x !== id))}>Remove</Button>
            </span>
          </li>
        ))}
        {!picked.length && <li className="text-sm text-slate-500">No courses yet.</li>}
      </ol>
    </ActionModal>
  );
}

export function ProgramsTab({ programs, categories, courses, canManage, canAssign, onAssign, reload }) {
  const [modal, setModal] = useState(null);
  const byId = useMemo(() => new Map((courses.data ?? []).map((c) => [c.id, c])), [courses.data]);
  return (
    <>
      {canManage && <Toolbar><Button onClick={() => setModal({})}><Plus className="h-4 w-4" aria-hidden="true" />Add program</Button></Toolbar>}
      <DataTable caption="Training programs" rows={programs.data} loading={programs.loading} error={programs.error} onRetry={programs.reload}
        emptyTitle="No programs" emptyDescription="A program groups courses (e.g. a new-joiner track) so they can be assigned together."
        columns={[
          { key: "title", header: "Program", render: (p) => <div><p className="font-medium text-[#101a3a]">{p.title}</p><p className="text-xs text-slate-500">{p.code}{p.category ? ` · ${p.category.name}` : ""}</p></div> },
          { key: "courses", header: "Courses", render: (p) => (
            <ol className="list-decimal pl-4 text-sm">{[...(p.courses ?? [])].sort((a, b) => a.sort_order - b.sort_order).map((x) => <li key={x.id}>{byId.get(x.course_id)?.title ?? "—"}</li>)}</ol>) },
          { key: "active", header: "Status", render: (p) => <ActiveBadge active={p.active} /> },
          ...((canManage || canAssign) ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (p) => (
            <span className="flex gap-1">
              {canAssign && p.active && <Button size="sm" variant="secondary" onClick={() => onAssign({ program: p.id })}><Send className="h-4 w-4" aria-hidden="true" />Assign</Button>}
              {canManage && <Button size="sm" variant="ghost" onClick={() => setModal(p)}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>}
            </span>) }] : []),
        ]} />
      {modal && <ProgramModal program={modal.id ? modal : null} categories={categories} courses={courses.data} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
    </>
  );
}

// ------------------------------------------------------------------ trainers
function TrainerModal({ trainer, employees, onClose, onDone }) {
  const { notify } = useToast();
  const isNew = !trainer?.id;
  const [v, setV] = useState({ kind: trainer?.employee_id ? "internal" : trainer ? "external" : "internal", employee_id: trainer?.employee_id ?? "", external_name: trainer?.external_name ?? "",
    organisation: trainer?.organisation ?? "", expertise: trainer?.expertise ?? "", active: trainer?.active ?? true });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  return (
    <ActionModal title={isNew ? "Add trainer" : "Edit trainer"} onClose={onClose} submitLabel={isNew ? "Add trainer" : "Save"}
      onSubmit={async () => {
        if (v.kind === "internal" && !v.employee_id) return { error: "Choose the employee." };
        if (v.kind === "external" && v.external_name.trim().length < 2) return { error: "Enter the trainer's name." };
        const res = await saveTrainer(v, trainer?.id);
        if (res.error) return /duplicate|unique/i.test(res.error) ? { error: "This employee is already a trainer." } : res;
        notify("Trainer saved."); onDone(); return {};
      }}>
      <Field label="Trainer type"><Select value={v.kind} onChange={set("kind")} options={[{ value: "internal", label: "Internal (employee)" }, { value: "external", label: "External" }]} /></Field>
      {v.kind === "internal"
        ? <Field label="Employee" required><Select placeholder="Choose an employee" value={v.employee_id} onChange={set("employee_id")} options={employees ?? []} /></Field>
        : <Field label="Name" required><Input value={v.external_name} maxLength={120} onChange={set("external_name")} /></Field>}
      <Field label="Organisation"><Input value={v.organisation} maxLength={120} onChange={set("organisation")} /></Field>
      <Field label="Expertise"><Textarea value={v.expertise} maxLength={500} onChange={set("expertise")} /></Field>
      <Checkbox label="Active" checked={v.active} onChange={set("active")} />
    </ActionModal>
  );
}

export function TrainersTab({ trainers, employees, canManage, reload }) {
  const [modal, setModal] = useState(null);
  return (
    <>
      {canManage && <Toolbar><Button onClick={() => setModal({})}><Plus className="h-4 w-4" aria-hidden="true" />Add trainer</Button></Toolbar>}
      <DataTable caption="Trainers" rows={trainers.data} loading={trainers.loading} error={trainers.error} onRetry={trainers.reload}
        emptyTitle="No trainers" emptyDescription="Add internal employees or external trainers to assign them to courses and sessions."
        columns={[
          { key: "name", header: "Trainer", render: (t) => <div><p className="font-medium text-[#101a3a]">{trainerName(t)}</p><p className="text-xs text-slate-500">{t.employee ? `Internal · ${t.employee.employee_code}` : "External"}</p></div> },
          { key: "organisation", header: "Organisation", render: (t) => t.organisation ?? (t.employee ? "Zyllo Tech" : "—") },
          { key: "expertise", header: "Expertise", render: (t) => <p className="max-w-md text-sm">{t.expertise ?? "—"}</p> },
          { key: "active", header: "Status", render: (t) => <ActiveBadge active={t.active} /> },
          ...(canManage ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (t) => <Button size="sm" variant="ghost" onClick={() => setModal(t)}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button> }] : []),
        ]} />
      {modal && <TrainerModal trainer={modal.id ? modal : null} employees={employees} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
    </>
  );
}
