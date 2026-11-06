// Leave Management (HR / managers). Overview, approval queue (level-aware),
// all requests, team calendar, balances with the audited ledger, opening
// balances and adjustments, policies (maker-checker), the shared holiday
// calendar and the leave year (initialise, expiry, year-end close). Day
// counts, balances, policy rules and approval routing are computed by the
// server RPCs (migrations 103 + 160); every list is scoped by the server.
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, CalendarCheck, CalendarClock, CalendarPlus, Clock, Download, Lock, Paperclip, RefreshCw, SlidersHorizontal, UserCheck } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { exportCsv, formatDate, formatDateTime, fullName, useHrQuery } from "@/lib/hr/client";
import { useEmployeeOptions, useOrg } from "@/lib/hr/org";
import { businessToday, useBusinessTimezone } from "@/lib/hr/attendance";
import {
  LEAVE_EVENT_LABELS, LEAVE_STATUSES, LEDGER_LABELS, adjustBalance, cancelLeave, closeLeaveYear, decideLeave, halfLabel, initializeLeaveYear,
  leaveOverview, listAdjustments, listBalances, listLeaveTypes, listLeaveYears, listLedger, listRequestEvents, listRequests, pendingClarification,
  decideCancellation, processLeaveExpiry, recalculateLeave, requestClarification, setOpeningBalance,
} from "@/lib/hr/leave";
import {
  Badge, Button, Card, ConfirmDialog, DataTable, ErrorState, Field, InlineError, Input, KpiCard, Loading, Modal, PageHeader, SearchInput, Select,
  StatusBadge, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";
import { LeaveCalendar } from "@/employee/pages/MyLeavePage";
import LeavePolicies from "@/hr/leave/LeavePolicies";
import HolidaysSettings from "@/hr/settings/HolidaysSettings";

const num = (n) => (n == null ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const dates = (r) => `${formatDate(r.start_date)}${r.end_date !== r.start_date ? ` – ${formatDate(r.end_date)}` : ""}`;
const EmpCell = ({ e }) => (e ? <div className="min-w-[10rem]"><p className="font-semibold text-[#101a3a]">{fullName(e)}</p><p className="font-mono text-xs text-slate-500">{e.employee_code}</p></div> : "—");
const ReviewBadge = ({ r }) => (r?.holiday_review_required ? <Badge tone="orange" className="whitespace-nowrap"><AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />holiday review</Badge> : null);
const deptOptions = (org) => (org.data?.departments ?? []).filter((d) => d.active !== false).map((d) => ({ value: d.id, label: d.name }));
const companyOptions = (org) => (org.data?.legalEntities ?? []).filter((d) => d.active !== false).map((d) => ({ value: d.id, label: d.name }));

export default function LeavePage() {
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const tz = useBusinessTimezone();
  const canApprove = hasPermission("leave.approve") || hasPermission("leave.approve_team");
  const canView = hasPermission("leave.view") || hasPermission("leave.view_team") || hasPermission("leave.manage");
  const canManage = hasPermission("leave.manage");
  const canHrView = hasPermission("leave.view") || canManage;
  const tabs = [
    ...(canView || canApprove ? [{ value: "overview", label: "Overview" }] : []),
    ...(canApprove ? [{ value: "approvals", label: "Approvals" }] : []),
    ...(canView || canApprove ? [{ value: "requests", label: "All requests" }, { value: "calendar", label: "Team calendar" }] : []),
    ...(canView ? [{ value: "balances", label: "Balances" }] : []),
    ...(canHrView ? [{ value: "policies", label: "Policies" }, { value: "holidays", label: "Holidays" }] : []),
    ...(canManage ? [{ value: "year", label: "Leave year" }] : []),
  ];
  const tab = tabs.some((t) => t.value === params.get("tab")) ? params.get("tab") : tabs[0]?.value;
  const org = useOrg();
  if (!tabs.length) return <ErrorState message="You do not have access to leave management." />;
  return (
    <>
      <PageHeader title="Leave Management" description="See who is away, approve requests, monitor balances and maintain leave policies and holidays." />
      <Tabs tabs={tabs} value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} label="Leave sections" />
      {tab === "overview" && <Overview tz={tz} org={org} onOpen={(t, extra) => setParams({ tab: t, ...(extra ?? {}) }, { replace: true })} />}
      {tab === "approvals" && <Approvals org={org} />}
      {tab === "requests" && <AllRequests tz={tz} />}
      {tab === "calendar" && <LeaveCalendar tz={tz} departments={org.data?.departments} legalEntities={org.data?.legalEntities} employeeFilter />}
      {tab === "balances" && <Balances tz={tz} />}
      {tab === "policies" && <LeavePolicies canEdit={canManage} />}
      {tab === "holidays" && <HolidaysSettings canEdit={canManage} />}
      {tab === "year" && <YearSetup tz={tz} />}
    </>
  );
}

function Overview({ tz, org, onOpen }) {
  const navigate = useNavigate();
  const today = businessToday(tz);
  const types = useHrQuery(() => listLeaveTypes(), []);
  const [f, setF] = useState({ from: `${today.slice(0, 7)}-01`, to: "", department: "", type: "", legalEntity: "" });
  const to = f.to || (() => { const [y, m] = f.from.slice(0, 7).split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); })();
  const q = useHrQuery(() => leaveOverview({ ...f, to }), [f.from, to, f.department, f.type, f.legalEntity]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: typeof e === "string" ? e : e.target.value }));
  const d = q.data;
  const reqLink = (status) => navigate(`/hr/leave?tab=requests&status=${status}&from=${f.from}&to=${to}`);
  return (
    <>
      <Toolbar>
        <Field label="From" className="sm:w-40"><Input type="date" value={f.from} onChange={set("from")} /></Field>
        <Field label="To" className="sm:w-40"><Input type="date" value={to} min={f.from} onChange={set("to")} /></Field>
        <Field label="Department" className="sm:w-48"><Select placeholder="All departments" value={f.department} onChange={set("department")} options={deptOptions(org)} /></Field>
        <Field label="Type" className="sm:w-44"><Select placeholder="All types" value={f.type} onChange={set("type")} options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))} /></Field>
        {companyOptions(org).length > 1 && <Field label="Company" className="sm:w-48"><Select placeholder="All companies" value={f.legalEntity} onChange={set("legalEntity")} options={companyOptions(org)} /></Field>}
      </Toolbar>
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiCard label="Awaiting my approval" value={d?.awaiting_my_approval} icon={UserCheck} loading={q.loading && !d} onClick={() => onOpen("approvals")} />
            <KpiCard label="Pending requests" value={d?.pending_requests} icon={CalendarClock} tone="teal" loading={q.loading && !d} onClick={() => reqLink("pending_approval")} />
            <KpiCard label="On leave today" value={d?.on_leave_today?.length} icon={CalendarCheck} tone="green" loading={q.loading && !d} />
            <KpiCard label="Approved leave days" value={d ? num(d.approved_in_period?.days) : undefined} hint={d ? `${d.approved_in_period?.requests ?? 0} request(s), ${d.approved_in_period?.employees ?? 0} employee(s)` : undefined} icon={CalendarPlus} tone="navy" loading={q.loading && !d} onClick={() => reqLink("approved")} />
            <KpiCard label="Holiday review" value={d?.holiday_review} hint="Requests to recalculate" icon={AlertTriangle} tone="orange" loading={q.loading && !d} onClick={() => navigate("/hr/leave?tab=requests&review=1")} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="On leave today" padded={false}>
              <DataTable caption="On leave today" rows={d?.on_leave_today} loading={q.loading && !d} rowKey="request_id" emptyTitle="Nobody is on approved leave today"
                columns={[
                  { key: "employee_name", header: "Employee", render: (r) => <div><p className="font-semibold text-[#101a3a]">{r.employee_name}</p><p className="font-mono text-xs text-slate-500">{r.employee_code}</p></div> },
                  { key: "department", header: "Department", render: (r) => r.department ?? "—" },
                  { key: "leave_type", header: "Type", render: (r) => <span>{r.leave_type}{r.half && <span className="ml-1 text-xs text-slate-500">({r.half} half)</span>}</span> },
                  { key: "end_date", header: "Back after", render: (r) => formatDate(r.end_date) },
                ]} />
            </Card>
            <Card title="Upcoming leave (next 30 days)" padded={false}>
              <DataTable caption="Upcoming leave" rows={d?.upcoming} loading={q.loading && !d} rowKey="request_id" emptyTitle="No upcoming leave"
                columns={[
                  { key: "employee_name", header: "Employee" },
                  { key: "leave_type", header: "Type" },
                  { key: "start_date", header: "Dates", render: (r) => <span className="whitespace-nowrap">{dates(r)}</span> },
                  { key: "days", header: "Days", render: (r) => num(r.days) },
                  { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
                ]} />
            </Card>
            <Card title="By leave type (period)" padded={false}>
              <DataTable caption="Leave by type" rows={d?.by_type} loading={q.loading && !d} rowKey="leave_type_id" emptyTitle="No leave types"
                columns={[
                  { key: "name", header: "Type", render: (r) => <span>{r.name}{!r.paid && <Badge tone="slate" className="ml-1">unpaid</Badge>}</span> },
                  { key: "approved_days", header: "Approved days", render: (r) => num(r.approved_days) },
                  { key: "pending_requests", header: "Pending requests", render: (r) => num(r.pending_requests) },
                ]} />
            </Card>
            <Card title={`Balances summary ${today.slice(0, 4)}`} padded={false}>
              <DataTable caption="Balances summary" rows={d?.balances} loading={q.loading && !d} rowKey="leave_type_id" emptyTitle="No balances yet" emptyDescription="Initialise the leave year to create balances."
                columns={[
                  { key: "name", header: "Type" },
                  { key: "employees", header: "Employees" },
                  { key: "used", header: "Used", render: (r) => num(r.used) },
                  { key: "pending", header: "Pending", render: (r) => num(r.pending) },
                  { key: "available", header: "Available", render: (r) => num(r.available) },
                  { key: "low", header: "Low (< 1 day)", render: (r) => (r.low ? <Badge tone="orange">{r.low}</Badge> : "0") },
                ]} />
            </Card>
          </div>
          {(d?.upcoming_holidays ?? []).length > 0 && (
            <div className="mt-4">
              <Card title="Upcoming holidays">
                <ul className="flex flex-wrap gap-2 text-sm">
                  {d.upcoming_holidays.map((h) => <li key={h.id} className="rounded-lg bg-sky-50 px-3 py-1.5 text-sky-900">{formatDate(h.date, { weekday: "short", day: "2-digit", month: "short" })} · {h.name}{h.type === "optional" && <span className="ml-1 text-xs">(optional)</span>}</li>)}
                </ul>
              </Card>
            </div>
          )}
        </>
      )}
    </>
  );
}

