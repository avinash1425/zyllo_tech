// Recruitment & Hiring (migration 120_hr_recruitment_hiring.sql): overview,
// job opening status machine + salary range, applications, candidate notes
// and attachments, screening, interview reschedule/cancel, structured
// evaluations, final decision, offer letters (templates, versions, issue,
// email via the outbox) and labels. Extends ./recruitment.js (migration 104),
// which keeps the pipeline, interviews, offers and conversion basics.
// Every rule is enforced on the server; nothing here grants access.
import { errorMessage, from, rpc, run, supabase } from "./client";
import { label } from "./recruitment";

const EMP = "id, employee_code, first_name, last_name, display_name";

export const OPENING_STATUS_LABELS = { draft: "Draft", open: "Open", on_hold: "On hold", closed: "Closed", filled: "Filled" };
export const openingStatusLabel = (s) => OPENING_STATUS_LABELS[s] ?? label(s);
// Mirrors hr_private.opening_status_allowed(); reopening needs recruitment.reopen.
export const OPENING_NEXT_STATUSES = { draft: ["open", "closed"], open: ["on_hold", "closed", "filled"], on_hold: ["open", "closed", "filled"], closed: ["open"], filled: ["open"] };
export const STAGE_LABELS = { applied: "Applied", screening: "Screening", shortlisted: "Shortlisted", interview: "Interview", selected: "Selected", offered: "Offered", joined: "Hired", rejected: "Rejected", withdrawn: "Withdrawn" };
export const stageLabel = (s) => STAGE_LABELS[s] ?? label(s);
// DB offer statuses keep their 104 names; the UI shows the business terms.
export const OFFER_STATUS_LABELS = { draft: "Draft", sent: "Issued", accepted: "Accepted", declined: "Rejected", expired: "Expired", withdrawn: "Withdrawn" };
export const offerStatusLabel = (s) => OFFER_STATUS_LABELS[s] ?? label(s);
export const OFFER_RESPONSE_OPTIONS = [
  { value: "accepted", label: "Accepted by the candidate" },
  { value: "declined", label: "Rejected by the candidate" },
  { value: "expired", label: "Expired (no answer)" },
];
export const MODE_LABELS = { video: "Online", in_person: "In person", phone: "Phone" };
export const modeLabel = (m) => MODE_LABELS[m] ?? label(m);
export const RECOMMENDATION_LABELS = { strong_hire: "Strong hire", hire: "Hire", hold: "Hold", no_hire: "Reject", strong_no_hire: "Strong reject" };
export const recommendationLabel = (r) => RECOMMENDATION_LABELS[r] ?? label(r);
export const SOURCE_LABELS = { careers_site: "Careers page", referral: "Referral", linkedin: "LinkedIn", job_portal: "Job portal", agency: "Agency", campus: "Campus", walk_in: "Walk-in", other: "Other" };
export const sourceLabel = (s) => SOURCE_LABELS[s] ?? label(s);
export const EVAL_SCORES = [
  { key: "technical_score", label: "Technical evaluation" },
  { key: "hr_score", label: "HR evaluation" },
  { key: "communication_score", label: "Communication skills" },
  { key: "role_skills_score", label: "Role-specific skills" },
  { key: "experience_score", label: "Experience assessment" },
];
export const ATTACHMENT_KINDS = ["resume", "cover_letter", "portfolio", "certificate", "id_proof", "other"];
export const ATTACHMENT_BUCKET = "hr-recruitment";
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export const ATTACHMENT_ACCEPT = ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp";
export const OFFER_PLACEHOLDERS = ["candidate_name", "candidate_email", "job_title", "designation", "department", "work_location", "employment_type",
  "annual_ctc", "currency", "joining_date", "issue_date", "valid_until", "signatory_name", "signatory_title", "company_name", "company_legal_name", "reference"];

export const numOrNull = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
/** "a, b\nc" or ["a","b"] -> trimmed non-empty list. `sep` = "," also splits on commas. */
export const toList = (v, sep = "\n") =>
  (Array.isArray(v) ? v : String(v ?? "").split(sep === "," ? /[,\n]/ : /\n/)).map((s) => String(s).trim()).filter(Boolean);

