// HR Operations — Helpdesk & Support (/hr/helpdesk/*).
// Overview (queue health, response / resolution times, SLA, satisfaction),
// the ticket queue (quick views + filters) and ticket handling: reply,
// internal notes, assignment, status, re-prioritise / re-categorise, files
// and the full resolution history.
// The server scopes everything (migration 181): hr_requests.manage handles all
// tickets, hr_requests.view reads non-confidential ones, payroll handles
// payroll queries and helpdesk.it (IT Admin) only non-confidential IT tickets.
import { useMemo, useState } from "react";
import { Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clock, History, Inbox, LifeBuoy, MessageSquare, Pencil, Smile, Timer, UserCheck, UserX,
} from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDateTime, useHrQuery } from "@/lib/hr/client";
import { assignRequest, updateRequestStatus } from "@/lib/hr/requests";
import {
  STAFF_STATUS_LABELS, STAFF_TICKET_STATUSES, SUPPORT_AREAS, TICKET_PRIORITIES, TICKET_STATUSES, areaShort, formatHours, getTicket,
  helpdeskQueue, helpdeskSummary, listHelpdeskCategories, ticketAssignees, updateTicket,
} from "@/lib/hr/helpdesk";
import {
  AreaBadge, ConfidentialBadge, RatingStars, ReplyBox, SlaDue, TicketConversation, TicketFiles, TicketHistory, TicketPriorityBadge,
  TicketProgress, TicketStatusBadge,
} from "@/hr/helpdesk/HelpdeskWidgets";
import {
  Badge, Button, Card, DataTable, DescriptionList, EmptyState, ErrorState, Field, InlineError, KpiCard, Loading, Modal,
  PageHeader, SearchInput, Select, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";

const DESK_PERMS = ["hr_requests.manage", "hr_requests.payroll", "helpdesk.it"];
const isoDay = (d) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return isoDay(d); };

// ----------------------------------------------------------------- overview
const PERIODS = [{ value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }];

