// Performance & KPI (migration 106_hr_performance.sql). Cycles are created as
// drafts and activated only by hr_start_review_cycle; reviews are written only
// through RPCs; goal scores are computed by the database (never sent from
// here). Goals, feedback and improvement plans are direct writes under RLS.
import { from, rpc, run } from "./client";

export const CYCLE_TYPES = ["monthly", "quarterly", "annual", "intern"];
export const CYCLE_STATUSES = ["draft", "active", "closed"];
export const REVIEW_STATUSES = ["not_started", "self_review", "manager_review", "finalized"];
export const GOAL_STATUSES = ["draft", "agreed", "in_progress", "achieved", "missed"];
export const FEEDBACK_TYPES = ["praise", "constructive", "note"];
export const FEEDBACK_VISIBILITY = [
  { value: "private_to_hr", label: "Private to HR" },
  { value: "manager_and_employee", label: "Shared with the employee and their manager" },
];
export const PLAN_STATUSES = ["active", "completed", "extended", "failed"];
export const KPI_DIRECTIONS = ["higher_is_better", "lower_is_better", "target_exact"];
export const KPI_FORMULAS = ["ratio", "inverse_ratio", "binary", "manual"];
export const RATING_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} — ${["Needs significant improvement", "Below expectations", "Meets expectations", "Exceeds expectations", "Outstanding"][n - 1]}` }));

export const label = (s) => (s ? String(s).replace(/_/g, " ") : "—");
export const opts = (list) => list.map((v) => ({ value: v, label: label(v) }));

const EMP = "id, employee_code, first_name, last_name, display_name";
const clean = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k] === "" ? null : obj[k]]));
const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

// ---------------------------------------------------------------- cycles
export async function listCycles({ status = "" } = {}) {
  let q = from("hr_review_cycles").select("id, name, cycle_type, period_start, period_end, self_assessment_due, manager_review_due, status, started_at, closed_at, created_at");
  if (status) q = q.eq("status", status);
  return run(q.order("period_start", { ascending: false }).limit(500));
}

const CYCLE_FIELDS = ["name", "cycle_type", "period_start", "period_end", "self_assessment_due", "manager_review_due"];
export async function createCycle(v) {
  return run(from("hr_review_cycles").insert({ ...clean(v, CYCLE_FIELDS), status: "draft" }).select("id").single());
}
export async function updateCycle(id, v) {
  return run(from("hr_review_cycles").update(clean(v, CYCLE_FIELDS)).eq("id", id).select("id").single());
}
export async function closeCycle(id) {
  return run(from("hr_review_cycles").update({ status: "closed" }).eq("id", id).select("id").single());
}
export const startCycle = (id) => rpc("hr_start_review_cycle", { p_cycle: id });
export const computeScores = (id) => rpc("hr_compute_goal_scores", { p_cycle: id });

// ---------------------------------------------------------------- KPIs
export async function listKpis({ activeOnly = false } = {}) {
  let q = from("hr_kpi_definitions").select("id, name, description, unit, direction, formula_type, default_weight, active");
  if (activeOnly) q = q.eq("active", true);
  return run(q.order("name"));
}

// ---------------------------------------------------------------- reviews
const REVIEW_COLUMNS = `id, employee_id, cycle_id, self_assessment, self_rating, self_submitted_at, manager_id, manager_assessment, manager_rating,
  manager_submitted_at, goal_score, final_rating, finalized_at, status, is_confidential, updated_at,
  employee:hr_employees!hr_performance_reviews_employee_id_fkey(${EMP}, manager_id, department:hr_departments!hr_employees_department_id_fkey(id, name)),
  manager:hr_employees!hr_performance_reviews_manager_id_fkey(${EMP}),
  cycle:hr_review_cycles!hr_performance_reviews_cycle_id_fkey(id, name, cycle_type, status, period_start, period_end, self_assessment_due, manager_review_due)`;

export async function listReviews({ cycle = "", status = "" } = {}) {
  let q = from("hr_performance_reviews").select(REVIEW_COLUMNS).limit(3000);
  if (cycle) q = q.eq("cycle_id", cycle);
  if (status) q = q.eq("status", status);
  return run(q.order("updated_at", { ascending: false }));
}
export async function getReview(id) {
  return run(from("hr_performance_reviews").select(REVIEW_COLUMNS).eq("id", id).maybeSingle());
}
export const submitManagerAssessment = (id, assessment, rating) =>
  rpc("hr_submit_manager_assessment", { p_review: id, p_assessment: assessment?.trim(), p_rating: Number(rating) });
export const finalizeReview = (id, finalRating) => rpc("hr_finalize_performance_review", { p_review: id, p_final_rating: Number(finalRating) });
export const submitSelfAssessment = (id, assessment, rating) =>
  rpc("hr_submit_self_assessment", { p_review: id, p_assessment: assessment?.trim(), p_rating: Number(rating) });
export async function myReviews() {
  const res = await rpc("hr_my_performance_reviews");
  return { ...res, data: res.error ? null : (Array.isArray(res.data) ? res.data : []) };
}

// ---------------------------------------------------------------- goals
const GOAL_COLUMNS = `id, employee_id, cycle_id, kpi_id, title, description, weight, target_value, actual_value, score, status, created_at, updated_at,
  kpi:hr_kpi_definitions!hr_goals_kpi_id_fkey(id, name, unit, direction, formula_type),
  employee:hr_employees!hr_goals_employee_id_fkey(${EMP})`;

export async function listGoals({ cycle = "", employee = "", cycles = null } = {}) {
  let q = from("hr_goals").select(GOAL_COLUMNS).limit(2000);
  if (cycle) q = q.eq("cycle_id", cycle);
  if (cycles) q = q.in("cycle_id", cycles.length ? cycles : ["00000000-0000-0000-0000-000000000000"]);
  if (employee) q = q.eq("employee_id", employee);
  return run(q.order("created_at"));
}

const GOAL_FIELDS = ["employee_id", "cycle_id", "kpi_id", "title", "description", "weight", "target_value", "actual_value", "status"];
function goalBody(v) {
  const b = clean(v, GOAL_FIELDS);
  for (const k of ["weight", "target_value", "actual_value"]) if (k in b) b[k] = num(b[k]);
  if ("weight" in b && b.weight == null) b.weight = 0;
  return b;
}
// RLS silently skips rows the caller may not change; an update/delete that
// touched nothing is reported as an error instead of a fake success.
async function touched(query, what) {
  const res = await run(query);
  if (res.error) return res;
  if (!res.data?.length) return { data: null, error: `The ${what} was not changed: it no longer exists or you are not allowed to change it.` };
  return { data: res.data[0], error: null };
}
// Inserts are not read back: a caller may be allowed to write a row without a
// read path to it, and a failed read-back must not look like a failed write.
export async function createGoal(v) {
  return run(from("hr_goals").insert(goalBody(v)));
}
export async function updateGoal(id, v) {
  const b = goalBody(v);
  delete b.employee_id; delete b.cycle_id;
  return touched(from("hr_goals").update(b).eq("id", id).select("id"), "goal");
}
export async function deleteGoal(id) {
  return touched(from("hr_goals").delete().eq("id", id).select("id"), "goal");
}
export const totalWeight = (goals) => Math.round((goals ?? []).reduce((s, g) => s + Number(g.weight || 0), 0) * 100) / 100;

// ---------------------------------------------------------------- feedback
const FEEDBACK_COLUMNS = `id, employee_id, review_id, from_employee_id, feedback_type, body, visibility, created_at,
  subject:hr_employees!hr_performance_feedback_employee_id_fkey(${EMP}),
  author:hr_employees!hr_performance_feedback_from_employee_id_fkey(${EMP})`;

export async function listFeedback({ employee = "" } = {}) {
  let q = from("hr_performance_feedback").select(FEEDBACK_COLUMNS).limit(1000);
  if (employee) q = q.eq("employee_id", employee);
  return run(q.order("created_at", { ascending: false }));
}
export async function giveFeedback(fromEmployeeId, v) {
  return run(from("hr_performance_feedback").insert({
    employee_id: v.employee_id, from_employee_id: fromEmployeeId, review_id: v.review_id || null,
    feedback_type: v.feedback_type, body: v.body?.trim(), visibility: v.visibility || "private_to_hr",
  }));
}

// ---------------------------------------------------------------- improvement plans
const PLAN_COLUMNS = `id, employee_id, review_id, start_date, end_date, objectives, support, status, owner_id, outcome_notes, created_at, updated_at,
  employee:hr_employees!hr_improvement_plans_employee_id_fkey(${EMP}),
  owner:hr_employees!hr_improvement_plans_owner_id_fkey(${EMP})`;

export async function listPlans({ status = "", employee = "" } = {}) {
  let q = from("hr_improvement_plans").select(PLAN_COLUMNS).limit(1000);
  if (status) q = q.eq("status", status);
  if (employee) q = q.eq("employee_id", employee);
  return run(q.order("start_date", { ascending: false }));
}
const PLAN_FIELDS = ["employee_id", "start_date", "end_date", "objectives", "support", "status", "owner_id", "outcome_notes"];
export async function createPlan(v) {
  return run(from("hr_improvement_plans").insert(clean(v, PLAN_FIELDS)));
}
export async function updatePlan(id, v) {
  const b = clean(v, PLAN_FIELDS);
  delete b.employee_id;
  return touched(from("hr_improvement_plans").update(b).eq("id", id).select("id"), "improvement plan");
}