// ---------------------------------------------------------------- overview
export function recruitmentOverview(f = {}) {
  return rpc("hr_recruitment_overview", {
    p_opening: f.opening || null, p_department: f.department || null, p_recruiter: f.recruiter || null,
    p_hiring_manager: f.hiringManager || null, p_status: f.status || null, p_from: f.from || null, p_to: f.to || null,
  });
}

// ---------------------------------------------------------------- openings
/** Create (id null) or update a job opening. Salary is sent only when the caller may manage it. */
export function saveOpening(id, v, { includeSalary = false } = {}) {
  const values = {
    title: v.title?.trim(), department_id: v.department_id || null, designation_id: v.designation_id || null,
    employment_type: v.employment_type || "full_time", openings: numOrNull(v.openings), location: v.location?.trim() || null,
    description: v.description ?? "", qualifications: v.qualifications?.trim() || null, required_skills: toList(v.skills, ","),
    experience_min: numOrNull(v.experience_min), experience_max: numOrNull(v.experience_max),
    posting_date: v.posting_date || null, closing_date: v.closing_date || null,
    hiring_manager_id: v.hiring_manager_id || null, recruiter_id: v.recruiter_id || null,
    screening_questions: toList(v.screening_questions), eligibility_criteria: toList(v.eligibility_criteria),
  };
  if (includeSalary) Object.assign(values, { salary_min: numOrNull(v.salary_min), salary_max: numOrNull(v.salary_max), salary_currency: v.salary_currency || "INR", salary_period: v.salary_period || "annual" });
  return rpc("hr_save_job_opening", { p_opening: id ?? null, p_values: values });
}
export const setOpeningStatus = (id, status, reason, closingDate) =>
  rpc("hr_set_job_opening_status", { p_opening: id, p_status: status, p_reason: reason?.trim() || null, p_closing_date: closingDate || null });

/** Salary ranges keyed by opening (RLS: recruitment.manage only; others get none). */
export async function loadOpeningCompensation() {
  const res = await run(from("hr_job_opening_compensation").select("opening_id, salary_min, salary_max, currency, period"));
  return { ...res, data: res.error ? null : new Map((res.data ?? []).map((r) => [r.opening_id, r])) };
}
export function listOpeningStatusEvents(openingId) {
  return run(from("hr_job_opening_status_events").select("id, from_status, to_status, reason, changed_at").eq("opening_id", openingId).order("changed_at", { ascending: false }));
}

// ---------------------------------------------------------------- applications
export function addApplication(openingId, v, { includeSalary = false } = {}) {
  const values = {
    full_name: v.full_name?.trim(), email: v.email?.trim(), phone: v.phone?.trim() || null, source: v.source || "other",
    current_company: v.current_company?.trim() || null, experience_years: numOrNull(v.experience_years), skills: toList(v.skills, ","),
    qualifications: v.qualifications?.trim() || null, current_location: v.current_location?.trim() || null,
    notice_period_days: numOrNull(v.notice_period_days), notes: v.notes?.trim() || null, applied_on: v.applied_on || null,
    recruiter_id: v.recruiter_id || null,
  };
  if (includeSalary) Object.assign(values, { expected_salary: numOrNull(v.expected_salary), current_salary: numOrNull(v.current_salary), salary_currency: v.salary_currency || "INR" });
  return rpc("hr_add_application", { p_opening: openingId, p_values: values });
}
export function updateApplication(id, v, { includeSalary = false } = {}) {
  const values = { recruiter_id: v.recruiter_id || null, source: v.source || null, applied_on: v.applied_on || null };
  if (includeSalary) Object.assign(values, { expected_salary: numOrNull(v.expected_salary), current_salary: numOrNull(v.current_salary), salary_currency: v.salary_currency || "INR" });
  return rpc("hr_update_application", { p_application: id, p_values: values });
}
/** Expected / current salary (RLS: recruitment.manage only). */
export function getApplicationCompensation(applicationId) {
  return run(from("hr_application_compensation").select("expected_salary, current_salary, currency").eq("application_id", applicationId).maybeSingle());
}

// ---------------------------------------------------------------- notes & files
export function listCandidateNotes(candidateId) {
  return run(from("hr_candidate_notes").select(`id, application_id, body, created_at, author:hr_employees!hr_candidate_notes_author_employee_id_fkey(${EMP})`)
    .eq("candidate_id", candidateId).order("created_at", { ascending: false }));
}
export const addCandidateNote = (candidateId, body, applicationId) =>
  rpc("hr_add_candidate_note", { p_candidate: candidateId, p_body: body?.trim(), p_application: applicationId || null });