function useDecisions(onDone) {
  const { notify } = useToast();
  const [action, setAction] = useState(null); // { kind: approve|reject|clarify|cancel|recalc, row }
  const dialog = action && (
    <ConfirmDialog open onClose={() => setAction(null)}
      title={{ approve: "Approve leave?", reject: "Reject leave?", clarify: "Ask for clarification", cancel: "Cancel this leave?", recalc: "Recalculate leave days?" }[action.kind]}
      tone={action.kind === "approve" ? "success" : action.kind === "clarify" || action.kind === "recalc" ? "primary" : "danger"}
      confirmLabel={{ approve: "Approve", reject: "Reject", clarify: "Send question", cancel: "Cancel leave", recalc: "Recalculate" }[action.kind]}
      message={`${fullName(action.row.employee)} · ${action.row.leave_type?.name} · ${dates(action.row)} (${num(action.row.days)} day(s)).${action.kind === "approve" && action.row.current_level === "manager" ? " If HR approval is also required, the request moves to HR next." : ""}${action.kind === "cancel" ? " The days are returned to the employee's balance and they are notified." : ""}${action.kind === "recalc" ? " The days are recounted with today's holiday calendar and the balance is corrected by the difference (recorded in the ledger). The employee is notified if the days change." : ""}`}
      requireReason={action.kind !== "approve" && action.kind !== "recalc"} reasonLabel={{ approve: "Note (optional)", reject: "Reason for rejection", clarify: "Question for the employee", cancel: "Reason for cancelling", recalc: "Note (optional)" }[action.kind]}
      onConfirm={async (note) => {
        const { kind, row } = action;
        const res = kind === "approve" ? await decideLeave(row.id, true, note)
          : kind === "reject" ? await decideLeave(row.id, false, note)
            : kind === "clarify" ? await requestClarification(row.id, note)
              : kind === "recalc" ? await recalculateLeave(row.id, note)
                : await cancelLeave(row.id, note);
        if (res.error) return { error: res.error };
        const after = res.data?.status;
        notify(kind === "approve" ? (after === "approved" ? "Leave approved." : "Approved at manager level; now awaiting HR.")
          : kind === "reject" ? "Leave rejected." : kind === "clarify" ? "Question sent to the employee."
            : kind === "recalc" ? `Recalculated: ${num(res.data?.days)} day(s).` : "Leave cancelled.");
        onDone();
        return {};
      }} />
  );
  return [setAction, dialog];
}

