// Daily Work Reports (HR / managers): review queue with approve / request
// changes / reopen, overview KPIs, blocker tracker, hours (project / employee
// / period) with attendance comparison, compliance (missing reports +
// reminders), recurring blocker notes, CSV export, project allocation and
// tasks. Scope (all vs reporting line) is enforced by RLS / RPCs.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, BellRing, CheckCircle2, ClipboardCheck, Clock, Download, FileWarning, Hourglass, RotateCcw, Send } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { exportCsv, formatDate, formatDateTime, fullName, useHrQuery } from "@/lib/hr/client";
import { toOptions, useEmployeeOptions, useOrg } from "@/lib/hr/org";
import { addDays, businessToday, useBusinessTimezone } from "@/lib/hr/attendance";
import {
  REPORT_STATUSES, REVIEW_ACTIONS, REVIEW_ACTION_LABEL, generateReminders, getReport, listBlockers, listProjects, listReportBlockers, listReports,
  listReviews, missingReports, reopenReport, reportBlockers, reportStatusLabel, reviewReport, workOverview,
} from "@/lib/hr/dailyReports";
import {
  Badge, Button, Card, ConfirmDialog, DataTable, DescriptionList, ErrorState, Field, InlineError, Input, KpiCard, Loading, Modal, PageHeader,
  SearchInput, Select, StatusBadge, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";
import ProjectsSettings, { TasksManager } from "@/hr/settings/ProjectsSettings";
import {
  AttendanceComparison, BlockerTable, HoursSummary, RangeFields, ReportStatusBadge, TaskBreakdown, VersionHistory, hrs,
} from "@/hr/components/DailyWorkParts";

export default function DailyReportsPage() {
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const canSee = hasPermission("daily_reports.view") || hasPermission("daily_reports.view_team");
  const canReview = hasPermission("daily_reports.review") || hasPermission("daily_reports.review_team");
  const canManage = hasPermission("daily_reports.manage");
  const tabs = [
    ...(canSee || canReview ? [{ value: "reports", label: "Review queue" }] : []),
    ...(canSee ? [{ value: "overview", label: "Overview" }, { value: "blockers", label: "Blockers" }, { value: "hours", label: "Hours" },
      { value: "compliance", label: "Compliance" }, { value: "recurring", label: "Recurring blocker notes" }] : []),
    ...(canManage || hasPermission("daily_reports.review_team") ? [{ value: "projects", label: canManage ? "Projects & tasks" : "My projects" }] : []),
  ];
  const tab = tabs.some((t) => t.value === params.get("tab")) ? params.get("tab") : tabs[0]?.value;
  if (!tabs.length) return <ErrorState message="You do not have access to daily reports." />;
  return (
    <>
      <PageHeader title="Daily Work Reports" description="Review submitted reports, follow blockers and reported hours, and manage project allocation. Drafts are private to their authors." />
      <Tabs tabs={tabs} value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} label="Daily report sections" />
      {tab === "reports" && <ReportsList />}
      {tab === "overview" && <Overview onOpenTab={(v) => setParams({ tab: v }, { replace: true })} />}
      {tab === "blockers" && <BlockerTracker />}
      {tab === "hours" && <HoursTab />}
      {tab === "compliance" && <Compliance canManage={canManage} />}
      {tab === "recurring" && <Blockers />}
      {tab === "projects" && <div className="flex flex-col gap-4"><ProjectsSettings canEdit={canManage} /><TasksManager canEdit={canManage} /></div>}
    </>
  );
}

const STATUS_FILTERS = [
  { value: "pending", label: "Pending review" },
  ...REPORT_STATUSES.filter((s) => s !== "draft").map((s) => ({ value: s, label: reportStatusLabel(s) })),
];

