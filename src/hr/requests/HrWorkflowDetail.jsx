// Module 10 — HR Operations: detail of a workflow request (letter, profile
// change, reimbursement, salary advance). Reviewers see only what the server
// returns for their role (e.g. bank values for payroll only, advance limits
// for payroll / finance only) and act through the approval RPCs.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, History, Lock, MessageSquare, Paperclip, Send, ShieldCheck } from "lucide-react";
import { formatDate, formatDateTime, fullName, useHrQuery } from "@/lib/hr/client";
import { commentRequest, listRequestComments } from "@/lib/hr/requests";
import {
  getRequestDetail, issueLetter, letterIssueOptions, recordAdvanceDisbursement, recordAdvanceRepayment, verifyAdvanceDisbursement, workflowLabel,
} from "@/lib/hr/requestWorkflows";
import {
  AdvancePanel, AttachmentList, DecisionModal, DelegateModal, EventHistory, FileUploadButton, PaymentPanel, ProfileChangesTable,
  RequestDetailsList, RequestStatusBadge, SectionCard, StageTimeline, WorkflowBadge,
} from "@/hr/requests/RequestWidgets";
import { Conversation } from "@/hr/pages/HrRequestsPage";
import {
  Badge, Button, Card, DescriptionList, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal, PageHeader, Select, Textarea, useToast,
} from "@/hr/ui";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function IssueLetterModal({ request, onClose, onDone }) {
  const { notify } = useToast();
  const salary = request.details?.letter_type === "salary_certificate";
  // Eligible documents / uploaded files come from the server (salary certificates: compensation-restricted only).
  const docs = useHrQuery(() => letterIssueOptions(request.id), [request.id]);
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const options = (docs.data ?? []).map((o) => ({ value: `${o.kind === "document" ? "doc" : "att"}:${o.id}`,
    label: o.kind === "document" ? `${o.label} · ${formatDate(o.created_at)}${o.includes_compensation ? " · restricted" : ""}` : o.label }));
  async function submit() {
    if (!choice) { setError("Choose the letter to issue."); return; }
    const [kind, id] = choice.split(":");
    setBusy(true); setError(null);
    const res = await issueLetter(request.id, kind === "doc" ? { documentId: id, note } : { attachmentId: id, note });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Letter issued. The employee was notified.");
    onDone();
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title="Issue letter" size="md"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Issue &amp; complete</Button></>}>
      <div className="flex flex-col gap-3">
        {salary ? (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Salary certificates contain compensation: issue a compensation-restricted document (Visa &amp; Documents) or upload the signed certificate on this request. Either is visible only to the employee and staff authorised for compensation.</p>
        ) : (
          <p className="text-sm text-slate-600">Generate or upload the letter in <a className="font-semibold text-[#1f4693] underline" href="/hr/documents">Visa &amp; Documents</a> (category “HR letter”), then choose it here — or upload the signed letter on this request.</p>
        )}
        {docs.loading && !docs.data ? <Loading /> : (
          <Field label="Letter" required>
            <Select placeholder={options.length ? "Choose the issued letter" : "No letter available yet"} value={choice}
              onChange={(e) => setChoice(e.target.value)} options={options} />
          </Field>
        )}
        <Field label="Note to the employee (optional)"><Textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <InlineError message={error ?? docs.error} />
      </div>
    </Modal>
  );
}

