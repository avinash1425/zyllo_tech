// Module 8 — Performance & KPI: review cycles (draft -> start -> compute ->
// close), reviews (manager assessment, finalization), goals with KPI-driven
// scores (computed by the database), improvement plans and feedback.
// Scores come only from explicit KPI definitions and recorded targets/actuals.
import { useMemo, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { Calculator, Lock, MessageSquarePlus, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, fullName, useHrQuery } from "@/lib/hr/client";
import { useEmployeeOptions } from "@/lib/hr/org";
import {
  CYCLE_TYPES, FEEDBACK_TYPES, FEEDBACK_VISIBILITY, GOAL_STATUSES, PLAN_STATUSES, RATING_OPTIONS, REVIEW_STATUSES,
  closeCycle, computeScores, createCycle, createGoal, createPlan, deleteGoal, finalizeReview, getReview, giveFeedback, label as lbl,
  listCycles, listFeedback, listGoals, listKpis, listPlans, listReviews, opts, startCycle, submitManagerAssessment, totalWeight,
  updateCycle, updateGoal, updatePlan,
} from "@/lib/hr/performance";
import {
  Badge, Button, Card, ConfirmDialog, DataTable, DescriptionList, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal,
  PageHeader, SearchInput, Select, StatusBadge, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";

const BASE = "/hr/performance";
const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
const isNum = (v) => !isBlank(v) && Number.isFinite(Number(v));
const fmtNum = (v, digits = 2) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: digits }));

function usePerms() {
  const { hasPermission, hr } = useAuth();
  const manage = hasPermission("performance.manage");
  const reviewTeam = hasPermission("performance.review_team");
  return {
    me: hr?.employee?.id ?? null,
    manage, reviewTeam,
    view: hasPermission("performance.view") || manage,
    viewTeam: hasPermission("performance.view_team"),
    writeGoals: manage || reviewTeam,
  };
}

export default function PerformancePage() {
  return (
    <Routes>
      <Route index element={<PerformanceHome />} />
      <Route path=":tab" element={<PerformanceHome />} />
    </Routes>
  );
}

function PerformanceHome() {
  const { tab: tabParam } = useParams();
  const navigate = useNavigate();
  const p = usePerms();
  const cycles = useHrQuery(() => listCycles(), []);
  const employees = useEmployeeOptions();
  const tabs = [
    { value: "reviews", label: "Reviews" },
    { value: "goals", label: "Goals" },
    { value: "cycles", label: "Review cycles" },
    { value: "plans", label: "Improvement plans" },
    ...(p.me ? [{ value: "feedback", label: "Feedback" }] : []),
  ];
  const tab = tabs.some((t) => t.value === tabParam) ? tabParam : null;
  if (!tab) return <Navigate to={`${BASE}/${tabs[0].value}`} replace />;
  const defaultCycle = (cycles.data ?? []).find((c) => c.status === "active")?.id ?? cycles.data?.[0]?.id ?? "";
  return (
    <>
      <PageHeader title="Performance & KPI" description="Goals and scores are driven only by KPI definitions and the targets and actuals recorded here." />
      <Tabs value={tab} onChange={(t) => navigate(`${BASE}/${t}`)} tabs={tabs} label="Performance sections" />
      {cycles.loading && !cycles.data ? <Loading /> : cycles.error ? <ErrorState message={cycles.error} onRetry={cycles.reload} /> : (
        <>
          {tab === "cycles" && <CyclesTab cycles={cycles} />}
          {tab === "reviews" && <ReviewsTab key={defaultCycle} cycles={cycles.data} defaultCycle={defaultCycle} />}
          {tab === "goals" && <GoalsTab key={defaultCycle} cycles={cycles.data} defaultCycle={defaultCycle} employees={employees} />}
          {tab === "plans" && <PlansTab employees={employees} />}
          {tab === "feedback" && <FeedbackTab employees={employees} />}
        </>
      )}
    </>
  );
}

const cycleLabel = (c) => `${c.name} (${lbl(c.status)})`;

