// Module 10 — shared building blocks for request pages (HR Operations and
// Employee Portal): stage timeline, history, files, profile-change table,
// advance / payment panels and the decision / delegation dialogs.
import { useRef, useState } from "react";
import { CheckCircle2, Clock, Download, Eye, FileText, Paperclip, Trash2, Upload, UserCheck, XCircle } from "lucide-react";
import { formatDate, formatDateTime, formatMoney, useHrQuery } from "@/lib/hr/client";
import {
  EVENT_LABELS, LETTER_TYPES, REIMBURSEMENT_CATEGORIES, REQUEST_FILE_ACCEPT, decideStage, delegateOptions, delegateStage,
  getRequestFileUrl, removeRequestFile, stageLabel, uploadRequestFile, workflowLabel,
} from "@/lib/hr/requestWorkflows";
import { Badge, Button, Card, DescriptionList, Field, InlineError, Loading, Modal, Select, StatusBadge, Textarea, useToast } from "@/hr/ui";

const label = (s) => String(s ?? "").replace(/_/g, " ");
const money = (v, cur) => (v === null || v === undefined || v === "" ? "—" : formatMoney(Number(v), cur || "INR"));

// Request-specific tones ("returned" means "needs correction" here, not an asset return).
const REQUEST_STATUS_TONE = {
  draft: "slate", open: "blue", in_progress: "blue", waiting_on_employee: "orange", pending_approval: "amber", returned: "orange",
  approved: "green", rejected: "red", resolved: "green", completed: "green", closed: "slate", cancelled: "slate",
  agreed: "blue", disbursement_recorded: "violet", repaying: "blue", repaid: "green", pending: "amber",
};
export function RequestStatusBadge({ status }) {
  if (!status) return <Badge>—</Badge>;
  return <Badge tone={REQUEST_STATUS_TONE[status] ?? "slate"}>{status === "pending_approval" ? "pending approval" : label(status)}</Badge>;
}

export function WorkflowBadge({ workflow }) {
  const tone = { hr_letter: "blue", profile_change: "violet", reimbursement: "green", salary_advance: "orange", attendance_correction: "amber" }[workflow] ?? "slate";
  return <Badge tone={tone}>{workflowLabel(workflow)}</Badge>;
}

/** Structured request details per workflow (no sensitive values). */
export function RequestDetailsList({ request }) {
  const d = request.details ?? {};
  if (request.workflow === "hr_letter") {
    return <DescriptionList items={[
      { label: "Letter", value: d.letter_label ?? LETTER_TYPES.find((t) => t.value === d.letter_type)?.label },
      { label: "Purpose", value: d.purpose },
      d.addressed_to && { label: "Addressed to", value: d.addressed_to },
      d.required_by && { label: "Required by", value: formatDate(d.required_by) },
      d.additional_details && { label: "Additional details", value: d.additional_details },
    ]} />;
  }
  if (request.workflow === "reimbursement") {
    return <DescriptionList items={[
      { label: "Category", value: d.category_label ?? REIMBURSEMENT_CATEGORIES.find((c) => c.value === d.category)?.label },
      { label: "Expense date", value: formatDate(d.expense_date) },
      { label: "Amount", value: money(d.amount, d.currency) },
      { label: "Business purpose", value: d.purpose },
      d.merchant && { label: "Merchant", value: d.merchant },
      d.project_name && { label: "Project", value: d.project_name },
    ]} />;
  }
  if (request.workflow === "salary_advance") {
    return <DescriptionList items={[
      { label: "Amount requested", value: money(d.amount, d.currency) },
      { label: "Repayment period", value: d.repayment_months ? `${d.repayment_months} month${Number(d.repayment_months) === 1 ? "" : "s"}` : "—" },
      { label: "Proposed instalment", value: money(d.installment_amount, d.currency) },
      { label: "Reason", value: d.reason },
    ]} />;
  }
  if (request.workflow === "profile_change") {
    return <DescriptionList items={[{ label: "Reason", value: d.reason }, { label: "Bank details included", value: d.includes_bank ? "Yes (payroll review)" : "No" }]} />;
  }
  return <p className="whitespace-pre-line text-sm text-slate-800">{request.description}</p>;
}