function Overview({ area, onOpen }) {
  const [period, setPeriod] = useState("30");
  const s = useHrQuery(() => helpdeskSummary({ area, from: daysAgo(Number(period) - 1), to: isoDay(new Date()) }), [area, period]);
  const d = s.data;
  if (s.error) return <ErrorState message={s.error} onRetry={s.reload} />;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Queue now</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Active tickets" value={d?.active} loading={s.loading && !d} icon={Inbox} tone="navy"
            hint={d ? `${d.open} open · ${d.in_progress} in progress · ${d.waiting_on_employee} waiting` : null} onClick={() => onOpen({ view: "active" })} />
          <KpiCard label="Overdue" value={d?.overdue} loading={s.loading && !d} icon={AlertTriangle} tone={d?.overdue ? "red" : "slate"} hint="Past the target response time" onClick={() => onOpen({ view: "overdue" })} />
          <KpiCard label="Unassigned" value={d?.unassigned} loading={s.loading && !d} icon={UserX} tone={d?.unassigned ? "orange" : "slate"} hint="Nobody owns these yet" onClick={() => onOpen({ view: "unassigned" })} />
          <KpiCard label="Assigned to me" value={d?.assigned_to_me} loading={s.loading && !d} icon={UserCheck} tone="teal" hint={d ? `${d.urgent} high or urgent in the queue` : null} onClick={() => onOpen({ view: "mine" })} />
        </div>
      </div>
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Performance</h2>
          <Select aria-label="Period" className="sm:w-44" value={period} onChange={(e) => setPeriod(e.target.value)} options={PERIODS} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Raised / resolved" value={d ? `${d.created} / ${d.resolved}` : null} loading={s.loading && !d} icon={CheckCircle2} tone="green"
            hint={d?.reopened ? `${d.reopened} reopened` : "No reopened tickets"} />
          <KpiCard label="Avg first response" value={d ? formatHours(d.avg_first_response_hours) : null} loading={s.loading && !d} icon={Timer} tone="orange" hint="Raised to first reply" />
          <KpiCard label="Avg resolution" value={d ? formatHours(d.avg_resolution_hours) : null} loading={s.loading && !d} icon={Clock} tone="teal"
            hint={d?.sla_met_percent != null ? `${d.sla_met_percent}% resolved within target` : "No resolved tickets"} />
          <KpiCard label="Satisfaction" value={d ? (d.csat_average != null ? `${d.csat_average} / 5` : "—") : null} loading={s.loading && !d} icon={Smile} tone="navy"
            hint={d ? `${d.csat_count} rating${d.csat_count === 1 ? "" : "s"}` : null} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="By support area">
          <DataTable caption="Tickets by support area" rows={d?.by_area ?? null} loading={s.loading && !d} rowKey="area" pageSize={10}
            emptyTitle="No tickets" onRowClick={(r) => onOpen({ view: "active", area: r.area })}
            columns={[
              { key: "area", header: "Area", render: (r) => <AreaBadge area={r.area} full /> },
              { key: "active", header: "Active", sortable: true },
              { key: "resolved", header: "Resolved in period", sortable: true },
            ]} />
        </Card>
        <Card title="By category">
          <DataTable caption="Tickets by category" rows={d?.by_category ?? null} loading={s.loading && !d} rowKey="category" pageSize={8}
            emptyTitle="No tickets in this period"
            columns={[
              { key: "category", header: "Category", render: (r) => <span className="flex flex-wrap items-center gap-2">{r.category}<AreaBadge area={r.area} /></span> },
              { key: "created", header: "Raised in period", sortable: true },
              { key: "active", header: "Active now", sortable: true },
            ]} />
        </Card>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- queue
const VIEWS = [
  { value: "mine", label: "Assigned to me", filters: { status: "active", assigned: "me" } },
  { value: "unassigned", label: "Unassigned", filters: { status: "active", assigned: "unassigned" } },
  { value: "overdue", label: "Overdue", filters: { status: "active", overdue: true } },
  { value: "active", label: "All active", filters: { status: "active" } },
  { value: "resolved", label: "Resolved", filters: { status: "resolved" } },
  { value: "all", label: "All tickets", filters: { status: "all" } },
];

function Queue({ area, view, onView }) {
  const navigate = useNavigate();
  const [f, setF] = useState({ search: "", status: "", priority: "", category: "" });
  const cats = useHrQuery(() => listHelpdeskCategories(), []);
  const base = (VIEWS.find((v) => v.value === view) ?? VIEWS[3]).filters;
  const filters = { ...base, area, priority: f.priority, category: f.category, search: f.search, ...(f.status ? { status: f.status } : {}) };
  const key = JSON.stringify(filters);
  const list = useHrQuery(() => helpdeskQueue(filters), [key]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: typeof e === "string" ? e : e.target.value }));
  const catOptions = (cats.data ?? []).filter((c) => !area || c.support_area === area).map((c) => ({ value: c.code, label: area ? c.name : `${areaShort(c.support_area)} · ${c.name}` }));
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Quick views">
        {VIEWS.map((v) => (
          <button key={v.value} type="button" aria-pressed={view === v.value} onClick={() => { onView(v.value); setF((s) => ({ ...s, status: "" })); }}
            className={view === v.value
              ? "rounded-full bg-[#101a3a] px-3 py-1 text-sm font-semibold text-white"
              : "rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-50"}>
            {v.label}
          </button>
        ))}
      </div>
      <Toolbar>
        <SearchInput value={f.search} onChange={set("search")} placeholder="Ticket no., subject, employee…" label="Search tickets" />
        <Select aria-label="Status" className="sm:w-44" placeholder="Status (view default)" value={f.status} onChange={set("status")}
          options={TICKET_STATUSES.map((s) => ({ value: s, label: STAFF_STATUS_LABELS[s] }))} />
        <Select aria-label="Priority" className="sm:w-36" placeholder="Any priority" value={f.priority} onChange={set("priority")} options={TICKET_PRIORITIES.map((p) => ({ value: p, label: p }))} />
        <Select aria-label="Category" className="sm:w-52" placeholder="All categories" value={f.category} onChange={set("category")} options={catOptions} />
      </Toolbar>
      <DataTable caption="Support tickets" rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle="No tickets match" emptyDescription={view === "mine" ? "Nothing is assigned to you right now." : "Adjust the view or filters."}
        onRowClick={(t) => navigate(`/hr/helpdesk/${t.id}`)}
        columns={[
          { key: "subject", header: "Ticket", render: (t) => (
            <div className="min-w-[14rem]">
              <p className="font-semibold text-[#101a3a]">{t.subject}{t.is_confidential && <span className="ml-2"><ConfidentialBadge /></span>}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500"><span className="font-mono">{t.ticket_no}</span>· {t.category}{t.reopen_count > 0 && <Badge tone="red">reopened</Badge>}</p>
            </div>) },
          { key: "employee", header: "Requester", render: (t) => <span>{t.employee_name}<span className="block text-xs text-slate-500">{t.employee_code}{t.department ? ` · ${t.department}` : ""}</span></span> },
          { key: "area", header: "Area", render: (t) => <AreaBadge area={t.support_area} /> },
          { key: "priority", header: "Priority", sortable: true, sortValue: (t) => TICKET_PRIORITIES.indexOf(t.priority), render: (t) => <TicketPriorityBadge priority={t.priority} /> },
          { key: "status", header: "Status", render: (t) => <TicketStatusBadge status={t.status} staff /> },
          { key: "assignee", header: "Assigned to", render: (t) => t.assignee_name ?? <span className="text-slate-400">Unassigned</span> },
          { key: "sla_due_at", header: "Response due", sortable: true, render: (t) => <SlaDue ticket={t} /> },
          { key: "last_activity_at", header: "Last activity", sortable: true, render: (t) => formatDateTime(t.last_activity_at) },
        ]} />
    </>
  );
}

