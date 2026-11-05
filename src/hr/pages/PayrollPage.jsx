// Payroll & Salary (payroll.* permissions only; HR admins have none by
// default). Run lifecycle: Draft -> Calculated (preview) -> Submitted ->
// Approved -> Finalized (payment pending) -> Paid, with return-for-correction
// before finalization. Every step is a server RPC that enforces state,
// locking, maker-checker and separation of duties (nobody can prepare,
// approve or pay a change to their own compensation). Payment actions only
// RECORD what happened outside this system — nothing initiates a payment.
import { useMemo, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Calculator, Check, Download, Eye, EyeOff, PauseCircle, Plus, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { exportCsv, formatDate, formatDateTime, formatMoney, fullName, useHrQuery } from "@/lib/hr/client";
import { toOptions, useEmployeeOptions, useOrg } from "@/lib/hr/org";
import { businessToday, useBusinessTimezone } from "@/lib/hr/attendance";
import {
  ACCOUNT_NO, IFSC, MONEY, REIMBURSEMENT_STATUSES, RUN_STEPS, RUN_STEP_LABELS, addAdjustment, approveRun, calculateRun, createCorrection, createRun,
  decideAdjustment, decideReimbursement, finalizeRun, getRun, listBankAccounts, listComponents, listCorrectionsFromRun, listPayments, listReimbursements,
  listRunAdjustments, listRunHolds, listRunItems, listRuns, logExport, markRunPaid, maskAccount, returnRun, reviewRun, saveBankAccount, setHold, verifyBankAccount,
} from "@/lib/hr/payroll";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, ErrorState, Field, InlineError, Input, KpiCard, Modal, PageHeader,
  SearchInput, Select, StatusBadge, Tabs, Textarea, Toolbar, Loading, useToast,
} from "@/hr/ui";
import { PayslipModal } from "@/employee/pages/MyPayslipsPage";
import SalaryComponentsSettings from "@/hr/settings/SalaryComponentsSettings";
import { EmpCell, PaymentBadge, RunBadge, SelfNote, friendly, label, period } from "./payroll/shared";
import OverviewTab from "./payroll/OverviewTab";
import StructuresTab from "./payroll/StructuresTab";
import ApprovalsTab from "./payroll/ApprovalsTab";
import PaymentsTab, { PaymentsTable } from "./payroll/PaymentsTab";
import StatutoryTab from "./payroll/StatutoryTab";
import CorrectionsTab from "./payroll/CorrectionsTab";
import ReportsTab from "./payroll/ReportsTab";

export default function PayrollPage() {
  return (
    <Routes>
      <Route index element={<PayrollHome />} />
      <Route path="runs/:id" element={<RunDetail />} />
    </Routes>
  );
}

function PayrollHome() {
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const canView = hasPermission("payroll.view");
  const tabs = canView ? [
    { value: "overview", label: "Overview" }, { value: "runs", label: "Payroll runs" }, { value: "approvals", label: "Approvals" },
    { value: "structures", label: "Salary structures" }, { value: "components", label: "Allowances & deductions" }, { value: "statutory", label: "Statutory" },
    { value: "payments", label: "Payments" }, { value: "corrections", label: "Corrections" }, { value: "bank", label: "Bank accounts" },
    { value: "reimbursements", label: "Reimbursements" }, { value: "reports", label: "Reports" },
  ] : [];
  const tab = tabs.some((t) => t.value === params.get("tab")) ? params.get("tab") : "overview";
  const open = (v) => setParams({ tab: v }, { replace: true });
  if (!canView) return <ErrorState message="Payroll data requires the payroll.view permission." />;
  return (
    <>
      <PageHeader title="Payroll & Salary" description="Salary structures, allowances, deductions, statutory rules, payroll runs, approvals, payslips and payment tracking. Restricted to payroll staff." />
      <Tabs tabs={tabs} value={tab} onChange={open} label="Payroll sections" />
      {tab === "overview" && <OverviewTab onOpenTab={open} />}
      {tab === "runs" && <RunsList />}
      {tab === "approvals" && <ApprovalsTab />}
      {tab === "structures" && <StructuresTab />}
      {tab === "components" && <SalaryComponentsSettings canEdit={hasPermission("payroll.manage")} />}
      {tab === "statutory" && <StatutoryTab />}
      {tab === "payments" && <PaymentsTab />}
      {tab === "corrections" && <CorrectionsTab />}
      {tab === "bank" && <BankAccounts />}
      {tab === "reimbursements" && <Reimbursements />}
      {tab === "reports" && <ReportsTab />}
    </>
  );
}

// ================================================================ runs
function RunsList() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const org = useOrg();
  const q = useHrQuery(() => listRuns(), []);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("");
  const entities = Object.fromEntries((org.data?.legalEntities ?? []).map((e) => [e.id, e.name]));
  const rows = (q.data ?? []).filter((r) => !status || r.status === status);
  return (
    <>
      <Toolbar>
        <Field label="Status" className="sm:w-56"><Select placeholder="Any" value={status} onChange={(e) => setStatus(e.target.value)} options={RUN_STEPS.map((s) => ({ value: s, label: RUN_STEP_LABELS[s] }))} /></Field>
        <p className="flex-1 self-end text-sm text-slate-600">Open a run to calculate, submit, approve and finalize it. Finalized runs are locked; changes go through corrections.</p>
        {hasPermission("payroll.manage") && <Button className="self-end" onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden="true" />New payroll run</Button>}
      </Toolbar>
      <DataTable caption="Payroll runs" rows={rows} loading={q.loading} error={q.error} onRetry={q.reload} onRowClick={(r) => navigate(`/hr/payroll/runs/${r.id}`)}
        emptyTitle="No payroll runs yet"
        columns={[
          { key: "period", header: "Period", render: (r) => <span className="font-semibold text-[#101a3a]">{period(r)}</span> },
          { key: "scope", header: "Scope", render: (r) => (r.legal_entity_id ? entities[r.legal_entity_id] ?? "Company" : "All companies") },
          { key: "status", header: "Status", render: (r) => <RunBadge status={r.status} /> },
          { key: "payment_status", header: "Payment", render: (r) => (["finalized", "paid"].includes(r.status) ? <PaymentBadge status={r.payment_status} /> : "—") },
          { key: "employees", header: "Employees", render: (r) => r.validation?.employees ?? "—" },
          { key: "checks", header: "Checks", render: (r) => (r.validation?.items_with_errors ? <Badge tone="red">{r.validation.items_with_errors} error(s)</Badge> : r.validation?.items_with_warnings ? <Badge tone="amber">{r.validation.items_with_warnings} warning(s)</Badge> : "—") },
          { key: "finalized_at", header: "Finalized", render: (r) => formatDateTime(r.finalized_at) },
        ]} />
      {creating && <CreateRunModal entities={org.data?.legalEntities} onClose={() => setCreating(false)} onCreated={(run) => navigate(`/hr/payroll/runs/${run.id}`)} />}
    </>
  );
}

