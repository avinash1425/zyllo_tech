// Recruitment pipeline, interviews, offers, conversions and internships
// (migration 104_hr_recruitment.sql). Reads are RLS-filtered: recruiters
// (recruitment.view / .manage) see everything, hiring managers and panel
// members see only their applications. Stage changes, interviews, feedback,
// offers and conversions are SECURITY DEFINER RPCs; openings, candidates,
// internships and intern evaluations are direct writes guarded by RLS.
import { from, rpc, run, supabase, errorMessage } from "./client";

export const OPENING_STATUSES = ["draft", "open", "on_hold", "closed", "filled"];
// Statuses HR may set by editing an opening ("open" goes through Publish so the careers posting exists).
export const OPENING_EDIT_STATUSES = ["draft", "on_hold", "closed", "filled"];

export const STAGES = ["applied", "screening", "shortlisted", "interview", "selected", "offered", "joined", "rejected", "withdrawn"];
export const BOARD_STAGES = ["applied", "screening", "shortlisted", "interview", "selected", "offered", "joined"];
export const TERMINAL_STAGES = ["joined", "rejected", "withdrawn"];
// Mirrors hr_private.candidate_stage_allowed(); "joined" is reached only by conversion.
export const NEXT_STAGES = {
  applied: ["screening", "rejected", "withdrawn"],
  screening: ["shortlisted", "rejected", "withdrawn"],
  shortlisted: ["interview", "rejected", "withdrawn"],
  interview: ["selected", "rejected", "withdrawn"],
  selected: ["offered", "rejected", "withdrawn"],
  offered: ["rejected", "withdrawn"],
};

export const CANDIDATE_SOURCES = ["careers_site", "referral", "linkedin", "job_portal", "agency", "campus", "walk_in", "other"];
export const INTERVIEW_TYPES = ["phone", "technical", "hr", "managerial", "other"];
export const INTERVIEW_MODES = ["video", "in_person", "phone"];
export const INTERVIEW_STATUSES = ["scheduled", "completed", "cancelled", "no_show"];
export const RECOMMENDATIONS = ["strong_hire", "hire", "hold", "no_hire", "strong_no_hire"];
export const OFFER_RESPONSES = ["accepted", "declined", "expired"];
export const INTERNSHIP_STATUSES = ["active", "completed", "terminated", "converted"];
export const INTERNSHIP_EDIT_STATUSES = ["active", "completed", "terminated"];
export const EVAL_RECOMMENDATIONS = ["continue", "convert", "complete", "terminate"];
export const EVAL_CRITERIA = [
  { key: "technical", label: "Technical skills" },
  { key: "communication", label: "Communication" },
  { key: "ownership", label: "Ownership" },
  { key: "learning", label: "Learning agility" },
  { key: "teamwork", label: "Teamwork" },
];

export const label = (s) => (s ? String(s).replace(/_/g, " ") : "—");
export const opts = (list) => list.map((v) => ({ value: v, label: label(v) }));

const EMP = "id, employee_code, first_name, last_name, display_name";
const clean = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k] === "" ? null : obj[k]]));
const safeSearch = (s) => (s ?? "").trim().replace(/[%,()]/g, " ");

// ---------------------------------------------------------------- openings
const OPENING_COLUMNS = `id, job_id, title, department_id, employment_type, openings, required_skills, experience_min, experience_max,
  location, description, posting_date, closing_date, hiring_manager_id, status, created_at, updated_at,
  designation_id, qualifications, recruiter_id, screening_questions, eligibility_criteria, closed_at, reopened_at,
  department:hr_departments!hr_job_openings_department_id_fkey(id, name),
  designation:hr_designations!hr_job_openings_designation_id_fkey(id, name),
  hiring_manager:hr_employees!hr_job_openings_hiring_manager_id_fkey(${EMP}),
  recruiter:hr_employees!hr_job_openings_recruiter_id_fkey(${EMP})`;