function useFilterOptions() {
  const org = useOrg();
  const projects = useHrQuery(() => listProjects(), []);
  const employees = useEmployeeOptions();
  return {
    org, projects, employees,
    deptOptions: toOptions(org.data?.departments, "name", "id", { activeOnly: false }),
    projectOptions: (projects.data ?? []).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })),
    companyOptions: toOptions(org.data?.legal_entities ?? org.data?.legalEntities, "name", "id", { activeOnly: false }),
  };
}

function ReportsList() {
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const tz = useBusinessTimezone();
  const today = businessToday(tz);
  const { org, projects, employees, deptOptions, projectOptions } = useFilterOptions();
  const [f, setF] = useState({ from: addDays(today, -6), to: today, department: "", project: "", status: "", employee: "", manager: "", search: "" });
  const invalid = !f.from || !f.to || f.to < f.from;
  const statusArg = f.status === "pending" ? { statuses: ["submitted", "under_review"] } : { status: f.status };
  const q = useHrQuery(() => (invalid ? Promise.resolve({ data: [], error: null }) : listReports({ from: f.from, to: f.to, employee: f.employee, ...statusArg })),
    [f.from, f.to, f.status, f.employee, invalid]);
  const [open, setOpen] = useState(null);
  const projectName = (id) => projects.data?.find((p) => p.id === id)?.name ?? "";
  const deptName = (id) => org.data?.departments?.find((d) => d.id === id)?.name ?? "";
  const rows = useMemo(() => {
    const s = f.search.trim().toLowerCase();
    return (q.data ?? []).filter((r) => (!f.department || r.employee?.department_id === f.department)
      && (!f.manager || r.employee?.manager_id === f.manager)
      && (!f.project || (r.items ?? []).some((i) => i.project_id === f.project))
      && (!s || fullName(r.employee).toLowerCase().includes(s) || r.employee?.employee_code?.toLowerCase().includes(s)));
  }, [q.data, f.department, f.project, f.manager, f.search]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: typeof e === "string" ? e : e.target.value }));

  function doExport() {
    exportCsv(`daily-reports-${f.from}-to-${f.to}`, rows, [
      { label: "Date", key: "report_date" }, { label: "Employee ID", value: (r) => r.employee?.employee_code }, { label: "Employee", value: (r) => fullName(r.employee) },
      { label: "Department", value: (r) => deptName(r.employee?.department_id) }, { label: "Status", value: (r) => reportStatusLabel(r.status) }, { label: "Total hours", key: "total_hours" },
      { label: "Tasks", value: (r) => (r.items ?? []).length }, { label: "Completed tasks", value: (r) => (r.items ?? []).filter((i) => i.work_status === "completed").length },
      { label: "Projects", value: (r) => [...new Set((r.items ?? []).map((i) => projectName(i.project_id) || (i.project_id ? "" : "General")))].filter(Boolean).join("; ") },
      { label: "Summary", key: "summary" }, { label: "Pending work", key: "pending_work" }, { label: "Blocker notes", key: "blockers" },
      { label: "Support required", key: "support_required" }, { label: "Tomorrow plan", key: "tomorrow_plan" },
      { label: "Submitted at", key: "submitted_at" }, { label: "Reviewed at", key: "reviewed_at" },
    ]);
    notify(`Exported ${rows.length} reports.`);
  }

  return (
    <>
      <Toolbar>
        <Field label="From" className="sm:w-40"><Input type="date" value={f.from} max={today} onChange={set("from")} /></Field>
        <Field label="To" className="sm:w-40" error={invalid ? "Must be on or after From." : undefined}><Input type="date" value={f.to} max={today} onChange={set("to")} /></Field>
        <Field label="Status" className="sm:w-44"><Select placeholder="All submitted" value={f.status} onChange={set("status")} options={STATUS_FILTERS} /></Field>
        <Field label="Department" className="sm:w-44"><Select placeholder="All" value={f.department} onChange={set("department")} options={deptOptions} /></Field>
        <Field label="Project" className="sm:w-48"><Select placeholder="All" value={f.project} onChange={set("project")} options={projectOptions} /></Field>
      </Toolbar>
      <Toolbar>
        <Field label="Employee" className="sm:w-56"><Select placeholder="Anyone" value={f.employee} onChange={set("employee")} options={employees.data ?? []} /></Field>
        <Field label="Manager" className="sm:w-56"><Select placeholder="Any manager" value={f.manager} onChange={set("manager")} options={employees.data ?? []} /></Field>
        <SearchInput value={f.search} onChange={set("search")} placeholder="Search name or ID…" label="Search employees" />
        {hasPermission("daily_reports.export") && <Button variant="secondary" disabled={!rows.length} onClick={doExport}><Download className="h-4 w-4" aria-hidden="true" />Export CSV</Button>}
      </Toolbar>
      <DataTable caption="Daily reports" rows={rows} loading={q.loading} error={q.error} onRetry={q.reload} pageSize={50} onRowClick={(r) => setOpen(r.id)}
        emptyTitle="No submitted reports" emptyDescription="Nothing matches these filters."
        columns={[
          { key: "report_date", header: "Date", sortable: true, render: (r) => formatDate(r.report_date, { weekday: "short", day: "2-digit", month: "short" }) },
          { key: "employee", header: "Employee", sortable: true, sortValue: (r) => fullName(r.employee).toLowerCase(), render: (r) => (
            <div className="min-w-[10rem]"><p className="font-semibold text-[#101a3a]">{fullName(r.employee)}</p><p className="font-mono text-xs text-slate-500">{r.employee?.employee_code}</p></div>) },
          { key: "status", header: "Status", sortable: true, render: (r) => <ReportStatusBadge status={r.status} /> },
          { key: "total_hours", header: "Hours", sortable: true, sortValue: (r) => Number(r.total_hours), render: (r) => Number(r.total_hours).toFixed(2) },
          { key: "tasks", header: "Tasks", render: (r) => { const it = r.items ?? []; const done = it.filter((i) => i.work_status === "completed").length; const bl = it.filter((i) => i.work_status === "blocked").length;
            return <span className="whitespace-nowrap">{it.length} · {done} done{bl ? <Badge tone="red" className="ml-1">{bl} blocked</Badge> : null}</span>; } },
          { key: "projects", header: "Projects", render: (r) => <span className="line-clamp-2 max-w-xs">{[...new Set((r.items ?? []).map((i) => (i.project_id ? projectName(i.project_id) : "General")))].filter(Boolean).join(", ") || "—"}</span> },
          { key: "submitted_at", header: "Submitted", render: (r) => formatDateTime(r.submitted_at) },
        ]} />
      {open && <ReviewModal id={open} onClose={() => setOpen(null)} onChanged={q.reload} />}
    </>
  );
}

