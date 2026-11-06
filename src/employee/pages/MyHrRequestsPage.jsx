// Employee: my HR requests, built around five request types: attendance
// correction (Module 5), reimbursement, salary certificate, document request
// and employee information change (Module 10 workflows: status, approvals,
// files, issued letters, payments). One list covers all of them, with status
// tabs and a type filter. HR questions are raised in Helpdesk & Support; older
// HR questions and salary advances still open here. Resignation has its own
// page (My Resignation). Mounted at /employee/requests/*.
import { useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Lock, Plus, Send } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { cancelCorrection, listMyCorrections, requestTypeLabel } from "@/lib/hr/attendance";
import { LETTER_TYPES } from "@/lib/hr/requestWorkflows";
import { RequestStatusBadge } from "@/hr/requests/RequestWidgets";
import { formatTimeRange } from "@/hr/requests/time";
import {
  AttendanceCorrectionForm, LetterForm, ProfileChangeForm, ReimbursementForm, RequestTypeChooser, RequestTypeGrid, SalaryAdvanceForm,
  availableRequestTypes,
} from "@/employee/requests/NewRequestForms";
import MyWorkflowDetail from "@/employee/requests/MyWorkflowDetail";
import {
  REQUEST_PRIORITIES, REOPEN_WINDOW_DAYS, canReopen, cancelRequest, closeRequest, commentRequest, createRequest, getRequest,
  listMyRequests, listRequestCategories, listRequestComments, reopenRequest,
} from "@/lib/hr/requests";
import { Conversation, PriorityBadge } from "@/hr/pages/HrRequestsPage";
import {
  Badge, Button, Card, ConfirmDialog, DataTable, DescriptionList, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal,
  PageHeader, Select, Tabs, Textarea, useToast,
} from "@/hr/ui";

const label = (s) => String(s ?? "").replace(/_/g, " ");

// ------------------------------------------------------------- new request
function NewRequestModal({ initialCategory = "", onClose, onCreated }) {
  const { notify } = useToast();
  const cats = useHrQuery(async () => {
    const res = await listRequestCategories({ activeOnly: true });
    return { ...res, data: res.data?.filter((c) => !c.workflow || c.workflow === "helpdesk") ?? null };
  }, []);
  const [v, setV] = useState({ category: initialCategory, subject: "", priority: "medium", description: "" });
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

// -------------------------------------------------------------------- list
// One list for every request type: Module 10 requests (hr_requests) and attendance corrections (Module 5).
const KINDS = {
  attendance: { label: "Attendance correction", tone: "amber" },
  reimbursement: { label: "Reimbursement", tone: "green" },
  salary: { label: "Salary certificate", tone: "orange" },
  document: { label: "Document request", tone: "blue" },
  profile: { label: "Information change", tone: "violet" },
  helpdesk: { label: "HR question", tone: "slate" },
  advance: { label: "Salary advance", tone: "slate" },   // older requests; no longer offered on this page
};
function requestKind(r) {
  if (r.workflow === "hr_letter") return r.details?.letter_type === "salary_certificate" ? "salary" : "document";
  return { reimbursement: "reimbursement", profile_change: "profile", salary_advance: "advance" }[r.workflow] ?? "helpdesk";
}

const NEEDS_YOU = new Set(["draft", "returned", "waiting_on_employee", "resolved"]);
const CLOSED = new Set(["completed", "rejected", "cancelled", "closed"]);
function bucket(row) {
  if (row.kind === "attendance") return row.status === "pending" ? "progress" : "closed";
  if (NEEDS_YOU.has(row.status)) return "action";
  return CLOSED.has(row.status) ? "closed" : "progress";
}
function nextStep(row) {
  if (row.kind === "attendance") {
    if (row.status !== "pending") return null;
    return row.correction.approval_stage === "hr" ? "Waiting for HR" : "Waiting for your manager";
  }
  switch (row.status) {
    case "draft": return "Not submitted: open it and submit";
    case "returned": return "Returned: update and resubmit";
    case "waiting_on_employee": return "HR is waiting for your reply";
    case "resolved": return "Confirm it is solved, or reopen";
    case "open": case "in_progress": return "With HR";
    case "pending_approval": return "Waiting for approval";
    case "approved":
      if (row.kind === "reimbursement") return "Approved: paid with the next payroll";
      if (row.kind === "salary" || row.kind === "document") return "Approved: being prepared";
      return "Approved: being processed";
    default: return null;
  }
}

const TABS = [
  { value: "all", label: "All" },
  { value: "action", label: "Needs your action" },
  { value: "progress", label: "In progress" },
  { value: "closed", label: "Closed" },
];
const EMPTY = {
  all: ["No requests yet", "Choose a request type above to get started."],
  action: ["Nothing needs your action", "Returned requests, drafts and HR replies waiting for you appear here."],
  progress: ["Nothing in progress", "Submitted requests waiting for approval appear here."],
  closed: ["No closed requests", "Completed, rejected and cancelled requests appear here."],
};

function CorrectionModal({ correction: c, onClose, onChanged }) {
  const navigate = useNavigate();
  const { notify } = useToast();
  const [confirming, setConfirming] = useState(false);
  const has = (a, b) => Boolean(a || b);
  return (
    <>
      <Modal open={!confirming} onClose={onClose} title="Attendance correction" size="md"
        footer={<>
          {c.status === "pending" && <Button variant="secondary" onClick={() => setConfirming(true)}>Cancel request</Button>}
          <Button variant="secondary" onClick={() => navigate("/employee/attendance")}>Open My Attendance</Button>
          <Button onClick={onClose}>Close</Button>
        </>}>
        <DescriptionList items={[
          { label: "Status", value: <RequestStatusBadge status={c.status} /> },
          { label: "Date", value: formatDate(c.work_date) },
          { label: "Type", value: c.request_type ? requestTypeLabel(c.request_type) : "Punch correction" },
          c.status === "pending" && { label: "Waiting for", value: c.approval_stage === "hr" ? "HR" : "Your manager" },
          has(c.requested_check_in_at, c.requested_check_out_at) && { label: "Requested times", value: formatTimeRange(c.requested_check_in_at, c.requested_check_out_at) },
          has(c.original_check_in_at, c.original_check_out_at) && { label: "Original punches", value: formatTimeRange(c.original_check_in_at, c.original_check_out_at) },
          c.requested_status && { label: "Requested status", value: label(c.requested_status) },
          has(c.applied_check_in_at, c.applied_check_out_at) && { label: "Applied times", value: formatTimeRange(c.applied_check_in_at, c.applied_check_out_at) },
          { label: "Reason", value: c.reason },
          c.evidence_note && { label: "Evidence", value: c.evidence_note },
          c.manager_note && { label: "Manager note", value: c.manager_note },
          c.review_note && { label: "Reviewer note", value: c.review_note },
          { label: "Submitted", value: formatDateTime(c.created_at) },
          c.reviewed_at && { label: "Decided", value: formatDateTime(c.reviewed_at) },
        ]} />
      </Modal>
      <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} tone="danger" title="Cancel correction"
        message="Cancel this attendance correction? Your attendance stays as it is." confirmLabel="Cancel correction"
        onConfirm={async () => { const res = await cancelCorrection(c.id); if (!res.error) { notify("Correction cancelled."); onChanged(); } return res; }} />
    </>
  );
}

