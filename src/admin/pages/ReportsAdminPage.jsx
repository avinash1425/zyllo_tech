import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  FileText,
  Filter,
  Hourglass,
  Inbox,
  ListChecks,
  RotateCcw,
  Users,
} from "lucide-react";
import PageHeader from "../PageHeader";
import { downloadCsv, getReports, reviewReport } from "@/lib/api/admin/reportsNotifications";
import { REPORT_STATUS } from "@/lib/api/employee/reports";
import { dayName, formatDate, formatDateTime, formatHours, minusDays, todayIst } from "@/employee/attendanceFormat";
import { Alert, Avatar, Badge, Chips, Empty, MetricStrip, Panel, TableCard, Tabs } from "@/components/portal/PortalUI";
import {
  BTN_DANGER_SOFT,
  BTN_DANGER,
  BTN_NAVY,
  BTN_SECONDARY,
  INPUT,
  INPUT_INLINE,
  LABEL,
  TABLE,
  TABLE_WRAP,
  TD,
  TH,
  TR,
} from "@/components/portal/portalStyles";

const TABS = [
  { key: "reports", label: "Reports", icon: FileText },
  { key: "pending", label: "Pending", icon: Hourglass },
  { key: "employees", label: "By employee", icon: Users },
  { key: "projects", label: "By project", icon: BarChart3 },
];
const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "submitted", label: "Awaiting review" },
  { key: "reviewed", label: "Reviewed" },
  { key: "returned", label: "Sent back" },
  { key: "draft", label: "Drafts" },
];
const STATUS_TONE = { draft: "slate", submitted: "sky", reviewed: "green", returned: "amber" };
const h = (n) => `${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })} h`;
const isSubmitted = (r) => r.status === "submitted" || r.status === "reviewed";

function startOfWeek(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
  return minusDays(iso, dow);
}

function StatusChip({ status }) {
  const s = REPORT_STATUS[status];
  if (!s) return null;
  return (
    <Badge tone={STATUS_TONE[status] ?? "slate"} dot>
      {s.label}
    </Badge>
  );
}

function Block({ label, text }) {
  if (!text) return null;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#9aa0ad]">{label}</p>
      <p className="mt-0.5 whitespace-pre-line break-words text-sm text-[#2b303b]">{text}</p>
    </div>
  );
}

