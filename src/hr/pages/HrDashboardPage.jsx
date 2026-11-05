// Module 1 — HR Dashboard: the six daily-operations sections only (employee
// count, attendance, leave, payroll, approvals assigned to me, alerts).
// Every number comes from public.hr_dashboard(), which runs under the caller's
// RLS (company scope for HR, team scope for managers). Sections the caller
// cannot access arrive as null and are hidden (payroll shows a restricted
// notice instead). Headcount breakdowns, demographics, training, benefits,
// recruitment and other analytics live in HR Reports.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlarmClock, AlertTriangle, BarChart3, CalendarCheck, CalendarClock, CheckCircle2, ChevronRight, ClipboardCheck, Clock, Lock,
  RefreshCw, Sparkles, UserCheck, UserMinus, Users, UserX, Wallet,
} from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, formatMoney, rpc, useHrQuery } from "@/lib/hr/client";
import { toOptions, useEmployeeOptions, useOrg } from "@/lib/hr/org";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, KpiCard, Modal, PageHeader, Select, StatusBadge } from "@/hr/ui";

const PRIORITY_TONE = { high: "red", medium: "orange", low: "slate" };
const PRIORITY_ORDER = ["high", "medium", "low"];
const ALERTS_PREVIEW = 8;

/** Build "/path?k=v" from the non-empty entries of `params`. */
function href(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== ""));
  const s = qs.toString();
  return s ? `${path}${path.includes("?") ? "&" : "?"}${s}` : path;
}

function Section({ title, icon: Icon, link, linkLabel, children, className, badge }) {
  return (
    <Card className={className} title={<span className="flex items-center gap-2"><Icon className="h-4 w-4 text-[#f96706]" aria-hidden="true" />{title}{badge}</span>}
      actions={link && <Link to={link} className="inline-flex items-center gap-0.5 text-xs font-semibold text-[#1f4693] hover:underline">{linkLabel}<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>}>
      {children}
    </Card>
  );
}

const KPI_GRID = "grid grid-cols-1 gap-3 min-[420px]:grid-cols-2";

