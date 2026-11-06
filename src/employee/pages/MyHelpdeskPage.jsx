// Employee Portal — Helpdesk & Support (/employee/helpdesk/*).
// Raise HR, IT and workplace tickets, follow their status, talk to the
// support team, attach files, confirm / reopen resolutions and rate the help
// received. Tickets are HR requests with workflow 'helpdesk' (migration 181);
// the server decides who sees and handles each one (IT staff see only
// non-confidential IT tickets; confidential tickets only senior HR).
import { useMemo, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, History, LifeBuoy, Lock, MessageSquare, Plus, Send, Star } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDateTime, useHrQuery } from "@/lib/hr/client";
import { cancelRequest, closeRequest, createRequest, reopenRequest } from "@/lib/hr/requests";
import { uploadRequestFile, checkRequestFile, REQUEST_FILE_ACCEPT } from "@/lib/hr/requestWorkflows";
import {
  ACTIVE_TICKET_STATUSES, SUPPORT_AREAS, TICKET_PRIORITIES, formatHours, getTicket, listHelpdeskCategories, listMyTickets, rateTicket,
} from "@/lib/hr/helpdesk";
import {
  AREA_ICONS, AreaBadge, ConfidentialBadge, RatingStars, ReplyBox, TicketConversation, TicketFiles, TicketHistory, TicketPriorityBadge,
  TicketProgress, TicketStatusBadge,
} from "@/hr/helpdesk/HelpdeskWidgets";
import {
  Button, Card, ConfirmDialog, DataTable, DescriptionList, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal,
  PageHeader, Select, Tabs, Textarea, useToast,
} from "@/hr/ui";

const cx = (...c) => c.filter(Boolean).join(" ");
const MAX_FILES = 3;

