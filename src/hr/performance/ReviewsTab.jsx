// Reviews: self-assessment (employee, in the portal) -> manager assessment
// (reporting line / HR) -> HR calibration (return to manager or finalize with
// a final rating and calibration notes) -> finalized. Nobody acts on their own
// review; the server re-checks every step.
import { useMemo, useState } from "react";
import { MessageSquarePlus, Scale, Undo2, UserCheck } from "lucide-react";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { finalizeReview, giveFeedback, listGoals, listReviews, returnReview, submitManagerAssessment } from "@/lib/hr/performance";
import {
  FEEDBACK_TYPES, REVIEW_STATUSES, REVIEW_STATUS_LABELS, goalProgressPct, reviewActions, scoreToRating, suggestedFinalRating, weightTotal, weightedGoalScore,
} from "@/lib/hr/performanceRules";
import { Button, Card, DataTable, DescriptionList, EmptyState, Field, Input, Loading, Modal, SearchInput, Select, Textarea, Toolbar, useToast } from "@/hr/ui";
import { ActionModal, CycleSelect, PerfBadge, ProgressBar, RatingBadge, RatingSelect, TextBlock, WeightMeter, defaultCycleId, empText, opts, todayLocal } from "./shared";

export function FeedbackModal({ employee, reviewId, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ feedback_type: "praise", body: "", visibility: "manager_and_employee" });
  return (
    <ActionModal title={`Feedback for ${empText(employee)}`} submitLabel="Save feedback" onClose={onClose}
      onSubmit={async () => {
        if (!v.body.trim()) return { error: "Write the feedback." };
        const res = await giveFeedback({ ...v, employee_id: employee.id, review_id: reviewId });
        if (res.error) return res;
        notify(v.visibility === "manager_and_employee" ? "Feedback shared with the employee." : "Private feedback saved for HR."); onDone?.(); return {};
      }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Type"><Select value={v.feedback_type} onChange={(e) => setV({ ...v, feedback_type: e.target.value })} options={opts(FEEDBACK_TYPES)} /></Field>
        <Field label="Visible to"><Select value={v.visibility} onChange={(e) => setV({ ...v, visibility: e.target.value })}
          options={[{ value: "manager_and_employee", label: "Employee and their manager" }, { value: "private_to_hr", label: "HR only (private)" }]} /></Field>
      </div>
      <Field label="Feedback" required><Textarea rows={5} value={v.body} maxLength={5000} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
    </ActionModal>
  );
}

