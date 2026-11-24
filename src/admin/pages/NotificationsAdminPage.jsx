import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlarmClock,
  BellRing,
  CalendarClock,
  CalendarPlus,
  Check,
  History,
  Inbox,
  PenSquare,
  Pencil,
  Plus,
  Repeat,
  Send,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import PageHeader from "../PageHeader";
import { useAccess } from "@/lib/access";
import {
  deleteCustomReminder,
  getCustomReminders,
  getNotificationLog,
  getNotifyOptions,
  getReminderSettings,
  saveCustomReminder,
  saveReminder,
  sendCustomReminderNow,
  sendNotification,
  sendReminderNow,
} from "@/lib/api/admin/reportsNotifications";
import { KINDS, timeAgo } from "@/lib/api/employee/notifications";
import { SentList } from "@/employee/pages/NotificationsPage";
import { formatDate, todayIst } from "@/employee/attendanceFormat";
import { Banner } from "../employees/ui";
import { Alert, Avatar, Badge, Chips, Empty, Panel, SearchBox, TableCard, Tabs } from "@/components/portal/PortalUI";
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, CARD, ICON_BTN, ICON_BTN_DANGER, INPUT, INPUT_INLINE, LABEL, TABLE, TABLE_WRAP, TD, TH, TR } from "@/components/portal/portalStyles";

const TABS = [
  { key: "send", label: "Send notification", icon: PenSquare },
  { key: "sent", label: "Sent", icon: Send },
  { key: "reminders", label: "Scheduled reminders", icon: AlarmClock },
  { key: "automatic", label: "Automatic notifications", icon: Zap },
  { key: "log", label: "Activity log", icon: History },
];
const AUDIENCES = [
  { key: "all", label: "Everyone (company-wide)" },
  { key: "department", label: "Departments" },
  { key: "project", label: "Project team" },
  { key: "people", label: "Chosen employees" },
];
const WEEK = [
  { d: 1, l: "Mon" },
  { d: 2, l: "Tue" },
  { d: 3, l: "Wed" },
  { d: 4, l: "Thu" },
  { d: 5, l: "Fri" },
  { d: 6, l: "Sat" },
  { d: 7, l: "Sun" },
];
const REMINDER_TEXT = {
  punch_in: { title: "Punch-in reminder", short: "To anyone not punched in yet", who: "Employees who have not punched in yet (skips Sundays, holidays and approved leave)." },
  report: { title: "Daily report reminder", short: "To anyone who worked but has not submitted", who: "Employees who worked today on a project but have not submitted their daily work report." },
  punch_out: { title: "Punch-out reminder", short: "To anyone still punched in (auto out 8 PM)", who: "Employees still punched in (they are punched out automatically at 8:00 PM)." },
  deadlines: {
    title: "Deadline reminder",
    short: "Tasks & projects due soon or overdue without a reason",
    who: "Tasks due in 2 days / tomorrow / today (to the assignee) and project deadlines in 3 days / tomorrow / today (to the team). Overdue without a reason: urgent, every day until the reason is written.",
  },
};
const AUTOMATIC = [
  { kind: "leave", rows: ["Leave approved or rejected → the employee (rejections as urgent)", "Leave applied → the reporting manager is informed", "A new holiday cancels a leave request → the employee"] },
  { kind: "project", rows: ["Added to a project → the employee", "New task assigned → the assignee", "Task / project deadline near or passed (scheduled deadline reminder)"] },
  { kind: "report", rows: ["Daily report submitted → the reporting manager", "Report reviewed or sent back → the employee (sent back as urgent)", "Daily report reminder (scheduled)"] },
  { kind: "attendance", rows: ["Attendance correction approved or rejected → the employee", "Punch-in and punch-out reminders (scheduled)"] },
  { kind: "message", rows: ["Welcome message when an employee is added", "Reporting manager changed → the employee and the new manager", "Messages you send from this page"] },
];
const KIND_TONE = { project: "sky", leave: "violet", attendance: "green", report: "amber", message: "blue" };

function KindBadge({ kind }) {
  if (!KINDS[kind]) return null;
  return <Badge tone={KIND_TONE[kind] ?? "slate"}>{KINDS[kind].label}</Badge>;
}

