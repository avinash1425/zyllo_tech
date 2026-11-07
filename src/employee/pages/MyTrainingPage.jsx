// Employee Portal — My Training: assigned courses (start, submit completion
// with evidence for HR / manager verification), my sessions and booking,
// certificates with expiry, and history. RLS limits every query to the
// employee's own records; induction training linked from onboarding shows
// up here like any other assignment.
import { useMemo, useState } from "react";
import { Award, BookOpen, CalendarClock, CheckCircle2, ExternalLink, PlayCircle, Send, Video } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { RESULTS, listMyAssignments, listSessions, selfEnroll, startTraining, submitCompletion, withdrawEnrollment } from "@/lib/hr/training";
import { allowedActions, certificateExpiry, isOpen, isOverdueOn, isPendingVerification, latestCompletions, seatInfo, sessionWhen } from "@/lib/hr/trainingRules";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, Input, Loading, PageHeader, Select, Tabs, Textarea, useToast } from "@/hr/ui";
import { ActionModal, AssignmentStatus, CertificateBadge, DocButton, FileField, TBadge, assignmentDueText, label, opts, today, uploadTrainingFile } from "@/hr/training/shared";

function SubmitModal({ row, me, onClose, onDone }) {
  const { notify } = useToast();
  const c = row.course ?? {};
  const [v, setV] = useState({ completion_date: today(), result: c.pass_score != null || c.certificate_required ? "passed" : "attended", score: "", evidence_note: "", certificate_number: "" });
  const [evidence, setEvidence] = useState(null);
  const [cert, setCert] = useState(null);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const exp = certificateExpiry(v.completion_date, c.validity_months, v.result);
  const needsCert = c.certificate_required && v.result === "passed";
  return (
    <ActionModal title={`Submit completion — ${c.title ?? "training"}`} submitLabel="Submit for verification" size="md" onClose={onClose}
      onSubmit={async () => {
        if (!v.completion_date || v.completion_date > today()) return { error: "Enter a completion date that is not in the future." };
        if (v.score !== "" && !(Number(v.score) >= 0 && Number(v.score) <= 100)) return { error: "The score must be between 0 and 100." };
        if (c.pass_score != null && v.result === "passed" && v.score !== "" && Number(v.score) < Number(c.pass_score)) return { error: `The score is below the pass mark of ${c.pass_score}.` };
        if (needsCert && !cert) return { error: "This course requires a certificate: attach the certificate file." };
        if (!v.evidence_note.trim() && !evidence && !cert) return { error: "Add evidence: a short note, a file or the certificate." };
        const ev = await uploadTrainingFile(me, evidence, `${c.title} — completion evidence`);
        if (ev.error && !ev.id) return { error: ev.error };
        const ce = await uploadTrainingFile(me, cert, `${c.title} certificate`);
        if (ce.error && !ce.id) return { error: ce.error };
        const res = await submitCompletion(row.id, { ...v, evidence_document_id: ev.id, certificate_document_id: ce.id });
        if (res.error) return res;
        notify("Submitted. HR or your manager will verify it."); onDone(); return {};
      }}>
      <p className="text-sm text-slate-600">Your manager or HR verifies this before it counts as completed{c.pass_score != null ? `; pass mark ${c.pass_score}%` : ""}.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Completed on" required><Input type="date" max={today()} value={v.completion_date} onChange={set("completion_date")} /></Field>
        <Field label="Result" required><Select value={v.result} onChange={set("result")} options={opts(RESULTS)} /></Field>
        <Field label="Score (%)" hint="If assessed"><Input type="number" min={0} max={100} step="0.01" value={v.score} onChange={set("score")} /></Field>
      </div>
      <Field label="What did you complete?" hint="e.g. finished all modules and the quiz on the LMS"><Textarea value={v.evidence_note} maxLength={2000} onChange={set("evidence_note")} /></Field>
      <FileField label="Evidence file (optional)" hint="Screenshot or completion report; saved to My Documents." onChange={setEvidence} />
      <FileField label={needsCert ? "Certificate (required)" : "Certificate (optional)"} required={needsCert} hint="Saved to My Documents as a training certificate." onChange={setCert} />
      <Field label="Certificate number"><Input value={v.certificate_number} maxLength={80} onChange={set("certificate_number")} /></Field>
      {exp && <p className="text-xs text-slate-500">If verified, this is valid until {formatDate(exp)} ({c.validity_months} months).</p>}
    </ActionModal>
  );
}

