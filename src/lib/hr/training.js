// Training: catalogue (categories + courses, direct writes with
// training.manage) and assignments (RPC-only writes; visible to the
// employee, training.view and the manager's reporting line).
import { from, rpc, run } from "./client";

export const DELIVERY_MODES = ["online", "classroom", "self_paced", "on_the_job", "webinar", "external"];
export const ASSIGNMENT_STATUSES = ["assigned", "in_progress", "completed", "cancelled"];
export const RESULTS = ["passed", "failed", "attended"];

const EMP = "id, employee_code, first_name, last_name, display_name, manager_id";
const today = () => new Date().toLocaleDateString("en-CA");

export const isOverdue = (a) => Boolean(a?.due_date && ["assigned", "in_progress"].includes(a.status) && a.due_date < today());

export async function listTrainingCategories() {
  return run(from("hr_training_categories").select("*").order("sort_order").order("name"));
}

export async function listCourses({ activeOnly = false } = {}) {
  let q = from("hr_training_courses").select("*, category:hr_training_categories(id, name)").order("title");
  if (activeOnly) q = q.eq("active", true);
  return run(q);
}

/** status: "open" | "overdue" | "unverified" | concrete status | "" (all). */
export async function listAssignments({ status = "open", course = "", employee = "" } = {}) {
  let q = from("hr_training_assignments").select(`*, course:hr_training_courses(id, code, title, is_mandatory, certificate_required, pass_score),
    employee:hr_employees!hr_training_assignments_employee_id_fkey(${EMP}),
    certificate:hr_documents(id, title)`).limit(3000);
  if (status === "open" || status === "overdue") q = q.in("status", ["assigned", "in_progress"]);
  else if (status === "unverified") q = q.eq("status", "completed").is("verified_at", null);
  else if (status) q = q.eq("status", status);
  if (status === "overdue") q = q.lt("due_date", today());
  if (course) q = q.eq("course_id", course);
  if (employee) q = q.eq("employee_id", employee);
  return run(q.order("due_date", { ascending: true, nullsFirst: false }).order("assigned_at", { ascending: false }));
}

export async function listMyAssignments(employeeId) {
  return run(from("hr_training_assignments").select(`*, course:hr_training_courses(id, code, title, description, provider, delivery_mode, duration_hours, is_mandatory, certificate_required, pass_score),
    certificate:hr_documents(id, title)`).eq("employee_id", employeeId).order("status").order("due_date", { ascending: true, nullsFirst: false }));
}

/** Active training-certificate documents of one employee (for attaching). */
export async function listCertificateDocuments(employeeId) {
  return run(from("hr_documents").select("id, title, created_at, category:hr_document_categories!inner(code)")
    .eq("employee_id", employeeId).is("archived_at", null).eq("category.code", "training_certificate").order("created_at", { ascending: false }));
}

export const assignTraining = (course, employees, due, notes) => rpc("hr_assign_training", { p_course: course, p_employees: employees, p_due_date: due || null, p_notes: notes || null });
export const startTraining = (id) => rpc("hr_start_training", { p_assignment: id });
export const completeTraining = (id, v) => rpc("hr_complete_training", {
  p_assignment: id, p_completion_date: v.completion_date || null, p_result: v.result || "passed",
  p_score: v.score === "" || v.score == null ? null : Number(v.score), p_certificate_document: v.certificate_document_id || null, p_notes: v.notes || null,
});
export const verifyTraining = (id) => rpc("hr_verify_training_completion", { p_assignment: id });
export const cancelTraining = (id, reason) => rpc("hr_cancel_training", { p_assignment: id, p_reason: reason });
