// Employee: daily work report editor (draft -> submit) with multiple tasks
// (status, hours, progress, completed work, deliverables, links, blockers),
// changes-requested handling, reviewer comment thread with replies, report
// history, my blockers, my hours (incl. attendance comparison) and completed
// work. Hours, project allocation, task/project checks and status rules are
// re-validated by the database.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CalendarClock, CheckCircle2, ListTodo, MessageSquareReply, MessageSquareWarning, Plus, Save, Send, Trash2 } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, fullName, useHrQuery } from "@/lib/hr/client";
import { addDays, businessToday, useBusinessTimezone } from "@/lib/hr/attendance";
import {
  BLOCKER_SEVERITIES, EDITABLE_REPORT_STATUSES, MAX_DAY_HOURS, REVIEW_ACTION_LABEL, WORK_STATUSES, WORK_STATUS_LABEL, allocatedOn, completedWork,
  deleteMyDraft, derivePendingTasks, feedbackAttention, getMyReport, listBlockers, listMyFeedback, listMyReportItems, listMyProjects, listMyReports, listMyTasks, listReportBlockers, listReviews, replyReport, saveBlocker,
  saveMyReport, submitReport, validateReport,
} from "@/lib/hr/dailyReports";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, ErrorState, Field, InlineError, Input, KpiCard, Loading, Modal, PageHeader, Select, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";
import {
  AttendanceComparison, BlockerStatusBadge, BlockerTable, HoursSummary, RangeFields, ReportStatusBadge, SeverityBadge, WorkStatusBadge, hrs,
} from "@/hr/components/DailyWorkParts";

let uidSeq = 0;
const newItem = () => ({
  _k: `n${++uidSeq}`, project_id: "", task_id: "", activity: "", description: "", hours: "", progress_pct: "", work_status: "in_progress",
  completed_work: "", deliverables: "", completion_date: "", links: "", notes: "", blocker_title: "", blocker_severity: "medium", blocker_description: "",
});
const toEditable = (it) => ({
  ...newItem(), _k: it.id, id: it.id, project_id: it.project_id ?? "", task_id: it.task_id ?? "", activity: it.activity ?? "", description: it.description ?? "",
  hours: String(it.hours ?? ""), progress_pct: it.progress_pct ?? "", work_status: it.work_status ?? "in_progress", completed_work: it.completed_work ?? "",
  deliverables: it.deliverables ?? "", completion_date: it.completion_date ?? "", links: (it.links ?? []).join("\n"), notes: it.notes ?? "",
});
const TEXTS = [
  { key: "summary", label: "Summary of the day" },
  { key: "pending_work", label: "Pending work" },
  { key: "blockers", label: "Blocker notes" },
  { key: "support_required", label: "Support required" },
  { key: "tomorrow_plan", label: "Plan for tomorrow" },
];
const TABS = [
  { value: "report", label: "Daily report" }, { value: "pending", label: "Pending tasks" }, { value: "blockers", label: "My blockers" },
  { value: "hours", label: "My hours" }, { value: "completed", label: "Completed work" }, { value: "feedback", label: "Manager feedback" },
];

export default function MyDailyReportsPage() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const tz = useBusinessTimezone();
  const today = businessToday(tz);
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get("tab")) ? params.get("tab") : "report";
  const [date, setDate] = useState(today);
  const report = useHrQuery(() => getMyReport(me, date), [me, date]);
  const history = useHrQuery(() => listMyReports(me, { from: addDays(today, -90), to: today }), [me, today]);
  const openReport = (d) => { setDate(d); setParams({ tab: "report" }, { replace: true }); window.scrollTo({ top: 0, behavior: "smooth" }); };

  return (
    <>
      <PageHeader title="My Daily Reports" description="Record your tasks, hours, completed work and blockers each day. Drafts are private to you until you submit." />
      <Tabs tabs={TABS} value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} label="My daily report sections" />
      {tab === "report" && (
        <>
          <Card title="Report" actions={
            <label className="flex items-center gap-2 text-sm text-slate-600">Date
              <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm" />
            </label>}>
            {report.loading ? <Loading /> : report.error ? <ErrorState message={report.error} onRetry={report.reload} /> : (
              <ReportEditor key={`${date}-${report.data?.id ?? "new"}-${report.data?.status ?? ""}`} me={me} date={date} report={report.data}
                onSaved={history.reload} onChanged={() => { report.reload(); history.reload(); }} />
            )}
          </Card>
          <div className="mt-4" />
          <Card title="My report history (last 90 days)" padded={false}>
            <DataTable caption="My report history" rows={history.data} loading={history.loading} error={history.error} onRetry={history.reload}
              emptyTitle="No reports yet" onRowClick={(r) => { setDate(r.report_date); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              columns={[
                { key: "report_date", header: "Date", render: (r) => formatDate(r.report_date, { weekday: "short", day: "2-digit", month: "short", year: "numeric" }) },
                { key: "status", header: "Status", render: (r) => <ReportStatusBadge status={r.status} /> },
                { key: "total_hours", header: "Hours", render: (r) => Number(r.total_hours).toFixed(2) },
                { key: "submitted_at", header: "Submitted", render: (r) => formatDateTime(r.submitted_at) },
                { key: "reviewed_at", header: "Reviewed", render: (r) => formatDateTime(r.reviewed_at) },
                { key: "_open", header: <span className="sr-only">Open</span>, render: (r) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDate(r.report_date); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{EDITABLE_REPORT_STATUSES.includes(r.status) ? "Edit" : "View"}</Button> },
              ]} />
          </Card>
        </>
      )}
      {tab === "blockers" && <MyBlockers me={me} />}
      {tab === "hours" && <MyHours me={me} today={today} />}
      {tab === "completed" && <MyCompletedWork me={me} today={today} />}
      {tab === "pending" && <MyPendingTasks me={me} today={today} onOpen={openReport} />}
      {tab === "feedback" && <MyFeedback me={me} today={today} onOpen={openReport} />}
    </>
  );
}