function CourseCard({ row, onAction }) {
  const c = row.course ?? {};
  const acts = allowedActions(row, { isSelf: true });
  const returned = row.status === "in_progress" && row.review_note && row.reviewed_at && !row.submitted_at;
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold text-[#101a3a]">{c.title}</p>
            <p className="text-xs text-slate-500">{c.code} · {label(c.delivery_mode)}{c.duration_hours ? ` · ${c.duration_hours} h` : ""}{c.provider ? ` · ${c.provider}` : ""}</p>
          </div>
          <span className="flex flex-wrap gap-1">{c.is_mandatory && <Badge tone="orange">mandatory</Badge>}{row.source === "onboarding" && <Badge tone="blue">induction</Badge>}{row.source === "renewal" && <Badge tone="amber">recertification</Badge>}<AssignmentStatus row={row} /></span>
        </div>
        {c.description && <p className="line-clamp-3 text-sm text-slate-600">{c.description}</p>}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Due</p>{assignmentDueText(row)}</div>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned</p>{formatDate(row.assigned_at)}</div>
        </div>
        {returned && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900"><strong>Returned:</strong> {row.review_note}</p>}
        {isPendingVerification(row) && <p className="rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-900">Submitted {formatDate(row.submitted_at)} — waiting for HR / manager verification.</p>}
        <div className="flex flex-wrap gap-2">
          {c.content_url && <a href={c.content_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-[#173a52] hover:bg-slate-50"><ExternalLink className="h-4 w-4" aria-hidden="true" />Open course</a>}
          {acts.includes("start") && <Button size="sm" variant="secondary" onClick={() => onAction("start", row)}><PlayCircle className="h-4 w-4" aria-hidden="true" />Mark started</Button>}
          {acts.includes("submit") && <Button size="sm" onClick={() => onAction("submit", row)}><Send className="h-4 w-4" aria-hidden="true" />Submit completion</Button>}
          {isOpen(row) && <Button size="sm" variant="ghost" onClick={() => onAction("sessions", row)}><CalendarClock className="h-4 w-4" aria-hidden="true" />Sessions</Button>}
        </div>
      </div>
    </Card>
  );
}

export default function MyTrainingPage() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const { notify } = useToast();
  const [tab, setTab] = useState("assigned");
  const [modal, setModal] = useState(null);
  const asg = useHrQuery(() => listMyAssignments(me), [me]);
  const ses = useHrQuery(() => (me ? listSessions(null, null) : Promise.resolve({ data: [] })), [me]);
  const t = today();
  const rows = useMemo(() => asg.data ?? [], [asg.data]);
  const current = rows.filter((a) => isOpen(a) || isPendingVerification(a));
  const history = rows.filter((a) => !isOpen(a) && !isPendingVerification(a));
  const certs = useMemo(() => latestCompletions(rows.filter((a) => a.verified_at)).filter((a) => a.certificate_expiry || a.certificate || a.certificate_number), [rows]);
  const mySessions = (ses.data ?? []).filter((s) => s.my_status);
  const bookable = (ses.data ?? []).filter((s) => !s.my_status && s.my_assignment_open && s.status === "scheduled" && s.session_date >= t);
  const reload = () => { asg.reload(); ses.reload(); };

  async function onAction(type, row) {
    if (type === "submit") { setModal({ type, row }); return; }
    if (type === "sessions") { setTab("schedule"); return; }
    if (type === "start") {
      const res = await startTraining(row.id);
      if (res.error) notify(res.error, "error"); else { notify("Marked as started."); reload(); }
    }
  }
  async function book(s) {
    const res = await selfEnroll(s.id);
    if (res.error) notify(res.error, "error"); else { notify(res.data === "waitlisted" ? "The session is full: you are on the waitlist." : "Seat booked."); ses.reload(); }
  }

  if (!me) return <ErrorState message="Your account is not linked to an employee record." />;
  const overdue = current.filter((a) => isOverdueOn(a, t)).length;

  return (
    <>
      <PageHeader title="My Training" description="Training assigned to you, your sessions, certificates and history. Submit completions here; HR or your manager verifies them." />
      {overdue > 0 && <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">{overdue} training item(s) are overdue.</p>}
      <Tabs value={tab} onChange={setTab} label="My training sections" tabs={[
        { value: "assigned", label: "Assigned to me", count: asg.data ? current.length : undefined },
        { value: "schedule", label: "Schedule", count: ses.data ? mySessions.filter((s) => s.session_date >= t && ["enrolled", "waitlisted"].includes(s.my_status)).length : undefined },
        { value: "certificates", label: "Certificates", count: asg.data ? certs.length : undefined },
        { value: "history", label: "History" },
      ]} />

      {tab === "assigned" && (asg.loading && !asg.data ? <Loading /> : asg.error ? <ErrorState message={asg.error} onRetry={asg.reload} /> : !current.length ? (
        <Card><EmptyState icon={BookOpen} title="No training assigned" description="Courses HR or your manager assigns to you (including induction training) appear here." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{current.map((a) => <CourseCard key={a.id} row={a} onAction={onAction} />)}</div>
      ))}

      {tab === "schedule" && (ses.loading && !ses.data ? <Loading /> : ses.error ? <ErrorState message={ses.error} onRetry={ses.reload} /> : (
        <div className="flex flex-col gap-4">
          <DataTable caption="My sessions" rows={[...mySessions].sort((a, b) => (a.session_date < b.session_date ? 1 : -1))} emptyTitle="No sessions booked" emptyDescription="Sessions you are booked on appear here."
            columns={[
              { key: "when", header: "When", render: (s) => <div><p className="font-medium">{formatDate(s.session_date)}</p><p className="text-xs text-slate-500">{sessionWhen(s).slice(11) || "Time TBC"}</p></div> },
              { key: "course", header: "Course", render: (s) => <div><p className="font-medium text-[#101a3a]">{s.course_title}</p>{s.trainer_name && <p className="text-xs text-slate-500">Trainer: {s.trainer_name}</p>}</div> },
              { key: "venue", header: "Venue / link", render: (s) => <div className="text-sm">{s.venue && <p>{s.venue}</p>}{s.meeting_url && ["enrolled"].includes(s.my_status) && s.status === "scheduled" && <a href={s.meeting_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#1f4693] hover:underline"><Video className="h-3.5 w-3.5" aria-hidden="true" />Join</a>}</div> },
              { key: "status", header: "Status", render: (s) => <span className="flex flex-col gap-1"><TBadge value={s.my_status} />{s.status !== "scheduled" && <TBadge value={s.status} />}</span> },
              { key: "_a", header: <span className="sr-only">Actions</span>, render: (s) => (["enrolled", "waitlisted"].includes(s.my_status) && s.status === "scheduled" && s.session_date >= t
                ? <Button size="sm" variant="ghost" onClick={() => setModal({ type: "withdraw", session: s })}>Withdraw</Button> : null) },
            ]} />
          <Card title="Sessions you can book">
            {!bookable.length ? <p className="text-sm text-slate-500">No open sessions for the courses assigned to you.</p> : (
              <ul className="flex flex-col divide-y divide-slate-100">
                {bookable.map((s) => {
                  const seats = seatInfo(s.capacity, s.seats_taken);
                  return (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <div className="min-w-0"><p className="font-medium text-[#101a3a]">{s.course_title}{s.title ? ` · ${s.title}` : ""}</p>
                        <p className="text-xs text-slate-500">{sessionWhen(s)}{s.venue ? ` · ${s.venue}` : s.meeting_url ? " · online" : ""} · {seats.label}</p></div>
                      <Button size="sm" variant={seats.full ? "secondary" : "primary"} onClick={() => book(s)}>{seats.full ? "Join waitlist" : "Book seat"}</Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      ))}

      {tab === "certificates" && (asg.loading && !asg.data ? <Loading /> : asg.error ? <ErrorState message={asg.error} onRetry={asg.reload} /> : !certs.length ? (
        <Card><EmptyState icon={Award} title="No certificates yet" description="Verified training with a certificate or a validity period appears here, with its expiry." /></Card>
      ) : (
        <DataTable caption="My certificates" rows={certs}
          columns={[
            { key: "course", header: "Course", render: (a) => a.course?.title },
            { key: "completion_date", header: "Completed", render: (a) => formatDate(a.completion_date) },
            { key: "certificate", header: "Certificate", render: (a) => <span className="flex flex-col">{a.certificate_number && <span>No. {a.certificate_number}</span>}{a.certificate ? <DocButton doc={a.certificate}>View</DocButton> : !a.certificate_number && "—"}</span> },
            { key: "certificate_expiry", header: "Valid until", render: (a) => <CertificateBadge row={a} /> },
          ]} />
      ))}

      {tab === "history" && (
        <DataTable caption="Training history" rows={history} loading={asg.loading} error={asg.error} onRetry={asg.reload} emptyTitle="No history yet"
          columns={[
            { key: "course", header: "Course", render: (a) => <div><p className="font-medium text-[#101a3a]">{a.course?.title}</p><p className="text-xs text-slate-500">{a.course?.code}</p></div> },
            { key: "status", header: "Status", render: (a) => <AssignmentStatus row={a} /> },
            { key: "completion_date", header: "Completed", render: (a) => formatDate(a.completion_date) },
            { key: "result", header: "Result", render: (a) => (a.result ? <span className="flex items-center gap-1"><TBadge value={a.result} />{a.score != null && <span className="text-xs text-slate-500">{a.score}%</span>}</span> : "—") },
            { key: "verified_at", header: "Verified", render: (a) => (a.verified_at ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{formatDateTime(a.verified_at)}</span> : a.status === "cancelled" ? a.cancel_reason ?? "—" : "—") },
          ]} />
      )}

      {modal?.type === "submit" && <SubmitModal row={modal.row} me={me} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      <ConfirmDialog open={modal?.type === "withdraw"} onClose={() => setModal(null)} tone="danger" title="Withdraw from session" confirmLabel="Withdraw"
        requireReason={false} reasonLabel="Reason (optional)" message={modal?.session ? `${modal.session.course_title} — ${sessionWhen(modal.session)}. Your seat goes to the next person on the waitlist.` : ""}
        onConfirm={async (reason) => { const res = await withdrawEnrollment(modal.session.my_enrollment_id, reason); if (!res.error) { notify("Withdrawn."); ses.reload(); } return res; }} />
    </>
  );
}
