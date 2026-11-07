// Training: catalogue (categories, courses, programs, trainers - direct
// writes with training.manage), sessions + enrollments (RPC-only writes,
// migration 207) and assignments (RPC-only writes; visible to the
// employee, training.view and the manager's reporting line).
import { from, rpc, run } from "./client";
import { isOverdueOn } from "./trainingRules";

export const DELIVERY_MODES = ["online", "classroom", "self_paced", "on_the_job", "webinar", "external"];
export const ASSIGNMENT_STATUSES = ["assigned", "in_progress", "completed", "cancelled"];
export const RESULTS = ["passed", "failed", "attended"];
export const SOURCES = ["manual", "program", "session", "onboarding", "renewal"];
export const SESSION_STATUSES = ["scheduled", "completed", "cancelled"];
export const ENROLLMENT_STATUSES = ["enrolled", "waitlisted", "attended", "absent", "cancelled"];
export const CERT_CATEGORY = "training_certificate";

const EMP = "id, employee_code, first_name, last_name, display_name, manager_id, department_id";
const COURSE = "id, code, title, category_id, is_mandatory, certificate_required, pass_score, validity_months, delivery_mode, duration_hours, provider";
const DOC = "id, title, current_version, versions:hr_document_versions!hr_document_versions_document_id_fkey(id, version, storage_path, file_name, size_bytes)";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export const isOverdue = (a) => isOverdueOn(a, today());

// ------------------------------------------------------------------ catalogue
export async function listTrainingCategories() {
  return run(from("hr_training_categories").select("*").order("sort_order").order("name"));
}

export async function saveCategory(v, id) {
  const row = { name: v.name?.trim(), description: v.description?.trim() || null, sort_order: Number(v.sort_order) || 0, active: v.active !== false };
  if (id) return run(from("hr_training_categories").update(row).eq("id", id).select().single());
  return run(from("hr_training_categories").insert({ ...row, code: v.code?.trim() }).select().single());
}

export async function listCourses({ activeOnly = false } = {}) {
  let q = from("hr_training_courses").select("*, category:hr_training_categories(id, name), trainer:hr_training_trainers(id, external_name, employee:hr_employees(id, employee_code, first_name, last_name, display_name))").order("title");
  if (activeOnly) q = q.eq("active", true);
  return run(q);
}

const num = (v) => (v === "" || v == null ? null : Number(v));
export async function saveCourse(v, id) {
  const row = {
    title: v.title?.trim(), category_id: v.category_id || null, description: v.description?.trim() || null, provider: v.provider?.trim() || null,
    delivery_mode: v.delivery_mode || "online", duration_hours: num(v.duration_hours), is_mandatory: Boolean(v.is_mandatory),
    certificate_required: Boolean(v.certificate_required), validity_months: num(v.validity_months), pass_score: num(v.pass_score),
    trainer_id: v.trainer_id || null, content_url: v.content_url?.trim() || null, active: v.active !== false,
  };
  if (id) return run(from("hr_training_courses").update(row).eq("id", id).select().single());
  return run(from("hr_training_courses").insert({ ...row, code: v.code?.trim().toUpperCase() }).select().single());
}

export async function listTrainers() {
  return run(from("hr_training_trainers").select("*, employee:hr_employees(id, employee_code, first_name, last_name, display_name)").order("created_at"));
}
export async function saveTrainer(v, id) {
  const internal = v.kind === "internal";
  const row = {
    employee_id: internal ? v.employee_id || null : null, external_name: internal ? null : v.external_name?.trim() || null,
    organisation: v.organisation?.trim() || null, expertise: v.expertise?.trim() || null, active: v.active !== false,
  };
  if (id) return run(from("hr_training_trainers").update(row).eq("id", id).select().single());
  return run(from("hr_training_trainers").insert(row).select().single());
}

export async function listPrograms() {
  return run(from("hr_training_programs").select("*, category:hr_training_categories(id, name), courses:hr_training_program_courses(id, course_id, sort_order)").order("title"));
}
export async function saveProgram(v, id, courseIds) {
  const row = { title: v.title?.trim(), description: v.description?.trim() || null, category_id: v.category_id || null, active: v.active !== false };
  const res = id
    ? await run(from("hr_training_programs").update(row).eq("id", id).select().single())
    : await run(from("hr_training_programs").insert({ ...row, code: v.code?.trim().toUpperCase() }).select().single());
  if (res.error) return res;
  const pid = res.data.id;
  const existing = await run(from("hr_training_program_courses").select("id, course_id").eq("program_id", pid));
  if (existing.error) return existing;
  const keep = new Set(courseIds);
  const remove = existing.data.filter((r) => !keep.has(r.course_id)).map((r) => r.id);
  if (remove.length) { const d = await run(from("hr_training_program_courses").delete().in("id", remove)); if (d.error) return d; }
  const have = new Map(existing.data.map((r) => [r.course_id, r.id]));
  for (const [i, cid] of courseIds.entries()) {
    const r = have.has(cid)
      ? await run(from("hr_training_program_courses").update({ sort_order: i }).eq("id", have.get(cid)))
      : await run(from("hr_training_program_courses").insert({ program_id: pid, course_id: cid, sort_order: i }));
    if (r.error) return r;
  }
  return res;
}

// ------------------------------------------------------------------ assignments
const ASG = `*, course:hr_training_courses(${COURSE}),
    employee:hr_employees!hr_training_assignments_employee_id_fkey(${EMP}),
    certificate:hr_documents!hr_training_assignments_certificate_document_id_fkey(${DOC}),
    evidence:hr_documents!hr_training_assignments_evidence_document_id_fkey(${DOC}),
    program:hr_training_programs(id, code, title)`;