// ------------------------------------------------------------- approvals
const STAGE_ICON = { approved: CheckCircle2, rejected: XCircle, returned: XCircle, pending: Clock };
export function StageTimeline({ stages, onDecide, onDelegate }) {
  if (!stages?.length) return <p className="text-sm text-slate-600">This request has no approval steps.</p>;
  const rounds = [...new Set(stages.map((s) => s.round))];
  return (
    <div className="flex flex-col gap-4">
      {rounds.map((round) => (
        <div key={round}>
          {rounds.length > 1 && <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Submission {round}</p>}
          <ol className="flex flex-col gap-2">
            {stages.filter((s) => s.round === round).map((s) => {
              const Icon = STAGE_ICON[s.status] ?? Clock;
              return (
                <li key={s.id} className={`rounded-xl border px-3 py-2 ${s.status === "pending" ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon className={`h-4 w-4 ${s.status === "approved" ? "text-emerald-600" : ["rejected", "returned"].includes(s.status) ? "text-rose-600" : "text-slate-400"}`} aria-hidden="true" />
                    <span className="text-sm font-semibold text-[#101a3a]">{s.stage_no}. {stageLabel(s.stage_role)} approval</span>
                    <StatusBadge status={s.status} />
                    {s.approver && s.stage_role === "manager" && <span className="text-xs text-slate-500">Approver: {s.approver}</span>}
                    {s.delegate && <Badge tone="violet">delegated to {s.delegate}</Badge>}
                  </div>
                  {s.decided_at && (
                    <p className="mt-1 text-xs text-slate-600">
                      {label(s.status)} by {s.decided_by ?? "—"} · {formatDateTime(s.decided_at)}
                      {s.decision_basis === "hr_override" && " · HR decision on the manager's behalf"}
                      {s.decision_basis === "delegate" && " · as delegate"}
                    </p>
                  )}
                  {s.comment && <p className="mt-1 whitespace-pre-line text-sm text-slate-700">“{s.comment}”</p>}
                  {s.delegation_reason && <p className="mt-1 text-xs text-slate-500">Delegation reason: {s.delegation_reason}</p>}
                  {(s.can_act || s.can_delegate) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {s.can_act && onDecide && <Button size="sm" onClick={() => onDecide(s)}>Review &amp; decide</Button>}
                      {s.can_delegate && onDelegate && <Button size="sm" variant="secondary" onClick={() => onDelegate(s)}><UserCheck className="h-4 w-4" aria-hidden="true" />Delegate</Button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

export function DecisionModal({ stage, request, onClose, onDone }) {
  const { notify } = useToast();
  const [action, setAction] = useState("approve");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit() {
    if (action !== "approve" && !comment.trim()) { setError("Add a comment explaining the decision."); return; }
    setBusy(true); setError(null);
    const res = await decideStage(stage.id, action, comment);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      if (/already been decided/i.test(res.error)) onDone?.();   // someone else decided first: refresh
      return;
    }
    notify(action === "approve" ? "Approved." : action === "reject" ? "Request rejected." : "Returned to the employee for correction.");
    onDone?.(res.data);
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title={`${stageLabel(stage.stage_role)} decision`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={action === "approve" ? "success" : action === "reject" ? "danger" : "primary"} loading={busy} onClick={submit}>
          {action === "approve" ? "Approve" : action === "reject" ? "Reject" : "Return for correction"}</Button></>}>
      <div className="flex flex-col gap-3">
        {request && <p className="text-sm text-slate-700">{request.subject}</p>}
        <Field label="Decision" required>
          <Select value={action} onChange={(e) => setAction(e.target.value)} options={[
            { value: "approve", label: "Approve" }, { value: "return", label: "Return for correction" }, { value: "reject", label: "Reject" }]} />
        </Field>
        <Field label="Comment" required={action !== "approve"} hint="Visible to the employee and later approvers.">
          <Textarea rows={4} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

export function DelegateModal({ stage, onClose, onDone }) {
  const { notify } = useToast();
  const options = useHrQuery(() => delegateOptions(stage.id), [stage.id]);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit() {
    if (!to) { setError("Choose a manager."); return; }
    if (reason.trim().length < 3) { setError("Give a reason for the delegation."); return; }
    setBusy(true); setError(null);
    const res = await delegateStage(stage.id, to, reason);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Approval delegated.");
    onDone?.();
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title="Delegate approval" size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Delegate</Button></>}>
      <div className="flex flex-col gap-3">
        {options.loading && !options.data ? <Loading /> : (
          <Field label="Delegate to" required hint="Only managers who can approve requests are listed.">
            <Select placeholder="Choose a manager" value={to} onChange={(e) => setTo(e.target.value)}
              options={(options.data ?? []).map((o) => ({ value: o.id, label: `${o.name} (${o.employee_code})` }))} />
          </Field>
        )}
        <Field label="Reason" required><Textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <InlineError message={error ?? options.error} />
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------- history
export function EventHistory({ events }) {
  if (!events?.length) return <p className="text-sm text-slate-600">No history yet.</p>;
  return (
    <ol className="flex flex-col gap-2 border-l-2 border-slate-100 pl-4">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-[#f96706]" aria-hidden="true" />
          <p className="text-sm font-semibold text-[#101a3a]">{EVENT_LABELS[e.action] ?? label(e.action)}{e.stage_role ? ` · ${stageLabel(e.stage_role)}` : ""}</p>
          <p className="text-xs text-slate-500">{e.actor ?? "System"} · {formatDateTime(e.created_at)}</p>
          {e.note && <p className="whitespace-pre-line text-sm text-slate-700">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}

// ----------------------------------------------------------------- files
const KIND_LABEL = { receipt: "Receipt", evidence: "Evidence", supporting: "Supporting file", issued_letter: "Issued letter", payment_evidence: "Payment evidence" };
export function AttachmentList({ attachments, removable = false, onChanged }) {
  const { notify } = useToast();
  const [busy, setBusy] = useState(null);
  if (!attachments?.length) return <p className="text-sm text-slate-600">No files attached.</p>;
  async function open(a, download) {
    setBusy(a.id);
    const res = await getRequestFileUrl(a, download);
    setBusy(null);
    if (res.error) notify(res.error, "error"); else window.open(res.data, "_blank", "noopener,noreferrer");
  }
  async function remove(a) {
    setBusy(a.id);
    const res = await removeRequestFile(a.id);
    setBusy(null);
    if (res.error) notify(res.error, "error"); else { notify("File removed."); onChanged?.(); }
  }
  return (
    <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
      {attachments.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
          <FileText className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{a.file_name}</span>
          <Badge>{KIND_LABEL[a.kind] ?? label(a.kind)}</Badge>
          {!a.uploaded && <Badge tone="red">upload incomplete</Badge>}
          {a.uploaded && <>
            <Button size="sm" variant="ghost" aria-label={`View ${a.file_name}`} loading={busy === a.id} onClick={() => open(a, false)}><Eye className="h-4 w-4" aria-hidden="true" /></Button>
            <Button size="sm" variant="ghost" aria-label={`Download ${a.file_name}`} disabled={busy === a.id} onClick={() => open(a, true)}><Download className="h-4 w-4" aria-hidden="true" /></Button>
          </>}
          {removable && a.mine && <Button size="sm" variant="ghost" aria-label={`Remove ${a.file_name}`} disabled={busy === a.id} onClick={() => remove(a)}><Trash2 className="h-4 w-4 text-rose-600" aria-hidden="true" /></Button>}
        </li>
      ))}
    </ul>
  );
}

export function FileUploadButton({ requestId, kind, label: text = "Attach file", onUploaded, variant = "secondary" }) {
  const { notify } = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    const res = await uploadRequestFile(requestId, kind, file);
    setBusy(false);
    if (res.error) notify(res.error, "error"); else notify("File attached.");
    onUploaded?.(res.data);
  }
  return (
    <>
      <input ref={input} type="file" className="sr-only" accept={REQUEST_FILE_ACCEPT} onChange={onPick} aria-label={text} tabIndex={-1} />
      <Button size="sm" variant={variant} loading={busy} onClick={() => input.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />{text}</Button>
    </>
  );
}

// ------------------------------------------------------- profile changes
const show = (v) => {
  if (v === null || v === undefined || v === "") return <span className="text-slate-400">—</span>;
  if (v === "[restricted]") return <Badge tone="slate">restricted</Badge>;
  if (typeof v === "object") {
    return <span className="flex flex-col">{Object.entries(v).map(([k, x]) => <span key={k}><span className="text-slate-500">{label(k)}:</span> {String(x)}</span>)}</span>;
  }
  return String(v);
};
export function ProfileChangesTable({ rows }) {
  if (!rows?.length) return <p className="text-sm text-slate-600">No changes.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-100 text-sm">
        <thead className="bg-slate-50"><tr>
          <th scope="col" className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-600">Field</th>
          <th scope="col" className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-600">{rows[0]?.current_label ?? "Current"}</th>
          <th scope="col" className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-600">Proposed</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.field} className="align-top">
              <td className="px-3 py-2 font-semibold text-[#101a3a]">{r.label}{r.group === "bank" && <Badge tone="amber" className="ml-2">payroll review</Badge>}</td>
              <td className="px-3 py-2 text-slate-700">{show(r.current)}</td>
              <td className="px-3 py-2 text-slate-900">{show(r.proposed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------ advance / payment
export function AdvancePanel({ advance, actions }) {
  if (!advance) return null;
  const cur = advance.currency;
  return (
    <Card title="Salary advance" actions={actions}>
      <DescriptionList items={[
        { label: "Status", value: <RequestStatusBadge status={advance.status} /> },
        { label: "Approved amount", value: money(advance.amount, cur) },
        advance.max_permitted !== undefined && advance.max_permitted !== null && { label: "Maximum permitted at request", value: money(advance.max_permitted, cur) },
        { label: "Outstanding at request", value: money(advance.outstanding_at_request, cur) },
        { label: "Repayment", value: `${advance.repayment_months} × ${money(advance.installment_amount, cur)}` },
        advance.first_repayment_month && { label: "First repayment month", value: formatDate(advance.first_repayment_month, { month: "long", year: "numeric" }) },
        advance.agreement_accepted_at && { label: "Agreement accepted", value: `${formatDateTime(advance.agreement_accepted_at)}${advance.payroll_deduction_authorized ? " · payroll deduction authorised" : ""}` },
        advance.disbursement_reference && { label: "Disbursement", value: `${money(advance.disbursed_amount, cur)} on ${formatDate(advance.disbursed_on)} · ref ${advance.disbursement_reference}` },
        advance.disbursement_recorded_at && { label: "Verification", value: advance.disbursement_verified_at ? `Verified ${formatDateTime(advance.disbursement_verified_at)}` : "Awaiting a second Finance user" },
        advance.remaining_balance !== null && advance.remaining_balance !== undefined && { label: "Remaining balance", value: <span className="font-bold">{money(advance.remaining_balance, cur)}</span> },
      ]} />
      {advance.repayments?.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Repayments</p>
          <ul className="flex flex-col gap-1 text-sm">
            {advance.repayments.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5">
                <span>{formatDate(p.paid_on)} · {label(p.method)} · ref {p.reference}</span><span className="font-semibold">{money(p.amount, cur)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export function PaymentPanel({ payment, currency }) {
  if (!payment) return null;
  const paid = payment.claim_status === "paid";
  return (
    <Card title="Payment tracking">
      <DescriptionList items={[
        { label: "Claim status in Payroll", value: <StatusBadge status={payment.claim_status} /> },
        { label: "Payroll period", value: payment.payroll_period_start ? `${formatDate(payment.payroll_period_start)} – ${formatDate(payment.payroll_period_end)}` : "Next payroll run" },
        payment.payroll_status && { label: "Payroll run", value: <StatusBadge status={payment.payroll_status} /> },
        paid && payment.paid_at && { label: "Paid", value: formatDateTime(payment.paid_at) },
        payment.payment_reference && { label: "Payment reference", value: payment.payment_reference },
      ]} />
      <p className="mt-3 text-xs text-slate-500">Reimbursements are paid with payroll. A claim is shown as paid only after Payroll marks the payroll run paid with a bank reference.{currency ? "" : ""}</p>
    </Card>
  );
}

export function SectionCard({ title, icon: Icon = Paperclip, children, actions }) {
  return <Card title={<span className="inline-flex items-center gap-2"><Icon className="h-4 w-4" aria-hidden="true" />{title}</span>} actions={actions}>{children}</Card>;
}
