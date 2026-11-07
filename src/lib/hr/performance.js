// Performance & KPI (migrations 106 + 206): review cycles, KPI templates,
// goals + progress updates, reviews (self -> manager -> HR calibration ->
// finalized), review meetings, improvement plans (PIP) and feedback.
// Cycles, KPI templates, goals, plans and feedback are direct table writes
// allowed by RLS; every workflow step is a SECURITY DEFINER RPC. RLS limits
// every read: employee = own, manager = reporting line, HR = everyone.
import { from, rpc, run } from "./client";

const EMP = "id, employee_code, first_name, last_name, display_name, manager_id, department_id, status";
const GOAL_EMP = `employee:hr_employees!hr_goals_employee_id_fkey(${EMP})`;
const REV_EMP = `employee:hr_employees!hr_performance_reviews_employee_id_fkey(${EMP})`;
const REV_MGR = "manager:hr_employees!hr_performance_reviews_manager_id_fkey(id, employee_code, first_name, last_name, display_name)";
const PIP_EMP = `employee:hr_employees!hr_improvement_plans_employee_id_fkey(${EMP})`;
const PIP_OWNER = "owner:hr_employees!hr_improvement_plans_owner_id_fkey(id, first_name, last_name, display_name)";
const KPI = "kpi:hr_kpi_definitions(id, name, unit, direction, formula_type, category)";
const CYCLE = "cycle:hr_review_cycles(id, name, status, cycle_type, period_start, period_end, self_assessment_due, manager_review_due)";

const clean = (v) => (typeof v === "string" ? v.trim() || null : v ?? null);
const numOrNull = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

// ----------------------------------------------------------------- people
/** Employees the caller may read (RLS), with manager_id for reporting-line checks. */
export async function listPerfEmployees() {
  return run(from("hr_employees").select(EMP).not("status", "in", "(exited,archived)").order("first_name").limit(2000));
}

/** Is `target` in `me`'s reporting line (direct or indirect)? employees: rows with id + manager_id. */
export function inReportingLine(employees, me, target) {
  if (!me || !target || me === target) return false;
  const byId = new Map((employees ?? []).map((e) => [e.id, e]));
  let cur = byId.get(target);
  for (let i = 0; cur && i < 20; i++) {
    if (cur.manager_id === me) return true;
    cur = byId.get(cur.manager_id);
  }
  return false;
}

// ----------------------------------------------------------------- cycles
export const listCycles = () => run(from("hr_review_cycles").select("*").order("period_start", { ascending: false }).limit(500));

export async function saveCycle(values, id) {
  const body = {
    name: clean(values.name), cycle_type: values.cycle_type, period_start: values.period_start, period_end: values.period_end,
    self_assessment_due: values.self_assessment_due || null, manager_review_due: values.manager_review_due || null,
  };
  return id
    ? run(from("hr_review_cycles").update(body).eq("id", id).select("id").single())
    : run(from("hr_review_cycles").insert(body).select("id").single());
}
export const startCycle = (id) => rpc("hr_start_review_cycle", { p_cycle: id });
export const closeCycle = (id) => rpc("hr_close_review_cycle", { p_cycle: id });
export const computeScores = (id) => rpc("hr_compute_goal_scores", { p_cycle: id });

// ----------------------------------------------------------------- KPI templates
export async function listKpis({ activeOnly = false } = {}) {
  let q = from("hr_kpi_definitions").select("*").order("name").limit(1000);
  if (activeOnly) q = q.eq("active", true);
  return run(q);
}

export async function saveKpi(values, id) {
  const body = {
    name: clean(values.name), description: clean(values.description), category: clean(values.category), unit: clean(values.unit),
    measurement: clean(values.measurement), direction: values.direction, formula_type: values.formula_type,
    default_weight: Number(values.default_weight || 0), default_target: numOrNull(values.default_target), active: values.active !== false,
  };
  return id
    ? run(from("hr_kpi_definitions").update(body).eq("id", id).select("id").single())
    : run(from("hr_kpi_definitions").insert(body).select("id").single());
}

// ----------------------------------------------------------------- goals
export async function listGoals({ cycle = "", employee = "" } = {}) {
  let q = from("hr_goals").select(`*, ${GOAL_EMP}, ${KPI}, ${CYCLE}`).order("created_at").limit(5000);
  if (cycle) q = q.eq("cycle_id", cycle);
  if (employee) q = q.eq("employee_id", employee);
  return run(q);
}

export async function saveGoal(values, id) {
  const body = {
    title: clean(values.title), description: clean(values.description), kpi_id: values.kpi_id || null,
    weight: Number(values.weight || 0), target_value: numOrNull(values.target_value), due_date: values.due_date || null,
  };
  if (!id) {
    body.employee_id = values.employee_id; body.cycle_id = values.cycle_id;
    if (values.status) body.status = values.status;
    return run(from("hr_goals").insert(body).select("id").single());
  }
  return run(from("hr_goals").update(body).eq("id", id).select("id").single());
}

/** Insert the same goal / KPI for several employees (each row passes the weight check on its own). */
export async function assignGoals(employees, values) {
  const rows = employees.map((e) => ({
    employee_id: e, cycle_id: values.cycle_id, kpi_id: values.kpi_id || null, title: clean(values.title), description: clean(values.description),
    weight: Number(values.weight || 0), target_value: numOrNull(values.target_value), due_date: values.due_date || null,
  }));
  return run(from("hr_goals").insert(rows).select("id"));
}

