// Full & final settlement (payroll only). Preparation (payroll.manage) is
// separate from approval (payroll.approve, by a different person who did not
// prepare or edit it, never the leaver). Payment is recorded only — nothing
// here moves money. Prefilled lines come from existing payroll, reimbursement
// and leave records; amounts that depend on company policy start at zero.
import { useMemo, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, formatMoney, fullName, useHrQuery } from "@/lib/hr/client";
import {
  SETTLEMENT_LINE_TYPES, approveSettlement, cancelSettlement, deleteSettlementLine, getSettlement, getSettlementLines, isEarning, lineTypeLabel,
  listExitsAwaitingSettlement, listSettlements, markSettlementPaid, prepareSettlement, saveSettlementLine, settlementStatement, submitSettlement,
} from "@/lib/hr/lifecycle";
import { openSettlementStatement } from "@/lib/hr/settlementStatement";
import {
  Button, Card, ConfirmDialog, DataTable, DescriptionList, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal, Select,
  StatusBadge, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";

const BASE = "/hr/onboarding-exit/settlement";

function Queue() {
  const { hasPermission, hr } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState("prepare");
  const awaiting = useHrQuery(() => (tab === "prepare" ? listExitsAwaitingSettlement() : Promise.resolve({ data: [], error: null })), [tab]);
  const list = useHrQuery(() => (tab === "prepare" ? Promise.resolve({ data: [], error: null }) : listSettlements({ status: tab === "all" ? "" : tab })), [tab]);
  const [preparing, setPreparing] = useState(null);
  return (
    <>
      <Toolbar>
        <Tabs value={tab} onChange={setTab} label="Settlement status" tabs={[
          { value: "prepare", label: "To prepare" }, { value: "draft", label: "Drafts" }, { value: "submitted", label: "Awaiting approval" },
          { value: "approved", label: "Awaiting payment" }, { value: "paid", label: "Paid" }, { value: "all", label: "All" },
        ]} />
      </Toolbar>
      {tab === "prepare" ? (
        <DataTable caption="Exits awaiting settlement" rows={awaiting.data} loading={awaiting.loading} error={awaiting.error} onRetry={awaiting.reload}
          emptyTitle="Nothing to prepare" emptyDescription="Exits appear here once HR starts clearance."
          columns={[
            { key: "employee", header: "Employee", render: (x) => <div><p className="font-semibold text-[#101a3a]">{fullName(x.employee)}</p><p className="font-mono text-xs text-slate-500">{x.employee?.employee_code}</p></div> },
            { key: "approved_last_working_day", header: "Last working day", sortable: true, render: (x) => formatDate(x.approved_last_working_day) },
            { key: "status", header: "Exit stage", render: (x) => <StatusBadge status={x.status} /> },
            { key: "act", header: "", render: (x) => hasPermission("payroll.manage") && x.employee_id !== hr?.employee?.id && <Button size="sm" onClick={(e) => { e.stopPropagation(); setPreparing(x); }}>Prepare settlement</Button> },
          ]} />
      ) : (
        <DataTable caption="Settlements" rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
          emptyTitle="No settlements" onRowClick={(s) => navigate(`${BASE}/${s.id}`)}
          columns={[
            { key: "employee", header: "Employee", render: (s) => <div><p className="font-semibold text-[#101a3a]">{fullName(s.employee)}</p><p className="font-mono text-xs text-slate-500">{s.employee?.employee_code}</p></div> },
            { key: "last_working_day", header: "Last working day", render: (s) => formatDate(s.last_working_day) },
            { key: "net_amount", header: "Net", sortable: true, render: (s) => <span className={Number(s.net_amount) < 0 ? "font-semibold text-rose-700" : "font-semibold"}>{formatMoney(s.net_amount, s.currency)}</span> },
            { key: "status", header: "Status", render: (s) => <StatusBadge status={s.status} /> },
            { key: "dates", header: "Progress", render: (s) => <span className="text-xs text-slate-500">{s.paid_on ? `Paid ${formatDate(s.paid_on)}` : s.approved_at ? `Approved ${formatDate(s.approved_at)}` : s.submitted_at ? `Submitted ${formatDate(s.submitted_at)}` : `Prepared ${formatDate(s.prepared_at)}`}</span> },
          ]} />
      )}
      <ConfirmDialog open={Boolean(preparing)} onClose={() => setPreparing(null)} title={`Prepare settlement: ${preparing ? fullName(preparing.employee) : ""}`}
        message="A draft is created from payroll records: salary since the last finalized payroll, finalized unpaid payroll, approved unpaid reimbursements, leave balances and any notice shortfall. Review every line before submitting."
        confirmLabel="Prepare draft"
        onConfirm={async () => { const res = await prepareSettlement(preparing.id); if (!res.error) { notify("Draft settlement prepared."); navigate(`${BASE}/${res.data}`); } return res; }} />
    </>
  );
}

function LineModal({ settlementId, line, currency, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ line_type: line?.line_type ?? "other_earning", label: line?.label ?? "", quantity: line?.quantity ?? "", rate: line?.rate ?? "", amount: line?.amount ?? "", note: line?.note ?? "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const suggested = v.quantity !== "" && v.rate !== "" ? Math.round(Number(v.quantity) * Number(v.rate) * 100) / 100 : null;
  async function submit() {
    if (v.label.trim().length < 2) { setError("Enter a label."); return; }
    if (v.amount === "" || Number(v.amount) < 0) { setError("Enter an amount of zero or more. Deductions are entered as positive amounts."); return; }
    setBusy(true); setError(null);
    const res = await saveSettlementLine(settlementId, line?.id, v);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(line ? "Line updated." : "Line added."); onDone();
  }
  return (
    <Modal open onClose={onClose} title={line ? "Edit settlement line" : "Add settlement line"}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Save line</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Type"><Select value={v.line_type} onChange={set("line_type")} options={SETTLEMENT_LINE_TYPES.map((t) => ({ value: t.value, label: `${t.label} (${t.earning ? "earning" : "deduction"})` }))} /></Field>
        <Field label="Label" required><Input value={v.label} maxLength={160} onChange={set("label")} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Quantity (days etc.)"><Input type="number" step="0.5" value={v.quantity} onChange={set("quantity")} /></Field>
          <Field label="Rate"><Input type="number" step="0.01" value={v.rate} onChange={set("rate")} /></Field>
          <Field label={`Amount (${currency})`} required hint={suggested != null ? `Quantity × rate = ${formatMoney(suggested, currency)}` : undefined}><Input type="number" step="0.01" min={0} value={v.amount} onChange={set("amount")} /></Field>
        </div>
        {suggested != null && Number(v.amount) !== suggested && <Button size="sm" variant="ghost" onClick={() => setV((s) => ({ ...s, amount: suggested }))}>Use {formatMoney(suggested, currency)}</Button>}
        <Field label="Note"><Textarea value={v.note} maxLength={1000} onChange={set("note")} /></Field>
        <p className="text-xs text-slate-500">No statutory rule is applied automatically. Enter amounts per company policy; a different payroll approver reviews them.</p>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function Detail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission, hr, user } = useAuth();
  const { notify } = useToast();
  const s = useHrQuery(() => getSettlement(id), [id]);
  const lines = useHrQuery(() => getSettlementLines(id), [id]);
  const [dialog, setDialog] = useState(null);
  const [line, setLine] = useState(null);
  const [error, setError] = useState(null);
  const [paid, setPaid] = useState({ reference: "", date: "" });
  const refresh = () => { s.reload(); lines.reload(); };
  const totals = useMemo(() => {
    const e = (lines.data ?? []).filter((l) => isEarning(l.line_type)).reduce((n, l) => n + Number(l.amount), 0);
    const d = (lines.data ?? []).filter((l) => !isEarning(l.line_type)).reduce((n, l) => n + Number(l.amount), 0);
    return { e, d, net: e - d };
  }, [lines.data]);

  if (s.loading && !s.data) return <Loading />;
  if (s.error) return <ErrorState message={s.error} onRetry={s.reload} />;
  if (!s.data) return <EmptyState title="Settlement not found" description="It does not exist or you are not allowed to view it." action={<Button variant="secondary" onClick={() => navigate(BASE)}>Back</Button>} />;

  const x = s.data;
  const own = x.employee_id === hr?.employee?.id;
  const uid = user?.id ?? hr?.user_id;
  const canEdit = hasPermission("payroll.manage") && x.status === "draft" && !own;
  const involved = uid && (uid === x.prepared_by || uid === x.submitted_by || (x.editors ?? []).includes(uid));
  const canApprove = hasPermission("payroll.approve") && x.status === "submitted" && !own;
  async function printStatement() {
    setError(null);
    const res = await settlementStatement(x.id);
    if (res.error) { setError(res.error); return; }
    const err = openSettlementStatement(res.data);
    if (err) setError(err);
  }
  return (
    <>
      <button type="button" onClick={() => navigate(BASE)} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All settlements
      </button>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-extrabold text-[#101a3a]">Full &amp; final settlement · {fullName(x.employee)}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm"><span className="font-mono font-bold text-[#1f4693]">{x.employee?.employee_code}</span><StatusBadge status={x.status} /></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={printStatement}><FileText className="h-4 w-4" aria-hidden="true" />Statement / PDF</Button>
          {canEdit && <Button variant="secondary" onClick={() => setDialog("cancel")}>Cancel</Button>}
          {canEdit && <Button onClick={() => setDialog("submit")} disabled={!lines.data?.length}>Submit for approval</Button>}
          {canApprove && <Button variant="secondary" onClick={() => setDialog("return")}>Return for changes</Button>}
          {canApprove && <Button variant="success" onClick={() => setDialog("approve")} disabled={Boolean(involved)} title={involved ? "You prepared or edited this settlement; a different approver must approve it" : undefined}>Approve</Button>}
          {hasPermission("payroll.approve") && x.status === "approved" && !own && <Button onClick={() => setDialog("paid")}>Record payment</Button>}
        </div>
      </div>
      {own && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This is your own settlement; other payroll staff must handle it.</p>}
      {canApprove && involved && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Separation of duties: you prepared or edited this settlement, so another payroll approver must approve it.</p>}
      {x.returned_reason && x.status === "draft" && <p className="mb-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-900"><strong>Returned by the approver:</strong> {x.returned_reason}</p>}
      <InlineError message={error} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Settlement lines" actions={canEdit && <Button size="sm" onClick={() => { setLine(null); setDialog("line"); }}><Plus className="h-4 w-4" aria-hidden="true" />Line</Button>}>
          {lines.loading && !lines.data ? <Loading /> : lines.error ? <ErrorState message={lines.error} onRetry={lines.reload} /> : !lines.data?.length ? (
            <EmptyState title="No lines" description="Add earnings and deductions." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <caption className="sr-only">Settlement lines</caption>
                <thead><tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-2 pr-2">Item</th><th className="py-2 pr-2 text-right">Qty × rate</th><th className="py-2 pr-2 text-right">Earning</th><th className="py-2 pr-2 text-right">Deduction</th><th className="py-2" /></tr></thead>
                <tbody>
                  {lines.data.map((l) => (
                    <tr key={l.id} className="border-b border-slate-50 align-top">
                      <td className="py-2 pr-2"><p className="font-medium text-[#101a3a]">{l.label}</p><p className="text-xs text-slate-500">{lineTypeLabel(l.line_type)}{l.source_ref ? " · from records" : ""}</p>{l.note && <p className="text-xs text-slate-600">{l.note}</p>}</td>
                      <td className="py-2 pr-2 text-right text-xs text-slate-500">{l.quantity != null ? `${l.quantity}${l.rate != null ? ` × ${formatMoney(l.rate, x.currency)}` : ""}` : "—"}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{isEarning(l.line_type) ? formatMoney(l.amount, x.currency) : ""}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{isEarning(l.line_type) ? "" : formatMoney(l.amount, x.currency)}</td>
                      <td className="py-2 text-right">{canEdit && <span className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" aria-label={`Edit ${l.label}`} onClick={() => { setLine(l); setDialog("line"); }}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                        <Button size="sm" variant="ghost" aria-label={`Delete ${l.label}`} onClick={() => { setLine(l); setDialog("delete"); }}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                      </span>}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold"><td className="py-2 pr-2">Totals</td><td /><td className="py-2 pr-2 text-right tabular-nums">{formatMoney(totals.e, x.currency)}</td><td className="py-2 pr-2 text-right tabular-nums">{formatMoney(totals.d, x.currency)}</td><td /></tr>
                  <tr className="border-t-2 border-[#101a3a] text-base font-extrabold"><td className="py-2 pr-2">Net {totals.net < 0 ? "(recoverable)" : "(payable)"}</td><td /><td colSpan={2} className="py-2 pr-2 text-right tabular-nums">{formatMoney(Math.abs(totals.net), x.currency)}</td><td /></tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
        <Card title="Details">
          <DescriptionList items={[
            { label: "Exit", value: <Link className="font-semibold text-[#1f4693] hover:underline" to={`/hr/exits/${x.exit_id}`}>{String(x.exit?.exit_type ?? "").replace(/_/g, " ")} · {String(x.exit?.status ?? "").replace(/_/g, " ")}</Link> },
            { label: "Last working day", value: formatDate(x.last_working_day) },
            { label: "Prepared", value: formatDateTime(x.prepared_at) },
            x.submitted_at && { label: "Submitted", value: formatDateTime(x.submitted_at) },
            x.approved_at && { label: "Approved", value: `${formatDateTime(x.approved_at)}${x.approval_note ? ` — ${x.approval_note}` : ""}` },
            x.paid_on && { label: "Paid", value: `${formatDate(x.paid_on)} · ref ${x.payment_reference}` },
            x.notes && { label: "Notes", value: x.notes },
          ]} />
          <p className="mt-4 text-xs text-slate-500">Recording a payment never transfers funds; it records a payout made through the bank.</p>
        </Card>
      </div>

      {dialog === "line" && <LineModal settlementId={x.id} line={line} currency={x.currency} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      <ConfirmDialog open={dialog === "delete"} onClose={() => setDialog(null)} tone="danger" title="Delete line" message={`Delete "${line?.label ?? ""}"?`} confirmLabel="Delete"
        onConfirm={async () => { const res = await deleteSettlementLine(line.id); if (!res.error) { notify("Line deleted."); refresh(); } return res; }} />
      <ConfirmDialog open={dialog === "submit"} onClose={() => setDialog(null)} title="Submit for approval"
        message={`Net ${totals.net < 0 ? "recoverable" : "payable"}: ${formatMoney(Math.abs(totals.net), x.currency)}. A different payroll approver must approve it.`} confirmLabel="Submit" requireReason={false} reasonLabel="Notes (optional)"
        onConfirm={async (notes) => { const res = await submitSettlement(x.id, notes); if (!res.error) { notify("Submitted for approval."); refresh(); } return res; }} />
      <ConfirmDialog open={dialog === "approve"} onClose={() => setDialog(null)} tone="success" title="Approve settlement"
        message="Approval completes the final settlement clearance item and lets the employee see the statement." confirmLabel="Approve" requireReason={false} reasonLabel="Note (optional)"
        onConfirm={async (note) => { const res = await approveSettlement(x.id, true, note); if (!res.error) { notify("Settlement approved."); refresh(); } return res; }} />
      <ConfirmDialog open={dialog === "return"} onClose={() => setDialog(null)} title="Return for changes" message="The settlement goes back to draft for the preparer." confirmLabel="Return" requireReason reasonLabel="What needs to change"
        onConfirm={async (note) => { const res = await approveSettlement(x.id, false, note); if (!res.error) { notify("Returned to the preparer."); refresh(); } return res; }} />
      <ConfirmDialog open={dialog === "cancel"} onClose={() => setDialog(null)} tone="danger" title="Cancel settlement" message="The draft is kept as history; a new one can be prepared." confirmLabel="Cancel settlement" requireReason reasonLabel="Reason"
        onConfirm={async (reason) => { const res = await cancelSettlement(x.id, reason); if (!res.error) { notify("Settlement cancelled."); navigate(BASE); } return res; }} />
      <Modal open={dialog === "paid"} onClose={() => setDialog(null)} title="Record payment" size="sm"
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={async () => {
          setError(null);
          const res = await markSettlementPaid(x.id, paid.reference, paid.date);
          if (res.error) { setError(res.error); return; }
          notify("Payment recorded."); setDialog(null); refresh();
        }}>Record payment</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-600">Record a payout already made through the bank. This does not transfer money.</p>
          <Field label="Bank / payment reference" required><Input value={paid.reference} maxLength={120} onChange={(e) => setPaid((p) => ({ ...p, reference: e.target.value }))} /></Field>
          <Field label="Paid on"><Input type="date" value={paid.date} onChange={(e) => setPaid((p) => ({ ...p, date: e.target.value }))} /></Field>
          <InlineError message={error} />
        </div>
      </Modal>
    </>
  );
}

export default function SettlementPages() {
  return (
    <Routes>
      <Route index element={<Queue />} />
      <Route path=":id" element={<Detail />} />
    </Routes>
  );
}
