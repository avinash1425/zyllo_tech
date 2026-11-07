// Employee Portal — My Performance: my goals / KPIs with progress updates
// (and goal proposals), self-assessment, my reviews (manager assessment and
// final rating appear once HR finalizes), manager feedback, review meetings,
// improvement plans and history. RLS and the RPCs limit everything to the
// signed-in employee's own records.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, ClipboardList, MessageSquare, PenLine, Plus, Target, TrendingUp } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import {
  acknowledgePlan, listCheckins, listCycles, listGoals, listKpis, listMeetings, listMyFeedback, listMyReviews, listPlans, submitSelfAssessment,
} from "@/lib/hr/performance";
import { goalProgressPct, label, weightTotal, weightedGoalScore } from "@/lib/hr/performanceRules";
import { Button, Card, DataTable, EmptyState, ErrorState, Field, KpiCard, Loading, PageHeader, Tabs, Textarea, useToast } from "@/hr/ui";
import { ActionModal, CycleSelect, PerfBadge, ProgressBar, RatingBadge, RatingSelect, TextBlock, WeightMeter, defaultCycleId, todayLocal } from "@/hr/performance/shared";
import { GoalForm, ProgressModal } from "@/hr/performance/GoalsTab";
import { MeetingDetail } from "@/hr/performance/MeetingsTab";

const TABS = ["goals", "self", "reviews", "feedback", "meetings", "plans", "history"];