/** status: "open" | "overdue" | "unverified" | "completed_verified" | concrete status | "" (all). */
export async function listAssignments({ status = "", course = "", employee = "" } = {}) {
  let q = from("hr_training_assignments").select(ASG).limit(3000);
  if (status === "open" || status === "overdue") q = q.in("status", ["assigned", "in_progress"]);
  else if (status === "unverified") q = q.eq("status", "completed").is("verified_at", null);
  else if (status) q = q.eq("status", status);
  if (status === "overdue") q = q.lt("due_date", today());
  if (course) q = q.eq("course_id", course);
  if (employee) q = q.eq("employee_id", employee);
  return run(q.order("due_date", { ascending: true, nullsFirst: false }).order("assigned_at", { ascending: false }));
}

export async function listMyAssignments(employeeId) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_training_assignments").select(`*, course:hr_training_courses(${COURSE}, description, content_url),
    certificate:hr_documents!hr_training_assignments_certificate_document_id_fkey(${DOC}),
    evidence:hr_documents!hr_training_assignments_evidence_document_id_fkey(${DOC})`)
    .eq("employee_id", employeeId).order("assigned_at", { ascending: false }));
}

/** Active training-certificate documents of one employee (for attaching). */
export async function listCertificateDocuments(employeeId) {
  return run(from("hr_documents").select("id, title, created_at, category:hr_document_categories!inner(code)")
    .eq("employee_id", employeeId).is("archived_at", null).eq("category.code", CERT_CATEGORY).order("created_at", { ascending: false }));
}

export const assignTraining = (course, employees, due, notes) => rpc("hr_assign_training", { p_course: course, p_employees: employees, p_due_date: due || null, p_notes: notes || null });
export const assignProgram = (program, employees, due, notes) => rpc("hr_assign_training_program", { p_program: program, p_employees: employees, p_due_date: due || null, p_notes: notes || null });
export const startTraining = (id) => rpc("hr_start_training", { p_assignment: id });
export const completeTraining = (id, v) => rpc("hr_complete_training", {
  p_assignment: id, p_completion_date: v.completion_date || null, p_result: v.result || "passed",
  p_score: num(v.score), p_certificate_document: v.certificate_document_id || null, p_notes: v.notes || null,
});
export const submitCompletion = (id, v) => rpc("hr_submit_training_completion", {
  p_assignment: id, p_completion_date: v.completion_date || null, p_result: v.result || "passed", p_score: num(v.score),
  p_evidence_note: v.evidence_note || null, p_evidence_document: v.evidence_document_id || null,
  p_certificate_document: v.certificate_document_id || null, p_certificate_number: v.certificate_number || null,
});
export const reviewCompletion = (id, approve, v = {}) => rpc("hr_review_training_completion", {
  p_assignment: id, p_approve: approve, p_note: v.note || null, p_result: v.result || null, p_score: num(v.score),
});
export const verifyTraining = (id) => rpc("hr_verify_training_completion", { p_assignment: id });
export const cancelTraining = (id, reason) => rpc("hr_cancel_training", { p_assignment: id, p_reason: reason });
export const recordCertificate = (id, v) => rpc("hr_record_training_certificate", {
  p_assignment: id, p_document: v.document_id || null, p_number: v.number || null, p_issued_on: v.issued_on || null, p_expiry: v.expiry || null,
});
export const renewTraining = (id, due) => rpc("hr_renew_training", { p_assignment: id, p_due_date: due || null });
export const generateRenewals = (days) => rpc("hr_generate_training_renewals", { p_days: Number(days) });

// ------------------------------------------------------------------ sessions
export const listSessions = (from_ = null, to = null) => rpc("hr_list_training_sessions", { p_from: from_ || null, p_to: to || null });
export const saveSession = (id, v) => rpc("hr_save_training_session", {
  p_session: id || null,
  p_values: {
    course_id: v.course_id || "", title: v.title || "", session_date: v.session_date || "", start_time: v.start_time || "", end_time: v.end_time || "",
    venue: v.venue || "", meeting_url: v.meeting_url || "", capacity: v.capacity === "" || v.capacity == null ? "" : String(v.capacity),
    trainer_id: v.trainer_id || "", notes: v.notes || "",
  },
});
export const setSessionStatus = (id, status, reason) => rpc("hr_set_training_session_status", { p_session: id, p_status: status, p_reason: reason || null });
export const enrollSession = (id, employees, due) => rpc("hr_enroll_training_session", { p_session: id, p_employees: employees, p_due_date: due || null });
export const selfEnroll = (id) => rpc("hr_self_enroll_training_session", { p_session: id });
export const withdrawEnrollment = (id, reason) => rpc("hr_withdraw_training_enrollment", { p_enrollment: id, p_reason: reason || null });
export const markAttendance = (session, marks, recordCompletion) => rpc("hr_mark_training_attendance", { p_session: session, p_marks: marks, p_record_completion: Boolean(recordCompletion) });

export async function listEnrollments({ session = "", employee = "" } = {}) {
  let q = from("hr_training_enrollments").select(`*, employee:hr_employees!hr_training_enrollments_employee_id_fkey(${EMP})`).limit(3000);
  if (session) q = q.eq("session_id", session);
  if (employee) q = q.eq("employee_id", employee);
  return run(q.order("enrolled_at"));
}

export const trainerName = (t) => (t ? (t.employee ? (t.employee.display_name || `${t.employee.first_name ?? ""} ${t.employee.last_name ?? ""}`).trim() : t.external_name) : "");