function CreateRunModal({ entities, onClose, onCreated }) {
  const { notify } = useToast();
  const tz = useBusinessTimezone();
  const today = businessToday(tz);
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const [v, setV] = useState({ start: `${today.slice(0, 7)}-01`, end: `${today.slice(0, 7)}-${String(last).padStart(2, "0")}`, notes: "", legalEntity: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!v.start || !v.end || v.end < v.start) { setError("Choose a valid period (end on or after start)."); return; }
    if ((new Date(v.end) - new Date(v.start)) / 86400000 > 62) { setError("A payroll period cannot be longer than two months."); return; }
    setBusy(true); setError(null);
    const res = await createRun(v);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(`Payroll run for ${period({ period_start: v.start, period_end: v.end })} created as draft.`);
    onCreated(res.data);
  }
  return (
    <Modal open onClose={onClose} title="New payroll run" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Create draft</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Period start" required><Input type="date" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} /></Field>
        <Field label="Period end" required><Input type="date" value={v.end} min={v.start} onChange={(e) => setV({ ...v, end: e.target.value })} /></Field>
        <Field label="Scope" className="sm:col-span-2" hint="A company-wide run includes every employee with an approved salary structure.">
          <Select placeholder="All companies" value={v.legalEntity} onChange={(e) => setV({ ...v, legalEntity: e.target.value })} options={toOptions(entities)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea maxLength={2000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">Runs for the same scope cannot overlap, and a company-wide run cannot overlap any company run.</p>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function Stepper({ status }) {
  const steps = [...RUN_STEPS];
  const idx = steps.indexOf(status);
  return (
    <ol className="mb-4 flex flex-wrap gap-2" aria-label="Payroll run progress">
      {steps.map((s, i) => (
        <li key={s} aria-current={i === idx ? "step" : undefined}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${i < idx ? "bg-emerald-50 text-emerald-700" : i === idx ? "bg-gradient-to-r from-[#f7941e] to-[#f96706] text-white" : "bg-slate-100 text-slate-500"}`}>
          {i < idx ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <span aria-hidden="true">{i + 1}</span>}{RUN_STEP_LABELS[s]}
        </li>
      ))}
    </ol>
  );
}

function ValidationList({ title, list, tone }) {
  if (!list?.length) return null;
  return (
    <div className={`rounded-lg px-3 py-2 text-sm ${tone === "red" ? "bg-rose-50 text-rose-900" : "bg-amber-50 text-amber-900"}`}>
      <p className="font-semibold">{title}</p>
      <ul className="list-disc pl-5">{list.map((x, i) => <li key={`${x.code}-${i}`}>{x.message}</li>)}</ul>
    </div>
  );
}

function RunDetail() {
  const { id } = useParams();
  const { user, hr, hasPermission } = useAuth();
  const { notify } = useToast();
  const runQ = useHrQuery(() => getRun(id), [id]);
  const items = useHrQuery(() => listRunItems(id), [id]);
  const adjustments = useHrQuery(() => listRunAdjustments(id), [id]);
  const corrections = useHrQuery(() => listCorrectionsFromRun(id), [id]);
  const holds = useHrQuery(() => listRunHolds(id), [id]);
  const run = runQ.data;
  const finalized = run && ["finalized", "paid"].includes(run.status);
  const payments = useHrQuery(() => (finalized ? listPayments({ runId: id }) : Promise.resolve({ data: [] })), [id, finalized]);
  const [action, setAction] = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const [preview, setPreview] = useState(null);
  const [adding, setAdding] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [holding, setHolding] = useState(false);
  const [deciding, setDeciding] = useState(null);
  const [search, setSearch] = useState("");
  const [onlyFlags, setOnlyFlags] = useState(false);
  const canManage = hasPermission("payroll.manage");
  const canApprove = hasPermission("payroll.approve");
  const me = hr?.employee?.id;
  const reloadAll = () => { runQ.reload(); items.reload(); adjustments.reload(); corrections.reload(); holds.reload(); payments.reload(); };

  const totals = useMemo(() => (items.data ?? []).reduce((t, i) => ({
    gross: t.gross + Number(i.gross), ded: t.ded + Number(i.total_deductions), net: t.net + Number(i.net), employer: t.employer + Number(i.employer_contributions),
    errors: t.errors + ((i.breakdown?.validation?.errors ?? []).length ? 1 : 0), warnings: t.warnings + ((i.breakdown?.validation?.warnings ?? []).length ? 1 : 0),
  }), { gross: 0, ded: 0, net: 0, employer: 0, errors: 0, warnings: 0 }), [items.data]);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (items.data ?? [])
      .filter((i) => !s || fullName(i.employee).toLowerCase().includes(s) || i.employee?.employee_code?.toLowerCase().includes(s))
      .filter((i) => !onlyFlags || (i.breakdown?.validation?.errors ?? []).length || (i.breakdown?.validation?.warnings ?? []).length)
      .sort((a, b) => String(a.employee?.employee_code).localeCompare(String(b.employee?.employee_code)));
  }, [items.data, search, onlyFlags]);

  if (runQ.loading && !run) return <Loading />;
  if (runQ.error) return <ErrorState message={runQ.error} onRetry={runQ.reload} />;
  if (!run) return <ErrorState message="Payroll run not found." />;
  const cur = items.data?.[0]?.currency || "INR";
  const preparedByMe = user?.id && (user.id === run.created_by || user.id === run.calculated_by);
  const myAdjustment = (adjustments.data ?? []).some((a) => a.status !== "rejected" && (a.created_by === user?.id || (me && a.employee_id === me)));
  const open = ["draft", "calculated", "reviewed"].includes(run.status);
  const pendingAdj = (adjustments.data ?? []).filter((a) => a.status === "pending").length;
  const excluded = run.validation?.excluded ?? [];

  const ACTIONS = {
    calculate: { title: run.status === "draft" ? "Calculate payroll?" : "Recalculate payroll?", confirm: run.status === "draft" ? "Calculate" : "Recalculate",
      message: "Items are rebuilt by the server from approved salary structures, approved unpaid leave, validated statutory rules, approved adjustments, pending corrections and approved reimbursements. The result is a preview until submitted.",
      run: () => calculateRun(run.id), done: (d) => `Calculated ${d?.employees ?? 0} employee(s): net ${formatMoney(d?.net, cur)}${d?.items_with_errors ? ` · ${d.items_with_errors} with errors` : ""}.` },
    review: { title: "Submit for approval?", confirm: "Submit", reason: false, reasonLabel: "Note for the approver (optional)",
      message: "Confirms the calculated figures have been checked. Runs with validation errors or unapproved variable pay cannot be submitted.", run: (note) => reviewRun(run.id, note), done: () => "Submitted for approval." },
    approve: { title: "Approve payroll?", confirm: "Approve", tone: "success",
      message: "After approval, items and adjustments are locked. The approver must not have prepared the run, created an adjustment in it, or be the subject of one.",
      run: () => approveRun(run.id), done: () => "Payroll approved." },
    return: { title: "Return for correction?", confirm: "Return", tone: "danger", reason: true, reasonLabel: "What needs correcting",
      message: "The run goes back to the preparer (Calculated). It must be recalculated or re-submitted before approval.", run: (note) => returnRun(run.id, note), done: () => "Run returned to the preparer." },
  };

  async function exportRegister() {
    const audit = await logExport("payroll_register", run.id, rows.length);
    if (audit.error) { notify(audit.error, "error"); return; }
    exportCsv(`payroll-${run.period_start}-to-${run.period_end}`, rows, [
      { label: "Employee ID", value: (r) => r.employee?.employee_code }, { label: "Employee", value: (r) => fullName(r.employee) },
      { label: "Currency", key: "currency" }, { label: "Working days", key: "working_days" }, { label: "Payable days", key: "payable_days" },
      { label: "LOP days", key: "lop_days" }, { label: "Gross", key: "gross" }, { label: "Deductions", key: "total_deductions" },
      { label: "Employer contributions", key: "employer_contributions" }, { label: "Reimbursements", key: "reimbursements" }, { label: "Net", key: "net" },
      { label: "Warnings", value: (r) => (r.breakdown?.validation?.warnings ?? []).map((x) => x.code).join(" ") },
    ]);
    notify(`Exported ${rows.length} payroll items (audited).`);
  }

  return (
    <>
      <Link to="/hr/payroll?tab=runs" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-[#1f4693] hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />All payroll runs</Link>
      <PageHeader title={`Payroll ${period(run)}`} description={run.notes || "Payroll run"}
        actions={hasPermission("payroll.export") && items.data?.length > 0 && <Button variant="secondary" onClick={exportRegister}><Download className="h-4 w-4" aria-hidden="true" />Export CSV</Button>} />
      <Stepper status={run.status} />

      <Card title="Actions">
        <div className="flex flex-wrap items-center gap-2">
          {canManage && ["draft", "calculated"].includes(run.status) && <Button onClick={() => setAction("calculate")}><Calculator className="h-4 w-4" aria-hidden="true" />{run.status === "draft" ? "Calculate" : "Recalculate"}</Button>}
          {(canManage || canApprove) && run.status === "calculated" && <Button variant="secondary" disabled={totals.errors > 0 || pendingAdj > 0} onClick={() => setAction("review")}>Submit for approval</Button>}
          {canApprove && run.status === "reviewed" && <Button variant="success" disabled={preparedByMe || myAdjustment} onClick={() => setAction("approve")}>Approve</Button>}
          {canApprove && ["reviewed", "approved"].includes(run.status) && <Button variant="secondary" onClick={() => setAction("return")}>Return for correction</Button>}
          {canApprove && run.status === "approved" && <Button variant="danger" disabled={preparedByMe || myAdjustment} onClick={() => setAction("finalize")}>Finalize &amp; publish payslips</Button>}
          {canApprove && run.status === "finalized" && <Button variant="secondary" onClick={() => setAction("paid")}>Record whole run as paid</Button>}
          {canManage && open && <Button variant="secondary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" />Add adjustment</Button>}
          {canManage && ["draft", "calculated"].includes(run.status) && <Button variant="ghost" onClick={() => setHolding(true)}><PauseCircle className="h-4 w-4" aria-hidden="true" />Holds ({holds.data?.length ?? 0})</Button>}
          {canManage && finalized && <Button variant="secondary" onClick={() => setCorrecting(true)}>Post-finalization correction</Button>}
          {!canManage && !canApprove && <p className="text-sm text-slate-500">Read-only access.</p>}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-6">
          <div><dt className="font-semibold">Created</dt><dd>{formatDateTime(run.created_at)}</dd></div>
          <div><dt className="font-semibold">Calculated</dt><dd>{formatDateTime(run.calculated_at)}</dd></div>
          <div><dt className="font-semibold">Submitted</dt><dd>{formatDateTime(run.reviewed_at)}</dd></div>
          <div><dt className="font-semibold">Approved</dt><dd>{formatDateTime(run.approved_at)}</dd></div>
          <div><dt className="font-semibold">Finalized</dt><dd>{formatDateTime(run.finalized_at)}</dd></div>
          <div><dt className="font-semibold">Payment</dt><dd>{finalized ? <PaymentBadge status={run.payment_status} /> : "—"}</dd></div>
        </dl>
        {run.return_reason && run.status === "calculated" && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900"><strong>Returned {formatDateTime(run.returned_at)}:</strong> {run.return_reason}</p>}
        {canApprove && (preparedByMe || myAdjustment) && ["reviewed", "approved"].includes(run.status) && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {preparedByMe ? "You created or calculated this run." : "You created an adjustment in this run, or one changes your own pay."} Another payroll approver must approve and finalize it; the server refuses otherwise.</p>
        )}
        {pendingAdj > 0 && <p className="mt-2 text-xs text-amber-800">{pendingAdj} variable-pay / recovery entr{pendingAdj === 1 ? "y is" : "ies are"} waiting for a separate approver.</p>}
        {open && run.status !== "draft" && <p className="mt-2 text-xs text-slate-500">Adding an adjustment or changing a hold returns the run to Draft; it must then be recalculated and submitted again.</p>}
        {run.status === "paid" && <p className="mt-2 text-sm text-slate-600">Paid · reference <strong>{run.payment_reference}</strong> · {formatDateTime(run.paid_at)}</p>}
        <div className="mt-2"><SelfNote /></div>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Employees" value={items.data?.length ?? 0} tone="navy" loading={items.loading} hint={excluded.length ? `${excluded.length} excluded` : undefined} />
        <KpiCard label="Gross" value={formatMoney(totals.gross, cur)} tone="teal" loading={items.loading} />
        <KpiCard label="Deductions" value={formatMoney(totals.ded, cur)} tone="red" loading={items.loading} hint={totals.employer ? `Employer cost ${formatMoney(totals.employer, cur)}` : undefined} />
        <KpiCard label="Net pay" value={formatMoney(totals.net, cur)} tone="green" loading={items.loading} />
      </div>
      {(totals.errors > 0 || totals.warnings > 0 || excluded.length > 0) && (
        <div className="mt-3 flex flex-col gap-2">
          {totals.errors > 0 && <p className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{totals.errors} employee(s) have validation errors. Fix them and recalculate; the run cannot be submitted until then.</p>}
          {totals.warnings > 0 && <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{totals.warnings} employee(s) have warnings to review (unverified components, statutory rules pending validation, missing bank details, pending leave/attendance, exits).</p>}
          {excluded.length > 0 && <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">Excluded: {excluded.map((x) => `${x.employee_code} (${label(x.reason)})`).join(", ")}.</p>}
        </div>
      )}

      <div className="mt-4">
        <Card title="Payroll items" padded={false} actions={<div className="flex flex-wrap items-center gap-3"><Checkbox label="Only with errors/warnings" checked={onlyFlags} onChange={(e) => setOnlyFlags(e.target.checked)} /><div className="w-60"><SearchInput value={search} onChange={setSearch} placeholder="Search employee…" label="Search payroll items" /></div></div>}>
          <DataTable caption="Payroll items" rows={rows} loading={items.loading} error={items.error} onRetry={items.reload} onRowClick={setBreakdown} pageSize={50}
            emptyTitle={run.status === "draft" ? "Not calculated yet" : "No items"} emptyDescription={run.status === "draft" ? "Calculate the run to build the payroll preview." : "No employee had an approved salary structure in this period."}
            columns={[
              { key: "employee", header: "Employee", render: (r) => <EmpCell e={r.employee} /> },
              { key: "days", header: "Working / payable / LOP", render: (r) => `${Number(r.working_days)} / ${Number(r.payable_days)} / ${Number(r.lop_days)}` },
              { key: "gross", header: "Gross", render: (r) => formatMoney(r.gross, r.currency) },
              { key: "total_deductions", header: "Deductions", render: (r) => formatMoney(r.total_deductions, r.currency) },
              { key: "reimbursements", header: "Reimb.", render: (r) => (Number(r.reimbursements) ? formatMoney(r.reimbursements, r.currency) : "—") },
              { key: "net", header: "Net", render: (r) => <strong>{formatMoney(r.net, r.currency)}</strong> },
              { key: "flags", header: "Checks", render: (r) => {
                const e = (r.breakdown?.validation?.errors ?? []).length; const w = (r.breakdown?.validation?.warnings ?? []).length;
                return e ? <Badge tone="red">{e} error{e > 1 ? "s" : ""}</Badge> : w ? <Badge tone="amber">{w} warning{w > 1 ? "s" : ""}</Badge> : <Badge tone="green">ok</Badge>;
              } },
            ]} />
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Adjustments in this run" padded={false}>
          <DataTable caption="Adjustments" rows={adjustments.data} loading={adjustments.loading} error={adjustments.error} onRetry={adjustments.reload} emptyTitle="No adjustments"
            columns={[
              { key: "employee", header: "Employee", render: (r) => <EmpCell e={r.employee} /> },
              { key: "label", header: "Label" },
              { key: "amount", header: "Amount", render: (r) => <span className={Number(r.amount) < 0 ? "text-red-600" : "text-emerald-700"}>{formatMoney(r.amount, cur)}</span> },
              { key: "source", header: "Source", render: (r) => <Badge tone={r.source === "correction" ? "violet" : "slate"}>{r.source}</Badge> },
              { key: "status", header: "Approval", render: (r) => <StatusBadge status={r.status} /> },
              { key: "reason", header: "Reason", render: (r) => <span className="line-clamp-2 max-w-xs">{r.reason}</span> },
              { key: "_a", header: <span className="sr-only">Decide</span>, render: (r) => r.status === "pending" && canApprove && open && (
                r.created_by === user?.id || r.employee_id === me ? <span className="text-xs text-slate-500">Another approver</span>
                  : <div className="flex gap-1"><Button size="sm" variant="success" onClick={() => setDeciding({ row: r, approve: true })}>Approve</Button><Button size="sm" variant="danger" onClick={() => setDeciding({ row: r, approve: false })}>Reject</Button></div>) },
            ]} />
        </Card>
      </div>

      {finalized && (
        <>
          <div className="mt-4">
            <Card title="Salary payments" actions={<Link className="text-sm font-semibold text-[#1f4693] hover:underline" to="/hr/payroll?tab=payments">All payments</Link>}>
              <PaymentsTable rows={payments.data ?? []} query={{ ...payments, reload: () => { payments.reload(); runQ.reload(); } }} />
            </Card>
          </div>
          <div className="mt-4">
            <Card title="Corrections recorded against this run" padded={false}>
              <DataTable caption="Corrections" rows={corrections.data} loading={corrections.loading} error={corrections.error} onRetry={corrections.reload} emptyTitle="No corrections"
                columns={[
                  { key: "employee", header: "Employee", render: (r) => <EmpCell e={r.employee} /> },
                  { key: "amount", header: "Amount", render: (r) => formatMoney(r.amount, cur) },
                  { key: "reason", header: "Reason" },
                  { key: "run_id", header: "Applied in", render: (r) => (r.run_id ? <Link className="text-[#1f4693] hover:underline" to={`/hr/payroll/runs/${r.run_id}`}>next run</Link> : <Badge tone="amber">waiting for next run</Badge>) },
                ]} />
            </Card>
          </div>
        </>
      )}

      {action && ACTIONS[action] && (
        <ConfirmDialog open onClose={() => setAction(null)} title={ACTIONS[action].title} confirmLabel={ACTIONS[action].confirm} tone={ACTIONS[action].tone}
          message={ACTIONS[action].message} requireReason={ACTIONS[action].reason} reasonLabel={ACTIONS[action].reasonLabel}
          onConfirm={async (note) => {
            const res = await ACTIONS[action].run(note);
            if (res.error) return { error: friendly(res.error) };
            notify(ACTIONS[action].done(res.data)); reloadAll();
            return {};
          }} />
      )}
      {deciding && (
        <ConfirmDialog open onClose={() => setDeciding(null)} title={deciding.approve ? "Approve entry?" : "Reject entry?"} tone={deciding.approve ? "success" : "danger"}
          confirmLabel={deciding.approve ? "Approve" : "Reject"} message={`${fullName(deciding.row.employee)} · ${deciding.row.label} · ${formatMoney(deciding.row.amount, cur)}`}
          requireReason={!deciding.approve} reasonLabel={deciding.approve ? "Note (optional)" : "Reason"}
          onConfirm={async (note) => {
            const res = await decideAdjustment(deciding.row.id, deciding.approve, note);
            if (res.error) return { error: friendly(res.error) };
            notify("Decision recorded. Recalculate the run to include it."); reloadAll();
            return {};
          }} />
      )}
      {action === "finalize" && <FinalizeModal run={run} employees={items.data?.length ?? 0} net={formatMoney(totals.net, cur)} onClose={() => setAction(null)} onDone={(n) => { setAction(null); reloadAll(); notify(`Payroll finalized; ${n} payslip(s) published. Payments are now pending.`); }} />}
      {action === "paid" && <PaidModal run={run} onClose={() => setAction(null)} onDone={() => { setAction(null); reloadAll(); notify("Payment recorded. No money was moved by this system."); }} />}
      {breakdown && <BreakdownModal item={breakdown} run={run} onClose={() => setBreakdown(null)} onPreview={() => { setPreview(breakdown); setBreakdown(null); }} />}
      {preview && (
        <PayslipModal title={finalized ? "Payslip" : "Payslip preview (not released)"} onClose={() => setPreview(null)}
          slip={{ ...preview, period_start: run.period_start, period_end: run.period_end, published_at: finalized ? run.finalized_at : null }}
          employee={{ name: fullName(preview.employee), employee_code: preview.employee?.employee_code }} />
      )}
      {adding && <AdjustmentModal run={run} items={items.data ?? []} onClose={() => setAdding(false)} onSaved={(pending) => { setAdding(false); reloadAll(); notify(pending ? "Entry added; it needs approval by another payroll approver, then recalculate." : "Adjustment added. Recalculate the run to include it."); }} />}
      {correcting && <CorrectionModal run={run} items={(items.data ?? []).filter((i) => i.employee_id !== me)} onClose={() => setCorrecting(false)} onSaved={(a) => { setCorrecting(false); reloadAll(); notify(a?.run_id ? "Correction added to the next open run." : "Correction recorded; it will be applied when the next run is calculated."); }} />}
      {holding && <HoldsModal run={run} holds={holds.data ?? []} onClose={() => setHolding(false)} onChanged={() => { reloadAll(); }} />}
    </>
  );
}

function HoldsModal({ run, holds, onClose, onChanged }) {
  const { hr } = useAuth();
  const { notify } = useToast();
  const employees = useEmployeeOptions();
  const [v, setV] = useState({ employee: "", reason: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function change(employee, hold, reason) {
    setBusy(true); setError(null);
    const res = await setHold({ runId: run.id, employee, hold, reason });
    setBusy(false);
    if (res.error) { setError(friendly(res.error)); return; }
    notify(hold ? "Pay held for this run. Recalculate to apply." : "Hold released. Recalculate to include the employee.");
    setV({ employee: "", reason: "" }); onChanged();
  }
  return (
    <Modal open onClose={onClose} title="Payroll holds" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <p className="mb-3 text-sm text-slate-600">Held employees are left out of this run (for example pending clearance or a disputed amount). Release the hold to pay them in this run, or pay later via a correction.</p>
      <ul className="mb-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {!holds.length && <li className="px-3 py-2 text-sm text-slate-500">No holds.</li>}
        {holds.map((h) => (
          <li key={h.employee_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <span><strong>{fullName(h.employee)}</strong> · {h.reason}</span>
            {h.employee_id !== hr?.employee?.id && <Button size="sm" variant="ghost" disabled={busy} onClick={() => change(h.employee_id, false)}>Release</Button>}
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Employee"><Select placeholder="Choose" value={v.employee} onChange={(e) => setV({ ...v, employee: e.target.value })} options={(employees.data ?? []).filter((o) => o.value !== hr?.employee?.id)} /></Field>
        <Field label="Reason"><Input maxLength={500} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
      </div>
      <div className="mt-2 flex justify-end"><Button size="sm" loading={busy} disabled={!v.employee || v.reason.trim().length < 3} onClick={() => change(v.employee, true, v.reason)}>Hold pay</Button></div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function FinalizeModal({ run, employees, net, onClose, onDone }) {
  const [ack, setAck] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!ack) { setError("Tick the confirmation to continue."); return; }
    setBusy(true); setError(null);
    const res = await finalizeRun(run.id);
    setBusy(false);
    if (res.error) setError(friendly(res.error)); else onDone(res.data?.payslips ?? 0);
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title="Finalize payroll — irreversible" size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="danger" loading={busy} onClick={go}>Finalize</Button></>}>
      <div className="flex flex-col gap-3 text-sm text-slate-700">
        <p>Finalizing {period(run)} for <strong>{employees}</strong> employee(s), net <strong>{net}</strong>, will:</p>
        <ul className="list-disc pl-5">
          <li>permanently lock the run and its items;</li>
          <li>create immutable payslips and notify every employee;</li>
          <li>create one pending payment record per employee for tracking.</li>
        </ul>
        <p>Mistakes after this point can only be fixed with a correction in a later run.</p>
        <Checkbox label="I understand this cannot be undone." checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function PaidModal({ run, onClose, onDone }) {
  const [ref, setRef] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (ref.trim().length < 3) { setError("Enter the bank / payment reference (at least 3 characters)."); return; }
    setBusy(true); setError(null);
    const res = await markRunPaid(run.id, ref);
    setBusy(false);
    if (res.error) setError(friendly(res.error)); else onDone();
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title="Record whole run as paid" size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={go}>Record as paid</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900"><strong>This does not send any money.</strong> It records that every pending salary for {period(run)} was paid outside this system in one batch (for example a bank file you uploaded), and marks included reimbursements as paid. If any payment failed or was partial, record payments individually below instead.</p>
        <Field label="Batch / payment reference" required><Input maxLength={120} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. SAMPLE-BATCH-0001" /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function BreakdownModal({ item, run, onClose, onPreview }) {
  const b = item.breakdown ?? {};
  const cur = item.currency;
  const Section = ({ title, list, render }) => (
    <section>
      <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h3>
      {list?.length ? <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">{list.map((x, i) => <li key={i} className="flex justify-between gap-2 px-3 py-1.5 text-sm">{render(x)}</li>)}</ul> : <p className="text-sm text-slate-500">None</p>}
    </section>
  );
  const applied = (b.statutory ?? []).filter((s) => s.applied);
  const notApplied = (b.statutory ?? []).filter((s) => !s.applied);
  return (
    <Modal open onClose={onClose} title={`${fullName(item.employee)} · ${period(run)}`} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={onPreview}>Payslip preview</Button></>}>
      <div className="flex flex-col gap-4">
        <ValidationList title="Errors (must be fixed before submitting)" list={b.validation?.errors} tone="red" />
        <ValidationList title="Warnings" list={b.validation?.warnings} tone="amber" />
        {(b.skipped_unverified ?? []).length > 0 && <p className="text-sm text-amber-900">Skipped (unverified or inactive): <strong>{b.skipped_unverified.join(", ")}</strong>.</p>}
        {(b.skipped_ineligible ?? []).length > 0 && <p className="text-sm text-slate-600">Not applied: {b.skipped_ineligible.map((x) => `${x.code} (${label(x.reason)})`).join(", ")}.</p>}
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-slate-500">Working days</p><p className="font-semibold">{Number(item.working_days)}</p></div>
          <div><p className="text-xs text-slate-500">Payable days</p><p className="font-semibold">{Number(item.payable_days)}</p></div>
          <div><p className="text-xs text-slate-500">LOP days</p><p className="font-semibold">{Number(item.lop_days)}</p></div>
          <div><p className="text-xs text-slate-500">Proration basis</p><p className="font-semibold">{label(b.proration_basis)}</p></div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Section title="Earnings" list={b.earnings} render={(x) => <><span>{x.name} <span className="font-mono text-xs text-slate-400">{x.code}</span></span><span className="tabular-nums">{formatMoney(x.amount, cur)}</span></>} />
          <Section title="Deductions" list={b.deductions} render={(x) => <><span>{x.name} <span className="font-mono text-xs text-slate-400">{x.code}</span>{x.statutory_rule ? <Badge tone="violet">rule {x.statutory_rule}</Badge> : null}</span><span className="tabular-nums">{formatMoney(x.amount, cur)}</span></>} />
          <Section title="Employer contributions" list={b.employer_contributions} render={(x) => <><span>{x.name}</span><span className="tabular-nums">{formatMoney(x.amount, cur)}</span></>} />
          <Section title="Adjustments" list={b.adjustments} render={(x) => <><span>{x.label} <Badge tone={x.source === "correction" ? "violet" : "slate"}>{x.source}</Badge></span><span className="tabular-nums">{formatMoney(x.amount, cur)}</span></>} />
          <Section title="Reimbursements" list={b.reimbursements} render={(x) => <><span>{label(x.category)} · {formatDate(x.claim_date)}</span><span className="tabular-nums">{formatMoney(x.amount, cur)}</span></>} />
          <Section title="Salary structure segments" list={b.segments} render={(x) => <><span>{formatDate(x.from)} – {formatDate(x.to)}</span><span className="text-xs text-slate-600">{Number(x.payable_days)} payable / {Number(x.days)} days</span></>} />
        </div>
        {(applied.length > 0 || notApplied.length > 0 || (b.statutory_pending ?? []).length > 0) && (
          <section>
            <h3 className="mb-1 flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-slate-500"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />Statutory calculation basis</h3>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              {applied.map((s, i) => (
                <li key={`a${i}`} className="px-3 py-1.5"><strong>{s.code}</strong>{s.state_code ? ` (${s.state_code})` : ""} · {formatDate(s.segment_from)}–{formatDate(s.segment_to)} · {label(s.method)} · base {formatMoney(s.contribution_base, cur)}
                  {s.ceiling != null ? ` (ceiling ${formatMoney(s.ceiling, cur)})` : ""}{s.employee_rate != null ? ` · ${s.employee_rate}% / ${s.employer_rate ?? 0}%` : ""} → employee {formatMoney(s.employee_amount, cur)}, employer {formatMoney(s.employer_amount, cur)} · {s.rounding}
                  <span className="block text-xs text-slate-500">Validated: {s.validation_reference}</span></li>
              ))}
              {notApplied.map((s, i) => <li key={`n${i}`} className="px-3 py-1.5 text-slate-600">{s.code}: not applied ({label(s.reason)})</li>)}
              {(b.statutory_pending ?? []).map((c) => <li key={`p${c}`} className="px-3 py-1.5 text-amber-800">{c}: pending professional validation — not applied</li>)}
            </ul>
          </section>
        )}
        <div className="flex flex-wrap justify-end gap-4 rounded-lg bg-slate-50 px-4 py-3 text-sm">
          <span>Gross <strong>{formatMoney(item.gross, cur)}</strong></span><span>Deductions <strong>{formatMoney(item.total_deductions, cur)}</strong></span>
          <span>Reimbursements <strong>{formatMoney(item.reimbursements, cur)}</strong></span><span>Net <strong>{formatMoney(item.net, cur)}</strong></span>
        </div>
        <p className="text-xs text-slate-500">{b.rounding}</p>
      </div>
    </Modal>
  );
}

function AdjustmentModal({ run, items, onClose, onSaved }) {
  const { hr } = useAuth();
  const employees = useEmployeeOptions();
  const components = useHrQuery(() => listComponents({ activeOnly: true }), []);
  const [v, setV] = useState({ employee: "", direction: "earning", amount: "", label: "", component: "", reason: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const inRun = new Set(items.map((i) => i.employee_id));
  const comp = (components.data ?? []).find((c) => c.id === v.component);
  const usable = (components.data ?? []).filter((c) => c.category !== "statutory" && c.kind !== "employer_contribution" && (c.kind === v.direction));
  async function save() {
    const errs = {};
    if (!v.employee) errs.employee = "Choose an employee.";
    if (!MONEY.test(v.amount.trim()) || !(Number(v.amount) > 0)) errs.amount = "Enter a positive amount with at most 2 decimals.";
    if (v.label && (v.label.trim().length < 2 || v.label.length > 120)) errs.label = "2–120 characters.";
    if (v.reason.trim().length < 3) errs.reason = "A reason is required (at least 3 characters).";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const amount = v.direction === "deduction" ? -Number(v.amount) : Number(v.amount);
    const res = await addAdjustment({ runId: run.id, employee: v.employee, amount, reason: v.reason, label: v.label, component: v.component });
    setBusy(false);
    if (res.error) setError(friendly(res.error)); else onSaved(Boolean(comp?.requires_approval));
  }
  return (
    <Modal open onClose={onClose} title="Add payroll adjustment"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Add adjustment</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Employee" required error={errors.employee} className="sm:col-span-2" hint={v.employee && !inRun.has(v.employee) && items.length ? "This employee has no item in the run yet (no approved salary structure in the period)." : "You cannot add adjustments to your own pay."}>
          <Select placeholder={employees.loading ? "Loading…" : "Choose employee"} value={v.employee} onChange={set("employee")} options={(employees.data ?? []).filter((o) => o.value !== hr?.employee?.id)} />
        </Field>
        <Field label="Type" required><Select value={v.direction} onChange={(e) => setV({ ...v, direction: e.target.value, component: "" })} options={[{ value: "earning", label: "Earning (+)" }, { value: "deduction", label: "Deduction (−)" }]} /></Field>
        <Field label="Amount" required error={errors.amount}><Input type="number" min="0.01" step="0.01" value={v.amount} onChange={set("amount")} /></Field>
        <Field label="Component" hint={comp?.requires_approval ? "Needs approval by another payroll approver." : "Optional; one entry per component per run."}>
          <Select placeholder="None (one-off)" value={v.component} onChange={set("component")} options={usable.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}${c.requires_approval ? " (approval)" : ""}` }))} />
        </Field>
        <Field label="Label" error={errors.label} hint="Shown on the payslip."><Input maxLength={120} value={v.label} onChange={set("label")} placeholder={comp?.name ?? "e.g. Sample bonus"} /></Field>
        <Field label="Reason / evidence" required error={errors.reason} className="sm:col-span-2"><Textarea maxLength={1000} value={v.reason} onChange={set("reason")} /></Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">{run.status === "draft" ? "Recalculate the run afterwards to include it." : "The run returns to Draft and must be recalculated and submitted again."} Statutory deductions come from validated rules, not adjustments.</p>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function CorrectionModal({ run, items, onClose, onSaved }) {
  const [v, setV] = useState({ employee: "", direction: "earning", amount: "", reason: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    const errs = {};
    if (!v.employee) errs.employee = "Choose an employee from this run.";
    if (!MONEY.test(v.amount.trim()) || !(Number(v.amount) > 0)) errs.amount = "Enter a positive amount with at most 2 decimals.";
    if (v.reason.trim().length < 3) errs.reason = "A reason is required (at least 3 characters).";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await createCorrection({ runId: run.id, employee: v.employee, amount: v.direction === "deduction" ? -Number(v.amount) : Number(v.amount), reason: v.reason });
    setBusy(false);
    if (res.error) setError(friendly(res.error)); else onSaved(res.data);
  }
  return (
    <Modal open onClose={onClose} title="Post-finalization correction"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Record correction</Button></>}>
      <p className="mb-3 text-sm text-slate-600">Finalized payslips are never edited. The correction is added to the next open (draft or calculated) run, or held until the next run is calculated; it is reviewed with that run. For employee queries use the Corrections tab (prepare → approve).</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Employee" required error={errors.employee} className="sm:col-span-2">
          <Select placeholder="Choose employee" value={v.employee} onChange={set("employee")} options={items.map((i) => ({ value: i.employee_id, label: `${fullName(i.employee)} (${i.employee?.employee_code})` }))} />
        </Field>
        <Field label="Type" required><Select value={v.direction} onChange={set("direction")} options={[{ value: "earning", label: "Underpaid: pay extra (+)" }, { value: "deduction", label: "Overpaid: recover (−)" }]} /></Field>
        <Field label="Amount" required error={errors.amount}><Input type="number" min="0.01" step="0.01" value={v.amount} onChange={set("amount")} /></Field>
        <Field label="Reason" required error={errors.reason} className="sm:col-span-2"><Textarea maxLength={1000} value={v.reason} onChange={set("reason")} /></Field>
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

// ================================================================ bank accounts
function BankAccounts() {
  const { hr, user, hasPermission } = useAuth();
  const { notify } = useToast();
  const employees = useEmployeeOptions({ includeInactive: true });
  const [employee, setEmployee] = useState("");
  const q = useHrQuery(() => listBankAccounts(employee), [employee]);
  const [revealed, setRevealed] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [verifying, setVerifying] = useState(null);
  const canManage = hasPermission("payroll.manage");
  const canVerify = hasPermission("payroll.approve");
  const me = hr?.employee?.id;
  const toggle = (id) => setRevealed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <>
      <Toolbar>
        <Field label="Employee" className="sm:w-72"><Select placeholder="All employees" value={employee} onChange={(e) => setEmployee(e.target.value)} options={employees.data ?? []} /></Field>
        <div className="flex-1" />
        {canManage && <Button className="self-end" onClick={() => setEditing({ employee_id: employee !== me ? employee : "", is_primary: true, active: true })}><Plus className="h-4 w-4" aria-hidden="true" />Add account</Button>}
      </Toolbar>
      <DataTable caption="Employee bank accounts" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} emptyTitle="No bank accounts"
        columns={[
          { key: "employee", header: "Employee", render: (r) => <EmpCell e={r.employee} /> },
          { key: "bank_name", header: "Bank" },
          { key: "account_holder", header: "Holder" },
          { key: "account_number", header: "Account", render: (r) => (
            <span className="inline-flex items-center gap-1 font-mono text-xs">{revealed.has(r.id) ? r.account_number : maskAccount(r.account_number)}
              <button type="button" onClick={() => toggle(r.id)} aria-label={revealed.has(r.id) ? "Hide account number" : "Show account number"} className="rounded p-1 text-slate-500 hover:bg-slate-100">
                {revealed.has(r.id) ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
              </button></span>) },
          { key: "ifsc", header: "IFSC", render: (r) => r.ifsc || "—" },
          { key: "flags", header: "Status", render: (r) => <span className="flex flex-wrap gap-1">{r.is_primary && <Badge tone="orange">primary</Badge>}{r.active ? <Badge tone="green">active</Badge> : <Badge>inactive</Badge>}<Badge tone={r.verified ? "green" : "amber"}>{r.verified ? "verified" : "unverified"}</Badge></span> },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (r.employee_id === me ? <span className="text-xs text-slate-500">Own account — another payroll user</span> : (
            <div className="flex gap-1">
              {canManage && <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>}
              {canVerify && !r.verified && r.active && r.created_by !== user?.id && <Button size="sm" variant="secondary" onClick={() => setVerifying(r)}>Verify</Button>}
            </div>)) },
        ]} />
      <p className="mt-2 text-xs text-slate-500">A second person verifies each account against evidence (e.g. a cancelled cheque). Changing any account detail voids the verification. Payroll users cannot add or change their own bank details.</p>
      {editing && <BankModal row={editing} employees={(employees.data ?? []).filter((o) => o.value !== me)} onClose={() => setEditing(null)} onSaved={(isNew) => { setEditing(null); q.reload(); notify(`Bank account ${isNew ? "added" : "updated"}. It needs verification by another payroll approver.`); }} />}
      <ConfirmDialog open={Boolean(verifying)} onClose={() => setVerifying(null)} title="Verify bank account?" confirmLabel="Mark verified" tone="success"
        message={verifying ? `${fullName(verifying.employee)} · ${verifying.bank_name} · ${maskAccount(verifying.account_number)}. Confirm you checked the account against evidence.` : ""}
        reasonLabel="Evidence checked (optional)"
        onConfirm={async (note) => {
          const res = await verifyBankAccount(verifying.id, note);
          if (res.error) return { error: friendly(res.error) };
          q.reload(); notify("Bank account verified.");
          return {};
        }} />
    </>
  );
}

function BankModal({ row, employees, onClose, onSaved }) {
  const [v, setV] = useState({ employee_id: "", bank_name: "", account_holder: "", account_number: "", ...row, ifsc: row.ifsc ?? "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    const errs = {};
    if (!v.employee_id) errs.employee_id = "Choose an employee.";
    if ((v.bank_name ?? "").trim().length < 2) errs.bank_name = "2–120 characters.";
    if ((v.account_holder ?? "").trim().length < 2) errs.account_holder = "2–120 characters.";
    if (!ACCOUNT_NO.test((v.account_number ?? "").replace(/\s+/g, ""))) errs.account_number = "6–34 letters or digits.";
    if (v.ifsc && !IFSC.test(v.ifsc.trim().toUpperCase())) errs.ifsc = "Format: 4 letters, 0, then 6 letters/digits.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await saveBankAccount(v);
    setBusy(false);
    if (res.error) setError(friendly(res.error)); else onSaved(!row.id);
  }
  return (
    <Modal open onClose={onClose} title={row.id ? "Edit bank account" : "Add bank account"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Employee" required error={errors.employee_id} className="sm:col-span-2"><Select placeholder="Choose employee" disabled={Boolean(row.id)} value={v.employee_id} onChange={set("employee_id")} options={employees} /></Field>
        <Field label="Bank name" required error={errors.bank_name}><Input maxLength={120} value={v.bank_name} onChange={set("bank_name")} /></Field>
        <Field label="Account holder" required error={errors.account_holder}><Input maxLength={120} value={v.account_holder} onChange={set("account_holder")} /></Field>
        <Field label="Account number" required error={errors.account_number}><Input autoComplete="off" maxLength={40} value={v.account_number} onChange={set("account_number")} /></Field>
        <Field label="IFSC" error={errors.ifsc}><Input maxLength={11} value={v.ifsc} onChange={(e) => setV({ ...v, ifsc: e.target.value.toUpperCase() })} /></Field>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Checkbox label="Primary salary account" checked={Boolean(v.is_primary)} onChange={(e) => setV({ ...v, is_primary: e.target.checked })} />
          <Checkbox label="Active" checked={v.active !== false} onChange={(e) => setV({ ...v, active: e.target.checked })} />
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">Account numbers are redacted in the audit log. Employees only ever see the last four digits. Any change requires re-verification.</p>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

// ================================================================ reimbursements
function Reimbursements() {
  const { hr, hasPermission } = useAuth();
  const { notify } = useToast();
  const [status, setStatus] = useState("submitted");
  const q = useHrQuery(() => listReimbursements({ status }), [status]);
  const [deciding, setDeciding] = useState(null);
  const canDecide = hasPermission("payroll.manage");
  return (
    <>
      <Toolbar>
        <Field label="Status" className="sm:w-48"><Select placeholder="All" value={status} onChange={(e) => setStatus(e.target.value)} options={REIMBURSEMENT_STATUSES.map((s) => ({ value: s, label: s }))} /></Field>
      </Toolbar>
      <DataTable caption="Reimbursement claims" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload}
        emptyTitle={status === "submitted" ? "No claims waiting" : "No claims"}
        columns={[
          { key: "employee", header: "Employee", render: (r) => <EmpCell e={r.employee} /> },
          { key: "claim_date", header: "Date", render: (r) => formatDate(r.claim_date) },
          { key: "category", header: "Category", render: (r) => label(r.category) },
          { key: "amount", header: "Amount", render: (r) => formatMoney(r.amount) },
          { key: "description", header: "Description", render: (r) => <span className="line-clamp-3 max-w-xs">{r.description}</span> },
          { key: "receipt_path", header: "Receipt ref.", render: (r) => r.receipt_path || "—" },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          ...(canDecide ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => r.status === "submitted" && r.employee_id !== hr?.employee?.id && (
            <div className="flex gap-1">
              <Button size="sm" variant="success" onClick={() => setDeciding({ row: r, approve: true })}>Approve</Button>
              <Button size="sm" variant="danger" onClick={() => setDeciding({ row: r, approve: false })}>Reject</Button>
            </div>) }] : []),
        ]} />
      <p className="mt-2 text-xs text-slate-500">Approved claims are added to the next payroll run when it is calculated and marked paid when that employee's salary payment is recorded as paid.</p>
      <ConfirmDialog open={Boolean(deciding)} onClose={() => setDeciding(null)} title={deciding?.approve ? "Approve claim?" : "Reject claim?"}
        tone={deciding?.approve ? "success" : "danger"} confirmLabel={deciding?.approve ? "Approve" : "Reject"}
        message={deciding ? `${fullName(deciding.row.employee)} · ${label(deciding.row.category)} · ${formatMoney(deciding.row.amount)}` : ""}
        requireReason={deciding ? !deciding.approve : false} reasonLabel={deciding?.approve ? "Note (optional)" : "Reason for rejection"}
        onConfirm={async (note) => {
          const res = await decideReimbursement(deciding.row.id, deciding.approve, note);
          if (res.error) return { error: res.error };
          notify(deciding.approve ? "Claim approved." : "Claim rejected."); q.reload();
          return {};
        }} />
    </>
  );
}