export async function listOpenings({ status = "", department = "", search = "", recruiter = "", hiringManager = "" } = {}) {
  let q = from("hr_job_openings").select(OPENING_COLUMNS).limit(1000);
  if (status === "active") q = q.in("status", ["draft", "open", "on_hold"]);
  else if (status) q = q.eq("status", status);
  if (department) q = q.eq("department_id", department);
  if (recruiter) q = q.eq("recruiter_id", recruiter);
  if (hiringManager) q = q.eq("hiring_manager_id", hiringManager);
  const s = safeSearch(search);
  if (s) q = q.ilike("title", `%${s}%`);
  return run(q.order("created_at", { ascending: false }));
}

export const createOpening = (v) => rpc("hr_create_job_opening", {
  p_title: v.title?.trim(), p_department: v.department_id || null, p_employment_type: v.employment_type || "full_time",
  p_openings: Number(v.openings) || 1, p_required_skills: v.required_skills ?? [],
  p_experience_min: v.experience_min === "" || v.experience_min == null ? null : Number(v.experience_min),
  p_experience_max: v.experience_max === "" || v.experience_max == null ? null : Number(v.experience_max),
  p_location: v.location?.trim() || null, p_description: v.description ?? "", p_closing_date: v.closing_date || null,
  p_hiring_manager: v.hiring_manager_id || null, p_publish: Boolean(v.publish),
});

const OPENING_FIELDS = ["title", "department_id", "employment_type", "openings", "required_skills", "experience_min", "experience_max",
  "location", "description", "closing_date", "hiring_manager_id", "status"];
export async function updateOpening(id, v) {
  const body = clean(v, OPENING_FIELDS);
  if ("openings" in body && body.openings != null) body.openings = Number(body.openings);
  for (const k of ["experience_min", "experience_max"]) if (k in body && body[k] != null) body[k] = Number(body[k]);
  if ("description" in body && body.description == null) body.description = "";
  return run(from("hr_job_openings").update(body).eq("id", id).select("id").single());
}

export const publishOpening = (id) => rpc("hr_publish_job_opening", { p_opening: id });

/** Careers-site postings readable by the caller (open postings; admins see all). */
export async function listCareersPostings() {
  return run(from("job_postings").select("id, title, department, location, status, created_at").order("created_at", { ascending: false }).limit(500));
}
export const importCareersApplications = (postingId) => rpc("hr_import_careers_applications", { p_job_posting: postingId });

// ---------------------------------------------------------------- applications
const CANDIDATE_FIELDS = "id, full_name, email, phone, source, resume_path, current_company, experience_years, notes, skills, qualifications, current_location, notice_period_days";
const APP_COLUMNS = `id, candidate_id, opening_id, stage, stage_changed_at, rejected_reason, employee_id, source_application_id, created_at,
  applied_on, source, recruiter_id, on_hold, hold_reason, held_at,
  candidate:hr_candidates!hr_candidate_applications_candidate_id_fkey(${CANDIDATE_FIELDS}),
  opening:hr_job_openings!hr_candidate_applications_opening_id_fkey(id, title, status, department_id, designation_id, employment_type, hiring_manager_id, recruiter_id, location, screening_questions, eligibility_criteria),
  recruiter:hr_employees!hr_candidate_applications_recruiter_id_fkey(${EMP})`;

export async function listApplications({ opening = "", stage = "", recruiter = "", from: fromDate = "", to: toDate = "" } = {}) {
  let q = from("hr_candidate_applications").select(APP_COLUMNS).limit(3000);
  if (opening) q = q.eq("opening_id", opening);
  if (recruiter) q = q.eq("recruiter_id", recruiter);
  if (fromDate) q = q.gte("applied_on", fromDate);
  if (toDate) q = q.lte("applied_on", toDate);
  if (stage === "active") q = q.not("stage", "in", "(joined,rejected,withdrawn)");
  else if (stage) q = q.eq("stage", stage);
  return run(q.order("stage_changed_at", { ascending: false }));
}

