// Payment tracking. Records what happened OUTSIDE this system (bank
// transfer, cheque…) with evidence; never initiates a payment. A run is
// marked paid only when every employee's payment is paid or reconciled.
import { useMemo, useState } from "react";
import { History } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, formatMoney, useHrQuery } from "@/lib/hr/client";
import { businessToday, useBusinessTimezone } from "@/lib/hr/attendance";
import { MONEY, PAYMENT_METHODS, PAYMENT_STATUSES, listPaymentEvents, listPayments, listRuns, reconcilePayments, recordPayments } from "@/lib/hr/payroll";
import { Button, Checkbox, DataTable, Field, InlineError, Input, Modal, SearchInput, Select, Textarea, Toolbar, useToast } from "@/hr/ui";
import { EmpCell, PaymentBadge, friendly, label, period } from "./shared";

export default function PaymentsTab({ runId: fixedRun }) {
  const runs = useHrQuery(() => (fixedRun ? Promise.resolve({ data: [] }) : listRuns()), [fixedRun]);
  const [runId, setRunId] = useState(fixedRun ?? "");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const q = useHrQuery(() => listPayments({ runId: fixedRun || runId, status }), [fixedRun, runId, status]);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((p) => !s || `${p.employee?.employee_code} ${p.employee?.first_name} ${p.employee?.last_name} ${p.employee?.display_name ?? ""} ${p.reference ?? ""}`.toLowerCase().includes(s));
  }, [q.data, search]);
  return (
    <>
      <p className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900"><strong>This system never sends money.</strong> Record each payment after it happens in your bank (with its reference). A second person reconciles against the bank statement.</p>
      <Toolbar>
        {!fixedRun && <Field label="Payroll run" className="sm:w-64"><Select placeholder="All finalized runs" value={runId} onChange={(e) => setRunId(e.target.value)}
          options={(runs.data ?? []).filter((r) => ["finalized", "paid"].includes(r.status)).map((r) => ({ value: r.id, label: period(r) }))} /></Field>}
        <Field label="Status" className="sm:w-48"><Select placeholder="Any" value={status} onChange={(e) => setStatus(e.target.value)} options={PAYMENT_STATUSES.map((s) => ({ value: s, label: label(s) }))} /></Field>
        <div className="sm:w-64 self-end"><SearchInput value={search} onChange={setSearch} placeholder="Employee or reference…" label="Search payments" /></div>
      </Toolbar>
      <PaymentsTable rows={rows} query={q} showRun={!fixedRun} />
    </>
  );
}

export function PaymentsTable({ rows, query, showRun }) {
  const { hr, user, hasPermission } = useAuth();
  const { notify } = useToast();
  const canRecord = hasPermission("payroll.approve");
  const me = hr?.employee?.id;
  const [selected, setSelected] = useState(() => new Set());
  const [modal, setModal] = useState(null);
  const [history, setHistory] = useState(null);
  const selectable = (p) => canRecord && p.employee_id !== me && !["reconciled"].includes(p.status);
  const sel = rows.filter((p) => selected.has(p.id));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const totals = rows.reduce((t, p) => ({ due: t.due + Number(p.amount), paid: t.paid + Number(p.amount_paid) }), { due: 0, paid: 0 });
  return (
    <>
      {canRecord && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-600">{sel.length} selected</span>
          <Button size="sm" disabled={!sel.length || sel.some((p) => p.status === "paid")} onClick={() => setModal({ mode: "record" })}>Record status…</Button>
          <Button size="sm" variant="secondary" disabled={!sel.length || sel.some((p) => p.status !== "paid" || p.recorded_by === user?.id)} onClick={() => setModal({ mode: "reconcile" })}>Reconcile…</Button>
          <span className="ml-auto text-xs text-slate-500">Due {formatMoney(totals.due)} · recorded paid {formatMoney(totals.paid)}</span>
        </div>
      )}
      <DataTable caption="Salary payments" rows={rows} loading={query.loading} error={query.error} onRetry={query.reload} pageSize={50} emptyTitle="No payments" emptyDescription="Payments are created when a payroll run is finalized."
        columns={[
          ...(canRecord ? [{ key: "_s", header: <span className="sr-only">Select</span>, render: (p) => (selectable(p)
            ? <Checkbox label={<span className="sr-only">Select payment</span>} checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
            : p.employee_id === me ? <span className="text-[11px] text-slate-400" title="Your own pay is recorded by another person">own</span> : null) }] : []),
          { key: "employee", header: "Employee", render: (p) => <EmpCell e={p.employee} /> },
          ...(showRun ? [{ key: "run", header: "Run", render: (p) => period(p.run) }] : []),
          { key: "amount", header: "Net due", render: (p) => formatMoney(p.amount, p.currency) },
          { key: "amount_paid", header: "Paid", render: (p) => formatMoney(p.amount_paid, p.currency) },
          { key: "status", header: "Status", render: (p) => <PaymentBadge status={p.status} /> },
          { key: "ref", header: "Evidence", render: (p) => (p.reference ? <span className="text-xs"><span className="font-mono">{p.reference}</span><br />{label(p.method)} · {formatDate(p.payment_date)}</span> : p.failure_reason ? <span className="text-xs text-red-700">{p.failure_reason}</span> : "—") },
          { key: "recon", header: "Reconciled", render: (p) => (p.reconciled_at ? <span className="text-xs">{formatDateTime(p.reconciled_at)}<br />{p.reconciliation_note}</span> : "—") },
          { key: "_h", header: <span className="sr-only">History</span>, render: (p) => <Button size="sm" variant="ghost" onClick={() => setHistory(p)} aria-label="Payment history"><History className="h-4 w-4" aria-hidden="true" /></Button> },
        ]} />
      {modal && <RecordModal mode={modal.mode} payments={sel} onClose={() => setModal(null)}
        onDone={(msg) => { setModal(null); setSelected(new Set()); query.reload(); notify(msg); }} />}
      {history && <HistoryModal payment={history} onClose={() => setHistory(null)} />}
    </>
  );
}

