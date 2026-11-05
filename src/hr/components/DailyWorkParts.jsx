// Shared Daily Work Reports UI pieces (HR / manager page and Employee Portal):
// status badges with business labels, task breakdown, version history,
// blocker list + triage, hours summary and attendance comparison panels.
// Every action is re-checked by the database (RPCs / RLS).
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { useEmployeeOptions } from "@/lib/hr/org";
import {
  BLOCKER_STATUSES, DISCREPANCY_LABEL, WORK_STATUS_LABEL, hoursSummary, hoursVsAttendance, listVersions, reportStatusLabel, updateBlocker,
} from "@/lib/hr/dailyReports";
import { Badge, Button, DataTable, Field, InlineError, Input, Loading, ErrorState, Modal, Select, Textarea, Toolbar, useToast } from "@/hr/ui";

const REPORT_TONE = { draft: "slate", submitted: "amber", under_review: "amber", reviewed: "green", revision_requested: "orange", not_submitted: "red", not_due: "slate" };
const WORK_TONE = { not_started: "slate", in_progress: "blue", completed: "green", blocked: "red" };
export const SEVERITY_TONE = { low: "slate", medium: "blue", high: "orange", critical: "red" };
const BLOCKER_TONE = { open: "red", in_progress: "amber", resolved: "green" };
const cap = (s) => String(s ?? "").replace(/_/g, " ");

export const ReportStatusBadge = ({ status }) => <Badge tone={REPORT_TONE[status] ?? "slate"}>{reportStatusLabel(status)}</Badge>;
export const WorkStatusBadge = ({ status }) => <Badge tone={WORK_TONE[status] ?? "slate"}>{WORK_STATUS_LABEL[status] ?? cap(status)}</Badge>;
export const SeverityBadge = ({ severity }) => <Badge tone={SEVERITY_TONE[severity] ?? "slate"}>{cap(severity)}</Badge>;
export const BlockerStatusBadge = ({ status }) => <Badge tone={BLOCKER_TONE[status] ?? "slate"}>{cap(status)}</Badge>;
export const hrs = (n) => (n == null ? "—" : Number(n).toFixed(2));

