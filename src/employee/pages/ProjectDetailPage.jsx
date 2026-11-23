import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import { ArrowLeft, ExternalLink, Plus, Send } from "lucide-react";
import { TASK_STATUS, addTask, getProjectDetail, postUpdate, setTaskStatus, validateTask } from "@/lib/api/employee/projects";
import { formatDate } from "../attendanceFormat";
import { CARD, DeadlineText, HealthChip, PriorityChip, ProgressBar, StatusChip } from "../projectsUi";

const BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-60";
const BTN_PRIMARY = `${BTN} bg-gradient-to-r from-[#f7941e] to-[#1f4693] text-white`;
const BTN_SECONDARY = `${BTN} border border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]`;
const INPUT = (err) =>
  `w-full rounded-lg border bg-white px-3 py-2 text-sm text-[#2b303b] outline-none focus:border-[#1f4693] focus:ring-2 focus:ring-[#1f4693]/15 ${
    err ? "border-red-400" : "border-[#dce1ec]"
  }`;
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "tasks", label: "Tasks" },
  { key: "updates", label: "Updates" },
  { key: "team", label: "Team" },
];
const PRIORITIES = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

function Pills({ label, options, value, onChange, id }) {
  return (
    <div role="radiogroup" aria-labelledby={`${id}-l`}>
      <p id={`${id}-l`} className="mb-1 text-xs font-semibold text-[#4a5880]">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value ?? "none"}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                on ? "border-[#1f4693] bg-[#1f4693] text-white" : "border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]"
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

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-[#101a3a]">{children ?? <span className="text-[#b0b8cc]">—</span>}</dd>
    </div>
  );
}

