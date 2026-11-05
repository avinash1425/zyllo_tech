// Payroll queries / corrections (maker-checker) and final-settlement coverage.
// Finalized payroll is never edited: approved corrections become correction
// adjustments in the next open run.
import { useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, formatMoney, fullName, useHrQuery } from "@/lib/hr/client";
import { useEmployeeOptions } from "@/lib/hr/org";
import {
  CORRECTION_CATEGORIES, CORRECTION_STATUSES, MONEY, createCorrectionRequest, listCorrectionRequests, listRunItems, listRuns, listSettlementCoverage,
  prepareCorrection, recordSettlementCoverage, voidSettlementCoverage,
} from "@/lib/hr/payroll";
import { Badge, Button, Card, ConfirmDialog, DataTable, Field, InlineError, Input, Modal, Select, StatusBadge, Tabs, Textarea, Toolbar, useToast } from "@/hr/ui";
import { EmpCell, friendly, label, period } from "./shared";

export default function CorrectionsTab() {
  const [view, setView] = useState("queries");
  return (
    <>
      <Tabs value={view} onChange={setView} label="Correction sections" tabs={[{ value: "queries", label: "Queries & corrections" }, { value: "settlements", label: "Final settlements" }]} />
      {view === "queries" ? <Queries /> : <Settlements />}
    </>
  );
}

function Queries() {
  const { hr, hasPermission } = useAuth();
  const { notify } = useToast();
  const [status, setStatus] = useState("");
  const q = useHrQuery(() => listCorrectionRequests({ status }), [status]);
  const [preparing, setPreparing] = useState(null);
  const [creating, setCreating] = useState(false);
  const canManage = hasPermission("payroll.manage");
  const me = hr?.employee?.id;
  return (
    <>
      <Toolbar>
        <Field label="Status" className="sm:w-48"><Select placeholder="Any" value={status} onChange={(e) => setStatus(e.target.value)} options={CORRECTION_STATUSES.map((s) => ({ value: s, label: label(s) }))} /></Field>
        <div className="flex-1" />
        {canManage && <Button className="self-end" onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden="true" />Raise correction</Button>}
      </Toolbar>
      <DataTable caption="Payroll queries and corrections" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} emptyTitle="No payroll queries"
        columns={[
          { key: "employee", header: "Employee", render: (r) => <EmpCell e={r.employee} /> },
          { key: "run", header: "Payroll", render: (r) => period(r.run) },
          { key: "category", header: "Category", render: (r) => <span>{label(r.category)}<br /><span className="text-xs text-slate-500">via {r.raised_via}</span></span> },
          { key: "description", header: "Details", render: (r) => <span className="line-clamp-3 max-w-xs">{r.description}{r.evidence_note ? <span className="block text-xs text-slate-500">Evidence: {r.evidence_note}</span> : null}</span> },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "amount", header: "Amount", render: (r) => (r.proposed_amount != null ? formatMoney(r.proposed_amount) : "—") },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (r.employee_id === me ? <span className="text-xs text-slate-500">Own query</span>
            : canManage && ["submitted", "prepared"].includes(r.status) ? <Button size="sm" variant="secondary" onClick={() => setPreparing(r)}>{r.status === "submitted" ? "Prepare" : "Re-prepare"}</Button>
              : r.status === "prepared" ? <span className="text-xs text-slate-500">Awaiting approval (Approvals tab)</span>
                : r.decision_note ? <span className="text-xs text-slate-500">{r.decision_note}</span> : null) },
        ]} />
      <p className="mt-2 text-xs text-slate-500">Flow: query raised → payroll prepares the amount and calculation → a different approver approves → the correction is added to the next open payroll run. Rejections need a reason.</p>
      {preparing && <PrepareModal row={preparing} onClose={() => setPreparing(null)} onDone={() => { setPreparing(null); q.reload(); notify("Correction prepared and sent for approval."); }} />}
      {creating && <RaiseModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); q.reload(); notify("Correction request raised."); }} />}
    </>
  );
}