function ReportEditor({ me, date, report: initialReport, onSaved, onChanged }) {
  const { notify } = useToast();
  const projects = useHrQuery(() => listMyProjects(me), [me]);
  const tasks = useHrQuery(() => listMyTasks(me), [me]);
  // `base` is the last server snapshot (ids of saved items) used to diff on save.
  const [base, setBase] = useState(initialReport);
  const report = base;
  const blockers = useHrQuery(() => listReportBlockers(report?.id), [report?.id, report?.updated_at]);
  const editable = !report || EDITABLE_REPORT_STATUSES.includes(report.status);
  const [values, setValues] = useState(() => Object.fromEntries(TEXTS.map((t) => [t.key, report?.[t.key] ?? ""])));
  const [items, setItems] = useState(() => (report?.items?.length ? report.items.map(toEditable) : editable ? [newItem()] : []));
  const [val, setVal] = useState({ errors: {}, itemErrors: [] });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null); // "submit" | "delete"
  const [dirty, setDirty] = useState(false);
  const blockerOf = (itemId) => (blockers.data ?? []).find((b) => b.item_id === itemId);
  const itemsWithBlockers = items.map((it) => ({ ...it, has_blocker: Boolean(it.id && (blockerOf(it.id) || it._blocker_saved)) }));

  const total = items.reduce((s, it) => s + (Number(it.hours) || 0), 0);
  const projectOptions = useMemo(() => {
    const active = (projects.data ?? []).filter((p) => p.status === "active" && allocatedOn(p, date));
    const used = (report?.items ?? []).filter((i) => i.project && !active.some((p) => p.id === i.project_id)).map((i) => ({ ...i.project, status: "inactive" }));
    return [...active, ...used].map((p) => ({ value: p.id, label: `${p.code} · ${p.name}${p.status !== "active" ? " (not assigned on this date)" : ""}`, disabled: p.status !== "active" }));
  }, [projects.data, report, date]);
  const taskOptions = (projectId) => (tasks.data ?? []).filter((t) => t.project_id === projectId).map((t) => ({ value: t.id, label: `${t.title}${t.status === "done" ? " (done)" : ""}` }));

  const setItem = (k, field, value) => { setDirty(true); setItems((list) => list.map((it) => (it._k === k ? { ...it, [field]: value, ...(field === "project_id" ? { task_id: "" } : {}) } : it))); };
  const setText = (k) => (e) => { setDirty(true); setValues((s) => ({ ...s, [k]: e.target.value })); };

  async function save({ quiet } = {}) {
    const res = validateReport(values, itemsWithBlockers, { date });
    setVal(res);
    if (!res.ok) { setError("Fix the highlighted fields."); return { error: "invalid" }; }
    setError(null);
    const out = await saveMyReport({ employeeId: me, date, report: report && { ...report, blockers: blockers.data ?? [] }, values, items: itemsWithBlockers });
    // Re-read the server state so item ids are known (deletes/updates are idempotent,
    // the item insert is a single all-or-nothing statement).
    const fresh = out.data ? await getMyReport(me, date) : null;
    if (fresh?.data) {
      setBase(fresh.data);
      // After a successful save every blocked task has a blocker (validation required
      // one), even before the blocker list below has reloaded.
      if (!out.error) setItems(fresh.data.items.map(toEditable).map((x) => ({ ...x, _blocker_saved: x.work_status === "blocked" })));
    }
    blockers.reload();
    if (out.error) { setError(out.error); return { error: out.error }; }
    setDirty(false);
    onSaved?.();
    if (!quiet) notify("Draft saved.");
    return { id: out.data };
  }

  async function doSubmit() {
    if (!items.length) return { error: "Add at least one work item before submitting." };
    setBusy("submit");
    const saved = await save({ quiet: true });
    if (saved.error) { setBusy(null); return { error: saved.error === "invalid" ? "Fix the highlighted fields first." : saved.error }; }
    const res = await submitReport(saved.id);
    setBusy(null);
    if (res.error) return { error: `Your draft was saved, but it was not submitted: ${res.error}` };
    notify(`Report for ${formatDate(date)} submitted.`);
    onChanged();
    return {};
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-[#101a3a]">{formatDate(date, { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</span>
        {report ? <ReportStatusBadge status={report.status} /> : <Badge>not started</Badge>}
        {report?.submitted_at && <span className="text-xs text-slate-500">Submitted {formatDateTime(report.submitted_at)}</span>}
      </div>
      {report?.status === "revision_requested" && (
        <p className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">Your reviewer asked for a revision (changes requested). See the comments below, update the report and submit it again.</p>
      )}
      {report?.status === "reviewed" && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Approved by your reviewer. Approved reports are locked; only a reviewer can reopen them.</p>}
      {!editable && <p className="text-xs text-slate-500">This report has been submitted and can no longer be edited. You can still reply to reviewer comments.</p>}
      {projects.error && <InlineError message={`Could not load your projects: ${projects.error}`} />}

      <fieldset className="flex flex-col gap-3" disabled={!editable}>
        <legend className="mb-1 text-sm font-bold text-[#101a3a]">Tasks</legend>
        {!items.length && <p className="text-sm text-slate-500">No work items.</p>}
        {items.map((it, idx) => {
          const e = val.itemErrors[idx] ?? {};
          const existingBlocker = it.id ? blockerOf(it.id) : null;
          return (
            <div key={it._k} className="rounded-xl border border-slate-200 p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <Field label="Project" className="md:col-span-2" hint={!projectOptions.length ? "You are not assigned to an active project on this date." : undefined}>
                  <Select placeholder="General / internal work" value={it.project_id} onChange={(ev) => setItem(it._k, "project_id", ev.target.value)} options={projectOptions} />
                </Field>
                <Field label="Task" className="md:col-span-2" error={e.task_id}>
                  <Select placeholder={it.project_id ? "No specific task" : "Choose a project first"} disabled={!it.project_id} value={it.task_id} onChange={(ev) => setItem(it._k, "task_id", ev.target.value)} options={it.project_id ? taskOptions(it.project_id) : []} />
                </Field>
                <Field label="Status" className="md:col-span-2"><Select value={it.work_status} onChange={(ev) => setItem(it._k, "work_status", ev.target.value)} options={WORK_STATUSES.map((s) => ({ value: s, label: WORK_STATUS_LABEL[s] }))} /></Field>
                <Field label="Hours" required error={e.hours}><Input type="number" min="0" max="24" step="0.25" inputMode="decimal" value={it.hours} onChange={(ev) => setItem(it._k, "hours", ev.target.value)} /></Field>
                {it.work_status === "completed"
                  ? <Field label="Progress" hint="Completed = 100 %"><Input value="100" disabled readOnly /></Field>
                  : <Field label="Progress %" error={e.progress_pct}><Input type="number" min="0" max="100" step="5" value={it.progress_pct} onChange={(ev) => setItem(it._k, "progress_pct", ev.target.value)} /></Field>}
                <Field label="Activity" required error={e.activity} className="md:col-span-4"><Input maxLength={200} value={it.activity} onChange={(ev) => setItem(it._k, "activity", ev.target.value)} placeholder="Task title, e.g. Implemented sample feature" /></Field>
                <Field label="Description" error={e.description} className="md:col-span-6"><Textarea rows={2} maxLength={4000} value={it.description} onChange={(ev) => setItem(it._k, "description", ev.target.value)} /></Field>
                {it.work_status === "completed" && (
                  <>
                    <Field label="Completed work" error={e.completed_work} className="md:col-span-3"><Textarea rows={2} maxLength={4000} value={it.completed_work} onChange={(ev) => setItem(it._k, "completed_work", ev.target.value)} placeholder="What was finished" /></Field>
                    <Field label="Deliverables" error={e.deliverables} className="md:col-span-2"><Textarea rows={2} maxLength={2000} value={it.deliverables} onChange={(ev) => setItem(it._k, "deliverables", ev.target.value)} /></Field>
                    <Field label="Completion date" error={e.completion_date} hint="Defaults to the report date"><Input type="date" max={date} value={it.completion_date} onChange={(ev) => setItem(it._k, "completion_date", ev.target.value)} /></Field>
                  </>
                )}
                <Field label="Supporting links" error={e.links} hint="One http(s) link per line (max 10)" className="md:col-span-3"><Textarea rows={2} value={it.links} onChange={(ev) => setItem(it._k, "links", ev.target.value)} placeholder="https://…" /></Field>
                <Field label="Notes" error={e.notes} className="md:col-span-3"><Textarea rows={2} maxLength={2000} value={it.notes} onChange={(ev) => setItem(it._k, "notes", ev.target.value)} /></Field>
                {it.work_status === "blocked" && (existingBlocker ? (
                  <div className="rounded-lg bg-rose-50 p-2 text-sm text-rose-900 md:col-span-6">
                    <AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden="true" />Blocker: <strong>{existingBlocker.title}</strong> <SeverityBadge severity={existingBlocker.severity} /> <BlockerStatusBadge status={existingBlocker.status} />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 rounded-lg border border-rose-200 bg-rose-50/50 p-2 md:col-span-6 md:grid-cols-4">
                    <Field label="Blocker title" required error={e.blocker_title} className="md:col-span-2"><Input maxLength={200} value={it.blocker_title} onChange={(ev) => setItem(it._k, "blocker_title", ev.target.value)} placeholder="What is blocking this task?" /></Field>
                    <Field label="Severity"><Select value={it.blocker_severity} onChange={(ev) => setItem(it._k, "blocker_severity", ev.target.value)} options={BLOCKER_SEVERITIES.map((s) => ({ value: s, label: s }))} /></Field>
                    <Field label="Blocker details" className="md:col-span-4"><Textarea rows={2} maxLength={4000} value={it.blocker_description} onChange={(ev) => setItem(it._k, "blocker_description", ev.target.value)} /></Field>
                    <p className="text-xs text-rose-800 md:col-span-4">Saved with the draft; your manager is notified in the app.</p>
                  </div>
                ))}
              </div>
              {editable && (
                <div className="mt-2 flex justify-end">
                  <Button size="sm" variant="ghost" onClick={() => { setDirty(true); setItems((l) => l.filter((x) => x._k !== it._k)); }} aria-label={`Remove item ${idx + 1}`}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />Remove
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {editable ? <Button size="sm" variant="secondary" onClick={() => { setDirty(true); setItems((l) => [...l, newItem()]); }}><Plus className="h-4 w-4" aria-hidden="true" />Add item</Button> : <span />}
          <p className={`text-sm font-semibold ${total > MAX_DAY_HOURS ? "text-red-600" : "text-[#101a3a]"}`} aria-live="polite">Total: {total.toFixed(2)} h / {MAX_DAY_HOURS} h</p>
        </div>
        {val.errors.total && <InlineError message={val.errors.total} />}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {TEXTS.map((t) => (
            <Field key={t.key} label={t.label} error={val.errors[t.key]} className={t.key === "summary" ? "md:col-span-2" : undefined}>
              <Textarea rows={3} maxLength={4000} value={values[t.key]} onChange={setText(t.key)} />
            </Field>
          ))}
        </div>
      </fieldset>

      <InlineError message={error} />
      {editable && (
        <div className="flex flex-wrap justify-end gap-2">
          {report?.status === "draft" && <Button variant="ghost" onClick={() => setConfirm("delete")} disabled={Boolean(busy)}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete draft</Button>}
          <Button variant="secondary" loading={busy === "save"} disabled={Boolean(busy)} onClick={async () => { setBusy("save"); await save(); setBusy(null); }}>
            <Save className="h-4 w-4" aria-hidden="true" />Save draft
          </Button>
          <Button loading={busy === "submit"} disabled={Boolean(busy)} onClick={() => setConfirm("submit")}><Send className="h-4 w-4" aria-hidden="true" />Submit</Button>
        </div>
      )}
      {dirty && editable && <p className="text-right text-xs text-amber-700">Unsaved changes.</p>}

      {report && report.status !== "draft" && <ReviewThread report={report} />}

      <ConfirmDialog open={confirm === "submit"} onClose={() => setConfirm(null)} title="Submit report?" confirmLabel="Submit"
        message={`Your report for ${formatDate(date)} (${total.toFixed(2)} h, ${items.length} task(s)) will be saved and sent for review. You cannot edit it afterwards unless changes are requested.`}
        onConfirm={doSubmit} />
      <ConfirmDialog open={confirm === "delete"} onClose={() => setConfirm(null)} title="Delete draft?" tone="danger" confirmLabel="Delete draft"
        message="The draft, its tasks and its open blockers will be permanently removed."
        onConfirm={async () => {
          const res = await deleteMyDraft(report.id);
          if (res.error) return { error: res.error };
          if (!res.data?.length) return { error: "The draft could not be deleted (it may already have been submitted)." };
          notify("Draft deleted."); onChanged();
          return {};
        }} />
    </div>
  );
}

export function ReviewThread({ report, canReply = true }) {
  const { hr } = useAuth();
  const { notify } = useToast();
  const reviews = useHrQuery(() => listReviews(report.id), [report.id]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setReply(""); setError(null); }, [report.id]);
  const owner = report.employee_id === hr?.employee?.id;
  const last = (reviews.data ?? []).filter((r) => r.action !== "submitted").slice(-1)[0];
  async function send() {
    if (!reply.trim()) { setError("Write a reply."); return; }
    if (reply.length > 4000) { setError("At most 4000 characters."); return; }
    setBusy(true); setError(null);
    const res = await replyReport(report.id, reply);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setReply(""); reviews.reload(); notify("Reply sent.");
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <h4 className="mb-2 text-sm font-bold text-[#101a3a]">Manager feedback &amp; review history</h4>
      {reviews.loading && !reviews.data ? <Loading /> : reviews.error ? <ErrorState message={reviews.error} onRetry={reviews.reload} /> : (
        <ol className="flex flex-col gap-2">
          {(reviews.data ?? []).map((r) => (
            <li key={r.id} className="rounded-lg bg-white p-2.5 text-sm shadow-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-[#173a52]">{r.actor ? fullName(r.actor) : "Someone"}</span>
                <Badge tone={["revision_requested", "clarification", "reopened"].includes(r.action) ? "orange" : r.action === "reviewed" ? "green" : "slate"}>{REVIEW_ACTION_LABEL[r.action] ?? r.action}</Badge>
                <span>{formatDateTime(r.created_at)}</span>
              </div>
              {r.comment && <p className="mt-1 whitespace-pre-wrap text-slate-700">{r.comment}</p>}
            </li>
          ))}
          {!reviews.data?.length && <li className="text-sm text-slate-500">No review activity yet.</li>}
        </ol>
      )}
      {owner && canReply && (
        <div className="mt-3 flex flex-col gap-2">
          {last?.action === "clarification" && <p className="text-xs font-semibold text-orange-700">Your reviewer asked for clarification.</p>}
          <Field label="Reply to reviewer"><Textarea rows={2} maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} /></Field>
          <InlineError message={error} />
          <div className="flex justify-end"><Button size="sm" loading={busy} onClick={send}>Send reply</Button></div>
        </div>
      )}
    </div>
  );
}

function MyBlockers({ me }) {
  const [status, setStatus] = useState("active");
  const q = useHrQuery(() => listBlockers({ status, mine: true }), [status]);
  const [adding, setAdding] = useState(false);
  return (
    <Card title="My blockers" actions={<Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" />Report a blocker</Button>}>
      <Toolbar>
        <Field label="Show" className="sm:w-48"><Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All"
          options={[{ value: "active", label: "Open + in progress" }, { value: "resolved", label: "Resolved" }]} /></Field>
      </Toolbar>
      <p className="mb-3 text-xs text-slate-500">Blockers you reported, and blockers assigned to you to resolve.</p>
      <BlockerTable query={q} me={me} caption="My blockers" emptyTitle="No blockers" />
      {adding && <NewBlockerModal me={me} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); q.reload(); }} />}
    </Card>
  );
}

function NewBlockerModal({ me, onClose, onSaved }) {
  const { notify } = useToast();
  const projects = useHrQuery(() => listMyProjects(me), [me]);
  const [v, setV] = useState({ project: "", title: "", severity: "medium", description: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    const t = v.title.trim();
    if (t.length < 2 || t.length > 200) { setError("Title must be 2–200 characters."); return; }
    setBusy(true); setError(null);
    const res = await saveBlocker({ project: v.project, title: t, description: v.description, severity: v.severity });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Blocker reported; your manager has been notified in the app.");
    onSaved();
  }
  return (
    <Modal open onClose={onClose} title="Report a blocker" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Report</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Title" required className="sm:col-span-2"><Input maxLength={200} value={v.title} onChange={set("title")} /></Field>
        <Field label="Project"><Select placeholder="General" value={v.project} onChange={set("project")} options={(projects.data ?? []).filter((p) => p.status === "active").map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} /></Field>
        <Field label="Severity"><Select value={v.severity} onChange={set("severity")} options={BLOCKER_SEVERITIES.map((s) => ({ value: s, label: s }))} /></Field>
        <Field label="Details" className="sm:col-span-2"><Textarea rows={3} maxLength={4000} value={v.description} onChange={set("description")} /></Field>
      </div>
      <div className="mt-3"><InlineError message={error || projects.error} /></div>
    </Modal>
  );
}

function MyHours({ me, today }) {
  const [r, setR] = useState({ from: addDays(today, -29), to: today });
  return (
    <div className="flex flex-col gap-4">
      <Toolbar><RangeFields value={r} onChange={setR} max={today} /></Toolbar>
      <Card title="My reported hours">
        <HoursSummary from={r.from} to={r.to} filters={{ employee: me }} defaultGroup="week"
          groups={[{ value: "day", label: "By day" }, { value: "week", label: "By week" }, { value: "month", label: "By month" }, { value: "project", label: "By project" }]} />
      </Card>
      <Card title="Reported hours vs my attendance"><AttendanceComparison from={r.from} to={r.to} filters={{ employee: me }} showEmployee={false} /></Card>
    </div>
  );
}

function MyCompletedWork({ me, today }) {
  const [r, setR] = useState({ from: addDays(today, -29), to: today });
  const invalid = !r.from || !r.to || r.to < r.from;
  const q = useHrQuery(() => (invalid ? Promise.resolve({ data: [], error: null }) : completedWork({ from: r.from, to: r.to, employee: me })), [r.from, r.to, invalid, me]);
  return (
    <Card title="Completed work" padded={false}>
      <div className="px-4 pt-4"><Toolbar><RangeFields value={r} onChange={setR} max={today} /></Toolbar></div>
      <DataTable caption="Completed work" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} rowKey="item_id" pageSize={25}
        emptyTitle="No completed tasks" emptyDescription="Tasks marked Completed in your reports appear here."
        columns={[
          { key: "completion_date", header: "Completed", sortable: true, render: (x) => formatDate(x.completion_date ?? x.report_date) },
          { key: "activity", header: "Task", render: (x) => <span><span className="font-semibold text-[#101a3a]">{x.activity}</span><span className="block text-xs text-slate-500">{x.project_label}{x.task_title ? ` · ${x.task_title}` : ""}</span></span> },
          { key: "completed_work", header: "Completed work", render: (x) => <p className="max-w-md whitespace-pre-wrap text-slate-700">{x.completed_work || "—"}{x.deliverables ? <span className="block text-xs text-slate-500">Deliverables: {x.deliverables}</span> : null}</p> },
          { key: "hours", header: "Hours", render: (x) => hrs(x.hours) },
          { key: "report_status", header: "Report", render: (x) => <ReportStatusBadge status={x.report_status} /> },
          { key: "work_status", header: <span className="sr-only">Task status</span>, render: (x) => <WorkStatusBadge status={x.work_status} /> },
        ]} />
    </Card>
  );
}

const PRIORITY_TONE = { low: "slate", medium: "blue", high: "orange", urgent: "red" };
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function MyPendingTasks({ me, today, onOpen }) {
  const [r, setR] = useState({ from: addDays(today, -59), to: today });
  const [project, setProject] = useState("");
  const [status, setStatus] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const invalid = !r.from || !r.to || r.to < r.from;
  const items = useHrQuery(() => (invalid ? Promise.resolve({ data: [], error: null }) : listMyReportItems(me, r)), [me, r.from, r.to, invalid]);
  const tasks = useHrQuery(() => listMyTasks(me), [me]);
  const all = useMemo(() => derivePendingTasks(items.data ?? [], tasks.data ?? [], today), [items.data, tasks.data, today]);
  const projectOptions = useMemo(() => {
    const m = new Map();
    for (const p of all) if (p.project) m.set(p.project.id, `${p.project.code} · ${p.project.name}`);
    return [{ value: "none", label: "General / internal work" }, ...[...m].map(([value, label]) => ({ value, label }))];
  }, [all]);
  const rows = all.filter((p) => (!project || (project === "none" ? !p.project : p.project?.id === project))
    && (!status || p.work_status === status) && (!overdueOnly || p.overdue));
  const count = (f) => all.filter(f).length;
  const loading = items.loading || tasks.loading;
  const pick = (s, o = false) => { setStatus(s); setOverdueOnly(o); };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Pending tasks" value={all.length} icon={ListTodo} tone="navy" loading={loading} onClick={() => pick("")} />
        <KpiCard label="In progress" value={count((p) => p.work_status === "in_progress")} icon={CalendarClock} tone="teal" loading={loading} onClick={() => pick("in_progress")} />
        <KpiCard label="Blocked" value={count((p) => p.work_status === "blocked")} icon={AlertTriangle} tone="red" loading={loading} onClick={() => pick("blocked")} />
        <KpiCard label="Overdue" value={count((p) => p.overdue)} hint="Past the task due date" icon={AlertTriangle} tone="orange" loading={loading} onClick={() => pick("", true)} />
      </div>
      <Card title="Pending tasks" padded={false}>
        <div className="px-4 pt-4">
          <Toolbar>
            <RangeFields value={r} onChange={setR} max={today} />
            <Field label="Project" className="sm:w-56"><Select placeholder="All projects" value={project} onChange={(e) => setProject(e.target.value)} options={projectOptions} /></Field>
            <Field label="Status" className="sm:w-44"><Select placeholder="All open" value={status} onChange={(e) => setStatus(e.target.value)}
              options={WORK_STATUSES.filter((s) => s !== "completed").map((s) => ({ value: s, label: WORK_STATUS_LABEL[s] }))} /></Field>
            <div className="flex items-end pb-2"><Checkbox label="Overdue only" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /></div>
          </Toolbar>
          <p className="mb-3 text-xs text-slate-500">
            Tasks whose latest entry in your reports is not Completed, plus tasks assigned to you that you have not reported yet.
            Mark a task Completed in a daily report to clear it from this list.
          </p>
          {tasks.error && <div className="mb-3"><InlineError message={`Could not load your assigned tasks: ${tasks.error}`} /></div>}
        </div>
        <DataTable caption="Pending tasks" rows={rows} loading={loading} error={items.error} onRetry={() => { items.reload(); tasks.reload(); }} rowKey="key" pageSize={25}
          emptyTitle="No pending tasks" emptyDescription="Everything you reported in this period is completed."
          onRowClick={(p) => onOpen(p.last_date ?? today)}
          columns={[
            { key: "activity", header: "Task", sortable: true, render: (p) => (
              <span>
                <span className="font-semibold text-[#101a3a]">{p.activity}</span>
                <span className="block text-xs text-slate-500">{p.project ? `${p.project.code} · ${p.project.name}` : "General / internal"}{p.task && p.task.title !== p.activity ? ` · ${p.task.title}` : ""}</span>
                {p.source === "assigned" && <Badge tone="blue" className="mt-1">Assigned · not reported yet</Badge>}
              </span>) },
            { key: "work_status", header: "Status", sortable: true, render: (p) => <WorkStatusBadge status={p.work_status} /> },
            { key: "progress_pct", header: "Progress", sortable: true, sortValue: (p) => p.progress_pct ?? -1, render: (p) => (p.progress_pct == null ? "—" : (
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200" aria-hidden="true"><span className="block h-full bg-[#3089a6]" style={{ width: `${p.progress_pct}%` }} /></span>
                {p.progress_pct}%
              </span>)) },
            { key: "hours", header: "Hours so far", sortable: true, render: (p) => (p.hours ? <span>{hrs(p.hours)}<span className="block text-xs text-slate-500">{plural(p.days, "day")}</span></span> : "—") },
            { key: "last_date", header: "Last reported", sortable: true, sortValue: (p) => p.last_date ?? "", render: (p) => (p.last_date ? (
              <span>{formatDate(p.last_date)}{p.age_days > 0 && <span className="block text-xs text-slate-500">open {plural(p.age_days, "day")}</span>}</span>) : "—") },
            { key: "due_date", header: "Due", sortable: true, sortValue: (p) => p.due_date ?? "9999", render: (p) => (p.due_date ? (
              <span className={p.overdue ? "font-semibold text-red-600" : undefined}>{formatDate(p.due_date)}{p.overdue && <span className="block text-xs">Overdue</span>}</span>) : "—") },
            { key: "priority", header: "Priority", render: (p) => (p.priority ? <Badge tone={PRIORITY_TONE[p.priority] ?? "slate"}>{p.priority}</Badge> : "—") },
            { key: "_open", header: <span className="sr-only">Open</span>, render: (p) => (
              <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onOpen(p.source === "assigned" ? today : p.last_date); }}>
                {p.source === "assigned" ? "Report today" : "Open report"}
              </Button>) },
          ]} />
      </Card>
    </div>
  );
}

