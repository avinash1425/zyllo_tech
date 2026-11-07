// Training schedules: sessions (date, time, venue / link, capacity,
// trainer), enrollment (seat or waitlist), roster, attendance marking and
// session close / cancel. Seat counts come from hr_list_training_sessions.
import { useMemo, useState } from "react";
import { CalendarPlus, ClipboardCheck, Pencil, UserPlus, Video } from "lucide-react";
import { formatDate, fullName, useHrQuery } from "@/lib/hr/client";
import { enrollSession, listEnrollments, listSessions, markAttendance, saveSession, setSessionStatus, trainerName, withdrawEnrollment } from "@/lib/hr/training";
import { seatInfo, sessionWhen } from "@/lib/hr/trainingRules";
import { Button, Checkbox, ConfirmDialog, DataTable, ErrorState, Field, InlineError, Input, Loading, Modal, Select, Textarea, Toolbar, useToast } from "@/hr/ui";
import { ActionModal, EmployeePicker, TBadge, courseText, empText, today } from "./shared";

function SessionModal({ session, courses, trainers, onClose, onDone }) {
  const { notify } = useToast();
  const isNew = !session?.id;
  const [v, setV] = useState({
    course_id: session?.course_id ?? "", title: session?.title ?? "", session_date: session?.session_date ?? "", start_time: session?.start_time?.slice(0, 5) ?? "",
    end_time: session?.end_time?.slice(0, 5) ?? "", venue: session?.venue ?? "", meeting_url: session?.meeting_url ?? "", capacity: session?.capacity ?? "",
    trainer_id: session?.trainer_id ?? "", notes: session?.notes ?? "",
  });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <ActionModal title={isNew ? "Schedule a session" : "Edit session"} submitLabel={isNew ? "Schedule" : "Save"} size="lg" onClose={onClose}
      onSubmit={async () => {
        if (!v.course_id) return { error: "Choose a course." };
        if (!v.session_date) return { error: "Choose the session date." };
        if (isNew && v.session_date < today()) return { error: "The session date is in the past." };
        if (v.start_time && v.end_time && v.end_time <= v.start_time) return { error: "The end time must be after the start time." };
        if (!v.venue.trim() && !v.meeting_url.trim()) return { error: "Enter a venue or a meeting link." };
        if (v.meeting_url.trim() && !/^https?:\/\//i.test(v.meeting_url.trim())) return { error: "The meeting link must start with http:// or https://." };
        if (v.capacity !== "" && !(Number(v.capacity) >= 1 && Number(v.capacity) <= 1000)) return { error: "Capacity must be between 1 and 1000 (empty = unlimited)." };
        const res = await saveSession(session?.id, v);
        if (res.error) return res;
        notify(isNew ? "Session scheduled." : "Session updated. Booked employees were notified of changes."); onDone(); return {};
      }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Course" required className="sm:col-span-2">
          <Select placeholder="Choose a course" value={v.course_id} onChange={set("course_id")} disabled={!isNew && session.seats_taken > 0}
            options={(courses ?? []).filter((c) => c.active || c.id === v.course_id).map((c) => ({ value: c.id, label: courseText(c) }))} />
        </Field>
        <Field label="Session title" hint="Optional, e.g. Batch 3"><Input value={v.title} maxLength={200} onChange={set("title")} /></Field>
        <Field label="Date" required><Input type="date" min={isNew ? today() : undefined} value={v.session_date} onChange={set("session_date")} /></Field>
        <Field label="Start time"><Input type="time" value={v.start_time} onChange={set("start_time")} /></Field>
        <Field label="End time"><Input type="time" value={v.end_time} onChange={set("end_time")} /></Field>
        <Field label="Venue" hint="Room / office (Guntur)"><Input value={v.venue} maxLength={200} onChange={set("venue")} /></Field>
        <Field label="Meeting link" hint="https://…"><Input value={v.meeting_url} maxLength={500} onChange={set("meeting_url")} /></Field>
        <Field label="Capacity" hint="Empty = unlimited. Extra enrollments are waitlisted."><Input type="number" min={1} max={1000} value={v.capacity} onChange={set("capacity")} /></Field>
        <Field label="Trainer"><Select placeholder="— None —" value={v.trainer_id} onChange={set("trainer_id")} options={(trainers ?? []).filter((t) => t.active || t.id === v.trainer_id).map((t) => ({ value: t.id, label: trainerName(t) }))} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={v.notes} maxLength={2000} onChange={set("notes")} /></Field>
      </div>
    </ActionModal>
  );
}

function EnrollModal({ session, employees, myEmployeeId, onClose, onDone }) {
  const { notify } = useToast();
  const [list, setList] = useState([]);
  const [due, setDue] = useState("");
  const seats = seatInfo(session.capacity, session.seats_taken);
  return (
    <ActionModal title={`Enroll — ${session.course_title}`} submitLabel="Enroll" size="lg" onClose={onClose}
      onSubmit={async () => {
        if (!list.length) return { error: "Choose at least one employee." };
        const res = await enrollSession(session.id, list, due);
        if (res.error) return res;
        const d = res.data ?? {};
        notify(`${d.enrolled ?? 0} enrolled, ${d.waitlisted ?? 0} waitlisted${d.skipped ? `, ${d.skipped} already booked` : ""}.`); onDone(); return {};
      }}>
      <p className="text-sm text-slate-600">{sessionWhen(session)} · {seats.label}{seats.full ? " — new enrollments are waitlisted" : ""}</p>
      <Field label="Employees" required hint="Employees without an open assignment for this course get one automatically.">
        {() => <EmployeePicker options={employees} value={list} onChange={setList} exclude={myEmployeeId ? [myEmployeeId] : []} />}
      </Field>
      <Field label="Assignment due date" hint="For new assignments; default is the session date."><Input type="date" min={today()} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
    </ActionModal>
  );
}

function RosterModal({ session, canManage, canAssign, myEmployeeId, onClose, onChanged }) {
  const { notify } = useToast();
  const roster = useHrQuery(() => listEnrollments({ session: session.id }), [session.id]);
  const [marks, setMarks] = useState({});
  const [complete, setComplete] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [withdraw, setWithdraw] = useState(null);
  const canMark = canAssign && session.status !== "cancelled" && session.session_date <= today();
  const rows = useMemo(() => (roster.data ?? []).filter((e) => e.status !== "cancelled"), [roster.data]);
  const markable = rows.filter((e) => ["enrolled", "attended", "absent"].includes(e.status) && e.employee_id !== myEmployeeId);
  async function save() {
    const list = Object.entries(marks).map(([enrollment_id, status]) => ({ enrollment_id, status }));
    if (!list.length) { setError("Mark at least one employee."); return; }
    setBusy(true); setError(null);
    const res = await markAttendance(session.id, list, complete);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(`Attendance saved for ${res.data} employee(s).`); setMarks({}); roster.reload(); onChanged();
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title={`Roster — ${session.course_title}`} size="lg"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>{canMark && <Button loading={busy} onClick={save}><ClipboardCheck className="h-4 w-4" aria-hidden="true" />Save attendance</Button>}</>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">{sessionWhen(session)}{session.venue ? ` · ${session.venue}` : ""} · {seatInfo(session.capacity, session.seats_taken).label}{session.waitlisted ? ` · ${session.waitlisted} waitlisted` : ""}</p>
        {!canMark && canAssign && session.status !== "cancelled" && <p className="text-xs text-slate-500">Attendance can be marked on or after {formatDate(session.session_date)}.</p>}
        {roster.loading && !roster.data ? <Loading /> : roster.error ? <ErrorState message={roster.error} onRetry={roster.reload} /> : (
          <DataTable caption="Session roster" rows={rows} pageSize={50} emptyTitle="Nobody booked" emptyDescription={canAssign ? "Use Enroll to book employees." : undefined}
            columns={[
              { key: "employee", header: "Employee", render: (e) => empText(e.employee) },
              { key: "status", header: "Status", render: (e) => <TBadge value={e.status} /> },
              { key: "enrolled_at", header: "Booked", render: (e) => formatDate(e.enrolled_at) },
              ...(canMark ? [{ key: "_m", header: "Attendance", render: (e) => (markable.includes(e) ? (
                <Select aria-label={`Attendance of ${fullName(e.employee)}`} className="w-36" placeholder="—" value={marks[e.id] ?? ""}
                  onChange={(ev) => setMarks((m) => ({ ...m, [e.id]: ev.target.value || undefined }))}
                  options={[{ value: "attended", label: "Attended" }, { value: "absent", label: "Absent" }]} />) : <span className="text-xs text-slate-500">{e.employee_id === myEmployeeId ? "Your own seat" : "—"}</span>) }] : []),
              ...(canAssign ? [{ key: "_w", header: <span className="sr-only">Withdraw</span>, render: (e) => (["enrolled", "waitlisted"].includes(e.status) && e.employee_id !== myEmployeeId && session.status === "scheduled" && session.session_date >= today()
                ? <Button size="sm" variant="ghost" onClick={() => setWithdraw(e)}>Withdraw</Button> : null) }] : []),
            ]} />
        )}
        {canMark && markable.length > 0 && <Checkbox label="Record completion (result 'attended', verified) for employees marked attended" checked={complete} onChange={(e) => setComplete(e.target.checked)} />}
        {canMark && session.course_pass_score != null && <p className="text-xs text-slate-500">This course has an assessment; untick to record results separately.</p>}
        <InlineError message={error} />
        {!canManage && canAssign && <p className="text-xs text-slate-500">You can mark and withdraw only employees in your reporting line.</p>}
      </div>
      {withdraw && <ConfirmDialog open onClose={() => setWithdraw(null)} tone="danger" title="Withdraw seat" requireReason reasonLabel="Reason" confirmLabel="Withdraw"
        message={`${empText(withdraw.employee)} loses this seat; the first waitlisted employee gets it.`}
        onConfirm={async (reason) => { const res = await withdrawEnrollment(withdraw.id, reason); if (!res.error) { notify("Seat withdrawn."); roster.reload(); onChanged(); } return res; }} />}
    </Modal>
  );
}

export default function SessionsTab({ canManage, canAssign, courses, trainers, employees, myEmployeeId }) {
  const { notify } = useToast();
  const [when, setWhen] = useState("upcoming");
  const [modal, setModal] = useState(null);
  const range = when === "upcoming" ? [today(), null] : when === "past" ? [null, today()] : [null, null];
  const list = useHrQuery(() => listSessions(range[0], range[1]), [when]);
  const rows = useMemo(() => {
    const coursePass = new Map((courses ?? []).map((c) => [c.id, c.pass_score]));
    const data = (list.data ?? []).map((s) => ({ ...s, course_pass_score: coursePass.get(s.course_id) ?? null }));
    return when === "past" ? data.reverse() : data;
  }, [list.data, courses, when]);
  const done = () => { setModal(null); list.reload(); };
  // The roster header reads the session's seat / waitlist counts from the
  // latest list data, so a withdraw (which may promote a waitlisted employee)
  // shows the new counts once the list reloads.
  const rosterSession = modal?.type === "roster" ? (list.data ?? []).find((s) => s.id === modal.session.id) ?? modal.session : null;
  return (
    <>
      <Toolbar>
        <Select aria-label="Sessions" className="sm:w-48" value={when} onChange={(e) => setWhen(e.target.value)}
          options={[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }, { value: "all", label: "All" }]} />
        {canManage && <Button onClick={() => setModal({ type: "edit" })}><CalendarPlus className="h-4 w-4" aria-hidden="true" />Schedule session</Button>}
      </Toolbar>
      <DataTable caption="Training sessions" rows={rows} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle="No sessions" emptyDescription={canManage ? "Schedule classroom or online sessions for a course." : "HR schedules training sessions."}
        columns={[
          { key: "session_date", header: "When", sortable: true, render: (s) => <div className="min-w-[8rem]"><p className="font-medium">{formatDate(s.session_date)}</p><p className="text-xs text-slate-500">{sessionWhen(s).slice(11) || "Time TBC"}</p></div> },
          { key: "course", header: "Course", render: (s) => <div className="min-w-[10rem]"><p className="font-medium text-[#101a3a]">{s.course_title}</p><p className="text-xs text-slate-500">{s.course_code}{s.title ? ` · ${s.title}` : ""}</p></div> },
          { key: "venue", header: "Venue / link", render: (s) => <div className="max-w-[14rem] text-sm">{s.venue && <p>{s.venue}</p>}{s.meeting_url && <a href={s.meeting_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#1f4693] hover:underline"><Video className="h-3.5 w-3.5" aria-hidden="true" />Join link</a>}</div> },
          { key: "trainer_name", header: "Trainer", render: (s) => s.trainer_name ?? "—" },
          { key: "seats", header: "Seats", render: (s) => <div><p>{seatInfo(s.capacity, s.seats_taken).label}</p>{s.waitlisted > 0 && <p className="text-xs text-amber-700">{s.waitlisted} waitlisted</p>}{s.attended > 0 && <p className="text-xs text-emerald-700">{s.attended} attended</p>}</div> },
          { key: "status", header: "Status", render: (s) => <div><TBadge value={s.status} />{s.cancel_reason && <p className="mt-1 max-w-[12rem] text-xs text-slate-500">{s.cancel_reason}</p>}</div> },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (s) => (
            <span className="flex flex-wrap gap-1">
              <Button size="sm" variant="secondary" onClick={() => setModal({ type: "roster", session: s })}><ClipboardCheck className="h-4 w-4" aria-hidden="true" />Roster</Button>
              {canAssign && s.status === "scheduled" && s.session_date >= today() && <Button size="sm" variant="secondary" onClick={() => setModal({ type: "enroll", session: s })}><UserPlus className="h-4 w-4" aria-hidden="true" />Enroll</Button>}
              {canManage && s.status === "scheduled" && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "edit", session: s })}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>}
              {canManage && s.status === "scheduled" && s.session_date <= today() && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "close", session: s })}>Close</Button>}
              {canManage && s.status === "scheduled" && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "cancel", session: s })}>Cancel</Button>}
            </span>) },
        ]} />
      {modal?.type === "edit" && <SessionModal session={modal.session} courses={courses} trainers={trainers} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "enroll" && <EnrollModal session={modal.session} employees={employees} myEmployeeId={myEmployeeId} onClose={() => setModal(null)} onDone={done} />}
      {rosterSession && <RosterModal session={rosterSession} canManage={canManage} canAssign={canAssign} myEmployeeId={myEmployeeId} onClose={done} onChanged={list.reload} />}
      <ConfirmDialog open={modal?.type === "close"} onClose={() => setModal(null)} tone="success" title="Close session" confirmLabel="Mark completed"
        message="Mark this session as held. Attendance can still be corrected afterwards."
        onConfirm={async () => { const res = await setSessionStatus(modal.session.id, "completed"); if (!res.error) { notify("Session closed."); done(); } return res; }} />
      <ConfirmDialog open={modal?.type === "cancel"} onClose={() => setModal(null)} tone="danger" title="Cancel session" confirmLabel="Cancel session" requireReason reasonLabel="Reason"
        message="Every booked and waitlisted employee is notified and their seat is released. Their assignments stay open."
        onConfirm={async (reason) => { const res = await setSessionStatus(modal.session.id, "cancelled", reason); if (!res.error) { notify("Session cancelled."); done(); } return res; }} />
    </>
  );
}