export const deleteGoal = (id) => run(from("hr_goals").delete().eq("id", id));
export const setGoalStatus = (id, status) => run(from("hr_goals").update({ status }).eq("id", id).select("id").single());
export const agreeGoalSheet = (employee, cycle) => rpc("hr_agree_goal_sheet", { p_employee: employee, p_cycle: cycle });
export const recordProgress = (goal, actual, note) => rpc("hr_record_goal_progress", { p_goal: goal, p_actual: Number(actual), p_note: note || null });

export async function listProgress({ goal = "", employee = "" } = {}) {
  let q = from("hr_goal_progress_updates").select("*, goal:hr_goals(id, title)").order("created_at", { ascending: false }).limit(1000);
  if (goal) q = q.eq("goal_id", goal);
  if (employee) q = q.eq("employee_id", employee);
  return run(q);
}

// ----------------------------------------------------------------- reviews
export async function listReviews({ cycle = "", employee = "" } = {}) {
  let q = from("hr_performance_reviews").select(`*, ${REV_EMP}, ${REV_MGR}, ${CYCLE}`).order("created_at", { ascending: false }).limit(5000);
  if (cycle) q = q.eq("cycle_id", cycle);
  if (employee) q = q.eq("employee_id", employee);
  return run(q);
}

export const submitSelfAssessment = (review, text, rating) => rpc("hr_submit_self_assessment", { p_review: review, p_assessment: text, p_rating: Number(rating) });
export const submitManagerAssessment = (review, text, rating) => rpc("hr_submit_manager_assessment", { p_review: review, p_assessment: text, p_rating: Number(rating) });
export const returnReview = (review, reason) => rpc("hr_return_performance_review", { p_review: review, p_reason: reason });
export const finalizeReview = (review, rating, notes) => rpc("hr_finalize_performance_review", { p_review: review, p_final_rating: Number(rating), p_calibration_notes: notes || null });

/** Employee: own reviews (manager fields hidden until finalized). */
export async function listMyReviews() {
  const res = await rpc("hr_my_performance_reviews");
  return { ...res, data: res.data ?? (res.error ? null : []) };
}

// ----------------------------------------------------------------- meetings
export async function listMeetings(employee) {
  const res = await rpc("hr_list_review_meetings", employee ? { p_employee: employee } : {});
  return { ...res, data: res.data ?? (res.error ? null : []) };
}

export const saveMeeting = (v, id) => rpc("hr_save_review_meeting", {
  p_meeting: id ?? null, p_employee: v.employee_id, p_scheduled_at: new Date(v.scheduled_at).toISOString(), p_review: v.review_id || null,
  p_meeting_type: v.meeting_type || "review", p_duration_minutes: Number(v.duration_minutes || 30), p_mode: v.mode || "in_person",
  p_location: v.location || null, p_attendees: v.attendee_ids ?? [], p_agenda: v.agenda || null,
});
export const completeMeeting = (id, notes, actionItems) => rpc("hr_complete_review_meeting", { p_meeting: id, p_notes: notes, p_action_items: actionItems || null });
export const cancelMeeting = (id, reason) => rpc("hr_cancel_review_meeting", { p_meeting: id, p_reason: reason || null });

// ----------------------------------------------------------------- improvement plans
export async function listPlans({ employee = "" } = {}) {
  let q = from("hr_improvement_plans").select(`*, ${PIP_EMP}, ${PIP_OWNER}`).order("start_date", { ascending: false }).limit(2000);
  if (employee) q = q.eq("employee_id", employee);
  return run(q);
}

export async function savePlan(values, id) {
  const body = {
    title: clean(values.title), objectives: clean(values.objectives), success_criteria: clean(values.success_criteria), support: clean(values.support),
    start_date: values.start_date, end_date: values.end_date, owner_id: values.owner_id || null, review_id: values.review_id || null,
  };
  if (!id) return run(from("hr_improvement_plans").insert({ ...body, employee_id: values.employee_id }).select("id").single());
  return run(from("hr_improvement_plans").update(body).eq("id", id).select("id").single());
}

export async function listCheckins({ plan = "", employee = "" } = {}) {
  let q = from("hr_improvement_plan_checkins").select("*").order("checkin_date", { ascending: false }).order("created_at", { ascending: false }).limit(2000);
  if (plan) q = q.eq("plan_id", plan);
  if (employee) q = q.eq("employee_id", employee);
  return run(q);
}

export const addCheckin = (plan, v) => rpc("hr_add_improvement_checkin", { p_plan: plan, p_checkin_date: v.checkin_date, p_progress: v.progress, p_notes: v.notes });
export const closePlan = (plan, outcome, notes, newEnd) => rpc("hr_close_improvement_plan", { p_plan: plan, p_outcome: outcome, p_notes: notes, p_new_end_date: newEnd || null });
export const acknowledgePlan = (plan, comment) => rpc("hr_acknowledge_improvement_plan", { p_plan: plan, p_comment: comment || null });

// ----------------------------------------------------------------- feedback
export async function listFeedback({ employee = "" } = {}) {
  let q = from("hr_performance_feedback")
    .select("*, employee:hr_employees!hr_performance_feedback_employee_id_fkey(id, employee_code, first_name, last_name, display_name), author:hr_employees!hr_performance_feedback_from_employee_id_fkey(id, first_name, last_name, display_name)")
    .order("created_at", { ascending: false }).limit(2000);
  if (employee) q = q.eq("employee_id", employee);
  return run(q);
}

export const giveFeedback = (v) => run(from("hr_performance_feedback").insert({
  employee_id: v.employee_id, feedback_type: v.feedback_type, body: clean(v.body), visibility: v.visibility, review_id: v.review_id || null,
}).select("id").single());

export async function listMyFeedback() {
  const res = await rpc("hr_my_performance_feedback");
  return { ...res, data: res.data ?? (res.error ? null : []) };
}
