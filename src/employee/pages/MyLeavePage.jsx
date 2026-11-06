// Employee "My Leave": balances, apply (eligibility-aware, live server-side
// day-count preview, real supporting-document upload), leave history with
// filters, approval progress per request, direct cancellation (pending, or
// approved leave not yet started), cancellation REQUESTS to HR for approved
// leave that has already started (migration 161), clarification replies,
// balance history (ledger), a year holiday calendar for my location/company
// and the team leave calendar (scoped by the server; colleagues' leave shows
// only "On leave", never the reason).
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Circle, Clock, Paperclip, Plus, Undo2, X } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { businessToday, monthRange, useBusinessTimezone } from "@/lib/hr/attendance";
import { DOC_ACCEPT, checkDocumentFile, uploadDocument } from "@/lib/hr/documents";
import {
  LEAVE_DOC_CATEGORY, LEAVE_EVENT_LABELS, LEDGER_LABELS, applyLeave, calculateDays, cancelLeave, halfLabel, leaveCalendar, listLedger,
  listMyRequests, listRequestEvents, myBalances, myHolidays, myLeaveTypes, pendingClarification, requestCancellation, respondClarification,
  withdrawCancellation,
} from "@/lib/hr/leave";
import { loadEmployeeOptions } from "@/lib/hr/org";
import {
  Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal, PageHeader, Select,
  StatusBadge, Tabs, Textarea, useToast,
} from "@/hr/ui";