function ReviewModal({ id, onClose, onChanged }) {
  const { hr, hasPermission } = useAuth();
  const { notify } = useToast();
  const r = useHrQuery(() => getReport(id), [id]);
  const reviews = useHrQuery(() => listReviews(id), [id]);
  const blockers = useHrQuery(() => listReportBlockers(id), [id]);
  const [action, setAction] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const rep = r.data;
  const own = rep && rep.employee_id === hr?.employee?.id;
  const canReview = (hasPermission("daily_reports.review") || hasPermission("daily_reports.review_team")) && rep && !own;
  const allowed = !rep ? [] : ["submitted", "under_review"].includes(rep.status) ? REVIEW_ACTIONS : rep.status === "reviewed" ? REVIEW_ACTIONS.filter((a) => a.value === "comment") : [];
  const chosen = REVIEW_ACTIONS.find((a) => a.value === action);
  const reload = () => { r.reload(); reviews.reload(); blockers.reload(); onChanged(); };

  async function submit() {
    if (!chosen) { setError("Choose an action."); return; }
    if (chosen.needsComment && !comment.trim()) { setError("A comment is required for this action."); return; }
    if (comment.length > 4000) { setError("At most 4000 characters."); return; }
    setBusy(true); setError(null);
    const res = await reviewReport(id, action, comment);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify({ under_review: "Report marked under review.", reviewed: "Report approved (marked reviewed) and locked.", revision_requested: "Revision requested; the employee has been notified.",
      clarification: "Clarification requested; the employee has been notified.", comment: "Comment added." }[action] ?? "Saved.");
    setAction(""); setComment("");
    reload();
  }

  return (
    <Modal open onClose={onClose} size="lg" title={rep ? `${fullName(rep.employee)} · ${formatDate(rep.report_date)}` : "Daily report"}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {r.loading && !rep ? <Loading /> : r.error ? <ErrorState message={r.error} onRetry={r.reload} /> : !rep ? <ErrorState message="Report not found or not visible to you." /> : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm"><ReportStatusBadge status={rep.status} />
            <span className="text-slate-600">{Number(rep.total_hours).toFixed(2)} h · {(rep.items ?? []).length} task(s) · submitted {formatDateTime(rep.submitted_at)}</span>
            {rep.reviewed_at && <span className="text-xs text-slate-500">Last decision {formatDateTime(rep.reviewed_at)}</span>}</div>
          {rep.status === "reviewed" && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">Approved reports are locked. An authorised reviewer can reopen it with a reason.</p>}
          <section>
            <h3 className="mb-2 text-sm font-bold text-[#101a3a]">Tasks</h3>
            <TaskBreakdown items={rep.items} blockers={blockers.data ?? []} />
          </section>
          {(blockers.data ?? []).filter((b) => !b.item_id).length > 0 && (
            <section><h3 className="mb-2 text-sm font-bold text-[#101a3a]">Other blockers</h3>
              <ul className="flex flex-col gap-1 text-sm">{blockers.data.filter((b) => !b.item_id).map((b) => <li key={b.id}>• {b.title} <Badge tone="red">{b.severity}</Badge> <StatusBadge status={b.status} /></li>)}</ul></section>
          )}
          <DescriptionList items={[
            { label: "Summary", value: rep.summary && <span className="whitespace-pre-wrap">{rep.summary}</span> },
            { label: "Pending work", value: rep.pending_work && <span className="whitespace-pre-wrap">{rep.pending_work}</span> },
            { label: "Blocker notes", value: rep.blockers && <span className="whitespace-pre-wrap text-red-700">{rep.blockers}</span> },
            { label: "Support required", value: rep.support_required && <span className="whitespace-pre-wrap">{rep.support_required}</span> },
            { label: "Tomorrow's plan", value: rep.tomorrow_plan && <span className="whitespace-pre-wrap">{rep.tomorrow_plan}</span> },
          ]} />
          <section className="rounded-xl border border-slate-200 p-3">
            <h3 className="mb-2 text-sm font-bold text-[#101a3a]">Reported hours vs attendance</h3>
            <AttendanceComparison from={rep.report_date} to={rep.report_date} filters={{ employee: rep.employee_id }} showEmployee={false} />
          </section>
          <section>
            <h3 className="mb-2 text-sm font-bold text-[#101a3a]">Review history</h3>
            {reviews.loading && !reviews.data ? <Loading /> : reviews.error ? <ErrorState message={reviews.error} onRetry={reviews.reload} /> : (
              <ol className="flex flex-col gap-2">
                {(reviews.data ?? []).map((x) => (
                  <li key={x.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-[#173a52]">{x.actor ? fullName(x.actor) : "Someone"}</span>
                      <Badge tone={x.action === "reviewed" ? "green" : ["revision_requested", "clarification", "reopened"].includes(x.action) ? "orange" : "slate"}>{REVIEW_ACTION_LABEL[x.action] ?? x.action}</Badge>
                      <span>{formatDateTime(x.created_at)}</span>
                    </div>
                    {x.comment && <p className="mt-1 whitespace-pre-wrap text-slate-700">{x.comment}</p>}
                  </li>
                ))}
                {!reviews.data?.length && <li className="text-sm text-slate-500">No activity yet.</li>}
              </ol>
            )}
          </section>
          <section>
            <Button size="sm" variant="ghost" onClick={() => setShowVersions((s) => !s)} aria-expanded={showVersions}>{showVersions ? "Hide" : "Show"} submitted versions</Button>
            {showVersions && <div className="mt-2"><VersionHistory reportId={rep.id} /></div>}
          </section>
          {canReview && allowed.length > 0 && (
            <section className="rounded-xl border border-slate-200 p-3">
              <h3 className="mb-2 text-sm font-bold text-[#101a3a]">Review action</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[14rem_1fr]">
                <Field label="Action" required><Select placeholder="Choose…" value={action} onChange={(e) => setAction(e.target.value)} options={allowed.map((a) => ({ value: a.value, label: a.label }))} /></Field>
                <Field label={chosen?.needsComment ? "Comment" : "Comment (optional)"} required={chosen?.needsComment}><Textarea rows={2} maxLength={4000} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
              </div>
              <div className="mt-2"><InlineError message={error} /></div>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {rep.status === "reviewed" && <Button variant="secondary" onClick={() => setReopen(true)}><RotateCcw className="h-4 w-4" aria-hidden="true" />Reopen</Button>}
                <Button loading={busy} onClick={submit}>Apply</Button>
              </div>
            </section>
          )}
          {canReview && !allowed.length && <p className="text-xs text-slate-500">No review actions are available while the report is {reportStatusLabel(rep.status).toLowerCase()}.</p>}
          {own && <p className="text-xs text-slate-500">This is your own report; it must be reviewed by someone else.</p>}
          <ConfirmDialog open={reopen} onClose={() => setReopen(false)} title="Reopen approved report?" confirmLabel="Reopen" requireReason reasonLabel="Reason (sent to the employee)"
            message="The report returns to the employee as “changes requested” so they can correct and resubmit it. The approval stays in the history."
            onConfirm={async (reason) => {
              const res = await reopenReport(id, reason);
              if (res.error) return { error: res.error };
              notify("Report reopened; the employee has been notified.");
              reload();
              return {};
            }} />
        </div>
      )}
    </Modal>
  );
}

function Overview({ onOpenTab }) {
  const tz = useBusinessTimezone();
  const today = businessToday(tz);
  const { deptOptions, projectOptions, employees, companyOptions } = useFilterOptions();
  const [f, setF] = useState({ date: today, from: addDays(today, -6), to: today, department: "", project: "", manager: "", company: "" });
  const invalid = !f.from || !f.to || f.to < f.from || !f.date;
  const q = useHrQuery(() => (invalid ? Promise.resolve({ data: null, error: null }) : workOverview(f)), [JSON.stringify(f), invalid]);
  const k = q.data?.kpis ?? {};
  const [st, setSt] = useState("");
  const set = (key) => (e) => setF((s) => ({ ...s, [key]: e.target.value }));
  const rows = (q.data?.employee_status ?? []).filter((r) => !st || r.status === st);
  const loading = q.loading && !q.data;
  return (
    <>
      <Toolbar>
        <Field label="Day" className="sm:w-40"><Input type="date" value={f.date} max={today} onChange={set("date")} /></Field>
        <RangeFields value={f} onChange={(v) => setF((s) => ({ ...s, from: v.from, to: v.to }))} max={today} />
        <Field label="Department" className="sm:w-44"><Select placeholder="All" value={f.department} onChange={set("department")} options={deptOptions} /></Field>
        <Field label="Project" className="sm:w-48"><Select placeholder="All" value={f.project} onChange={set("project")} options={projectOptions} /></Field>
        <Field label="Manager" className="sm:w-52"><Select placeholder="Any" value={f.manager} onChange={set("manager")} options={employees.data ?? []} /></Field>
        {companyOptions.length > 1 && <Field label="Company" className="sm:w-48"><Select placeholder="All" value={f.company} onChange={set("company")} options={companyOptions} /></Field>}
      </Toolbar>
      {q.error && <ErrorState message={q.error} onRetry={q.reload} />}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={`Submitted ${f.date === today ? "today" : formatDate(f.date, { day: "2-digit", month: "short" })}`} value={k.submitted_today} icon={Send} tone="teal" loading={loading} />
        <KpiCard label="Pending submission" value={k.pending_submission} icon={FileWarning} tone="red" loading={loading} hint="Working day, not submitted" />
        <KpiCard label="Pending review" value={k.pending_review} icon={Hourglass} tone="orange" loading={loading} onClick={() => onOpenTab("reports")} hint="In the selected range" />
        <KpiCard label="Approved" value={k.approved} icon={CheckCircle2} tone="green" loading={loading} />
        <KpiCard label="Changes requested" value={k.changes_requested} icon={ClipboardCheck} tone="slate" loading={loading} />
        <KpiCard label="Active blockers" value={k.active_blockers} icon={AlertTriangle} tone="red" loading={loading} onClick={() => onOpenTab("blockers")} hint={k.critical_blockers ? `${k.critical_blockers} high / critical` : undefined} />
        <KpiCard label="Reported hours" value={k.reported_hours != null ? hrs(k.reported_hours) : undefined} icon={Clock} tone="navy" loading={loading} hint="Submitted reports in range" />
        {q.data?.attendance_comparison_available && <KpiCard label="Hour discrepancies" value={k.hours_discrepancies} icon={AlertTriangle} tone="orange" loading={loading} onClick={() => onOpenTab("hours")} hint="Reported vs attendance" />}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.4fr]">
        <Card title="Project-wise hours" padded={false}>
          <DataTable caption="Project-wise hours" rows={q.data?.project_hours} loading={loading} rowKey={(r) => r.project_id ?? "general"} emptyTitle="No reported hours"
            columns={[
              { key: "label", header: "Project" },
              { key: "employees", header: "People" },
              { key: "hours", header: "Hours", render: (r) => <span className="font-semibold">{hrs(r.hours)}</span> },
            ]} />
        </Card>
        <Card title={`Submission status · ${formatDate(f.date)}`} padded={false}
          actions={<Select aria-label="Filter submission status" value={st} onChange={(e) => setSt(e.target.value)} placeholder="Everyone"
            options={["not_submitted", "submitted", "under_review", "reviewed", "revision_requested", "not_due"].map((s) => ({ value: s, label: reportStatusLabel(s) }))} />}>
          <DataTable caption="Employee-wise submission status" rows={rows} loading={loading} rowKey="employee_id" pageSize={20} emptyTitle="No employees in scope"
            columns={[
              { key: "employee_name", header: "Employee", sortable: true, render: (r) => <span>{r.employee_name}<span className="block font-mono text-xs text-slate-500">{r.employee_code}</span></span> },
              { key: "status", header: "Status", sortable: true, render: (r) => <ReportStatusBadge status={r.status} /> },
              { key: "hours", header: "Hours", render: (r) => hrs(r.hours) },
              { key: "open_blockers", header: "Open blockers", render: (r) => (Number(r.open_blockers) ? <Badge tone="red">{r.open_blockers}</Badge> : "—") },
            ]} />
        </Card>
      </div>
    </>
  );
}

function BlockerTracker() {
  const { hr } = useAuth();
  const tz = useBusinessTimezone();
  const today = businessToday(tz);
  const { deptOptions, projectOptions, employees } = useFilterOptions();
  const [f, setF] = useState({ status: "active", from: addDays(today, -89), to: today, employee: "", project: "", department: "" });
  const q = useHrQuery(() => listBlockers(f), [JSON.stringify(f)]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <>
      <Toolbar>
        <Field label="Status" className="sm:w-40"><Select value={f.status} onChange={set("status")} placeholder="All"
          options={[{ value: "active", label: "Open + in progress" }, { value: "open", label: "Open" }, { value: "in_progress", label: "In progress" }, { value: "resolved", label: "Resolved" }]} /></Field>
        <RangeFields value={f} onChange={(v) => setF((s) => ({ ...s, from: v.from, to: v.to }))} max={today} />
        <Field label="Employee" className="sm:w-56"><Select placeholder="Anyone" value={f.employee} onChange={set("employee")} options={employees.data ?? []} /></Field>
        <Field label="Project" className="sm:w-48"><Select placeholder="Any" value={f.project} onChange={set("project")} options={projectOptions} /></Field>
        <Field label="Department" className="sm:w-44"><Select placeholder="All" value={f.department} onChange={set("department")} options={deptOptions} /></Field>
      </Toolbar>
      <p className="mb-3 text-xs text-slate-500">Reporting managers get an in-app notification when a blocker is raised. Assign a resolution owner and resolve with notes.</p>
      <BlockerTable query={q} me={hr?.employee?.id} caption="Blocker tracker" emptyTitle="No blockers" />
    </>
  );
}

function HoursTab() {
  const tz = useBusinessTimezone();
  const today = businessToday(tz);
  const { deptOptions, projectOptions, employees, companyOptions } = useFilterOptions();
  const [f, setF] = useState({ from: addDays(today, -29), to: today, employee: "", department: "", project: "", manager: "", company: "" });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const { from: fr, to, ...filters } = f;
  return (
    <>
      <Toolbar>
        <RangeFields value={f} onChange={(v) => setF((s) => ({ ...s, from: v.from, to: v.to }))} max={today} />
        <Field label="Employee" className="sm:w-56"><Select placeholder="Anyone" value={f.employee} onChange={set("employee")} options={employees.data ?? []} /></Field>
        <Field label="Department" className="sm:w-44"><Select placeholder="All" value={f.department} onChange={set("department")} options={deptOptions} /></Field>
        <Field label="Project" className="sm:w-48"><Select placeholder="All" value={f.project} onChange={set("project")} options={projectOptions} /></Field>
        <Field label="Manager" className="sm:w-52"><Select placeholder="Any" value={f.manager} onChange={set("manager")} options={employees.data ?? []} /></Field>
        {companyOptions.length > 1 && <Field label="Company" className="sm:w-48"><Select placeholder="All" value={f.company} onChange={set("company")} options={companyOptions} /></Field>}
      </Toolbar>
      <div className="flex flex-col gap-4">
        <Card title="Reported hours"><HoursSummary from={fr} to={to} filters={filters} /></Card>
        <Card title="Reported hours vs attendance">
          <AttendanceComparison from={fr} to={to} filters={{ employee: f.employee, department: f.department, manager: f.manager }} />
        </Card>
      </div>
    </>
  );
}

function Compliance({ canManage }) {
  const { notify } = useToast();
  const tz = useBusinessTimezone();
  const today = businessToday(tz);
  const org = useOrg();
  const [date, setDate] = useState(today);
  const q = useHrQuery(() => missingReports(date), [date]);
  const [confirm, setConfirm] = useState(false);
  const deptName = (id) => org.data?.departments?.find((d) => d.id === id)?.name ?? "—";
  return (
    <>
      <Toolbar>
        <Field label="Date" className="sm:w-44"><Input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
        <div className="flex-1" />
        {canManage && <Button variant="secondary" disabled={!q.data?.length} onClick={() => setConfirm(true)} className="self-end"><BellRing className="h-4 w-4" aria-hidden="true" />Send reminders</Button>}
      </Toolbar>
      <p className="mb-3 text-xs text-slate-500">Employees with portal access who have not submitted a report for a working day (holidays and approved leave are excluded by the server).</p>
      <DataTable caption="Missing daily reports" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} rowKey="employee_id"
        emptyTitle="Everyone has submitted" emptyDescription={`No missing reports for ${formatDate(date)}.`}
        columns={[
          { key: "employee_code", header: "ID", render: (r) => <span className="font-mono text-xs font-bold text-[#1f4693]">{r.employee_code}</span> },
          { key: "employee_name", header: "Employee", sortable: true },
          { key: "department_id", header: "Department", render: (r) => deptName(r.department_id) },
        ]} />
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Send reminders?" confirmLabel="Send reminders"
        message={`Each employee still missing a report for ${formatDate(date)} gets one in-app reminder (at most one per employee per date). Reminders are skipped if disabled in settings.`}
        onConfirm={async () => {
          const res = await generateReminders(date);
          if (res.error) return { error: res.error };
          notify(res.data ? `${res.data} reminder(s) sent.` : "No new reminders were needed (already reminded, or reminders are disabled).");
          return {};
        }} />
    </>
  );
}