const FEEDBACK_FILTERS = [
  { value: "attention", label: "Needs my attention" },
  { value: "revision_requested", label: "Changes requested" },
  { value: "clarification", label: "Clarification requested" },
  { value: "reviewed", label: "Approved" },
  { value: "comment", label: "Comments" },
  { value: "under_review", label: "Marked under review" },
  { value: "reopened", label: "Reopened" },
];
const FEEDBACK_TONE = { revision_requested: "orange", clarification: "orange", reopened: "orange", reviewed: "green", under_review: "blue" };

function MyFeedback({ me, today, onOpen }) {
  const [r, setR] = useState({ from: addDays(today, -59), to: today });
  const [show, setShow] = useState("");
  const [mine, setMine] = useState(false);
  const invalid = !r.from || !r.to || r.to < r.from;
  const q = useHrQuery(() => (invalid ? Promise.resolve({ data: [], error: null }) : listMyFeedback(me, r)), [me, r.from, r.to, invalid]);
  const all = useMemo(() => q.data ?? [], [q.data]);
  const { changes, awaiting } = useMemo(() => feedbackAttention(all, me), [all, me]);
  const fromReviewers = all.filter((x) => x.actor_employee_id !== me);
  const rows = all
    .filter((x) => mine || x.actor_employee_id !== me)
    .filter((x) => !show || (show === "attention"
      ? (changes.has(x.report_id) || awaiting.has(x.report_id)) && x.actor_employee_id !== me
      : x.action === show))
    .reverse();

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Changes requested" value={changes.size} hint="Reports to update and resubmit" icon={MessageSquareWarning} tone="orange" loading={q.loading} onClick={() => setShow("revision_requested")} />
        <KpiCard label="Awaiting your reply" value={awaiting.size} hint="Clarifications asked" icon={MessageSquareReply} tone="red" loading={q.loading} onClick={() => setShow("clarification")} />
        <KpiCard label="Approved" value={new Set(fromReviewers.filter((x) => x.action === "reviewed").map((x) => x.report_id)).size} hint="Reports approved" icon={CheckCircle2} tone="green" loading={q.loading} onClick={() => setShow("reviewed")} />
        <KpiCard label="Reviewer comments" value={fromReviewers.filter((x) => x.comment).length} icon={MessageSquareReply} tone="navy" loading={q.loading} onClick={() => setShow("")} />
      </div>
      <Card title="Manager feedback" padded={false}>
        <div className="px-4 pt-4">
          <Toolbar>
            <RangeFields value={r} onChange={setR} max={today} />
            <Field label="Show" className="sm:w-56"><Select placeholder="All feedback" value={show} onChange={(e) => setShow(e.target.value)} options={FEEDBACK_FILTERS} /></Field>
            <div className="flex items-end pb-2"><Checkbox label="Include my replies" checked={mine} onChange={(e) => setMine(e.target.checked)} /></div>
          </Toolbar>
          <p className="mb-3 text-xs text-slate-500">Feedback on your reports for the dates above, newest first. Open a report to update it or reply to your reviewer.</p>
        </div>
        <DataTable caption="Manager feedback" rows={rows} loading={q.loading} error={q.error} onRetry={q.reload} pageSize={25}
          emptyTitle={show === "attention" ? "Nothing needs your attention" : "No feedback yet"}
          emptyDescription="Comments and review decisions from your manager appear here."
          onRowClick={(x) => onOpen(x.report.report_date)}
          columns={[
            { key: "created_at", header: "When", sortable: true, render: (x) => formatDateTime(x.created_at) },
            { key: "report_date", header: "Report", sortable: true, sortValue: (x) => x.report.report_date, render: (x) => (
              <span>{formatDate(x.report.report_date, { weekday: "short", day: "2-digit", month: "short" })}<span className="mt-1 block"><ReportStatusBadge status={x.report.status} /></span></span>) },
            { key: "actor", header: "From", render: (x) => (x.actor_employee_id === me ? <span className="text-slate-500">You</span> : x.actor ? fullName(x.actor) : "Someone") },
            { key: "action", header: "Type", render: (x) => <Badge tone={FEEDBACK_TONE[x.action] ?? "slate"}>{x.actor_employee_id === me && x.action === "comment" ? "Your reply" : REVIEW_ACTION_LABEL[x.action] ?? x.action}</Badge> },
            { key: "comment", header: "Feedback", render: (x) => (
              <span className="block max-w-md">
                <span className="whitespace-pre-wrap text-slate-700">{x.comment || <span className="text-slate-400">No comment</span>}</span>
                {awaiting.has(x.report_id) && x.action === "clarification" && x.actor_employee_id !== me && <span className="mt-1 block text-xs font-semibold text-red-600">Awaiting your reply</span>}
              </span>) },
            { key: "_open", header: <span className="sr-only">Open</span>, render: (x) => (
              <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onOpen(x.report.report_date); }}>
                {changes.has(x.report_id) ? "Update report" : awaiting.has(x.report_id) ? "Reply" : "Open report"}
              </Button>) },
          ]} />
      </Card>
    </div>
  );
}