// ------------------------------------------------------------- new ticket
function NewTicketModal({ initialArea, initialCategory, onClose, onCreated }) {
  const { notify } = useToast();
  const cats = useHrQuery(() => listHelpdeskCategories(), []);
  const presetArea = initialCategory ? null : initialArea;
  const [v, setV] = useState({ area: presetArea || "", category: initialCategory || "", subject: "", priority: "medium", description: "" });
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const all = cats.data ?? [];
  const cat = all.find((c) => c.code === v.category);
  const area = v.area || cat?.support_area || "";
  const options = all.filter((c) => !area || c.support_area === area);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const pickArea = (a) => setV((s) => ({ ...s, area: a, category: all.find((c) => c.code === s.category)?.support_area === a ? s.category : "" }));

  function addFiles(e) {
    const picked = [...(e.target.files ?? [])];
    e.target.value = "";
    const errs = [];
    const ok = [];
    for (const f of picked) { const chk = checkRequestFile(f); if (chk.error) errs.push(`${f.name}: ${chk.error}`); else ok.push(f); }
    const next = [...files, ...ok].slice(0, MAX_FILES);
    if (files.length + ok.length > MAX_FILES) errs.push(`Up to ${MAX_FILES} files here; add more from the ticket afterwards.`);
    setFiles(next);
    setErrors((s) => ({ ...s, files: errs.join(" ") || undefined }));
  }

  async function submit() {
    const errs = {};
    if (!v.category) errs.category = "Choose what the ticket is about.";
    const subj = v.subject.trim();
    if (subj.length < 3 || subj.length > 200) errs.subject = "Enter a subject (3 to 200 characters).";
    if (!v.description.trim()) errs.description = "Describe the issue.";
    else if (v.description.trim().length > 8000) errs.description = "8000 characters maximum.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await createRequest({ category: v.category, subject: v.subject, description: v.description, priority: v.priority });
    if (res.error) { setBusy(false); setError(res.error); return; }
    const failed = [];
    for (const f of files) {
      const up = await uploadRequestFile(res.data, "supporting", f);
      if (up.error) failed.push(f.name);
    }
    setBusy(false);
    if (failed.length) notify(`Ticket raised, but ${failed.length} file(s) did not upload: ${failed.join(", ")}. Attach them from the ticket.`, "error");
    else notify("Ticket raised. The support team will reply on the ticket.");
    onCreated(res.data);
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title="Raise a support ticket" size="lg"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}><Send className="h-4 w-4" aria-hidden="true" />Raise ticket</Button></>}>
      {cats.loading && !cats.data ? <Loading /> : cats.error ? <ErrorState message={cats.error} onRetry={cats.reload} /> : (
        <div className="flex flex-col gap-4">
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold text-[#101a3a]">Support area</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {SUPPORT_AREAS.map((a) => {
                const Icon = AREA_ICONS[a.value];
                const on = area === a.value;
                return (
                  <button key={a.value} type="button" aria-pressed={on} onClick={() => pickArea(a.value)}
                    className={cx("flex items-start gap-2 rounded-xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693]",
                      on ? "border-[#f96706] bg-orange-50 ring-1 ring-[#f96706]" : "border-slate-200 bg-white hover:border-slate-300")}>
                    <Icon className={cx("mt-0.5 h-5 w-5 shrink-0", on ? "text-[#f96706]" : "text-slate-400")} aria-hidden="true" />
                    <span><span className="block text-sm font-semibold text-[#101a3a]">{a.label}</span><span className="block text-xs text-slate-500">{a.description}</span></span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <Field label="What is it about?" required error={errors.category} hint={cat?.description}>
            <Select placeholder={area ? "Choose a category" : "Choose a support area first, or any category"} value={v.category} onChange={set("category")}
              options={options.map((c) => ({ value: c.code, label: area ? c.name : `${SUPPORT_AREAS.find((a) => a.value === c.support_area)?.short ?? ""} · ${c.name}` }))} />
          </Field>
          {cat?.code === "leave_query" && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">To apply for leave use <Link to="/employee/leave" className="font-semibold underline">My Leave</Link>. Use this ticket only for questions about leave.</p>}
          {cat?.code === "document_request" && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">For letters and certificates use <Link to="/employee/requests" className="font-semibold underline">My HR Requests</Link>.</p>}
          {cat?.is_confidential && <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />Confidential: only senior HR staff can see this ticket. Your manager, colleagues and the IT team cannot.</p>}
          {cat?.code === "workplace_safety" && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">If someone is hurt or in danger right now, call emergency services or alert the people around you first, then raise this ticket.</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Subject" required error={errors.subject} className="sm:col-span-2"><Input value={v.subject} maxLength={200} onChange={set("subject")} placeholder="e.g. Laptop does not connect to office Wi-Fi" /></Field>
            <Field label="Priority" hint="Urgent: you cannot work at all."><Select value={v.priority} onChange={set("priority")} options={TICKET_PRIORITIES.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))} /></Field>
          </div>
          <Field label="Describe the issue" required error={errors.description} hint="What happened, when it started, what you already tried, and any error message.">
            <Textarea rows={6} value={v.description} maxLength={8000} onChange={set("description")} />
          </Field>
          <Field label="Attachments (optional)" error={errors.files}>
            <div className="flex flex-col gap-2">
              {files.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-1.5">
                      <span className="truncate">{f.name}</span>
                      <button type="button" className="text-xs font-semibold text-rose-700 hover:underline" onClick={() => setFiles((s) => s.filter((_, j) => j !== i))}>Remove</button>
                    </li>
                  ))}
                </ul>
              )}
              {files.length < MAX_FILES && (
                <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-semibold text-[#1f4693] hover:bg-slate-50">
                  <input type="file" multiple accept={REQUEST_FILE_ACCEPT} className="sr-only" onChange={addFiles} />
                  <Plus className="h-4 w-4" aria-hidden="true" />Add screenshot or file
                </label>
              )}
            </div>
          </Field>
          {cat && <p className="text-xs text-slate-500">Target response time for {cat.name}: {formatHours(cat.sla_hours)}.</p>}
          <InlineError message={error} />
        </div>
      )}
    </Modal>
  );
}

// -------------------------------------------------------------------- list
const LIST_TABS = [
  { value: "active", label: "Active", match: (t) => ACTIVE_TICKET_STATUSES.includes(t.status) },
  { value: "resolved", label: "Resolved", match: (t) => t.status === "resolved" },
  { value: "closed", label: "Closed", match: (t) => ["closed", "cancelled"].includes(t.status) },
  { value: "all", label: "All", match: () => true },
];