// =====================================================================
// Review cycles
// =====================================================================
function CyclesTab({ cycles }) {
  const p = usePerms();
  const { notify } = useToast();
  const [editing, setEditing] = useState(null);
  const [action, setAction] = useState(null);   // { kind: start|joiners|compute|close, cycle }

  const columns = [
    { key: "name", header: "Cycle", sortable: true, render: (r) => <span className="font-semibold text-[#101a3a]">{r.name}</span> },
    { key: "cycle_type", header: "Type", render: (r) => <Badge tone={r.cycle_type === "intern" ? "violet" : "slate"}>{lbl(r.cycle_type)}</Badge> },
    { key: "period", header: "Period", sortable: true, sortValue: (r) => r.period_start, render: (r) => <span className="whitespace-nowrap">{formatDate(r.period_start)} – {formatDate(r.period_end)}</span> },
    { key: "due", header: "Self / manager due", render: (r) => <span className="whitespace-nowrap text-xs">{formatDate(r.self_assessment_due)}<br />{formatDate(r.manager_review_due)}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "started", header: "Started / closed", render: (r) => <span className="text-xs">{formatDateTime(r.started_at)}<br />{formatDateTime(r.closed_at)}</span> },
    ...(p.manage ? [{ key: "_actions", header: <span className="sr-only">Actions</span>, render: (r) => (
      <div className="flex flex-wrap gap-1">
        {r.status === "draft" && <Button size="sm" variant="ghost" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>}
        {r.status === "draft" && <Button size="sm" onClick={() => setAction({ kind: "start", cycle: r })}><Play className="h-4 w-4" aria-hidden="true" />Start</Button>}
        {r.status === "active" && <Button size="sm" variant="secondary" onClick={() => setAction({ kind: "joiners", cycle: r })}>Add new joiners</Button>}
        {r.status !== "draft" && <Button size="sm" variant="secondary" onClick={() => setAction({ kind: "compute", cycle: r })}><Calculator className="h-4 w-4" aria-hidden="true" />Compute scores</Button>}
        {r.status === "active" && <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "close", cycle: r })}><Lock className="h-4 w-4" aria-hidden="true" />Close</Button>}
      </div>) }] : []),
  ];

  const A = action?.kind;
  const texts = {
    start: { title: "Start review cycle", confirm: "Start cycle", tone: "primary", message: "The cycle becomes active and a review is created for every active or probation employee in scope (interns for intern cycles, everyone else otherwise). Each employee is notified in the portal." },
    joiners: { title: "Add new joiners", confirm: "Add reviews", tone: "primary", message: "Creates reviews for in-scope employees who do not have one in this cycle yet. Existing reviews are not changed." },
    compute: { title: "Compute goal scores", confirm: "Compute", tone: "primary", message: "Recomputes every goal score in this cycle from its KPI formula, target and actual, and updates the weighted goal score on reviews that are not finalized." },
    close: { title: "Close review cycle", confirm: "Close cycle", tone: "danger", message: "A closed cycle cannot be reopened. Goals and assessments in it can no longer change. Finalize reviews before closing." },
  };
  async function run() {
    const c = action.cycle;
    if (A === "start" || A === "joiners") {
      const res = await startCycle(c.id);
      if (!res.error) { notify(`${A === "start" ? "Cycle started" : "Done"}: ${res.data?.reviews_created ?? 0} review(s) created.`); cycles.reload(); }
      return res;
    }
    if (A === "compute") {
      const res = await computeScores(c.id);
      if (!res.error) notify(`Scored ${res.data?.goals_scored ?? 0} goal(s); ${res.data?.reviews_updated ?? 0} review(s) updated.`);
      return res;
    }
    const res = await closeCycle(c.id);
    if (!res.error) { notify("Review cycle closed."); cycles.reload(); }
    return res;
  }

  return (
    <>
      <Toolbar>
        <p className="flex-1 text-sm text-slate-600">Cycles are created as drafts. Starting a cycle activates it and creates the reviews.</p>
        {p.manage && <Button onClick={() => setEditing({})}><Plus className="h-4 w-4" aria-hidden="true" />New cycle</Button>}
      </Toolbar>
      <DataTable caption="Review cycles" columns={columns} rows={cycles.data} loading={cycles.loading} error={cycles.error} onRetry={cycles.reload} emptyTitle="No review cycles yet" />
      {editing && <CycleModal cycle={editing} onClose={() => setEditing(null)} onSaved={(isNew) => { setEditing(null); cycles.reload(); notify(isNew ? "Draft cycle created." : "Cycle updated."); }} />}
      <ConfirmDialog open={Boolean(action)} onClose={() => setAction(null)} title={texts[A]?.title} tone={texts[A]?.tone}
        message={action ? `${action.cycle.name}: ${texts[A].message}` : ""} confirmLabel={texts[A]?.confirm} onConfirm={run} />
    </>
  );
}

