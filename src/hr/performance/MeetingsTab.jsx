// Review meetings: schedule (date/time, duration, mode, attendees, agenda),
// record notes + action items, cancel. The employee sees their meetings and
// notes in the portal; attendees see the meetings they are invited to.
import { useMemo, useState } from "react";
import { CalendarPlus, CheckCircle2, Pencil, XCircle } from "lucide-react";
import { formatDateTime, useHrQuery } from "@/lib/hr/client";
import { cancelMeeting, completeMeeting, listMeetings, listReviews, saveMeeting } from "@/lib/hr/performance";
import { MEETING_MODES, MEETING_TYPES, label } from "@/lib/hr/performanceRules";
import { Button, ConfirmDialog, DataTable, DescriptionList, Field, Input, Modal, Select, Textarea, Toolbar, useToast } from "@/hr/ui";
import { ActionModal, PerfBadge, TextBlock, opts } from "./shared";

const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function MeetingForm({ ctx, meeting, onClose, onSaved }) {
  const isNew = !meeting?.id;
  const [v, setV] = useState({
    employee_id: meeting?.employee_id ?? "", review_id: meeting?.review_id ?? "", meeting_type: meeting?.meeting_type ?? "review",
    scheduled_at: toLocalInput(meeting?.scheduled_at), duration_minutes: meeting?.duration_minutes ?? 30, mode: meeting?.mode ?? "in_person",
    location: meeting?.location ?? "", agenda: meeting?.agenda ?? "", attendee_ids: meeting?.attendee_ids ?? [],
  });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const reviews = useHrQuery(() => (v.employee_id ? listReviews({ employee: v.employee_id }) : Promise.resolve({ data: [] })), [v.employee_id]);
  const attendeeChoices = ctx.employees.filter((e) => e.id !== v.employee_id).map((e) => ({ value: e.id, label: `${e.display_name || `${e.first_name} ${e.last_name}`.trim()} (${e.employee_code})` }));
  const toggle = (id) => setV((s) => ({ ...s, attendee_ids: s.attendee_ids.includes(id) ? s.attendee_ids.filter((x) => x !== id) : [...s.attendee_ids, id] }));
  return (
    <ActionModal title={isNew ? "Schedule review meeting" : "Edit meeting"} size="lg" submitLabel={isNew ? "Schedule" : "Save"} onClose={onClose}
      onSubmit={async () => {
        if (!v.employee_id) return { error: "Choose the employee." };
        if (!v.scheduled_at) return { error: "Choose the date and time." };
        const d = Number(v.duration_minutes);
        if (!(d >= 5 && d <= 480)) return { error: "Duration must be 5–480 minutes." };
        const res = await saveMeeting(v, meeting?.id);
        if (res.error) return res;
        onSaved(isNew); return {};
      }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Employee" required><Select placeholder="Choose an employee" value={v.employee_id} disabled={!isNew}
          onChange={(e) => setV((s) => ({ ...s, employee_id: e.target.value, review_id: "" }))} options={ctx.manageableOptions} /></Field>
        <Field label="Linked review" hint="Optional"><Select placeholder="— None —" value={v.review_id} onChange={set("review_id")}
          options={(reviews.data ?? []).map((r) => ({ value: r.id, label: `${r.cycle?.name ?? "Review"} · ${label(r.status)}` }))} /></Field>
        <Field label="Meeting type"><Select value={v.meeting_type} onChange={set("meeting_type")} options={opts(MEETING_TYPES)} /></Field>
        <Field label="Date and time" required><Input type="datetime-local" value={v.scheduled_at} onChange={set("scheduled_at")} /></Field>
        <Field label="Duration (minutes)"><Input type="number" min={5} max={480} step={5} value={v.duration_minutes} onChange={set("duration_minutes")} /></Field>
        <Field label="Mode"><Select value={v.mode} onChange={set("mode")} options={opts(MEETING_MODES)} /></Field>
        <Field label="Location / link" className="sm:col-span-2"><Input value={v.location} maxLength={300} onChange={set("location")} /></Field>
        <Field label="Agenda" className="sm:col-span-2"><Textarea value={v.agenda} maxLength={4000} onChange={set("agenda")} /></Field>
      </div>
      <fieldset className="rounded-xl border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold text-[#173a52]">Other attendees ({v.attendee_ids.length})</legend>
        <p className="mb-2 text-xs text-slate-500">The employee always attends. Add the manager, HR partner or others (max 20). Attendees are notified.</p>
        <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
          {attendeeChoices.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
              <input type="checkbox" checked={v.attendee_ids.includes(o.value)} onChange={() => toggle(o.value)} className="h-4 w-4 rounded border-slate-300 text-[#f96706]" />
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </ActionModal>
  );
}

export function MeetingDetail({ meeting, onClose, actions }) {
  return (
    <Modal open onClose={onClose} size="lg" title={`${label(meeting.meeting_type).replace(/^./, (c) => c.toUpperCase())} meeting · ${meeting.employee_name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button>{actions}</>}>
      <div className="flex flex-col gap-4">
        <DescriptionList items={[
          { label: "When", value: `${formatDateTime(meeting.scheduled_at)} · ${meeting.duration_minutes} min` },
          { label: "Status", value: <PerfBadge value={meeting.status} /> },
          { label: "Mode", value: `${label(meeting.mode)}${meeting.location ? ` — ${meeting.location}` : ""}` },
          { label: "Cycle", value: meeting.cycle_name },
          { label: "Organiser", value: meeting.organizer_name },
          { label: "Attendees", value: [meeting.employee_name, ...(meeting.attendees ?? []).map((a) => a.name)].join(", ") },
          meeting.cancel_reason && { label: "Cancelled because", value: meeting.cancel_reason },
        ]} />
        <div><p className="mb-1 text-sm font-semibold text-[#173a52]">Agenda</p><TextBlock>{meeting.agenda}</TextBlock></div>
        <div><p className="mb-1 text-sm font-semibold text-[#173a52]">Notes</p><TextBlock empty="No notes yet.">{meeting.notes}</TextBlock></div>
        {meeting.action_items && <div><p className="mb-1 text-sm font-semibold text-[#173a52]">Action items</p><TextBlock>{meeting.action_items}</TextBlock></div>}
      </div>
    </Modal>
  );
}

export default function MeetingsTab({ ctx }) {
  const { notify } = useToast();
  const meetings = useHrQuery(() => listMeetings(), []);
  const [status, setStatus] = useState("scheduled");
  const [modal, setModal] = useState(null);
  const [notes, setNotes] = useState({ notes: "", action_items: "" });
  const rows = useMemo(() => (meetings.data ?? []).filter((m) => m.employee_id !== ctx.me || (m.attendee_ids ?? []).includes(ctx.me))
    .filter((m) => !status || m.status === status), [meetings.data, status, ctx.me]);
  const close = () => setModal(null);
  const done = (msg) => { notify(msg); close(); meetings.reload(); };
  return (
    <>
      <Toolbar>
        <Field label="Status" className="min-w-[12rem]"><Select placeholder="All" value={status} onChange={(e) => setStatus(e.target.value)} options={opts(["scheduled", "completed", "cancelled"])} /></Field>
        {ctx.manageableOptions.length > 0 && <div className="flex items-end sm:ml-auto"><Button onClick={() => setModal({ type: "form" })}><CalendarPlus className="h-4 w-4" aria-hidden="true" />Schedule meeting</Button></div>}
      </Toolbar>
      <DataTable caption="Review meetings" rows={meetings.data ? rows : null} loading={meetings.loading} error={meetings.error} onRetry={meetings.reload}
        onRowClick={(m) => setModal({ type: "detail", row: m })} emptyTitle="No meetings"
        columns={[
          { key: "scheduled_at", header: "When", sortable: true, render: (m) => formatDateTime(m.scheduled_at) },
          { key: "employee_name", header: "Employee", sortable: true, render: (m) => <span className="font-semibold text-[#101a3a]">{m.employee_name}</span> },
          { key: "meeting_type", header: "Type", render: (m) => label(m.meeting_type) },
          { key: "attendees", header: "Attendees", render: (m) => (m.attendees ?? []).map((a) => a.name).join(", ") || "—" },
          { key: "status", header: "Status", render: (m) => <PerfBadge value={m.status} /> },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (m) => m.can_manage && m.status !== "cancelled" ? (
            <span className="flex gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
              {m.status === "scheduled" && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "form", row: m })} aria-label="Edit meeting"><Pencil className="h-4 w-4" aria-hidden="true" /></Button>}
              <Button size="sm" variant="ghost" onClick={() => { setNotes({ notes: m.notes ?? "", action_items: m.action_items ?? "" }); setModal({ type: "notes", row: m }); }}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{m.status === "completed" ? "Edit notes" : "Record notes"}</Button>
              {m.status === "scheduled" && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "cancel", row: m })} aria-label="Cancel meeting"><XCircle className="h-4 w-4" aria-hidden="true" /></Button>}
            </span>) : null },
        ]} />
      {modal?.type === "form" && <MeetingForm ctx={ctx} meeting={modal.row} onClose={close} onSaved={(n) => done(n ? "Meeting scheduled. The employee and attendees were notified." : "Meeting updated.")} />}
      {modal?.type === "detail" && <MeetingDetail meeting={modal.row} onClose={close} />}
      {modal?.type === "notes" && (
        <ActionModal title={`Meeting notes · ${modal.row.employee_name}`} size="lg" submitLabel="Save and complete" onClose={close}
          onSubmit={async () => {
            if (!notes.notes.trim()) return { error: "Write the meeting notes." };
            const res = await completeMeeting(modal.row.id, notes.notes, notes.action_items);
            if (res.error) return res;
            done("Meeting notes saved. The employee can read them in their portal."); return {};
          }}>
          <Field label="Notes" required hint="Shared with the employee."><Textarea rows={7} value={notes.notes} maxLength={10000} onChange={(e) => setNotes({ ...notes, notes: e.target.value })} /></Field>
          <Field label="Action items"><Textarea rows={3} value={notes.action_items} maxLength={4000} onChange={(e) => setNotes({ ...notes, action_items: e.target.value })} /></Field>
        </ActionModal>
      )}
      <ConfirmDialog open={modal?.type === "cancel"} onClose={close} title="Cancel meeting?" tone="danger" confirmLabel="Cancel meeting" requireReason={false} reasonLabel="Reason (optional)"
        onConfirm={async (reason) => { const res = await cancelMeeting(modal.row.id, reason); if (res.error) return res; done("Meeting cancelled."); return {}; }} />
    </>
  );
}