// ---------------------------------------------------------------- one report
function ReportCard({ r, onChanged }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null); // null | "reviewed" | "returned"
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (mode === "returned" && !comment.trim()) return setError("Write what needs to change.");
    setBusy(true);
    setError("");
    const res = await reviewReport(r.id, mode, comment);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setMode(null);
    onChanged(res.report);
  }

  return (
    <li className={`transition-colors ${open ? "bg-[#fafbff]" : "hover:bg-[#f8faff]"}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-3 px-5 py-3.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#1f4693]"
      >
        <Avatar name={r.employee?.full_name} size="h-9 w-9 text-xs" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[#101a3a]">
            {r.employee?.full_name} · {formatDate(r.report_date)}{" "}
            <span className="font-normal text-[#9aa0ad]">{dayName(r.report_date, "short")}</span>
          </span>
          <span className="block truncate text-xs text-[#676b7a]">{r.items.map((i) => i.project_name).join(", ") || "No projects"}</span>
        </span>
        <span className="hidden text-right text-xs sm:block">
          <span className="block font-bold tabular-nums text-[#101a3a]">{h(r.total_hours)}</span>
          {r.worked_minutes != null && <span className="block text-[#9aa0ad]">at work {formatHours(r.worked_minutes)}</span>}
        </span>
        <StatusChip status={r.status} />
        <ChevronDown size={16} className={`shrink-0 text-[#9aa0ad] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="flex flex-col gap-3 px-5 pb-5">
          <p className="text-xs text-[#676b7a] sm:hidden">
            <span className="font-bold text-[#101a3a]">{h(r.total_hours)}</span>
            {r.worked_minutes != null && <> · at work {formatHours(r.worked_minutes)}</>}
          </p>
          {r.items.map((i) => (
            <div key={i.project_id} className="rounded-xl border border-[#e7e9ee] bg-white p-4 shadow-[0_1px_2px_rgba(16,26,58,0.04)]">
              <p className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-[#101a3a]">
                {i.project_name}
                <span className="font-mono text-[11px] font-normal text-[#9aa0ad]">{i.project_code}</span>
                <Badge tone="blue" className="ml-auto">
                  <Clock size={11} aria-hidden="true" /> {h(i.hours)}
                </Badge>
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Block label="Task updates" text={i.task_updates} />
                <Block label="Completed" text={i.completed_work} />
                <Block label="Pending" text={i.pending_work} />
              </div>
            </div>
          ))}
          {r.notes && (
            <div className="rounded-xl border border-[#e7e9ee] bg-white p-4">
              <Block label="Notes / blockers" text={r.notes} />
            </div>
          )}
          {(r.submitted_at || r.submitted_to) && (
            <div className="text-xs text-[#676b7a]">
              {r.submitted_at && <>Submitted {formatDateTime(r.submitted_at)}</>}
              {r.submitted_to && <> · to {r.submitted_to.full_name}</>}
            </div>
          )}
          {(r.status === "reviewed" || r.status === "returned") && (
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                r.status === "returned" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"
              }`}
            >
              <p className="font-semibold">
                {r.status === "returned" ? "Sent back" : "Reviewed"}
                {r.reviewed_by?.full_name && ` by ${r.reviewed_by.full_name}`}
                {r.reviewed_at && ` · ${formatDateTime(r.reviewed_at)}`}
              </p>
              {r.review_comment && <p className="mt-0.5 whitespace-pre-line">{r.review_comment}</p>}
            </div>
          )}
          {r.status === "submitted" &&
            (mode ? (
              <div className="flex flex-col gap-2 rounded-xl border border-[#dce6f7] bg-[#f8faff] p-4 sm:flex-row sm:items-end">
                <label className="flex-1">
                  <span className={LABEL}>{mode === "returned" ? "What needs to change (the employee sees this)" : "Feedback (optional)"}</span>
                  <input value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} className={INPUT(false)} />
                </label>
                <button type="button" disabled={busy} onClick={save} className={mode === "returned" ? BTN_DANGER : BTN_NAVY}>
                  {busy ? "Saving…" : mode === "returned" ? "Send back" : "Mark reviewed"}
                </button>
                <button type="button" disabled={busy} onClick={() => setMode(null)} className={BTN_SECONDARY}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setMode("reviewed")} className={BTN_NAVY}>
                  <CheckCircle2 size={15} aria-hidden="true" /> Mark reviewed
                </button>
                <button type="button" onClick={() => setMode("returned")} className={BTN_DANGER_SOFT}>
                  <RotateCcw size={15} aria-hidden="true" /> Send back
                </button>
              </div>
            ))}
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- summaries
function useSummaries(reports, missing) {
  return useMemo(() => {
    const emp = new Map();
    const proj = new Map();
    const empRow = (e) => {
      if (!emp.has(e.id)) {
        emp.set(e.id, { employee: e, submitted: 0, reviewed: 0, returned: 0, draft: 0, missing: 0, hours: 0, projects: new Set() });
      }
      return emp.get(e.id);
    };
    for (const r of reports) {
      const x = empRow(r.employee);
      x[r.status] += 1;
      if (isSubmitted(r)) {
        x.hours += Number(r.total_hours);
        for (const i of r.items) {
          x.projects.add(i.project_name);
          if (!proj.has(i.project_id)) {
            proj.set(i.project_id, { id: i.project_id, name: i.project_name, code: i.project_code, hours: 0, reports: 0, people: new Map() });
          }
          const p = proj.get(i.project_id);
          p.hours += Number(i.hours);
          p.reports += 1;
          p.people.set(r.employee.full_name, (p.people.get(r.employee.full_name) ?? 0) + Number(i.hours));
        }
      }
    }
    for (const m of missing) empRow(m.employee).missing += 1;
    return {
      employees: [...emp.values()].sort((a, b) => b.hours - a.hours),
      projects: [...proj.values()].sort((a, b) => b.hours - a.hours),
    };
  }, [reports, missing]);
}

function EmployeeSummary({ rows }) {
  if (!rows.length) return <Empty icon={Users} title="No reports in this period" />;
  return (
    <>
      <div className={TABLE_WRAP}>
        <table className={`${TABLE} min-w-[760px]`}>
          <thead>
            <tr>
              <th className={TH}>Employee</th>
              <th className={TH}>Submitted</th>
              <th className={TH}>Reviewed</th>
              <th className={TH}>Sent back</th>
              <th className={TH}>Pending</th>
              <th className={TH}>Hours</th>
              <th className={TH}>Projects</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.employee.id} className={TR}>
                <td className={TD}>
                  <span className="flex items-center gap-2.5">
                    <Avatar name={x.employee.full_name} size="h-8 w-8 text-xs" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-[#101a3a]">{x.employee.full_name}</span>
                      <span className="font-mono text-[11px] text-[#9aa0ad]">{x.employee.employee_code}</span>
                    </span>
                  </span>
                </td>
                <td className={`${TD} tabular-nums font-semibold text-[#101a3a]`}>{x.submitted + x.reviewed}</td>
                <td className={`${TD} tabular-nums text-emerald-700`}>{x.reviewed}</td>
                <td className={`${TD} tabular-nums text-amber-700`}>{x.returned}</td>
                <td className={TD}>
                  {x.missing ? (
                    <Badge tone="red">{x.missing}</Badge>
                  ) : (
                    <span className="tabular-nums">0</span>
                  )}
                </td>
                <td className={`${TD} whitespace-nowrap font-bold tabular-nums text-[#101a3a]`}>{h(x.hours)}</td>
                <td className={`${TD} text-xs text-[#676b7a]`}>{[...x.projects].join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-[#eef1f7] px-5 py-3 text-xs text-[#9aa0ad]">
        Submitted = submitted + reviewed. Pending = days worked without a submitted report (drafts and sent-back included).
      </p>
    </>
  );
}

function ProjectSummary({ rows }) {
  if (!rows.length) return <Empty icon={BarChart3} title="No submitted reports in this period" />;
  const max = Math.max(...rows.map((p) => p.hours), 1);
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((p) => (
        <li key={p.id} className="rounded-xl border border-[#eef1f7] bg-[#fafbff] p-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-semibold text-[#101a3a]">{p.name}</span>
            <span className="font-mono text-[11px] text-[#9aa0ad]">{p.code}</span>
            <span className="ml-auto text-sm font-bold tabular-nums text-[#101a3a]">{h(p.hours)}</span>
            <span className="text-xs text-[#676b7a]">{p.reports} report entries</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eef0f5]">
            <div className="h-full rounded-full bg-gradient-to-r from-[#f7941e] to-[#1f4693]" style={{ width: `${(p.hours / max) * 100}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[...p.people.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([n, hrs]) => (
                <span key={n} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-[#4a5068] ring-1 ring-inset ring-[#e3e9f5]">
                  {n} <span className="font-semibold tabular-nums text-[#1f4693]">{h(hrs)}</span>
                </span>
              ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Admin: Daily Work Reports — submitted and pending reports, employee-wise and
 * project-wise summaries, work descriptions, hours and manager feedback;
 * filter by date and export CSV. Migration 243.
 */
export default function ReportsAdminPage() {
  const today = useMemo(() => todayIst(), []);
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "reports";
  const [range, setRange] = useState({ from: minusDays(today.iso, 6), to: today.iso });
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("all");
  const [empFilter, setEmpFilter] = useState("all");
  const [projFilter, setProjFilter] = useState("all");

  useEffect(() => {
    let active = true;
    getReports(range.from, range.to)
      .then((d) => {
        if (!active) return;
        setData(d);
        setError("");
      })
      .catch((e) => active && setError(/date range/i.test(e?.message ?? "") ? e.message : "Could not load reports."));
    return () => {
      active = false;
    };
  }, [range]);

  const reports = useMemo(() => data?.reports ?? [], [data]);
  const missing = useMemo(() => data?.missing ?? [], [data]);

  // Filters (employee / project) apply to every tab.
  const people = useMemo(() => {
    const m = new Map();
    for (const r of reports) m.set(r.employee.id, r.employee);
    for (const x of missing) m.set(x.employee.id, x.employee);
    return [...m.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [reports, missing]);
  const projects = useMemo(() => {
    const m = new Map();
    for (const r of reports) for (const i of r.items) m.set(i.project_id, i.project_name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [reports]);

  const filtered = useMemo(
    () =>
      reports
        .filter((r) => empFilter === "all" || r.employee.id === empFilter)
        .filter((r) => projFilter === "all" || r.items.some((i) => i.project_id === projFilter))
        .map((r) => (projFilter === "all" ? r : { ...r, items: r.items.filter((i) => i.project_id === projFilter) })),
    [reports, empFilter, projFilter],
  );
  const filteredMissing = useMemo(() => missing.filter((m) => empFilter === "all" || m.employee.id === empFilter), [missing, empFilter]);
  const shown = filtered.filter((r) => status === "all" || r.status === status);
  const summaries = useSummaries(filtered, filteredMissing);

  const onChanged = (updated) => setData((d) => ({ ...d, reports: d.reports.map((r) => (r.id === updated.id ? updated : r)) }));

  const presets = [
    { key: "today", label: "Today", from: today.iso, to: today.iso },
    { key: "yesterday", label: "Yesterday", from: minusDays(today.iso, 1), to: minusDays(today.iso, 1) },
    { key: "week", label: "This week", from: startOfWeek(today.iso), to: today.iso },
    { key: "7", label: "Last 7 days", from: minusDays(today.iso, 6), to: today.iso },
    { key: "month", label: "This month", from: `${today.iso.slice(0, 8)}01`, to: today.iso },
    { key: "30", label: "Last 30 days", from: minusDays(today.iso, 29), to: today.iso },
  ];
  const activePreset = presets.find((p) => p.from === range.from && p.to === range.to)?.key ?? "custom";
  const suffix = `${range.from}_to_${range.to}`;

  function exportReports() {
    const rows = [["Date", "Employee ID", "Employee", "Status", "Project", "Hours", "Task updates", "Completed work", "Pending work", "Notes", "Submitted to", "Reviewed by", "Feedback"]];
    for (const r of shown) {
      const base = (i) => [r.report_date, r.employee.employee_code, r.employee.full_name, REPORT_STATUS[r.status]?.label, i?.project_name ?? "", i ? Number(i.hours) : ""];
      const tail = [r.notes ?? "", r.submitted_to?.full_name ?? "", r.reviewed_by?.full_name ?? "", r.review_comment ?? ""];
      if (!r.items.length) rows.push([...base(null), "", "", "", ...tail]);
      for (const i of r.items) rows.push([...base(i), i.task_updates ?? "", i.completed_work ?? "", i.pending_work ?? "", ...tail]);
    }
    downloadCsv(`daily-reports_${suffix}.csv`, rows);
  }
  function exportEmployees() {
    downloadCsv(`daily-reports-by-employee_${suffix}.csv`, [
      ["Employee ID", "Employee", "Submitted", "Reviewed", "Sent back", "Pending days", "Hours", "Projects"],
      ...summaries.employees.map((x) => [x.employee.employee_code, x.employee.full_name, x.submitted + x.reviewed, x.reviewed, x.returned, x.missing, x.hours, [...x.projects].join("; ")]),
    ]);
  }
  function exportProjects() {
    downloadCsv(`daily-reports-by-project_${suffix}.csv`, [
      ["Project ID", "Project", "Hours", "Report entries", "Hours by employee"],
      ...summaries.projects.map((p) => [p.code, p.name, p.hours, p.reports, [...p.people.entries()].map(([n, x]) => `${n}: ${x}`).join("; ")]),
    ]);
  }
  function exportPending() {
    downloadCsv(`daily-reports-pending_${suffix}.csv`, [
      ["Date", "Employee ID", "Employee", "Report status"],
      ...filteredMissing.map((m) => [m.date, m.employee.employee_code, m.employee.full_name, m.status === "not_started" ? "Not started" : REPORT_STATUS[m.status]?.label]),
    ]);
  }
  const exporter = { reports: exportReports, pending: exportPending, employees: exportEmployees, projects: exportProjects }[tab];

  const totalHours = filtered.filter(isSubmitted).reduce((s, r) => s + Number(r.total_hours), 0);
  const counts = {
    submitted: filtered.filter((r) => r.status === "submitted").length,
    reviewed: filtered.filter((r) => r.status === "reviewed").length,
    returned: filtered.filter((r) => r.status === "returned").length,
  };
  const loading = <p className="p-5 text-sm text-[#676b7a]">Loading reports…</p>;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Daily Work Reports"
        icon={FileText}
        subtitle="Submitted and pending reports, employee-wise and project-wise summaries, work done, hours spent and manager feedback. Filter by date and export to CSV (opens in Excel)."
        actions={
          <button type="button" onClick={exporter} disabled={!data} className={BTN_SECONDARY}>
            <Download size={15} aria-hidden="true" /> Export {TABS.find((t) => t.key === tab).label.toLowerCase()} (CSV)
          </button>
        }
      />

      <Panel icon={Filter} title="Filters" subtitle="Dates, employee and project apply to every view.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <p className={LABEL}>Dates</p>
              <Chips
                items={[...presets.map((p) => ({ key: p.key, label: p.label })), { key: "custom", label: "Custom" }]}
                value={activePreset}
                onChange={(k) => {
                  const p = presets.find((x) => x.key === k);
                  if (p) setRange({ from: p.from, to: p.to });
                }}
                label="Date range"
              />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label>
                <span className={LABEL}>From</span>
                <input
                  type="date"
                  value={range.from}
                  max={range.to}
                  onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))}
                  className={`${INPUT_INLINE(false)} block w-40 py-2`}
                />
              </label>
              <label>
                <span className={LABEL}>To</span>
                <input
                  type="date"
                  value={range.to}
                  min={range.from}
                  max={today.iso}
                  onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))}
                  className={`${INPUT_INLINE(false)} block w-40 py-2`}
                />
              </label>
            </div>
          </div>
          {people.length > 0 && (
            <div>
              <p className={LABEL}>Employee</p>
              <Chips items={[{ key: "all", label: "Everyone" }, ...people.map((p) => ({ key: p.id, label: p.full_name }))]} value={empFilter} onChange={setEmpFilter} label="Employee" />
            </div>
          )}
          {projects.length > 0 && (
            <div>
              <p className={LABEL}>Project</p>
              <Chips
                items={[{ key: "all", label: "All projects" }, ...projects.map(([id, name]) => ({ key: id, label: name }))]}
                value={projFilter}
                onChange={setProjFilter}
                label="Project"
              />
            </div>
          )}
        </div>
      </Panel>

      <Alert kind="err">{error}</Alert>

      {data && (
        <MetricStrip
          items={[
            { key: "submitted", label: "Awaiting review", value: counts.submitted, icon: Inbox, valueColor: "#0369a1" },
            { key: "reviewed", label: "Reviewed", value: counts.reviewed, icon: CheckCircle2, valueColor: "#047857" },
            { key: "returned", label: "Sent back", value: counts.returned, icon: RotateCcw, valueColor: "#b45309" },
            { key: "missing", label: "Pending (not submitted)", value: filteredMissing.length, icon: Hourglass, valueColor: "#dc2626" },
            { key: "hours", label: "Hours reported", value: h(totalHours), icon: Clock, valueColor: "#1f4693" },
          ]}
        />
      )}

      <Tabs
        label="Report views"
        items={TABS.map((t) => (t.key === "pending" && filteredMissing.length > 0 ? { ...t, count: filteredMissing.length, alert: true } : t))}
        value={tab}
        onChange={(k) => setParams(k === "reports" ? {} : { tab: k }, { replace: true })}
      />

      {tab === "pending" ? (
        <TableCard title="Pending reports" count={data ? filteredMissing.length : null}>
          <p className="border-b border-[#eef1f7] px-5 py-3 text-xs text-[#676b7a]">
            Days an employee worked (punched in) on a project team but has not submitted a report: not started, draft, or sent back.
            Reminders go out automatically — see Notifications Management.
          </p>
          {!data ? (
            !error && loading
          ) : filteredMissing.length === 0 ? (
            <Empty icon={CheckCircle2} title="Nothing pending 🎉" message="Every worked day in this period has a submitted report." />
          ) : (
            <div className={TABLE_WRAP}>
              <table className={`${TABLE} min-w-[520px]`}>
                <thead>
                  <tr>
                    <th className={TH}>Date</th>
                    <th className={TH}>Employee</th>
                    <th className={TH}>Report status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMissing.map((m) => (
                    <tr key={`${m.employee.id}|${m.date}`} className={TR}>
                      <td className={`${TD} whitespace-nowrap`}>
                        <span className="font-semibold text-[#101a3a]">{formatDate(m.date)}</span>{" "}
                        <span className="text-xs text-[#9aa0ad]">{dayName(m.date, "short")}</span>
                      </td>
                      <td className={TD}>
                        <span className="flex items-center gap-2.5">
                          <Avatar name={m.employee.full_name} size="h-7 w-7 text-[10px]" />
                          <span className="font-semibold text-[#101a3a]">{m.employee.full_name}</span>
                        </span>
                      </td>
                      <td className={TD}>
                        <span className="flex flex-wrap items-center gap-2">
                          {m.status === "not_started" ? (
                            <Badge tone="red" dot>
                              Not started
                            </Badge>
                          ) : (
                            <StatusChip status={m.status} />
                          )}
                          {m.date === today.iso && <span className="text-xs text-[#9aa0ad]">today — still time</span>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TableCard>
      ) : tab === "employees" ? (
        <TableCard title="Employee-wise summary" count={data ? summaries.employees.length : null}>
          {!data ? !error && loading : <EmployeeSummary rows={summaries.employees} />}
        </TableCard>
      ) : tab === "projects" ? (
        <Panel icon={BarChart3} title="Project-wise summary" subtitle="Hours from submitted and reviewed reports.">
          {!data ? !error && <p className="text-sm text-[#676b7a]">Loading reports…</p> : <ProjectSummary rows={summaries.projects} />}
        </Panel>
      ) : (
        <TableCard
          title="Reports"
          count={data ? shown.length : null}
          total={data ? filtered.length : null}
          filters={
            <Chips
              items={STATUS_FILTERS.map((f) => ({ ...f, count: f.key === "all" ? filtered.length : filtered.filter((r) => r.status === f.key).length }))}
              value={status}
              onChange={setStatus}
              label="Status"
            />
          }
        >
          {!data ? (
            !error && loading
          ) : shown.length === 0 ? (
            <Empty icon={ListChecks} title="No reports for these filters" />
          ) : (
            <ul className="divide-y divide-[#eef1f7]">
              {shown.map((r) => (
                <ReportCard key={r.id} r={r} onChanged={onChanged} />
              ))}
            </ul>
          )}
          <p className="border-t border-[#eef1f7] px-5 py-3 text-xs text-[#9aa0ad]">Click a report to see the work done per project, hours, notes and feedback.</p>
        </TableCard>
      )}
    </div>
  );
}
