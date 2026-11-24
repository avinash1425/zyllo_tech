import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import { Activity, AlertTriangle, ArrowLeft, ExternalLink, Info, ListChecks, Megaphone, Plus, Send, Users } from "lucide-react";
import {
  TASK_STATUS,
  addTask,
  getProjectDetail,
  postUpdate,
  setProjectDelayReason,
  setTaskDelayReason,
  setTaskStatus,
  validateTask,
} from "@/lib/api/employee/projects";
import { Alert, Avatar, Badge, Chips, Detail, Empty, Hero, Panel, Tabs } from "@/components/portal/PortalUI";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL } from "@/components/portal/portalStyles";
import { formatDate } from "../attendanceFormat";
import { DeadlineText, HealthChip, PriorityChip, ProgressBar, StatusChip } from "../projectsUi";

const TABS = [
  { key: "overview", label: "Overview", icon: Info },
  { key: "tasks", label: "Tasks", icon: ListChecks },
  { key: "updates", label: "Updates", icon: Megaphone },
  { key: "team", label: "Team", icon: Users },
];
const PRIORITIES = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
const NONE = "__none"; // chip key for a null value (e.g. "Unassigned")

/** Chip choice (no dropdowns). Values may be null. */
function Pills({ label, options, value, onChange }) {
  return (
    <div>
      <p className={LABEL} aria-hidden="true">
        {label}
      </p>
      <Chips
        label={label}
        size="md"
        value={value ?? NONE}
        onChange={(k) => onChange(k === NONE ? null : k)}
        items={options.map((o) => ({ key: o.value ?? NONE, label: o.label }))}
      />
    </div>
  );
}