const num = (n) => (n == null ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const dateSpan = (r) => `${formatDate(r.start_date)}${r.end_date !== r.start_date ? ` – ${formatDate(r.end_date)}` : ""}`;
const levelName = (level) => (level === "hr" ? "HR" : level === "manager" ? "your manager" : level);
const STATUS_FILTERS = [
  { value: "", label: "All statuses" }, { value: "pending_approval", label: "Pending approval" }, { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" }, { value: "cancelled", label: "Cancelled" },
];

/** Cancelled directly by the employee: pending, or approved and not started. */
const canCancelDirect = (r, today) => r.status === "pending_approval" || (r.status === "approved" && r.start_date > today);
/** Needs HR: approved leave that has started, with no cancellation already waiting. */
const canRequestCancel = (r, today) => r.status === "approved" && r.start_date <= today && r.cancellation_status !== "pending";

function CancellationBadge({ r }) {
  if (r.cancellation_status === "pending") return <Badge tone="amber">cancellation pending with HR</Badge>;
  if (r.cancellation_status === "rejected") return <Badge tone="red">cancellation rejected</Badge>;
  if (r.status === "cancelled" && r.cancellation_decided_at) return <Badge tone="slate">cancelled on your request</Badge>;
  return null;
}

export default function MyLeavePage() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const { notify } = useToast();
  const tz = useBusinessTimezone();
  const today = businessToday(tz);
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [tab, setTab] = useState("overview");
  const balances = useHrQuery(() => myBalances(year), [year]);
  const requests = useHrQuery(() => listMyRequests(me), [me]);
  const [applying, setApplying] = useState(false);
  const [detail, setDetail] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [askCancel, setAskCancel] = useState(null);
  const [withdrawing, setWithdrawing] = useState(null);
  const reloadAll = () => { requests.reload(); balances.reload(); };

  const rows = requests.data ?? [];
  const pendingCancellations = rows.filter((r) => r.cancellation_status === "pending").length;
  const actions = { open: setDetail, cancel: setCancelling, requestCancel: setAskCancel, withdraw: setWithdrawing };

  return (
    <>
      <PageHeader title="My Leave" description="Apply for leave, track approvals, check your balance and see the holiday calendar."
        actions={<Button onClick={() => setApplying(true)}><Plus className="h-4 w-4" aria-hidden="true" />Apply for leave</Button>} />
      <Tabs value={tab} onChange={setTab} label="Leave sections" tabs={[
        { value: "overview", label: "Overview" },
        { value: "history", label: "Leave history" },
        { value: "cancellations", label: pendingCancellations ? `Cancellation requests (${pendingCancellations})` : "Cancellation requests" },
        { value: "ledger", label: "Balance history" },
        { value: "holidays", label: "Holiday calendar" },
        { value: "calendar", label: "Team calendar" },
      ]} />

      {(tab === "overview" || tab === "ledger" || tab === "holidays") && (
        <div className="mb-3 flex items-center gap-2">
          <label htmlFor="leave-year" className="text-sm font-semibold text-[#173a52]">Year</label>
          <select id="leave-year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border border-slate-200 px-2 py-1 text-sm">
            {[thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      )}

      {tab === "overview" && (
        <>
          <BalanceCards balances={balances} />
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AwaitingCard rows={rows} loading={requests.loading} error={requests.error} onRetry={requests.reload} onOpen={setDetail} onAll={() => setTab("history")} />
            <UpcomingCard rows={rows} today={today} onOpen={setDetail} />
          </div>
          <div className="mt-4"><NextHolidays today={today} onAll={() => setTab("holidays")} /></div>
        </>
      )}
      {tab === "history" && <History requests={requests} today={today} actions={actions} />}
      {tab === "cancellations" && <Cancellations requests={requests} today={today} actions={actions} />}
      {tab === "ledger" && <MyLedger me={me} year={year} />}
      {tab === "holidays" && <HolidayCalendar year={year} today={today} myLeave={rows} />}
      {tab === "calendar" && <LeaveCalendar tz={tz} />}

      {applying && <ApplyModal today={today} me={me} onClose={() => setApplying(false)} onApplied={(r) => { setApplying(false); reloadAll(); notify(`Leave applied: ${num(r?.days)} day(s), awaiting ${r?.current_level ?? "approval"}.`); }} />}
      {detail && <RequestDetail request={detail} today={today} actions={actions} onClose={() => setDetail(null)} />}
      <ConfirmDialog open={Boolean(cancelling)} onClose={() => setCancelling(null)} title="Cancel leave request?" tone="danger" confirmLabel="Cancel leave"
        message={cancelling ? `${cancelling.leave_type?.name}: ${dateSpan(cancelling)} (${num(cancelling.days)} day(s)). The days return to your balance.` : ""}
        requireReason={false} reasonLabel="Note (optional)"
        onConfirm={async (note) => {
          const res = await cancelLeave(cancelling.id, note);
          if (res.error) return { error: res.error };
          notify("Leave cancelled."); setDetail(null); reloadAll();
          return {};
        }} />
      <ConfirmDialog open={Boolean(askCancel)} onClose={() => setAskCancel(null)} title="Request cancellation from HR" confirmLabel="Send request"
        message={askCancel ? `${askCancel.leave_type?.name}: ${dateSpan(askCancel)} (${num(askCancel.days)} day(s)). This leave has already started, so HR has to approve the cancellation. If HR approves, the whole request is cancelled and all its days return to your balance; apply again for any of those days you did take. Until HR decides, the leave stays approved.` : ""}
        requireReason reasonLabel="Why should this leave be cancelled?"
        onConfirm={async (reason) => {
          if (reason.length < 3) return { error: "Give a reason (at least 3 characters)." };
          const res = await requestCancellation(askCancel.id, reason);
          if (res.error) return { error: res.error };
          notify("Cancellation request sent to HR."); setDetail(null); reloadAll();
          return {};
        }} />
      <ConfirmDialog open={Boolean(withdrawing)} onClose={() => setWithdrawing(null)} title="Withdraw cancellation request?" confirmLabel="Withdraw request"
        message={withdrawing ? `Your leave ${dateSpan(withdrawing)} stays approved and HR no longer needs to act on it.` : ""}
        onConfirm={async () => {
          const res = await withdrawCancellation(withdrawing.id);
          if (res.error) return { error: res.error };
          notify("Cancellation request withdrawn."); setDetail(null); reloadAll();
          return {};
        }} />
    </>
  );
}

// ---------------------------------------------------------------- overview
function BalanceCards({ balances }) {
  if (balances.loading && !balances.data) return <Loading />;
  if (balances.error) return <ErrorState message={balances.error} onRetry={balances.reload} />;
  if (!balances.data?.length) return <Card><EmptyState title="No leave types available" description="HR has not configured any active leave types." /></Card>;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {balances.data.map((b) => {
        const used = Number(b.used ?? 0);
        const pending = Number(b.pending ?? 0);
        const total = used + pending + Math.max(0, Number(b.available ?? 0));
        const usedPct = total > 0 ? (used / total) * 100 : 0;
        const pendPct = total > 0 ? (pending / total) * 100 : 0;
        return (
          <div key={b.balance_id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-bold text-[#101a3a]">{b.name}</p>
              <Badge tone={b.paid ? "green" : "slate"}>{b.paid ? "paid" : "unpaid"}</Badge>
            </div>
            <p className="mt-1 text-3xl font-extrabold text-[#101a3a]">{num(b.available)}<span className="ml-1 text-sm font-semibold text-slate-500">available</span></p>
            {total > 0 && (
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${num(used)} used and ${num(pending)} pending of ${num(total)} day(s)`}>
                <span className="bg-[#f96706]" style={{ width: `${usedPct}%` }} />
                <span className="bg-amber-300" style={{ width: `${pendPct}%` }} />
              </div>
            )}
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
              <dt>Accrued</dt><dd className="text-right">{num(b.accrued)} / {num(b.entitled)}</dd>
              <dt>Carried forward</dt><dd className="text-right">{num(b.carried_forward)}</dd>
              {Number(b.opening) > 0 && <><dt>Opening balance</dt><dd className="text-right">{num(b.opening)}</dd></>}
              <dt>Adjusted</dt><dd className="text-right">{num(b.adjusted)}</dd>
              <dt>Used</dt><dd className="text-right">{num(b.used)}</dd>
              <dt>Pending approval</dt><dd className="text-right">{num(b.pending)}</dd>
            </dl>
            {b.cf_expires_on && Number(b.carried_forward) > 0 && (
              <p className={`mt-2 text-xs ${Number(b.cf_expired) > 0 ? "text-slate-500" : "font-semibold text-orange-700"}`}>
                {Number(b.cf_expired) > 0 ? `${num(b.cf_expired)} carried-forward day(s) expired on ${formatDate(b.cf_expires_on)}.` : `Carried-forward days expire on ${formatDate(b.cf_expires_on)} if unused.`}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MiniRow({ r, onOpen, children }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen(r)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f96706]">
        <span className="min-w-0">
          <span className="block font-semibold text-[#101a3a]">{r.leave_type?.name ?? "Leave"} · {num(r.days)} day(s)</span>
          <span className="block text-xs text-slate-500">{dateSpan(r)}{halfLabel(r) && r.start_date === r.end_date ? ` · ${halfLabel(r)}` : ""}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">{children}</span>
      </button>
    </li>
  );
}

function AwaitingCard({ rows, loading, error, onRetry, onOpen, onAll }) {
  const pending = rows.filter((r) => r.status === "pending_approval" || r.cancellation_status === "pending");
  return (
    <Card title="Awaiting a decision" actions={<Button size="sm" variant="ghost" onClick={onAll}>Leave history</Button>}>
      {loading && !rows.length ? <Loading /> : error ? <ErrorState message={error} onRetry={onRetry} /> : !pending.length ? (
        <p className="text-sm text-slate-500">Nothing pending. Requests you apply for appear here until they are decided.</p>
      ) : (
        <ul className="-mx-2 flex flex-col divide-y divide-slate-100">
          {pending.map((r) => (
            <MiniRow key={r.id} r={r} onOpen={onOpen}>
              {r.status === "pending_approval"
                ? <><StatusBadge status={r.status} />{r.current_level && <span className="text-xs text-slate-500">with {levelName(r.current_level)}</span>}</>
                : <CancellationBadge r={r} />}
            </MiniRow>
          ))}
        </ul>
      )}
    </Card>
  );
}

function UpcomingCard({ rows, today, onOpen }) {
  const upcoming = rows.filter((r) => r.status === "approved" && r.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date)).slice(0, 5);
  return (
    <Card title="Upcoming and current leave">
      {!upcoming.length ? <p className="text-sm text-slate-500">No approved leave coming up.</p> : (
        <ul className="-mx-2 flex flex-col divide-y divide-slate-100">
          {upcoming.map((r) => (
            <MiniRow key={r.id} r={r} onOpen={onOpen}>
              {r.start_date <= today ? <Badge tone="blue">on leave now</Badge> : <Badge tone="green">approved</Badge>}
              <CancellationBadge r={r} />
            </MiniRow>
          ))}
        </ul>
      )}
    </Card>
  );
}

function NextHolidays({ today, onAll }) {
  const until = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  const q = useHrQuery(() => myHolidays(today, until), [today, until]);
  const next = (q.data ?? []).filter((h) => h.holiday_date >= today).slice(0, 4);
  return (
    <Card title="Next holidays" actions={<Button size="sm" variant="ghost" onClick={onAll}>Holiday calendar</Button>}>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !next.length ? (
        <p className="text-sm text-slate-500">No upcoming holidays configured for your location.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {next.map((h) => (
            <li key={`${h.id}-${h.holiday_date}`} className="rounded-xl border border-slate-200 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{formatDate(h.holiday_date, { weekday: "short", day: "2-digit", month: "short" })}</p>
              <p className="font-semibold text-[#101a3a]">{h.name}</p>
              <Badge tone={h.type === "optional" ? "violet" : "blue"}>{h.type}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- history
function RowActions({ r, today, actions }) {
  return (
    <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
      <Button size="sm" variant="ghost" onClick={() => actions.open(r)}>Details</Button>
      {canCancelDirect(r, today) && <Button size="sm" variant="ghost" onClick={() => actions.cancel(r)}>Cancel</Button>}
      {canRequestCancel(r, today) && <Button size="sm" variant="ghost" onClick={() => actions.requestCancel(r)}>Request cancellation</Button>}
      {r.cancellation_status === "pending" && <Button size="sm" variant="ghost" onClick={() => actions.withdraw(r)}>Withdraw request</Button>}
    </div>
  );
}

function History({ requests, today, actions }) {
  const [f, setF] = useState({ status: "", year: "", type: "" });
  const all = useMemo(() => requests.data ?? [], [requests.data]);
  const years = useMemo(() => [...new Set(all.map((r) => String(r.year ?? r.start_date.slice(0, 4))))].sort().reverse(), [all]);
  const types = useMemo(() => [...new Map(all.filter((r) => r.leave_type).map((r) => [r.leave_type.id, r.leave_type.name])).entries()], [all]);
  const rows = useMemo(() => all.filter((r) => (!f.status || r.status === f.status)
    && (!f.year || String(r.year ?? r.start_date.slice(0, 4)) === f.year) && (!f.type || r.leave_type_id === f.type)), [all, f]);
  const approvedDays = rows.filter((r) => r.status === "approved").reduce((s, r) => s + Number(r.days ?? 0), 0);
  const pendingDays = rows.filter((r) => r.status === "pending_approval").reduce((s, r) => s + Number(r.days ?? 0), 0);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Card title="Leave history" padded={false}>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-4 py-3">
        <Field label="Status" className="w-44"><Select value={f.status} onChange={set("status")} options={STATUS_FILTERS} /></Field>
        <Field label="Year" className="w-32"><Select value={f.year} onChange={set("year")} options={[{ value: "", label: "All years" }, ...years.map((y) => ({ value: y, label: y }))]} /></Field>
        <Field label="Type" className="w-44"><Select value={f.type} onChange={set("type")} options={[{ value: "", label: "All types" }, ...types.map(([value, label]) => ({ value, label }))]} /></Field>
        <p className="text-xs text-slate-500 sm:ml-auto">{rows.length} request(s) · {num(approvedDays)} day(s) approved{pendingDays ? ` · ${num(pendingDays)} pending` : ""}</p>
      </div>
      <DataTable caption="My leave requests" rows={rows} loading={requests.loading} error={requests.error} onRetry={requests.reload}
        emptyTitle={all.length ? "No requests match these filters" : "No leave requests yet"} onRowClick={actions.open} pageSize={20}
        columns={[
          { key: "type", header: "Type", render: (r) => <span>{r.leave_type?.name ?? "—"}{r.document_id && <Paperclip className="ml-1 inline h-3.5 w-3.5 text-slate-500" aria-label="Document attached" />}</span> },
          { key: "dates", header: "Dates", render: (r) => <span className="whitespace-nowrap">{dateSpan(r)}</span> },
          { key: "half", header: "Part", render: (r) => halfLabel(r) || "—" },
          { key: "days", header: "Days", render: (r) => num(r.days) },
          { key: "status", header: "Approval status", render: (r) => (
            <span className="flex flex-col items-start gap-1">
              <StatusBadge status={r.status} />
              {r.status === "pending_approval" && r.current_level && <span className="text-xs text-slate-500">with {levelName(r.current_level)}</span>}
              <CancellationBadge r={r} />
            </span>) },
          { key: "created_at", header: "Applied", render: (r) => formatDate(r.created_at) },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => <RowActions r={r} today={today} actions={actions} /> },
        ]} />
      <p className="px-4 py-3 text-xs text-slate-500">You can cancel pending requests, and approved leave that has not started yet, yourself. For approved leave that has already started, send a cancellation request; HR decides it.</p>
    </Card>
  );
}

// ---------------------------------------------------------------- cancellations
function Cancellations({ requests, today, actions }) {
  const all = requests.data ?? [];
  const requested = all.filter((r) => r.cancellation_requested_at)
    .sort((a, b) => (b.cancellation_requested_at ?? "").localeCompare(a.cancellation_requested_at ?? ""));
  const eligible = all.filter((r) => canRequestCancel(r, today) && !r.cancellation_status);
  const outcome = (r) => (r.cancellation_status === "pending" ? <Badge tone="amber">pending with HR</Badge>
    : r.cancellation_status === "rejected" ? <Badge tone="red">rejected</Badge>
      : r.status === "cancelled" ? <Badge tone="green">approved · leave cancelled</Badge> : <Badge tone="slate">withdrawn</Badge>);
  return (
    <div className="flex flex-col gap-4">
      <Card title="My cancellation requests" padded={false}>
        <DataTable caption="My cancellation requests" rows={requested} loading={requests.loading} error={requests.error} onRetry={requests.reload}
          emptyTitle="No cancellation requests" emptyDescription="When you ask HR to cancel leave that has already started, it is tracked here." onRowClick={actions.open}
          columns={[
            { key: "leave", header: "Leave", render: (r) => <span className="flex flex-col"><span className="font-semibold">{r.leave_type?.name}</span><span className="text-xs text-slate-500">{dateSpan(r)} · {num(r.days)} day(s)</span></span> },
            { key: "requested", header: "Requested", render: (r) => formatDateTime(r.cancellation_requested_at) },
            { key: "reason", header: "Your reason", render: (r) => <span className="line-clamp-2 text-xs">{r.cancellation_reason}</span> },
            { key: "outcome", header: "Outcome", render: (r) => <span className="flex flex-col items-start gap-1">{outcome(r)}{r.cancellation_decision_note && <span className="text-xs text-slate-500">HR: {r.cancellation_decision_note}</span>}</span> },
            { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => <RowActions r={r} today={today} actions={actions} /> },
          ]} />
      </Card>
      <Card title="Leave you can ask HR to cancel">
        {!eligible.length ? <p className="text-sm text-slate-500">No approved leave that has already started. Leave that has not started can be cancelled directly from Leave history.</p> : (
          <ul className="-mx-2 flex flex-col divide-y divide-slate-100">
            {eligible.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-2 py-2 text-sm">
                <span><span className="font-semibold text-[#101a3a]">{r.leave_type?.name}</span> · {dateSpan(r)} · {num(r.days)} day(s)</span>
                <Button size="sm" variant="secondary" onClick={() => actions.requestCancel(r)}><Undo2 className="h-3.5 w-3.5" aria-hidden="true" />Request cancellation</Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">If HR approves, the whole request is cancelled and its days return to your balance. If HR rejects it, the leave stays approved; you can send a new request with more detail.</p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- holiday calendar
const MONTHS = Array.from({ length: 12 }, (_, i) => i);

function HolidayCalendar({ year, today, myLeave }) {
  const q = useHrQuery(() => myHolidays(`${year}-01-01`, `${year}-12-31`), [year]);
  const [view, setView] = useState("calendar");
  const byDate = useMemo(() => {
    const m = new Map();
    for (const h of q.data ?? []) m.set(h.holiday_date, [...(m.get(h.holiday_date) ?? []), h]);
    return m;
  }, [q.data]);
  const leaveOn = useMemo(() => {
    const m = new Map();
    for (const r of myLeave ?? []) {
      if (r.status !== "approved" && r.status !== "pending_approval") continue;
      const end = new Date(`${r.end_date}T00:00:00Z`);
      for (let d = new Date(`${r.start_date}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const k = d.toISOString().slice(0, 10);
        if (k.startsWith(`${year}-`) && (r.status === "approved" || !m.has(k))) m.set(k, r.status);
      }
    }
    return m;
  }, [myLeave, year]);
  const all = q.data ?? [];
  const optional = all.filter((h) => h.type === "optional").length;
  const upcoming = all.filter((h) => h.holiday_date >= today).length;

  return (
    <Card title={<span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4" aria-hidden="true" />Holiday calendar {year}</span>}
      actions={
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm" role="group" aria-label="Holiday view">
          {[["calendar", "Calendar"], ["list", "List"]].map(([v, l]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 font-semibold ${view === v ? "bg-[#101a3a] text-white" : "text-slate-600 hover:bg-slate-50"}`}>{l}</button>
          ))}
        </div>}>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : (
        <>
          <p className="mb-3 text-sm text-slate-600">{all.length} holiday(s) in {year}{optional ? `, ${optional} optional` : ""}{year === Number(today.slice(0, 4)) ? ` · ${upcoming} still to come` : ""}.</p>
          {view === "calendar" ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {MONTHS.map((m) => <MiniMonth key={m} year={year} month={m} today={today} byDate={byDate} leaveOn={leaveOn} />)}
              </div>
              <p className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-500" />holiday</span>
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-violet-400" />optional holiday</span>
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-200" />my approved leave</span>
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-amber-400 bg-amber-50" />my pending leave</span>
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm ring-2 ring-[#f96706]" />today</span>
              </p>
            </>
          ) : (
            <DataTable caption="Holidays" rows={all} emptyTitle="No holidays configured"
              columns={[
                { key: "holiday_date", header: "Date", render: (r) => formatDate(r.holiday_date, { weekday: "short", day: "2-digit", month: "short", year: "numeric" }) },
                { key: "name", header: "Holiday" },
                { key: "type", header: "Type", render: (r) => <span className="flex flex-wrap gap-1"><Badge tone={r.type === "optional" ? "violet" : "blue"}>{r.type}</Badge>{r.is_recurring && <Badge tone="slate">every year</Badge>}</span> },
                { key: "upcoming", header: "", render: (r) => (r.holiday_date >= today ? <Badge tone="green">upcoming</Badge> : null) },
              ]} />
          )}
          <p className="mt-3 text-xs text-slate-500">Holidays for your location and company. Optional holidays are not automatically off; apply for leave to take one.</p>
        </>
      )}
    </Card>
  );
}

function MiniMonth({ year, month, today, byDate, leaveOn }) {
  const first = new Date(Date.UTC(year, month, 1));
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const mm = String(month + 1).padStart(2, "0");
  const cells = [...Array.from({ length: lead }, () => null), ...Array.from({ length: count }, (_, i) => `${year}-${mm}-${String(i + 1).padStart(2, "0")}`)];
  const name = first.toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" });
  const monthHolidays = cells.filter(Boolean).flatMap((d) => byDate.get(d) ?? []);
  return (
    <section className="rounded-xl border border-slate-200 p-3" aria-label={`${name} ${year}`}>
      <p className="mb-2 text-sm font-bold text-[#101a3a]">{name}</p>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]" aria-hidden="true">
        {WEEKDAYS.map((w) => <span key={w} className="font-semibold text-slate-400">{w.slice(0, 2)}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`x${i}`} />;
          const hs = byDate.get(d);
          const leave = leaveOn.get(d);
          const weekend = (i % 7) >= 5;
          const cls = hs ? (hs.every((h) => h.type === "optional") ? "bg-violet-400 text-white" : "bg-sky-500 text-white")
            : leave === "approved" ? "bg-emerald-200 text-emerald-900"
              : leave ? "border border-dashed border-amber-400 bg-amber-50 text-amber-900"
                : weekend ? "text-slate-400" : "text-slate-700";
          return (
            <span key={d} title={hs ? hs.map((h) => h.name).join(", ") : leave ? `My leave (${leave.replace(/_/g, " ")})` : undefined}
              className={`flex h-6 items-center justify-center rounded ${cls} ${d === today ? "ring-2 ring-[#f96706]" : ""}`}>{Number(d.slice(8))}</span>
          );
        })}
      </div>
      {monthHolidays.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-slate-600">
          {monthHolidays.map((h) => <li key={`${h.id}-${h.holiday_date}`}><span className="font-semibold">{Number(h.holiday_date.slice(8))}</span> · {h.name}{h.type === "optional" ? " (optional)" : ""}</li>)}
        </ul>
      ) : <p className="mt-2 text-xs text-slate-400">No holidays</p>}
    </section>
  );
}

function ApplyModal({ today, me, onClose, onApplied }) {
  const types = useHrQuery(() => myLeaveTypes(), []);
  const [v, setV] = useState({ type: "", start: today, end: today, part: "full", startHalf: false, endHalf: false, reason: "", documentPath: "" });
  // Balance of the leave year the request falls in (may differ from the page's year).
  const startYear = /^\d{4}-/.test(v.start ?? "") ? Number(v.start.slice(0, 4)) : null;
  const yearBalances = useHrQuery(() => (startYear ? myBalances(startYear) : Promise.resolve({ data: [], error: null })), [startYear]);
  const [file, setFile] = useState(null);
  const [docId, setDocId] = useState(null);           // registered upload (kept on retry)
  const [preview, setPreview] = useState({ days: null, error: null, loading: false });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const type = (types.data ?? []).find((t) => t.id === v.type);
  const single = v.start && v.end && v.start === v.end;
  const startHalf = type?.allow_half_day ? (single ? v.part === "second" : v.startHalf) : false;
  const endHalf = type?.allow_half_day ? (single ? v.part === "first" : v.endHalf) : false;
  const docThreshold = type?.requires_document_after_days != null ? Number(type.requires_document_after_days) : null;
  const docRequired = docThreshold != null && preview.days != null && preview.days > docThreshold;
  const blocked = type && (type.eligibility_issue || type.probation_restricted);
  const bal = type ? (yearBalances.data ?? []).find((b) => b.leave_type_id === type.id) : null;
  const rules = type ? [
    type.min_notice_days ? `Apply at least ${type.min_notice_days} day(s) in advance.` : null,
    type.min_days_per_request ? `Minimum ${num(type.min_days_per_request)} day(s) per request.` : null,
    type.max_days_per_request ? `Maximum ${num(type.max_days_per_request)} day(s) per request.` : null,
    type.allow_half_day ? null : "Full days only.",
    type.counts_weekends ? "Weekly-off days inside the range count as leave." : null,
    type.counts_holidays ? "Holidays inside the range count as leave." : null,
    type.paid ? null : "Unpaid: reported to payroll as loss of pay.",
  ].filter(Boolean) : [];
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    if (!v.type || !v.start || !v.end || v.end < v.start) { setPreview({ days: null, error: null, loading: false }); return undefined; }
    let alive = true;
    setPreview((p) => ({ ...p, loading: true }));
    const t = setTimeout(async () => {
      const res = await calculateDays({ type: v.type, start: v.start, end: v.end, startHalf, endHalf });
      if (alive) setPreview({ days: res.error ? null : Number(res.data), error: res.error, loading: false });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [v.type, v.start, v.end, startHalf, endHalf]);

  async function submit() {
    const errs = {};
    if (!v.type) errs.type = "Choose a leave type.";
    if (!v.start) errs.start = "Choose the start date.";
    if (!v.end) errs.end = "Choose the end date."; else if (v.start && v.end < v.start) errs.end = "End date must be on or after the start date.";
    if (v.start && v.end && v.start.slice(0, 4) !== v.end.slice(0, 4)) errs.end = "A request cannot span two calendar years; apply separately for each year.";
    if (v.reason.trim().length < 3) errs.reason = "Give a reason (at least 3 characters).";
    if (blocked) errs.type = type.eligibility_issue ?? `${type.name} is not available during probation.`;
    if (docRequired && !file && !docId) errs.documentPath = `Attach a document: required for ${type.name} longer than ${docThreshold} day(s).`;
    if (file) { const chk = checkDocumentFile(file); if (chk.error) errs.documentPath = chk.error; }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    let documentId = docId;
    if (file && !documentId) {
      const up = await uploadDocument({ employeeId: me, categoryCode: LEAVE_DOC_CATEGORY, title: `Leave: ${type.name} ${v.start}`, file });
      if (up.error) { setBusy(false); setError(up.error); return; }
      documentId = up.data?.document_id;
      setDocId(documentId);
    }
    const res = await applyLeave({ type: v.type, start: v.start, end: v.end, reason: v.reason, startHalf, endHalf, documentId });
    setBusy(false);
    if (res.error) setError(docId || documentId ? `${res.error} (Your document is saved in My Documents and will be reused if you try again.)` : res.error); else onApplied(res.data);
  }

  return (
    <Modal open onClose={onClose} title="Apply for leave" size="md"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit} disabled={types.loading || Boolean(blocked)}>Submit request</Button></>}>
      {types.error ? <ErrorState message={types.error} onRetry={types.reload} /> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Leave type" required error={errors.type} className="sm:col-span-2" hint={type?.description || undefined}>
            <Select placeholder={types.loading ? "Loading…" : "Choose leave type"} value={v.type} onChange={set("type")}
              options={(types.data ?? []).map((t) => ({ value: t.id, label: `${t.name}${t.paid ? "" : " (unpaid)"}${t.eligibility_issue || t.probation_restricted ? " — not available" : ""}` }))} />
          </Field>
          {type && (
            <div className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600 sm:col-span-2">
              {blocked ? <p className="font-semibold text-red-700">{type.eligibility_issue ?? `${type.name} is not available during probation.`}</p> : (
                <>
                  {bal ? <p><span className="font-semibold text-[#101a3a]">{num(bal.available)} day(s) available</span> in {bal.year}{Number(bal.pending) > 0 ? ` (${num(bal.pending)} pending approval)` : ""}.</p>
                    : type.accrual === "none" ? <p>No fixed balance for this type.</p> : null}
                  {rules.length > 0 && <ul className="mt-1 list-disc pl-4">{rules.map((x) => <li key={x}>{x}</li>)}</ul>}
                </>
              )}
            </div>
          )}
          <Field label="From" required error={errors.start}><Input type="date" value={v.start} onChange={(e) => setV((s) => ({ ...s, start: e.target.value, end: s.end < e.target.value ? e.target.value : s.end }))} /></Field>
          <Field label="To" required error={errors.end}><Input type="date" value={v.end} min={v.start} onChange={set("end")} /></Field>
          {type && type.allow_half_day && (single ? (
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-semibold text-[#173a52]">Duration</legend>
              <div className="mt-1 flex flex-wrap gap-4 text-sm">
                {[["full", "Full day"], ["first", "First half"], ["second", "Second half"]].map(([val, lab]) => (
                  <label key={val} className="inline-flex items-center gap-2"><input type="radio" name="leave-part" value={val} checked={v.part === val} onChange={set("part")} className="h-4 w-4 text-[#f96706]" />{lab}</label>
                ))}
              </div>
            </fieldset>
          ) : (
            <fieldset className="flex flex-col gap-1 sm:col-span-2">
              <legend className="text-sm font-semibold text-[#173a52]">Half days</legend>
              <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={v.startHalf} onChange={(e) => setV({ ...v, startHalf: e.target.checked })} className="h-4 w-4" />Start day: second half only</label>
              <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={v.endHalf} onChange={(e) => setV({ ...v, endHalf: e.target.checked })} className="h-4 w-4" />End day: first half only</label>
            </fieldset>
          ))}
          {type && !type.allow_half_day && <p className="text-xs text-slate-500 sm:col-span-2">{type.name} must be taken in full days.</p>}
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm sm:col-span-2" aria-live="polite">
            {preview.loading ? "Calculating with the server…" : preview.error ? <span className="text-red-700">{preview.error}</span>
              : preview.days != null ? <>This request counts as <strong>{num(preview.days)}</strong> leave day(s) (weekends and holidays handled per policy).</>
                : "Choose a type and dates to see how many days will be deducted."}
          </div>
          <Field label="Reason" required error={errors.reason} className="sm:col-span-2"><Textarea maxLength={2000} value={v.reason} onChange={set("reason")} /></Field>
          {docThreshold != null && (
            <Field label="Supporting document" required={docRequired} error={errors.documentPath} className="sm:col-span-2"
              hint={`${docThreshold === 0 ? `Always needed for ${type.name}.` : `Needed when ${type.name} is longer than ${num(docThreshold)} day(s).`} PDF, image or Word, up to 10 MB. Only you and HR can open it; your manager sees only that a document is attached.`}>
              {docId ? <p className="text-sm text-emerald-700">Document uploaded.</p>
                : <input type="file" accept={DOC_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold" />}
            </Field>
          )}
        </div>
      )}
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

/**
 * Approval progress built from the request and its event history:
 * Applied -> (manager) -> (HR) -> outcome, plus a cancellation step when one
 * was requested. Levels that never appeared in the flow are not shown.
 */
function approvalSteps(r, events) {
  const ev = events ?? [];
  const last = (action) => [...ev].reverse().find((e) => e.action === action);
  const applied = last("applied");
  const mgr = last("manager_approved");
  const rejected = last("rejected");
  const approved = last("approved");
  const cancelled = last("cancelled");
  const steps = [{ key: "applied", label: "Applied", state: "done", at: applied?.created_at ?? r.created_at }];
  const usesManager = Boolean(mgr) || r.current_level === "manager" || rejected?.level === "manager";
  if (usesManager) {
    steps.push({
      key: "manager", label: "Manager approval",
      state: mgr ? "done" : rejected?.level === "manager" ? "rejected" : r.status === "pending_approval" ? "current" : r.status === "cancelled" ? "skipped" : "done",
      at: mgr?.created_at ?? (rejected?.level === "manager" ? rejected.created_at : null),
    });
  }
  const hrReached = r.current_level === "hr" || approved || (rejected && rejected.level !== "manager");
  if (hrReached || r.status === "pending_approval") {
    steps.push({
      key: "hr", label: usesManager ? "HR approval" : "Approval",
      state: approved ? "done" : rejected && rejected.level !== "manager" ? "rejected" : r.status === "pending_approval" ? (r.current_level === "hr" ? "current" : "waiting") : r.status === "cancelled" ? "skipped" : "done",
      at: approved?.created_at ?? (rejected && rejected.level !== "manager" ? rejected.created_at : null),
    });
  }
  if (r.status === "approved" || (r.status === "cancelled" && approved)) steps.push({ key: "approved", label: "Leave approved", state: "done", at: approved?.created_at ?? r.decided_at });
  if (r.status === "rejected") steps.push({ key: "rejected", label: "Rejected", state: "rejected", at: rejected?.created_at ?? r.decided_at });
  if (r.cancellation_requested_at) {
    steps.push({
      key: "cancel-req", label: "Cancellation requested",
      state: r.cancellation_status === "pending" ? "current" : r.cancellation_status === "rejected" ? "rejected" : "done",
      at: r.cancellation_requested_at,
      note: r.cancellation_status === "pending" ? "Waiting for HR" : r.cancellation_status === "rejected" ? "HR rejected the cancellation" : null,
    });
  }
  if (r.status === "cancelled") steps.push({ key: "cancelled", label: "Cancelled", state: "done", at: cancelled?.created_at ?? r.cancelled_at });
  return steps;
}

const STEP_STYLE = {
  done: { icon: Check, ring: "bg-emerald-500 text-white", text: "text-[#101a3a]" },
  current: { icon: Clock, ring: "bg-amber-400 text-white", text: "font-semibold text-amber-800" },
  rejected: { icon: X, ring: "bg-rose-500 text-white", text: "text-rose-700" },
  waiting: { icon: Circle, ring: "bg-slate-200 text-slate-500", text: "text-slate-500" },
  skipped: { icon: Circle, ring: "bg-slate-200 text-slate-400", text: "text-slate-400 line-through" },
};

function ApprovalTracker({ steps }) {
  return (
    <ol className="flex flex-col gap-0" aria-label="Approval progress">
      {steps.map((s, i) => {
        const st = STEP_STYLE[s.state] ?? STEP_STYLE.waiting;
        const Icon = st.icon;
        return (
          <li key={s.key} className="relative flex gap-3 pb-3 last:pb-0">
            {i < steps.length - 1 && <span className="absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px bg-slate-200" aria-hidden="true" />}
            <span className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${st.ring}`} aria-hidden="true"><Icon className="h-3.5 w-3.5" /></span>
            <span className="flex flex-col">
              <span className={st.text}>{s.label}{s.state === "current" ? " (in progress)" : s.state === "waiting" ? " (not yet)" : ""}</span>
              {(s.at || s.note) && <span className="text-xs text-slate-500">{s.at ? formatDateTime(s.at) : ""}{s.at && s.note ? " · " : ""}{s.note ?? ""}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RequestDetail({ request: r, today, actions, onClose }) {
  const { notify } = useToast();
  const events = useHrQuery(() => listRequestEvents(r.id), [r.id]);
  const [reply, setReply] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const needsReply = r.status === "pending_approval" && pendingClarification(events.data);
  const steps = useMemo(() => approvalSteps(r, events.data), [r, events.data]);
  async function send() {
    if (!reply.trim()) { setError("Write your response."); return; }
    setBusy(true); setError(null);
    const res = await respondClarification(r.id, reply);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setReply(""); events.reload(); notify("Response sent to your approver.");
  }
  return (
    <Modal open onClose={onClose} title={`${r.leave_type?.name ?? "Leave"} · ${dateSpan(r)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {canCancelDirect(r, today) && <Button variant="danger" onClick={() => actions.cancel(r)}>Cancel leave</Button>}
          {canRequestCancel(r, today) && <Button onClick={() => actions.requestCancel(r)}><Undo2 className="h-4 w-4" aria-hidden="true" />Request cancellation</Button>}
          {r.cancellation_status === "pending" && <Button variant="secondary" onClick={() => actions.withdraw(r)}>Withdraw cancellation request</Button>}
        </>}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={r.status} /><CancellationBadge r={r} /><span>{num(r.days)} day(s)</span>{halfLabel(r) && <span className="text-slate-500">· {halfLabel(r)}</span>}
        </div>
        <p><span className="font-semibold">Reason:</span> {r.reason}</p>
        {r.document_id ? <p className="flex items-center gap-1"><Paperclip className="h-4 w-4" aria-hidden="true" />Supporting document attached (see My Documents).</p>
          : r.document_path && <p><span className="font-semibold">Document reference:</span> {r.document_path}</p>}
        {r.decision_note && <p><span className="font-semibold">Decision note:</span> {r.decision_note}</p>}
        {r.cancellation_reason && <p><span className="font-semibold">Cancellation reason:</span> {r.cancellation_reason}</p>}
        {r.cancellation_decision_note && <p><span className="font-semibold">HR note on cancellation:</span> {r.cancellation_decision_note}</p>}
        {r.holiday_review_required && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">The holiday calendar changed for these dates. Your approver will recount the days; your balance is unchanged until then.</p>}

        <h3 className="mt-2 font-bold text-[#101a3a]">Approval status</h3>
        {events.loading && !events.data ? <Loading /> : <ApprovalTracker steps={steps} />}

        <h3 className="mt-2 font-bold text-[#101a3a]">History</h3>
        {events.loading && !events.data ? <Loading /> : events.error ? <ErrorState message={events.error} onRetry={events.reload} /> : (
          <ol className="flex flex-col gap-2">
            {(events.data ?? []).map((e) => (
              <li key={e.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <Badge tone={e.action.includes("rejected") ? "red" : e.action.includes("approved") ? "green" : e.action === "clarification_requested" || e.action === "cancellation_requested" ? "orange" : "slate"}>{LEAVE_EVENT_LABELS[e.action] ?? e.action}</Badge>
                  {e.level && <span>{e.level} level</span>}<span>{formatDateTime(e.created_at)}</span>
                </div>
                {e.note && <p className="mt-1 whitespace-pre-wrap text-slate-700">{e.note}</p>}
              </li>
            ))}
          </ol>
        )}
        {needsReply && (
          <div className="flex flex-col gap-2 rounded-xl border border-orange-200 bg-orange-50/60 p-3">
            <p className="text-xs font-semibold text-orange-800">Your approver asked a question. Reply below.</p>
            <Field label="Your response" required><Textarea maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} /></Field>
            <InlineError message={error} />
            <div className="flex justify-end"><Button size="sm" loading={busy} onClick={send}>Send response</Button></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function MyLedger({ me, year }) {
  const q = useHrQuery(() => (me ? listLedger({ employee: me, year }) : Promise.resolve({ data: [], error: null })), [me, year]);
  const rows = useMemo(() => (q.data ?? []).filter((r) => Number(r.effect) !== 0), [q.data]);
  return (
    <Card title={`Balance history ${year}`} padded={false}>
      <DataTable caption="Leave balance history" rows={rows} loading={q.loading} error={q.error} onRetry={q.reload} emptyTitle="No balance changes this year" pageSize={25}
        columns={[
          { key: "created_at", header: "When", render: (r) => formatDateTime(r.created_at) },
          { key: "type", header: "Type", render: (r) => r.leave_type?.name },
          { key: "entry_type", header: "What happened", render: (r) => LEDGER_LABELS[r.entry_type] ?? r.entry_type },
          { key: "effect", header: "Change", render: (r) => <span className={Number(r.effect) < 0 ? "text-red-600" : "text-emerald-700"}>{Number(r.effect) > 0 ? "+" : ""}{num(r.effect)}</span> },
          { key: "available_after", header: "Available after", render: (r) => num(r.available_after) },
          { key: "reason", header: "Note", render: (r) => <span className="text-xs">{r.reason ?? ""}</span> },
        ]} />
      <p className="px-4 py-3 text-xs text-slate-500">Every change to your balance is recorded here: accruals, leave you applied for (reserved), approved, cancelled or rejected, adjustments by HR, carry-forward and expiry.</p>
    </Card>
  );
}

// ---------------------------------------------------------------- calendar
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const shiftMonth = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

/**
 * Month grid (list on mobile) of pending + approved leave visible to the
 * caller, with holidays. HR passes departments / legalEntities /
 * employeeFilter for extra filters and sees every holiday; employees see the
 * holidays that apply to them. Rows the caller may not fully see arrive from
 * the server as "On leave" (no type, never a reason).
 */
export function LeaveCalendar({ tz, departmentFilter = "", departments, legalEntities, employeeFilter = false }) {
  const today = businessToday(tz);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [dept, setDept] = useState(departmentFilter);
  const [company, setCompany] = useState("");
  const [employee, setEmployee] = useState("");
  const [approvedOnly, setApprovedOnly] = useState(false);
  const employees = useHrQuery(() => (employeeFilter ? loadEmployeeOptions() : Promise.resolve({ data: [], error: null })), [employeeFilter]);
  const { from: f, to } = monthRange(month);
  const q = useHrQuery(() => leaveCalendar(f, to, { legalEntity: company, employee, includePending: !approvedOnly }), [f, to, company, employee, approvedOnly]);
  const hol = useHrQuery(() => myHolidays(f, to, { all: Boolean(departments) }), [f, to, Boolean(departments)]);
  const entries = useMemo(() => (q.data ?? []).filter((e) => !dept || e.department_id === dept), [q.data, dept]);
  const days = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const lead = (first.getUTCDay() + 6) % 7;
    const count = Number(to.slice(8));
    const cells = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= count; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [month, to]);
  const onDay = (d) => entries.filter((e) => e.start_date <= d && e.end_date >= d);
  const holidayOn = (d) => (hol.data ?? []).filter((h) => h.holiday_date === d);
  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <Card title={<span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4" aria-hidden="true" />Leave calendar</span>} actions={
      <div className="flex flex-wrap items-center gap-2">
        {departments && (
          <select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm">
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {legalEntities?.length > 1 && (
          <select aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm">
            <option value="">All companies</option>
            {legalEntities.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {employeeFilter && (
          <select aria-label="Employee" value={employee} onChange={(e) => setEmployee(e.target.value)} className="max-w-[12rem] rounded-lg border border-slate-200 px-2 py-1 text-sm">
            <option value="">Everyone</option>
            {(employees.data ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <label className="inline-flex items-center gap-1 text-sm text-slate-600"><input type="checkbox" className="h-4 w-4" checked={approvedOnly} onChange={(e) => setApprovedOnly(e.target.checked)} />Approved only</label>
        <Button size="sm" variant="secondary" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
        <span className="min-w-[8rem] text-center text-sm font-semibold text-[#101a3a]" aria-live="polite">{label}</span>
        <Button size="sm" variant="secondary" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
      </div>}>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : (
        <>
          <div className="hidden md:block">
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-xs" role="grid" aria-label={`Leave in ${label}`}>
              {WEEKDAYS.map((w) => <div key={w} role="columnheader" className="bg-slate-50 px-2 py-1.5 text-center font-bold text-slate-600">{w}</div>)}
              {days.map((d, i) => (
                <div key={d ?? `x${i}`} role="gridcell" className={`min-h-[5.5rem] bg-white p-1.5 ${d === today ? "ring-2 ring-inset ring-[#f96706]" : ""} ${!d ? "bg-slate-50" : ""}`}>
                  {d && (
                    <>
                      <p className="font-semibold text-slate-700">{Number(d.slice(8))}</p>
                      {holidayOn(d).map((h) => <p key={h.id} className="truncate rounded bg-sky-50 px-1 text-[11px] text-sky-800" title={h.name}>{h.name}</p>)}
                      {onDay(d).slice(0, 3).map((e) => (
                        <p key={e.request_id} title={`${e.employee_name} · ${e.leave_type_name}${e.start_half && e.start_date === d ? " (2nd half)" : e.end_half && e.end_date === d ? " (1st half)" : ""} (${e.status.replace(/_/g, " ")})`}
                          className={`mt-0.5 truncate rounded px-1 text-[11px] ${e.status === "approved" ? "bg-emerald-50 text-emerald-800" : "border border-dashed border-amber-300 bg-amber-50 text-amber-900"}`}>
                          {e.employee_name}{e.visibility === "full" ? ` · ${e.leave_type_code}` : ""}{(e.start_half && e.start_date === d) || (e.end_half && e.end_date === d) ? " ½" : ""}
                        </p>
                      ))}
                      {onDay(d).length > 3 && <p className="text-[11px] text-slate-500">+{onDay(d).length - 3} more</p>}
                    </>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500"><span><span className="inline-block h-2 w-3 rounded bg-emerald-200" /> approved</span><span><span className="inline-block h-2 w-3 rounded border border-dashed border-amber-400 bg-amber-50" /> pending</span><span><span className="inline-block h-2 w-3 rounded bg-sky-200" /> holiday</span></p>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {(hol.data ?? []).map((h) => <li key={h.id} className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">{formatDate(h.holiday_date)} · {h.name}</li>)}
            {entries.map((e) => (
              <li key={e.request_id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2"><span className="font-semibold text-[#101a3a]">{e.employee_name}</span><StatusBadge status={e.status} /></div>
                <p className="text-xs text-slate-600">{e.leave_type_name} · {formatDate(e.start_date)}{e.end_date !== e.start_date ? ` – ${formatDate(e.end_date)}` : ""} · {num(e.days)} day(s)</p>
              </li>
            ))}
            {!entries.length && !(hol.data ?? []).length && <li><EmptyState title="No leave this month" /></li>}
          </ul>
          {entries.length === 0 && <p className="mt-2 hidden text-xs text-slate-500 md:block">No pending or approved leave visible to you this month.</p>}
          {entries.some((e) => e.visibility === "limited") && <p className="mt-2 text-xs text-slate-500">Colleagues' leave is shown as availability only; leave types and reasons are private.</p>}
        </>
      )}
    </Card>
  );
}