function ReviewDetail({ ctx, review, cycle, onClose, onChanged }) {
  const { notify } = useToast();
  const [mode, setMode] = useState(null);   // assess | return | finalize | feedback
  const goals = useHrQuery(() => listGoals({ cycle: review.cycle_id, employee: review.employee_id }), [review.id]);
  const goalScore = weightedGoalScore(goals.data) ?? review.goal_score;
  const suggested = suggestedFinalRating({ managerRating: review.manager_rating, goalScore });
  const actions = reviewActions(review, {
    myEmployeeId: ctx.me, canManage: ctx.canManage, canReviewTeam: ctx.canReviewTeam, isInMyLine: ctx.isInMyLine,
    today: todayLocal(), selfDue: cycle?.self_assessment_due, cycleActive: cycle?.status === "active",
  });
  const [assess, setAssess] = useState({ text: review.manager_assessment ?? "", rating: review.manager_rating ? String(review.manager_rating) : "" });
  const [fin, setFin] = useState({ rating: "", touched: false, notes: review.calibration_notes ?? "" });
  const finRating = fin.touched ? fin.rating : (suggested != null ? String(suggested) : "");
  const [reason, setReason] = useState("");
  const total = weightTotal(goals.data);
  const done = (msg) => { notify(msg); setMode(null); onChanged(); };
  // HR returned the review (hr_return_performance_review sets returned_at +
  // return_reason): the manager must see why before re-assessing.
  // Hidden again once the manager has re-submitted after the return.
  const returnNotice = review.status === "manager_review" && review.return_reason
    && !(review.manager_submitted_at && review.returned_at && review.manager_submitted_at > review.returned_at)
    ? `Returned by HR${review.returned_at ? ` on ${formatDate(review.returned_at)}` : ""}: ${review.return_reason}` : null;

  return (
    <Modal open onClose={onClose} size="xl" title={`Review · ${empText(review.employee)}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {ctx.canManageEmployee(review.employee_id) && <Button variant="ghost" onClick={() => setMode("feedback")}><MessageSquarePlus className="h-4 w-4" aria-hidden="true" />Give feedback</Button>}
        {actions.managerAssess && <Button variant="secondary" onClick={() => setMode("assess")}><UserCheck className="h-4 w-4" aria-hidden="true" />{review.manager_submitted_at ? "Update manager assessment" : "Write manager assessment"}</Button>}
        {actions.returnToManager && <Button variant="secondary" onClick={() => setMode("return")}><Undo2 className="h-4 w-4" aria-hidden="true" />Return to manager</Button>}
        {actions.finalize && <Button onClick={() => setMode("finalize")}><Scale className="h-4 w-4" aria-hidden="true" />Calibrate & finalize</Button>}
      </>}>
      <div className="flex flex-col gap-4">
        {returnNotice && <p role="status" className="whitespace-pre-line rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{returnNotice}</p>}
        <DescriptionList items={[
          { label: "Cycle", value: cycle?.name ?? review.cycle?.name },
          { label: "Status", value: <PerfBadge value={review.status} /> },
          { label: "Manager", value: empText(review.manager) },
          { label: "Final rating", value: <RatingBadge rating={review.final_rating} /> },
          review.returned_at && { label: "Returned to manager", value: `${formatDateTime(review.returned_at)} — ${review.return_reason ?? ""}` },
          review.finalized_at && { label: "Finalized", value: formatDateTime(review.finalized_at) },
        ]} />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card title="Self-assessment" actions={<RatingBadge rating={review.self_rating} />}>
            <TextBlock empty={cycle?.self_assessment_due ? `Not submitted (due ${formatDate(cycle.self_assessment_due)}).` : "Not submitted."}>{review.self_assessment}</TextBlock>
            {review.self_submitted_at && <p className="mt-2 text-xs text-slate-500">Submitted {formatDateTime(review.self_submitted_at)}</p>}
          </Card>
          <Card title="Manager assessment" actions={<RatingBadge rating={review.manager_rating} />}>
            <TextBlock empty="Not submitted.">{review.manager_assessment}</TextBlock>
            {review.manager_submitted_at && <p className="mt-2 text-xs text-slate-500">Submitted {formatDateTime(review.manager_submitted_at)}</p>}
          </Card>
        </div>
        <Card title="Goals and KPIs" actions={<span className="flex items-center gap-2 text-xs text-slate-500">Weight <WeightMeter total={total} /> · Weighted score {goalScore ?? "—"}</span>} padded={false}>
          {goals.loading && !goals.data ? <Loading /> : (
            <DataTable caption="Goals for this review" rows={goals.data} emptyTitle="No goals set for this cycle"
              columns={[
                { key: "title", header: "Goal", render: (g) => <div><p className="font-medium">{g.title}</p><p className="text-xs text-slate-500">{g.kpi?.name ?? "Custom goal"}</p></div> },
                { key: "weight", header: "Weight", render: (g) => `${Number(g.weight)}%` },
                { key: "target_value", header: "Target / actual", render: (g) => `${g.target_value ?? "—"} / ${g.actual_value ?? "—"}` },
                { key: "score", header: "Score", render: (g) => <ProgressBar value={goalProgressPct(g)} /> },
                { key: "status", header: "Status", render: (g) => <PerfBadge value={g.status} /> },
              ]} />
          )}
        </Card>
        {review.calibration_notes && <Card title="Calibration notes"><TextBlock>{review.calibration_notes}</TextBlock></Card>}
      </div>

      {mode === "assess" && (
        <ActionModal title="Manager assessment" size="lg" submitLabel="Submit to HR calibration" onClose={() => setMode(null)}
          onSubmit={async () => {
            if (!assess.rating) return { error: "Choose a rating." };
            if (!assess.text.trim()) return { error: "Write the assessment." };
            const res = await submitManagerAssessment(review.id, assess.text, assess.rating);
            if (res.error) return res;
            done("Manager assessment submitted for HR calibration."); return {};
          }}>
          {returnNotice && <p className="whitespace-pre-line rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{returnNotice}</p>}
          {!review.self_submitted_at && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">The self-assessment was not submitted by its due date; you may assess without it.</p>}
          <Field label="Rating" required hint={goalScore != null ? `Weighted goal score ${goalScore} suggests ${scoreToRating(goalScore)}.` : undefined}><RatingSelect value={assess.rating} onChange={(r) => setAssess({ ...assess, rating: r })} /></Field>
          <Field label="Assessment" required hint="Strengths, achievements against goals, areas to develop."><Textarea rows={7} value={assess.text} maxLength={10000} onChange={(e) => setAssess({ ...assess, text: e.target.value })} /></Field>
          <p className="text-xs text-slate-500">The employee sees your assessment only after HR finalizes the review.</p>
        </ActionModal>
      )}
      {mode === "return" && (
        <ActionModal title="Return to manager" submitLabel="Return" tone="danger" onClose={() => setMode(null)}
          onSubmit={async () => {
            if (!reason.trim()) return { error: "Give a reason." };
            const res = await returnReview(review.id, reason);
            if (res.error) return res;
            done("Review returned to the manager."); return {};
          }}>
          <Field label="What should the manager change?" required><Textarea value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} /></Field>
        </ActionModal>
      )}
      {mode === "finalize" && (
        <ActionModal title="Calibrate and finalize" size="lg" submitLabel="Finalize review" onClose={() => setMode(null)}
          onSubmit={async () => {
            const r = Number(finRating);
            if (!(r >= 1 && r <= 5)) return { error: "The final rating must be between 1 and 5." };
            const res = await finalizeReview(review.id, r, fin.notes);
            if (res.error) return res;
            done("Review finalized. The employee has been notified."); return {};
          }}>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-slate-500">Self</p><RatingBadge rating={review.self_rating} showLabel={false} /></div>
            <div><p className="text-xs text-slate-500">Manager</p><RatingBadge rating={review.manager_rating} showLabel={false} /></div>
            <div><p className="text-xs text-slate-500">Goal score</p><p className="font-semibold">{goalScore ?? "—"}</p></div>
            <div><p className="text-xs text-slate-500">Suggested</p><RatingBadge rating={suggested} showLabel={false} /></div>
          </div>
          {goals.data?.length > 0 && Math.abs(total - 100) > 0.005 && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Goal weights total {total}%, not 100%. Check the goal sheet before finalizing.</p>}
          <Field label="Final rating (1–5, two decimals)" required hint="Suggested = 60% manager rating + 40% goal score (score ÷ 20). Adjust for calibration.">
            <Input type="number" min={1} max={5} step="0.01" value={finRating} onChange={(e) => setFin({ ...fin, rating: e.target.value, touched: true })} />
          </Field>
          <Field label="Calibration notes" hint="Visible to HR and managers; not shown to the employee."><Textarea rows={4} value={fin.notes} maxLength={5000} onChange={(e) => setFin({ ...fin, notes: e.target.value })} /></Field>
          <p className="text-xs text-slate-500">Finalizing is permanent and makes the manager assessment and final rating visible to the employee.</p>
        </ActionModal>
      )}
      {mode === "feedback" && <FeedbackModal employee={review.employee} reviewId={review.id} onClose={() => setMode(null)} onDone={() => setMode(null)} />}
    </Modal>
  );
}

export default function ReviewsTab({ ctx }) {
  const [pickedCycle, setCycle] = useState("");
  const cycle = pickedCycle || defaultCycleId(ctx.cycles);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(null);
  const reviews = useHrQuery(() => (cycle ? listReviews({ cycle }) : Promise.resolve({ data: [] })), [cycle]);
  const cyc = ctx.cycles.find((c) => c.id === cycle);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (reviews.data ?? []).filter((r) => r.employee_id !== ctx.me && (!status || r.status === status)
      && (!s || empText(r.employee).toLowerCase().includes(s)));
  }, [reviews.data, status, search, ctx.me]);
  const counts = useMemo(() => Object.fromEntries(REVIEW_STATUSES.map((st) => [st, (reviews.data ?? []).filter((r) => r.status === st && r.employee_id !== ctx.me).length])), [reviews.data, ctx.me]);
  const current = open ? (reviews.data ?? []).find((r) => r.id === open) : null;

  if (!ctx.cyclesLoading && !ctx.cycles.length) return <Card><EmptyState title="No review cycles yet" /></Card>;
  return (
    <>
      <Toolbar>
        <CycleSelect cycles={ctx.cycles} value={cycle} onChange={setCycle} />
        <Field label="Stage" className="min-w-[12rem]">
          <Select placeholder="All stages" value={status} onChange={(e) => setStatus(e.target.value)}
            options={REVIEW_STATUSES.map((s) => ({ value: s, label: `${REVIEW_STATUS_LABELS[s]} (${counts[s] ?? 0})` }))} />
        </Field>
        <div className="flex flex-1 items-end"><SearchInput value={search} onChange={setSearch} placeholder="Search employee…" /></div>
      </Toolbar>
      <DataTable caption="Performance reviews" rows={reviews.data ? rows : null} loading={reviews.loading} error={reviews.error} onRetry={reviews.reload}
        onRowClick={(r) => setOpen(r.id)}
        emptyTitle="No reviews" emptyDescription={cyc?.status === "draft" ? "Reviews are created when the cycle is started." : "No reviews match the filters."}
        columns={[
          { key: "employee", header: "Employee", sortable: true, sortValue: (r) => empText(r.employee), render: (r) => <span className="font-semibold text-[#101a3a]">{empText(r.employee)}</span> },
          { key: "manager", header: "Manager", render: (r) => empText(r.manager) },
          { key: "status", header: "Stage", sortable: true, render: (r) => <PerfBadge value={r.status} /> },
          { key: "self_rating", header: "Self", render: (r) => <RatingBadge rating={r.self_rating} showLabel={false} /> },
          { key: "manager_rating", header: "Manager", render: (r) => <RatingBadge rating={r.manager_rating} showLabel={false} /> },
          { key: "goal_score", header: "Goal score", sortable: true, render: (r) => r.goal_score ?? "—" },
          { key: "final_rating", header: "Final", sortable: true, render: (r) => <RatingBadge rating={r.final_rating} /> },
        ]} />
      {current && <ReviewDetail ctx={ctx} review={current} cycle={cyc} onClose={() => setOpen(null)} onChanged={reviews.reload} />}
    </>
  );
}