/** Missed project deadline: the team writes why (migration 244). */
function ProjectDelay({ data, reload }) {
  const p = data.project;
  const mine = data.delay_reasons.find((r) => r.employee_id === data.me && r.deadline === p.end_date);
  const [text, setText] = useState(mine?.reason ?? "");
  const [editing, setEditing] = useState(!mine);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  if (!p.overdue && !p.completed_late) return null;

  async function save() {
    if (!text.trim()) return setMsg({ kind: "err", text: "Write the reason." });
    setBusy(true);
    const r = await setProjectDelayReason(p.id, text);
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message });
    setMsg({ kind: "ok", text: "Reason saved. The admin can see it." });
    setEditing(false);
    await reload();
  }

  return (
    <section className="relative min-w-0 overflow-hidden rounded-2xl border border-red-200 bg-white p-5 pt-6 shadow-[0_1px_2px_rgba(16,26,58,0.04),0_8px_24px_-12px_rgba(220,38,38,0.18)]">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#f87171] to-[#dc2626]" />
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 ring-1 ring-inset ring-red-600/15">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold text-red-700">
            {p.overdue ? `Deadline passed on ${formatDate(p.end_date)}` : `Completed after the deadline (${formatDate(p.end_date)})`}
          </h2>
          <p className="mt-0.5 text-sm text-[#676b7a]">
            {p.overdue
              ? "Write why the project is delayed. Reminders stop once someone on the team has written a reason."
              : "You can write why it was late."}
          </p>
        </div>
      </div>
      {msg.text && (
        <Alert kind={msg.kind === "ok" ? "ok" : "err"} className="mt-4">
          {msg.text}
        </Alert>
      )}
      {editing ? (
        <div className="mt-4 flex flex-col gap-2">
          <label htmlFor="pd-reason" className={LABEL}>
            Your reason for the delay
          </label>
          <textarea
            id="pd-reason"
            rows={3}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. The client changed the scope twice; waiting for their sign-off on the new design."
            className={`${INPUT(false)} resize-y`}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={save} className={BTN_PRIMARY}>
              {busy ? "Saving…" : "Save reason"}
            </button>
            {mine && (
              <button type="button" disabled={busy} onClick={() => setEditing(false)} className={BTN_SECONDARY}>
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className={`${BTN_SECONDARY} mt-4`}>
          Edit my reason
        </button>
      )}
      {data.delay_reasons.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2 border-t border-[#f3f4f8] pt-4">
          {data.delay_reasons.map((r) => (
            <li key={r.id} className="flex gap-3 rounded-xl bg-[#f8fafd] p-3 text-sm ring-1 ring-inset ring-[#eef1f7]">
              <Avatar name={r.full_name} size="h-8 w-8 text-xs" />
              <div className="min-w-0">
                <span className="font-semibold text-[#101a3a]">{r.full_name}</span>
                <span className="text-xs text-[#9aa0ad]"> · deadline {formatDate(r.deadline)}</span>
                <p className="whitespace-pre-line break-words text-[#2b303b]">{r.reason}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Overview({ data, reload }) {
  const p = data.project;
  const closed = ["live", "completed", "cancelled"].includes(p.status);
  const done = data.tasks.filter((t) => t.status === "done").length;
  return (
    <div className="flex flex-col gap-5">
      <ProjectDelay key={`${p.end_date}-${data.delay_reasons.length}`} data={data} reload={reload} />
      <Panel
        icon={Activity}
        title="Status"
        action={
          <>
            <StatusChip value={p.status} />
            {p.health && <HealthChip value={p.health} />}
            <PriorityChip value={p.priority} />
          </>
        }
      >
        <div className="max-w-xl">
          <p className={LABEL}>Overall progress</p>
          <ProgressBar value={p.progress} />
          <p className="mt-2 text-xs text-[#676b7a]">
            Tasks: {done} of {data.tasks.length} done
          </p>
        </div>
        {p.next_action && (
          <Alert kind="info" className="mt-4">
            <span className="font-semibold">Next action: </span>
            {p.next_action}
          </Alert>
        )}
      </Panel>
      <Panel icon={Info} title="Project details">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            <p className={LABEL}>Description</p>
            <p className="whitespace-pre-line break-words text-sm leading-relaxed text-[#2b303b]">{p.description}</p>
          </div>
        )}
      </Panel>
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
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 rounded-2xl border border-[#dce6f7] bg-gradient-to-b from-[#f5f8ff] to-white p-4 sm:p-5">
      <p className="flex items-center gap-2 text-sm font-bold text-[#101a3a]">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#f7941e] to-[#f96706] text-white">
          <Plus className="h-4 w-4" aria-hidden="true" />
        </span>
        New task
      </p>
      <Alert kind="err">{message}</Alert>
      <div>
        <label htmlFor="nt-title" className={LABEL}>
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
        <label htmlFor="nt-desc" className={LABEL}>
          Details (optional)
        </label>
        <textarea id="nt-desc" rows={2} value={t.description} onChange={(e) => set("description", e.target.value)} className={`${INPUT(errors.description)} resize-none`} />
      </div>
      <Pills label="Assign to" options={assignees} value={t.assignee_id} onChange={(v) => set("assignee_id", v)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="nt-due" className={LABEL}>
            Deadline
          </label>
          <input id="nt-due" type="date" value={t.due_date} onChange={(e) => set("due_date", e.target.value)} className={INPUT(errors.due_date)} />
          {errors.due_date && <p className="mt-1 text-xs text-red-600">{errors.due_date}</p>}
        </div>
        <Pills label="Priority" options={PRIORITIES} value={t.priority} onChange={(v) => set("priority", v)} />
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-[#eef0f4] pt-4">
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
  // Reason box for a late task: { id, mode: "done" (mark done + reason) | "reason" (reason only), text }
  const [reasonBox, setReasonBox] = useState(null);
  const tasks = view === "mine" ? data.tasks.filter((t) => t.assignee_id === data.me) : data.tasks;

  async function changeStatus(task, status) {
    if (task.status === status) return;
    if (status === "done" && task.overdue && !task.delay_reason) {
      setReasonBox({ id: task.id, mode: "done", text: "" });
      return;
    }
    setBusyId(task.id);
    setMessage("");
    const r = await setTaskStatus(task.id, status);
    if (!r.ok) {
      if (r.needReason) setReasonBox({ id: task.id, mode: "done", text: "" });
      else setMessage(r.message);
    }
    await reload();
    setBusyId(null);
  }

  async function saveReason() {
    const box = reasonBox;
    if (!box.text.trim()) return setMessage("Write why the task is late.");
    setBusyId(box.id);
    setMessage("");
    const r = box.mode === "done" ? await setTaskStatus(box.id, "done", box.text) : await setTaskDelayReason(box.id, box.text);
    if (!r.ok) setMessage(r.message);
    else setReasonBox(null);
    await reload();
    setBusyId(null);
  }

  return (
    <Panel
      icon={ListChecks}
      title="Tasks & deadlines"
      action={
        <>
          <Chips
            label="Show tasks"
            value={view}
            onChange={setView}
            items={[
              { key: "all", label: "All", count: data.tasks.length },
              { key: "mine", label: "My tasks", count: data.tasks.filter((t) => t.assignee_id === data.me).length },
            ]}
          />
          {!adding && (
            <button type="button" onClick={() => setAdding(true)} className={BTN_PRIMARY}>
              <Plus size={15} aria-hidden="true" /> Add task
            </button>
          )}
        </>
      }
    >
      <Alert kind="err" className="mb-4">
        {message}
      </Alert>
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
        <Empty icon={ListChecks} message="No tasks here yet." className="py-8" />
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((t) => {
            const done = t.status === "done";
            return (
              <li
                key={t.id}
                className={`flex flex-col gap-3 rounded-xl border px-4 py-3 transition-colors lg:flex-row lg:items-center lg:gap-4 ${
                  t.overdue && !done ? "border-red-200 bg-red-50/30" : done ? "border-[#eef1f7] bg-[#fafbfc]" : "border-[#eef1f7] bg-white hover:border-[#dce6f7]"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${done ? "text-[#9aa0ad] line-through" : "text-[#101a3a]"}`}>{t.title}</p>
                  {t.description && <p className="mt-0.5 text-xs text-[#676b7a]">{t.description}</p>}
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1.5 text-[#4a5880]">
                      <Avatar name={t.assignee_id === data.me ? "Me" : t.assignee_name ?? "?"} size="h-5 w-5 text-[9px]" />
                      {t.assignee_id === data.me ? "Me" : t.assignee_name ?? "Unassigned"}
                    </span>
                    <span>
                      {t.due_date ? `${formatDate(t.due_date)} · ` : ""}
                      <DeadlineText iso={t.due_date} done={done} />
                    </span>
                    <PriorityChip value={t.priority} />
                  </p>
                  {t.delay_reason ? (
                    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                      <span className="font-semibold">Reason for delay:</span> {t.delay_reason}
                      {t.delay_reason_by && <span className="text-amber-700"> — {t.delay_reason_by}</span>}
                      {t.overdue && (
                        <button type="button" onClick={() => setReasonBox({ id: t.id, mode: "reason", text: t.delay_reason })} className="ml-2 font-semibold text-[#1f4693] hover:underline">
                          Edit
                        </button>
                      )}
                    </p>
                  ) : (
                    t.overdue && (
                      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs font-semibold text-red-600">
                        <AlertTriangle size={13} aria-hidden="true" /> Past the deadline — the reason is required.
                        <button type="button" onClick={() => setReasonBox({ id: t.id, mode: "reason", text: "" })} className="text-[#1f4693] hover:underline">
                          Write reason
                        </button>
                      </p>
                    )
                  )}
                  {reasonBox?.id === t.id && (
                    <div className="mt-3 flex flex-col gap-2 rounded-xl border border-red-200 bg-white p-3 shadow-[0_6px_16px_-10px_rgba(220,38,38,0.35)]">
                      <label htmlFor={`rs-${t.id}`} className="text-xs font-semibold text-red-800">
                        {reasonBox.mode === "done"
                          ? `This task was due on ${formatDate(t.due_date)}. Why is it late?`
                          : "Why is this task late?"}
                      </label>
                      <textarea
                        id={`rs-${t.id}`}
                        rows={2}
                        maxLength={1000}
                        autoFocus
                        value={reasonBox.text}
                        onChange={(e) => setReasonBox({ ...reasonBox, text: e.target.value })}
                        placeholder="e.g. Waiting for the client's content; got it only yesterday."
                        className={`${INPUT(false)} resize-y`}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={busyId === t.id} onClick={saveReason} className={BTN_PRIMARY}>
                          {busyId === t.id ? "Saving…" : reasonBox.mode === "done" ? "Mark done" : "Save reason"}
                        </button>
                        <button type="button" disabled={busyId === t.id} onClick={() => setReasonBox(null)} className={BTN_SECONDARY}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div
                  className="inline-flex shrink-0 gap-1 self-start rounded-xl border border-[#e3e9f5] bg-[#f8faff] p-1 lg:self-center"
                  role="radiogroup"
                  aria-label={`Status of ${t.title}`}
                >
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
                        className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693] ${
                          on
                            ? s.value === "done"
                              ? "bg-emerald-600 text-white shadow-sm"
                              : s.value === "in_progress"
                                ? "bg-sky-600 text-white shadow-sm"
                                : "bg-slate-500 text-white shadow-sm"
                            : "text-[#4a5880] hover:bg-white hover:text-[#1f4693]"
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
    </Panel>
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
    <Panel icon={Megaphone} title="Project updates" subtitle={`${data.updates.length} update${data.updates.length === 1 ? "" : "s"}`}>
      <form onSubmit={onSubmit} className="mb-6 flex flex-col gap-2 rounded-2xl border border-[#dce6f7] bg-[#f8faff] p-4">
        <label htmlFor="pu-body" className={LABEL}>
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
        <Alert kind="err">{message}</Alert>
        <div className="flex justify-end">
          <button type="submit" disabled={saving || !body.trim()} className={BTN_PRIMARY}>
            <Send size={14} aria-hidden="true" /> {saving ? "Posting…" : "Post update"}
          </button>
        </div>
      </form>
      {data.updates.length === 0 ? (
        <Empty icon={Megaphone} message="No updates yet." className="py-6" />
      ) : (
        <ol className="relative ml-1.5 flex flex-col gap-4 border-l-2 border-[#eef0f5] pl-5">
          {data.updates.map((u) => (
            <li key={u.id} className="relative rounded-xl bg-[#f8fafd] px-4 py-3 ring-1 ring-inset ring-[#eef1f7]">
              <span
                className="absolute -left-[29px] top-4 h-3.5 w-3.5 rounded-full border-2 border-white bg-gradient-to-br from-[#f7941e] to-[#f96706] shadow-[0_0_0_3px_rgba(247,148,30,0.15)]"
                aria-hidden="true"
              />
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
              <p className="mt-1 whitespace-pre-line break-words text-sm text-[#2b303b]">{u.body}</p>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function Team({ data }) {
  return (
    <Panel icon={Users} title={`Project team (${data.team.length})`}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.team.map((m) => {
          const open = data.tasks.filter((t) => t.assignee_id === m.employee_id && t.status !== "done").length;
          return (
            <div
              key={m.employee_id}
              className={`flex min-w-0 items-center gap-3 rounded-xl p-3 ring-1 ring-inset ${
                m.employee_id === data.me ? "bg-[#f5f8ff] ring-[#1f4693]/20" : "bg-[#f8fafd] ring-[#eef1f7]"
              }`}
            >
              <Avatar name={m.full_name} size="h-11 w-11 text-sm" ring />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-[#101a3a]">
                  {m.full_name}
                  {m.employee_id === data.me && <span className="text-xs font-normal text-[#676b7a]">(me)</span>}
                  {m.is_lead && <Badge tone="navy">Lead</Badge>}
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
    </Panel>
  );
}

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  // Notification links can open a tab directly, e.g. ?tab=tasks.
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return TABS.some((x) => x.key === t) ? t : "overview";
  });

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
    <Link href="/employee/projects" className={`${BTN_SECONDARY} self-start`}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All my projects
    </Link>
  );

  if (error) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        {back}
        <Alert kind="err">{error}</Alert>
      </div>
    );
  }
  if (!data) return <p className="py-10 text-center text-sm text-[#676b7a]">Loading project…</p>;

  const p = data.project;
  const counts = { tasks: data.tasks.filter((t) => t.status !== "done").length, updates: data.updates.length, team: data.team.length };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      {back}
      <Hero
        eyebrow={p.project_code}
        title={p.name}
        subtitle={[p.client, p.project_type].filter(Boolean).join(" · ") || undefined}
        stats={[
          { label: "Progress", value: `${Math.max(0, Math.min(100, Math.round(Number(p.progress) || 0)))}%` },
          { label: "Open tasks", value: counts.tasks },
          { label: "Team", value: counts.team },
        ]}
      >
        <span className="rounded-full bg-white p-0.5">
          <StatusChip value={p.status} />
        </span>
      </Hero>
      <Tabs
        label="Project sections"
        value={tab}
        onChange={setTab}
        items={TABS.map((t) => ({ ...t, count: counts[t.key] }))}
      />
      {tab === "overview" && <Overview data={data} reload={reload} />}
      {tab === "tasks" && <Tasks data={data} reload={reload} />}
      {tab === "updates" && <Updates data={data} reload={reload} />}
      {tab === "team" && <Team data={data} />}
    </div>
  );
}