export default function HrDashboardPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const org = useOrg();
  const managers = useEmployeeOptions();
  const [f, setF] = useState({ from: "", to: "", department: "", type: "", manager: "", company: "" });
  const [absentOpen, setAbsentOpen] = useState(false);
  const [allAlerts, setAllAlerts] = useState(false);
  const q = useHrQuery(() => rpc("hr_dashboard", {
    p_from: f.from || null, p_to: f.to || null, p_department: f.department || null,
    p_employment_type: f.type || null, p_manager: f.manager || null, p_status: null, p_legal_entity: f.company || null,
  }), [f.from, f.to, f.department, f.type, f.manager, f.company]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const d = q.data;
  const k = d?.kpis ?? {};
  const loading = q.loading;
  const has = (key) => k[key] !== null && k[key] !== undefined;
  const go = (path) => () => navigate(path);
  // Filters carried into Employee Master so the list matches the card.
  const empFilters = { department: f.department, type: f.type, manager: f.manager, company: f.company };
  const today = d?.today;

  if (q.error && !d) return (<><PageHeader title="HR Dashboard" /><ErrorState message={q.error} onRetry={q.reload} /></>);

  const approvals = d?.my_approvals ?? [];
  const approvalsTotal = approvals.reduce((n, a) => n + (Number(a.count) || 0), 0);
  const alerts = d?.alerts ?? [];
  const alertCounts = PRIORITY_ORDER.reduce((m, p) => ({ ...m, [p]: alerts.filter((a) => a.priority === p).length }), {});
  const shownAlerts = allAlerts ? alerts : alerts.slice(0, ALERTS_PREVIEW);
  const showAttendance = !d || has("present_today");
  const showLeave = !d || has("pending_leave_approvals");

  return (
    <>
      <PageHeader title="HR Dashboard"
        description={d ? `${d.scope === "team" ? "Your team" : "Company-wide"} · today ${formatDate(d.today)} · period ${formatDate(d.from)} – ${formatDate(d.to)} · updated ${formatDateTime(d.generated_at)}` : "Daily HR operations from records you are authorised to see."}
        actions={<>
          {(hasPermission("reports.view") || hasPermission("reports.view_team")) && (
            <Button variant="secondary" onClick={go("/hr/reports")}><BarChart3 className="h-4 w-4" aria-hidden="true" />Analytics in HR Reports</Button>
          )}
          <Button variant="secondary" onClick={q.reload} loading={loading}><RefreshCw className="h-4 w-4" aria-hidden="true" />Refresh</Button>
        </>} />

      <Card className="mb-5" title="Filters">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Company"><Select placeholder="All" value={f.company} onChange={set("company")} options={toOptions(org.data?.legalEntities)} /></Field>
          <Field label="Department"><Select placeholder="All" value={f.department} onChange={set("department")} options={toOptions(org.data?.departments)} /></Field>
          <Field label="Manager"><Select placeholder="Any" value={f.manager} onChange={set("manager")} options={managers.data ?? []} /></Field>
          <Field label="Employment type"><Select placeholder="All" value={f.type} onChange={set("type")} options={toOptions(org.data?.employmentTypes, "name", "code")} /></Field>
          <Field label="Period from" hint="New joiners & approved leave"><Input type="date" value={f.from} onChange={set("from")} /></Field>
          <Field label="Period to"><Input type="date" value={f.to} onChange={set("to")} /></Field>
        </div>
        {q.error && d && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{q.error} — showing the last loaded figures.</p>}
      </Card>

      <div className="flex flex-col gap-4">
        {/* 1. Employee count */}
        <Section title="Employee count" icon={Users} link={href("/hr/employees", { status: "current", ...empFilters })} linkLabel="Employee Master">
          <div className={`${KPI_GRID} lg:grid-cols-4`}>
            <KpiCard label="Total employees" value={k.total_employees} icon={Users} tone="navy" loading={loading} hint="Current records (not exited)"
              onClick={go(href("/hr/employees", { status: "current", ...empFilters }))} />
            <KpiCard label="Active" value={k.active_employees} icon={UserCheck} tone="green" loading={loading} hint="Incl. probation & notice period"
              onClick={go(href("/hr/employees", { status: "working", ...empFilters }))} />
            <KpiCard label="Inactive" value={k.inactive_employees} icon={UserMinus} tone="slate" loading={loading} hint="Onboarding or suspended"
              onClick={go(href("/hr/employees", { status: "inactive", ...empFilters }))} />
            <KpiCard label="New joiners" value={k.new_joiners} icon={Sparkles} tone="teal" loading={loading} hint={d ? `Joined ${formatDate(d.from)} – ${formatDate(d.to)}` : undefined}
              onClick={d ? go(href("/hr/employees", { status: "", joinedFrom: d.from, joinedTo: d.to, ...empFilters })) : undefined} />
          </div>
        </Section>

        {/* 2. Attendance */}
        {showAttendance && (
          <Section title="Attendance today" icon={Clock} link={href("/hr/attendance", { tab: "daily", department: f.department })} linkLabel="Attendance & Time">
            <div className={`${KPI_GRID} sm:grid-cols-3 xl:grid-cols-5`}>
              <KpiCard label="Present" value={k.present_today} icon={CheckCircle2} tone="green" loading={loading} hint="Incl. late & half day"
                onClick={go(href("/hr/attendance", { tab: "daily", status: "attended", department: f.department }))} />
              <KpiCard label="Absent" value={k.absent_today} icon={UserX} tone="red" loading={loading} hint="Working day, no check-in, not on leave"
                onClick={d ? () => setAbsentOpen(true) : undefined} />
              <KpiCard label="Late" value={k.late_today} icon={AlarmClock} tone="orange" loading={loading}
                onClick={today ? go(href("/hr/attendance", { tab: "late", from: today, to: today, department: f.department })) : undefined} />
              <KpiCard label="On approved leave" value={k.on_leave_today} icon={CalendarCheck} tone="teal" loading={loading}
                onClick={go(href("/hr/leave", { tab: "calendar" }))} />
              <KpiCard label="Missing punch-outs" value={k.missing_punch_outs} icon={AlertTriangle} tone="red" loading={loading} hint="Past check-ins with no check-out"
                onClick={go(href("/hr/attendance", { tab: "exceptions" }))} />
            </div>
          </Section>
        )}

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          {/* 3. Leave */}
          {showLeave && (
            <Section title="Leave" icon={CalendarClock} link={href("/hr/leave")} linkLabel="Leave Management">
              <div className={`${KPI_GRID} sm:grid-cols-3`}>
                <KpiCard label="Pending requests" value={k.pending_leave_approvals} icon={CalendarClock} tone="orange" loading={loading}
                  onClick={go(href("/hr/leave", { tab: "requests", status: "pending_approval" }))} />
                <KpiCard label="Approved" value={k.approved_leave_requests} icon={CheckCircle2} tone="green" loading={loading} hint="Overlapping the period"
                  onClick={d ? go(href("/hr/leave", { tab: "requests", status: "approved", from: d.from, to: d.to })) : undefined} />
                <KpiCard label="On leave today" value={k.on_leave_today} icon={CalendarCheck} tone="teal" loading={loading}
                  onClick={go(href("/hr/leave", { tab: "calendar" }))} />
              </div>
            </Section>
          )}

          {/* 4. Payroll */}
          <PayrollSection d={d} loading={loading} />

          {/* 5. Pending approvals (assigned to the signed-in user) */}
          <Section title="Pending approvals" icon={ClipboardCheck}
            badge={d && <Badge tone={approvalsTotal ? "orange" : "slate"} className="ml-1">{approvalsTotal}</Badge>}>
            {!d ? <SkeletonRows /> : !approvals.length ? <EmptyState title="No approval queues" description="You do not approve requests in any HR module." /> : (
              <ul className="flex flex-col divide-y divide-slate-100">
                {approvals.map((a) => (
                  <li key={a.key}>
                    <Link to={a.path} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693]">
                      <span className="font-semibold text-[#101a3a]">{a.label}</span>
                      <span className="flex items-center gap-1"><Badge tone={a.count > 0 ? "orange" : "slate"}>{a.count}</Badge><ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {d && approvals.length > 0 && <p className="mt-2 text-xs text-slate-500">Only items you are allowed to decide; your own requests are excluded.</p>}
          </Section>

          {/* 6. Alerts */}
          <Section title="Alerts" icon={AlertTriangle}
            badge={d && <span className="ml-1 flex gap-1">{PRIORITY_ORDER.filter((p) => alertCounts[p]).map((p) => <Badge key={p} tone={PRIORITY_TONE[p]}>{alertCounts[p]} {p}</Badge>)}</span>}>
            {!d ? <SkeletonRows /> : !alerts.length ? <EmptyState icon={CheckCircle2} title="No alerts" description="No expiring documents, probation ends, missing attendance or overdue HR actions." /> : (
              <>
                <ul className="flex flex-col divide-y divide-slate-100">
                  {shownAlerts.map((a, i) => (
                    <li key={`${a.type}-${a.employee_id ?? ""}-${a.date ?? ""}-${i}`}>
                      <Link to={a.path} className="flex items-start gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693]">
                        <Badge tone={PRIORITY_TONE[a.priority]} className="mt-0.5 w-16 justify-center">{a.priority}</Badge>
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-[#101a3a]">{a.title}</span>
                          <span className="block break-words text-xs text-slate-600">{a.detail}</span>
                        </span>
                        {a.date && <span className="shrink-0 text-xs text-slate-500">{formatDate(a.date)}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
                {alerts.length > ALERTS_PREVIEW && (
                  <Button variant="secondary" size="sm" className="mt-2" onClick={() => setAllAlerts((v) => !v)}>
                    {allAlerts ? "Show fewer" : `Show all ${alerts.length} alerts`}
                  </Button>
                )}
              </>
            )}
          </Section>
        </div>
      </div>

      <Modal open={absentOpen} onClose={() => setAbsentOpen(false)} title={`Absent today${d ? ` · ${formatDate(d.today)}` : ""}`}
        footer={<Button variant="secondary" onClick={() => setAbsentOpen(false)}>Close</Button>}>
        {!d?.absent_today_list?.length ? <EmptyState title="Nobody is absent" description="Everyone due to work today has checked in or is on approved leave." /> : (
          <>
            <p className="mb-2 text-xs text-slate-500">Working day, no check-in yet and no approved leave. Record an absence or manual entry in Attendance &amp; Time.</p>
            <ul className="flex max-h-[60vh] flex-col divide-y divide-slate-100 overflow-y-auto">
              {d.absent_today_list.map((e) => (
                <li key={e.employee_id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link to={`/hr/employees/${e.employee_id}`} className="font-semibold text-[#1f4693] hover:underline">{e.employee}</Link>
                  <span className="text-xs text-slate-500">{e.employee_code}{e.department ? ` · ${e.department}` : ""}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Modal>
    </>
  );
}

function SkeletonRows() {
  return <div className="flex flex-col gap-2" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />)}</div>;
}

const PAYROLL_STATES = [["draft", "Draft"], ["reviewed", "In review"], ["approved", "Approved"], ["paid", "Paid"]];

function PayrollSection({ d, loading }) {
  const p = d?.payroll;
  if (d && !p) {
    return (
      <Section title="Payroll" icon={Wallet}>
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
          <p>Payroll status and salary figures are visible only to payroll roles (payroll.view). Your role does not include payroll access.</p>
        </div>
      </Section>
    );
  }
  const run = p?.current_run;
  const pending = p ? Object.values(p.pending_actions ?? {}).reduce((n, v) => n + (Number(v) || 0), 0) : null;
  return (
    <Section title="Payroll" icon={Wallet} link="/hr/payroll" linkLabel="Payroll">
      {!p ? <SkeletonRows /> : (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-slate-200 p-3">
            {!run ? <p className="text-sm text-slate-600">No payroll run has been created yet.</p> : (
              <Link to={`/hr/payroll/runs/${run.id}`} className="flex flex-wrap items-center justify-between gap-2 hover:underline">
                <span>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{run.is_current_period ? "Current payroll period" : "Latest payroll run"}</span>
                  <span className="block font-bold text-[#101a3a]">{formatDate(run.period_start)} – {formatDate(run.period_end)}</span>
                </span>
                <StatusBadge status={run.status} />
              </Link>
            )}
            {run && !run.is_current_period && <p className="mt-1 text-xs text-orange-700">No run exists for the period containing today ({formatDate(p.today)}).</p>}
            {run && (
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-xs text-slate-500">Employees</dt><dd className="font-semibold text-[#101a3a]">{run.employees}</dd></div>
                <div><dt className="text-xs text-slate-500">Gross</dt><dd className="font-semibold text-[#101a3a]">{formatMoney(run.gross)}</dd></div>
                <div><dt className="text-xs text-slate-500">Net</dt><dd className="font-semibold text-[#101a3a]">{formatMoney(run.net)}</dd></div>
              </dl>
            )}
          </div>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Payroll runs by status">
            {PAYROLL_STATES.map(([key, label]) => (
              <li key={key} className="rounded-xl border border-slate-100 px-3 py-2">
                <span className="block text-xs text-slate-500">{label}</span>
                <span className="block text-lg font-extrabold text-[#101a3a]">{loading ? "…" : p.status_counts?.[key] ?? 0}</span>
              </li>
            ))}
          </ul>
          <Link to="/hr/payroll?tab=runs" className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-sm hover:bg-slate-50">
            <span className="font-semibold text-[#101a3a]">Pending payroll approvals</span>
            <span className="flex items-center gap-1"><Badge tone={pending ? "orange" : "slate"}>{pending}</Badge><ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" /></span>
          </Link>
          <p className="-mt-2 text-xs text-slate-500">Draft includes calculated runs; Approved includes finalized runs. Pending counts steps you can take (review, approve, finalize, mark paid).</p>
        </div>
      )}
    </Section>
  );
}
