// Employee: my HR requests — HR questions (conversation, close / reopen /
// cancel per the server rules), Module 10 workflow requests (HR letters,
// reimbursements, salary advances, profile changes: status, approvals,
// files, issued letters, payments), my attendance corrections (Module 5) and
// the Resignation section (submit, track the workflow, withdraw before HR
// approval). Mounted at /employee/requests/*.
import { useState } from "react";
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, DoorOpen, Lock, Plus, Send } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { listMyCorrections } from "@/lib/hr/attendance";
import { RequestStatusBadge, WorkflowBadge } from "@/hr/requests/RequestWidgets";
import { formatTimeRange } from "@/hr/requests/time";
import {
  AttendanceCorrectionForm, LetterForm, ProfileChangeForm, ReimbursementForm, RequestTypeChooser, SalaryAdvanceForm,
} from "@/employee/requests/NewRequestForms";
import MyWorkflowDetail from "@/employee/requests/MyWorkflowDetail";
import {
  REQUEST_PRIORITIES, REOPEN_WINDOW_DAYS, canReopen, cancelRequest, closeRequest, commentRequest, createRequest, getRequest,
  listMyRequests, listRequestCategories, listRequestComments, reopenRequest,
} from "@/lib/hr/requests";
import { ENDED_EXIT_STATUSES, listMyExits, submitResignation, withdrawExit } from "@/lib/hr/exits";
import { ExitStepper } from "@/hr/pages/ExitsPage";
import { Conversation, PriorityBadge } from "@/hr/pages/HrRequestsPage";
import {
  Badge, Button, Card, ConfirmDialog, DataTable, DescriptionList, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal,
  PageHeader, Select, StatusBadge, Textarea, useToast,
} from "@/hr/ui";

const label = (s) => String(s ?? "").replace(/_/g, " ");
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

// ------------------------------------------------------------- new request
function NewRequestModal({ onClose, onCreated }) {
  const { notify } = useToast();
  const cats = useHrQuery(async () => {
    const res = await listRequestCategories({ activeOnly: true });
    return { ...res, data: res.data?.filter((c) => !c.workflow || c.workflow === "helpdesk") ?? null };
  }, []);
  const [v, setV] = useState({ category: "", subject: "", priority: "medium", description: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const cat = (cats.data ?? []).find((c) => c.code === v.category);
  async function submit() {
    const errs = {};
    if (!v.category) errs.category = "Choose a category.";
    const subj = v.subject.trim();
    if (subj.length < 3 || subj.length > 200) errs.subject = "Enter a subject (3 to 200 characters).";
    if (!v.description.trim()) errs.description = "Describe your request.";
    else if (v.description.trim().length > 8000) errs.description = "8000 characters maximum.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await createRequest(v);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Request submitted. HR will respond here.");
    onCreated(res.data);
  }
  return (
    <Modal open onClose={onClose} title="Ask HR a question" size="md"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}><Send className="h-4 w-4" aria-hidden="true" />Submit</Button></>}>
      {cats.loading && !cats.data ? <Loading /> : cats.error ? <ErrorState message={cats.error} onRetry={cats.reload} /> : (
        <div className="flex flex-col gap-3">
          <Field label="Category" required error={errors.category} hint={cat?.description}>
            <Select placeholder="Choose a category" value={v.category} onChange={set("category")} options={(cats.data ?? []).map((c) => ({ value: c.code, label: c.name }))} />
          </Field>
          {cat?.code === "leave_query" && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">To apply for leave use <a href="/employee/leave" className="font-semibold underline">My Leave</a> — leave requests are approved there, not through HR requests. Use this category only for questions.</p>}
          {cat?.is_confidential && <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />Confidential: only senior HR staff can see this request. Your manager cannot.</p>}
          <Field label="Subject" required error={errors.subject}><Input value={v.subject} maxLength={200} onChange={set("subject")} /></Field>
          <Field label="Priority"><Select value={v.priority} onChange={set("priority")} options={REQUEST_PRIORITIES.map((p) => ({ value: p, label: p }))} /></Field>
          <Field label="Description" required error={errors.description}><Textarea rows={6} value={v.description} maxLength={8000} onChange={set("description")} /></Field>
          {cat && <p className="text-xs text-slate-500">Target response time: {cat.sla_hours} hours.</p>}
          <InlineError message={error} />
        </div>
      )}
    </Modal>
  );
}

