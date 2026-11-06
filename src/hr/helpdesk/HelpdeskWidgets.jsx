// Helpdesk & Support — building blocks shared by the Employee Portal
// (/employee/helpdesk) and HR Operations (/hr/helpdesk): badges, progress,
// conversation, reply box, resolution history, files and rating.
import { useState } from "react";
import { AlertTriangle, Building2, Check, HeartHandshake, Laptop, Lock, Paperclip, Send, Star, StickyNote } from "lucide-react";
import { formatDateTime } from "@/lib/hr/client";
import { commentRequest } from "@/lib/hr/requests";
import {
  STAFF_STATUS_LABELS, TICKET_EVENT_LABELS, TICKET_STATUS_LABELS, areaLabel, areaShort, isTicketOverdue,
} from "@/lib/hr/helpdesk";
import { AttachmentList, FileUploadButton } from "@/hr/requests/RequestWidgets";
import { Badge, Button, Card, Field, InlineError, Textarea, useToast } from "@/hr/ui";

const cx = (...c) => c.filter(Boolean).join(" ");

const STATUS_TONE = { open: "blue", in_progress: "violet", waiting_on_employee: "orange", resolved: "green", closed: "slate", cancelled: "slate" };
export function TicketStatusBadge({ status, staff = false }) {
  const labels = staff ? STAFF_STATUS_LABELS : TICKET_STATUS_LABELS;
  return <Badge tone={STATUS_TONE[status] ?? "slate"}>{labels[status] ?? String(status ?? "—").replace(/_/g, " ")}</Badge>;
}

const PRIORITY_TONE = { low: "slate", medium: "blue", high: "orange", urgent: "red" };
export const TicketPriorityBadge = ({ priority }) => <Badge tone={PRIORITY_TONE[priority] ?? "slate"}>{priority ?? "—"}</Badge>;

export const AREA_ICONS = { hr: HeartHandshake, it: Laptop, workplace: Building2 };
const AREA_TONE = { hr: "orange", it: "blue", workplace: "violet" };
export function AreaBadge({ area, full = false }) {
  const Icon = AREA_ICONS[area];
  return <Badge tone={AREA_TONE[area] ?? "slate"}>{Icon && <Icon className="mr-1 h-3 w-3" aria-hidden="true" />}{full ? areaLabel(area) : areaShort(area)}</Badge>;
}

export const ConfidentialBadge = () => <Badge tone="red"><Lock className="mr-1 h-3 w-3" aria-hidden="true" />confidential</Badge>;

