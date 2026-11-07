// Benefit claims review (208). benefits.manage decides submitted claims
// (approve — optionally a lower amount with a note —, reject, return) and
// records payments made OUTSIDE payroll. Nobody acts on their own claim.
// Drafts are private to the employee and never listed here.
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { exportCsv, formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { CLAIM_STATUSES, CLAIM_STATUS_LABEL, benefitBalances, claimActions, decideClaim, getClaim, listBenefitPlans, listClaimEvents, listClaims, planYearLabel, recordClaimPayment } from "@/lib/hr/benefits";
import { Button, DataTable, DescriptionList, EmptyState, ErrorState, Field, Input, Loading, Modal, Select, Textarea, Toolbar, useToast } from "@/hr/ui";
import { ActionModal, BenefitTimeline, ClaimDocuments, ClaimStatus, LimitBar, empText, money, today } from "./shared";

function DecideModal({ claim, action, onClose, onDone }) {
  const { notify } = useToast();
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState(String(claim.amount));
  const titles = { approve: "Approve claim", reject: "Reject claim", return: "Return claim for changes" };
  return (
    <ActionModal title={`${titles[action]} · ${claim.claim_number}`} submitLabel={titles[action].split(" ")[0]} tone={action === "approve" ? "success" : action === "reject" ? "danger" : "primary"} onClose={onClose}
      onSubmit={async () => {
        if (action !== "approve" && note.trim().length < 3) return { error: action === "reject" ? "Give a reason for the rejection." : "Tell the employee what to change." };
        if (action === "approve") {
          const a = Number(amount);
          if (!(a > 0) || a > Number(claim.amount)) return { error: `The approved amount must be more than zero and at most ${money(claim.amount)}.` };
          if (a < Number(claim.amount) && note.trim().length < 3) return { error: "Explain why less than the claimed amount is approved." };
        }
        const res = await decideClaim(claim.id, action, note, action === "approve" ? amount : null);
        if (res.error) return res;
        notify(action === "approve" ? "Claim approved. No payroll entry was created." : action === "reject" ? "Claim rejected." : "Claim returned to the employee.");
        onDone(); return {};
      }}>
      {action === "approve" && (
        <>
          <Field label="Approved amount (INR)" required hint={`Claimed ${money(claim.amount)}. Approving less needs a note.`}>
            <Input type="number" min="0.01" step="0.01" max={claim.amount} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <p className="text-xs text-slate-500">The approval is checked against the remaining annual limit. Approval does <strong>not</strong> add anything to payroll; record the payment here once it is paid outside payroll.</p>
        </>
      )}
      <Field label={action === "approve" ? "Note (optional)" : action === "reject" ? "Reason" : "What should the employee change?"} required={action !== "approve"}>
        <Textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <p className="text-xs text-slate-500">The employee is notified.</p>
    </ActionModal>
  );
}

function PaymentModal({ claim, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ reference: "", paidOn: today() });
  return (
    <ActionModal title={`Record payment · ${claim.claim_number}`} submitLabel="Record payment" onClose={onClose}
      onSubmit={async () => {
        if (v.reference.trim().length < 2) return { error: "Enter the payment reference (e.g. bank transfer UTR)." };
        if (!v.paidOn || v.paidOn > today()) return { error: "Enter the payment date (today or earlier)." };
        const res = await recordClaimPayment(claim.id, v.reference, v.paidOn);
        if (res.error) return res;
        notify("Payment recorded."); onDone(); return {};
      }}>
      <p className="text-sm text-slate-600">Record a payment of <strong>{money(claim.approved_amount)}</strong> to {empText(claim.employee)} made <strong>outside payroll</strong> (for example a bank transfer by Finance). This does not create a payroll entry or move money.</p>
      <Field label="Payment reference" required><Input value={v.reference} maxLength={120} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
      <Field label="Paid on" required><Input type="date" max={today()} value={v.paidOn} onChange={(e) => setV({ ...v, paidOn: e.target.value })} /></Field>
    </ActionModal>
  );
}