function RecordModal({ mode, payments, onClose, onDone }) {
  const tz = useBusinessTimezone();
  const today = businessToday(tz);
  const [v, setV] = useState({ status: "paid", method: "bank_transfer", reference: "", paymentDate: today, amountPaid: "", note: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const needsEvidence = ["paid", "partially_paid"].includes(v.status);
  async function go() {
    if (mode === "reconcile") {
      if (v.note.trim().length < 3) { setError("Enter the reconciliation evidence (e.g. bank statement reference)."); return; }
      setBusy(true); setError(null);
      const res = await reconcilePayments(payments.map((p) => p.id), v.note);
      setBusy(false);
      if (res.error) setError(friendly(res.error)); else onDone(`${res.data?.reconciled ?? 0} payment(s) reconciled.`);
      return;
    }
    if (needsEvidence) {
      if (v.reference.trim().length < 3) { setError("Enter the bank / payment reference."); return; }
      if (!v.paymentDate || v.paymentDate > today) { setError("Enter the payment date (not in the future)."); return; }
    }
    if (v.status === "partially_paid") {
      if (payments.length !== 1) { setError("Record partial payments one employee at a time."); return; }
      if (!MONEY.test(v.amountPaid.trim()) || !(Number(v.amountPaid) > 0) || Number(v.amountPaid) >= Number(payments[0].amount)) { setError("Enter the total amount paid so far (less than the net due)."); return; }
    }
    if (v.status === "failed" && v.note.trim().length < 3) { setError("Give the failure reason."); return; }
    setBusy(true); setError(null);
    const res = await recordPayments({ ids: payments.map((p) => p.id), ...v });
    setBusy(false);
    if (res.error) setError(friendly(res.error)); else onDone(`${res.data?.updated ?? 0} payment(s) recorded as ${label(v.status)}. No money was moved by this system.`);
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title={mode === "reconcile" ? "Reconcile with bank statement" : "Record payment status"} size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={go}>{mode === "reconcile" ? "Reconcile" : "Record"}</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <p>{payments.length} payment(s), total {formatMoney(payments.reduce((s, p) => s + Number(p.amount), 0))}.</p>
        {mode === "record" && <>
          <Field label="Status" required><Select value={v.status} onChange={set("status")} options={["processing", "paid", "partially_paid", "failed", "pending"].map((s) => ({ value: s, label: label(s) }))} /></Field>
          {needsEvidence && <>
            <Field label="Method" required><Select value={v.method} onChange={set("method")} options={PAYMENT_METHODS.map((m) => ({ value: m, label: label(m) }))} /></Field>
            <Field label="Bank / payment reference" required><Input maxLength={120} value={v.reference} onChange={set("reference")} placeholder="e.g. UTR / cheque number" /></Field>
            <Field label="Payment date" required><Input type="date" max={today} value={v.paymentDate} onChange={set("paymentDate")} /></Field>
          </>}
          {v.status === "partially_paid" && <Field label="Total amount paid so far" required><Input type="number" min="0.01" step="0.01" value={v.amountPaid} onChange={set("amountPaid")} /></Field>}
        </>}
        <Field label={mode === "reconcile" ? "Bank statement reference" : v.status === "failed" ? "Failure reason" : "Note"} required={mode === "reconcile" || v.status === "failed"}>
          <Textarea maxLength={1000} value={v.note} onChange={set("note")} />
        </Field>
        {mode === "reconcile" && <p className="text-xs text-slate-500">Reconciliation must be done by someone other than the person who recorded the payment.</p>}
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function HistoryModal({ payment, onClose }) {
  const q = useHrQuery(() => listPaymentEvents(payment.id), [payment.id]);
  return (
    <Modal open onClose={onClose} title="Payment history" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <DataTable caption="Payment history" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} emptyTitle="No changes recorded yet"
        columns={[
          { key: "created_at", header: "When", render: (e) => formatDateTime(e.created_at) },
          { key: "change", header: "Change", render: (e) => <span>{label(e.from_status) || "—"} → <strong>{label(e.to_status)}</strong></span> },
          { key: "amount_paid", header: "Paid", render: (e) => (e.amount_paid != null ? formatMoney(e.amount_paid) : "—") },
          { key: "reference", header: "Reference", render: (e) => e.reference || "—" },
          { key: "note", header: "Note", render: (e) => e.note || "—" },
        ]} />
    </Modal>
  );
}