function CycleModal({ cycle, onClose, onSaved }) {
  const isNew = !cycle.id;
  const [v, setV] = useState({ name: cycle.name ?? "", cycle_type: cycle.cycle_type ?? "quarterly", period_start: cycle.period_start ?? "", period_end: cycle.period_end ?? "", self_assessment_due: cycle.self_assessment_due ?? "", manager_review_due: cycle.manager_review_due ?? "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    const errs = {};
    if (v.name.trim().length < 2 || v.name.trim().length > 120) errs.name = "Enter a name of 2–120 characters.";
    if (!v.period_start) errs.period_start = "Required.";
    if (!v.period_end) errs.period_end = "Required.";
    if (v.period_start && v.period_end && v.period_end < v.period_start) errs.period_end = "Must be on or after the start.";
    if (v.self_assessment_due && v.manager_review_due && v.manager_review_due < v.self_assessment_due) errs.manager_review_due = "Must be on or after the self-assessment due date.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const values = { ...v, name: v.name.trim() };
    const res = isNew ? await createCycle(values) : await updateCycle(cycle.id, values);
    setBusy(false);
    if (res.error) setError(res.error); else onSaved(isNew);
  }
  return (
    <Modal open onClose={onClose} title={isNew ? "New review cycle (draft)" : `Edit ${cycle.name}`} size="md"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{isNew ? "Create draft" : "Save"}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" required error={errors.name} className="sm:col-span-2"><Input value={v.name} onChange={set("name")} placeholder="e.g. Q3 FY26 review" /></Field>
        <Field label="Type" required hint="Intern cycles cover intern employees only."><Select value={v.cycle_type} onChange={set("cycle_type")} options={opts(CYCLE_TYPES)} /></Field>
        <div className="hidden sm:block" />
        <Field label="Period start" required error={errors.period_start}><Input type="date" value={v.period_start} onChange={set("period_start")} /></Field>
        <Field label="Period end" required error={errors.period_end}><Input type="date" value={v.period_end} onChange={set("period_end")} /></Field>
        <Field label="Self-assessment due"><Input type="date" value={v.self_assessment_due} onChange={set("self_assessment_due")} /></Field>
        <Field label="Manager review due" error={errors.manager_review_due}><Input type="date" value={v.manager_review_due} onChange={set("manager_review_due")} /></Field>
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

// =====================================================================
// Reviews
// =====================================================================
function ReviewsTab({ cycles, defaultCycle }) {
  const p = usePerms();
  const [cycle, setCycle] = useState(defaultCycle);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState(null);
  const q = useHrQuery(() => listReviews({ cycle, status }), [cycle, status]);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((r) => !s || `${fullName(r.employee)} ${r.employee?.employee_code ?? ""}`.toLowerCase().includes(s));
  }, [q.data, search]);
  const columns = [
    { key: "employee", header: "Employee", sortable: true, sortValue: (r) => fullName(r.employee).toLowerCase(), render: (r) => (
      <div className="min-w-[10rem]"><p className="font-semibold text-[#101a3a]">{fullName(r.employee) || "—"}</p><p className="text-xs text-slate-500">{r.employee?.employee_code} · {r.employee?.department?.name ?? "No department"}</p></div>) },
    { key: "cycle", header: "Cycle", render: (r) => r.cycle?.name ?? "—" },
    { key: "manager", header: "Manager", render: (r) => (r.manager ? fullName(r.manager) : "—") },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "self_rating", header: "Self", sortable: true, render: (r) => r.self_rating ?? "—" },
    { key: "manager_rating", header: "Manager", sortable: true, render: (r) => r.manager_rating ?? "—" },
    { key: "goal_score", header: "Goal score", sortable: true, render: (r) => (r.goal_score != null ? `${fmtNum(r.goal_score)}%` : "—") },
    { key: "final_rating", header: "Final", sortable: true, render: (r) => (r.final_rating != null ? <Badge tone="green">{fmtNum(r.final_rating)}</Badge> : "—") },
  ];
  return (
    <>
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search employee…" label="Search reviews" />
        <Select aria-label="Cycle" className="sm:w-60" placeholder="All cycles" value={cycle} onChange={(e) => setCycle(e.target.value)} options={(cycles ?? []).map((c) => ({ value: c.id, label: cycleLabel(c) }))} />
        <Select aria-label="Status" className="sm:w-44" placeholder="All statuses" value={status} onChange={(e) => setStatus(e.target.value)} options={opts(REVIEW_STATUSES)} />
      </Toolbar>
      <DataTable caption="Performance reviews" columns={columns} rows={rows} loading={q.loading} error={q.error} onRetry={q.reload} onRowClick={(r) => setOpenId(r.id)}
        emptyTitle="No reviews" emptyDescription={p.view ? "Start a review cycle to create reviews." : "Reviews for your team appear here. Your own review is on the My Performance page."} />
      {openId && <ReviewDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={q.reload} />}
    </>
  );
}