function Approvals({ org }) {
  const { hr, hasPermission } = useAuth();
  const me = hr?.employee?.id;
  const q = useHrQuery(() => listRequests({ status: "pending_approval" }), []);
  const types = useHrQuery(() => listLeaveTypes(), []);
  const [detail, setDetail] = useState(null);
  const [f, setF] = useState({ type: "", department: "", search: "" });
  const [act, dialog] = useDecisions(() => { q.reload(); setDetail(null); });
  const hrLevel = hasPermission("leave.approve");
  const rows = useMemo(() => {
    const s = f.search.trim().toLowerCase();
    return (q.data ?? []).filter((r) => r.employee_id !== me && (hrLevel || r.current_level === "manager")
      && (!f.type || r.leave_type_id === f.type) && (!f.department || r.employee?.department_id === f.department)
      && (!s || fullName(r.employee).toLowerCase().includes(s) || r.employee?.employee_code?.toLowerCase().includes(s)));
  }, [q.data, me, hrLevel, f]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: typeof e === "string" ? e : e.target.value }));
  return (
    <>
      <Toolbar>
        <Field label="Type" className="sm:w-44"><Select placeholder="All types" value={f.type} onChange={set("type")} options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))} /></Field>
        <Field label="Department" className="sm:w-48"><Select placeholder="All departments" value={f.department} onChange={set("department")} options={deptOptions(org)} /></Field>
        <div className="flex flex-1 items-end"><SearchInput value={f.search} onChange={set("search")} placeholder="Search name or ID…" label="Search employees" /></div>
      </Toolbar>
      <p className="mb-3 text-xs text-slate-500">{hrLevel ? "You can decide requests at any level." : "Showing requests awaiting manager approval for your team. HR-level approvals are handled by HR."} Requests flagged for holiday review must be recalculated before approval.</p>
      <DataTable caption="Leave requests awaiting approval" rows={rows} loading={q.loading} error={q.error} onRetry={q.reload} onRowClick={setDetail}
        emptyTitle="Nothing to approve" emptyDescription="No pending leave requests at your level."
        columns={[
          { key: "employee", header: "Employee", render: (r) => <EmpCell e={r.employee} /> },
          { key: "type", header: "Type", render: (r) => <span>{r.leave_type?.name}{r.leave_type && !r.leave_type.paid && <Badge tone="slate" className="ml-1">unpaid</Badge>}{r.document_id && <Paperclip className="ml-1 inline h-3.5 w-3.5 text-slate-500" aria-label="Document attached" />}</span> },
          { key: "dates", header: "Dates", render: (r) => <span className="flex flex-col gap-1 whitespace-nowrap">{dates(r)}<ReviewBadge r={r} /></span> },
          { key: "days", header: "Days", render: (r) => `${num(r.days)}${halfLabel(r) && r.start_date === r.end_date ? ` (${halfLabel(r)})` : ""}` },
          { key: "level", header: "Level", render: (r) => <Badge tone={r.current_level === "hr" ? "violet" : "blue"}>{r.current_level}</Badge> },
          { key: "created_at", header: "Applied", render: (r) => formatDate(r.created_at) },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (
            <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
              {r.holiday_review_required
                ? <Button size="sm" variant="secondary" onClick={() => act({ kind: "recalc", row: r })}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Recalculate</Button>
                : <Button size="sm" variant="success" onClick={() => act({ kind: "approve", row: r })}>Approve</Button>}
              <Button size="sm" variant="danger" onClick={() => act({ kind: "reject", row: r })}>Reject</Button>
              <Button size="sm" variant="secondary" onClick={() => act({ kind: "clarify", row: r })}>Clarify</Button>
            </div>) },
        ]} />
      {detail && <RequestDetailModal request={detail} onClose={() => setDetail(null)} actions={
        <>
          <Button variant="secondary" onClick={() => act({ kind: "clarify", row: detail })}>Ask clarification</Button>
          <Button variant="danger" onClick={() => act({ kind: "reject", row: detail })}>Reject</Button>
          {detail.holiday_review_required
            ? <Button onClick={() => act({ kind: "recalc", row: detail })}><RefreshCw className="h-4 w-4" aria-hidden="true" />Recalculate</Button>
            : <Button variant="success" onClick={() => act({ kind: "approve", row: detail })}>Approve</Button>}
        </>} />}
      {hrLevel || hasPermission("leave.manage") ? <CancellationQueue me={me} /> : null}
      {dialog}
    </>
  );
}