// Deep links (e.g. from My Payroll & Payslips) open a form directly:
//   ?new=attendance | reimbursement | salary | document | profile | helpdesk[&category=<code>] | advance
//   ?new=letter[&letter=<letter type>] is kept for older links (salary_certificate opens the salary form).
const DEEP_LINK_TYPES = ["attendance", "reimbursement", "salary", "document", "profile", "helpdesk", "advance"];
function initialForm(params) {
  const n = params.get("new");
  if (n === "letter") return params.get("letter") === "salary_certificate" ? "salary" : "document";
  return DEEP_LINK_TYPES.includes(n) ? n : null;
}

function MyRequestList() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const navigate = useNavigate();
  const list = useHrQuery(() => listMyRequests(me), [me]);
  const corrections = useHrQuery(() => listMyCorrections(me), [me]);
  const cats = useHrQuery(() => listRequestCategories(), []);
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(() => initialForm(params));   // null | "choose" | type key
  const presetLetter = LETTER_TYPES.some((t) => t.value === params.get("letter") && t.value !== "salary_certificate") ? params.get("letter") : "";
  const presetCategory = params.get("category") || "";
  const [tab, setTab] = useState("all");
  const [kind, setKind] = useState("");
  const [openCorrection, setOpenCorrection] = useState(null);

  const rows = useMemo(() => {
    const reqs = (list.data ?? []).map((r) => ({ id: `r-${r.id}`, kind: requestKind(r), title: r.subject, status: r.status,
      created_at: r.created_at, updated_at: r.last_activity_at ?? r.updated_at ?? r.created_at, request: r }));
    const corr = (corrections.data ?? []).map((c) => ({ id: `c-${c.id}`, kind: "attendance", status: c.status,
      title: `${c.request_type ? requestTypeLabel(c.request_type) : "Punch correction"} for ${formatDate(c.work_date)}`,
      created_at: c.created_at, updated_at: c.reviewed_at ?? c.manager_decided_at ?? c.created_at, correction: c }));
    return [...reqs, ...corr].map((x) => ({ ...x, bucket: bucket(x) }))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }, [list.data, corrections.data]);

  if (!me) return <ErrorState message="Your account is not linked to an employee record." />;
  const close = () => { setCreating(null); if (params.has("new")) setParams({}, { replace: true }); };
  const created = (id) => { close(); list.reload(); if (id) navigate(`/employee/requests/${id}`); };
  const reloadAll = () => { list.reload(); corrections.reload(); };

  const ofKind = kind ? rows.filter((x) => x.kind === kind) : rows;
  const shown = tab === "all" ? ofKind : ofKind.filter((x) => x.bucket === tab);
  const count = (t) => (t === "all" ? ofKind.length : ofKind.filter((x) => x.bucket === t).length);
  const loaded = list.data && corrections.data;
  const kindOptions = Object.entries(KINDS).filter(([k]) => (k !== "advance" && k !== "helpdesk") || rows.some((x) => x.kind === k))
    .map(([value, k]) => ({ value, label: k.label }));
  const [emptyTitle, emptyDescription] = kind && tab === "all" ? ["No requests of this type", "Clear the type filter to see all requests."] : EMPTY[tab];

  return (
    <>
      <PageHeader title="My HR Requests"
        description="Attendance corrections, reimbursements, salary certificates, document requests and changes to your employee information. Each request shows who approves it and where it is now."
        actions={<Button className="whitespace-nowrap" onClick={() => setCreating("choose")}><Plus className="h-4 w-4" aria-hidden="true" />New request</Button>} />

      <Card title="Start a request" className="mb-6">
        <RequestTypeGrid types={availableRequestTypes(cats.data)} onPick={setCreating} className="sm:grid-cols-2 xl:grid-cols-5" />
        <p className="mt-3 text-xs text-slate-500">Something else? <Link to="/employee/helpdesk?new=1" className="font-semibold text-[#1f4693] hover:underline">Ask HR a question</Link> in Helpdesk &amp; Support.</p>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <Tabs label="Request status" value={tab} onChange={setTab}
            tabs={TABS.map((t) => ({ ...t, count: loaded ? count(t.value) : undefined }))} />
        </div>
        <div className="mb-4 sm:w-60">
          <Select aria-label="Request type" placeholder="All request types" value={kind} onChange={(e) => setKind(e.target.value)} options={kindOptions} />
        </div>
      </div>

      <DataTable caption="My HR requests" rows={shown} loading={(list.loading && !list.data) || (corrections.loading && !corrections.data)}
        error={list.error || corrections.error} onRetry={reloadAll} emptyTitle={emptyTitle} emptyDescription={emptyDescription}
        onRowClick={(x) => (x.correction ? setOpenCorrection(x.correction) : navigate(`/employee/requests/${x.request.id}`))}
        columns={[
          { key: "title", header: "Request", render: (x) => (
            <div className="min-w-[12rem]">
              <p className="font-semibold text-[#101a3a]">{x.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <Badge tone={KINDS[x.kind].tone}>{KINDS[x.kind].label}</Badge>
                {x.kind === "helpdesk" && x.request.category?.name}
              </p>
            </div>
          ) },
          { key: "status", header: "Status", render: (x) => <RequestStatusBadge status={x.status} /> },
          { key: "next", header: "Next step", render: (x) => {
            const s = nextStep(x);
            return s ? <span className={x.bucket === "action" ? "font-semibold text-orange-700" : "text-slate-600"}>{s}</span> : <span className="text-slate-400">—</span>;
          } },
          { key: "created_at", header: "Submitted", sortable: true, render: (x) => formatDateTime(x.created_at) },
          { key: "updated_at", header: "Last update", sortable: true, render: (x) => formatDateTime(x.updated_at) },
        ]} />

      {creating === "choose" && <RequestTypeChooser categories={cats.data} onClose={close} onPick={setCreating} />}
      {/* HR questions and support tickets are raised in Helpdesk & Support (181). */}
      {creating === "helpdesk" && <Navigate to={`/employee/helpdesk?new=1${presetCategory ? `&category=${encodeURIComponent(presetCategory)}` : ""}`} replace />}
      {creating === "salary" && <LetterForm variant="salary" onClose={close} onDone={created} />}
      {creating === "document" && <LetterForm variant="document" request={presetLetter ? { details: { letter_type: presetLetter } } : undefined} onClose={close} onDone={created} />}
      {creating === "reimbursement" && <ReimbursementForm onClose={close} onDone={created} />}
      {/* Not offered on this page; kept for the My Payroll deep link (?new=advance). */}
      {creating === "advance" && <SalaryAdvanceForm onClose={close} onDone={created} />}
      {creating === "profile" && <ProfileChangeForm employeeId={me} onClose={close} onDone={created} />}
      {creating === "attendance" && <AttendanceCorrectionForm onClose={close} onDone={() => { close(); corrections.reload(); }} />}
      {openCorrection && <CorrectionModal correction={openCorrection} onClose={() => setOpenCorrection(null)}
        onChanged={() => { setOpenCorrection(null); corrections.reload(); }} />}
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
  if (req.data?.workflow === "helpdesk") return <Navigate to={`/employee/helpdesk/${id}`} replace />;
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