// -------------------------------------------------------------- resignation
function ResignModal({ onClose, onDone }) {
  const { notify } = useToast();
  const [reason, setReason] = useState("");
  const [lwd, setLwd] = useState("");
  const [errors, setErrors] = useState({});
  const [confirming, setConfirming] = useState(false);
  function review() {
    const errs = {};
    if (reason.trim().length < 3) errs.reason = "Please give a reason (at least 3 characters).";
    if (lwd && lwd < today()) errs.lwd = "The proposed last working day is in the past.";
    setErrors(errs);
    if (!Object.keys(errs).length) setConfirming(true);
  }
  return (
    <>
      <Modal open={!confirming} onClose={onClose} title="Submit resignation" size="md"
        footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={review}>Continue</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-600">Your reporting manager reviews the resignation first (if you have one), then HR confirms your last working day. You can withdraw it until HR approves it.</p>
          <Field label="Reason" required error={errors.reason}><Textarea rows={5} value={reason} maxLength={4000} onChange={(e) => setReason(e.target.value)} /></Field>
          <Field label="Proposed last working day" error={errors.lwd} hint="Optional — defaults to today plus your notice period."><Input type="date" min={today()} value={lwd} onChange={(e) => setLwd(e.target.value)} /></Field>
        </div>
      </Modal>
      <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} tone="danger" title="Confirm resignation"
        message={`Submit your resignation${lwd ? ` with a proposed last working day of ${formatDate(lwd)}` : ""}? Your manager and HR will be notified.`}
        confirmLabel="Submit resignation"
        onConfirm={async () => { const res = await submitResignation(reason, lwd); if (!res.error) { notify("Resignation submitted."); onDone(); } return res; }} />
    </>
  );
}