function SelfAssessmentForm({ review, goals, onDone }) {
  const { notify } = useToast();
  const [text, setText] = useState("");
  const [rating, setRating] = useState("");
  const [confirm, setConfirm] = useState(false);
  const total = weightTotal(goals);
  return (
    <Card title={`Self-assessment · ${review.cycle_name}`} actions={review.self_assessment_due ? <span className="text-xs text-slate-500">Due {formatDate(review.self_assessment_due)}</span> : null}>
      <div className="flex flex-col gap-3">
        {goals.length > 0 && (
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-[#173a52]">Your goals this cycle <WeightMeter total={total} /> <span className="text-xs font-normal text-slate-500">weighted score {weightedGoalScore(goals) ?? "—"}</span></p>
            <ul className="flex flex-col gap-1.5 text-sm">
              {goals.map((g) => <li key={g.id} className="flex flex-wrap items-center justify-between gap-2"><span>{g.title} <span className="text-xs text-slate-500">({Number(g.weight)}%)</span></span><ProgressBar value={goalProgressPct(g)} /></li>)}
            </ul>
          </div>
        )}
        <Field label="Overall self-rating" required><RatingSelect value={rating} onChange={setRating} /></Field>
        <Field label="Self-assessment" required hint="Achievements against your goals, challenges, what you learned and what you want to develop next.">
          <Textarea rows={8} value={text} maxLength={10000} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="flex justify-end"><Button onClick={() => setConfirm(true)} disabled={!rating || !text.trim()}><PenLine className="h-4 w-4" aria-hidden="true" />Submit self-assessment</Button></div>
      </div>
      {confirm && (
        <ActionModal title="Submit self-assessment?" submitLabel="Submit" onClose={() => setConfirm(false)}
          onSubmit={async () => {
            const res = await submitSelfAssessment(review.id, text, rating);
            if (res.error) return res;
            notify("Self-assessment submitted to your manager."); setConfirm(false); onDone(); return {};
          }}>
          <p className="text-sm text-slate-700">After submitting you cannot change it. Your manager is notified and writes their assessment next; HR then calibrates and finalizes the review.</p>
        </ActionModal>
      )}
    </Card>
  );
}

function PlanCard({ plan, checkins, onAck }) {
  const open = ["active", "extended"].includes(plan.status);
  return (
    <Card title={plan.title ?? "Improvement plan"} actions={<PerfBadge value={plan.status} />}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-slate-600">{formatDate(plan.start_date)} – {formatDate(plan.end_date)}{plan.owner ? ` · Owner: ${plan.owner.display_name || `${plan.owner.first_name} ${plan.owner.last_name}`}` : ""}</p>
        <div><p className="font-semibold text-[#173a52]">Objectives</p><TextBlock>{plan.objectives}</TextBlock></div>
        {plan.success_criteria && <div><p className="font-semibold text-[#173a52]">Success criteria</p><TextBlock>{plan.success_criteria}</TextBlock></div>}
        {plan.support && <div><p className="font-semibold text-[#173a52]">Support</p><TextBlock>{plan.support}</TextBlock></div>}
        {plan.outcome_notes && <div><p className="font-semibold text-[#173a52]">Outcome</p><TextBlock>{plan.outcome_notes}</TextBlock></div>}
        <div>
          <p className="font-semibold text-[#173a52]">Check-ins</p>
          {!checkins.length ? <p className="text-slate-500">No check-ins yet.</p> : (
            <ul className="mt-1 flex flex-col gap-1.5">{checkins.map((c) => <li key={c.id} className="rounded-lg bg-slate-50 px-3 py-2"><span className="mr-2 text-xs text-slate-500">{formatDate(c.checkin_date)}</span><PerfBadge value={c.progress} /><p className="mt-1 whitespace-pre-wrap">{c.notes}</p></li>)}</ul>
          )}
        </div>
        {plan.employee_acknowledged_at
          ? <p className="text-xs text-slate-500">You acknowledged this plan on {formatDateTime(plan.employee_acknowledged_at)}{plan.employee_comment ? ` — “${plan.employee_comment}”` : ""}.</p>
          : open && <div><Button size="sm" variant="success" onClick={onAck}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Acknowledge plan</Button></div>}
      </div>
    </Card>
  );
}

export default function MyPerformancePage() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const { notify } = useToast();
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get("tab")) ? params.get("tab") : "goals";
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; }, { replace: true });
  const cycles = useHrQuery(listCycles, []);
  const goals = useHrQuery(() => (me ? listGoals({ employee: me }) : Promise.resolve({ data: [] })), [me]);
  const reviews = useHrQuery(listMyReviews, []);
  const kpis = useHrQuery(() => listKpis({ activeOnly: true }), []);
  const feedback = useHrQuery(() => (tab === "feedback" ? listMyFeedback() : Promise.resolve({ data: null })), [tab]);
  const meetings = useHrQuery(() => (me && ["meetings", "history"].includes(tab) ? listMeetings(me) : Promise.resolve({ data: null })), [me, tab]);
  const plans = useHrQuery(() => (me ? listPlans({ employee: me }) : Promise.resolve({ data: [] })), [me]);
  const checkins = useHrQuery(() => (me && tab === "plans" ? listCheckins({ employee: me }) : Promise.resolve({ data: [] })), [me, tab]);
  const [cycle, setCycle] = useState("");
  const [modal, setModal] = useState(null);

  const cycleList = cycles.data ?? [];
  const activeCycleId = cycle || defaultCycleId(cycleList.filter((c) => (goals.data ?? []).some((g) => g.cycle_id === c.id) || c.status === "active")) || defaultCycleId(cycleList);
  const cyc = cycleList.find((c) => c.id === activeCycleId);
  const cycleGoals = useMemo(() => (goals.data ?? []).filter((g) => g.cycle_id === activeCycleId), [goals.data, activeCycleId]);
  const pendingSelf = (reviews.data ?? []).filter((r) => !r.self_submitted_at && ["not_started", "self_review"].includes(r.status)
    && cycleList.find((c) => c.id === r.cycle_id)?.status === "active");
  const openPlans = (plans.data ?? []).filter((p) => ["active", "extended"].includes(p.status));
  const today = todayLocal();
  const reload = () => { goals.reload(); reviews.reload(); };

  if (!me) return <ErrorState message="Your account is not linked to an employee record." />;

  return (
    <>
      <PageHeader title="My Performance" description="Your goals and KPIs, self-assessment, reviews, feedback, meetings and improvement plans." />
      {pendingSelf.length > 0 && tab !== "self" && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          Your self-assessment for {pendingSelf.map((r) => r.cycle_name).join(", ")} is waiting. <button type="button" className="underline" onClick={() => setTab("self")}>Write it now</button>
        </p>
      )}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Goals this cycle" value={cycleGoals.length} hint={cyc?.name} icon={Target} tone="orange" loading={goals.loading && !goals.data} onClick={() => setTab("goals")} />
        <KpiCard label="Weighted score" value={weightedGoalScore(cycleGoals) ?? "—"} hint="Achievement % across scored goals" icon={TrendingUp} tone="teal" loading={goals.loading && !goals.data} />
        <KpiCard label="Latest final rating" value={(reviews.data ?? []).find((r) => r.final_rating != null)?.final_rating ?? "—"} icon={ClipboardList} tone="navy" loading={reviews.loading && !reviews.data} onClick={() => setTab("reviews")} />
      </div>
      <Tabs value={tab} onChange={setTab} label="My performance sections" tabs={[
        { value: "goals", label: "My goals & KPIs", count: goals.data ? cycleGoals.length : undefined },
        { value: "self", label: "Self-assessment", count: reviews.data ? pendingSelf.length : undefined },
        { value: "reviews", label: "My reviews" },
        { value: "feedback", label: "Manager feedback" },
        { value: "meetings", label: "Meetings" },
        { value: "plans", label: "Improvement plans", count: plans.data && openPlans.length ? openPlans.length : undefined },
        { value: "history", label: "History" },
      ]} />

      {tab === "goals" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <CycleSelect cycles={cycleList} value={activeCycleId} onChange={setCycle} />
            <span className="flex flex-wrap items-center gap-2 text-sm text-slate-600">Total weight <WeightMeter total={weightTotal(cycleGoals)} />
              {cyc?.status === "active" && <Button size="sm" variant="secondary" onClick={() => setModal({ type: "propose" })}><Plus className="h-4 w-4" aria-hidden="true" />Propose a goal</Button>}
            </span>
          </div>
          {cycleGoals.some((g) => g.status === "draft") && <p className="rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">Draft goals are waiting for your manager to approve the goal sheet (weights must total 100%).</p>}
          <DataTable caption="My goals" rows={goals.data ? cycleGoals : null} loading={goals.loading} error={goals.error} onRetry={goals.reload}
            emptyTitle="No goals for this cycle" emptyDescription="Your manager sets your goals; you can also propose goals while the cycle is active."
            columns={[
              { key: "title", header: "Goal / KPI", render: (g) => <div><p className="font-semibold text-[#101a3a]">{g.title}</p><p className="text-xs text-slate-500">{g.kpi?.name ?? "Custom goal"}{g.due_date ? ` · due ${formatDate(g.due_date)}` : ""}{g.due_date && g.due_date < today && ["agreed", "in_progress"].includes(g.status) ? " (overdue)" : ""}</p></div> },
              { key: "weight", header: "Weight", render: (g) => `${Number(g.weight)}%` },
              { key: "target_value", header: "Target / actual", render: (g) => `${g.target_value ?? "—"} / ${g.actual_value ?? "—"}${g.kpi?.unit ? ` ${g.kpi.unit}` : ""}` },
              { key: "score", header: "Progress", render: (g) => <ProgressBar value={goalProgressPct(g)} /> },
              { key: "status", header: "Status", render: (g) => <PerfBadge value={g.status} /> },
              { key: "_a", header: <span className="sr-only">Actions</span>, render: (g) => (
                <Button size="sm" variant={cyc?.status === "active" && ["agreed", "in_progress"].includes(g.status) ? "secondary" : "ghost"} onClick={() => setModal({ type: "progress", row: g })}>
                  <TrendingUp className="h-4 w-4" aria-hidden="true" />{cyc?.status === "active" && ["agreed", "in_progress"].includes(g.status) ? "Update progress" : "History"}
                </Button>) },
            ]} />
        </div>
      )}

      {tab === "self" && (reviews.loading && !reviews.data ? <Loading /> : reviews.error ? <ErrorState message={reviews.error} onRetry={reviews.reload} /> : !pendingSelf.length ? (
        <Card><EmptyState icon={PenLine} title="No self-assessment due" description="When a review cycle opens, your self-assessment appears here. Submitted assessments are under My reviews." /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {pendingSelf.map((r) => <SelfAssessmentForm key={r.id} review={r} goals={(goals.data ?? []).filter((g) => g.cycle_id === r.cycle_id)} onDone={reload} />)}
        </div>
      ))}

      {tab === "reviews" && (reviews.loading && !reviews.data ? <Loading /> : reviews.error ? <ErrorState message={reviews.error} onRetry={reviews.reload} /> : !(reviews.data ?? []).length ? (
        <Card><EmptyState icon={ClipboardList} title="No reviews yet" /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {reviews.data.map((r) => (
            <Card key={r.id} title={r.cycle_name} actions={<PerfBadge value={r.status} />}>
              <div className="flex flex-col gap-3">
                <p className="text-xs text-slate-500">{formatDate(r.period_start)} – {formatDate(r.period_end)}</p>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-100 p-3">
                    <p className="mb-1 flex items-center justify-between gap-2 text-sm font-semibold text-[#173a52]">My self-assessment <RatingBadge rating={r.self_rating} /></p>
                    <TextBlock empty="Not submitted.">{r.self_assessment}</TextBlock>
                  </div>
                  <div className="rounded-xl border border-slate-100 p-3">
                    <p className="mb-1 flex items-center justify-between gap-2 text-sm font-semibold text-[#173a52]">Manager assessment {r.status === "finalized" && <RatingBadge rating={r.manager_rating} />}</p>
                    {r.status === "finalized" ? <TextBlock>{r.manager_assessment}</TextBlock> : <p className="text-sm text-slate-500">Shown once HR finalizes the review.</p>}
                  </div>
                </div>
                {r.status === "finalized" && (
                  <div className="flex flex-wrap items-center gap-4 rounded-xl bg-emerald-50/60 px-3 py-2 text-sm">
                    <span>Final rating <RatingBadge rating={r.final_rating} /></span>
                    <span>Goal score <strong>{r.goal_score ?? "—"}</strong></span>
                    <span className="text-xs text-slate-500">Finalized {formatDate(r.finalized_at)}</span>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      ))}

      {tab === "feedback" && (feedback.loading && !feedback.data ? <Loading /> : feedback.error ? <ErrorState message={feedback.error} onRetry={feedback.reload} /> : !(feedback.data ?? []).length ? (
        <Card><EmptyState icon={MessageSquare} title="No feedback yet" description="Feedback your manager or colleagues share with you appears here." /></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {feedback.data.map((f) => (
            <Card key={f.id}>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <PerfBadge value={f.feedback_type} /><span className="font-semibold text-[#173a52]">{f.from_name}</span>{f.from_manager && <span>(your manager)</span>}<span>· {formatDateTime(f.created_at)}</span>
              </div>
              <TextBlock>{f.body}</TextBlock>
            </Card>
          ))}
        </div>
      ))}

      {tab === "meetings" && (
        <DataTable caption="My review meetings" rows={meetings.data} loading={meetings.loading} error={meetings.error} onRetry={meetings.reload}
          onRowClick={(m) => setModal({ type: "meeting", row: m })} emptyTitle="No review meetings"
          columns={[
            { key: "scheduled_at", header: "When", render: (m) => formatDateTime(m.scheduled_at) },
            { key: "meeting_type", header: "Type", render: (m) => label(m.meeting_type) },
            { key: "mode", header: "Mode", render: (m) => `${label(m.mode)}${m.location ? ` · ${m.location}` : ""}` },
            { key: "attendees", header: "With", render: (m) => [m.organizer_name, ...(m.attendees ?? []).map((a) => a.name)].filter(Boolean).filter((n, i, a) => a.indexOf(n) === i).join(", ") || "—" },
            { key: "status", header: "Status", render: (m) => <PerfBadge value={m.status} /> },
          ]} />
      )}

      {tab === "plans" && (plans.loading && !plans.data ? <Loading /> : plans.error ? <ErrorState message={plans.error} onRetry={plans.reload} /> : !(plans.data ?? []).length ? (
        <Card><EmptyState icon={ClipboardList} title="No improvement plans" /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {plans.data.map((p) => <PlanCard key={p.id} plan={p} checkins={(checkins.data ?? []).filter((c) => c.plan_id === p.id)} onAck={() => setModal({ type: "ack", row: p })} />)}
        </div>
      ))}

      {tab === "history" && (
        <div className="flex flex-col gap-4">
          <DataTable caption="Performance history" rows={reviews.data} loading={reviews.loading} error={reviews.error} onRetry={reviews.reload} emptyTitle="No history yet"
            columns={[
              { key: "cycle_name", header: "Cycle", render: (r) => <div><p className="font-semibold text-[#101a3a]">{r.cycle_name}</p><p className="text-xs text-slate-500">{label(r.cycle_type)}</p></div> },
              { key: "period_end", header: "Period", render: (r) => `${formatDate(r.period_start)} – ${formatDate(r.period_end)}` },
              { key: "self_rating", header: "Self", render: (r) => <RatingBadge rating={r.self_rating} showLabel={false} /> },
              { key: "goal_score", header: "Goal score", render: (r) => r.goal_score ?? "—" },
              { key: "final_rating", header: "Final rating", render: (r) => <RatingBadge rating={r.final_rating} /> },
              { key: "status", header: "Status", render: (r) => <PerfBadge value={r.status} /> },
            ]} />
          <Card title="Goals by cycle">
            {!(goals.data ?? []).length ? <p className="text-sm text-slate-500">No goals recorded.</p> : (
              <ul className="flex flex-col gap-2 text-sm">
                {cycleList.filter((c) => (goals.data ?? []).some((g) => g.cycle_id === c.id)).map((c) => {
                  const gs = goals.data.filter((g) => g.cycle_id === c.id);
                  return <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2"><span className="font-semibold">{c.name}</span><span className="flex items-center gap-2 text-xs text-slate-500">{gs.length} goal(s) · <WeightMeter total={weightTotal(gs)} /> · weighted score {weightedGoalScore(gs) ?? "—"}</span></li>;
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      {modal?.type === "propose" && <GoalForm cycleId={activeCycleId} employeeId={me} kpis={kpis.data} sheetGoals={cycleGoals} onClose={() => setModal(null)}
        onSaved={() => { setModal(null); notify("Goal proposed. Your manager approves the goal sheet."); goals.reload(); }} />}
      {modal?.type === "progress" && <ProgressModal goal={modal.row} canRecord={cyc?.status === "active" && ["agreed", "in_progress"].includes(modal.row.status)} onClose={() => setModal(null)} onDone={() => { setModal(null); goals.reload(); }} />}
      {modal?.type === "meeting" && <MeetingDetail meeting={modal.row} onClose={() => setModal(null)} />}
      {modal?.type === "ack" && <AckModal plan={modal.row} onClose={() => setModal(null)} onDone={() => { setModal(null); notify("Plan acknowledged."); plans.reload(); }} />}
    </>
  );
}

function AckModal({ plan, onClose, onDone }) {
  const [comment, setComment] = useState("");
  return (
    <ActionModal title="Acknowledge improvement plan" submitLabel="Acknowledge" onClose={onClose}
      onSubmit={async () => { const res = await acknowledgePlan(plan.id, comment); if (res.error) return res; onDone(); return {}; }}>
      <p className="text-sm text-slate-700">Acknowledging confirms you have received and read the plan. It does not mean you agree with every point — add a comment if you wish.</p>
      <Field label="Comment (optional)"><Textarea value={comment} maxLength={4000} onChange={(e) => setComment(e.target.value)} /></Field>
    </ActionModal>
  );
}
