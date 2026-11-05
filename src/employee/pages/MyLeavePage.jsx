// Employee: leave balances, apply (eligibility-aware, live server-side
// day-count preview, real supporting-document upload), my requests with
// history, cancellation, clarification replies, balance history (ledger),
// holidays that apply to me and the team leave calendar (scoped by the
// server; colleagues' leave shows only "On leave", never the reason).
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Paperclip, Plus } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { businessToday, monthRange, useBusinessTimezone } from "@/lib/hr/attendance";
import { DOC_ACCEPT, checkDocumentFile, uploadDocument } from "@/lib/hr/documents";
import {
  LEAVE_DOC_CATEGORY, LEAVE_EVENT_LABELS, LEDGER_LABELS, applyLeave, calculateDays, cancelLeave, halfLabel, leaveCalendar, listLedger,
  listMyRequests, listRequestEvents, myBalances, myHolidays, myLeaveTypes, pendingClarification, respondClarification,
} from "@/lib/hr/leave";
import { loadEmployeeOptions } from "@/lib/hr/org";
import {
  Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal, PageHeader, Select,
  StatusBadge, Tabs, Textarea, useToast,
} from "@/hr/ui";

const num = (n) => (n == null ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }));

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
  const holidays = useHrQuery(() => myHolidays(`${year}-01-01`, `${year}-12-31`), [year]);
  const [applying, setApplying] = useState(false);
  const [detail, setDetail] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const canCancel = (r) => r.status === "pending_approval" || (r.status === "approved" && r.start_date > today);

  return (
    <>
      <PageHeader title="My Leave" description="Balances, applications and your team's leave calendar."
        actions={<Button onClick={() => setApplying(true)}><Plus className="h-4 w-4" aria-hidden="true" />Apply for leave</Button>} />
      <Tabs value={tab} onChange={setTab} label="Leave sections" tabs={[{ value: "overview", label: "Balances & requests" }, { value: "history", label: "Balance history" }, { value: "calendar", label: "Team calendar" }, { value: "holidays", label: "Holidays" }]} />

      {tab === "overview" && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <label htmlFor="leave-year" className="text-sm font-semibold text-[#173a52]">Year</label>
            <select id="leave-year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border border-slate-200 px-2 py-1 text-sm">
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {balances.loading && !balances.data ? <Loading /> : balances.error ? <ErrorState message={balances.error} onRetry={balances.reload} /> : !balances.data?.length ? (
            <Card><EmptyState title="No leave types available" description="HR has not configured any active leave types." /></Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {balances.data.map((b) => (
                <div key={b.balance_id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold text-[#101a3a]">{b.name}</p>
                    <Badge tone={b.paid ? "green" : "slate"}>{b.paid ? "paid" : "unpaid"}</Badge>
                  </div>
                  <p className="mt-1 text-3xl font-extrabold text-[#101a3a]">{num(b.available)}<span className="ml-1 text-sm font-semibold text-slate-500">available</span></p>
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
              ))}
            </div>
          )}
          <div className="mt-4">
            <Card title="My leave requests" padded={false}>
              <DataTable caption="My leave requests" rows={requests.data} loading={requests.loading} error={requests.error} onRetry={requests.reload}
                emptyTitle="No leave requests yet" onRowClick={setDetail}
                columns={[
                  { key: "type", header: "Type", render: (r) => <span>{r.leave_type?.name ?? "—"}{r.document_id && <Paperclip className="ml-1 inline h-3.5 w-3.5 text-slate-500" aria-label="Document attached" />}</span> },
                  { key: "dates", header: "Dates", render: (r) => <span className="whitespace-nowrap">{formatDate(r.start_date)}{r.end_date !== r.start_date ? ` – ${formatDate(r.end_date)}` : ""}</span> },
                  { key: "half", header: "Part", render: (r) => halfLabel(r) || "—" },
                  { key: "days", header: "Days", render: (r) => num(r.days) },
                  { key: "status", header: "Status", render: (r) => <span className="flex flex-col gap-1"><StatusBadge status={r.status} />{r.status === "pending_approval" && r.current_level && <span className="text-xs text-slate-500">awaiting {r.current_level}</span>}</span> },
                  { key: "created_at", header: "Applied", render: (r) => formatDate(r.created_at) },
                  { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDetail(r); }}>Details</Button>
                      {canCancel(r) && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setCancelling(r); }}>Cancel</Button>}
                    </div>) },
                ]} />
            </Card>
            <p className="mt-2 text-xs text-slate-500">You can cancel pending requests, and approved leave that has not started yet. Leave that has already started can only be cancelled by HR.</p>
          </div>
        </>
      )}
      {tab === "history" && <MyLedger me={me} year={year} />}
      {tab === "calendar" && <LeaveCalendar tz={tz} />}
      {tab === "holidays" && (
        <Card title={`Holidays ${year}`} padded={false}>
          <DataTable caption="Holidays" rows={holidays.data} loading={holidays.loading} error={holidays.error} onRetry={holidays.reload} emptyTitle="No holidays configured"
            columns={[
              { key: "holiday_date", header: "Date", render: (r) => formatDate(r.holiday_date, { weekday: "short", day: "2-digit", month: "short", year: "numeric" }) },
              { key: "name", header: "Holiday" },
              { key: "type", header: "Type", render: (r) => <span className="flex flex-wrap gap-1"><Badge tone={r.type === "optional" ? "violet" : "blue"}>{r.type}</Badge>{r.is_recurring && <Badge tone="slate">every year</Badge>}</span> },
              { key: "upcoming", header: "", render: (r) => (r.holiday_date >= today ? <Badge tone="green">upcoming</Badge> : null) },
            ]} />
          <p className="px-4 py-3 text-xs text-slate-500">Holidays for your location and company. Optional holidays are not automatically off; apply for leave to take one.</p>
        </Card>
      )}

      {applying && <ApplyModal today={today} me={me} onClose={() => setApplying(false)} onApplied={(r) => { setApplying(false); requests.reload(); balances.reload(); notify(`Leave applied: ${num(r?.days)} day(s), awaiting ${r?.current_level ?? "approval"}.`); }} />}
      {detail && <RequestDetail request={detail} onClose={() => setDetail(null)} />}
      <ConfirmDialog open={Boolean(cancelling)} onClose={() => setCancelling(null)} title="Cancel leave request?" tone="danger" confirmLabel="Cancel leave"
        message={cancelling ? `${cancelling.leave_type?.name}: ${formatDate(cancelling.start_date)}${cancelling.end_date !== cancelling.start_date ? ` – ${formatDate(cancelling.end_date)}` : ""} (${num(cancelling.days)} day(s)). The days return to your balance.` : ""}
        requireReason={false} reasonLabel="Note (optional)"
        onConfirm={async (note) => {
          const res = await cancelLeave(cancelling.id, note);
          if (res.error) return { error: res.error };
          notify("Leave cancelled."); requests.reload(); balances.reload();
          return {};
        }} />
    </>
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