export function ClaimDetail({ claimId, canManage, myEmployeeId, onClose, onChanged }) {
  const q = useHrQuery(() => getClaim(claimId), [claimId]);
  const ev = useHrQuery(() => listClaimEvents(claimId), [claimId, q.data?.updated_at]);
  const c = q.data;
  const bal = useHrQuery(() => (c ? benefitBalances(c.employee_id, c.expense_date) : Promise.resolve({ data: null })), [c?.employee_id, c?.expense_date, c?.updated_at]);
  const [modal, setModal] = useState(null);
  const isClaimant = c?.employee_id === myEmployeeId;
  const actions = claimActions(c, { isClaimant, canManage });
  const done = () => { setModal(null); q.reload(); onChanged?.(); };
  const balance = (bal.data ?? []).find((b) => b.enrollment_id === c?.enrollment_id);
  return (
    <>
      <Modal open onClose={onClose} title={c ? `Claim ${c.claim_number}` : "Claim"} size="lg"
        footer={<>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {actions.includes("return") && <Button variant="secondary" onClick={() => setModal("return")}>Return</Button>}
          {actions.includes("reject") && <Button variant="danger" onClick={() => setModal("reject")}>Reject</Button>}
          {actions.includes("approve") && <Button variant="success" onClick={() => setModal("approve")}>Approve</Button>}
          {actions.includes("record_payment") && <Button onClick={() => setModal("pay")}>Record payment</Button>}
        </>}>
        {q.loading && !c ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !c ? <EmptyState title="Claim not found" /> : (
          <div className="flex flex-col gap-5">
            {isClaimant && canManage && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This is your own claim. Another HR user must decide it.</p>}
            <DescriptionList items={[
              { label: "Employee", value: empText(c.employee) },
              { label: "Status", value: <ClaimStatus status={c.status} /> },
              { label: "Plan", value: c.plan?.name },
              { label: "Plan year", value: planYearLabel(c.plan_year_start) },
              { label: "Expense date", value: formatDate(c.expense_date) },
              { label: "Claimed amount", value: money(c.amount) },
              c.approved_amount != null && { label: "Approved amount", value: money(c.approved_amount) },
              { label: "Submitted", value: c.submitted_at ? formatDateTime(c.submitted_at) : "—" },
              c.decided_at && { label: "Decided", value: formatDateTime(c.decided_at) },
              c.decision_note && { label: "Decision note", value: c.decision_note },
              c.status === "paid_externally" && { label: "Payment", value: `${formatDate(c.paid_on)} · ref ${c.payment_reference}` },
              { label: "Description", value: <span className="whitespace-pre-line">{c.description}</span> },
            ]} />
            {c.plan?.annual_limit != null && <section><h3 className="mb-2 text-sm font-bold text-[#101a3a]">Annual limit for this plan year</h3><LimitBar balance={balance} /></section>}
            <section><h3 className="mb-2 text-sm font-bold text-[#101a3a]">Supporting documents</h3><ClaimDocuments documents={c.documents} /></section>
            <section>
              <h3 className="mb-2 text-sm font-bold text-[#101a3a]">Status history</h3>
              {ev.loading && !ev.data ? <Loading /> : ev.error ? <ErrorState message={ev.error} onRetry={ev.reload} /> : <BenefitTimeline events={ev.data} />}
            </section>
          </div>
        )}
      </Modal>
      {["approve", "reject", "return"].includes(modal) && <DecideModal claim={c} action={modal} onClose={() => setModal(null)} onDone={done} />}
      {modal === "pay" && <PaymentModal claim={c} onClose={() => setModal(null)} onDone={done} />}
    </>
  );
}