/** Employees' requests to cancel approved leave that has already started (migration 161). HR only. */
function CancellationQueue({ me }) {
  const { notify } = useToast();
  const q = useHrQuery(() => listRequests({ cancellation: true }), []);
  const [action, setAction] = useState(null); // { approve: boolean, row }
  const rows = useMemo(() => (q.data ?? []).filter((r) => r.employee_id !== me), [q.data, me]);
  return (
    <div className="mt-6">
      <Card title="Cancellation requests" padded={false}>
        <p className="px-4 pt-3 text-xs text-slate-500">Employees asking to cancel approved leave that has already started. Approving cancels the whole request and returns its days to the balance; if payroll for those dates is already processed, correct it in Payroll.</p>
        <DataTable caption="Leave cancellation requests" rows={rows} loading={q.loading} error={q.error} onRetry={q.reload}
          emptyTitle="No cancellation requests" emptyDescription="Nothing waiting."
          columns={[
            { key: "employee", header: "Employee", render: (r) => <EmpCell e={r.employee} /> },
            { key: "leave", header: "Leave", render: (r) => <span className="flex flex-col"><span>{r.leave_type?.name}</span><span className="whitespace-nowrap text-xs text-slate-500">{dates(r)} · {num(r.days)} day(s)</span></span> },
            { key: "reason", header: "Reason", render: (r) => <span className="line-clamp-3 text-xs">{r.cancellation_reason}</span> },
            { key: "requested", header: "Requested", render: (r) => formatDateTime(r.cancellation_requested_at) },
            { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="success" onClick={() => setAction({ approve: true, row: r })}>Approve</Button>
                <Button size="sm" variant="danger" onClick={() => setAction({ approve: false, row: r })}>Reject</Button>
              </div>) },
          ]} />
      </Card>
      {action && (
        <ConfirmDialog open onClose={() => setAction(null)} title={action.approve ? "Approve cancellation?" : "Reject cancellation?"}
          tone={action.approve ? "success" : "danger"} confirmLabel={action.approve ? "Cancel the leave" : "Reject request"}
          message={`${fullName(action.row.employee)} · ${action.row.leave_type?.name} · ${dates(action.row)} (${num(action.row.days)} day(s)). ${action.approve ? "The leave is cancelled and the days return to the balance. The employee is notified." : "The leave stays approved. The employee sees your reason."}`}
          requireReason={!action.approve} reasonLabel={action.approve ? "Note (optional)" : "Reason for rejecting"}
          onConfirm={async (note) => {
            const res = await decideCancellation(action.row.id, action.approve, note);
            if (res.error) return { error: res.error };
            notify(action.approve ? "Leave cancelled." : "Cancellation request rejected.");
            q.reload();
            return {};
          }} />
      )}
    </div>
  );
}

