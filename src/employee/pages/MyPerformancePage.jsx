// Employee: my goals in active review cycles (propose draft goals, record
// actuals on agreed goals), my self-assessment (submitted once), my review
// history (manager fields appear only once finalized — hr_my_performance_reviews)
// and feedback shared with me. RLS limits every query to my own records.
import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, fullName, useHrQuery } from "@/lib/hr/client";
import {
  RATING_OPTIONS, createGoal, deleteGoal, label as lbl, listCycles, listFeedback, listGoals, listKpis, listPlans, myReviews,
  submitSelfAssessment, totalWeight, updateGoal,
} from "@/lib/hr/performance";
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal, PageHeader, Select,
  StatusBadge, Tabs, Textarea, useToast,
} from "@/hr/ui";

const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
const isNum = (v) => !isBlank(v) && Number.isFinite(Number(v));
const fmtNum = (v, digits = 2) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: digits }));

export default function MyPerformancePage() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const cycles = useHrQuery(() => listCycles({ status: "active" }), []);
  const activeIds = (cycles.data ?? []).map((c) => c.id);
  const goals = useHrQuery(() => (cycles.data ? listGoals({ employee: me, cycles: activeIds }) : Promise.resolve({ data: null, error: null })), [me, activeIds.join(",")]);
  const reviews = useHrQuery(myReviews, []);
  const kpis = useHrQuery(() => listKpis({ activeOnly: true }), []);
  const feedback = useHrQuery(() => listFeedback({ employee: me }), [me]);
  const plans = useHrQuery(() => listPlans({ employee: me }), [me]);
  const [tab, setTab] = useState("goals");

  const pendingSelf = (reviews.data ?? []).filter((r) => !r.self_submitted_at && ["not_started", "self_review"].includes(r.status) && activeIds.includes(r.cycle_id));
  const shared = (feedback.data ?? []).filter((f) => f.employee_id === me && f.visibility === "manager_and_employee");
  const tabs = [
    { value: "goals", label: "My goals" },
    { value: "self", label: "Self-assessment", count: pendingSelf.length || undefined },
    { value: "history", label: "My reviews" },
    { value: "feedback", label: "Feedback", count: shared.length || undefined },
    ...((plans.data ?? []).length ? [{ value: "plans", label: "Improvement plans" }] : []),
  ];

  return (
    <>
      <PageHeader title="My Performance" description="Your goals, self-assessments, finalized reviews and feedback shared with you." />
      <Tabs value={tab} onChange={setTab} tabs={tabs} label="My performance sections" />
      {tab === "goals" && <GoalsSection me={me} cycles={cycles} goals={goals} kpis={kpis.data} />}
      {tab === "self" && <SelfSection reviews={reviews} pending={pendingSelf} cycles={cycles} />}
      {tab === "history" && <HistorySection reviews={reviews} />}
      {tab === "feedback" && <FeedbackSection q={feedback} rows={shared} />}
      {tab === "plans" && <PlansSection q={plans} />}
    </>
  );
}

