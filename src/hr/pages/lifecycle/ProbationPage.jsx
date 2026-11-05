// Probation management: review reminders, manager feedback, HR decision
// (confirm / extend / end early through an Exit case) and history. Every
// decision is permission-checked and audited on the server, and the employee
// record is updated by the same RPC (Employee Management stays in sync).
import { useState } from "react";
import { Link } from "react-router-dom";
import { BellRing, Plus } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, fullName, useHrQuery } from "@/lib/hr/client";
import {
  cancelProbationReview, decideProbation, generateProbationReviews, getProbationEvents, listProbationEmployees, listProbationReviews,
  openProbationReview, submitProbationFeedback,
} from "@/lib/hr/lifecycle";
import {
  Badge, Button, ConfirmDialog, DataTable, DescriptionList, Field, InlineError, Input, Loading, Modal, Select, StatusBadge, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";
import { DueDate, EventList, label, today } from "./shared";

const REC_TONE = { confirm: "green", extend: "orange", terminate: "red" };
const STATUS_LABEL = { pending_manager: "Awaiting manager", pending_hr: "Awaiting HR decision", decided: "Decided", cancelled: "Cancelled" };

function FeedbackModal({ review, onClose, onDone, onBehalf }) {
  const { notify } = useToast();
  const [v, setV] = useState({ rating: review.manager_rating ?? "", recommendation: review.manager_recommendation ?? "", feedback: review.manager_feedback ?? "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function submit() {
    if (!v.rating) { setError("Choose a rating."); return; }
    if (!v.recommendation) { setError("Choose a recommendation."); return; }
    if (v.feedback.trim().length < 10) { setError("Write at least 10 characters of feedback."); return; }
    setBusy(true); setError(null);
    const res = await submitProbationFeedback(review.id, v);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Feedback recorded; HR will decide."); onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Probation feedback: ${fullName(review.employee)}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Submit feedback</Button></>}>
      <div className="flex flex-col gap-3">
        {onBehalf && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">You are recording feedback on the manager's behalf. It is labelled as HR-recorded in the history.</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Overall rating" required><Select placeholder="Choose" value={v.rating} onChange={set("rating")} options={[5, 4, 3, 2, 1].map((n) => ({ value: n, label: `${n} — ${["", "Unsatisfactory", "Needs improvement", "Meets expectations", "Exceeds expectations", "Outstanding"][n]}` }))} /></Field>
          <Field label="Recommendation" required><Select placeholder="Choose" value={v.recommendation} onChange={set("recommendation")} options={[{ value: "confirm", label: "Confirm" }, { value: "extend", label: "Extend probation" }, { value: "terminate", label: "End employment" }]} /></Field>
        </div>
        <Field label="Feedback" required hint="Performance, conduct, strengths and gaps against the role."><Textarea rows={5} value={v.feedback} maxLength={4000} onChange={set("feedback")} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function DecideModal({ review, canExit, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ decision: review.manager_recommendation === "terminate" ? "terminated" : review.manager_recommendation === "extend" ? "extended" : "confirmed",
    reason: "", effective_date: today(), extend_to: "", last_working_day: "", hr_comments: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function submit() {
    if (v.reason.trim().length < 3) { setError("Record the reason for the decision."); return; }
    if (v.decision === "extended" && !v.extend_to) { setError("Set the new probation end date."); return; }
    if (v.decision === "terminated" && !v.last_working_day) { setError("Set the last working day."); return; }
    setBusy(true); setError(null);
    const res = await decideProbation(review.id, v);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(v.decision === "confirmed" ? "Employment confirmed." : v.decision === "extended" ? "Probation extended; a follow-up review is scheduled." : "Probation ended; an exit case was opened.");
    onDone(v.decision === "terminated" ? res.data : null);
  }
  return (
    <Modal open onClose={onClose} title={`Probation decision: ${fullName(review.employee)}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button variant={v.decision === "terminated" ? "danger" : "primary"} loading={busy} onClick={submit}>Record decision</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm">Manager: <strong>{review.manager_recommendation ?? "—"}</strong>{review.manager_rating ? ` · rating ${review.manager_rating}/5` : ""}</p>
        <fieldset className="flex flex-wrap gap-4"><legend className="sr-only">Decision</legend>
          {[["confirmed", "Confirm"], ["extended", "Extend"], ["terminated", "End early"]].map(([d, l]) => (
            <label key={d} className="inline-flex items-center gap-2 text-sm font-semibold text-[#173a52]">
              <input type="radio" name="prob-decision" value={d} checked={v.decision === d} disabled={d === "terminated" && !canExit} onChange={() => setV((s) => ({ ...s, decision: d }))} className="h-4 w-4 text-[#f96706]" />{l}
            </label>
          ))}
        </fieldset>
        {!canExit && <p className="text-xs text-slate-500">Ending probation early also needs Exit Management permission.</p>}
        {v.decision === "confirmed" && <Field label="Confirmation date"><Input type="date" value={v.effective_date} onChange={set("effective_date")} /></Field>}
        {v.decision === "extended" && <Field label="New probation end date" required hint={`Current: ${formatDate(review.employee?.probation_end_date)}`}><Input type="date" min={review.employee?.probation_end_date ?? undefined} value={v.extend_to} onChange={set("extend_to")} /></Field>}
        {v.decision === "terminated" && <Field label="Last working day" required hint="An Exit case (termination) is opened and continues in Exit Management."><Input type="date" value={v.last_working_day} onChange={set("last_working_day")} /></Field>}
        <Field label="Reason" required><Textarea value={v.reason} maxLength={2000} onChange={set("reason")} /></Field>
        <Field label="HR comments (internal)"><Textarea value={v.hr_comments} maxLength={4000} onChange={set("hr_comments")} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function ReviewModal({ review, onClose, onChanged }) {
  const { hasPermission, hr } = useAuth();
  const { notify } = useToast();
  const events = useHrQuery(() => getProbationEvents(review.id), [review.id]);
  const [dialog, setDialog] = useState(null);
  const [exitId, setExitId] = useState(null);
  const own = review.employee_id === hr?.employee?.id;
  const open = ["pending_manager", "pending_hr"].includes(review.status);
  const isManager = hasPermission("probation.review_team") && review.employee?.manager_id === hr?.employee?.id;
  const canDecide = hasPermission("probation.decide") && !own;
  const canFeedback = open && !own && (isManager || canDecide);
  return (
    <Modal open onClose={onClose} title={`Probation review: ${fullName(review.employee)}`} size="lg"
      footer={<div className="flex w-full flex-wrap justify-end gap-2">
        {open && canDecide && <Button variant="ghost" onClick={() => setDialog("cancel")}>Cancel review</Button>}
        {canFeedback && <Button variant="secondary" onClick={() => setDialog("feedback")}>{review.manager_submitted_at ? "Update feedback" : "Give feedback"}</Button>}
        {open && canDecide && <Button onClick={() => setDialog("decide")} disabled={review.status !== "pending_hr"} title={review.status !== "pending_hr" ? "Waiting for manager feedback" : undefined}>Decide</Button>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>}>
      <div className="flex flex-col gap-4">
        {exitId && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Exit case opened. <Link className="font-semibold underline" to={`/hr/exits/${exitId}`}>Continue in Exit Management</Link>.</p>}
        <DescriptionList items={[
          { label: "Employee", value: `${fullName(review.employee)} (${review.employee?.employee_code})` },
          { label: "Status", value: STATUS_LABEL[review.status] },
          { label: "Joined", value: formatDate(review.employee?.joining_date) },
          { label: "Probation ends", value: formatDate(review.probation_end_date) },
          { label: "Review due", value: <DueDate value={review.due_date} status={review.status} /> },
          { label: "Review type", value: label(review.review_type) },
          { label: "Manager", value: review.manager ? fullName(review.manager) : "No manager (HR reviews)" },
          review.manager_submitted_at && { label: "Manager recommendation", value: <span><Badge tone={REC_TONE[review.manager_recommendation]}>{review.manager_recommendation}</Badge> · rating {review.manager_rating}/5 · {formatDateTime(review.manager_submitted_at)}</span> },
          review.manager_feedback && { label: "Manager feedback", value: <span className="whitespace-pre-line">{review.manager_feedback}</span> },
          review.decision && { label: "Decision", value: `${review.decision}${review.extended_to ? ` to ${formatDate(review.extended_to)}` : ""} · effective ${formatDate(review.effective_date)} · ${formatDateTime(review.decided_at)}` },
          review.decision_reason && { label: "Decision reason", value: review.decision_reason },
          review.hr_comments && { label: "HR comments (internal)", value: review.hr_comments },
          review.exit_id && { label: "Exit case", value: <Link className="font-semibold text-[#1f4693] hover:underline" to={`/hr/exits/${review.exit_id}`}>Open exit case</Link> },
        ]} />
        <div><h4 className="mb-2 text-sm font-bold text-[#101a3a]">History</h4>{events.loading && !events.data ? <Loading /> : <EventList events={events.data} />}</div>
      </div>
      {dialog === "feedback" && <FeedbackModal review={review} onBehalf={!isManager} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChanged(); onClose(); }} />}
      {dialog === "decide" && <DecideModal review={review} canExit={hasPermission("exit.manage")} onClose={() => setDialog(null)} onDone={(exit) => { setDialog(null); onChanged(); events.reload(); if (exit) setExitId(exit); else onClose(); }} />}
      <ConfirmDialog open={dialog === "cancel"} onClose={() => setDialog(null)} title="Cancel probation review" message="The review is kept as history." confirmLabel="Cancel review" requireReason reasonLabel="Reason"
        onConfirm={async (reason) => { const res = await cancelProbationReview(review.id, reason); if (!res.error) { notify("Review cancelled."); onChanged(); onClose(); } return res; }} />
    </Modal>
  );
}

function RemindersModal({ onClose, onDone }) {
  const { notify } = useToast();
  const [days, setDays] = useState("14");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError(null);
    const res = await generateProbationReviews(days);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(`${res.data?.opened ?? 0} review(s) opened, ${res.data?.reminded ?? 0} overdue reminder(s) sent.`); onDone();
  }
  return (
    <Modal open onClose={onClose} title="Probation review reminders" size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Run reminders</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">Opens a review for every probation ending within the look-ahead window and notifies the manager and HR. Overdue reviews get one reminder per day. Safe to run repeatedly.</p>
        <Field label="Look-ahead (days)"><Input type="number" min={0} max={120} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

export default function ProbationPage() {
  const { hasPermission, hr } = useAuth();
  const { notify } = useToast();
  const [scope, setScope] = useState("open");
  const [selected, setSelected] = useState(null);
  const [reminders, setReminders] = useState(false);
  const reviews = useHrQuery(() => (scope === "employees" ? Promise.resolve({ data: [], error: null }) : listProbationReviews({ scope })), [scope]);
  const employees = useHrQuery(() => (scope === "employees" ? listProbationEmployees() : Promise.resolve({ data: [], error: null })), [scope]);
  const [opening, setOpening] = useState(null);
  const canDecide = hasPermission("probation.decide");
  return (
    <>
      <Toolbar>
        <Tabs value={scope} onChange={setScope} label="Probation views" tabs={[{ value: "open", label: "Open reviews" }, { value: "decided", label: "Decided" }, ...(canDecide ? [{ value: "employees", label: "On probation" }] : [])]} />
        {canDecide && <div className="flex flex-1 justify-end"><Button variant="secondary" onClick={() => setReminders(true)}><BellRing className="h-4 w-4" aria-hidden="true" />Run review reminders</Button></div>}
      </Toolbar>
      {scope === "employees" ? (
        <DataTable caption="Employees on probation" rows={employees.data} loading={employees.loading} error={employees.error} onRetry={employees.reload}
          emptyTitle="Nobody is on probation"
          columns={[
            { key: "name", header: "Employee", render: (e) => <div><p className="font-semibold text-[#101a3a]">{fullName(e)}</p><p className="font-mono text-xs text-slate-500">{e.employee_code}</p></div> },
            { key: "status", header: "Status", render: (e) => <StatusBadge status={e.status} /> },
            { key: "joining_date", header: "Joined", render: (e) => formatDate(e.joining_date) },
            { key: "probation_end_date", header: "Probation ends", sortable: true, render: (e) => <DueDate value={e.probation_end_date} status="open" /> },
            { key: "act", header: "", render: (e) => e.id !== hr?.employee?.id && e.probation_end_date && <Button size="sm" variant="secondary" onClick={(ev) => { ev.stopPropagation(); setOpening(e); }}><Plus className="h-4 w-4" aria-hidden="true" />Open review</Button> },
          ]} />
      ) : (
        <DataTable caption="Probation reviews" rows={reviews.data} loading={reviews.loading} error={reviews.error} onRetry={reviews.reload}
          emptyTitle={scope === "open" ? "No open probation reviews" : "No decided reviews"} emptyDescription={scope === "open" && canDecide ? "Run the review reminders to open reviews for probations ending soon." : undefined}
          onRowClick={(r) => setSelected(r)}
          columns={[
            { key: "employee", header: "Employee", render: (r) => <div className="min-w-[9rem]"><p className="font-semibold text-[#101a3a]">{fullName(r.employee)}</p><p className="font-mono text-xs text-slate-500">{r.employee?.employee_code}</p></div> },
            { key: "probation_end_date", header: "Probation ends", sortable: true, render: (r) => formatDate(r.probation_end_date) },
            { key: "due_date", header: "Review due", sortable: true, render: (r) => <DueDate value={r.due_date} status={r.status} /> },
            { key: "manager", header: "Manager", render: (r) => (r.manager ? fullName(r.manager) : "—") },
            { key: "rec", header: "Recommendation", render: (r) => (r.manager_recommendation ? <Badge tone={REC_TONE[r.manager_recommendation]}>{r.manager_recommendation}</Badge> : "—") },
            { key: "status", header: "Status", render: (r) => (r.decision ? <Badge tone={r.decision === "confirmed" ? "green" : r.decision === "extended" ? "orange" : "red"}>{r.decision}</Badge> : <Badge tone="amber">{STATUS_LABEL[r.status]}</Badge>) },
          ]} />
      )}
      {selected && <ReviewModal review={selected} onClose={() => setSelected(null)} onChanged={reviews.reload} />}
      {reminders && <RemindersModal onClose={() => setReminders(false)} onDone={() => { setReminders(false); reviews.reload(); }} />}
      <ConfirmDialog open={Boolean(opening)} onClose={() => setOpening(null)} title={`Open probation review: ${opening ? fullName(opening) : ""}`}
        message="The reporting manager is asked for feedback; HR then decides." confirmLabel="Open review"
        onConfirm={async () => { const res = await openProbationReview(opening.id, opening.probation_end_date); if (!res.error) { notify("Probation review opened."); employees.reload(); } return res; }} />
    </>
  );
}
