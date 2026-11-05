// Module 10 — Employee Portal: one of my workflow requests (letter, profile
// change, reimbursement, salary advance). RLS / hr_request_detail return only
// the requester's own requests; bank values come back masked.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, History, MessageSquare, Paperclip, Pencil, Send, ShieldCheck } from "lucide-react";
import { formatDateTime, useHrQuery } from "@/lib/hr/client";
import { commentRequest, cancelRequest, listRequestComments } from "@/lib/hr/requests";
import { acceptAdvanceAgreement, getRequestDetail, getRequestFileUrl, requestPolicies, submitWorkflowRequest, workflowLabel } from "@/lib/hr/requestWorkflows";
import {
  AdvancePanel, AttachmentList, EventHistory, FileUploadButton, PaymentPanel, ProfileChangesTable, RequestDetailsList, RequestStatusBadge,
  SectionCard, StageTimeline, WorkflowBadge,
} from "@/hr/requests/RequestWidgets";
import { LetterForm, ProfileChangeForm, ReimbursementForm, SalaryAdvanceForm } from "@/employee/requests/NewRequestForms";
import { Conversation } from "@/hr/pages/HrRequestsPage";
import { Button, Card, Checkbox, ConfirmDialog, DescriptionList, EmptyState, ErrorState, Field, InlineError, Loading, Modal, PageHeader, Textarea, useToast } from "@/hr/ui";