function ReviewDetailModal({ id, onClose, onChanged }) {
  const p = usePerms();
  const { notify } = useToast();
  const review = useHrQuery(() => getReview(id), [id]);
  const r = review.data;
  const goals = useHrQuery(() => (r ? listGoals({ cycle: r.cycle_id, employee: r.employee_id }) : Promise.resolve({ data: [], error: null })), [r?.cycle_id, r?.employee_id]);
  const [assessment, setAssessment] = useState(null);
  const [rating, setRating] = useState(null);
  const [aErr, setAErr] = useState(null);
  const [aBusy, setABusy] = useState(false);
  const [finalRating, setFinalRating] = useState("");
  const [fErr, setFErr] = useState(null);
  const [confirmFinal, setConfirmFinal] = useState(false);

  if (review.loading && !r) return <Modal open onClose={onClose} title="Review"><Loading /></Modal>;
  if (review.error) return <Modal open onClose={onClose} title="Review"><ErrorState message={review.error} onRetry={review.reload} /></Modal>;
  if (!r) return <Modal open onClose={onClose} title="Review"><EmptyState title="Review not found" /></Modal>;

  const own = r.employee_id === p.me;
  const finalized = r.status === "finalized";
  const canAssess = (p.manage || p.reviewTeam) && !finalized && !own && r.cycle?.status === "active";
  const canFinalize = p.manage && !finalized && !own;
  const text = assessment ?? r.manager_assessment ?? "";
  const rate = rating ?? (r.manager_rating ? String(r.manager_rating) : "");

  async function submitAssessment() {
    if (!text.trim()) { setAErr("Write the manager assessment."); return; }
    if (!rate) { setAErr("Choose a rating."); return; }
    setABusy(true); setAErr(null);
    const res = await submitManagerAssessment(r.id, text, rate);
    setABusy(false);
    if (res.error) { setAErr(res.error); return; }
    notify("Manager assessment saved.");
    setAssessment(null); setRating(null); review.reload(); onChanged();
  }
  function askFinalize() {
    const n = Number(finalRating);
    if (!isNum(finalRating) || n < 1 || n > 5) { setFErr("Final rating must be between 1 and 5."); return; }
    setFErr(null); setConfirmFinal(true);
  }
  const goalRows = goals.data ?? [];
  const weight = totalWeight(goalRows);

  return (
    <>
    <Modal open={!confirmFinal} onClose={onClose} title={`${fullName(r.employee)} — ${r.cycle?.name ?? "Review"}`} size="xl" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <DescriptionList items={[
        { label: "Status", value: <StatusBadge status={r.status} /> },
        { label: "Cycle", value: r.cycle ? `${r.cycle.name} · ${formatDate(r.cycle.period_start)} – ${formatDate(r.cycle.period_end)} (${lbl(r.cycle.status)})` : null },
        { label: "Manager", value: r.manager ? fullName(r.manager) : null },
        { label: "Weighted goal score", value: r.goal_score != null ? `${fmtNum(r.goal_score)}%` : "Not computed yet" },
        { label: "Self-assessment due", value: formatDate(r.cycle?.self_assessment_due) },
        { label: "Manager review due", value: formatDate(r.cycle?.manager_review_due) },
        finalized ? { label: "Final rating", value: `${fmtNum(r.final_rating)} / 5 (finalized ${formatDateTime(r.finalized_at)})` } : null,
      ]} />

      <h3 className="mt-5 text-sm font-bold text-[#101a3a]">Goals <span className="font-normal text-slate-500">· total weight {fmtNum(weight)}%</span></h3>
      {goals.loading && !goals.data ? <Loading /> : goals.error ? <ErrorState message={goals.error} onRetry={goals.reload} /> : !goalRows.length ? (
        <p className="mt-1 text-sm text-slate-500">No goals set for this cycle.</p>
      ) : (
        <div className="relative mt-2 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr>
              <th scope="col" className="px-3 py-2 text-left">Goal</th><th scope="col" className="px-3 py-2 text-left">KPI</th><th scope="col" className="px-3 py-2 text-right">Weight</th>
              <th scope="col" className="px-3 py-2 text-right">Target</th><th scope="col" className="px-3 py-2 text-right">Actual</th><th scope="col" className="px-3 py-2 text-right">Score</th><th scope="col" className="px-3 py-2 text-left">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {goalRows.map((g) => (
                <tr key={g.id}>
                  <td className="px-3 py-2 font-semibold text-[#101a3a]">{g.title}</td>
                  <td className="px-3 py-2">{g.kpi?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(g.weight)}%</td>
                  <td className="px-3 py-2 text-right">{fmtNum(g.target_value, 4)}{g.kpi?.unit ? ` ${g.kpi.unit}` : ""}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(g.actual_value, 4)}</td>
                  <td className="px-3 py-2 text-right">{g.score != null ? `${fmtNum(g.score)}%` : "—"}</td>
                  <td className="px-3 py-2"><StatusBadge status={g.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Self-assessment">
          {r.self_submitted_at ? (
            <>
              <p className="text-sm font-semibold text-[#101a3a]">Rating: {r.self_rating}/5</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{r.self_assessment}</p>
              <p className="mt-2 text-xs text-slate-500">Submitted {formatDateTime(r.self_submitted_at)}</p>
            </>
          ) : <p className="text-sm text-slate-500">Not submitted yet.</p>}
        </Card>
        <Card title="Manager assessment">
          {canAssess ? (
            <div className="flex flex-col gap-3">
              <Field label="Rating" required><Select placeholder="Choose" value={rate} onChange={(e) => setRating(e.target.value)} options={RATING_OPTIONS} /></Field>
              <Field label="Assessment" required><Textarea rows={6} value={text} onChange={(e) => setAssessment(e.target.value)} /></Field>
              {r.manager_submitted_at && <p className="text-xs text-slate-500">Last submitted {formatDateTime(r.manager_submitted_at)}. You can revise it until the review is finalized.</p>}
              <InlineError message={aErr} />
              <div className="flex justify-end"><Button loading={aBusy} onClick={submitAssessment}>{r.manager_submitted_at ? "Update assessment" : "Submit assessment"}</Button></div>
            </div>
          ) : r.manager_submitted_at ? (
            <>
              <p className="text-sm font-semibold text-[#101a3a]">Rating: {r.manager_rating}/5</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{r.manager_assessment}</p>
              <p className="mt-2 text-xs text-slate-500">Submitted {formatDateTime(r.manager_submitted_at)}</p>
            </>
          ) : <p className="text-sm text-slate-500">{r.cycle?.status === "active" ? "Pending." : "Not submitted."}</p>}
        </Card>
      </div>

      {canFinalize && (
        <Card title="Finalize review" className="mt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Final rating (1–5)" required error={fErr} className="sm:w-48">
              <Input type="number" min={1} max={5} step="0.01" value={finalRating} onChange={(e) => setFinalRating(e.target.value)} placeholder={r.manager_rating ? String(r.manager_rating) : "e.g. 3.5"} />
            </Field>
            <Button onClick={askFinalize}>Finalize</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Finalizing shares the manager assessment, goal score and final rating with the employee. It cannot be undone.</p>
        </Card>
      )}
    </Modal>
      <ConfirmDialog open={confirmFinal} onClose={() => setConfirmFinal(false)} title="Finalize review"
        message={`Finalize ${fullName(r.employee)}'s review with a final rating of ${finalRating}? The employee is notified and the review becomes read-only.`}
        confirmLabel="Finalize" onConfirm={async () => {
          const res = await finalizeReview(r.id, finalRating);
          if (!res.error) { notify("Review finalized."); setFinalRating(""); review.reload(); onChanged(); }
          return res;
        }} />
    </>
  );
}

// =====================================================================
// Goals
// =====================================================================
function GoalsTab({ cycles, defaultCycle, employees }) {
  const p = usePerms();
  const { notify } = useToast();
  const [cycle, setCycle] = useState(defaultCycle);
  const [employee, setEmployee] = useState("");
  const kpis = useHrQuery(() => listKpis(), []);
  const q = useHrQuery(() => (cycle ? listGoals({ cycle, employee }) : Promise.resolve({ data: [], error: null })), [cycle, employee]);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const cyc = (cycles ?? []).find((c) => c.id === cycle);
  const closed = cyc?.status === "closed";
  const canWrite = p.writeGoals && !closed;
  const weight = totalWeight(q.data);

  const columns = [
    ...(!employee ? [{ key: "employee", header: "Employee", sortable: true, sortValue: (r) => fullName(r.employee).toLowerCase(), render: (r) => fullName(r.employee) || "—" }] : []),
    { key: "title", header: "Goal", render: (r) => <div className="min-w-[12rem]"><p className="font-semibold text-[#101a3a]">{r.title}</p>{r.description && <p className="line-clamp-2 text-xs text-slate-500">{r.description}</p>}</div> },
    { key: "kpi", header: "KPI", render: (r) => (r.kpi ? <span>{r.kpi.name}<span className="block text-xs text-slate-500">{lbl(r.kpi.formula_type)} · {lbl(r.kpi.direction)}</span></span> : "Manual / ratio") },
    { key: "weight", header: "Weight", sortable: true, render: (r) => `${fmtNum(r.weight)}%` },
    { key: "target_value", header: "Target", render: (r) => `${fmtNum(r.target_value, 4)}${r.kpi?.unit ? ` ${r.kpi.unit}` : ""}` },
    { key: "actual_value", header: "Actual", render: (r) => fmtNum(r.actual_value, 4) },
    { key: "score", header: "Score", sortable: true, render: (r) => (r.score != null ? `${fmtNum(r.score)}%` : "—") },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    ...(canWrite ? [{ key: "_actions", header: <span className="sr-only">Actions</span>, render: (r) => (
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
        {r.status === "draft" && <Button size="sm" variant="ghost" aria-label={`Delete goal ${r.title}`} onClick={() => setDeleting(r)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>}
      </div>) }] : []),
  ];
  const tone = weight > 100 ? "bg-red-500" : weight === 100 ? "bg-emerald-500" : "bg-amber-500";
  return (
    <>
      <Toolbar>
        <Select aria-label="Cycle" className="sm:w-60" placeholder="Choose a cycle" value={cycle} onChange={(e) => setCycle(e.target.value)} options={(cycles ?? []).map((c) => ({ value: c.id, label: cycleLabel(c) }))} />
        <Select aria-label="Employee" className="sm:w-64" placeholder="All employees" value={employee} onChange={(e) => setEmployee(e.target.value)} options={employees.data ?? []} />
        {canWrite && employee && <Button onClick={() => setEditing({})}><Plus className="h-4 w-4" aria-hidden="true" />Add goal</Button>}
      </Toolbar>
      {!cycle ? <EmptyState title="Choose a review cycle" description="Create a cycle first if none exist." /> : (
        <>
          {employee && (
            <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3" aria-live="polite">
              <div className="flex items-center justify-between text-sm"><span className="font-semibold text-[#101a3a]">Total goal weight</span><span className={weight > 100 ? "font-bold text-red-600" : "font-bold text-[#101a3a]"}>{fmtNum(weight)}% / 100%</span></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Total goal weight" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, weight)}>
                <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, weight)}%` }} />
              </div>
              {weight < 100 && <p className="mt-1 text-xs text-slate-500">{fmtNum(100 - weight)}% unallocated. Weighted scores use the weights as entered.</p>}
            </div>
          )}
          {closed && <p className="mb-3 text-sm text-slate-600">This cycle is closed; goals are read-only.</p>}
          {!employee && p.writeGoals && !closed && <p className="mb-3 text-sm text-slate-600">Choose an employee to add goals.</p>}
          <DataTable caption="Goals" columns={columns} rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} emptyTitle="No goals" />
          <p className="mt-2 text-xs text-slate-500">Scores are computed by the database from the KPI formula, target and actual; run "Compute scores" on the cycle to refresh review totals.</p>
        </>
      )}
      {editing && <GoalModal goal={editing} cycleId={cycle} employeeId={editing.employee_id ?? employee} kpis={kpis.data} otherWeight={weight - Number(editing.weight || 0)}
        onClose={() => setEditing(null)} onSaved={(isNew) => { setEditing(null); q.reload(); notify(isNew ? "Goal added." : "Goal updated."); }} />}
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} tone="danger" title="Delete draft goal" message={deleting ? `Delete "${deleting.title}"?` : ""} confirmLabel="Delete"
        onConfirm={async () => { const res = await deleteGoal(deleting.id); if (!res.error) { q.reload(); notify("Goal deleted."); } return res; }} />
    </>
  );
}

/** Goal editor for HR (performance.manage) and managers (performance.review_team). */
function GoalModal({ goal, cycleId, employeeId, kpis, otherWeight, onClose, onSaved }) {
  const isNew = !goal.id;
  const [v, setV] = useState({ title: goal.title ?? "", description: goal.description ?? "", kpi_id: goal.kpi_id ?? "", weight: goal.weight ?? "", target_value: goal.target_value ?? "", actual_value: goal.actual_value ?? "", status: goal.status ?? "draft" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const kpi = (kpis ?? []).find((k) => k.id === v.kpi_id);
  function pickKpi(e) {
    const id = e.target.value;
    const k = (kpis ?? []).find((x) => x.id === id);
    setV((s) => ({ ...s, kpi_id: id, weight: isBlank(s.weight) && k ? k.default_weight : s.weight }));
  }
  async function save() {
    const errs = {};
    if (v.title.trim().length < 2 || v.title.trim().length > 200) errs.title = "Enter a title of 2–200 characters.";
    if (!isNum(v.weight) || Number(v.weight) < 0 || Number(v.weight) > 100) errs.weight = "Weight must be 0–100.";
    else if (otherWeight + Number(v.weight) > 100) errs.weight = `Total weight would be ${fmtNum(otherWeight + Number(v.weight))}%; the maximum is 100%.`;
    if (!isBlank(v.target_value) && !isNum(v.target_value)) errs.target_value = "Enter a number.";
    if (!isBlank(v.actual_value) && !isNum(v.actual_value)) errs.actual_value = "Enter a number.";
    if (kpi && kpi.formula_type !== "manual" && isBlank(v.target_value)) errs.target_value = "This KPI needs a target to be scored.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const values = { ...v, title: v.title.trim(), employee_id: employeeId, cycle_id: cycleId };
    const res = isNew ? await createGoal(values) : await updateGoal(goal.id, values);
    setBusy(false);
    if (res.error) setError(res.error); else onSaved(isNew);
  }
  return (
    <Modal open onClose={onClose} title={isNew ? "Add goal" : "Edit goal"} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Title" required error={errors.title} className="sm:col-span-2"><Input value={v.title} onChange={set("title")} maxLength={200} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea value={v.description} onChange={set("description")} /></Field>
        <Field label="KPI" hint={kpi ? `${lbl(kpi.formula_type)} · ${lbl(kpi.direction)}${kpi.unit ? ` · unit: ${kpi.unit}` : ""}` : "Without a KPI: a target is scored as actual ÷ target; no target means the actual is the score."}>
          <Select placeholder="— No KPI —" value={v.kpi_id} onChange={pickKpi} options={(kpis ?? []).filter((k) => k.active || k.id === goal.kpi_id).map((k) => ({ value: k.id, label: k.name }))} />
        </Field>
        <Field label="Weight (%)" required error={errors.weight} hint={`Other goals: ${fmtNum(otherWeight)}%`}><Input type="number" min={0} max={100} step="0.01" value={v.weight} onChange={set("weight")} /></Field>
        <Field label="Target" error={errors.target_value}><Input type="number" step="any" value={v.target_value} onChange={set("target_value")} /></Field>
        <Field label="Actual" error={errors.actual_value}><Input type="number" step="any" value={v.actual_value} onChange={set("actual_value")} /></Field>
        <Field label="Status"><Select value={v.status} onChange={set("status")} options={opts(GOAL_STATUSES)} /></Field>
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

// =====================================================================
// Improvement plans
// =====================================================================
function PlansTab({ employees }) {
  const p = usePerms();
  const { notify } = useToast();
  const [status, setStatus] = useState("active");
  const [employee, setEmployee] = useState("");
  const q = useHrQuery(() => listPlans({ status, employee }), [status, employee]);
  const [editing, setEditing] = useState(null);
  const columns = [
    { key: "employee", header: "Employee", sortable: true, sortValue: (r) => fullName(r.employee).toLowerCase(), render: (r) => <span className="font-semibold text-[#101a3a]">{fullName(r.employee) || "—"}</span> },
    { key: "owner", header: "Owner", render: (r) => (r.owner ? fullName(r.owner) : "—") },
    { key: "period", header: "Period", sortable: true, sortValue: (r) => r.start_date, render: (r) => <span className="whitespace-nowrap">{formatDate(r.start_date)} – {formatDate(r.end_date)}</span> },
    { key: "objectives", header: "Objectives", render: (r) => <span className="line-clamp-2 max-w-md">{r.objectives}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];
  return (
    <>
      <Toolbar>
        <Select aria-label="Status" className="sm:w-40" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: "", label: "All statuses" }, ...opts(PLAN_STATUSES)]} />
        <Select aria-label="Employee" className="sm:w-64" placeholder="All employees" value={employee} onChange={(e) => setEmployee(e.target.value)} options={employees.data ?? []} />
        {p.writeGoals && <Button onClick={() => setEditing({})}><Plus className="h-4 w-4" aria-hidden="true" />New plan</Button>}
      </Toolbar>
      <DataTable caption="Improvement plans" columns={columns} rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} onRowClick={setEditing} emptyTitle="No improvement plans" />
      {editing && <PlanModal plan={editing} employees={employees.data} canEdit={p.writeGoals} me={p.me} onClose={() => setEditing(null)}
        onSaved={(isNew) => { setEditing(null); q.reload(); notify(isNew ? "Improvement plan created; the employee has been notified in the portal." : "Improvement plan updated."); }} />}
    </>
  );
}

function PlanModal({ plan, employees, canEdit, me, onClose, onSaved }) {
  const isNew = !plan.id;
  const [v, setV] = useState({ employee_id: plan.employee_id ?? "", owner_id: plan.owner_id ?? me ?? "", start_date: plan.start_date ?? "", end_date: plan.end_date ?? "", objectives: plan.objectives ?? "", support: plan.support ?? "", status: plan.status ?? "active", outcome_notes: plan.outcome_notes ?? "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const readOnly = !canEdit;
  async function save() {
    const errs = {};
    if (isNew && !v.employee_id) errs.employee_id = "Choose the employee.";
    if (v.owner_id && v.owner_id === (plan.employee_id ?? v.employee_id)) errs.owner_id = "The owner cannot be the employee.";
    if (!v.start_date) errs.start_date = "Required.";
    if (!v.end_date) errs.end_date = "Required.";
    if (v.start_date && v.end_date && v.end_date < v.start_date) errs.end_date = "Must be on or after the start.";
    if (!v.objectives.trim()) errs.objectives = "Describe the objectives.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const values = { ...v, objectives: v.objectives.trim() };
    if (isNew) { delete values.outcome_notes; values.status = "active"; }
    const res = isNew ? await createPlan(values) : await updatePlan(plan.id, values);
    setBusy(false);
    if (res.error) setError(res.error); else onSaved(isNew);
  }
  return (
    <Modal open onClose={onClose} title={isNew ? "New improvement plan" : `Improvement plan: ${fullName(plan.employee)}`} size="lg"
      footer={readOnly ? <Button variant="secondary" onClick={onClose}>Close</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{isNew ? "Create plan" : "Save"}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {isNew && <Field label="Employee" required error={errors.employee_id}><Select placeholder="Choose" value={v.employee_id} onChange={set("employee_id")} options={(employees ?? []).filter((e) => e.value !== me)} /></Field>}
        <Field label="Owner" error={errors.owner_id}><Select placeholder="— None —" value={v.owner_id} disabled={readOnly} onChange={set("owner_id")} options={employees ?? []} /></Field>
        <Field label="Start date" required error={errors.start_date}><Input type="date" value={v.start_date} disabled={readOnly} onChange={set("start_date")} /></Field>
        <Field label="End date" required error={errors.end_date}><Input type="date" value={v.end_date} disabled={readOnly} onChange={set("end_date")} /></Field>
        <Field label="Objectives" required error={errors.objectives} className="sm:col-span-2"><Textarea rows={4} value={v.objectives} disabled={readOnly} onChange={set("objectives")} /></Field>
        <Field label="Support provided" className="sm:col-span-2"><Textarea value={v.support} disabled={readOnly} onChange={set("support")} /></Field>
        {!isNew && <Field label="Status"><Select value={v.status} disabled={readOnly} onChange={set("status")} options={opts(PLAN_STATUSES)} /></Field>}
        {!isNew && <Field label="Outcome notes" className="sm:col-span-2"><Textarea value={v.outcome_notes} disabled={readOnly} onChange={set("outcome_notes")} /></Field>}
      </div>
      {isNew && <p className="mt-2 text-xs text-slate-500">The employee is notified in the portal when the plan is created.</p>}
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

// =====================================================================
// Feedback
// =====================================================================
function FeedbackTab({ employees }) {
  const p = usePerms();
  const { notify } = useToast();
  const [employee, setEmployee] = useState("");
  const q = useHrQuery(() => listFeedback({ employee }), [employee]);
  const [giving, setGiving] = useState(false);
  const columns = [
    { key: "created_at", header: "When", sortable: true, render: (r) => formatDateTime(r.created_at) },
    { key: "subject", header: "About", render: (r) => fullName(r.subject) || "—" },
    { key: "author", header: "From", render: (r) => (r.from_employee_id === p.me ? "You" : fullName(r.author) || "—") },
    { key: "feedback_type", header: "Type", render: (r) => <Badge tone={r.feedback_type === "praise" ? "green" : r.feedback_type === "constructive" ? "amber" : "slate"}>{lbl(r.feedback_type)}</Badge> },
    { key: "visibility", header: "Visibility", render: (r) => (r.visibility === "private_to_hr" ? <Badge>private to HR</Badge> : <Badge tone="blue">shared</Badge>) },
    { key: "body", header: "Feedback", render: (r) => <span className="line-clamp-3 max-w-md whitespace-pre-wrap">{r.body}</span> },
  ];
  return (
    <>
      <Toolbar>
        <Select aria-label="About employee" className="sm:w-64" placeholder="All feedback I can see" value={employee} onChange={(e) => setEmployee(e.target.value)} options={employees.data ?? []} />
        <Button onClick={() => setGiving(true)}><MessageSquarePlus className="h-4 w-4" aria-hidden="true" />Give feedback</Button>
      </Toolbar>
      <DataTable caption="Performance feedback" columns={columns} rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} emptyTitle="No feedback yet" />
      {giving && <GiveFeedbackModal employees={employees.data} me={p.me} onClose={() => setGiving(false)} onSaved={(shared) => { setGiving(false); q.reload(); notify(shared ? "Feedback shared; the employee has been notified." : "Feedback recorded (private to HR)."); }} />}
    </>
  );
}

function GiveFeedbackModal({ employees, me, onClose, onSaved }) {
  const [v, setV] = useState({ employee_id: "", feedback_type: "praise", visibility: "manager_and_employee", body: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    const errs = {};
    if (!v.employee_id) errs.employee_id = "Choose who the feedback is about.";
    if (!v.body.trim()) errs.body = "Write the feedback.";
    else if (v.body.trim().length > 5000) errs.body = "Keep it under 5000 characters.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await giveFeedback(me, v);
    setBusy(false);
    if (res.error) setError(res.error); else onSaved(v.visibility === "manager_and_employee");
  }
  return (
    <Modal open onClose={onClose} title="Give feedback" size="md" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Submit</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="About" required error={errors.employee_id}><Select placeholder="Choose an employee" value={v.employee_id} onChange={set("employee_id")} options={(employees ?? []).filter((e) => e.value !== me)} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Type"><Select value={v.feedback_type} onChange={set("feedback_type")} options={opts(FEEDBACK_TYPES)} /></Field>
          <Field label="Visibility"><Select value={v.visibility} onChange={set("visibility")} options={FEEDBACK_VISIBILITY} /></Field>
        </div>
        <Field label="Feedback" required error={errors.body}><Textarea rows={6} value={v.body} onChange={set("body")} maxLength={5000} /></Field>
        <p className="text-xs text-slate-500">{v.visibility === "private_to_hr" ? "Only HR (performance.view / manage) and you can read this feedback." : "The employee and their manager can read this feedback; the employee is notified."} Feedback cannot be edited or deleted.</p>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}