export const claimCsvColumns = [
  { label: "Claim no.", key: "claim_number" }, { label: "Employee ID", value: (r) => r.employee?.employee_code }, { label: "Employee", value: (r) => empText(r.employee) },
  { label: "Plan code", value: (r) => r.plan?.code }, { label: "Plan", value: (r) => r.plan?.name }, { label: "Plan year", value: (r) => planYearLabel(r.plan_year_start) },
  { label: "Expense date", key: "expense_date" }, { label: "Claimed amount", value: (r) => Number(r.amount) },
  { label: "Approved amount", value: (r) => (r.approved_amount == null ? "" : Number(r.approved_amount)) },
  { label: "Status", value: (r) => CLAIM_STATUS_LABEL[r.status] ?? r.status }, { label: "Submitted", value: (r) => (r.submitted_at ? formatDateTime(r.submitted_at) : "") },
  { label: "Decided", value: (r) => (r.decided_at ? formatDateTime(r.decided_at) : "") }, { label: "Decision note", key: "decision_note" },
  { label: "Paid on (external)", key: "paid_on" }, { label: "Payment reference", key: "payment_reference" },
  { label: "Documents", value: (r) => (r.documents ?? []).length }, { label: "Description", key: "description" },
];

export default function ClaimsTab({ canManage, employees, myEmployeeId }) {
  const [f, setF] = useState({ status: "open", plan: "", employee: "", from: "", to: "" });
  const [selected, setSelected] = useState(null);
  const plans = useHrQuery(() => listBenefitPlans(), []);
  const list = useHrQuery(() => listClaims(f), [f.status, f.plan, f.employee, f.from, f.to]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const statusOptions = useMemo(() => [{ value: "open", label: "Awaiting review" }, ...CLAIM_STATUSES.filter((s) => s !== "draft").map((s) => ({ value: s, label: CLAIM_STATUS_LABEL[s] })), { value: "", label: "All" }], []);
  return (
    <>
      <Toolbar>
        <Select aria-label="Claim status" className="sm:w-48" value={f.status} onChange={set("status")} options={statusOptions} />
        <Select aria-label="Plan" className="sm:w-52" placeholder="All plans" value={f.plan} onChange={set("plan")} options={(plans.data ?? []).filter((p) => p.claimable).map((p) => ({ value: p.id, label: p.name }))} />
        <Select aria-label="Employee" className="sm:w-60" placeholder="All employees" value={f.employee} onChange={set("employee")} options={employees ?? []} />
        <Input aria-label="Expense from" type="date" className="sm:w-40" value={f.from} onChange={set("from")} />
        <Input aria-label="Expense to" type="date" className="sm:w-40" value={f.to} min={f.from || undefined} onChange={set("to")} />
        <Button variant="secondary" disabled={!list.data?.length} onClick={() => exportCsv(`benefit-claims-${today()}`, list.data ?? [], claimCsvColumns)}><Download className="h-4 w-4" aria-hidden="true" />Export CSV</Button>
      </Toolbar>
      <DataTable caption="Benefit claims" rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle="No claims" emptyDescription="Employees submit claims against their enrolled plans from the Employee Portal."
        onRowClick={(r) => setSelected(r.id)}
        columns={[
          { key: "claim_number", header: "Claim", render: (r) => <span className="font-mono text-xs font-bold text-[#1f4693]">{r.claim_number}</span> },
          { key: "employee", header: "Employee", render: (r) => empText(r.employee) },
          { key: "plan", header: "Plan", render: (r) => r.plan?.name ?? "—" },
          { key: "expense_date", header: "Expense date", sortable: true, render: (r) => formatDate(r.expense_date) },
          { key: "amount", header: "Amount", sortable: true, sortValue: (r) => Number(r.amount), render: (r) => <div>{money(r.amount)}{r.approved_amount != null && Number(r.approved_amount) !== Number(r.amount) && <p className="text-xs text-slate-500">approved {money(r.approved_amount)}</p>}</div> },
          { key: "documents", header: "Docs", render: (r) => (r.documents ?? []).length },
          { key: "submitted_at", header: "Submitted", render: (r) => formatDate(r.submitted_at) },
          { key: "status", header: "Status", render: (r) => <ClaimStatus status={r.status} /> },
        ]} />
      {!canManage && <p className="mt-3 text-sm text-slate-600">Read-only: deciding claims needs benefits.manage.</p>}
      {selected && <ClaimDetail claimId={selected} canManage={canManage} myEmployeeId={myEmployeeId} onClose={() => setSelected(null)} onChanged={list.reload} />}
    </>
  );
}
