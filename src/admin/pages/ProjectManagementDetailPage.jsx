import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Clock,
  ExternalLink,
  FileText,
  ListChecks,
  MessageSquareText,
  Pencil,
  Plus,
  Star,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import {
  DONE_STATUSES,
  deleteTask,
  getProject,
  pct,
  removeMember,
  saveMember,
  saveTask,
  setDeadline,
  validateTask,
} from "@/lib/api/admin/projectManagement";
import { listEmployees } from "@/lib/api/admin/employees";
import { PRIORITY, TASK_STATUS } from "@/lib/api/employee/projects";
import { DeadlineText, PriorityChip, StatusChip } from "@/employee/projectsUi";
import { formatDate, formatDateTime } from "@/employee/attendanceFormat";
import { Banner, Field } from "../employees/ui";
import { useAccess } from "@/lib/access";
import { Alert, Avatar, Badge, Chips, Empty, Panel, Progress, SearchBox } from "@/components/portal/PortalUI";
import {
  BTN_DANGER,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD,
  ICON_BTN,
  ICON_BTN_DANGER,
  INPUT,
  INPUT_INLINE,
  LABEL,
} from "@/components/portal/portalStyles";

const TASK_FILTERS = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "done", label: "Done" },
  { key: "all", label: "All" },
];
const PRIORITY_OPTIONS = ["high", "medium", "low"].map((v) => ({ value: v, label: PRIORITY[v].label }));
const TASK_ON = {
  todo: "bg-slate-600 text-white",
  in_progress: "bg-sky-600 text-white",
  done: "bg-emerald-600 text-white",
};
const fmtHours = (h) => `${Number(h || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })} h`;
const SUB_FORM = "rounded-xl border border-[#dce6f7] bg-[#f8faff] p-4";