function Toggle({ on, onClick, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693] ${
        on ? "bg-gradient-to-r from-emerald-500 to-emerald-600" : "bg-[#cfd5e2]"
      }`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[1.375rem]" : "left-0.5"}`} />
    </button>
  );
}

// ---------------------------------------------------------------- audience (shared by "Send" and custom reminders)
const EMPTY_AUDIENCE = { audience: "all", departments: [], project: "", people: [] };

/** How many active employees an audience reaches (from the options list). */
function countRecipients(opts, a) {
  if (!opts) return 0;
  if (a.audience === "all") return opts.people.length;
  if (a.audience === "department") return opts.people.filter((p) => a.departments.includes(p.department)).length;
  if (a.audience === "project") return opts.projects.find((p) => p.id === a.project)?.count ?? 0;
  return a.people.length;
}

/** Who gets it: everyone / departments / one project team / chosen people (buttons, no dropdowns). */
function AudienceFields({ opts, value, onChange }) {
  const [query, setQuery] = useState("");
  const set = (patch) => onChange({ ...value, ...patch });
  const toggle = (key, v) => set({ [key]: value[key].includes(v) ? value[key].filter((x) => x !== v) : [...value[key], v] });
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (opts?.people ?? [])
      .filter((p) => !value.people.includes(p.id))
      .filter((p) => !q || [p.full_name, p.employee_code, p.department, p.designation].filter(Boolean).some((s) => s.toLowerCase().includes(q)))
      .slice(0, 12);
  }, [opts, query, value.people]);
  const nameOf = (id) => opts.people.find((p) => p.id === id)?.full_name ?? "";

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className={LABEL}>Send to</p>
        <Chips items={AUDIENCES} value={value.audience} onChange={(k) => set({ audience: k })} label="Audience" size="md" />
      </div>

      {value.audience === "department" &&
        (opts.departments.length ? (
          <div className="rounded-xl border border-[#eef1f7] bg-[#fafbff] p-3">
            <p className={LABEL}>Departments</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Departments">
              {opts.departments.map((d) => {
                const on = value.departments.includes(d.name);
                return (
                  <button
                    key={d.name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle("departments", d.name)}
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      on
                        ? "border-[#1f4693]/40 bg-[#eef2fb] text-[#1f4693] ring-1 ring-inset ring-[#1f4693]/20"
                        : "border-[#e3e9f5] bg-white text-[#4a5068] hover:border-[#1f4693]/30 hover:text-[#1f4693]"
                    }`}
                  >
                    {on && <Check size={12} aria-hidden="true" />} {d.name} <span className="tabular-nums opacity-60">({d.count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <Alert kind="info">No departments set yet. Set them in Employee Management.</Alert>
        ))}

      {value.audience === "project" &&
        (opts.projects.length ? (
          <div className="rounded-xl border border-[#eef1f7] bg-[#fafbff] p-3">
            <p className={LABEL}>Project team</p>
            <Chips
              items={opts.projects.map((p) => ({ key: p.id, label: p.name, count: p.count }))}
              value={value.project}
              onChange={(k) => set({ project: k })}
              label="Project team"
            />
          </div>
        ) : (
          <Alert kind="info">No project has a team yet. Assign people in Project Management.</Alert>
        ))}

      {value.audience === "people" && (
        <div className="rounded-xl border border-[#eef1f7] bg-[#fafbff] p-3">
          <p className={LABEL}>Chosen employees</p>
          {value.people.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {value.people.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggle("people", id)}
                  className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] py-1 pl-3 pr-2 text-xs font-semibold text-white shadow-sm hover:opacity-90"
                  aria-label={`Remove ${nameOf(id)}`}
                >
                  {nameOf(id)} <X size={12} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          <SearchBox value={query} onChange={setQuery} placeholder="Search employees…" className="" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {matches.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle("people", p.id)}
                className="inline-flex items-center gap-2 rounded-lg border border-[#e3e9f5] bg-white px-2.5 py-1.5 text-left text-xs transition-colors hover:border-[#1f4693]/40 hover:bg-[#f0f4ff]"
              >
                <Avatar name={p.full_name} size="h-6 w-6 text-[9px]" />
                <span>
                  <span className="font-semibold text-[#101a3a]">{p.full_name}</span>{" "}
                  <span className="text-[#9aa0ad]">{[p.department, p.employee_code].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function useNotifyOptions() {
  const [opts, setOpts] = useState(null);
  useEffect(() => {
    let active = true;
    getNotifyOptions()
      .then((d) => active && setOpts(d))
      .catch(() => active && setOpts({ people: [], departments: [], projects: [] }));
    return () => {
      active = false;
    };
  }, []);
  return opts;
}

const PRIORITY_CHIPS = [
  { key: "normal", label: "Normal" },
  { key: "urgent", label: "Urgent (red banner until read)" },
];

// ---------------------------------------------------------------- send
function Composer({ onSent }) {
  const opts = useNotifyOptions();
  const [aud, setAud] = useState(EMPTY_AUDIENCE);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("normal");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const recipients = countRecipients(opts, aud);

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) return setMsg({ kind: "err", text: "Write a subject." });
    if (recipients === 0) return setMsg({ kind: "err", text: "Choose who should receive it." });
    setBusy(true);
    setMsg({ kind: "", text: "" });
    const r = await sendNotification({ audience: aud.audience, to: aud.people, departments: aud.departments, project: aud.project, title, body, priority });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message });
    setMsg({ kind: "ok", text: `Sent to ${r.recipients} ${r.recipients === 1 ? "employee" : "employees"}.` });
    setTitle("");
    setBody("");
    setPriority("normal");
    onSent();
  }

  if (!opts) return <p className="text-sm text-[#676b7a]">Loading…</p>;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Banner kind={msg.kind}>{msg.text}</Banner>
      <AudienceFields opts={opts} value={aud} onChange={setAud} />
      <label>
        <span className={LABEL}>Subject</span>
        <input value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Team meeting at 4 PM today" className={INPUT(false)} />
      </label>
      <label>
        <span className={LABEL}>Message (optional)</span>
        <textarea rows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} className={`${INPUT(false)} resize-y`} />
      </label>
      <div>
        <p className={LABEL}>Priority</p>
        <Chips items={PRIORITY_CHIPS} value={priority} onChange={setPriority} label="Priority" />
      </div>
      <div className="flex flex-col gap-3 border-t border-[#eef1f7] pt-4 sm:flex-row sm:items-center">
        <button type="submit" disabled={busy} className={BTN_PRIMARY}>
          <Send size={15} aria-hidden="true" /> {busy ? "Sending…" : "Send"}
        </button>
        <span className="inline-flex items-center gap-1.5 text-xs text-[#676b7a]">
          <Users size={14} className="text-[#9aa0ad]" aria-hidden="true" />
          <span>
            <span className="font-bold tabular-nums text-[#101a3a]">{recipients}</span> {recipients === 1 ? "employee" : "employees"} will get it in their
            Employee Portal notifications.
          </span>
        </span>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- reminders: helpers
/** "Every day" / "Mon–Fri" / "Mon–Sat" / "Mon, Wed, Fri". */
function daysText(days) {
  const d = [...(days ?? [])].sort().join(",");
  if (d === "1,2,3,4,5,6,7") return "Every day";
  if (d === "1,2,3,4,5,6") return "Mon–Sat";
  if (d === "1,2,3,4,5") return "Mon–Fri";
  return (days ?? []).map((x) => WEEK.find((w) => w.d === x)?.l).join(", ");
}

/** "10:00" -> "10:00 AM". */
function timeText(hm) {
  if (!hm) return "";
  const [h, m] = hm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Compact Mon..Sun toggles. */
function DayPicker({ days, onChange, small = false }) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-lg border border-[#e3e9f5] bg-white p-0.5" role="group" aria-label="Days">
      {WEEK.map((w) => {
        const on = days.includes(w.d);
        return (
          <button
            key={w.d}
            type="button"
            aria-pressed={on}
            aria-label={w.l}
            onClick={() => onChange(on ? days.filter((x) => x !== w.d) : [...days, w.d])}
            className={`${small ? "w-7 py-1 text-[10.5px]" : "w-10 py-1.5 text-[11px]"} rounded-md font-semibold transition-colors ${
              on ? "bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] text-white shadow-sm" : "text-[#676b7a] hover:bg-[#f1f4fc] hover:text-[#1f4693]"
            }`}
          >
            {small ? w.l[0] : w.l}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- reminders: built-in (compact rows)
function BuiltInRow({ s, onSaved }) {
  const { can } = useAccess();
  const canEdit = can("portal.notifications.edit");
  const canSend = can("portal.notifications.create");
  const [enabled, setEnabled] = useState(s.enabled);
  const [time, setTime] = useState(s.send_at);
  const [days, setDays] = useState(s.days);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const t = REMINDER_TEXT[s.kind];
  const dirty = enabled !== s.enabled || time !== s.send_at || [...days].sort().join() !== [...s.days].sort().join();

  async function save() {
    setBusy(true);
    const r = await saveReminder(s.kind, enabled, time, [...days].sort());
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message });
    setMsg({ kind: "ok", text: "Saved." });
    onSaved(r.settings);
  }
  async function now() {
    setBusy(true);
    const r = await sendReminderNow(s.kind);
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message });
    setMsg({ kind: "ok", text: r.count ? `Sent to ${r.count}.` : "Nobody needs it now (or already reminded today)." });
  }

  return (
    <li className="flex flex-col gap-3 px-5 py-3.5 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {canEdit ? (
          <Toggle on={enabled} onClick={() => setEnabled(!enabled)} label={`${t.title} on or off`} />
        ) : (
          <Badge tone={enabled ? "green" : "slate"}>{enabled ? "On" : "Off"}</Badge>
        )}
        <div className="min-w-0" title={t.who}>
          <p className={`truncate text-sm font-semibold ${enabled ? "text-[#101a3a]" : "text-[#9aa0ad]"}`}>{t.title}</p>
          <p className="truncate text-xs text-[#676b7a]">{t.short}</p>
        </div>
      </div>
      <div className={`flex flex-wrap items-center gap-2 ${enabled ? "" : "opacity-50"}`}>
        {canEdit ? (
          <>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={`${t.title} time`} className={`${INPUT_INLINE(false)} w-[7.5rem] py-1.5`} />
            <DayPicker days={days} onChange={setDays} small />
          </>
        ) : (
          <span className="text-xs text-[#4a5068]">
            {timeText(time)} · {daysText(days)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 lg:w-56 lg:justify-end">
        <span className="text-[11px] text-[#9aa0ad]">
          {msg.text ? (
            <span className={msg.kind === "ok" ? "text-emerald-700" : "text-red-600"}>{msg.text}</span>
          ) : (
            <>{s.sent_today} today · {s.last_run ? `last ${formatDate(s.last_run)}` : "not sent yet"}</>
          )}
        </span>
        {dirty && canEdit && (
          <button type="button" disabled={busy} onClick={save} className={`${BTN_PRIMARY} px-3 py-1.5 text-xs`}>
            Save
          </button>
        )}
        {canSend && (
          <button type="button" disabled={busy} onClick={now} className={ICON_BTN} title="Send now" aria-label={`Send ${t.title} now`}>
            <Send size={15} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

function BuiltInReminders() {
  const [list, setList] = useState(null);
  useEffect(() => {
    let active = true;
    getReminderSettings()
      .then((d) => active && setList(d))
      .catch(() => active && setList([]));
    return () => {
      active = false;
    };
  }, []);
  return (
    <Panel
      icon={AlarmClock}
      title="Built-in reminders"
      subtitle="Sent only to the people who need them · never on holidays · at most once a day each"
      flush
    >
      {!list ? (
        <p className="p-5 text-sm text-[#676b7a]">Loading…</p>
      ) : (
        <ul className="divide-y divide-[#eef1f7]">
          {list.map((s) => (
            <BuiltInRow key={`${s.kind}-${s.send_at}-${s.enabled}-${s.days.join()}`} s={s} onSaved={setList} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- reminders: custom (made by the admin)
function audienceText(r) {
  if (r.audience === "all") return "Everyone";
  if (r.audience === "department") return (r.departments ?? []).join(", ");
  if (r.audience === "project") return `Team: ${r.project_name ?? "project"}`;
  const names = r.people_names ?? [];
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

function scheduleText(r) {
  return r.repeat === "once" ? `Once · ${formatDate(r.send_date)} · ${timeText(r.send_at)}` : `${daysText(r.days)} · ${timeText(r.send_at)}`;
}

function toPayload(f) {
  return {
    title: f.title.trim(),
    body: f.body.trim(),
    priority: f.priority,
    audience: f.aud.audience,
    departments: f.aud.departments,
    project_id: f.aud.project || null,
    people: f.aud.people,
    repeat: f.repeat,
    days: f.days,
    send_date: f.send_date || null,
    send_at: f.send_at,
    enabled: f.enabled,
  };
}

function fromReminder(r) {
  return {
    title: r.title,
    body: r.body ?? "",
    priority: r.priority,
    aud: { audience: r.audience, departments: r.departments ?? [], project: r.project_id ?? "", people: r.people ?? [] },
    repeat: r.repeat,
    days: r.days ?? [1, 2, 3, 4, 5, 6],
    send_date: r.send_date ?? "",
    send_at: r.send_at,
    enabled: r.enabled,
  };
}

const NEW_REMINDER = {
  title: "",
  body: "",
  priority: "normal",
  aud: EMPTY_AUDIENCE,
  repeat: "weekly",
  days: [1, 2, 3, 4, 5, 6],
  send_date: "",
  send_at: "10:00",
  enabled: true,
};

function CustomReminderForm({ opts, reminder, onSaved, onClose }) {
  const [f, setF] = useState(() => (reminder ? fromReminder(reminder) : NEW_REMINDER));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const recipients = countRecipients(opts, f.aud);

  async function submit(e) {
    e.preventDefault();
    if (!f.title.trim()) return setError("Write a title.");
    if (recipients === 0) return setError("Choose who should get it.");
    if (f.repeat === "weekly" && f.days.length === 0) return setError("Choose at least one day.");
    if (f.repeat === "once" && !f.send_date) return setError("Choose the date.");
    setBusy(true);
    setError("");
    const r = await saveCustomReminder(reminder?.id, toPayload(f));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onSaved(r.list);
    onClose();
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 border-b border-[#eef1f7] bg-[#fafbff] p-5">
      <p className="text-sm font-bold text-[#101a3a]">{reminder ? "Edit reminder" : "New reminder"}</p>
      {error && <Alert kind="err">{error}</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        <label>
          <span className={LABEL}>Title</span>
          <input value={f.title} maxLength={150} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Weekly team meeting in 15 minutes" className={INPUT(false)} />
        </label>
        <label>
          <span className={LABEL}>Message (optional)</span>
          <input value={f.body} maxLength={2000} onChange={(e) => set({ body: e.target.value })} placeholder="e.g. Join the Google Meet link in the group" className={INPUT(false)} />
        </label>
      </div>
      <AudienceFields opts={opts} value={f.aud} onChange={(aud) => set({ aud })} />
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <p className={LABEL}>Repeat</p>
          <Chips
            items={[
              { key: "weekly", label: "Weekly" },
              { key: "once", label: "One time" },
            ]}
            value={f.repeat}
            onChange={(k) => set({ repeat: k })}
            label="Repeat"
          />
        </div>
        {f.repeat === "weekly" ? (
          <div>
            <p className={LABEL}>Days</p>
            <DayPicker days={f.days} onChange={(days) => set({ days })} />
          </div>
        ) : (
          <label>
            <span className={LABEL}>Date</span>
            <input type="date" value={f.send_date} min={todayIst().iso} onChange={(e) => set({ send_date: e.target.value })} className={`${INPUT_INLINE(false)} w-44`} />
          </label>
        )}
        <label>
          <span className={LABEL}>Time (India)</span>
          <input type="time" value={f.send_at} min="06:00" max="21:55" onChange={(e) => set({ send_at: e.target.value })} className={`${INPUT_INLINE(false)} w-32`} />
        </label>
        <div>
          <p className={LABEL}>Priority</p>
          <Chips items={PRIORITY_CHIPS.map((p) => ({ ...p, label: p.key === "urgent" ? "Urgent" : "Normal" }))} value={f.priority} onChange={(k) => set({ priority: k })} label="Priority" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={BTN_PRIMARY}>
          {busy ? "Saving…" : reminder ? "Save reminder" : "Create reminder"}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={BTN_SECONDARY}>
          Cancel
        </button>
        <span className="text-xs text-[#676b7a]">
          <span className="font-bold tabular-nums text-[#101a3a]">{recipients}</span> {recipients === 1 ? "employee" : "employees"} ·{" "}
          {f.repeat === "once" ? (f.send_date ? `once on ${formatDate(f.send_date)}` : "once") : daysText(f.days) || "no days"} at {timeText(f.send_at)}
          {f.repeat === "weekly" && " · not on holidays"}
        </span>
      </div>
    </form>
  );
}

function CustomRow({ r, opts, onList }) {
  const { can } = useAccess();
  const canEdit = can("portal.notifications.edit");
  const canDelete = can("portal.notifications.delete");
  const canSend = can("portal.notifications.create");
  const [mode, setMode] = useState(null); // null | "edit" | "delete"
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: "", text: "" });

  async function toggle() {
    setBusy(true);
    const res = await saveCustomReminder(r.id, { ...toPayload(fromReminder(r)), enabled: !r.enabled });
    setBusy(false);
    if (!res.ok) return setMsg({ kind: "err", text: res.message });
    onList(res.list);
  }
  async function now() {
    setBusy(true);
    const res = await sendCustomReminderNow(r.id);
    setBusy(false);
    setMsg(res.ok ? { kind: "ok", text: res.count ? `Sent to ${res.count}.` : "Already sent to everyone today." } : { kind: "err", text: res.message });
  }
  async function remove() {
    setBusy(true);
    const res = await deleteCustomReminder(r.id);
    setBusy(false);
    if (!res.ok) return setMsg({ kind: "err", text: res.message });
    onList(res.list);
  }

  if (mode === "edit" && canEdit) {
    return (
      <li>
        <CustomReminderForm opts={opts} reminder={r} onSaved={onList} onClose={() => setMode(null)} />
      </li>
    );
  }
  const done = r.repeat === "once" && !r.enabled && r.last_run;

  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {canEdit ? (
            <Toggle on={r.enabled} onClick={toggle} label={`${r.title} on or off`} />
          ) : (
            <Badge tone={r.enabled ? "green" : "slate"}>{r.enabled ? "On" : "Off"}</Badge>
          )}
          <div className="min-w-0">
            <p className={`flex flex-wrap items-center gap-2 text-sm font-semibold ${r.enabled ? "text-[#101a3a]" : "text-[#9aa0ad]"}`}>
              <span className="truncate">{r.title}</span>
              {r.priority === "urgent" && <Badge tone="red">Urgent</Badge>}
              {done && <Badge tone="slate">Sent</Badge>}
            </p>
            {r.body && <p className="truncate text-xs text-[#676b7a]">{r.body}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="blue">
            <Users size={11} aria-hidden="true" /> {audienceText(r)} · {r.recipients}
          </Badge>
          <Badge tone={r.repeat === "once" ? "violet" : "teal"}>
            {r.repeat === "once" ? <CalendarClock size={11} aria-hidden="true" /> : <Repeat size={11} aria-hidden="true" />} {scheduleText(r)}
          </Badge>
        </div>
        <div className="flex items-center gap-1 lg:w-56 lg:justify-end">
          {msg.text && <span className={`mr-1 text-[11px] ${msg.kind === "ok" ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>}
          {canSend && (
            <button type="button" disabled={busy} onClick={now} className={ICON_BTN} title="Send now" aria-label={`Send ${r.title} now`}>
              <Send size={15} aria-hidden="true" />
            </button>
          )}
          {canEdit && (
            <button type="button" disabled={busy} onClick={() => setMode("edit")} className={ICON_BTN} title="Edit" aria-label={`Edit ${r.title}`}>
              <Pencil size={15} aria-hidden="true" />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode(mode === "delete" ? null : "delete")}
              className={ICON_BTN_DANGER}
              title="Delete"
              aria-label={`Delete ${r.title}`}
              aria-expanded={mode === "delete"}
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {mode === "delete" && canDelete && (
        <div role="alertdialog" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span className="font-semibold">Delete this reminder?</span>
          <button type="button" disabled={busy} onClick={remove} className={`${BTN_DANGER} px-3 py-1.5 text-xs`}>
            Delete
          </button>
          <button type="button" disabled={busy} onClick={() => setMode(null)} className={`${BTN_SECONDARY} px-3 py-1.5 text-xs`}>
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

function CustomReminders() {
  const { can } = useAccess();
  const canEdit = can("portal.notifications.edit");
  const opts = useNotifyOptions();
  const [list, setList] = useState(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    let active = true;
    getCustomReminders()
      .then((d) => active && setList(d))
      .catch(() => active && setList([]));
    return () => {
      active = false;
    };
  }, []);

  return (
    <Panel
      icon={CalendarPlus}
      title="Your reminders"
      subtitle="Your own scheduled messages — to everyone, departments, a project team or chosen people"
      action={
        !adding &&
        canEdit && (
          <button type="button" onClick={() => setAdding(true)} disabled={!opts} className={BTN_PRIMARY}>
            <Plus size={15} aria-hidden="true" /> New reminder
          </button>
        )
      }
      flush
    >
      {adding && canEdit && opts && <CustomReminderForm opts={opts} reminder={null} onSaved={setList} onClose={() => setAdding(false)} />}
      {!list || !opts ? (
        <p className="p-5 text-sm text-[#676b7a]">Loading…</p>
      ) : list.length === 0 ? (
        !adding && (
          <Empty
            icon={CalendarPlus}
            title="No reminders of your own yet"
            message="For example: “Weekly team meeting in 15 minutes” to a project team every Monday at 10:45, or “Submit your timesheet” to one person on a date."
          />
        )
      ) : (
        <ul className="divide-y divide-[#eef1f7]">
          {list.map((r) => (
            <CustomRow key={`${r.id}-${r.enabled}-${r.send_at}-${r.title}`} r={r} opts={opts} onList={setList} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Reminders() {
  return (
    <div className="flex flex-col gap-5">
      <CustomReminders />
      <BuiltInReminders />
    </div>
  );
}

// ---------------------------------------------------------------- automatic + log
function useLog(filter) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    getNotificationLog(filter, 150)
      .then((d) => active && setData(d))
      .catch(() => active && setData({ counts: {}, items: [] }));
    return () => {
      active = false;
    };
  }, [filter]);
  return data;
}

function Automatic() {
  const data = useLog("automatic");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {AUTOMATIC.map((a) => (
        <div key={a.kind} className={`${CARD} p-5`}>
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#eef2fb] text-[#1f4693]">
              <Zap className="h-4 w-4" aria-hidden="true" />
            </span>
            <KindBadge kind={a.kind} />
            <span className="ml-auto text-xs text-[#676b7a]">
              {data ? (
                <>
                  <span className="font-bold tabular-nums text-[#101a3a]">{data.counts?.[a.kind] ?? 0}</span> in 30 days
                </>
              ) : (
                "…"
              )}
            </span>
          </div>
          <ul className="flex flex-col gap-1.5 text-sm text-[#2b303b]">
            {a.rows.map((r) => (
              <li key={r} className="flex gap-2">
                <Check size={14} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" /> {r}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const LOG_FILTERS = [
  { key: "all", label: "All" },
  { key: "automatic", label: "Automatic" },
  { key: "messages", label: "Messages" },
  ...Object.entries(KINDS)
    .filter(([k]) => k !== "message")
    .map(([key, v]) => ({ key, label: v.label })),
];

function ActivityLog() {
  const [filter, setFilter] = useState("all");
  const data = useLog(filter);
  return (
    <TableCard
      title="Activity log (latest 150)"
      count={data ? data.items.length : null}
      filters={<Chips items={LOG_FILTERS} value={filter} onChange={setFilter} label="Filter" />}
    >
      {!data ? (
        <p className="p-5 text-sm text-[#676b7a]">Loading…</p>
      ) : data.items.length === 0 ? (
        <Empty icon={Inbox} title="Nothing here yet" />
      ) : (
        <>
          {/* Phones: list */}
          <ul className="divide-y divide-[#eef1f7] md:hidden">
            {data.items.map((n) => (
              <li key={n.id} className="flex flex-col gap-1.5 px-5 py-3">
                <div className="flex items-center gap-2">
                  <KindBadge kind={n.kind} />
                  {n.priority === "urgent" && <Badge tone="red">Urgent</Badge>}
                  <Badge tone={n.read_at ? "green" : "slate"} className="ml-auto">
                    {n.read_at ? "Read" : "Unread"}
                  </Badge>
                </div>
                <p className="text-sm font-semibold text-[#101a3a]">{n.title}</p>
                {n.body && <p className="line-clamp-2 text-xs text-[#676b7a]">{n.body}</p>}
                <p className="text-[11px] text-[#9aa0ad]">
                  To {n.employee.full_name} · {n.automatic ? "automatic" : `from ${n.sender ?? "—"}`} · {timeAgo(n.created_at)}
                </p>
              </li>
            ))}
          </ul>
          {/* Larger screens: table */}
          <div className={`hidden md:block ${TABLE_WRAP}`}>
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Type</th>
                  <th className={TH}>Notification</th>
                  <th className={TH}>To</th>
                  <th className={TH}>From</th>
                  <th className={TH}>When</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((n) => (
                  <tr key={n.id} className={TR}>
                    <td className={TD}>
                      <KindBadge kind={n.kind} />
                    </td>
                    <td className={`${TD} max-w-md`}>
                      <p className="font-semibold text-[#101a3a]">
                        {n.priority === "urgent" && (
                          <span className="mr-1 text-red-600" aria-label="Urgent">
                            ●
                          </span>
                        )}
                        {n.title}
                      </p>
                      {n.body && <p className="line-clamp-2 text-xs text-[#676b7a]">{n.body}</p>}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{n.employee.full_name}</td>
                    <td className={`${TD} whitespace-nowrap text-xs`}>{n.automatic ? <Badge tone="slate">Automatic</Badge> : n.sender ?? "—"}</td>
                    <td className={`${TD} whitespace-nowrap text-xs text-[#676b7a]`}>{timeAgo(n.created_at)}</td>
                    <td className={TD}>
                      <Badge tone={n.read_at ? "green" : "slate"} dot>
                        {n.read_at ? "Read" : "Unread"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </TableCard>
  );
}

/**
 * Admin: Notifications Management — company-wide announcements, messages to
 * departments / project teams / chosen people, scheduled reminders, the
 * automatic notifications and an activity log. Migration 243.
 */
export default function NotificationsAdminPage() {
  const { can } = useAccess();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "send";
  const [sentKey, setSentKey] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications Management"
        icon={BellRing}
        subtitle="Send company-wide announcements or notify departments, project teams and chosen employees; schedule reminders; see what is sent automatically."
      />
      <Tabs label="Notification views" items={TABS} value={tab} onChange={(k) => setParams(k === "send" ? {} : { tab: k }, { replace: true })} />

      {tab === "sent" ? (
        <Panel icon={Send} title="Sent by admin" subtitle="Last 90 days, with how many people have read each one.">
          <SentList key={sentKey} />
        </Panel>
      ) : tab === "reminders" ? (
        <Reminders />
      ) : tab === "automatic" ? (
        <div className="flex flex-col gap-4">
          <Alert kind="info">
            These go out on their own when something happens — no action needed. Numbers = notifications of that type in the last 30 days.
          </Alert>
          <Automatic />
        </div>
      ) : tab === "log" ? (
        <ActivityLog />
      ) : (
        <Panel icon={PenSquare} title="New notification" subtitle="Appears in each recipient's Employee Portal notifications.">
          {can("portal.notifications.create") ? (
            <Composer onSent={() => setSentKey((k) => k + 1)} />
          ) : (
            <p className="text-sm text-[#676b7a]">You can view notifications but not send them.</p>
          )}
        </Panel>
      )}
    </div>
  );
}