function RequestDetailModal({ request: r, onClose, actions }) {
  const events = useHrQuery(() => listRequestEvents(r.id), [r.id]);
  return (
    <Modal open onClose={onClose} title={`${fullName(r.employee)} · ${r.leave_type?.name ?? "Leave"}`} size="md"
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button>{actions}</>}>
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={r.status} />{r.current_level && <Badge tone="blue">awaiting {r.current_level}</Badge>}<span>{dates(r)} · {num(r.days)} day(s)</span>{halfLabel(r) && <span className="text-slate-500">· {halfLabel(r)}</span>}</div>
        <p><span className="font-semibold">Reason:</span> {r.reason}</p>
        {r.document_id
          ? <p className="flex items-center gap-1"><Paperclip className="h-4 w-4" aria-hidden="true" /><span className="font-semibold">Supporting document attached.</span> <span className="text-xs text-slate-500">HR document viewers can open it in Documents; line managers see only that it exists.</span></p>
          : r.document_path && <p><span className="font-semibold">Document reference:</span> {r.document_path}</p>}
        {r.decision_note && <p><span className="font-semibold">Decision note:</span> {r.decision_note}</p>}
        {r.cancellation_status === "pending" && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">The employee asked to cancel this leave: {r.cancellation_reason}</p>}
        {r.holiday_review_required && <p className="rounded-lg bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-800">The holiday calendar changed for these dates. The stored days and balance are unchanged until an approver recalculates the request.</p>}
        {pendingClarification(events.data) && r.status === "pending_approval" && <p className="rounded-lg bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-800">Waiting for the employee to answer a clarification question.</p>}
        <h3 className="mt-2 font-bold text-[#101a3a]">History</h3>
        {events.loading && !events.data ? <Loading /> : events.error ? <ErrorState message={events.error} onRetry={events.reload} /> : (
          <ol className="flex flex-col gap-2">
            {(events.data ?? []).map((e) => (
              <li key={e.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <div className="flex flex-wrap gap-2 text-xs text-slate-500"><Badge>{LEAVE_EVENT_LABELS[e.action] ?? e.action}</Badge>{e.level && <span>{e.level} level</span>}<span>{formatDateTime(e.created_at)}</span></div>
                {e.note && <p className="mt-1 whitespace-pre-wrap text-slate-700">{e.note}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}

function AllRequests({ tz }) {
  const { hr, hasPermission } = useAuth();
  const { notify } = useToast();
  const types = useHrQuery(() => listLeaveTypes(), []);
  const employees = useEmployeeOptions({ includeInactive: true });
  const year = businessToday(tz).slice(0, 4);
  // Initial status / range may come from the URL (HR Dashboard click-through).
  const [params] = useSearchParams();
  const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? "") ? v : null);
  // The holiday-review link shows every flagged request, whatever its year.
  const review = params.get("review") === "1";
  const [f, setF] = useState(() => ({ status: params.get("status") ?? "", type: "", employee: "",
    from: iso(params.get("from")) ?? (review ? "" : `${year}-01-01`), to: iso(params.get("to")) ?? (review ? "" : `${year}-12-31`), search: "", review }));
  const q = useHrQuery(() => listRequests(f), [f.status, f.type, f.employee, f.from, f.to, f.review]);
  const [detail, setDetail] = useState(null);
  const [act, dialog] = useDecisions(() => { q.reload(); setDetail(null); });
  const canHrCancel = hasPermission("leave.approve") || hasPermission("leave.manage");
  const rows = useMemo(() => {
    const s = f.search.trim().toLowerCase();
    return (q.data ?? []).filter((r) => !s || fullName(r.employee).toLowerCase().includes(s) || r.employee?.employee_code?.toLowerCase().includes(s));
  }, [q.data, f.search]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: typeof e === "string" ? e : e.target.value }));
  const cancellable = (r) => canHrCancel && r.employee_id !== hr?.employee?.id && ["pending_approval", "approved"].includes(r.status);
  const recalculable = (r) => r.holiday_review_required && r.employee_id !== hr?.employee?.id && ["pending_approval", "approved"].includes(r.status)
    && (canHrCancel || r.status === "pending_approval");

  return (
    <>
      <Toolbar>
        <Field label="Status" className="sm:w-44"><Select placeholder="All" value={f.status} onChange={set("status")} options={LEAVE_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} /></Field>
        <Field label="Type" className="sm:w-44"><Select placeholder="All types" value={f.type} onChange={set("type")} options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))} /></Field>
        <Field label="Employee" className="sm:w-56"><Select placeholder="Everyone" value={f.employee} onChange={set("employee")} options={employees.data ?? []} /></Field>
        <Field label="From" className="sm:w-40"><Input type="date" value={f.from} onChange={set("from")} /></Field>
        <Field label="To" className="sm:w-40"><Input type="date" value={f.to} onChange={set("to")} /></Field>
      </Toolbar>
      <Toolbar>
        <SearchInput value={f.search} onChange={set("search")} placeholder="Search name or ID…" label="Search employees" />
        <label className="inline-flex items-center gap-2 self-center text-sm text-[#173a52]"><input type="checkbox" className="h-4 w-4" checked={f.review} onChange={(e) => setF((s) => ({ ...s, review: e.target.checked }))} />Needs holiday review only</label>
        {hasPermission("leave.export") && (
          <Button variant="secondary" disabled={!rows.length} onClick={() => {
            exportCsv(`leave-requests-${f.from}-to-${f.to}`, rows, [
              { label: "Employee ID", value: (r) => r.employee?.employee_code }, { label: "Employee", value: (r) => fullName(r.employee) },
              { label: "Leave type", value: (r) => r.leave_type?.code }, { label: "Start", key: "start_date" }, { label: "End", key: "end_date" },
              { label: "Part", value: (r) => halfLabel(r) }, { label: "Days", key: "days" }, { label: "Status", key: "status" }, { label: "Level", key: "current_level" },
              { label: "Reason", key: "reason" }, { label: "Decision note", key: "decision_note" }, { label: "Applied at", key: "created_at" }, { label: "Decided at", key: "decided_at" },
            ]);
            notify(`Exported ${rows.length} requests.`);
          }}><Download className="h-4 w-4" aria-hidden="true" />Export CSV</Button>
        )}
      </Toolbar>
      <DataTable caption="Leave requests" rows={rows} loading={q.loading} error={q.error} onRetry={q.reload} onRowClick={setDetail} pageSize={50}
        emptyTitle="No leave requests" emptyDescription="Nothing matches these filters."
        columns={[
          { key: "employee", header: "Employee", sortable: true, sortValue: (r) => fullName(r.employee).toLowerCase(), render: (r) => <EmpCell e={r.employee} /> },
          { key: "type", header: "Type", render: (r) => r.leave_type?.name },
          { key: "start_date", header: "Dates", sortable: true, render: (r) => <span className="flex flex-col gap-1 whitespace-nowrap">{dates(r)}<ReviewBadge r={r} /></span> },
          { key: "days", header: "Days", render: (r) => num(r.days) },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "current_level", header: "Level", render: (r) => r.current_level ?? "—" },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (
            <div className="flex flex-wrap gap-1">
              {recalculable(r) && <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); act({ kind: "recalc", row: r }); }}>Recalculate</Button>}
              {cancellable(r) && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); act({ kind: "cancel", row: r }); }}>Cancel</Button>}
            </div>) },
        ]} />
      {detail && <RequestDetailModal request={detail} onClose={() => setDetail(null)}
        actions={<>
          {recalculable(detail) && <Button variant="secondary" onClick={() => act({ kind: "recalc", row: detail })}>Recalculate</Button>}
          {cancellable(detail) && <Button variant="danger" onClick={() => act({ kind: "cancel", row: detail })}>Cancel leave</Button>}
        </>} />}
      {dialog}
    </>
  );
}