// ---------------------------------------------------------------- goals
function GoalsSection({ me, cycles, goals, kpis }) {
  const { notify } = useToast();
  const [editing, setEditing] = useState(null);   // { goal, cycle, mode: propose|edit|actual }
  const [deleting, setDeleting] = useState(null);
  if ((cycles.loading && !cycles.data) || (goals.loading && !goals.data)) return <Loading />;
  if (cycles.error) return <ErrorState message={cycles.error} onRetry={cycles.reload} />;
  if (goals.error) return <ErrorState message={goals.error} onRetry={goals.reload} />;
  if (!cycles.data?.length) return <EmptyState title="No active review cycle" description="Goals can be proposed and updated while a review cycle is active." />;

  return (
    <div className="flex flex-col gap-4">
      {cycles.data.map((c) => {
        const list = (goals.data ?? []).filter((g) => g.cycle_id === c.id);
        const weight = totalWeight(list);
        return (
          <Card key={c.id} title={`${c.name} · ${formatDate(c.period_start)} – ${formatDate(c.period_end)}`}
            actions={<Button size="sm" onClick={() => setEditing({ goal: {}, cycle: c, mode: "propose", otherWeight: weight })}><Plus className="h-4 w-4" aria-hidden="true" />Propose goal</Button>}>
            <p className="mb-3 text-sm text-slate-600">Total weight <span className={weight > 100 ? "font-bold text-red-600" : "font-bold text-[#101a3a]"}>{fmtNum(weight)}%</span> of 100%. Proposed goals stay in draft until your manager or HR agrees them.</p>
            {!list.length ? <EmptyState title="No goals yet" description="Propose your goals for this cycle, or wait for your manager to set them." /> : (
              <ul className="flex flex-col gap-3">
                {list.map((g) => (
                  <li key={g.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-[#101a3a]">{g.title}</p>
                        {g.description && <p className="text-xs text-slate-600">{g.description}</p>}
                      </div>
                      <StatusBadge status={g.status} />
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-5">
                      <div><dt>KPI</dt><dd className="font-semibold text-[#101a3a]">{g.kpi?.name ?? "—"}</dd></div>
                      <div><dt>Weight</dt><dd className="font-semibold text-[#101a3a]">{fmtNum(g.weight)}%</dd></div>
                      <div><dt>Target</dt><dd className="font-semibold text-[#101a3a]">{fmtNum(g.target_value, 4)}{g.kpi?.unit ? ` ${g.kpi.unit}` : ""}</dd></div>
                      <div><dt>Actual</dt><dd className="font-semibold text-[#101a3a]">{fmtNum(g.actual_value, 4)}</dd></div>
                      <div><dt>Score</dt><dd className="font-semibold text-[#101a3a]">{g.score != null ? `${fmtNum(g.score)}%` : "—"}</dd></div>
                    </dl>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {g.status === "draft" && <Button size="sm" variant="secondary" onClick={() => setEditing({ goal: g, cycle: c, mode: "edit", otherWeight: weight - Number(g.weight || 0) })}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>}
                      {g.status === "draft" && <Button size="sm" variant="ghost" onClick={() => setDeleting(g)}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete</Button>}
                      {["agreed", "in_progress"].includes(g.status) && <Button size="sm" variant="secondary" onClick={() => setEditing({ goal: g, cycle: c, mode: "actual" })}>Update actual</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
      {editing && <MyGoalModal {...editing} me={me} kpis={kpis} onClose={() => setEditing(null)}
        onSaved={(msg) => { setEditing(null); goals.reload(); notify(msg); }} />}
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} tone="danger" title="Delete draft goal" message={deleting ? `Delete "${deleting.title}"?` : ""} confirmLabel="Delete"
        onConfirm={async () => { const res = await deleteGoal(deleting.id); if (!res.error) { goals.reload(); notify("Goal deleted."); } return res; }} />
    </div>
  );
}

function MyGoalModal({ goal, cycle, mode, otherWeight = 0, me, kpis, onClose, onSaved }) {
  const actualOnly = mode === "actual";
  const [v, setV] = useState({ title: goal.title ?? "", description: goal.description ?? "", kpi_id: goal.kpi_id ?? "", weight: goal.weight ?? "", target_value: goal.target_value ?? "", actual_value: goal.actual_value ?? "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const kpi = (kpis ?? []).find((k) => k.id === v.kpi_id) ?? goal.kpi;
  function pickKpi(e) {
    const k = (kpis ?? []).find((x) => x.id === e.target.value);
    setV((s) => ({ ...s, kpi_id: e.target.value, weight: isBlank(s.weight) && k ? k.default_weight : s.weight }));
  }
  async function save() {
    const errs = {};
    if (actualOnly) {
      if (!isNum(v.actual_value)) errs.actual_value = "Enter a number.";
    } else {
      if (v.title.trim().length < 2 || v.title.trim().length > 200) errs.title = "Enter a title of 2–200 characters.";
      if (!isNum(v.weight) || Number(v.weight) < 0 || Number(v.weight) > 100) errs.weight = "Weight must be 0–100.";
      else if (otherWeight + Number(v.weight) > 100) errs.weight = `Total weight would be ${fmtNum(otherWeight + Number(v.weight))}%; the maximum is 100%.`;
      if (!isBlank(v.target_value) && !isNum(v.target_value)) errs.target_value = "Enter a number.";
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    let res;
    if (actualOnly) res = await updateGoal(goal.id, { actual_value: v.actual_value });
    else {
      const values = { title: v.title.trim(), description: v.description, kpi_id: v.kpi_id, weight: v.weight, target_value: v.target_value };
      res = mode === "propose" ? await createGoal({ ...values, employee_id: me, cycle_id: cycle.id, status: "draft" }) : await updateGoal(goal.id, values);
    }
    setBusy(false);
    if (res.error) setError(res.error);
    else onSaved(actualOnly ? "Actual value saved." : mode === "propose" ? "Goal proposed as a draft." : "Goal updated.");
  }
  return (
    <Modal open onClose={onClose} title={actualOnly ? `Update actual: ${goal.title}` : mode === "propose" ? `Propose a goal — ${cycle.name}` : "Edit draft goal"} size={actualOnly ? "sm" : "lg"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      {actualOnly ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-600">Target: <span className="font-semibold">{fmtNum(goal.target_value, 4)}{kpi?.unit ? ` ${kpi.unit}` : ""}</span></p>
          <Field label="Actual value" required error={errors.actual_value}><Input type="number" step="any" value={v.actual_value} onChange={set("actual_value")} /></Field>
          <p className="text-xs text-slate-500">The score is calculated automatically from the KPI definition.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Title" required error={errors.title} className="sm:col-span-2"><Input value={v.title} onChange={set("title")} maxLength={200} /></Field>
          <Field label="Description" className="sm:col-span-2"><Textarea value={v.description} onChange={set("description")} /></Field>
          <Field label="KPI" hint={kpi ? `${lbl(kpi.formula_type)} · ${lbl(kpi.direction)}` : "Optional."}>
            <Select placeholder="— No KPI —" value={v.kpi_id} onChange={pickKpi} options={(kpis ?? []).map((k) => ({ value: k.id, label: k.name }))} />
          </Field>
          <Field label="Weight (%)" required error={errors.weight} hint={`Your other goals: ${fmtNum(otherWeight)}%`}><Input type="number" min={0} max={100} step="0.01" value={v.weight} onChange={set("weight")} /></Field>
          <Field label="Target" error={errors.target_value}><Input type="number" step="any" value={v.target_value} onChange={set("target_value")} /></Field>
        </div>
      )}
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

// ---------------------------------------------------------------- self-assessment
function SelfSection({ reviews, pending, cycles }) {
  const { notify } = useToast();
  if (reviews.loading && !reviews.data) return <Loading />;
  if (reviews.error) return <ErrorState message={reviews.error} onRetry={reviews.reload} />;
  const activeIds = (cycles.data ?? []).map((c) => c.id);
  const submitted = (reviews.data ?? []).filter((r) => r.self_submitted_at && r.status !== "finalized" && activeIds.includes(r.cycle_id));
  if (!pending.length && !submitted.length) return <EmptyState title="Nothing to submit" description="A self-assessment form appears here when a review cycle that includes you is started." />;
  return (
    <div className="flex flex-col gap-4">
      {pending.map((r) => <SelfAssessmentForm key={r.id} review={r} onDone={() => { reviews.reload(); notify("Self-assessment submitted; your manager has been notified."); }} />)}
      {submitted.map((r) => (
        <Card key={r.id} title={`${r.cycle_name} — submitted`}>
          <p className="text-sm font-semibold text-[#101a3a]">Your rating: {r.self_rating}/5</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{r.self_assessment}</p>
          <p className="mt-2 text-xs text-slate-500">Submitted {formatDateTime(r.self_submitted_at)}. Awaiting manager review and finalization.</p>
        </Card>
      ))}
    </div>
  );
}

function SelfAssessmentForm({ review, onDone }) {
  const [text, setText] = useState("");
  const [rating, setRating] = useState("");
  const [errors, setErrors] = useState({});
  const [confirming, setConfirming] = useState(false);
  function ask() {
    const errs = {};
    if (!rating) errs.rating = "Choose a rating.";
    if (!text.trim()) errs.text = "Write your self-assessment.";
    setErrors(errs);
    if (!Object.keys(errs).length) setConfirming(true);
  }
  return (
    <Card title={`${review.cycle_name} · ${formatDate(review.period_start)} – ${formatDate(review.period_end)}`}>
      {review.self_assessment_due && <p className="mb-3 text-sm text-slate-600">Due {formatDate(review.self_assessment_due)}.</p>}
      <div className="flex flex-col gap-3">
        <Field label="Overall self-rating" required error={errors.rating}><Select placeholder="Choose" value={rating} onChange={(e) => setRating(e.target.value)} options={RATING_OPTIONS} /></Field>
        <Field label="Self-assessment" required error={errors.text} hint="Your achievements, challenges and development areas for this period."><Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <div className="flex justify-end"><Button onClick={ask}>Submit self-assessment</Button></div>
      </div>
      <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} title="Submit self-assessment"
        message="You can submit your self-assessment only once. It is shared with your manager and HR." confirmLabel="Submit"
        onConfirm={async () => { const res = await submitSelfAssessment(review.id, text, rating); if (!res.error) onDone(); return res; }} />
    </Card>
  );
}

// ---------------------------------------------------------------- history
function HistorySection({ reviews }) {
  if (reviews.loading && !reviews.data) return <Loading />;
  if (reviews.error) return <ErrorState message={reviews.error} onRetry={reviews.reload} />;
  if (!reviews.data?.length) return <EmptyState title="No reviews yet" />;
  return (
    <div className="flex flex-col gap-4">
      {reviews.data.map((r) => (
        <Card key={r.id} title={`${r.cycle_name} · ${formatDate(r.period_start)} – ${formatDate(r.period_end)}`} actions={<StatusBadge status={r.status} />}>
          {r.status === "finalized" ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Final rating" value={r.final_rating != null ? `${fmtNum(r.final_rating)} / 5` : "—"} />
                <Stat label="Manager rating" value={r.manager_rating != null ? `${r.manager_rating} / 5` : "—"} />
                <Stat label="Self rating" value={r.self_rating != null ? `${r.self_rating} / 5` : "—"} />
                <Stat label="Goal score" value={r.goal_score != null ? `${fmtNum(r.goal_score)}%` : "—"} />
              </div>
              {r.manager_assessment && <div className="mt-4"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manager assessment</h4><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{r.manager_assessment}</p></div>}
              {r.self_assessment && <div className="mt-4"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your self-assessment</h4><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{r.self_assessment}</p></div>}
              <p className="mt-3 text-xs text-slate-500">Finalized {formatDateTime(r.finalized_at)}</p>
            </>
          ) : (
            <p className="text-sm text-slate-600">{r.self_submitted_at ? "Your self-assessment is submitted. Ratings and the manager assessment are shown here once the review is finalized." : "In progress. Submit your self-assessment from the Self-assessment tab."}</p>
          )}
        </Card>
      ))}
    </div>
  );
}
const Stat = ({ label, value }) => (
  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-0.5 text-lg font-extrabold text-[#101a3a]">{value}</p></div>
);

// ---------------------------------------------------------------- feedback & plans
function FeedbackSection({ q, rows }) {
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!rows.length) return <EmptyState title="No feedback shared with you yet" />;
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((f) => (
        <li key={f.id} className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-[#101a3a]">{fullName(f.author) || "A colleague"}</span>
            <span className="flex items-center gap-2"><Badge tone={f.feedback_type === "praise" ? "green" : f.feedback_type === "constructive" ? "amber" : "slate"}>{lbl(f.feedback_type)}</Badge><span className="text-xs text-slate-500">{formatDateTime(f.created_at)}</span></span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{f.body}</p>
        </li>
      ))}
    </ul>
  );
}

function PlansSection({ q }) {
  const rows = useMemo(() => q.data ?? [], [q.data]);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  return (
    <div className="flex flex-col gap-4">
      {rows.map((p) => (
        <Card key={p.id} title={`${formatDate(p.start_date)} – ${formatDate(p.end_date)}`} actions={<StatusBadge status={p.status} />}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Objectives</h4>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{p.objectives}</p>
          {p.support && <><h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Support</h4><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{p.support}</p></>}
          {p.owner && <p className="mt-3 text-xs text-slate-500">Owner: {fullName(p.owner)}</p>}
          {p.outcome_notes && <><h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Outcome</h4><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{p.outcome_notes}</p></>}
        </Card>
      ))}
    </div>
  );
}