function ResignationSection({ employeeId }) {
  const { notify } = useToast();
  const exits = useHrQuery(() => listMyExits(employeeId), [employeeId]);
  const [resigning, setResigning] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const open = (exits.data ?? []).find((x) => !ENDED_EXIT_STATUSES.includes(x.status));
  const past = (exits.data ?? []).filter((x) => x !== open);
  const canWithdraw = open && open.initiated_by === "employee" && ["submitted", "manager_review", "hr_review"].includes(open.status);
  return (
    <Card title={<span className="inline-flex items-center gap-2"><DoorOpen className="h-4 w-4" aria-hidden="true" />Resignation</span>}
      actions={exits.data && !open && <Button size="sm" variant="secondary" onClick={() => setResigning(true)}>Submit resignation</Button>}>
      {exits.loading && !exits.data ? <Loading /> : exits.error ? <ErrorState message={exits.error} onRetry={exits.reload} /> : open ? (
        <div className="flex flex-col gap-4">
          <ExitStepper exit={open} />
          <DescriptionList items={[
            { label: "Status", value: <StatusBadge status={open.status} /> },
            { label: "Type", value: label(open.exit_type) },
            { label: "Resignation date", value: formatDate(open.resignation_date) },
            { label: "Notice period", value: open.notice_period_days != null ? `${open.notice_period_days} days` : null },
            { label: "Proposed last working day", value: formatDate(open.proposed_last_working_day) },
            { label: "Approved last working day", value: formatDate(open.approved_last_working_day) },
            open.manager_decision && { label: "Manager review", value: `${open.manager_decision}${open.manager_note ? ` — ${open.manager_note}` : ""}` },
            open.hr_decision && { label: "HR decision", value: `${open.hr_decision}${open.hr_note ? ` — ${open.hr_note}` : ""}` },
          ]} />
          {open.status === "clearance" && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Clearance has started: please return company assets (see My Assets) and complete your handovers.</p>}
          {canWithdraw ? (
            <div><Button variant="secondary" onClick={() => setWithdrawing(true)}>Withdraw resignation</Button></div>
          ) : open.initiated_by === "employee" && <p className="text-xs text-slate-500">HR has approved your resignation; contact HR to change it.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-slate-600">You have no open resignation.</p>
          {past.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {past.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2 text-slate-600"><StatusBadge status={x.status} /> {label(x.exit_type)} · submitted {formatDate(x.resignation_date ?? x.created_at)}</li>)}
            </ul>
          )}
        </div>
      )}
      {resigning && <ResignModal onClose={() => setResigning(false)} onDone={() => { setResigning(false); exits.reload(); }} />}
      <ConfirmDialog open={withdrawing} onClose={() => setWithdrawing(false)} title="Withdraw resignation"
        message="Your resignation will be withdrawn and your manager and HR notified." confirmLabel="Withdraw" requireReason={false} reasonLabel="Note (optional)"
        onConfirm={async (note) => { const res = await withdrawExit(open.id, note); if (!res.error) { notify("Resignation withdrawn."); exits.reload(); } return res; }} />
    </Card>
  );
}

// -------------------------------------------------------------------- list
function MyCorrections({ employeeId, reloadKey }) {
  const list = useHrQuery(() => listMyCorrections(employeeId), [employeeId, reloadKey]);
  return (
    <Card title={<span className="inline-flex items-center gap-2"><CalendarClock className="h-4 w-4" aria-hidden="true" />My attendance corrections</span>}
      actions={<Link to="/employee/attendance" className="text-sm font-semibold text-[#1f4693] hover:underline">Open My Attendance</Link>}>
      <DataTable caption="My attendance corrections" rows={(list.data ?? []).slice(0, 10)} loading={list.loading} error={list.error} onRetry={list.reload} pageSize={10}
        emptyTitle="No attendance corrections" emptyDescription="Use New request, then Attendance correction, for a missed or wrong punch."
        columns={[
          { key: "work_date", header: "Date", render: (c) => formatDate(c.work_date) },
          { key: "requested", header: "Requested", render: (c) => formatTimeRange(c.requested_check_in_at, c.requested_check_out_at) },
          { key: "reason", header: "Reason", render: (c) => <span className="line-clamp-2">{c.reason}</span> },
          { key: "status", header: "Status", render: (c) => <RequestStatusBadge status={c.status} /> },
          { key: "review_note", header: "Reviewer note", render: (c) => c.review_note || "—" },
        ]} />
    </Card>
  );
}

function MyRequestList() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const navigate = useNavigate();
  const list = useHrQuery(() => listMyRequests(me), [me]);
  const cats = useHrQuery(() => listRequestCategories(), []);
  // ?new=reimbursement (e.g. from My Payslips) opens the reimbursement claim form directly.
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(() => (params.get("new") === "reimbursement" ? "reimbursement" : null));   // null | "choose" | type key
  const [corrKey, setCorrKey] = useState(0);
  if (!me) return <ErrorState message="Your account is not linked to an employee record." />;
  const close = () => { setCreating(null); if (params.has("new")) setParams({}, { replace: true }); };
  const created = (id) => { close(); list.reload(); if (id) navigate(`/employee/requests/${id}`); };
  return (
    <>
      <PageHeader title="My HR Requests"
        description="HR questions, letters, reimbursements, salary advances, profile changes and attendance corrections. HR questions are seen only by HR; claims and advances also go to your manager for approval."
        actions={<Button onClick={() => setCreating("choose")}><Plus className="h-4 w-4" aria-hidden="true" />New request</Button>} />
      <DataTable caption="My HR requests" rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle="No requests yet" emptyDescription="Use New request to contact HR." onRowClick={(r) => navigate(`/employee/requests/${r.id}`)}
        columns={[
          { key: "subject", header: "Request", render: (r) => <div className="min-w-[12rem]"><p className="font-semibold text-[#101a3a]">{r.subject}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">{r.workflow && r.workflow !== "helpdesk" ? <WorkflowBadge workflow={r.workflow} /> : r.category?.name}</p></div> },
          { key: "status", header: "Status", render: (r) => <RequestStatusBadge status={r.status} /> },
          { key: "created_at", header: "Created", sortable: true, render: (r) => formatDateTime(r.created_at) },
          { key: "last_activity_at", header: "Last update", sortable: true, render: (r) => formatDateTime(r.last_activity_at) },
        ]} />
      <div className="mt-6"><MyCorrections employeeId={me} reloadKey={corrKey} /></div>
      <div className="mt-6"><ResignationSection employeeId={me} /></div>
      {creating === "choose" && <RequestTypeChooser categories={cats.data} onClose={close} onPick={setCreating} />}
      {creating === "helpdesk" && <NewRequestModal onClose={close} onCreated={created} />}
      {creating === "letter" && <LetterForm onClose={close} onDone={created} />}
      {creating === "reimbursement" && <ReimbursementForm onClose={close} onDone={created} />}
      {creating === "advance" && <SalaryAdvanceForm onClose={close} onDone={created} />}
      {creating === "profile" && <ProfileChangeForm employeeId={me} onClose={close} onDone={created} />}
      {creating === "attendance" && <AttendanceCorrectionForm onClose={close} onDone={() => { close(); setCorrKey((k) => k + 1); }} />}
    </>
  );
}

// ------------------------------------------------------------------ detail
function MyRequestDetail() {
  const { id } = useParams();
  const { hr } = useAuth();
  const req = useHrQuery(() => getRequest(id), [id]);
  if (req.loading && !req.data) return <Loading />;
  if (req.data?.workflow && req.data.workflow !== "helpdesk") return <MyWorkflowDetail id={id} employeeId={hr?.employee?.id} />;
  return <MyHelpdeskDetail id={id} req={req} />;
}

function MyHelpdeskDetail({ id, req }) {
  const navigate = useNavigate();
  const { notify } = useToast();
  const comments = useHrQuery(() => listRequestComments(id), [id]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null);
  const refresh = () => { req.reload(); comments.reload(); };

  if (req.error) return <ErrorState message={req.error} onRetry={req.reload} />;
  if (!req.data) return <EmptyState title="Request not found" action={<Button variant="secondary" onClick={() => navigate("/employee/requests")}>Back to my requests</Button>} />;
  const r = req.data;
  const closed = ["closed", "cancelled"].includes(r.status);

  async function send() {
    if (!body.trim()) { setError("Write a message first."); return; }
    setSending(true); setError(null);
    const res = await commentRequest(r.id, body, false);
    setSending(false);
    if (res.error) { setError(res.error); return; }
    setBody("");
    notify("Message sent to HR.");
    refresh();
  }

  return (
    <>
      <button type="button" onClick={() => navigate("/employee/requests")} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> My requests
      </button>
      <PageHeader title={r.subject}
        description={<span className="flex flex-wrap items-center gap-2"><RequestStatusBadge status={r.status} /><PriorityBadge priority={r.priority} />{r.category?.name && <Badge>{r.category.name}</Badge>}</span>}
        actions={<>
          {r.status === "open" && <Button variant="secondary" onClick={() => setDialog("cancel")}>Cancel request</Button>}
          {canReopen(r) && <Button variant="secondary" onClick={() => setDialog("reopen")}>Reopen</Button>}
          {r.status === "resolved" && <Button variant="success" onClick={() => setDialog("close")}>Confirm & close</Button>}
        </>} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          <Card title="Your request">
            <p className="whitespace-pre-line text-sm text-slate-800">{r.description}</p>
            {r.resolution && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm"><p className="font-semibold text-emerald-800">Resolution from HR</p><p className="whitespace-pre-line text-emerald-900">{r.resolution}</p></div>}
            {r.status === "resolved" && <p className="mt-3 text-xs text-slate-500">If the issue is not solved, you can reopen within {REOPEN_WINDOW_DAYS} days of resolution.</p>}
          </Card>
          <Card title="Conversation">
            {comments.loading && !comments.data ? <Loading /> : comments.error ? <ErrorState message={comments.error} onRetry={comments.reload} /> : <Conversation comments={comments.data} requesterId={r.employee_id} />}
            {!closed ? (
              <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4">
                <Field label="Reply to HR"><Textarea rows={3} value={body} maxLength={8000} onChange={(e) => setBody(e.target.value)} /></Field>
                <InlineError message={error} />
                <div className="flex justify-end"><Button loading={sending} onClick={send}><Send className="h-4 w-4" aria-hidden="true" />Send</Button></div>
              </div>
            ) : <p className="mt-3 text-xs text-slate-500">This request is {r.status}.{canReopen(r) ? " Reopen it to continue the conversation." : ""}</p>}
          </Card>
        </div>
        <Card title="Details">
          <DescriptionList items={[
            { label: "Created", value: formatDateTime(r.created_at) },
            { label: "Handled by", value: r.assigned_to ? "Assigned to HR staff" : "Awaiting assignment" },
            { label: "Last update", value: formatDateTime(r.last_activity_at) },
            r.resolved_at && { label: "Resolved", value: formatDateTime(r.resolved_at) },
            r.closed_at && { label: "Closed", value: formatDateTime(r.closed_at) },
          ]} />
        </Card>
      </div>
      <ConfirmDialog open={dialog === "cancel"} onClose={() => setDialog(null)} tone="danger" title="Cancel request" message="Cancel this request? HR will stop working on it." confirmLabel="Cancel request"
        onConfirm={async () => { const res = await cancelRequest(r.id); if (!res.error) { notify("Request cancelled."); refresh(); } return res; }} />
      <ConfirmDialog open={dialog === "close"} onClose={() => setDialog(null)} tone="success" title="Close request" message="Confirm that your request has been resolved." confirmLabel="Close request"
        onConfirm={async () => { const res = await closeRequest(r.id); if (!res.error) { notify("Request closed."); refresh(); } return res; }} />
      <ConfirmDialog open={dialog === "reopen"} onClose={() => setDialog(null)} title="Reopen request" message="Tell HR what is still unresolved." confirmLabel="Reopen" requireReason={false} reasonLabel="Reason (optional)"
        onConfirm={async (reason) => { const res = await reopenRequest(r.id, reason); if (!res.error) { notify("Request reopened."); refresh(); } return res; }} />
    </>
  );
}

export default function MyHrRequestsPage() {
  return (
    <Routes>
      <Route index element={<MyRequestList />} />
      <Route path=":id" element={<MyRequestDetail />} />
    </Routes>
  );
}