function Balances({ tz }) {
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const thisYear = Number(businessToday(tz).slice(0, 4));
  const types = useHrQuery(() => listLeaveTypes(), []);
  const employees = useEmployeeOptions();
  const [f, setF] = useState({ year: String(thisYear), employee: "", type: "", search: "" });
  const q = useHrQuery(() => listBalances({ year: Number(f.year), employee: f.employee, type: f.type }), [f.year, f.employee, f.type]);
  const adj = useHrQuery(() => (f.employee ? listAdjustments({ employee: f.employee, year: Number(f.year) }) : Promise.resolve({ data: null, error: null })), [f.employee, f.year]);
  const ledger = useHrQuery(() => (f.employee ? listLedger({ employee: f.employee, year: Number(f.year), type: f.type }) : Promise.resolve({ data: null, error: null })), [f.employee, f.year, f.type]);
  const [adjusting, setAdjusting] = useState(null);
  const rows = useMemo(() => {
    const s = f.search.trim().toLowerCase();
    return (q.data ?? []).filter((r) => !s || fullName(r.employee).toLowerCase().includes(s) || r.employee?.employee_code?.toLowerCase().includes(s))
      .sort((a, b) => fullName(a.employee).localeCompare(fullName(b.employee)) || (a.leave_type?.sort_order ?? 0) - (b.leave_type?.sort_order ?? 0));
  }, [q.data, f.search]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: typeof e === "string" ? e : e.target.value }));
  const canAdjust = hasPermission("leave.adjust");

  return (
    <>
      <Toolbar>
        <Field label="Year" className="sm:w-32"><Select value={f.year} onChange={set("year")} options={[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => ({ value: String(y), label: String(y) }))} /></Field>
        <Field label="Employee" className="sm:w-56"><Select placeholder="Everyone" value={f.employee} onChange={set("employee")} options={employees.data ?? []} /></Field>
        <Field label="Type" className="sm:w-44"><Select placeholder="All types" value={f.type} onChange={set("type")} options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))} /></Field>
        <div className="flex flex-1 flex-wrap items-end gap-2 self-stretch sm:self-end">
          <SearchInput value={f.search} onChange={set("search")} placeholder="Search name or ID…" label="Search employees" />
          {hasPermission("leave.export") && (
            <Button variant="secondary" disabled={!rows.length} onClick={() => {
              exportCsv(`leave-balances-${f.year}`, rows, [
                { label: "Employee ID", value: (r) => r.employee?.employee_code }, { label: "Employee", value: (r) => fullName(r.employee) },
                { label: "Leave type", value: (r) => r.leave_type?.code }, { label: "Year", key: "year" }, { label: "Entitled", key: "entitled" },
                { label: "Accrued", key: "accrued" }, { label: "Carried forward", key: "carried_forward" }, { label: "Adjusted", key: "adjusted" },
                { label: "Used", key: "used" }, { label: "Pending", key: "pending" }, { label: "Available", key: "available" },
              ]);
              notify(`Exported ${rows.length} balances.`);
            }}><Download className="h-4 w-4" aria-hidden="true" />Export CSV</Button>
          )}
          {canAdjust && <Button variant="secondary" onClick={() => setAdjusting({ employee: f.employee, type: f.type, year: f.year, mode: "opening" })}>Opening balance</Button>}
          {canAdjust && <Button onClick={() => setAdjusting({ employee: f.employee, type: f.type, year: f.year })}><SlidersHorizontal className="h-4 w-4" aria-hidden="true" />Adjust balance</Button>}
        </div>
      </Toolbar>
      <p className="mb-3 text-xs text-slate-500">Balance rows are created when the year is initialised or when an employee first views or applies for leave. Available = accrued + carried forward + adjusted − used − pending (opening balances and expired carry-forward are part of adjusted). Choose an employee to see the full ledger.</p>
      <DataTable caption="Leave balances" rows={rows} loading={q.loading} error={q.error} onRetry={q.reload} pageSize={50}
        emptyTitle="No balances for this year" emptyDescription="Initialise the leave year (Leave year tab) to create balances for everyone."
        columns={[
          { key: "employee", header: "Employee", render: (r) => <EmpCell e={r.employee} /> },
          { key: "type", header: "Type", render: (r) => r.leave_type?.name },
          { key: "accrued", header: "Accrued / entitled", render: (r) => `${num(r.accrued)} / ${num(r.entitled)}` },
          { key: "carried_forward", header: "Carried fwd", render: (r) => num(r.carried_forward) },
          { key: "opening", header: "Opening", render: (r) => num(r.opening) },
          { key: "adjusted", header: "Adjusted", render: (r) => num(r.adjusted) },
          { key: "used", header: "Used", render: (r) => num(r.used) },
          { key: "pending", header: "Pending", render: (r) => num(r.pending) },
          { key: "available", header: "Available", sortable: true, sortValue: (r) => Number(r.available), render: (r) => <span className={Number(r.available) < 0 ? "font-bold text-red-600" : "font-bold text-[#101a3a]"}>{num(r.available)}</span> },
          ...(canAdjust ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => <Button size="sm" variant="ghost" onClick={() => setAdjusting({ employee: r.employee_id, type: r.leave_type_id, year: String(r.year) })}>Adjust</Button> }] : []),
        ]} />
      {f.employee && (
        <div className="mt-4">
          <Card title="Adjustment history" padded={false}>
            <DataTable caption="Balance adjustments" rows={adj.data} loading={adj.loading} error={adj.error} onRetry={adj.reload} emptyTitle="No adjustments this year"
              columns={[
                { key: "created_at", header: "When", render: (r) => formatDateTime(r.created_at) },
                { key: "type", header: "Type", render: (r) => r.leave_type?.name },
                { key: "kind", header: "Kind", render: (r) => <Badge tone={r.kind === "manual" ? "violet" : "blue"}>{r.kind.replace(/_/g, " ")}</Badge> },
                { key: "delta", header: "Change", render: (r) => <span className={Number(r.delta) < 0 ? "text-red-600" : "text-emerald-700"}>{Number(r.delta) > 0 ? "+" : ""}{num(r.delta)}</span> },
                { key: "reason", header: "Reason" },
              ]} />
          </Card>
          <div className="mt-4">
            <Card title="Balance ledger" padded={false}>
              <DataTable caption="Leave balance ledger" rows={ledger.data} loading={ledger.loading} error={ledger.error} onRetry={ledger.reload} emptyTitle="No ledger entries this year" pageSize={25}
                columns={[
                  { key: "created_at", header: "When", render: (r) => formatDateTime(r.created_at) },
                  { key: "type", header: "Type", render: (r) => r.leave_type?.code },
                  { key: "entry_type", header: "Entry", render: (r) => <Badge tone={["consume", "reserve"].includes(r.entry_type) ? "blue" : ["release", "restore"].includes(r.entry_type) ? "green" : r.entry_type === "expiry" ? "red" : "slate"}>{LEDGER_LABELS[r.entry_type] ?? r.entry_type}</Badge> },
                  { key: "bucket", header: "Bucket", render: (r) => r.bucket.replace(/_/g, " ") },
                  { key: "effect", header: "Effect on available", render: (r) => (Number(r.effect) === 0 ? <span className="text-slate-400">—</span> : <span className={Number(r.effect) < 0 ? "text-red-600" : "text-emerald-700"}>{Number(r.effect) > 0 ? "+" : ""}{num(r.effect)}</span>) },
                  { key: "available_after", header: "Available after", render: (r) => num(r.available_after) },
                  { key: "reason", header: "Note", render: (r) => <span className="text-xs">{r.reason ?? (r.request_id ? "Leave request" : "")}</span> },
                ]} />
            </Card>
          </div>
        </div>
      )}
      {adjusting && <AdjustModal initial={adjusting} types={types.data ?? []} employees={employees.data ?? []} thisYear={thisYear}
        onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); q.reload(); adj.reload(); ledger.reload(); notify(adjusting.mode === "opening" ? "Opening balance saved. The employee has been notified." : "Balance adjusted. The employee has been notified."); }} />}
    </>
  );
}