/** Small button group (project rule: no dropdowns). */
function Choice({ label, options, value, onChange, allowEmpty }) {
  return (
    <div role="radiogroup" aria-label={label}>
      <p className={LABEL}>{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(on && allowEmpty ? "" : o.value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                on
                  ? "border-transparent bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] text-white shadow-sm"
                  : "border-[#e3e9f5] bg-white text-[#4a5068] hover:border-[#1f4693]/30 hover:bg-[#eef2fb] hover:text-[#1f4693]"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Stat tile inside the project header. */
function Stat({ icon: Icon, label, children }) {
  return (
    <div className="min-w-0 rounded-xl bg-[#f8fafd] px-4 py-3 ring-1 ring-inset ring-[#eef1f7]">
      <dt className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-[#9aa0ad]">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
      </dt>
      <dd className="mt-1.5">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- header + deadline
function DeadlineEditor({ project, onSaved }) {
  const { can } = useAccess();
  const canEdit = can("portal.projects.edit");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const done = DONE_STATUSES.includes(project.status);

  async function save(date) {
    setBusy(true);
    setError("");
    const r = await setDeadline(project.id, date);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onSaved(r.project);
    setEditing(false);
  }

  if (editing && canEdit) {
    return (
      <div className="flex flex-col gap-2">
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Project deadline"
          className={`${INPUT_INLINE(!!error)} w-full py-2`}
        />
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={busy} onClick={() => save(value)} className={`${BTN_PRIMARY} px-3 py-1.5 text-xs`}>
            {busy ? "Saving…" : "Save"}
          </button>
          {project.end_date && (
            <button type="button" disabled={busy} onClick={() => save(null)} className={`${BTN_SECONDARY} px-3 py-1.5 text-xs`}>
              Clear
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => setEditing(false)} className={`${BTN_SECONDARY} px-3 py-1.5 text-xs`}>
            Cancel
          </button>
        </div>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-[#101a3a]">{project.end_date ? formatDate(project.end_date) : "Not set"}</span>
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setValue(project.end_date ?? "");
              setError("");
              setEditing(true);
            }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-[#1f4693] transition-colors hover:bg-[#eef2fb]"
          >
            <Pencil size={12} aria-hidden="true" /> {project.end_date ? "Change" : "Set deadline"}
          </button>
        )}
      </div>
      {project.end_date && (
        <span className="text-xs">
          <DeadlineText iso={project.end_date} done={done} />
        </span>
      )}
    </div>
  );
}

function DelayReasons({ project }) {
  if (!(project.overdue || project.completed_late || project.delay_reasons?.length > 0)) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-gradient-to-br from-red-50 to-white p-4">
      <p className="flex items-center gap-2 text-sm font-bold text-red-700">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {project.overdue
          ? `Deadline passed on ${formatDate(project.end_date)}`
          : project.completed_late
            ? `Completed after the deadline (${formatDate(project.end_date)})`
            : "Delay reasons"}
      </p>
      {project.delay_reasons?.length ? (
        <ul className="mt-3 flex flex-col gap-2">
          {project.delay_reasons.map((r) => (
            <li key={r.id} className="rounded-lg border border-red-100 bg-white p-3 text-sm">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-semibold text-[#101a3a]">{r.full_name}</span>
                <span className="text-xs text-[#9aa0ad]">
                  deadline {formatDate(r.deadline)} · {formatDateTime(r.updated_at)}
                </span>
              </p>
              <p className="mt-1 whitespace-pre-line text-[#2b303b]">{r.reason}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-xs text-red-700">
          No reason written yet. The project lead (or the whole team if there is no lead) is reminded every day until someone writes one.
        </p>
      )}
    </div>
  );
}

function ProjectHeader({ project, onSaved }) {
  const total = project.tasks.length;
  const doneCount = project.tasks.filter((t) => t.status === "done").length;
  const overdue = project.tasks.filter((t) => t.overdue).length;
  return (
    <section className={`${CARD} relative overflow-hidden`}>
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#f7941e] via-[#f96706] to-[#1f4693]" />
      <div className="flex flex-col gap-5 p-5 pt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1f4693] to-[#3b6fd1] text-white shadow-[0_6px_14px_-4px_rgba(16,26,58,0.35)] sm:flex">
            <ClipboardList className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-[#101a3a] sm:text-2xl">{project.name}</h1>
              <StatusChip value={project.status} />
              <PriorityChip value={project.priority} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#676b7a]">
              <span className="rounded bg-[#eef2fb] px-1.5 py-0.5 font-mono text-xs font-semibold text-[#1f4693]">{project.project_code}</span>
              {project.client && <span>{project.client}</span>}
              {project.project_type && <span className="text-[#9aa0ad]">· {project.project_type}</span>}
            </p>
            {project.description && <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-[#2b303b]">{project.description}</p>}
          </div>
          <Link href={`/admin/project-tracker/projects/${project.id}`} className={`${BTN_SECONDARY} shrink-0 self-start px-3 py-1.5 text-xs`}>
            Edit in Project Tracker <ExternalLink size={13} aria-hidden="true" />
          </Link>
        </div>

        <DelayReasons project={project} />

        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={CalendarDays} label="Start date">
            <span className="text-sm font-bold text-[#101a3a]">{project.start_date ? formatDate(project.start_date) : "Not set"}</span>
          </Stat>
          <Stat icon={CalendarClock} label="Deadline">
            <DeadlineEditor project={project} onSaved={onSaved} />
          </Stat>
          <Stat icon={ListChecks} label="Task completion">
            <Progress value={pct(doneCount, total)} />
            <span className="mt-1 block text-[11px] text-[#676b7a]">
              {doneCount} of {total} done{overdue > 0 && <span className="font-semibold text-red-600"> · {overdue} overdue</span>}
            </span>
          </Stat>
          <Stat icon={Users} label="Team">
            <span className="text-sm font-bold text-[#101a3a]">
              {project.team.length} {project.team.length === 1 ? "employee" : "employees"}
            </span>
            {project.completed_date && <span className="block text-xs text-[#676b7a]">Completed {formatDate(project.completed_date)}</span>}
          </Stat>
        </dl>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- team + progress
function AddMember({ project, onSaved, onClose }) {
  const [all, setAll] = useState(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null);
  const [role, setRole] = useState("");
  const [lead, setLead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    listEmployees()
      .then((d) => active && setAll(d))
      .catch(() => active && setAll([]));
    return () => {
      active = false;
    };
  }, []);

  const options = useMemo(() => {
    const onTeam = new Set(project.team.map((m) => m.id));
    const q = query.trim().toLowerCase();
    return (all ?? [])
      .filter((e) => e.is_active && !onTeam.has(e.id))
      .filter((e) => !q || [e.full_name, e.employee_code, e.designation, e.department].filter(Boolean).some((s) => s.toLowerCase().includes(q)))
      .slice(0, 10);
  }, [all, query, project.team]);

  async function add() {
    if (!picked) return;
    if (role.trim().length > 60) return setError("Role must be up to 60 characters.");
    setBusy(true);
    setError("");
    const r = await saveMember(project.id, picked.id, role, lead);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onSaved(r.project);
    onClose();
  }

  return (
    <div className={`${SUB_FORM} mb-4`}>
      <p className="mb-3 flex items-center gap-2 text-sm font-bold text-[#101a3a]">
        <UserPlus className="h-4 w-4 text-[#f96706]" aria-hidden="true" /> Assign an employee to this project
      </p>
      {picked ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 rounded-lg bg-white p-2.5 text-sm ring-1 ring-inset ring-[#e3e9f5]">
            <Avatar name={picked.full_name} size="h-8 w-8 text-xs" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-[#101a3a]">{picked.full_name}</p>
              <p className="truncate text-xs text-[#676b7a]">{[picked.designation, picked.employee_code].filter(Boolean).join(" · ")}</p>
            </div>
            <button type="button" onClick={() => setPicked(null)} className="ml-auto shrink-0 text-xs font-semibold text-[#1f4693] hover:underline">
              Change
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pm-role" label="Role on this project (optional)">
              <input id="pm-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Frontend developer" className={INPUT(false)} />
            </Field>
            <Choice
              label="Project lead"
              options={[
                { value: "no", label: "Member" },
                { value: "yes", label: "Lead" },
              ]}
              value={lead ? "yes" : "no"}
              onChange={(v) => setLead(v === "yes")}
            />
          </div>
        </div>
      ) : (
        <>
          <SearchBox value={query} onChange={setQuery} placeholder="Search employees to assign…" className="" />
          {all === null ? (
            <p className="mt-2 text-xs text-[#676b7a]">Loading employees…</p>
          ) : options.length === 0 ? (
            <p className="mt-2 text-xs text-[#676b7a]">Everyone active is already on this project{query ? " or no one matches" : ""}.</p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {options.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(e)}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-[#e3e9f5] bg-white px-3 py-2 text-left text-xs transition-colors hover:border-[#1f4693]/40 hover:bg-[#f0f4ff]"
                  >
                    <Avatar name={e.full_name} size="h-7 w-7 text-[10px]" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-[#101a3a]">{e.full_name}</span>
                      <span className="block truncate text-[#676b7a]">{[e.designation, e.employee_code].filter(Boolean).join(" · ")}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={!picked || busy} onClick={add} className={BTN_PRIMARY}>
          {busy ? "Assigning…" : "Assign to project"}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={BTN_SECONDARY}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function MemberRow({ project, m, onSaved }) {
  const { can } = useAccess();
  const canEdit = can("portal.projects.edit");
  const [mode, setMode] = useState(null); // null | "edit" | "remove"
  const [role, setRole] = useState(m.project_role ?? "");
  const [lead, setLead] = useState(m.is_lead);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = m.tasks_total - m.tasks_done;

  async function run(fn) {
    setBusy(true);
    setError("");
    const r = await fn();
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setMode(null);
    onSaved(r.project);
  }

  return (
    <li className="px-5 py-4 transition-colors hover:bg-[#fafbff]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-5">
        <div className="flex min-w-0 items-center gap-3 lg:w-64">
          <Avatar name={m.full_name} />
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-1.5">
              <Link href={`/admin/employees/${m.id}`} className="truncate text-sm font-semibold text-[#101a3a] hover:text-[#1f4693] hover:underline">
                {m.full_name}
              </Link>
              {m.is_lead && (
                <Badge tone="orange">
                  <Star size={10} aria-hidden="true" /> Lead
                </Badge>
              )}
            </p>
            <p className="truncate text-xs text-[#676b7a]">
              {m.project_role || m.designation || m.employee_code}
              {!m.is_active && <span className="font-semibold text-red-600"> · access off</span>}
            </p>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <Progress value={pct(m.tasks_done, m.tasks_total)} />
          <p className="mt-1 text-[11px] text-[#676b7a]">
            {m.tasks_total === 0 ? (
              "No tasks assigned"
            ) : (
              <>
                {m.tasks_done} of {m.tasks_total} tasks done · {open} open
                {m.tasks_in_progress > 0 && ` (${m.tasks_in_progress} in progress)`}
                {m.tasks_overdue > 0 && <span className="font-semibold text-red-600"> · {m.tasks_overdue} overdue</span>}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-4 lg:w-auto">
          <div className="min-w-0 flex-1 text-xs lg:w-40 lg:flex-none">
            <p className="inline-flex items-center gap-1 font-semibold text-[#101a3a]">
              <Clock size={12} className="text-[#9aa0ad]" aria-hidden="true" /> {fmtHours(m.hours_logged)} logged
            </p>
            <p className="text-[#676b7a]">{m.last_report_date ? `Last report ${formatDate(m.last_report_date)}` : "No reports yet"}</p>
          </div>
          {canEdit && (
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => setMode(mode === "edit" ? null : "edit")}
                className={ICON_BTN}
                aria-label={`Edit ${m.full_name}'s role`}
                aria-expanded={mode === "edit"}
              >
                <Pencil size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setMode(mode === "remove" ? null : "remove")}
                className={ICON_BTN_DANGER}
                aria-label={`Remove ${m.full_name} from the project`}
                aria-expanded={mode === "remove"}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
      {mode === "edit" && canEdit && (
        <div className={`${SUB_FORM} mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end`}>
          <Field id={`role-${m.id}`} label="Role on this project">
            <input id={`role-${m.id}`} value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Backend developer" className={INPUT(false)} />
          </Field>
          <Choice
            label="Project lead"
            options={[
              { value: "no", label: "Member" },
              { value: "yes", label: "Lead" },
            ]}
            value={lead ? "yes" : "no"}
            onChange={(v) => setLead(v === "yes")}
          />
          <button type="button" disabled={busy} onClick={() => run(() => saveMember(project.id, m.id, role, lead))} className={BTN_PRIMARY}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      )}
      {mode === "remove" && canEdit && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">
            Remove {m.full_name} from {project.name}?
          </p>
          <p className="mt-1 text-xs">
            They will no longer see this project in their portal.
            {open > 0 && ` Their ${open} open ${open === 1 ? "task" : "tasks"} will become unassigned.`} Completed tasks and reports are kept.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={busy} onClick={() => run(() => removeMember(project.id, m.id))} className={BTN_DANGER}>
              {busy ? "Removing…" : "Yes, remove"}
            </button>
            <button type="button" disabled={busy} onClick={() => setMode(null)} className={BTN_SECONDARY}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
    </li>
  );
}

function TeamCard({ project, onSaved }) {
  const { can } = useAccess();
  const canEdit = can("portal.projects.edit");
  const [adding, setAdding] = useState(false);
  return (
    <Panel
      icon={Users}
      title={
        <span className="inline-flex items-center gap-2">
          Team & progress <Badge tone="blue">{project.team.length}</Badge>
        </span>
      }
      subtitle="Progress = this employee's tasks done on this project. Hours come from submitted daily work reports."
      action={
        !adding &&
        canEdit && (
          <button type="button" onClick={() => setAdding(true)} className={BTN_SECONDARY}>
            <UserPlus size={14} aria-hidden="true" /> Assign employee
          </button>
        )
      }
      flush
    >
      {adding && canEdit && (
        <div className="px-5 pt-5">
          <AddMember project={project} onSaved={onSaved} onClose={() => setAdding(false)} />
        </div>
      )}
      {project.team.length === 0 ? (
        <Empty icon={Users} title="No employees on this project yet" message={canEdit ? "Click “Assign employee” to add the team." : undefined} />
      ) : (
        <ul className="divide-y divide-[#eef1f7]">
          {project.team.map((m) => (
            <MemberRow key={m.id} project={project} m={m} onSaved={onSaved} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- tasks
const EMPTY_TASK = { title: "", description: "", assignee_id: "", priority: "medium", status: "todo", due_date: "" };

function TaskForm({ project, task, onSaved, onClose }) {
  const [form, setForm] = useState(() =>
    task
      ? {
          title: task.title,
          description: task.description ?? "",
          assignee_id: task.assignee?.id ?? "",
          priority: task.priority,
          status: task.status,
          due_date: task.due_date ?? "",
        }
      : EMPTY_TASK,
  );
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const activeTeam = project.team.filter((m) => m.is_active);
  // A task can stay with its current assignee even if they have left the team.
  const assigneeOptions = [
    ...activeTeam.map((m) => ({ value: m.id, label: m.full_name })),
    ...(task?.assignee && !activeTeam.some((m) => m.id === task.assignee.id)
      ? [{ value: task.assignee.id, label: `${task.assignee.full_name} (not on team)` }]
      : []),
  ];

  async function onSubmit(e) {
    e.preventDefault();
    const errs = validateTask(form);
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setBusy(true);
    setMessage("");
    const r = await saveTask(project.id, task?.id, form);
    setBusy(false);
    if (!r.ok) return setMessage(r.message);
    onSaved(r.project);
    onClose();
  }

  return (
    <form onSubmit={onSubmit} noValidate className={`${SUB_FORM} mb-1`}>
      <p className="mb-3 flex items-center gap-2 text-sm font-bold text-[#101a3a]">
        {task ? <Pencil className="h-4 w-4 text-[#f96706]" aria-hidden="true" /> : <Plus className="h-4 w-4 text-[#f96706]" aria-hidden="true" />}
        {task ? "Edit task" : "New task"}
      </p>
      <Banner kind="err">{message}</Banner>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="tk-title" label="Title" error={errors.title} wide>
          <input id="tk-title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Build the login page" className={INPUT(errors.title)} />
        </Field>
        <Field id="tk-desc" label="Details (optional)" error={errors.description} wide>
          <textarea id="tk-desc" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} className={`${INPUT(errors.description)} resize-y`} />
        </Field>
        <div className="sm:col-span-2">
          {assigneeOptions.length ? (
            <Choice label="Assign to" options={assigneeOptions} value={form.assignee_id} onChange={(v) => set("assignee_id", v)} allowEmpty />
          ) : (
            <p className="text-xs text-[#676b7a]">Assign employees to the project first to give them tasks.</p>
          )}
          {form.assignee_id === "" && assigneeOptions.length > 0 && <p className="mt-1 text-xs text-[#9aa0ad]">Not assigned yet — click a name.</p>}
        </div>
        <Field id="tk-due" label="Deadline">
          <input id="tk-due" type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} className={INPUT(false)} />
        </Field>
        <Choice label="Priority" options={PRIORITY_OPTIONS} value={form.priority} onChange={(v) => set("priority", v)} />
        {task && <Choice label="Status" options={TASK_STATUS} value={form.status} onChange={(v) => set("status", v)} />}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={BTN_PRIMARY}>
          {busy ? "Saving…" : task ? "Save task" : "Add task"}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={BTN_SECONDARY}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function TaskRow({ project, t, onSaved }) {
  const { can } = useAccess();
  const canEdit = can("portal.projects.edit");
  const canDelete = can("portal.projects.delete");
  const [mode, setMode] = useState(null); // null | "edit" | "delete"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn) {
    setBusy(true);
    setError("");
    const r = await fn();
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setMode(null);
    onSaved(r.project);
  }
  const setStatus = (status) =>
    run(() =>
      saveTask(project.id, t.id, {
        title: t.title,
        description: t.description ?? "",
        assignee_id: t.assignee?.id ?? "",
        priority: t.priority,
        status,
        due_date: t.due_date ?? "",
      }),
    );

  if (mode === "edit" && canEdit) {
    return (
      <li className="px-5 py-4">
        <TaskForm project={project} task={t} onSaved={onSaved} onClose={() => setMode(null)} />
      </li>
    );
  }

  const done = t.status === "done";
  return (
    <li className={`relative px-5 py-4 transition-colors hover:bg-[#fafbff] ${t.overdue && !done ? "bg-red-50/30" : ""}`}>
      {t.overdue && !done && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-red-500" />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${done ? "text-[#9aa0ad] line-through" : "text-[#101a3a]"}`}>{t.title}</p>
          {t.description && <p className="mt-0.5 whitespace-pre-line text-xs text-[#676b7a]">{t.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            {t.assignee ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-[#2b303b]">
                <Avatar name={t.assignee.full_name} size="h-5 w-5 text-[9px]" />
                {t.assignee.full_name}
              </span>
            ) : (
              <Badge tone="amber">Unassigned</Badge>
            )}
            <PriorityChip value={t.priority} />
            {t.due_date ? (
              <span className="inline-flex items-center gap-1 text-[#4a5068]">
                <CalendarClock size={12} className="text-[#9aa0ad]" aria-hidden="true" />
                {formatDate(t.due_date)} · <DeadlineText iso={t.due_date} done={done} />
              </span>
            ) : (
              <span className="text-[#9aa0ad]">No deadline</span>
            )}
            {done && t.completed_at && <span className="text-emerald-700">Done {formatDateTime(t.completed_at)}</span>}
            <span className="text-[#9aa0ad]">by {t.created_by}</span>
          </div>
          {t.delay_reason ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span className="font-semibold">Reason for delay:</span> {t.delay_reason}
              {t.delay_reason_by && <span className="text-amber-700"> — {t.delay_reason_by}</span>}
            </p>
          ) : (
            t.overdue && (
              <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                <AlertTriangle size={12} aria-hidden="true" /> Overdue — no reason written yet (the assignee is reminded daily)
              </p>
            )
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {canEdit ? (
            <div className="inline-flex rounded-lg border border-[#e3e9f5] bg-white p-0.5 shadow-sm" role="group" aria-label={`Status of ${t.title}`}>
              {TASK_STATUS.map((o) => {
                const on = t.status === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    disabled={busy}
                    aria-pressed={on}
                    onClick={() => !on && setStatus(o.value)}
                    className={`whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-60 ${
                      on ? TASK_ON[o.value] : "text-[#676b7a] hover:bg-[#f1f4fc] hover:text-[#1f4693]"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <span className={`whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-semibold ${TASK_ON[t.status] ?? ""}`}>
              {TASK_STATUS.find((o) => o.value === t.status)?.label ?? t.status}
            </span>
          )}
          {canEdit && (
            <button type="button" onClick={() => setMode("edit")} className={ICON_BTN} aria-label={`Edit task ${t.title}`}>
              <Pencil size={15} aria-hidden="true" />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => setMode(mode === "delete" ? null : "delete")}
              className={ICON_BTN_DANGER}
              aria-label={`Delete task ${t.title}`}
              aria-expanded={mode === "delete"}
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {mode === "delete" && canDelete && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span className="font-semibold">Delete this task? This cannot be undone.</span>
          <span className="flex-1" />
          <button type="button" disabled={busy} onClick={() => run(() => deleteTask(t.id))} className={BTN_DANGER}>
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button type="button" disabled={busy} onClick={() => setMode(null)} className={BTN_SECONDARY}>
            Cancel
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
    </li>
  );
}

function TasksCard({ project, onSaved }) {
  const { can } = useAccess();
  const canEdit = can("portal.projects.edit");
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("open");
  const counts = {
    open: project.tasks.filter((t) => t.status !== "done").length,
    overdue: project.tasks.filter((t) => t.overdue).length,
    done: project.tasks.filter((t) => t.status === "done").length,
    all: project.tasks.length,
  };
  const shown = project.tasks.filter((t) =>
    filter === "open" ? t.status !== "done" : filter === "overdue" ? t.overdue : filter === "done" ? t.status === "done" : true,
  );

  return (
    <Panel
      icon={ClipboardList}
      title={
        <span className="inline-flex items-center gap-2">
          Tasks <Badge tone="blue">{project.tasks.length}</Badge>
        </span>
      }
      subtitle="Assign work, set deadlines and update status."
      action={
        !adding &&
        canEdit && (
          <button type="button" onClick={() => setAdding(true)} className={BTN_PRIMARY}>
            <Plus size={14} aria-hidden="true" /> New task
          </button>
        )
      }
      flush
    >
      {adding && canEdit && (
        <div className="px-5 pt-5">
          <TaskForm project={project} task={null} onSaved={onSaved} onClose={() => setAdding(false)} />
        </div>
      )}
      <div className="border-b border-[#eef1f7] px-5 py-3">
        <Chips items={TASK_FILTERS.map((f) => ({ ...f, count: counts[f.key] }))} value={filter} onChange={setFilter} label="Filter tasks" />
      </div>
      {shown.length === 0 ? (
        <Empty
          icon={ListChecks}
          title={project.tasks.length ? "No tasks here" : "No tasks yet"}
          message={project.tasks.length ? "Try another filter." : canEdit ? "Click “New task” to add the first one." : undefined}
        />
      ) : (
        <ul className="divide-y divide-[#eef1f7]">
          {shown.map((t) => (
            <TaskRow key={t.id} project={project} t={t} onSaved={onSaved} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function UpdatesCard({ updates }) {
  return (
    <Panel
      icon={MessageSquareText}
      title={
        <span className="inline-flex items-center gap-2">
          Recent updates {updates.length > 0 && <Badge tone="blue">{updates.length}</Badge>}
        </span>
      }
      subtitle="Posted by the team from their portal."
    >
      {updates.length === 0 ? (
        <Empty icon={FileText} title="No updates yet" message="No updates posted by the team yet." className="py-6" />
      ) : (
        <ul className="flex flex-col gap-3">
          {updates.map((u) => (
            <li key={u.id} className="flex gap-3">
              <Avatar name={u.author} size="h-8 w-8 text-xs" />
              <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border border-[#eef1f7] bg-[#f8fafd] px-4 py-3">
                <p className="text-xs text-[#676b7a]">
                  <span className="font-semibold text-[#101a3a]">{u.author}</span> · {formatDateTime(u.created_at)}
                </p>
                <p className="mt-1 whitespace-pre-line break-words text-sm text-[#2b303b]">{u.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Admin: one project — deadline, team with each employee's progress, tasks
 * (assign, deadlines, status) and the team's updates. Migration 241.
 */
export default function ProjectManagementDetailPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getProject(projectId)
      .then((d) => {
        if (!active) return;
        setProject(d);
        setError("");
      })
      .catch((e) => {
        if (!active) return;
        setProject(null);
        setError(/not found|invalid input syntax/i.test(e?.message ?? "") ? "Project not found." : "Could not load this project. Please refresh the page.");
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const back = (
    <Link
      href="/admin/project-management"
      className="inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-[#1f4693] transition-colors hover:bg-[#eef2fb]"
    >
      <ArrowLeft size={16} aria-hidden="true" /> All projects
    </Link>
  );

  if (project === undefined) return <p className="text-sm text-[#676b7a]">Loading…</p>;
  if (!project) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Alert kind="err">{error}</Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {back}
      <ProjectHeader project={project} onSaved={setProject} />
      <TeamCard project={project} onSaved={setProject} />
      <TasksCard project={project} onSaved={setProject} />
      <UpdatesCard updates={project.updates} />
      <p className="flex items-center gap-1.5 text-xs text-[#9aa0ad]">
        <CalendarClock size={13} aria-hidden="true" /> Deadlines and overdue counts use India time.
      </p>
    </div>
  );
}