export function listAttachments(candidateId) {
  return run(from("hr_candidate_attachments").select("id, application_id, kind, file_name, mime_type, size_bytes, storage_path, uploaded_at, confirmed_at")
    .eq("candidate_id", candidateId).is("archived_at", null).order("uploaded_at", { ascending: false }));
}
export function checkAttachmentFile(file) {
  if (!file) return { error: "Choose a file to upload." };
  const ext = (String(file.name).match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "").toLowerCase();
  const mime = ATTACHMENT_TYPES[ext];
  if (!mime) return { error: "Only PDF, Word, PNG, JPEG and WEBP files are allowed." };
  if (file.type && file.type !== mime && file.type !== "application/octet-stream") return { error: "The file extension does not match the file type." };
  if (!file.size) return { error: "The file is empty." };
  if (file.size > ATTACHMENT_MAX_BYTES) return { error: "Files can be at most 10 MB." };
  return { mime };
}
/** Register -> upload -> confirm. Success only when all three steps worked. */
export async function uploadAttachment({ candidateId, applicationId, kind, file }) {
  const chk = checkAttachmentFile(file);
  if (chk.error) return { data: null, error: chk.error };
  const reg = await rpc("hr_register_candidate_attachment", {
    p_candidate: candidateId, p_kind: kind || "resume", p_file_name: file.name, p_mime_type: chk.mime, p_size_bytes: file.size, p_application: applicationId || null,
  });
  if (reg.error) return reg;
  try {
    const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(reg.data.storage_path, file, { upsert: false, contentType: chk.mime });
    if (error) return { data: null, error: `The file was registered but the upload failed: ${errorMessage(error)}` };
  } catch (e) {
    return { data: null, error: `The file was registered but the upload failed: ${errorMessage(e)}` };
  }
  const conf = await rpc("hr_confirm_candidate_attachment", { p_attachment: reg.data.id });
  return conf.error ? conf : { data: reg.data, error: null };
}
/** 60-second signed URL for an attachment (storage RLS decides). */
export async function attachmentUrl(path) {
  try {
    const { data, error } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 60);
    return { data: error ? null : data?.signedUrl ?? null, error: errorMessage(error) };
  } catch (e) {
    return { data: null, error: errorMessage(e) };
  }
}
export const archiveAttachment = (id, reason) => rpc("hr_archive_candidate_attachment", { p_attachment: id, p_reason: reason?.trim() || null });

// ---------------------------------------------------------------- screening
export function listScreenings(applicationId) {
  return run(from("hr_candidate_screenings").select(`id, resume_reviewed, checklist, answers, score, notes, decision, reason, stage_before, decided_at,
    reviewer:hr_employees!hr_candidate_screenings_reviewer_employee_id_fkey(${EMP})`).eq("application_id", applicationId).order("decided_at", { ascending: false }));
}
export const recordScreening = (applicationId, v) => rpc("hr_record_screening", {
  p_application: applicationId,
  p_values: { decision: v.decision, reason: v.reason?.trim() || null, score: numOrNull(v.score), notes: v.notes?.trim() || null,
    resume_reviewed: Boolean(v.resume_reviewed), checklist: v.checklist ?? [], answers: v.answers ?? [] },
});

// ---------------------------------------------------------------- interviews & evaluations
export const rescheduleInterview = (id, v) => rpc("hr_reschedule_interview", {
  p_interview: id, p_scheduled_at: v.scheduled_at, p_reason: v.reason?.trim() || null, p_mode: v.mode || null,
  p_location_or_link: v.location_or_link ?? null, p_duration_minutes: numOrNull(v.duration_minutes), p_interviewers: v.interviewers?.length ? v.interviewers : null,
});
export const updateInterviewStatus = (id, status, reason) => rpc("hr_set_interview_status", { p_interview: id, p_status: status, p_reason: reason?.trim() || null });