function Overview({ data }) {
  const p = data.project;
  const closed = ["live", "completed", "cancelled"].includes(p.status);
  const done = data.tasks.filter((t) => t.status === "done").length;
  return (
    <div className="flex flex-col gap-5">
      <section className={CARD}>
        <h2 className="mb-3 text-base font-bold text-[#101a3a]">Status</h2>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip value={p.status} />
          {p.health && <HealthChip value={p.health} />}
          <PriorityChip value={p.priority} />
        </div>
        <div className="mt-4 max-w-xl">
          <p className="mb-1 text-xs font-semibold text-[#4a5880]">Overall progress</p>
          <ProgressBar value={p.progress} />
          <p className="mt-2 text-xs text-[#676b7a]">
            Tasks: {done} of {data.tasks.length} done
          </p>
        </div>
        {p.next_action && (
          <p className="mt-4 rounded-lg bg-[#f0f4ff] px-3 py-2 text-sm text-[#1f4693]">
            <span className="font-semibold">Next action: </span>
            {p.next_action}
          </p>
        )}
      </section>
      <section className={CARD}>
        <h2 className="mb-3 text-base font-bold text-[#101a3a]">Project details</h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Project ID">
            <span className="font-mono">{p.project_code}</span>
          </Detail>
          <Detail label="Client">{p.client}</Detail>
          <Detail label="Type">{p.project_type}</Detail>
          <Detail label="Project manager">{p.project_manager}</Detail>
          <Detail label="Start date">{p.start_date && formatDate(p.start_date)}</Detail>
          <Detail label="Deadline (end date)">
            {p.end_date && (
              <>
                {formatDate(p.end_date)}
                <span className="block text-xs">
                  <DeadlineText iso={p.end_date} done={closed} />
                </span>
              </>
            )}
          </Detail>
          {p.completed_date && <Detail label="Completed on">{formatDate(p.completed_date)}</Detail>}
          {p.live_url && (
            <Detail label="Live site">
              <a href={p.live_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#1f4693] hover:underline">
                Open <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </Detail>
          )}
        </dl>
        {p.description && (
          <div className="mt-4 border-t border-[#f3f4f8] pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">Description</p>
            <p className="mt-1 whitespace-pre-line text-sm text-[#2b303b]">{p.description}</p>
          </div>
        )}
      </section>
    </div>
  );
}

function AddTaskForm({ data, onDone, onCancel }) {
  const [t, setT] = useState({ title: "", description: "", assignee_id: data.me, due_date: "", priority: "medium" });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k, v) => {
    setT((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    const errs = validateTask(t);
    if (Object.keys(errs).length) return setErrors(errs);
    setSaving(true);
    const r = await addTask(data.project.id, t);
    setSaving(false);
    if (!r.ok) return setMessage(r.message);
    onDone();
  }

  const assignees = [
    ...data.team.map((m) => ({ value: m.employee_id, label: m.employee_id === data.me ? `${m.full_name} (me)` : m.full_name })),
    { value: null, label: "Unassigned" },
  ];

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 rounded-xl border border-[#dce6f7] bg-[#f8faff] p-4">
      <p className="text-sm font-bold text-[#101a3a]">New task</p>
      {message && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {message}
        </p>
      )}
      <div>
        <label htmlFor="nt-title" className="mb-1 block text-xs font-semibold text-[#4a5880]">
          Task title
        </label>
        <input
          id="nt-title"
          autoFocus
          value={t.title}
          onChange={(e) => set("title", e.target.value)}
          aria-invalid={errors.title ? "true" : undefined}
          aria-describedby={errors.title ? "nt-title-error" : undefined}
          className={INPUT(errors.title)}
        />
        {errors.title && (
          <p id="nt-title-error" className="mt-1 text-xs text-red-600">
            {errors.title}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="nt-desc" className="mb-1 block text-xs font-semibold text-[#4a5880]">
          Details (optional)
        </label>
        <textarea id="nt-desc" rows={2} value={t.description} onChange={(e) => set("description", e.target.value)} className={`${INPUT(errors.description)} resize-none`} />
      </div>
      <Pills id="nt-assignee" label="Assign to" options={assignees} value={t.assignee_id} onChange={(v) => set("assignee_id", v)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="nt-due" className="mb-1 block text-xs font-semibold text-[#4a5880]">
            Deadline
          </label>
          <input id="nt-due" type="date" value={t.due_date} onChange={(e) => set("due_date", e.target.value)} className={INPUT(errors.due_date)} />
          {errors.due_date && <p className="mt-1 text-xs text-red-600">{errors.due_date}</p>}
        </div>
        <Pills id="nt-priority" label="Priority" options={PRIORITIES} value={t.priority} onChange={(v) => set("priority", v)} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className={BTN_SECONDARY}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className={BTN_PRIMARY}>
          {saving ? "Adding…" : "Add task"}
        </button>
      </div>
    </form>
  );
}

function Tasks({ data, reload }) {
  const [view, setView] = useState("all");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState("");
  const tasks = view === "mine" ? data.tasks.filter((t) => t.assignee_id === data.me) : data.tasks;

  async function changeStatus(task, status) {
    if (task.status === status) return;
    setBusyId(task.id);
    setMessage("");
    const r = await setTaskStatus(task.id, status);
    if (!r.ok) setMessage(r.message);
    await reload();
    setBusyId(null);
  }

  return (
    <section className={CARD}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-base font-bold text-[#101a3a]">Tasks &amp; deadlines</h2>
        {[
          { key: "all", label: `All (${data.tasks.length})` },
          { key: "mine", label: `My tasks (${data.tasks.filter((t) => t.assignee_id === data.me).length})` },
        ].map((x) => (
          <button
            key={x.key}
            type="button"
            aria-pressed={view === x.key}
            onClick={() => setView(x.key)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
              view === x.key ? "border-[#1f4693] bg-[#1f4693] text-white" : "border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]"
            }`}
          >
            {x.label}
          </button>
        ))}
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className={BTN_PRIMARY}>
            <Plus size={15} aria-hidden="true" /> Add task
          </button>
        )}
      </div>
      {message && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {message}
        </p>
      )}
      {adding && (
        <div className="mb-4">
          <AddTaskForm
            data={data}
            onCancel={() => setAdding(false)}
            onDone={async () => {
              await reload();
              setAdding(false);
            }}
          />
        </div>
      )}
      {tasks.length === 0 ? (
        <p className="py-6 text-center text-sm text-[#676b7a]">No tasks here yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[#f3f4f8]">
          {tasks.map((t) => {
            const done = t.status === "done";
            return (
              <li key={t.id} className="flex flex-col gap-2 py-3 lg:flex-row lg:items-center lg:gap-4">
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${done ? "text-[#9aa0ad] line-through" : "text-[#101a3a]"}`}>{t.title}</p>
                  {t.description && <p className="mt-0.5 text-xs text-[#676b7a]">{t.description}</p>}
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="text-[#4a5880]">{t.assignee_id === data.me ? "Me" : t.assignee_name ?? "Unassigned"}</span>
                    <span>
                      {t.due_date ? `${formatDate(t.due_date)} · ` : ""}
                      <DeadlineText iso={t.due_date} done={done} />
                    </span>
                    <PriorityChip value={t.priority} />
                  </p>
                </div>
                <div className="flex shrink-0 gap-1" role="radiogroup" aria-label={`Status of ${t.title}`}>
                  {TASK_STATUS.map((s) => {
                    const on = t.status === s.value;
                    return (
                      <button
                        key={s.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={busyId === t.id}
                        onClick={() => changeStatus(t, s.value)}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-60 ${
                          on
                            ? s.value === "done"
                              ? "border-emerald-600 bg-emerald-600 text-white"
                              : s.value === "in_progress"
                                ? "border-sky-600 bg-sky-600 text-white"
                                : "border-slate-500 bg-slate-500 text-white"
                            : "border-[#dce1ec] bg-white text-[#4a5880] hover:bg-[#f6f7fb]"
                        }`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Updates({ data, reload }) {
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    const r = await postUpdate(data.project.id, body);
    if (r.ok) {
      setBody("");
      await reload();
    } else setMessage(r.message);
    setSaving(false);
  }

  return (
    <section className={CARD}>
      <h2 className="mb-3 text-base font-bold text-[#101a3a]">Project updates</h2>
      <form onSubmit={onSubmit} className="mb-5 flex flex-col gap-2">
        <label htmlFor="pu-body" className="text-xs font-semibold text-[#4a5880]">
          Share an update with the team
        </label>
        <textarea
          id="pu-body"
          rows={3}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What was done, what is next, any blockers…"
          className={`${INPUT(false)} resize-none`}
        />
        {message && (
          <p role="alert" className="text-xs text-red-600">
            {message}
          </p>
        )}
        <div className="flex justify-end">
          <button type="submit" disabled={saving || !body.trim()} className={BTN_PRIMARY}>
            <Send size={14} aria-hidden="true" /> {saving ? "Posting…" : "Post update"}
          </button>
        </div>
      </form>
      {data.updates.length === 0 ? (
        <p className="py-4 text-center text-sm text-[#676b7a]">No updates yet.</p>
      ) : (
        <ol className="relative flex flex-col gap-4 border-l-2 border-[#eef0f5] pl-5">
          {data.updates.map((u) => (
            <li key={u.id} className="relative">
              <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-[#f7941e]" aria-hidden="true" />
              <p className="text-xs text-[#676b7a]">
                <span className="font-semibold text-[#101a3a]">{u.author_name ?? "Former member"}</span> ·{" "}
                {new Date(u.created_at).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-[#2b303b]">{u.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Team({ data }) {
  return (
    <section className={CARD}>
      <h2 className="mb-3 text-base font-bold text-[#101a3a]">Project team ({data.team.length})</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.team.map((m) => {
          const open = data.tasks.filter((t) => t.assignee_id === m.employee_id && t.status !== "done").length;
          return (
            <div key={m.employee_id} className="flex items-center gap-3 rounded-xl border border-[#eef0f5] bg-[#fafbfc] p-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e] to-[#1f4693] font-bold text-white">
                {(m.full_name?.[0] ?? "?").toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-[#101a3a]">
                  {m.full_name}
                  {m.employee_id === data.me && <span className="text-xs font-normal text-[#676b7a]">(me)</span>}
                  {m.is_lead && <span className="rounded-full bg-[#1f4693]/10 px-2 py-0.5 text-[10px] font-bold text-[#1f4693]">Lead</span>}
                </p>
                <p className="truncate text-xs text-[#676b7a]">{m.project_role ?? m.designation ?? "Team member"}</p>
                <p className="text-[11px] text-[#9aa0ad]">
                  <span className="font-mono">{m.employee_code}</span> · {open} open task{open === 1 ? "" : "s"}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");

  const reload = useCallback(async () => {
    try {
      setData(await getProjectDetail(projectId));
    } catch (e) {
      setError(/not on this project/i.test(e?.message ?? "") ? "You are not on this project's team." : "Could not load the project. Please refresh the page.");
    }
  }, [projectId]);

  useEffect(() => {
    let active = true;
    getProjectDetail(projectId)
      .then((d) => active && setData(d))
      .catch((e) =>
        active &&
        setError(/not on this project/i.test(e?.message ?? "") ? "You are not on this project's team." : "Could not load the project. Please refresh the page.")
      );
    return () => {
      active = false;
    };
  }, [projectId]);

  const back = (
    <Link href="/employee/projects" className="inline-flex items-center gap-1 text-sm font-semibold text-[#1f4693] hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All my projects
    </Link>
  );

  if (error) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        {back}
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      </div>
    );
  }
  if (!data) return <p className="py-10 text-center text-sm text-[#676b7a]">Loading project…</p>;

  const p = data.project;
  const counts = { tasks: data.tasks.filter((t) => t.status !== "done").length, updates: data.updates.length, team: data.team.length };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      {back}
      <div className={CARD}>
        <p className="font-mono text-xs text-[#9aa0ad]">{p.project_code}</p>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold text-[#101a3a]">{p.name}</h2>
          <StatusChip value={p.status} />
        </div>
        <p className="text-sm text-[#676b7a]">{[p.client, p.project_type].filter(Boolean).join(" · ")}</p>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-[#e7e9ee]" role="tablist" aria-label="Project sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold ${
              tab === t.key ? "border-[#f7941e] text-[#101a3a]" : "border-transparent text-[#676b7a] hover:text-[#101a3a]"
            }`}
          >
            {t.label}
            {counts[t.key] != null && <span className="ml-1.5 rounded-full bg-[#eef0f5] px-1.5 text-[11px] text-[#4a5880]">{counts[t.key]}</span>}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview data={data} />}
      {tab === "tasks" && <Tasks data={data} reload={reload} />}
      {tab === "updates" && <Updates data={data} reload={reload} />}
      {tab === "team" && <Team data={data} />}
    </div>
  );
}