// Free-text "blocker notes" on reports (pre-Module 8 field), by recurrence.
function Blockers() {
  const tz = useBusinessTimezone();
  const today = businessToday(tz);
  const employees = useEmployeeOptions();
  const projects = useHrQuery(() => listProjects(), []);
  const [f, setF] = useState({ from: addDays(today, -29), to: today, employee: "", project: "", minOcc: "1" });
  const invalid = !f.from || !f.to || f.to < f.from;
  const q = useHrQuery(() => (invalid ? Promise.resolve({ data: [], error: null }) : reportBlockers(f)), [f.from, f.to, f.employee, f.project, invalid]);
  const rows = useMemo(() => (q.data ?? []).filter((r) => Number(r.occurrences) >= Number(f.minOcc || 1))
    .sort((a, b) => Number(b.occurrences) - Number(a.occurrences) || (a.report_date < b.report_date ? 1 : -1)), [q.data, f.minOcc]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <>
      <Toolbar>
        <Field label="From" className="sm:w-40"><Input type="date" value={f.from} max={today} onChange={set("from")} /></Field>
        <Field label="To" className="sm:w-40" error={invalid ? "Must be on or after From." : undefined}><Input type="date" value={f.to} max={today} onChange={set("to")} /></Field>
        <Field label="Employee" className="sm:w-56"><Select placeholder="Anyone" value={f.employee} onChange={set("employee")} options={employees.data ?? []} /></Field>
        <Field label="Project" className="sm:w-48"><Select placeholder="Any project" value={f.project} onChange={set("project")} options={(projects.data ?? []).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} /></Field>
        <Field label="Min. occurrences" className="sm:w-36"><Select value={f.minOcc} onChange={set("minOcc")} options={["1", "2", "3", "5"].map((n) => ({ value: n, label: `${n}+` }))} /></Field>
      </Toolbar>
      <p className="mb-3 text-xs text-slate-500">Free-text blocker notes written on submitted reports. Structured blockers are tracked in the Blockers tab.</p>
      <DataTable caption="Reports with blocker notes" rows={rows} loading={q.loading} error={q.error} onRetry={q.reload} rowKey="report_id" pageSize={30}
        emptyTitle="No blocker notes" emptyDescription="No submitted report in this range has blocker notes."
        columns={[
          { key: "occurrences", header: "Times in range", render: (r) => <Badge tone={Number(r.occurrences) >= 3 ? "red" : "amber"}>{r.occurrences}</Badge> },
          { key: "employee_name", header: "Employee" },
          { key: "report_date", header: "Date", render: (r) => formatDate(r.report_date) },
          { key: "project_names", header: "Projects", render: (r) => r.project_names || "General" },
          { key: "blockers", header: "Blocker notes", render: (r) => <p className="max-w-md whitespace-pre-wrap text-slate-700">{r.blockers}</p> },
          { key: "support_required", header: "Support required", render: (r) => <p className="max-w-xs whitespace-pre-wrap">{r.support_required || "—"}</p> },
          { key: "status", header: "Status", render: (r) => <ReportStatusBadge status={r.status} /> },
        ]} />
    </>
  );
}