function PrepareModal({ row, onClose, onDone }) {
  const [v, setV] = useState({ direction: Number(row.proposed_amount) < 0 ? "recover" : "pay", amount: row.proposed_amount ? String(Math.abs(row.proposed_amount)) : "", note: row.preparation_note ?? "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!MONEY.test(v.amount.trim()) || !(Number(v.amount) > 0)) { setError("Enter a positive amount (max 2 decimals)."); return; }
    if (v.note.trim().length < 3) { setError("Explain how the amount was calculated."); return; }
    setBusy(true); setError(null);
    const res = await prepareCorrection(row.id, v.direction === "recover" ? -Number(v.amount) : Number(v.amount), v.note);
    setBusy(false);
    if (res.error) setError(friendly(res.error)); else onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Prepare correction · ${fullName(row.employee)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Send for approval</Button></>}>
      <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">{row.description}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Type" required><Select value={v.direction} onChange={(e) => setV({ ...v, direction: e.target.value })} options={[{ value: "pay", label: "Underpaid: pay extra (+)" }, { value: "recover", label: "Overpaid: recover (−)" }]} /></Field>
        <Field label="Amount" required><Input type="number" min="0.01" step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
        <Field label="Calculation / evidence" required className="sm:col-span-2"><Textarea maxLength={1000} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function RaiseModal({ onClose, onDone }) {
  const { hr } = useAuth();
  const runs = useHrQuery(() => listRuns(), []);
  const [v, setV] = useState({ runId: "", employee: "", category: "missing_earning", description: "", evidence: "" });
  const items = useHrQuery(() => (v.runId ? listRunItems(v.runId) : Promise.resolve({ data: [] })), [v.runId]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function go() {
    if (!v.runId || !v.employee) { setError("Choose a finalized run and an employee in it."); return; }
    if (v.description.trim().length < 5) { setError("Describe the correction."); return; }
    setBusy(true); setError(null);
    const res = await createCorrectionRequest(v);
    setBusy(false);
    if (res.error) setError(friendly(res.error)); else onDone();
  }
  return (
    <Modal open onClose={onClose} title="Raise payroll correction"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Raise</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Finalized payroll run" required><Select placeholder="Choose" value={v.runId} onChange={(e) => setV({ ...v, runId: e.target.value, employee: "" })}
          options={(runs.data ?? []).filter((r) => ["finalized", "paid"].includes(r.status)).map((r) => ({ value: r.id, label: period(r) }))} /></Field>
        <Field label="Employee" required><Select placeholder="Choose" value={v.employee} onChange={set("employee")}
          options={(items.data ?? []).filter((i) => i.employee_id !== hr?.employee?.id).map((i) => ({ value: i.employee_id, label: `${fullName(i.employee)} (${i.employee?.employee_code})` }))} /></Field>
        <Field label="Category" required><Select value={v.category} onChange={set("category")} options={CORRECTION_CATEGORIES.map((c) => ({ value: c, label: label(c) }))} /></Field>
        <Field label="Evidence reference"><Input maxLength={1000} value={v.evidence} onChange={set("evidence")} placeholder="e.g. approved leave ID, attendance correction" /></Field>
        <Field label="Description" required className="sm:col-span-2"><Textarea maxLength={2000} value={v.description} onChange={set("description")} /></Field>
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function Settlements() {
  const { hr, hasPermission } = useAuth();
  const { notify } = useToast();
  const q = useHrQuery(() => listSettlementCoverage(), []);
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState(null);
  const canRecord = hasPermission("payroll.approve");
  return (
    <>
      <Card className="mb-3">
        <p className="text-sm text-slate-700">When an exiting employee's final (full-and-final) settlement pays salary up to a date, record it here. Payroll then excludes those days, so the same days are never paid twice. Calculations warn when an employee is in exit / final settlement without coverage.</p>
      </Card>
      <Toolbar>
        <div className="flex-1" />
        {canRecord && <Button className="self-end" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" />Record settlement coverage</Button>}
      </Toolbar>
      <DataTable caption="Final-settlement coverage" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} emptyTitle="No settlements recorded"
        columns={[
          { key: "employee", header: "Employee", render: (r) => <EmpCell e={r.employee} /> },
          { key: "covered_through", header: "Paid through", render: (r) => formatDate(r.covered_through) },
          { key: "settlement_reference", header: "Reference" },
          { key: "status", header: "Status", render: (r) => <Badge tone={r.status === "active" ? "green" : "slate"}>{r.status}</Badge> },
          { key: "created_at", header: "Recorded", render: (r) => formatDateTime(r.created_at) },
          ...(canRecord ? [{ key: "_a", header: <span className="sr-only">Void</span>, render: (r) => r.status === "active" && r.employee_id !== hr?.employee?.id && <Button size="sm" variant="ghost" onClick={() => setVoiding(r)}>Void</Button> }] : []),
        ]} />
      {adding && <CoverageModal onClose={() => setAdding(false)} onDone={(d) => { setAdding(false); q.reload(); notify(d?.overlaps_paid_payroll ? `Recorded. Note: payroll was already approved up to ${formatDate(d.payroll_paid_through)} — confirm the settlement does not pay those days.` : "Settlement coverage recorded."); }} />}
      <ConfirmDialog open={Boolean(voiding)} onClose={() => setVoiding(null)} title="Void settlement coverage?" tone="danger" confirmLabel="Void" requireReason reasonLabel="Reason"
        message={voiding ? `${fullName(voiding.employee)} · paid through ${formatDate(voiding.covered_through)}` : ""}
        onConfirm={async (reason) => {
          const res = await voidSettlementCoverage(voiding.id, reason);
          if (res.error) return { error: friendly(res.error) };
          q.reload(); notify("Coverage voided.");
          return {};
        }} />
    </>
  );
}

function CoverageModal({ onClose, onDone }) {
  const { hr } = useAuth();
  const employees = useEmployeeOptions({ includeInactive: true });
  const [v, setV] = useState({ employee: "", coveredThrough: "", reference: "", note: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function go() {
    if (!v.employee || !v.coveredThrough || v.reference.trim().length < 3) { setError("Employee, date and settlement reference are required."); return; }
    setBusy(true); setError(null);
    const res = await recordSettlementCoverage(v);
    setBusy(false);
    if (res.error) setError(friendly(res.error)); else onDone(res.data);
  }
  return (
    <Modal open onClose={onClose} title="Record final-settlement coverage"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Record</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Employee" required className="sm:col-span-2"><Select placeholder="Choose" value={v.employee} onChange={set("employee")} options={(employees.data ?? []).filter((o) => o.value !== hr?.employee?.id)} /></Field>
        <Field label="Salary paid through (in the settlement)" required><Input type="date" value={v.coveredThrough} onChange={set("coveredThrough")} /></Field>
        <Field label="Settlement reference" required><Input maxLength={120} value={v.reference} onChange={set("reference")} /></Field>
        <Field label="Note" className="sm:col-span-2"><Textarea maxLength={1000} value={v.note} onChange={set("note")} /></Field>
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}