export async function getApplication(id) {
  return run(from("hr_candidate_applications")
    .select(`${APP_COLUMNS}, employee:hr_employees!hr_candidate_applications_employee_id_fkey(${EMP})`)
    .eq("id", id).maybeSingle());
}

export async function listStageEvents(applicationId) {
  return run(from("hr_candidate_stage_events").select("id, from_stage, to_stage, note, changed_at").eq("application_id", applicationId).order("changed_at", { ascending: false }));
}

export const moveStage = (applicationId, toStage, note) =>
  rpc("hr_move_candidate_stage", { p_application: applicationId, p_to_stage: toStage, p_note: note?.trim() || null });

// ---------------------------------------------------------------- candidates
export async function listCandidates({ search = "" } = {}) {
  let q = from("hr_candidates").select(`${CANDIDATE_FIELDS}, created_at,
    applications:hr_candidate_applications!hr_candidate_applications_candidate_id_fkey(id, stage, opening:hr_job_openings!hr_candidate_applications_opening_id_fkey(id, title))`).limit(1000);
  const s = safeSearch(search);
  if (s) q = q.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,current_company.ilike.%${s}%`);
  return run(q.order("created_at", { ascending: false }));
}

export const addCandidate = (v) => rpc("hr_add_candidate", {
  p_opening: v.opening_id, p_full_name: v.full_name?.trim(), p_email: v.email?.trim(), p_phone: v.phone?.trim() || null,
  p_source: v.source || "other", p_resume_path: null, p_current_company: v.current_company?.trim() || null,
  p_experience_years: v.experience_years === "" || v.experience_years == null ? null : Number(v.experience_years), p_notes: v.notes?.trim() || null,
});

export async function updateCandidate(id, v) {
  const body = clean(v, ["full_name", "phone", "source", "current_company", "experience_years", "notes", "skills", "qualifications", "current_location", "notice_period_days"]);
  if (body.experience_years != null) body.experience_years = Number(body.experience_years);
  if (body.notice_period_days != null) body.notice_period_days = Number(body.notice_period_days);
  if ("skills" in body && body.skills == null) body.skills = [];
  return run(from("hr_candidates").update(body).eq("id", id).select("id").single());
}

/** Short-lived (60 s) signed URL for a resume in the private 'resumes' bucket. */
export async function resumeUrl(path) {
  if (!path) return { data: null, error: "No resume on file." };
  try {
    const { data, error } = await supabase.storage.from("resumes").createSignedUrl(path, 60);
    return { data: error ? null : data?.signedUrl ?? null, error: errorMessage(error) };
  } catch (e) {
    return { data: null, error: errorMessage(e) };
  }
}

// ---------------------------------------------------------------- interviews
const INTERVIEW_COLUMNS = `id, application_id, round, interview_type, scheduled_at, duration_minutes, mode, location_or_link, status, notes,
  cancel_reason, reschedule_count, status_changed_at,
  panel:hr_interview_panel(employee_id, employee:hr_employees!hr_interview_panel_employee_id_fkey(${EMP})),
  reschedules:hr_interview_reschedules(id, old_scheduled_at, new_scheduled_at, old_mode, new_mode, old_location_or_link, new_location_or_link, reason, changed_at),
  feedback:hr_interview_feedback(id, interviewer_id, rating, recommendation, strengths, concerns, submitted_at, status, comments,
    technical_score, hr_score, communication_score, role_skills_score, experience_score, reopened_at, reopen_reason,
    interviewer:hr_employees!hr_interview_feedback_interviewer_id_fkey(${EMP}))`;

export async function listInterviews(applicationId) {
  return run(from("hr_interviews").select(INTERVIEW_COLUMNS).eq("application_id", applicationId).order("scheduled_at"));
}

/** Upcoming / recent interviews across all applications (recruiters). */
export async function listAllInterviews({ status = "scheduled", from: fromTs = "", to: toTs = "" } = {}) {
  let q = from("hr_interviews").select(`${INTERVIEW_COLUMNS},
    application:hr_candidate_applications!hr_interviews_application_id_fkey(id, stage,
      candidate:hr_candidates!hr_candidate_applications_candidate_id_fkey(id, full_name),
      opening:hr_job_openings!hr_candidate_applications_opening_id_fkey(id, title))`).limit(500);
  if (status) q = q.eq("status", status);
  if (fromTs) q = q.gte("scheduled_at", fromTs);
  if (toTs) q = q.lte("scheduled_at", toTs);
  return run(q.order("scheduled_at", { ascending: status === "scheduled" }));
}

/** Interviews where the caller sits on the panel, with the caller's own feedback. */
export async function listMyInterviews(employeeId) {
  if (!employeeId) return { data: [], error: null };
  const res = await run(from("hr_interview_panel").select(`interview_id,
    interview:hr_interviews!hr_interview_panel_interview_id_fkey(id, application_id, round, interview_type, scheduled_at, duration_minutes, mode, location_or_link, status,
      application:hr_candidate_applications!hr_interviews_application_id_fkey(id, stage,
        candidate:hr_candidates!hr_candidate_applications_candidate_id_fkey(id, full_name, resume_path),
        opening:hr_job_openings!hr_candidate_applications_opening_id_fkey(id, title)))`).eq("employee_id", employeeId).limit(500));
  if (res.error) return res;
  const fb = await run(from("hr_interview_feedback").select(`id, interview_id, rating, recommendation, submitted_at, status, strengths, concerns, comments,
    technical_score, hr_score, communication_score, role_skills_score, experience_score, reopen_reason`).eq("interviewer_id", employeeId).limit(1000));
  if (fb.error) return fb;
  const mine = new Map((fb.data ?? []).map((f) => [f.interview_id, f]));
  const rows = (res.data ?? []).filter((p) => p.interview).map((p) => ({ ...p.interview, my_feedback: mine.get(p.interview_id) ?? null }));
  rows.sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));
  return { data: rows, error: null };
}

export const scheduleInterview = (v) => rpc("hr_schedule_interview", {
  p_application: v.application_id, p_scheduled_at: v.scheduled_at, p_interviewers: v.interviewers,
  p_round: Number(v.round) || 1, p_type: v.interview_type || "technical", p_duration_minutes: Number(v.duration_minutes) || 60,
  p_mode: v.mode || "video", p_location_or_link: v.location_or_link?.trim() || null,
});

export async function setInterviewStatus(id, status) {
  return run(from("hr_interviews").update({ status }).eq("id", id).select("id").single());
}

export const submitInterviewFeedback = (v) => rpc("hr_submit_interview_feedback", {
  p_interview: v.interview_id, p_rating: Number(v.rating), p_recommendation: v.recommendation,
  p_strengths: v.strengths?.trim() || null, p_concerns: v.concerns?.trim() || null,
});

// ---------------------------------------------------------------- offers
/** Offers for an application (annual_ctc is null unless the caller has recruitment.manage). */
export async function listOffers(applicationId) {
  const res = await rpc("hr_get_application_offers", { p_application: applicationId });
  return { ...res, data: res.error ? null : (Array.isArray(res.data) ? res.data : []) };
}
export const createOffer = (v) => rpc("hr_create_offer", {
  p_application: v.application_id, p_designation: v.designation_id || null, p_department: v.department_id || null,
  p_employment_type: v.employment_type || null, p_joining_date: v.joining_date || null,
  p_annual_ctc: v.annual_ctc === "" || v.annual_ctc == null ? null : Number(v.annual_ctc), p_expires_on: v.expires_on || null, p_notes: v.notes?.trim() || null,
});
export const sendOffer = (id) => rpc("hr_send_offer", { p_offer: id });
export const recordOfferResponse = (id, response, note) => rpc("hr_record_offer_response", { p_offer: id, p_response: response, p_note: note?.trim() || null });
export const withdrawOffer = (id, note) => rpc("hr_withdraw_offer", { p_offer: id, p_note: note?.trim() || null });

export const convertCandidate = (v) => rpc("hr_convert_candidate_to_employee", {
  p_application: v.application_id, p_company_email: v.company_email?.trim(), p_joining_date: v.joining_date || null,
  p_department: v.department_id || null, p_designation: v.designation_id || null, p_manager: v.manager_id || null,
  p_employment_type: v.employment_type || null,
});

// ---------------------------------------------------------------- internships
const INTERNSHIP_COLUMNS = `id, employee_id, mentor_id, department_id, start_date, end_date, project, learning_goals, status, completion_date,
  certificate_eligible, certificate_issued_at, converted_at, converted_employment_type, created_at,
  employee:hr_employees!hr_internships_employee_id_fkey(${EMP}, status, company_email),
  mentor:hr_employees!hr_internships_mentor_id_fkey(${EMP}),
  department:hr_departments!hr_internships_department_id_fkey(id, name)`;

export async function listInternships({ status = "" } = {}) {
  let q = from("hr_internships").select(INTERNSHIP_COLUMNS).limit(1000);
  if (status) q = q.eq("status", status);
  return run(q.order("start_date", { ascending: false }));
}

export async function getInternship(id) {
  return run(from("hr_internships").select(INTERNSHIP_COLUMNS).eq("id", id).maybeSingle());
}

/** Current employees on an intern employment type (for new internships). */
export async function listInternEmployees(internTypeCodes) {
  if (!internTypeCodes?.length) return { data: [], error: null };
  return run(from("hr_employees").select(`${EMP}, department_id, employment_type, status`).in("employment_type", internTypeCodes)
    .not("status", "in", "(exited,archived)").order("first_name").limit(1000));
}

const INTERNSHIP_FIELDS = ["employee_id", "mentor_id", "department_id", "start_date", "end_date", "project", "learning_goals", "status",
  "completion_date", "certificate_eligible", "certificate_issued_at"];
export async function createInternship(v) {
  const body = clean(v, INTERNSHIP_FIELDS.filter((k) => !["status", "completion_date", "certificate_issued_at"].includes(k)));
  return run(from("hr_internships").insert(body).select("id").single());
}
export async function updateInternship(id, v) {
  const body = clean(v, INTERNSHIP_FIELDS.filter((k) => k !== "employee_id"));
  return run(from("hr_internships").update(body).eq("id", id).select("id").single());
}
export const convertIntern = (v) => rpc("hr_convert_intern_to_employee", {
  p_internship: v.internship_id, p_employment_type: v.employment_type || "full_time", p_effective_date: v.effective_date || null,
  p_designation: v.designation_id || null, p_manager: v.manager_id || null,
});

export async function listEvaluations(internshipId) {
  return run(from("hr_intern_evaluations").select(`id, internship_id, evaluator_id, period, period_start, period_end, ratings, overall_rating, comments,
    recommendation, status, finalized_at, created_at, evaluator:hr_employees!hr_intern_evaluations_evaluator_id_fkey(${EMP})`)
    .eq("internship_id", internshipId).order("created_at", { ascending: false }));
}

const EVAL_FIELDS = ["period", "period_start", "period_end", "ratings", "overall_rating", "comments", "recommendation", "status"];
export async function createEvaluation(internshipId, evaluatorId, v) {
  const body = { ...clean(v, EVAL_FIELDS), internship_id: internshipId, evaluator_id: evaluatorId };
  if (body.overall_rating != null) body.overall_rating = Number(body.overall_rating);
  return run(from("hr_intern_evaluations").insert(body).select("id").single());
}
export async function updateEvaluation(id, v) {
  const body = clean(v, EVAL_FIELDS);
  if (body.overall_rating != null) body.overall_rating = Number(body.overall_rating);
  return run(from("hr_intern_evaluations").update(body).eq("id", id).select("id").single());
}
export async function deleteEvaluation(id) {
  return run(from("hr_intern_evaluations").delete().eq("id", id));
}