export function saveEvaluation(interviewId, v, submit) {
  const values = { rating: numOrNull(v.rating), recommendation: v.recommendation || null, strengths: v.strengths?.trim() || null,
    concerns: v.concerns?.trim() || null, comments: v.comments?.trim() || null };
  for (const s of EVAL_SCORES) values[s.key] = numOrNull(v[s.key]);
  return rpc("hr_save_interview_evaluation", { p_interview: interviewId, p_values: values, p_submit: Boolean(submit) });
}
export const reopenEvaluation = (id, reason) => rpc("hr_reopen_interview_evaluation", { p_feedback: id, p_reason: reason?.trim() || null });

export function listHiringDecisions(applicationId) {
  return run(from("hr_hiring_decisions").select(`id, decision, reason, decided_at, decider:hr_employees!hr_hiring_decisions_decided_by_employee_fkey(${EMP})`)
    .eq("application_id", applicationId).order("decided_at", { ascending: false }));
}
export const recordHiringDecision = (applicationId, decision, reason) =>
  rpc("hr_record_hiring_decision", { p_application: applicationId, p_decision: decision, p_reason: reason?.trim() || null });

// ---------------------------------------------------------------- offers & letters
export function listAllOffers({ status = "" } = {}) {
  let q = from("hr_offers").select(`id, application_id, status, annual_ctc, currency, proposed_joining_date, expires_on, issued_on, sent_at, responded_at,
    current_version, letter_stale, created_at, employment_type, work_location,
    designation:hr_designations!hr_offers_offered_designation_id_fkey(id, name),
    department:hr_departments!hr_offers_department_id_fkey(id, name),
    application:hr_candidate_applications!hr_offers_application_id_fkey(id, stage,
      candidate:hr_candidates!hr_candidate_applications_candidate_id_fkey(id, full_name, email),
      opening:hr_job_openings!hr_candidate_applications_opening_id_fkey(id, title))`).limit(1000);
  if (status === "pending") q = q.in("status", ["draft", "sent"]);
  else if (status) q = q.eq("status", status);
  return run(q.order("created_at", { ascending: false }));
}
const OFFER_TEXT_KEYS = ["designation_id", "department_id", "employment_type", "joining_date", "expires_on", "work_location",
  "signatory_employee_id", "signatory_name", "signatory_title", "notes", "currency"];
export function updateOffer(id, v) {
  const values = {};
  for (const k of OFFER_TEXT_KEYS) if (k in v) values[k] = typeof v[k] === "string" ? v[k].trim() || null : v[k] ?? null;
  if ("annual_ctc" in v) values.annual_ctc = numOrNull(v.annual_ctc);
  return rpc("hr_update_offer", { p_offer: id, p_values: values });
}
export const generateOfferLetter = (offerId, templateId) => rpc("hr_generate_offer_letter", { p_offer: offerId, p_template: templateId || null });
export const issueOffer = (offerId) => rpc("hr_issue_offer", { p_offer: offerId });
export const queueOfferEmail = (offerId) => rpc("hr_queue_offer_email", { p_offer: offerId });
export const expireOverdueOffers = () => rpc("hr_expire_overdue_offers");
export const logOfferLetterDownload = (versionId) => rpc("hr_log_offer_letter_download", { p_version: versionId });
export function listOfferVersions(offerId) {
  return run(from("hr_offer_letter_versions").select("id, version, template_name, subject, body, generated_at").eq("offer_id", offerId).order("version", { ascending: false }));
}
export function listOfferTemplates() {
  return run(from("hr_offer_letter_templates").select("id, name, subject, body, status, is_default, approved_at, updated_at").order("name"));
}
export const saveOfferTemplate = (id, v) => rpc("hr_save_offer_template", { p_template: id ?? null, p_name: v.name?.trim(), p_subject: v.subject?.trim(), p_body: v.body ?? "" });
export const setOfferTemplateStatus = (id, status, makeDefault) => rpc("hr_set_offer_template_status", { p_template: id, p_status: status, p_make_default: Boolean(makeDefault) });

/** Email delivery state shown to HR. Never says "emailed" unless the dispatcher reported 'sent'. */
export function emailState(offer) {
  switch (offer?.email_status) {
    case "sent": return { tone: "green", text: "Emailed to candidate" };
    case "queued": case "sending": return { tone: "amber", text: "Email queued, not delivered yet" };
    case "failed": return { tone: "red", text: `Email failed${offer.email_error ? `: ${offer.email_error}` : ""}` };
    case "cancelled": return { tone: "slate", text: "Email cancelled" };
    default: return { tone: "slate", text: "Not emailed" };
  }
}