function AdjustModal({ initial, types, employees, thisYear, onClose, onSaved }) {
  const { hr } = useAuth();
  const opening = initial.mode === "opening";
  const [v, setV] = useState({ employee: initial.employee || "", type: initial.type || "", year: initial.year || String(thisYear), delta: "", reason: "" });
  const [errors, setErrors] = useState({});
  const [step, setStep] = useState("edit");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const empLabel = employees.find((o) => o.value === v.employee)?.label;
  const typeName = types.find((t) => t.id === v.type)?.name;
  function review() {
    const errs = {};
    if (!v.employee) errs.employee = "Choose an employee."; else if (v.employee === hr?.employee?.id) errs.employee = "You cannot adjust your own balance.";
    if (!v.type) errs.type = "Choose a leave type.";
    const d = Number(v.delta);
    if (opening) {
      if (v.delta === "" || !Number.isFinite(d) || d < 0 || d > 366 || Math.round(d * 2) !== d * 2) errs.delta = "Enter 0–366 days, in half days.";
    } else if (v.delta === "" || !Number.isFinite(d) || d === 0) errs.delta = "Enter a non-zero number of days (negative to deduct).";
    else if (Math.round(d * 100) !== d * 100 || Math.abs(d) > 365) errs.delta = "Up to 2 decimals, at most 365 days.";
    if (v.reason.trim().length < 3) errs.reason = "A reason is required (at least 3 characters).";
    setErrors(errs);
    if (!Object.keys(errs).length) setStep("confirm");
  }
  async function save() {
    setBusy(true); setError(null);
    const res = opening
      ? await setOpeningBalance({ employee: v.employee, type: v.type, year: v.year, days: v.delta, reason: v.reason })
      : await adjustBalance({ employee: v.employee, type: v.type, year: v.year, delta: v.delta, reason: v.reason });
    setBusy(false);
    if (res.error) { setError(res.error); setStep("edit"); } else onSaved();
  }
  return (
    <Modal open onClose={onClose} title={opening ? "Set opening balance" : "Adjust leave balance"} size="md"
      footer={step === "edit"
        ? <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={review}>Review</Button></>
        : <><Button variant="secondary" onClick={() => setStep("edit")} disabled={busy}>Back</Button><Button loading={busy} onClick={save}>Confirm adjustment</Button></>}>
      {step === "edit" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Employee" required error={errors.employee} className="sm:col-span-2"><Select placeholder="Choose employee" value={v.employee} onChange={set("employee")} options={employees} /></Field>
          <Field label="Leave type" required error={errors.type}><Select placeholder="Choose type" value={v.type} onChange={set("type")} options={types.map((t) => ({ value: t.id, label: t.name }))} /></Field>
          <Field label="Year" required><Select value={v.year} onChange={set("year")} options={[thisYear - 1, thisYear, thisYear + 1].map((y) => ({ value: String(y), label: String(y) }))} /></Field>
          <Field label={opening ? "Opening balance (days)" : "Days (+ add / − deduct)"} required error={errors.delta}
            hint={opening ? "Balance brought over from a previous system. Changing it later applies only the difference." : undefined}>
            <Input type="number" step="0.5" min={opening ? 0 : undefined} value={v.delta} onChange={set("delta")} /></Field>
          <Field label="Reason" required error={errors.reason} className="sm:col-span-2"><Textarea maxLength={1000} value={v.reason} onChange={set("reason")} /></Field>
        </div>
      ) : (
        <p className="text-sm text-slate-700">{opening
          ? <>Set the opening balance of <strong>{typeName}</strong> for <strong>{empLabel}</strong> in {v.year} to <strong>{v.delta}</strong> day(s)?</>
          : <>Apply <strong>{Number(v.delta) > 0 ? "+" : ""}{v.delta}</strong> day(s) of <strong>{typeName}</strong> for <strong>{empLabel}</strong> in {v.year}?</>} This is recorded permanently in the adjustment history, the balance ledger and the audit log, and the employee is notified.</p>
      )}
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function YearSetup({ tz }) {
  return (
    <div className="flex flex-col gap-4">
      <YearInit tz={tz} />
      <YearEnd tz={tz} />
    </div>
  );
}

function YearEnd({ tz }) {
  const { notify } = useToast();
  const today = businessToday(tz);
  const thisYear = Number(today.slice(0, 4));
  const years = useHrQuery(() => listLeaveYears(), []);
  const [closing, setClosing] = useState(null);
  const [expiring, setExpiring] = useState(false);
  const closed = (y) => (years.data ?? []).some((r) => r.year === y && r.status === "closed");
  const candidates = [thisYear - 2, thisYear - 1, ...(today.slice(5, 7) === "12" ? [thisYear] : [])];
  return (
    <Card title="Expiry and year-end">
      <p className="mb-3 text-sm text-slate-600">
        <strong>Carry-forward expiry</strong> removes carried-forward days that were not used by the policy's expiry date (it also runs automatically when a balance is viewed).
        <strong> Closing a year</strong> finalises its accrual, carries each final balance forward (up to the policy maximum, correcting any earlier estimate),
        records the days that lapse, and freezes the year: its balances can no longer change. All pending requests in the year must be decided first.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="secondary" onClick={() => setExpiring(true)}><Clock className="h-4 w-4" aria-hidden="true" />Process carry-forward expiry ({thisYear})</Button>
        {candidates.filter((y) => !closed(y)).map((y) => (
          <Button key={y} onClick={() => setClosing(y)}><Lock className="h-4 w-4" aria-hidden="true" />Close leave year {y}</Button>
        ))}
      </div>
      <div className="mt-4">
        <DataTable caption="Leave years" rows={years.data} loading={years.loading} error={years.error} onRetry={years.reload} rowKey="year" emptyTitle="No leave year has been closed yet"
          columns={[
            { key: "year", header: "Year" },
            { key: "status", header: "Status", render: (r) => <Badge tone={r.status === "closed" ? "slate" : "green"}>{r.status}</Badge> },
            { key: "closed_at", header: "Closed", render: (r) => (r.closed_at ? formatDateTime(r.closed_at) : "—") },
            { key: "summary", header: "Summary", render: (r) => (r.summary ? <span className="text-xs">{r.summary.balances} balances · {num(r.summary.days_carried)} days carried · {num(r.summary.days_lapsed)} days lapsed</span> : "—") },
          ]} />
      </div>
      <ConfirmDialog open={expiring} onClose={() => setExpiring(false)} title="Process carry-forward expiry?" confirmLabel="Process"
        message={`Unused carried-forward days whose expiry date has passed are removed from ${thisYear} balances. Each employee affected is notified.`}
        onConfirm={async () => {
          const res = await processLeaveExpiry(thisYear);
          if (res.error) return { error: res.error };
          notify(`${res.data?.balances ?? 0} balance(s) updated, ${num(res.data?.days ?? 0)} day(s) expired.`);
          return {};
        }} />
      <ConfirmDialog open={Boolean(closing)} onClose={() => setClosing(null)} title={`Close leave year ${closing}?`} tone="danger" confirmLabel={`Close ${closing}`}
        message={`This cannot be undone. ${closing} balances are finalised and frozen, and ${closing ? closing + 1 : ""} carry-forward is set from the final balances.`}
        onConfirm={async () => {
          const res = await closeLeaveYear(closing);
          if (res.error) return { error: res.error };
          notify(`Leave year ${closing} closed: ${num(res.data?.days_carried)} day(s) carried forward, ${num(res.data?.days_lapsed)} lapsed.`);
          years.reload();
          return {};
        }} />
    </Card>
  );
}

function YearInit({ tz }) {
  const { notify } = useToast();
  const thisYear = Number(businessToday(tz).slice(0, 4));
  const [year, setYear] = useState(String(thisYear));
  const [confirm, setConfirm] = useState(false);
  return (
    <Card title="Initialise a leave year">
      <p className="mb-3 text-sm text-slate-600">
        Creates a balance row for every current employee and every active leave type they are eligible for, applying each type's entitlement
        (prorated from the joining month), accrual and carry-forward rules. It is safe to run more than once: existing balances are never changed.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Year" className="w-40"><Select value={year} onChange={(e) => setYear(e.target.value)} options={[thisYear - 1, thisYear, thisYear + 1].map((y) => ({ value: String(y), label: String(y) }))} /></Field>
        <Button onClick={() => setConfirm(true)}><CalendarPlus className="h-4 w-4" aria-hidden="true" />Initialise {year}</Button>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title={`Initialise leave year ${year}?`} confirmLabel="Initialise"
        message="Missing balances will be created for all current employees. Carry-forward is calculated once, when a balance is created."
        onConfirm={async () => {
          const res = await initializeLeaveYear(year);
          if (res.error) return { error: res.error };
          notify(`${res.data ?? 0} balance(s) created for ${year}.`);
          return {};
        }} />
    </Card>
  );
}