function DisbursementModal({ request, onClose, onDone }) {
  const { notify } = useToast();
  const adv = request.advance;
  const evidence = (request.attachments ?? []).filter((a) => a.kind === "payment_evidence" && a.uploaded);
  const [v, setV] = useState({ amount: String(adv.amount), reference: "", paidOn: today(), attachmentId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function submit() {
    if (v.reference.trim().length < 3) { setError("Enter the bank / payment reference."); return; }
    setBusy(true); setError(null);
    const res = await recordAdvanceDisbursement(request.id, { ...v, attachmentId: v.attachmentId || null });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Disbursement recorded. A second Finance user must verify it.");
    onDone();
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title="Record disbursement" size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Record</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">Record a payment that was already made through the bank. This does not move any money.</p>
        <Field label="Amount" required hint="Must equal the approved amount."><Input type="number" step="0.01" value={v.amount} onChange={set("amount")} /></Field>
        <Field label="Payment reference" required><Input maxLength={120} value={v.reference} onChange={set("reference")} /></Field>
        <Field label="Paid on" required><Input type="date" max={today()} value={v.paidOn} onChange={set("paidOn")} /></Field>
        <Field label="Payment evidence" hint="Upload it on the request first (optional).">
          <Select placeholder="None" value={v.attachmentId} onChange={set("attachmentId")} options={evidence.map((a) => ({ value: a.id, label: a.file_name }))} />
        </Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function RepaymentModal({ request, onClose, onDone }) {
  const { notify } = useToast();
  const adv = request.advance;
  const [v, setV] = useState({ amount: String(Math.min(Number(adv.installment_amount), Number(adv.remaining_balance))), method: "direct_payment", reference: "", paidOn: today(), payrollRunId: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function submit() {
    setBusy(true); setError(null);
    const res = await recordAdvanceRepayment(request.id, v);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(res.data?.status === "repaid" ? "Advance fully repaid." : "Repayment recorded.");
    onDone();
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title="Record repayment" size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Record</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Amount" required><Input type="number" step="0.01" value={v.amount} onChange={set("amount")} /></Field>
        <Field label="Method" required>
          <Select value={v.method} onChange={set("method")} options={[{ value: "direct_payment", label: "Direct payment by the employee" },
            ...(adv.payroll_deduction_authorized ? [{ value: "payroll_deduction", label: "Payroll deduction (finalized run)" }] : [])]} />
        </Field>
        {v.method === "payroll_deduction" && <Field label="Payroll run ID" required hint="The finalized run in which the deduction was made."><Input value={v.payrollRunId} onChange={set("payrollRunId")} /></Field>}
        <Field label="Reference" required><Input maxLength={120} value={v.reference} onChange={set("reference")} /></Field>
        <Field label="Received on" required><Input type="date" max={today()} value={v.paidOn} onChange={set("paidOn")} /></Field>
        <Field label="Note"><Input maxLength={1000} value={v.note} onChange={set("note")} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function Comments({ request }) {
  const { notify } = useToast();
  const comments = useHrQuery(() => listRequestComments(request.id), [request.id]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const closed = ["completed", "rejected", "cancelled", "draft"].includes(request.status);
  const canWrite = !request.is_requester && (request.can_handle || (request.stages ?? []).some((s) => s.can_act || s.can_delegate || s.decided_by));
  async function send(internal) {
    if (!body.trim()) { setError("Write a message first."); return; }
    setBusy(internal ? "note" : "reply"); setError(null);
    const res = await commentRequest(request.id, body, internal);
    setBusy(null);
    if (res.error) { setError(res.error); return; }
    setBody(""); notify(internal ? "Internal note added." : "Comment sent to the employee.");
    comments.reload();
  }
  return (
    <SectionCard title="Comments" icon={MessageSquare}>
      {comments.loading && !comments.data ? <Loading /> : comments.error ? <ErrorState message={comments.error} onRetry={comments.reload} /> : <Conversation comments={comments.data} requesterId={request.employee_id} />}
      {canWrite && (
        <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4">
          <Field label="Comment"><Textarea rows={3} maxLength={8000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={closed ? "Closed: only internal notes can be added." : "Ask for information or explain a decision…"} /></Field>
          <InlineError message={error} />
          <div className="flex flex-wrap justify-end gap-2">
            {request.can_handle && <Button variant="secondary" loading={busy === "note"} disabled={Boolean(busy)} onClick={() => send(true)}>Add internal note</Button>}
            {!closed && <Button loading={busy === "reply"} disabled={Boolean(busy)} onClick={() => send(false)}><Send className="h-4 w-4" aria-hidden="true" />Send</Button>}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

export default function HrWorkflowDetail({ id }) {
  const navigate = useNavigate();
  const { notify } = useToast();
  const q = useHrQuery(() => getRequestDetail(id), [id]);
  const [modal, setModal] = useState(null);
  const [verifying, setVerifying] = useState(false);
  if (q.loading && !q.data) return <Loading />;
  if (q.error && /not found/i.test(q.error)) return <EmptyState title="Request not found" description="It does not exist or you are not allowed to view it." action={<Button variant="secondary" onClick={() => navigate("/hr/requests")}>Back to requests</Button>} />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  const r = q.data;
  const done = () => { setModal(null); q.reload(); };
  const adv = r.advance;
  async function verify() {
    setVerifying(true);
    const res = await verifyAdvanceDisbursement(r.id);
    setVerifying(false);
    if (res.error) notify(res.error, "error"); else { notify("Disbursement verified. The employee was notified."); q.reload(); }
  }
  const salaryCert = r.workflow === "hr_letter" && r.details?.letter_type === "salary_certificate";
  return (
    <>
      <button type="button" onClick={() => navigate("/hr/requests")} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Requests &amp; approvals
      </button>
      <PageHeader title={r.subject}
        description={<span className="flex flex-wrap items-center gap-2"><RequestStatusBadge status={r.status} /><WorkflowBadge workflow={r.workflow} />
          {r.is_confidential && <Badge tone="red"><Lock className="mr-1 h-3 w-3" aria-hidden="true" />restricted</Badge>}</span>}
        actions={<>
          {r.pending_action === "issue_letter" && <Button onClick={() => setModal("issue")}>Issue letter</Button>}
          {r.pending_action === "record_disbursement" && <Button onClick={() => setModal("disburse")}>Record disbursement</Button>}
          {adv?.can_verify && <Button variant="success" loading={verifying} onClick={verify}><ShieldCheck className="h-4 w-4" aria-hidden="true" />Verify disbursement</Button>}
          {adv?.can_record_repayment && <Button variant="secondary" onClick={() => setModal("repay")}>Record repayment</Button>}
        </>} />
      {r.is_requester && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This is your own request. Another reviewer will decide it; track it in My HR Requests.</p>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          <Card title={workflowLabel(r.workflow)}><RequestDetailsList request={r} /></Card>
          {r.profile_changes && <Card title="Current and proposed values"><ProfileChangesTable rows={r.profile_changes} /></Card>}
          <SectionCard title="Approval steps" icon={ShieldCheck}>
            <StageTimeline stages={r.stages} onDecide={(s) => setModal({ decide: s })} onDelegate={(s) => setModal({ delegate: s })} />
          </SectionCard>
          {adv && <AdvancePanel advance={adv} />}
          <PaymentPanel payment={r.payment} />
          <SectionCard title="Files" icon={Paperclip} actions={<>
            {r.pending_action === "issue_letter" && <FileUploadButton requestId={r.id} kind="issued_letter" label={salaryCert ? "Upload certificate" : "Upload letter"} onUploaded={q.reload} />}
            {r.pending_action === "record_disbursement" && <FileUploadButton requestId={r.id} kind="payment_evidence" label="Upload payment evidence" onUploaded={q.reload} />}
          </>}>
            <AttachmentList attachments={r.attachments} removable onChanged={q.reload} />
          </SectionCard>
          <Comments request={r} />
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Details">
            <DescriptionList items={[
              { label: "Employee", value: `${fullName(r.employee)} (${r.employee?.employee_code})` },
              r.employee?.department && { label: "Department", value: r.employee.department },
              r.employee?.company && { label: "Company", value: r.employee.company },
              { label: "Type", value: r.category?.name },
              { label: "Submitted", value: formatDateTime(r.submitted_at ?? r.created_at) },
              { label: "Due", value: formatDateTime(r.sla_due_at) },
              r.decided_at && { label: "Decided", value: formatDateTime(r.decided_at) },
              r.completed_at && { label: "Completed", value: formatDateTime(r.completed_at) },
              r.resolution && { label: "Note", value: r.resolution },
            ]} />
          </Card>
          <SectionCard title="History" icon={History}><EventHistory events={r.events} /></SectionCard>
        </div>
      </div>
      {modal?.decide && <DecisionModal stage={modal.decide} request={r} onClose={() => setModal(null)} onDone={done} />}
      {modal?.delegate && <DelegateModal stage={modal.delegate} onClose={() => setModal(null)} onDone={done} />}
      {modal === "issue" && <IssueLetterModal request={r} onClose={() => setModal(null)} onDone={done} />}
      {modal === "disburse" && <DisbursementModal request={r} onClose={() => setModal(null)} onDone={done} />}
      {modal === "repay" && <RepaymentModal request={r} onClose={() => setModal(null)} onDone={done} />}
    </>
  );
}