/** Read-only task list of a report (tasks, hours, completed work, links). */
export function TaskBreakdown({ items, blockers = [] }) {
  if (!items?.length) return <p className="text-sm text-slate-500">No tasks.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((i) => {
        const bl = blockers.filter((b) => b.item_id === i.id);
        return (
          <li key={i.id} className="rounded-xl border border-slate-200 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-[#101a3a]">{i.activity}</p>
                <p className="text-xs text-slate-500">{i.project ? `${i.project.code} · ${i.project.name}` : "General / internal"}{i.task ? ` · ${i.task.title}` : ""}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <WorkStatusBadge status={i.work_status} />
                <span className="font-semibold">{hrs(i.hours)} h</span>
                {i.progress_pct != null && <span className="text-xs text-slate-500">{i.progress_pct}%</span>}
              </div>
            </div>
            {i.description && <p className="mt-1 whitespace-pre-wrap text-slate-700">{i.description}</p>}
            {(i.completed_work || i.deliverables || i.completion_date) && (
              <div className="mt-2 rounded-lg bg-emerald-50/60 p-2 text-xs text-emerald-900">
                {i.completed_work && <p className="whitespace-pre-wrap"><span className="font-semibold">Completed: </span>{i.completed_work}</p>}
                {i.deliverables && <p className="whitespace-pre-wrap"><span className="font-semibold">Deliverables: </span>{i.deliverables}</p>}
                {i.completion_date && <p><span className="font-semibold">Completed on: </span>{formatDate(i.completion_date)}</p>}
              </div>
            )}
            {i.links?.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {i.links.map((l) => (
                  <li key={l}><a href={l} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-[16rem] items-center gap-1 truncate text-xs font-semibold text-[#1f4693] underline">
                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{l.replace(/^https?:\/\//, "")}</span></a></li>
                ))}
              </ul>
            )}
            {i.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600"><span className="font-semibold">Notes: </span>{i.notes}</p>}
            {bl.map((b) => (
              <p key={b.id} className="mt-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-900">
                <span className="font-semibold">Blocker: </span>{b.title} · <SeverityBadge severity={b.severity} /> <BlockerStatusBadge status={b.status} />
              </p>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

/** Immutable submission snapshots. */
export function VersionHistory({ reportId }) {
  const q = useHrQuery(() => listVersions(reportId), [reportId]);
  const [open, setOpen] = useState(null);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data?.length) return <p className="text-sm text-slate-500">No submitted versions yet.</p>;
  return (
    <ol className="flex flex-col gap-2">
      {q.data.map((v) => (
        <li key={v.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span><span className="font-semibold text-[#173a52]">Version {v.version}</span> · {hrs(v.total_hours)} h · {(v.snapshot?.items ?? []).length} task(s) · {formatDateTime(v.created_at)}</span>
            <Button size="sm" variant="ghost" onClick={() => setOpen(open === v.id ? null : v.id)} aria-expanded={open === v.id}>{open === v.id ? "Hide" : "Show"}</Button>
          </div>
          {open === v.id && (
            <ul className="mt-2 flex flex-col gap-1 text-xs text-slate-700">
              {(v.snapshot?.items ?? []).map((i) => <li key={i.id}>• {i.activity} — {WORK_STATUS_LABEL[i.work_status] ?? i.work_status}, {hrs(i.hours)} h{i.progress_pct != null ? `, ${i.progress_pct}%` : ""}</li>)}
              {v.snapshot?.summary && <li className="whitespace-pre-wrap"><span className="font-semibold">Summary: </span>{v.snapshot.summary}</li>}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Blocker table with a triage modal (status / owner / notes). */
export function BlockerTable({ query, me, caption = "Blockers", emptyTitle = "No blockers" }) {
  const [editing, setEditing] = useState(null);
  return (
    <>
      <DataTable caption={caption} rows={query.data} loading={query.loading} error={query.error} onRetry={query.reload} pageSize={25}
        emptyTitle={emptyTitle} emptyDescription="Nothing matches these filters." onRowClick={(r) => setEditing(r)}
        columns={[
          { key: "title", header: "Blocker", render: (r) => (
            <div className="min-w-[12rem] max-w-md"><p className="font-semibold text-[#101a3a]">{r.title}</p>
              {r.description && <p className="line-clamp-2 text-xs text-slate-600">{r.description}</p>}
              <p className="text-xs text-slate-500">{r.project_name || "General"}{r.task_title ? ` · ${r.task_title}` : ""}</p></div>) },
          { key: "severity", header: "Severity", sortable: true, sortValue: (r) => ["critical", "high", "medium", "low"].indexOf(r.severity), render: (r) => <SeverityBadge severity={r.severity} /> },
          { key: "status", header: "Status", render: (r) => <BlockerStatusBadge status={r.status} /> },
          { key: "employee_name", header: "Reported by", sortable: true, render: (r) => <span>{r.employee_name}<span className="block text-xs text-slate-500">{formatDate(r.reported_date)}</span></span> },
          { key: "owner_name", header: "Resolution owner", render: (r) => r.owner_name || "—" },
          { key: "age_days", header: "Age", sortable: true, sortValue: (r) => r.age_days, render: (r) => `${r.age_days} d` },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(r); }}>Update</Button> },
        ]} />
      {editing && <BlockerModal row={editing} me={me} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); query.reload(); }} />}
    </>
  );
}

function BlockerModal({ row, me, onClose, onSaved }) {
  const { notify } = useToast();
  const employees = useEmployeeOptions();
  const reporter = row.employee_id === me;
  const owner = row.owner_employee_id === me;
  const canTriage = row.can_triage;
  const [v, setV] = useState({ status: row.status, owner: row.owner_employee_id ?? "", notes: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const statusOptions = BLOCKER_STATUSES
    .filter((s) => row.status !== "resolved" ? true : s === "resolved" || (s === "open" && (reporter || canTriage)))
    .map((s) => ({ value: s, label: s === "open" && row.status === "resolved" ? "Reopen" : cap(s) }));
  const canAct = reporter || owner || canTriage;
  async function save() {
    if (v.status === "resolved" && row.status !== "resolved" && !v.notes.trim()) { setError("Resolution notes are required."); return; }
    if (v.notes.length > 4000) { setError("At most 4000 characters."); return; }
    setBusy(true); setError(null);
    const ownerChanged = canTriage && (v.owner || null) !== (row.owner_employee_id || null);
    const res = await updateBlocker(row.id, {
      status: v.status !== row.status ? v.status : null, notes: v.notes,
      owner: ownerChanged ? v.owner || null : null, clearOwner: ownerChanged && !v.owner,
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(v.status === "resolved" && row.status !== "resolved" ? "Blocker resolved." : "Blocker updated.");
    onSaved();
  }
  return (
    <Modal open onClose={onClose} title={row.title} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button>{canAct && <Button loading={busy} onClick={save}>Save</Button>}</>}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2"><SeverityBadge severity={row.severity} /><BlockerStatusBadge status={row.status} />
          <span className="text-slate-500">Reported by {row.employee_name} on {formatDate(row.reported_date)} · {row.project_name || "General"}{row.task_title ? ` · ${row.task_title}` : ""}</span></div>
        {row.description && <p className="whitespace-pre-wrap text-slate-700">{row.description}</p>}
        {row.resolution_notes && <p className="whitespace-pre-wrap rounded-lg bg-emerald-50 p-2 text-emerald-900"><span className="font-semibold">Resolution: </span>{row.resolution_notes}{row.resolved_date ? ` (${formatDate(row.resolved_date)})` : ""}</p>}
        {canAct ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Status"><Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })} options={statusOptions} /></Field>
            <Field label="Resolution owner" hint={canTriage ? undefined : "Assigned by the manager or HR."}>
              <Select placeholder="Unassigned" disabled={!canTriage} value={v.owner} onChange={(e) => setV({ ...v, owner: e.target.value })} options={employees.data ?? []} />
            </Field>
            <Field label={v.status === "resolved" && row.status !== "resolved" ? "Resolution notes" : "Notes"} required={v.status === "resolved" && row.status !== "resolved"} className="sm:col-span-2">
              <Textarea rows={3} maxLength={4000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
            </Field>
          </div>
        ) : <p className="text-xs text-slate-500">You can view this blocker but not update it.</p>}
        <InlineError message={error || employees.error} />
      </div>
    </Modal>
  );
}

const GROUPS = [
  { value: "employee", label: "By employee" }, { value: "project", label: "By project" }, { value: "employee_project", label: "Employee × project" },
  { value: "day", label: "By day" }, { value: "week", label: "By week" }, { value: "month", label: "By month" },
];

/** Reported hours summary; filters come from the parent. */
export function HoursSummary({ from, to, filters = {}, defaultGroup = "employee", groups = GROUPS }) {
  const [group, setGroup] = useState(defaultGroup);
  const invalid = !from || !to || to < from;
  const q = useHrQuery(() => (invalid ? Promise.resolve({ data: [], error: null }) : hoursSummary({ from, to, group, ...filters })),
    [from, to, group, invalid, JSON.stringify(filters)]);
  const total = useMemo(() => (q.data ?? []).reduce((s, r) => s + Number(r.hours || 0), 0), [q.data]);
  const periodFmt = group === "month" ? { month: "short", year: "numeric" } : { day: "2-digit", month: "short", year: "numeric" };
  const cols = [
    ...(["day", "week", "month"].includes(group) ? [{ key: "period_start", header: group === "week" ? "Week of" : group === "month" ? "Month" : "Date", render: (r) => formatDate(r.period_start, periodFmt) }] : []),
    ...(["employee", "employee_project"].includes(group) ? [{ key: "employee_name", header: "Employee", sortable: true, render: (r) => <span>{r.employee_name}<span className="block font-mono text-xs text-slate-500">{r.employee_code}</span></span> }] : []),
    ...(["project", "employee_project"].includes(group) ? [{ key: "project_label", header: "Project", sortable: true }] : []),
    { key: "reports", header: "Reports", sortable: true, sortValue: (r) => Number(r.reports) },
    { key: "tasks", header: "Tasks", render: (r) => `${r.tasks} (${r.completed_tasks} done)` },
    { key: "hours", header: "Reported hours", sortable: true, sortValue: (r) => Number(r.hours), render: (r) => <span className="font-semibold">{hrs(r.hours)}</span> },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Field label="Group" className="sm:w-52"><Select value={group} onChange={(e) => setGroup(e.target.value)} options={groups} /></Field>
        <p className="text-sm font-semibold text-[#101a3a]" aria-live="polite">Total reported: {hrs(total)} h</p>
      </div>
      <DataTable caption="Reported hours" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} pageSize={25}
        rowKey={(r) => `${r.period_start ?? ""}-${r.employee_id ?? ""}-${r.project_id ?? "g"}`}
        emptyTitle="No reported hours" emptyDescription="Only submitted reports count (drafts are excluded)." columns={cols} />
      <p className="text-xs text-slate-500">Reported task hours are self-reported work hours. They are not attendance and are not used for payroll.</p>
    </div>
  );
}

/** Reported hours vs attendance (read-only comparison). */
export function AttendanceComparison({ from, to, filters = {}, showEmployee = true }) {
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  const invalid = !from || !to || to < from;
  const q = useHrQuery(() => (invalid ? Promise.resolve({ data: [], error: null }) : hoursVsAttendance({ from, to, onlyFlagged, ...filters })),
    [from, to, onlyFlagged, invalid, JSON.stringify(filters)]);
  return (
    <div className="flex flex-col gap-2">
      <Toolbar>
        <Field label="Show" className="sm:w-56"><Select value={onlyFlagged ? "flagged" : "all"} onChange={(e) => setOnlyFlagged(e.target.value === "flagged")}
          options={[{ value: "flagged", label: "Discrepancies only" }, { value: "all", label: "All days" }]} /></Field>
      </Toolbar>
      <DataTable caption="Reported hours vs attendance" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} pageSize={25}
        rowKey={(r) => `${r.employee_id}-${r.work_date}`} emptyTitle={onlyFlagged ? "No discrepancies" : "No data"}
        emptyDescription="Compares submitted reports with attendance records you are allowed to see."
        columns={[
          { key: "work_date", header: "Date", sortable: true, render: (r) => formatDate(r.work_date, { weekday: "short", day: "2-digit", month: "short" }) },
          ...(showEmployee ? [{ key: "employee_name", header: "Employee", sortable: true }] : []),
          { key: "reported_hours", header: "Reported", render: (r) => (r.report_id ? `${hrs(r.reported_hours)} h` : "—") },
          { key: "attended_hours", header: "Attendance", render: (r) => (r.attendance_status ? `${hrs(r.attended_hours)} h · ${cap(r.attendance_status)}` : "No record") },
          { key: "variance_hours", header: "Difference", render: (r) => (r.variance_hours == null ? "—" : `${Number(r.variance_hours) > 0 ? "+" : ""}${hrs(r.variance_hours)} h`) },
          { key: "flag", header: "Flag", render: (r) => (r.flag ? <Badge tone="orange">{DISCREPANCY_LABEL[r.flag] ?? cap(r.flag)}</Badge> : <Badge tone="green">OK</Badge>) },
        ]} />
      <p className="text-xs text-slate-500">For review only: attendance punches are never changed from here. Corrections go through Attendance.</p>
    </div>
  );
}

/** Small date-range filter used by several panels. */
export function RangeFields({ value, onChange, max }) {
  const invalid = !value.from || !value.to || value.to < value.from;
  return (
    <>
      <Field label="From" className="sm:w-40"><Input type="date" value={value.from} max={max} onChange={(e) => onChange({ ...value, from: e.target.value })} /></Field>
      <Field label="To" className="sm:w-40" error={invalid ? "Must be on or after From." : undefined}><Input type="date" value={value.to} max={max} onChange={(e) => onChange({ ...value, to: e.target.value })} /></Field>
    </>
  );
}
