// Module 10 — HR Requests & Approvals. Tabs: Overview (KPIs), Approval inbox
// (requests + attendance corrections), All requests (the helpdesk queue with
// filters and SLA overdue highlight) and Configuration. Helpdesk detail keeps
// the conversation (internal notes visibly marked), assignment and status
// changes; workflow requests (letters, profile changes, reimbursements,
// salary advances) open the approval detail.
// Visibility is enforced by RLS: hr_requests.view (non-confidential, read-only),
// hr_requests.manage (all), hr_requests.payroll / .finance / .approve_team
// (only requests routed to them). Mounted at /hr/requests/*.
import { useState } from "react";
import { Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Lock, MessageSquare, Paperclip, Send, StickyNote, UserCheck } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDateTime, fullName, useHrQuery } from "@/lib/hr/client";
import {
  REQUEST_PRIORITIES, REQUEST_STATUSES, STAFF_SETTABLE_STATUSES, assignRequest, commentRequest, getRequest, isOverdue,
  listRequestCategories, listRequestComments, listRequests, updateRequestStatus,
} from "@/lib/hr/requests";
import { useEmployeeOptions } from "@/lib/hr/org";
import { WORKFLOW_LABELS, getRequestDetail } from "@/lib/hr/requestWorkflows";
import { ApprovalInbox, RequestConfiguration, RequestsOverview } from "@/hr/requests/HrApprovals";
import HrWorkflowDetail from "@/hr/requests/HrWorkflowDetail";
import { AttachmentList, FileUploadButton, RequestStatusBadge, WorkflowBadge } from "@/hr/requests/RequestWidgets";
import {
  Badge, Button, Card, DataTable, DescriptionList, EmptyState, ErrorState, Field, InlineError, Loading, Modal,
  PageHeader, SearchInput, Select, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";

const label = (s) => String(s ?? "").replace(/_/g, " ");
const PRIORITY_TONE = { low: "slate", medium: "blue", high: "orange", urgent: "red" };
export const PriorityBadge = ({ priority }) => <Badge tone={PRIORITY_TONE[priority] ?? "slate"}>{priority}</Badge>;
const empText = (e) => (e ? `${fullName(e)} (${e.employee_code})` : "—");

export function SlaText({ request }) {
  if (!request.sla_due_at) return <span className="text-slate-400">—</span>;
  const overdue = isOverdue(request);
  return (
    <span className={overdue ? "inline-flex items-center gap-1 font-semibold text-rose-700" : "text-slate-700"}>
      {overdue && <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}{formatDateTime(request.sla_due_at)}{overdue && <span className="sr-only"> (overdue)</span>}
    </span>
  );
}

/** Conversation list. Internal notes are highlighted and labelled. */
export function Conversation({ comments, requesterId }) {
  if (!comments?.length) return <p className="text-sm text-slate-600">No messages yet.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {comments.map((c) => {
        const fromRequester = c.author_employee_id && c.author_employee_id === requesterId;
        return (
          <li key={c.id} className={c.is_internal ? "rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-2" : fromRequester ? "rounded-xl border border-slate-200 bg-white px-3 py-2" : "rounded-xl border border-sky-100 bg-sky-50/60 px-3 py-2"}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold text-[#101a3a]">{c.author ? fullName(c.author) : fromRequester ? "Requester" : "HR team"}</span>
              {fromRequester ? <Badge>requester</Badge> : <Badge tone="blue">HR</Badge>}
              {c.is_internal && <Badge tone="amber"><Lock className="mr-1 h-3 w-3" aria-hidden="true" />internal note — not visible to the requester</Badge>}
              <span>{formatDateTime(c.created_at)}</span>
            </div>
            <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{c.body}</p>
          </li>
        );
      })}
    </ol>
  );
}

// -------------------------------------------------------------------- queue
function Queue() {
  const navigate = useNavigate();
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const [f, setF] = useState({ status: "active", category: "", priority: "", assigned: "", search: "", workflow: "" });
  const cats = useHrQuery(() => listRequestCategories(), []);
  const list = useHrQuery(() => listRequests({ ...f, me }), [f.status, f.category, f.priority, f.assigned, f.search, f.workflow, me]);
  const setFilter = (k) => (e) => setF((s) => ({ ...s, [k]: typeof e === "string" ? e : e.target.value }));
  const overdue = (list.data ?? []).filter(isOverdue).length;
  return (
    <>
      {list.data && overdue > 0 && <p className="mb-2"><Badge tone="red">{overdue} overdue</Badge></p>}
      <Toolbar>
        <SearchInput value={f.search} onChange={setFilter("search")} placeholder="Search subjects…" label="Search requests" />
        <Select aria-label="Request type" className="sm:w-44" placeholder="All types" value={f.workflow} onChange={setFilter("workflow")}
          options={Object.entries(WORKFLOW_LABELS).filter(([k]) => k !== "attendance_correction").map(([value, l]) => ({ value, label: l }))} />
        <Select aria-label="Status" className="sm:w-44" value={f.status} onChange={setFilter("status")}
          options={[{ value: "active", label: "Active (open)" }, { value: "", label: "All statuses" }, ...REQUEST_STATUSES.map((s) => ({ value: s, label: label(s) }))]} />
        <Select aria-label="Category" className="sm:w-44" placeholder="All categories" value={f.category} onChange={setFilter("category")} options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <Select aria-label="Priority" className="sm:w-36" placeholder="Any priority" value={f.priority} onChange={setFilter("priority")} options={REQUEST_PRIORITIES.map((p) => ({ value: p, label: p }))} />
        <Select aria-label="Assignment" className="sm:w-40" value={f.assigned} onChange={setFilter("assigned")}
          options={[{ value: "", label: "Anyone" }, ...(me ? [{ value: "me", label: "Assigned to me" }] : []), { value: "unassigned", label: "Unassigned" }]} />
      </Toolbar>
      <DataTable caption="HR request queue" rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle="No requests match" emptyDescription="Adjust the filters." onRowClick={(r) => navigate(`/hr/requests/${r.id}`)}
        columns={[
          { key: "subject", header: "Subject", render: (r) => (
            <div className="min-w-[14rem]"><p className="font-semibold text-[#101a3a]">{r.subject}{r.is_confidential && <Badge tone="red" className="ml-2"><Lock className="mr-1 h-3 w-3" aria-hidden="true" />confidential</Badge>}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">{r.workflow && r.workflow !== "helpdesk" && <WorkflowBadge workflow={r.workflow} />}{r.category?.name}</p></div>) },
          { key: "employee", header: "Requester", render: (r) => empText(r.employee) },
          { key: "priority", header: "Priority", sortable: true, sortValue: (r) => REQUEST_PRIORITIES.indexOf(r.priority), render: (r) => <PriorityBadge priority={r.priority} /> },
          { key: "status", header: "Status", render: (r) => <RequestStatusBadge status={r.status} /> },
          { key: "assignee", header: "Assigned to", render: (r) => (r.assignee ? fullName(r.assignee) : <span className="text-slate-400">Unassigned</span>) },
          { key: "sla_due_at", header: "SLA due", sortable: true, render: (r) => <SlaText request={r} /> },
          { key: "last_activity_at", header: "Last activity", sortable: true, render: (r) => formatDateTime(r.last_activity_at) },
        ]} />
    </>
  );
}

// ------------------------------------------------------------------- detail
function StatusModal({ request, onClose, onDone }) {
  const { notify } = useToast();
  const [status, setStatus] = useState(request.status);
  const [resolution, setResolution] = useState(request.resolution ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const needsResolution = status === "resolved" || status === "closed";
  async function submit() {
    if (status === request.status && resolution === (request.resolution ?? "")) { setError("Choose a different status or change the resolution."); return; }
    if (needsResolution && !resolution.trim()) { setError("Describe the resolution."); return; }
    setBusy(true); setError(null);
    const res = await updateRequestStatus(request.id, status, needsResolution ? resolution : null);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(`Request is now ${label(status)}.`);
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Change status" size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Update</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Status" required><Select value={status} onChange={(e) => setStatus(e.target.value)} options={STAFF_SETTABLE_STATUSES.map((s) => ({ value: s, label: label(s) }))} /></Field>
        {needsResolution && <Field label="Resolution" required hint="Visible to the requester."><Textarea rows={4} value={resolution} maxLength={8000} onChange={(e) => setResolution(e.target.value)} /></Field>}
        {status === "closed" && <p className="text-xs text-slate-500">Closed requests cannot receive replies until the requester reopens them (within 7 days of resolution).</p>}
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function AssignModal({ request, onClose, onDone }) {
  const { notify } = useToast();
  const employees = useEmployeeOptions();
  const [assignee, setAssignee] = useState(request.assigned_to ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if ((assignee || null) === (request.assigned_to || null)) { setError("Choose a different assignee."); return; }
    setBusy(true); setError(null);
    const res = await assignRequest(request.id, assignee || null);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(assignee ? "Request assigned." : "Request unassigned.");
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Assign request" size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        {employees.loading && !employees.data ? <Loading /> : employees.error ? <InlineError message={employees.error} /> : (
          <Field label="Assignee" hint="Only HR staff who handle requests can be assigned; the server checks this.">
            <Select placeholder="— Unassigned —" value={assignee} onChange={(e) => setAssignee(e.target.value)} options={(employees.data ?? []).filter((o) => o.value !== request.employee_id)} />
          </Field>
        )}
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function Composer({ request, onSent }) {
  const { notify } = useToast();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const closed = ["closed", "cancelled"].includes(request.status);
  async function send(internal) {
    if (!body.trim()) { setError("Write a message first."); return; }
    setBusy(internal ? "note" : "reply"); setError(null);
    const res = await commentRequest(request.id, body, internal);
    setBusy(null);
    if (res.error) { setError(res.error); return; }
    setBody("");
    notify(internal ? "Internal note added." : "Reply sent to the requester.");
    onSent();
  }
  return (
    <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
      <Field label="Message"><Textarea rows={4} value={body} maxLength={8000} onChange={(e) => setBody(e.target.value)} placeholder={closed ? "Closed: only internal notes can be added." : "Write a reply or an internal note…"} /></Field>
      <InlineError message={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" loading={busy === "note"} disabled={Boolean(busy)} onClick={() => send(true)}><StickyNote className="h-4 w-4" aria-hidden="true" />Add internal note</Button>
        {!closed && <Button loading={busy === "reply"} disabled={Boolean(busy)} onClick={() => send(false)}><Send className="h-4 w-4" aria-hidden="true" />Send reply</Button>}
      </div>
    </div>
  );
}

/** Files on a helpdesk request (requester uploads; staff may add supporting files). */
function HelpdeskFiles({ request, canAdd }) {
  const d = useHrQuery(() => getRequestDetail(request.id), [request.id, request.last_activity_at]);
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Paperclip className="h-4 w-4" aria-hidden="true" />Files</span>}
      actions={canAdd && <FileUploadButton requestId={request.id} kind="supporting" label="Attach file" onUploaded={d.reload} />}>
      {d.loading && !d.data ? <Loading /> : d.error ? <ErrorState message={d.error} onRetry={d.reload} /> : <AttachmentList attachments={d.data?.attachments} removable onChanged={d.reload} />}
    </Card>
  );
}

function RequestDetail() {
  const { id } = useParams();
  const req = useHrQuery(() => getRequest(id), [id]);
  if (req.loading && !req.data) return <Loading />;
  if (req.data && req.data.workflow && req.data.workflow !== "helpdesk") return <HrWorkflowDetail id={id} />;
  return <HelpdeskDetail id={id} req={req} />;
}

function HelpdeskDetail({ id, req }) {
  const navigate = useNavigate();
  const { hasPermission, hr } = useAuth();
  const { notify } = useToast();
  const comments = useHrQuery(() => listRequestComments(id), [id]);
  const [modal, setModal] = useState(null);
  const [selfAssigning, setSelfAssigning] = useState(false);
  const me = hr?.employee?.id;
  const refresh = () => { req.reload(); comments.reload(); };

  if (req.error) return <ErrorState message={req.error} onRetry={req.reload} />;
  if (!req.data) return <EmptyState title="Request not found" description="It does not exist or you are not allowed to view it." action={<Button variant="secondary" onClick={() => navigate("/hr/requests")}>Back to requests</Button>} />;

  const r = req.data;
  const own = r.employee_id === me;
  // Handling is decided per request on the server (payroll staff handle payroll-routed requests).
  const canManage = !own && (hasPermission("hr_requests.manage") || hasPermission("hr_requests.payroll"));
  const closed = ["closed", "cancelled"].includes(r.status);

  async function assignToMe() {
    setSelfAssigning(true);
    const res = await assignRequest(r.id, me);
    setSelfAssigning(false);
    if (res.error) notify(res.error, "error"); else { notify("Request assigned to you."); refresh(); }
  }

  return (
    <>
      <button type="button" onClick={() => navigate("/hr/requests")} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Requests &amp; approvals
      </button>
      <PageHeader title={r.subject}
        description={<span className="flex flex-wrap items-center gap-2"><RequestStatusBadge status={r.status} /><PriorityBadge priority={r.priority} />{r.category?.name && <Badge>{r.category.name}</Badge>}{r.is_confidential && <Badge tone="red"><Lock className="mr-1 h-3 w-3" aria-hidden="true" />confidential</Badge>}{isOverdue(r) && <Badge tone="red">SLA overdue</Badge>}</span>}
        actions={canManage && !closed && <>
          {me && r.assigned_to !== me && <Button variant="secondary" loading={selfAssigning} onClick={assignToMe}><UserCheck className="h-4 w-4" aria-hidden="true" />Assign to me</Button>}
          <Button variant="secondary" onClick={() => setModal("assign")}>Assign…</Button>
          <Button onClick={() => setModal("status")}>Change status</Button>
        </>} />
      {own && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This is your own request. Use My HR Requests in the Employee Portal; another HR user will handle it.</p>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          <Card title="Request">
            <p className="whitespace-pre-line text-sm text-slate-800">{r.description}</p>
            {r.resolution && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm"><p className="font-semibold text-emerald-800">Resolution</p><p className="whitespace-pre-line text-emerald-900">{r.resolution}</p></div>}
          </Card>
          <Card title={<span className="inline-flex items-center gap-2"><MessageSquare className="h-4 w-4" aria-hidden="true" />Conversation</span>}>
            {comments.loading && !comments.data ? <Loading /> : comments.error ? <ErrorState message={comments.error} onRetry={comments.reload} /> : <Conversation comments={comments.data} requesterId={r.employee_id} />}
            {canManage && <div className="mt-4"><Composer request={r} onSent={refresh} /></div>}
            {!canManage && !own && <p className="mt-3 text-xs text-slate-500">Read-only: replying needs hr_requests.manage.</p>}
          </Card>
          <HelpdeskFiles request={r} canAdd={canManage && !closed && r.status !== "resolved"} />
        </div>
        <Card title="Details">
          <DescriptionList items={[
            { label: "Requester", value: empText(r.employee) },
            { label: "Assigned to", value: r.assignee ? empText(r.assignee) : "Unassigned" },
            { label: "Created", value: formatDateTime(r.created_at) },
            { label: "SLA due", value: <SlaText request={r} /> },
            { label: "Last activity", value: formatDateTime(r.last_activity_at) },
            r.resolved_at && { label: "Resolved", value: formatDateTime(r.resolved_at) },
            r.closed_at && { label: "Closed", value: formatDateTime(r.closed_at) },
            r.cancelled_at && { label: "Cancelled", value: formatDateTime(r.cancelled_at) },
          ]} />
        </Card>
      </div>
      {modal === "status" && <StatusModal request={r} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === "assign" && <AssignModal request={r} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
    </>
  );
}

function RequestsHome() {
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const canConfigure = ["settings.view", "settings.manage", "hr_requests.manage"].some((p) => hasPermission(p));
  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "inbox", label: "Approval inbox" },
    { value: "all", label: "All requests" },
    ...(canConfigure ? [{ value: "config", label: "Configuration" }] : []),
  ];
  const tab = tabs.some((t) => t.value === params.get("tab")) ? params.get("tab") : "inbox";
  const box = params.get("box") || "assigned";
  const [boxFilters, setBoxFilters] = useState(null);
  const go = (next, extra = {}) => setParams({ tab: next, ...extra }, { replace: true });
  return (
    <>
      <PageHeader title="HR Requests & Approvals"
        description="Letters, profile changes, reimbursements, salary advances, attendance corrections and HR questions. You only see requests routed to you." />
      <Tabs label="Requests" value={tab} onChange={(t) => go(t)} tabs={tabs} />
      {tab === "overview" && <RequestsOverview onOpenBox={(b, f) => { setBoxFilters(f); go("inbox", { box: b }); }} />}
      {tab === "inbox" && <ApprovalInbox initialBox={box} initialFilters={boxFilters} onBoxChange={(b) => go("inbox", { box: b })} />}
      {tab === "all" && <Queue />}
      {tab === "config" && canConfigure && <RequestConfiguration />}
    </>
  );
}

export default function HrRequestsPage() {
  return (
    <Routes>
      <Route index element={<RequestsHome />} />
      <Route path=":id" element={<RequestDetail />} />
    </Routes>
  );
}