function MyTicketList() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const list = useHrQuery(() => listMyTickets(me), [me]);
  const tab = LIST_TABS.some((t) => t.value === params.get("tab")) ? params.get("tab") : "active";
  const creating = params.get("new") != null;
  const rows = list.data ?? [];
  const counts = useMemo(() => Object.fromEntries(LIST_TABS.map((t) => [t.value, rows.filter(t.match).length])), [rows]);
  const activeByArea = useMemo(() => Object.fromEntries(SUPPORT_AREAS.map((a) => [a.value, rows.filter((t) => t.category?.support_area === a.value && ACTIVE_TICKET_STATUSES.includes(t.status)).length])), [rows]);
  const waiting = rows.filter((t) => t.status === "waiting_on_employee");
  const unrated = rows.filter((t) => t.status === "resolved");
  if (!me) return <ErrorState message="Your account is not linked to an employee record." />;

  const openNew = (area) => setParams((p) => { const n = new URLSearchParams(p); n.set("new", "1"); if (area) n.set("area", area); else n.delete("area"); n.delete("category"); return n; });
  const closeNew = () => setParams((p) => { const n = new URLSearchParams(p); ["new", "area", "category"].forEach((k) => n.delete(k)); return n; }, { replace: true });
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; }, { replace: true });
  const shown = rows.filter((LIST_TABS.find((t) => t.value === tab) ?? LIST_TABS[0]).match);

  return (
    <>
      <PageHeader title="Helpdesk & Support"
        description="Raise HR, IT and workplace tickets, follow their status and talk to the support team. Your manager does not see your tickets."
        actions={<Button onClick={() => openNew("")}><Plus className="h-4 w-4" aria-hidden="true" />Raise a ticket</Button>} />

      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        {SUPPORT_AREAS.map((a) => {
          const Icon = AREA_ICONS[a.value];
          return (
            <button key={a.value} type="button" onClick={() => openNew(a.value)}
              className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-[0_1px_2px_rgba(16,26,58,0.04)] transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e] to-[#f96706] text-white"><Icon className="h-5 w-5" aria-hidden="true" /></span>
              <span className="min-w-0">
                <span className="block font-semibold text-[#101a3a]">{a.label}</span>
                <span className="block text-xs text-slate-500">{a.description}</span>
                <span className="mt-1 block text-xs font-semibold text-[#1f4693] group-hover:underline">
                  Raise a ticket{activeByArea[a.value] ? ` · ${activeByArea[a.value]} active` : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {waiting.length > 0 && (
        <p className="mb-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-900">
          The support team is waiting for your reply on {waiting.length === 1 ? <Link className="font-semibold underline" to={`/employee/helpdesk/${waiting[0].id}`}>{waiting[0].ticket_no}</Link> : `${waiting.length} tickets`}.
        </p>
      )}
      {unrated.length > 0 && tab !== "resolved" && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {unrated.length === 1 ? "1 ticket has" : `${unrated.length} tickets have`} been resolved. Please confirm and rate the help — <button type="button" className="font-semibold underline" onClick={() => setTab("resolved")}>view resolved</button>.
        </p>
      )}

      <Tabs label="My tickets" value={tab} onChange={setTab} tabs={LIST_TABS.map((t) => ({ value: t.value, label: t.label, count: list.data ? counts[t.value] : undefined }))} />
      <DataTable caption="My support tickets" rows={list.data ? shown : null} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle={tab === "active" ? "No active tickets" : "No tickets here"} emptyDescription="Use Raise a ticket to contact HR, IT or the workplace team."
        onRowClick={(t) => navigate(`/employee/helpdesk/${t.id}`)}
        columns={[
          { key: "subject", header: "Ticket", render: (t) => (
            <div className="min-w-[13rem]">
              <p className="font-semibold text-[#101a3a]">{t.subject}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500"><span className="font-mono">{t.ticket_no}</span>· {t.category?.name}{t.is_confidential && <Lock className="h-3 w-3" aria-label="confidential" />}</p>
            </div>) },
          { key: "area", header: "Area", render: (t) => <AreaBadge area={t.category?.support_area} /> },
          { key: "status", header: "Status", render: (t) => <TicketStatusBadge status={t.status} /> },
          { key: "priority", header: "Priority", sortable: true, sortValue: (t) => TICKET_PRIORITIES.indexOf(t.priority), render: (t) => <TicketPriorityBadge priority={t.priority} /> },
          { key: "created_at", header: "Raised", sortable: true, render: (t) => formatDateTime(t.created_at) },
          { key: "last_activity_at", header: "Last update", sortable: true, render: (t) => formatDateTime(t.last_activity_at) },
        ]} />

      {creating && <NewTicketModal initialArea={params.get("area")} initialCategory={params.get("category")} onClose={closeNew}
        onCreated={(id) => { list.reload(); navigate(`/employee/helpdesk/${id}`, { replace: true }); }} />}
    </>
  );
}

// ------------------------------------------------------------------ detail
function CloseAndRateModal({ ticket, onClose, onDone }) {
  const { notify } = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const closing = ticket.can_close;
  async function submit() {
    if (!closing && !rating) { setError("Choose a rating."); return; }
    setBusy(true); setError(null);
    if (closing) {
      const res = await closeRequest(ticket.id);
      if (res.error) { setBusy(false); setError(res.error); return; }
    }
    if (rating) {
      const res = await rateTicket(ticket.id, rating, comment);
      if (res.error) { setBusy(false); setError(closing ? `Ticket closed, but the rating was not saved: ${res.error}` : res.error); if (closing) onDone(); return; }
    }
    setBusy(false);
    notify(closing ? (rating ? "Ticket closed. Thank you for the feedback." : "Ticket closed.") : "Thank you for the feedback.");
    onDone();
  }
  return (
    <Modal open onClose={onClose} title={closing ? "Confirm the resolution" : "Rate the support"} size="md"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button variant={closing ? "success" : "primary"} loading={busy} onClick={submit}>{closing ? "Close ticket" : "Submit rating"}</Button></>}>
      <div className="flex flex-col gap-4">
        {closing && <p className="text-sm text-slate-600">Closing confirms the issue is solved. You can still reopen it within {ticket.reopen_window_days} days of the resolution.</p>}
        <Field label={closing ? "How was the support? (optional)" : "How was the support?"}><RatingStars value={rating} onChange={setRating} label="Support rating" /></Field>
        <Field label="Comment (optional)"><Textarea rows={3} value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} placeholder="What went well, or what could be better?" /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function MyTicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { notify } = useToast();
  const q = useHrQuery(() => getTicket(id), [id]);
  const [dialog, setDialog] = useState(null);
  if (q.loading && !q.data) return <Loading />;
  const back = (
    <button type="button" onClick={() => navigate("/employee/helpdesk")} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> My tickets
    </button>
  );
  if (q.error && /not found/i.test(q.error)) return <>{back}<EmptyState title="Ticket not found" description="It does not exist or it is not yours." icon={LifeBuoy} /></>;
  if (q.error) return <>{back}<ErrorState message={q.error} onRetry={q.reload} /></>;
  const t = q.data;
  if (!t) return null;

  return (
    <>
      {back}
      <PageHeader title={t.subject}
        description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm text-slate-600">{t.ticket_no}</span><TicketStatusBadge status={t.status} /><TicketPriorityBadge priority={t.priority} /><AreaBadge area={t.support_area} full />{t.is_confidential && <ConfidentialBadge />}</span>}
        actions={<>
          {t.can_cancel && <Button variant="secondary" onClick={() => setDialog("cancel")}>Cancel ticket</Button>}
          {t.can_reopen && <Button variant="secondary" onClick={() => setDialog("reopen")}>Reopen</Button>}
          {t.can_close && <Button variant="success" onClick={() => setDialog("close")}>Confirm &amp; close</Button>}
        </>} />

      {t.status === "waiting_on_employee" && <p className="mb-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-900">The support team needs more information from you. Reply in the conversation below.</p>}
      {t.status === "resolved" && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">The support team has resolved this ticket. If that fixed it, confirm and close; if not, reopen it within {t.reopen_window_days} days.</p>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <Card title="Progress"><TicketProgress ticket={t} /></Card>
          <Card title="Your ticket">
            <p className="whitespace-pre-line break-words text-sm text-slate-800">{t.description}</p>
            {t.resolution && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm"><p className="font-semibold text-emerald-800">Resolution</p><p className="whitespace-pre-line break-words text-emerald-900">{t.resolution}</p></div>}
          </Card>
          <Card title={<span className="inline-flex items-center gap-2"><MessageSquare className="h-4 w-4" aria-hidden="true" />Conversation</span>}>
            <TicketConversation ticket={t} />
            <ReplyBox ticket={t} onSent={q.reload} />
            {!t.can_reply && <p className="mt-3 text-xs text-slate-500">This ticket is {t.status}.{t.can_reopen ? " Reopen it to continue the conversation." : ""}</p>}
          </Card>
          <TicketFiles ticket={t} onChanged={q.reload} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Details">
            <DescriptionList items={[
              { label: "Ticket", value: <span className="font-mono">{t.ticket_no}</span> },
              { label: "Category", value: t.category },
              { label: "Raised", value: formatDateTime(t.created_at) },
              { label: "Handled by", value: t.assignee_name ?? "Awaiting assignment" },
              { label: "Target response", value: formatHours(t.sla_hours) },
              { label: "First response", value: t.first_response_at ? formatDateTime(t.first_response_at) : "—" },
              { label: "Last update", value: formatDateTime(t.last_activity_at) },
              t.resolved_at && { label: "Resolved", value: formatDateTime(t.resolved_at) },
              t.closed_at && { label: "Closed", value: formatDateTime(t.closed_at) },
              t.reopen_count > 0 && { label: "Reopened", value: `${t.reopen_count} time${t.reopen_count === 1 ? "" : "s"}` },
            ]} />
          </Card>
          {(t.satisfaction_rating || t.can_rate) && (
            <Card title={<span className="inline-flex items-center gap-2"><Star className="h-4 w-4" aria-hidden="true" />Your feedback</span>}>
              {t.satisfaction_rating ? (
                <div className="flex flex-col gap-1">
                  <RatingStars value={t.satisfaction_rating} />
                  {t.satisfaction_comment && <p className="whitespace-pre-line text-sm text-slate-700">{t.satisfaction_comment}</p>}
                  <p className="text-xs text-slate-500">Rated {formatDateTime(t.rated_at)}</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-slate-600">How did the support team do on this ticket?</p>
                  <div><Button size="sm" variant="secondary" onClick={() => setDialog(t.can_close ? "close" : "rate")}>Rate the support</Button></div>
                </div>
              )}
            </Card>
          )}
          <Card title={<span className="inline-flex items-center gap-2"><History className="h-4 w-4" aria-hidden="true" />Resolution history</span>}>
            <TicketHistory events={t.events} />
          </Card>
        </div>
      </div>

      {(dialog === "close" || dialog === "rate") && <CloseAndRateModal ticket={t} onClose={() => setDialog(null)} onDone={() => { setDialog(null); q.reload(); }} />}
      <ConfirmDialog open={dialog === "cancel"} onClose={() => setDialog(null)} tone="danger" title="Cancel ticket"
        message="Cancel this ticket? The support team will stop working on it." confirmLabel="Cancel ticket"
        onConfirm={async () => { const res = await cancelRequest(t.id); if (!res.error) { notify("Ticket cancelled."); q.reload(); } return res; }} />
      <ConfirmDialog open={dialog === "reopen"} onClose={() => setDialog(null)} title="Reopen ticket"
        message="Tell the support team what is still not working." confirmLabel="Reopen" requireReason={false} reasonLabel="What is still wrong? (optional)"
        onConfirm={async (reason) => { const res = await reopenRequest(t.id, reason); if (!res.error) { notify("Ticket reopened."); q.reload(); } return res; }} />
    </>
  );
}

export default function MyHelpdeskPage() {
  return (
    <Routes>
      <Route index element={<MyTicketList />} />
      <Route path=":id" element={<MyTicketDetail />} />
    </Routes>
  );
}