function AgreementModal({ request, onClose, onDone }) {
  const { notify } = useToast();
  const pol = useHrQuery(() => requestPolicies(), []);
  const allowDeduction = Boolean(pol.data?.salary_advances?.allow_payroll_deduction);
  const [agree, setAgree] = useState(false);
  const [deduct, setDeduct] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const d = request.details ?? {};
  async function submit() {
    if (!agree) { setError("Tick the box to accept the repayment agreement."); return; }
    setBusy(true); setError(null);
    const res = await acceptAdvanceAgreement(request.id, deduct);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Agreement accepted. Finance will arrange the payment.");
    onDone();
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title="Repayment agreement" size="md"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Accept agreement</Button></>}>
      <div className="flex flex-col gap-3 text-sm text-slate-700">
        <p>I agree to repay the salary advance of <span className="font-semibold">{d.amount} {d.currency}</span> in <span className="font-semibold">{d.repayment_months}</span> monthly
          instalment(s) of about <span className="font-semibold">{d.installment_amount} {d.currency}</span>, starting the month after the advance is paid.</p>
        <p>Any balance still outstanding when I leave the company is settled in my final settlement, as set out in the company policy.</p>
        <Checkbox label="I have read and accept this repayment agreement." checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        {allowDeduction ? (
          <Checkbox label="I authorise Payroll to deduct the instalments from my salary." checked={deduct} onChange={(e) => setDeduct(e.target.checked)} />
        ) : <p className="text-xs text-slate-500">Payroll deduction is not enabled; Finance will record your repayments.</p>}
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

export default function MyWorkflowDetail({ id, employeeId }) {
  const navigate = useNavigate();
  const { notify } = useToast();
  const q = useHrQuery(() => getRequestDetail(id), [id]);
  const comments = useHrQuery(() => listRequestComments(id), [id]);
  const [modal, setModal] = useState(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  if (q.loading && !q.data) return <Loading />;
  if (q.error && /not found/i.test(q.error)) return <EmptyState title="Request not found" action={<Button variant="secondary" onClick={() => navigate("/employee/requests")}>Back to my requests</Button>} />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  const r = q.data;
  const refresh = () => { q.reload(); comments.reload(); };
  const editable = r.can_edit;
  const issued = (r.attachments ?? []).filter((a) => a.kind === "issued_letter" && a.uploaded);
  const fileKind = r.workflow === "reimbursement" ? "receipt" : "supporting";
  const Form = { hr_letter: LetterForm, reimbursement: ReimbursementForm, salary_advance: SalaryAdvanceForm, profile_change: ProfileChangeForm }[r.workflow];
  const closed = ["completed", "rejected", "cancelled", "draft"].includes(r.status);

  async function send() {
    if (!body.trim()) { setError("Write a message first."); return; }
    setSending(true); setError(null);
    const res = await commentRequest(r.id, body, false);
    setSending(false);
    if (res.error) { setError(res.error); return; }
    setBody(""); notify("Message sent."); comments.reload();
  }
  async function submitDraft() {
    setSubmitting(true);
    const res = await submitWorkflowRequest(r.id);
    setSubmitting(false);
    if (res.error) notify(res.error, "error"); else { notify("Request submitted."); refresh(); }
  }
  async function download(a) {
    const res = await getRequestFileUrl(a, true);
    if (res.error) notify(res.error, "error"); else window.open(res.data, "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <button type="button" onClick={() => navigate("/employee/requests")} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> My requests
      </button>
      <PageHeader title={r.subject}
        description={<span className="flex flex-wrap items-center gap-2"><RequestStatusBadge status={r.status} /><WorkflowBadge workflow={r.workflow} /></span>}
        actions={<>
          {r.status === "draft" && <Button loading={submitting} onClick={submitDraft}><Send className="h-4 w-4" aria-hidden="true" />Submit</Button>}
          {r.status === "returned" && Form && <Button onClick={() => setModal("edit")}><Pencil className="h-4 w-4" aria-hidden="true" />Update &amp; resubmit</Button>}
          {r.status === "draft" && Form && <Button variant="secondary" onClick={() => setModal("edit")}>Edit</Button>}
          {r.pending_action === "accept_agreement" && <Button onClick={() => setModal("agree")}><ShieldCheck className="h-4 w-4" aria-hidden="true" />Accept repayment agreement</Button>}
          {r.can_cancel && <Button variant="secondary" onClick={() => setModal("cancel")}>Cancel request</Button>}
        </>} />
      {r.status === "draft" && <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">Not submitted yet. Check the details and files, then press Submit — if something is missing, the reason is shown when you submit.</p>}
      {r.status === "returned" && <p className="mb-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-900">Returned for correction — see the reviewer's comment below, update the request and resubmit.</p>}
      {(issued.length > 0 || r.issued_document) && (
        <Card title="Your letter" className="mb-4">
          <div className="flex flex-wrap gap-2">
            {issued.map((a) => <Button key={a.id} onClick={() => download(a)}><Download className="h-4 w-4" aria-hidden="true" />Download {a.file_name}</Button>)}
            {r.issued_document && <Button variant="secondary" onClick={() => navigate("/employee/documents")}><Download className="h-4 w-4" aria-hidden="true" />Open “{r.issued_document.title}” in My Documents</Button>}
          </div>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          <Card title={workflowLabel(r.workflow)}><RequestDetailsList request={r} /></Card>
          {r.profile_changes && <Card title="Requested changes"><ProfileChangesTable rows={r.profile_changes} /></Card>}
          <SectionCard title="Approval progress" icon={ShieldCheck}><StageTimeline stages={r.stages} /></SectionCard>
          {r.advance && <AdvancePanel advance={r.advance} />}
          <PaymentPanel payment={r.payment} />
          <SectionCard title="Files" icon={Paperclip} actions={editable && <FileUploadButton requestId={r.id} kind={fileKind} label={fileKind === "receipt" ? "Add receipt" : "Attach file"} onUploaded={q.reload} />}>
            <AttachmentList attachments={r.attachments} removable={editable} onChanged={q.reload} />
          </SectionCard>
          <SectionCard title="Messages" icon={MessageSquare}>
            {comments.loading && !comments.data ? <Loading /> : comments.error ? <ErrorState message={comments.error} onRetry={comments.reload} /> : <Conversation comments={comments.data} requesterId={r.employee_id} />}
            {!closed && (
              <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4">
                <Field label="Message to the reviewers"><Textarea rows={3} maxLength={8000} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
                <InlineError message={error} />
                <div className="flex justify-end"><Button loading={sending} onClick={send}><Send className="h-4 w-4" aria-hidden="true" />Send</Button></div>
              </div>
            )}
          </SectionCard>
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Status">
            <DescriptionList items={[
              { label: "Created", value: formatDateTime(r.created_at) },
              r.submitted_at && { label: "Submitted", value: formatDateTime(r.submitted_at) },
              r.sla_due_at && !closed && { label: "Target", value: formatDateTime(r.sla_due_at) },
              r.decided_at && { label: "Decided", value: formatDateTime(r.decided_at) },
              r.completed_at && { label: "Completed", value: formatDateTime(r.completed_at) },
              r.resolution && { label: "Note from HR", value: r.resolution },
            ]} />
          </Card>
          <SectionCard title="History" icon={History}><EventHistory events={r.events} /></SectionCard>
        </div>
      </div>
      {modal === "edit" && Form && <Form mode="edit" request={r} employeeId={employeeId} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === "agree" && <AgreementModal request={r} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      <ConfirmDialog open={modal === "cancel"} onClose={() => setModal(null)} tone="danger" title="Cancel request" message="Cancel this request? Any open approval step is closed." confirmLabel="Cancel request"
        onConfirm={async () => { const res = await cancelRequest(r.id); if (!res.error) { notify("Request cancelled."); refresh(); } return res; }} />
    </>
  );
}