function RequestDetail({ request: r, onClose }) {
  const { notify } = useToast();
  const events = useHrQuery(() => listRequestEvents(r.id), [r.id]);
  const [reply, setReply] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const needsReply = r.status === "pending_approval" && pendingClarification(events.data);
  async function send() {
    if (!reply.trim()) { setError("Write your response."); return; }
    setBusy(true); setError(null);
    const res = await respondClarification(r.id, reply);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setReply(""); events.reload(); notify("Response sent to your approver.");
  }
  return (
    <Modal open onClose={onClose} title={`${r.leave_type?.name ?? "Leave"} · ${formatDate(r.start_date)}${r.end_date !== r.start_date ? ` – ${formatDate(r.end_date)}` : ""}`}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={r.status} /><span>{num(r.days)} day(s)</span>{halfLabel(r) && <span className="text-slate-500">· {halfLabel(r)}</span>}</div>
        <p><span className="font-semibold">Reason:</span> {r.reason}</p>
        {r.document_id ? <p className="flex items-center gap-1"><Paperclip className="h-4 w-4" aria-hidden="true" />Supporting document attached (see My Documents).</p>
          : r.document_path && <p><span className="font-semibold">Document reference:</span> {r.document_path}</p>}
        {r.decision_note && <p><span className="font-semibold">Decision note:</span> {r.decision_note}</p>}
        {r.holiday_review_required && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">The holiday calendar changed for these dates. Your approver will recount the days; your balance is unchanged until then.</p>}
        <h3 className="mt-2 font-bold text-[#101a3a]">History</h3>
        {events.loading && !events.data ? <Loading /> : events.error ? <ErrorState message={events.error} onRetry={events.reload} /> : (
          <ol className="flex flex-col gap-2">
            {(events.data ?? []).map((e) => (
              <li key={e.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <Badge tone={e.action === "rejected" ? "red" : e.action.includes("approved") ? "green" : e.action === "clarification_requested" ? "orange" : "slate"}>{LEAVE_EVENT_LABELS[e.action] ?? e.action}</Badge>
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