export function SlaDue({ ticket }) {
  if (!ticket?.sla_due_at) return <span className="text-slate-400">—</span>;
  const overdue = isTicketOverdue(ticket);
  return (
    <span className={overdue ? "inline-flex items-center gap-1 font-semibold text-rose-700" : "text-slate-700"}>
      {overdue && <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
      {formatDateTime(ticket.sla_due_at)}{overdue && <span className="ml-1 text-xs">(overdue)</span>}
    </span>
  );
}

/** Raised → Being handled → Resolved → Closed. */
export function TicketProgress({ ticket }) {
  if (ticket.status === "cancelled") return <p className="text-sm text-slate-600">This ticket was cancelled {ticket.cancelled_at ? `on ${formatDateTime(ticket.cancelled_at)}` : ""}.</p>;
  const order = { open: 0, in_progress: 1, waiting_on_employee: 1, resolved: 2, closed: 3 };
  const at = order[ticket.status] ?? 0;
  const steps = [
    { label: "Raised", when: ticket.created_at },
    { label: ticket.status === "waiting_on_employee" ? "Waiting on requester" : "Being handled", when: ticket.first_response_at },
    { label: "Resolved", when: ticket.resolved_at },
    { label: "Closed", when: ticket.closed_at },
  ];
  return (
    <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Ticket progress">
      {steps.map((s, i) => {
        const done = i < at || (i === at && i === 3);
        const current = i === at && i !== 3;
        return (
          <li key={s.label} className="flex items-start gap-2" aria-current={current ? "step" : undefined}>
            <span className={cx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
              done ? "bg-emerald-500 text-white" : current ? "bg-gradient-to-br from-[#f7941e] to-[#f96706] text-white" : "bg-slate-100 text-slate-400")}>
              {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className={cx("block text-sm font-semibold", done || current ? "text-[#101a3a]" : "text-slate-400")}>{s.label}</span>
              {s.when && (done || current) && <span className="block text-xs text-slate-500">{formatDateTime(s.when)}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Conversation. `staffView` labels the requester and marks internal notes. */
export function TicketConversation({ ticket, staffView = false }) {
  const comments = ticket.comments ?? [];
  if (!comments.length) return <p className="text-sm text-slate-600">No messages yet.{staffView ? "" : " The support team will reply here."}</p>;
  return (
    <ol className="flex flex-col gap-3">
      {comments.map((c) => (
        <li key={c.id} className={cx("rounded-xl border px-3 py-2",
          c.is_internal ? "border-dashed border-amber-300 bg-amber-50" : c.from_requester ? "border-slate-200 bg-white" : "border-sky-100 bg-sky-50/60",
          !staffView && c.from_requester && "sm:ml-10", !staffView && !c.from_requester && "sm:mr-10")}>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-[#101a3a]">{c.mine ? "You" : c.author}</span>
            {c.from_requester ? (staffView && <Badge>requester</Badge>) : <Badge tone="blue">support</Badge>}
            {c.is_internal && <Badge tone="amber"><Lock className="mr-1 h-3 w-3" aria-hidden="true" />internal note — not visible to the requester</Badge>}
            <span>{formatDateTime(c.created_at)}</span>
          </div>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-800">{c.body}</p>
        </li>
      ))}
    </ol>
  );
}

/** Reply box. Staff can also add internal notes (allowed even on closed tickets). */
export function ReplyBox({ ticket, staff = false, onSent }) {
  const { notify } = useToast();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const canReply = ticket.can_reply;
  if (!canReply && !(staff && ticket.can_handle)) return null;
  async function send(internal) {
    if (!body.trim()) { setError("Write a message first."); return; }
    if (body.trim().length > 8000) { setError("8000 characters maximum."); return; }
    setBusy(internal ? "note" : "reply"); setError(null);
    const res = await commentRequest(ticket.id, body, internal);
    setBusy(null);
    if (res.error) { setError(res.error); return; }
    setBody("");
    notify(internal ? "Internal note added." : staff ? "Reply sent to the requester." : "Message sent to the support team.");
    onSent?.();
  }
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4">
      <Field label={staff ? "Message" : "Reply"}>
        <Textarea rows={staff ? 4 : 3} value={body} maxLength={8000} onChange={(e) => setBody(e.target.value)}
          placeholder={!canReply ? "Closed: only internal notes can be added." : staff ? "Write a reply or an internal note…" : "Add information or answer the support team…"} />
      </Field>
      <InlineError message={error} />
      <div className="flex flex-wrap justify-end gap-2">
        {staff && ticket.can_handle && <Button variant="secondary" loading={busy === "note"} disabled={Boolean(busy)} onClick={() => send(true)}><StickyNote className="h-4 w-4" aria-hidden="true" />Add internal note</Button>}
        {canReply && <Button loading={busy === "reply"} disabled={Boolean(busy)} onClick={() => send(false)}><Send className="h-4 w-4" aria-hidden="true" />{staff ? "Send reply" : "Send"}</Button>}
      </div>
    </div>
  );
}

const statusName = (s, staff) => (staff ? STAFF_STATUS_LABELS : TICKET_STATUS_LABELS)[s] ?? String(s ?? "").replace(/_/g, " ");

/** Resolution history (hr_request_events). */
export function TicketHistory({ events, staff = false }) {
  if (!events?.length) return <p className="text-sm text-slate-600">No history yet.</p>;
  return (
    <ol className="flex flex-col gap-3 border-l-2 border-slate-100 pl-4">
      {events.map((e) => {
        const change = e.action === "updated" && e.from_status && e.to_status && e.from_status !== e.to_status
          ? `${statusName(e.from_status, staff)} → ${statusName(e.to_status, staff)}` : null;
        const tone = { resolved: "bg-emerald-500", closed: "bg-slate-400", reopened: "bg-rose-500", rated: "bg-amber-400" }[e.action === "updated" ? e.to_status : e.action] ?? "bg-[#f96706]";
        return (
          <li key={e.id} className="relative">
            <span className={cx("absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full", tone)} aria-hidden="true" />
            <p className="text-sm font-semibold text-[#101a3a]">{TICKET_EVENT_LABELS[e.action] ?? String(e.action).replace(/_/g, " ")}{change ? `: ${change}` : ""}</p>
            <p className="text-xs text-slate-500">{e.actor ?? "System"} · {formatDateTime(e.created_at)}</p>
            {e.note && <p className="mt-0.5 whitespace-pre-line break-words text-sm text-slate-700">{e.note}</p>}
          </li>
        );
      })}
    </ol>
  );
}

export function TicketFiles({ ticket, onChanged }) {
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Paperclip className="h-4 w-4" aria-hidden="true" />Files</span>}
      actions={ticket.can_attach && <FileUploadButton requestId={ticket.id} kind="supporting" label="Attach file" onUploaded={onChanged} />}>
      <AttachmentList attachments={ticket.attachments} removable={ticket.can_attach} onChanged={onChanged} />
      {ticket.can_attach && <p className="mt-2 text-xs text-slate-500">PDF, PNG, JPEG or WEBP, up to 10 MB each (10 files per ticket). Screenshots of error messages help.</p>}
    </Card>
  );
}

export function RatingStars({ value, onChange, size = "md", label = "Rating" }) {
  const [hover, setHover] = useState(0);
  const px = size === "sm" ? "h-4 w-4" : "h-7 w-7";
  if (!onChange) {
    return (
      <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5`}>
        {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={cx(px, n <= value ? "fill-amber-400 text-amber-400" : "text-slate-300")} aria-hidden="true" />)}
      </span>
    );
  }
  const words = ["", "Very poor", "Poor", "Okay", "Good", "Excellent"];
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} — ${words[n]}`}
          onMouseEnter={() => setHover(n)} onClick={() => onChange(n)}
          className="rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693]">
          <Star className={cx(px, n <= (hover || value) ? "fill-amber-400 text-amber-400" : "text-slate-300")} aria-hidden="true" />
        </button>
      ))}
      <span className="ml-2 text-sm text-slate-600">{words[hover || value] ?? ""}</span>
    </div>
  );
}