// ------------------------------------------------------------------- modals
function StatusModal({ ticket, onClose, onDone }) {
  const { notify } = useToast();
  const [status, setStatus] = useState(ticket.status);
  const [resolution, setResolution] = useState(ticket.resolution ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const needsResolution = status === "resolved" || status === "closed";
  async function submit() {
    if (status === ticket.status && resolution.trim() === (ticket.resolution ?? "").trim()) { setError("Choose a different status or change the resolution."); return; }
    if (needsResolution && !resolution.trim()) { setError("Describe the resolution — the requester sees it."); return; }
    setBusy(true); setError(null);
    const res = await updateRequestStatus(ticket.id, status, needsResolution ? resolution : null);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(`Ticket is now ${STAFF_STATUS_LABELS[status].toLowerCase()}.`);
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Change status" size="md"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Update</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Status" required><Select value={status} onChange={(e) => setStatus(e.target.value)} options={STAFF_TICKET_STATUSES.map((s) => ({ value: s, label: STAFF_STATUS_LABELS[s] }))} /></Field>
        {status === "waiting_on_employee" && <p className="text-xs text-slate-500">Tip: reply in the conversation with what you need. The ticket returns to In progress when the requester answers.</p>}
        {needsResolution && <Field label="Resolution" required hint="Visible to the requester and kept in the resolution history."><Textarea rows={5} value={resolution} maxLength={8000} onChange={(e) => setResolution(e.target.value)} /></Field>}
        {status === "resolved" && <p className="text-xs text-slate-500">The requester is asked to confirm and rate the help, and can reopen within the reopen window.</p>}
        {status === "closed" && <p className="text-xs text-slate-500">Closing skips the requester's confirmation. Closed tickets accept only internal notes until reopened.</p>}
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function AssignModal({ ticket, onClose, onDone }) {
  const { notify } = useToast();
  const opts = useHrQuery(() => ticketAssignees(ticket.id), [ticket.id]);
  const [assignee, setAssignee] = useState(ticket.assigned_to ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if ((assignee || null) === (ticket.assigned_to || null)) { setError("Choose a different assignee."); return; }
    setBusy(true); setError(null);
    const res = await assignRequest(ticket.id, assignee || null);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(assignee ? "Ticket assigned." : "Ticket unassigned.");
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Assign ticket" size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        {opts.loading && !opts.data ? <Loading /> : opts.error ? <InlineError message={opts.error} /> : (
          <Field label="Assignee" hint="Only staff who handle this kind of ticket are listed.">
            <Select placeholder="— Unassigned —" value={assignee} onChange={(e) => setAssignee(e.target.value)}
              options={(opts.data ?? []).map((o) => ({ value: o.id, label: `${o.name}${o.employee_code ? ` (${o.employee_code})` : ""}` }))} />
          </Field>
        )}
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function EditModal({ ticket, onClose, onDone }) {
  const { notify } = useToast();
  const cats = useHrQuery(() => listHelpdeskCategories(), []);
  const [priority, setPriority] = useState(ticket.priority);
  const [category, setCategory] = useState(ticket.category_code);
  const [note, setNote] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const options = (cats.data ?? []).filter((c) => !ticket.is_confidential || c.is_confidential)
    .map((c) => ({ value: c.code, label: `${areaShort(c.support_area)} · ${c.name}${c.is_confidential ? " (confidential)" : ""}` }));
  const target = (cats.data ?? []).find((c) => c.code === category);
  async function submit() {
    if (priority === ticket.priority && category === ticket.category_code) { setError("Change the priority or the category."); return; }
    setBusy(true); setError(null);
    const res = await updateTicket(ticket.id, { priority: priority !== ticket.priority ? priority : null, category: category !== ticket.category_code ? category : null, note });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Ticket updated.");
    onDone(target && target.support_area !== ticket.support_area);
  }
  return (
    <Modal open onClose={onClose} title="Priority and category" size="md"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
      {cats.loading && !cats.data ? <Loading /> : (
        <div className="flex flex-col gap-3">
          <Field label="Priority"><Select value={priority} onChange={(e) => setPriority(e.target.value)} options={TICKET_PRIORITIES.map((p) => ({ value: p, label: p }))} /></Field>
          <Field label="Category" hint={ticket.is_confidential ? "A confidential ticket can only move to another confidential category." : "Move tickets raised under the wrong area, e.g. an IT problem filed as an HR question."}>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} options={options} />
          </Field>
          {target && target.code !== ticket.category_code && target.support_area !== ticket.support_area && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">This moves the ticket to the {SUPPORT_AREAS.find((a) => a.value === target.support_area)?.label} desk. If the current assignee does not handle that desk, the ticket becomes unassigned{target.is_confidential && !ticket.is_confidential ? " and confidential (senior HR only)" : ""}.</p>
          )}
          <Field label="Reason (optional)" hint="Kept in the resolution history."><Textarea rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></Field>
          <InlineError message={error} />
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------- detail
function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hr } = useAuth();
  const { notify } = useToast();
  const me = hr?.employee?.id;
  const q = useHrQuery(() => getTicket(id), [id]);
  const [modal, setModal] = useState(null);
  const [selfAssigning, setSelfAssigning] = useState(false);
  const back = (
    <button type="button" onClick={() => navigate("/hr/helpdesk?tab=tickets")} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Helpdesk queue
    </button>
  );
  if (q.loading && !q.data) return <Loading />;
  if (q.error && /not found/i.test(q.error)) return <>{back}<EmptyState title="Ticket not found" description="It does not exist, or it is not routed to your desk." icon={LifeBuoy} /></>;
  if (q.error) return <>{back}<ErrorState message={q.error} onRetry={q.reload} /></>;
  const t = q.data;
  if (!t) return null;
  const closed = ["closed", "cancelled"].includes(t.status);
  const handle = t.can_handle && !closed;

  async function assignToMe() {
    setSelfAssigning(true);
    const res = await assignRequest(t.id, me);
    setSelfAssigning(false);
    if (res.error) notify(res.error, "error"); else { notify("Ticket assigned to you."); q.reload(); }
  }

  return (
    <>
      {back}
      <PageHeader title={t.subject}
        description={<span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-slate-600">{t.ticket_no}</span><TicketStatusBadge status={t.status} staff /><TicketPriorityBadge priority={t.priority} />
          <AreaBadge area={t.support_area} full /><Badge>{t.category}</Badge>{t.is_confidential && <ConfidentialBadge />}
          {t.overdue && <Badge tone="red">response overdue</Badge>}{t.reopen_count > 0 && <Badge tone="red">reopened ×{t.reopen_count}</Badge>}
        </span>}
        actions={handle && <>
          {me && t.assigned_to !== me && <Button variant="secondary" loading={selfAssigning} onClick={assignToMe}><UserCheck className="h-4 w-4" aria-hidden="true" />Assign to me</Button>}
          <Button variant="secondary" onClick={() => setModal("assign")}>Assign…</Button>
          <Button variant="secondary" onClick={() => setModal("edit")}><Pencil className="h-4 w-4" aria-hidden="true" />Priority / category</Button>
          <Button onClick={() => setModal("status")}>Change status</Button>
        </>} />
      {t.is_requester && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This is your own ticket. Follow it in the Employee Portal under Helpdesk &amp; Support; another staff member will handle it.</p>}
      {!t.can_handle && !t.is_requester && <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">Read-only: you can view this ticket but it is handled by another desk.</p>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <Card title="Progress"><TicketProgress ticket={t} /></Card>
          <Card title="Request">
            <p className="whitespace-pre-line break-words text-sm text-slate-800">{t.description}</p>
            {t.resolution && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm"><p className="font-semibold text-emerald-800">Resolution</p><p className="whitespace-pre-line break-words text-emerald-900">{t.resolution}</p></div>}
          </Card>
          <Card title={<span className="inline-flex items-center gap-2"><MessageSquare className="h-4 w-4" aria-hidden="true" />Conversation</span>}>
            <TicketConversation ticket={t} staffView />
            {!t.is_requester && <ReplyBox ticket={t} staff onSent={q.reload} />}
          </Card>
          <TicketFiles ticket={{ ...t, can_attach: t.can_attach && !t.is_requester }} onChanged={q.reload} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Requester">
            <DescriptionList items={[
              { label: "Name", value: t.employee_name },
              { label: "Employee code", value: t.employee_code },
              { label: "Department", value: t.department },
            ]} />
          </Card>
          <Card title="Details">
            <DescriptionList items={[
              { label: "Assigned to", value: t.assignee_name ?? "Unassigned" },
              { label: "Raised", value: formatDateTime(t.created_at) },
              { label: "Response due", value: <SlaDue ticket={t} /> },
              { label: "Target", value: formatHours(t.sla_hours) },
              { label: "First response", value: t.first_response_at ? `${formatDateTime(t.first_response_at)} (${formatHours((new Date(t.first_response_at) - new Date(t.created_at)) / 3600000)})` : "Not yet" },
              { label: "Last activity", value: formatDateTime(t.last_activity_at) },
              t.resolved_at && { label: "Resolved", value: `${formatDateTime(t.resolved_at)} (${formatHours((new Date(t.resolved_at) - new Date(t.created_at)) / 3600000)})` },
              t.closed_at && { label: "Closed", value: formatDateTime(t.closed_at) },
              t.cancelled_at && { label: "Cancelled", value: formatDateTime(t.cancelled_at) },
            ]} />
          </Card>
          {t.satisfaction_rating && (
            <Card title="Requester feedback">
              <div className="flex flex-col gap-1">
                <RatingStars value={t.satisfaction_rating} />
                {t.satisfaction_comment && <p className="whitespace-pre-line text-sm text-slate-700">{t.satisfaction_comment}</p>}
                <p className="text-xs text-slate-500">Rated {formatDateTime(t.rated_at)}</p>
              </div>
            </Card>
          )}
          <Card title={<span className="inline-flex items-center gap-2"><History className="h-4 w-4" aria-hidden="true" />Resolution history</span>}>
            <TicketHistory events={t.events} staff />
          </Card>
        </div>
      </div>
      {modal === "status" && <StatusModal ticket={t} onClose={() => setModal(null)} onDone={() => { setModal(null); q.reload(); }} />}
      {modal === "assign" && <AssignModal ticket={t} onClose={() => setModal(null)} onDone={() => { setModal(null); q.reload(); }} />}
      {modal === "edit" && <EditModal ticket={t} onClose={() => setModal(null)} onDone={() => { setModal(null); q.reload(); }} />}
    </>
  );
}

// --------------------------------------------------------------------- home
function HelpdeskHome() {
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "tickets" ? "tickets" : "overview";
  const area = SUPPORT_AREAS.some((a) => a.value === params.get("area")) ? params.get("area") : "";
  const desk = DESK_PERMS.some((p) => hasPermission(p));
  const view = VIEWS.some((v) => v.value === params.get("view")) ? params.get("view") : desk ? "mine" : "active";
  const itOnly = hasPermission("helpdesk.it") && !["hr_requests.manage", "hr_requests.view", "hr_requests.payroll"].some((p) => hasPermission(p));
  const go = (next) => setParams((p) => {
    const n = new URLSearchParams(p);
    for (const [k, v] of Object.entries(next)) if (v) n.set(k, v); else n.delete(k);
    return n;
  }, { replace: true });
  const areaTabs = useMemo(() => [{ value: "", label: "All areas" }, ...SUPPORT_AREAS.map((a) => ({ value: a.value, label: a.label }))], []);
  return (
    <>
      <PageHeader title="Helpdesk & Support"
        description={itOnly
          ? "IT support tickets raised by employees: hardware, software, network, email and access. HR and confidential tickets are not shown to the IT desk."
          : "HR support, IT support and workplace issue tickets raised by employees. You see only tickets routed to your desk."} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs label="Helpdesk" value={tab} onChange={(t) => go({ tab: t === "overview" ? "" : t })}
          tabs={[{ value: "overview", label: "Overview" }, { value: "tickets", label: "Tickets" }]} />
        {!itOnly && (
          <div className="mb-4">
            <Select aria-label="Support area" className="sm:w-48" value={area} onChange={(e) => go({ area: e.target.value })} options={areaTabs} />
          </div>
        )}
      </div>
      {tab === "overview" && <Overview area={area} onOpen={(f) => go({ tab: "tickets", view: f.view, area: f.area ?? area })} />}
      {tab === "tickets" && <Queue area={area} view={view} onView={(v) => go({ view: v })} />}
    </>
  );
}

export default function HelpdeskPage() {
  return (
    <Routes>
      <Route index element={<HelpdeskHome />} />
      <Route path=":id" element={<TicketDetail />} />
    </Routes>
  );
}
