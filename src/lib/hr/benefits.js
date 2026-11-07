// Benefits Management data layer (migrations 114 + 208). Plans and categories
// are written directly (benefits.manage, RLS); enrollments, requests, claims,
// documents and payments go through SECURITY DEFINER RPCs. Claims, claim
// documents and amounts are readable only by the claimant and benefits.view /
// benefits.manage holders (RLS). Nothing here touches payroll.
import { from, rpc, run, supabase } from "./client";

export * from "@/hr/benefits/rules";

export const CLAIM_FILE_BUCKET = "hr-benefit-claims";
export const CLAIM_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const CLAIM_FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp";
const FILE_TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

const EMP = "id, employee_code, first_name, last_name, display_name, status, employment_type, joining_date, probation_end_date, grade_id, work_location_id";
const PLAN_SHORT = "id, code, name, category, provider, claimable, annual_limit, plan_year_start_month, allows_dependants, active";
const clean = (s) => (typeof s === "string" ? s.trim() || null : s ?? null);
const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

// --------------------------------------------------------------- categories
export const listBenefitCategories = ({ activeOnly = false } = {}) => {
  let q = from("hr_benefit_categories").select("*").order("sort_order").order("name");
  if (activeOnly) q = q.eq("active", true);
  return run(q);
};
export function saveBenefitCategory(values, id) {
  const body = {
    name: clean(values.name), description: clean(values.description), claimable_default: Boolean(values.claimable_default),
    active: values.active !== false, sort_order: Number(values.sort_order) || 100,
  };
  if (!id) body.code = clean(values.code);
  return id
    ? run(from("hr_benefit_categories").update(body).eq("id", id).select("id").single())
    : run(from("hr_benefit_categories").insert(body).select("id").single());
}

// -------------------------------------------------------------------- plans
export const listBenefitPlans = ({ activeOnly = false } = {}) => {
  let q = from("hr_benefit_types").select("*").order("active", { ascending: false }).order("name");
  if (activeOnly) q = q.eq("active", true);
  return run(q);
};

const PLAN_FIELDS = ["code", "name", "category", "description", "provider", "eligible_employment_types", "min_tenure_months", "employer_contribution",
  "employee_contribution", "contribution_frequency", "allows_dependants", "active", "coverage_amount", "annual_limit", "claimable",
  "claim_requires_document", "self_enrollment", "plan_year_start_month", "employer_contribution_note", "employee_contribution_note",
  "eligible_grade_ids", "eligible_location_ids", "allow_during_probation"];
const ARRAY_FIELDS = new Set(["eligible_employment_types", "eligible_grade_ids", "eligible_location_ids"]);
const BOOL_FIELDS = new Set(["allows_dependants", "active", "claimable", "claim_requires_document", "self_enrollment", "allow_during_probation"]);
const NUM_FIELDS = new Set(["min_tenure_months", "employer_contribution", "employee_contribution", "coverage_amount", "annual_limit", "plan_year_start_month"]);

export function cleanPlan(values) {
  const out = {};
  for (const k of PLAN_FIELDS) {
    if (!(k in values)) continue;
    let v = values[k];
    if (ARRAY_FIELDS.has(k)) v = Array.isArray(v) && v.length ? v : null;
    else if (BOOL_FIELDS.has(k)) v = Boolean(v);
    else if (NUM_FIELDS.has(k)) v = num(v);
    else v = clean(v);
    out[k] = v;
  }
  if (out.code) out.code = out.code.toUpperCase();
  for (const k of ["min_tenure_months", "employer_contribution", "employee_contribution"]) if (k in out && out[k] === null) out[k] = 0;
  if ("plan_year_start_month" in out && out.plan_year_start_month === null) out.plan_year_start_month = 4;
  return out;
}

export function saveBenefitPlan(values, id) {
  const body = cleanPlan(values);
  return id
    ? run(from("hr_benefit_types").update(body).eq("id", id).select("id").single())
    : run(from("hr_benefit_types").insert(body).select("id").single());
}

/** Plans + eligibility for one employee (own, benefits.view or benefits.manage). */
export const benefitEligibility = (employeeId, onDate = null) =>
  (employeeId ? rpc("hr_benefit_eligibility", { p_employee: employeeId, p_on: onDate || null }) : Promise.resolve({ data: [], error: null }));

// -------------------------------------------------------------- enrollments
const ENR_SELECT = `*, plan:hr_benefit_types!hr_benefit_enrollments_benefit_type_id_fkey(${PLAN_SHORT}), employee:hr_employees!hr_benefit_enrollments_employee_id_fkey(${EMP})`;
export function listEnrollments({ status = "live", plan = "", employee = "" } = {}) {
  let q = from("hr_benefit_enrollments").select(ENR_SELECT).order("start_date", { ascending: false }).limit(3000);
  if (status === "live") q = q.in("status", ["active", "suspended"]);
  else if (status) q = q.eq("status", status);
  if (plan) q = q.eq("benefit_type_id", plan);
  if (employee) q = q.eq("employee_id", employee);
  return run(q);
}
export async function listMyEnrollments(employeeId) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_benefit_enrollments").select(`*, plan:hr_benefit_types!hr_benefit_enrollments_benefit_type_id_fkey(${PLAN_SHORT}, description, coverage_amount, employer_contribution_note, employee_contribution_note, claim_requires_document, self_enrollment)`)
    .eq("employee_id", employeeId).order("start_date", { ascending: false }).limit(500));
}
export const listDependants = (enrollmentId) =>
  run(from("hr_benefit_dependants").select("id, full_name, relationship, date_of_birth, created_at").eq("enrollment_id", enrollmentId).is("removed_at", null).order("created_at"));

export const enrollBenefit = ({ employee, plan, startDate, coverageLevel = "employee", dependants = 0, policyNumber, notes, overrideReason, employerContribution, employeeContribution }) =>
  rpc("hr_enroll_benefit", {
    p_employee: employee, p_benefit_type: plan, p_start_date: startDate, p_coverage_level: coverageLevel, p_dependants: Number(dependants) || 0,
    p_policy_number: clean(policyNumber), p_notes: clean(notes), p_override_reason: clean(overrideReason),
    p_employer_contribution: num(employerContribution), p_employee_contribution: num(employeeContribution),
  });
export const updateEnrollment = (id, { coverageLevel, dependants, policyNumber, notes, employerContribution, employeeContribution, reason }) =>
  rpc("hr_update_benefit_enrollment", {
    p_enrollment: id, p_coverage_level: coverageLevel || null, p_dependants: dependants === "" || dependants == null ? null : Number(dependants),
    p_policy_number: policyNumber ?? null, p_notes: notes ?? null, p_employer_contribution: num(employerContribution),
    p_employee_contribution: num(employeeContribution), p_reason: clean(reason),
  });
/** status: active | suspended | ended | cancelled (114). */
export const setEnrollmentStatus = (id, status, endDate, reason) =>
  rpc("hr_set_benefit_enrollment_status", { p_enrollment: id, p_status: status, p_end_date: endDate || null, p_reason: clean(reason) });
export const addDependant = (enrollment, { fullName, relationship, dateOfBirth }) =>
  rpc("hr_add_benefit_dependant", { p_enrollment: enrollment, p_full_name: clean(fullName), p_relationship: relationship, p_date_of_birth: dateOfBirth || null });
export const removeDependant = (id, reason) => rpc("hr_remove_benefit_dependant", { p_dependant: id, p_reason: clean(reason) });

// --------------------------------------------------------- enrollment requests
const REQ_SELECT = `*, plan:hr_benefit_types!hr_benefit_enrollment_requests_benefit_type_id_fkey(${PLAN_SHORT}), employee:hr_employees!hr_benefit_enrollment_requests_employee_id_fkey(${EMP})`;
export function listEnrollmentRequests({ status = "", employee = "" } = {}) {
  let q = from("hr_benefit_enrollment_requests").select(REQ_SELECT).order("created_at", { ascending: false }).limit(2000);
  if (status) q = q.eq("status", status);
  if (employee) q = q.eq("employee_id", employee);
  return run(q);
}
export const requestEnrollment = ({ plan, startDate, coverageLevel = "employee", dependants = 0, note }) =>
  rpc("hr_request_benefit_enrollment", { p_benefit_type: plan, p_start_date: startDate || null, p_coverage_level: coverageLevel, p_dependants: Number(dependants) || 0, p_note: clean(note) });
export const cancelEnrollmentRequest = (id) => rpc("hr_cancel_benefit_enrollment_request", { p_request: id });
export const decideEnrollmentRequest = (id, approve, note, startDate) =>
  rpc("hr_decide_benefit_enrollment_request", { p_request: id, p_approve: approve, p_note: clean(note), p_start_date: startDate || null });

// -------------------------------------------------------------------- claims
const CLAIM_SELECT = `*, plan:hr_benefit_types!hr_benefit_claims_benefit_type_id_fkey(${PLAN_SHORT}), employee:hr_employees!hr_benefit_claims_employee_id_fkey(${EMP}), documents:hr_benefit_claim_documents(id, file_name, mime_type, size_bytes, storage_path, created_at)`;
export function listClaims({ status = "", plan = "", employee = "", from: f = "", to = "" } = {}) {
  let q = from("hr_benefit_claims").select(CLAIM_SELECT).order("submitted_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(3000);
  if (status === "open") q = q.eq("status", "submitted");
  else if (status) q = q.eq("status", status);
  if (plan) q = q.eq("benefit_type_id", plan);
  if (employee) q = q.eq("employee_id", employee);
  if (f) q = q.gte("expense_date", f);
  if (to) q = q.lte("expense_date", to);
  return run(q);
}
export async function listMyClaims(employeeId) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_benefit_claims").select(CLAIM_SELECT).eq("employee_id", employeeId).order("created_at", { ascending: false }).limit(1000));
}
export const getClaim = (id) => run(from("hr_benefit_claims").select(CLAIM_SELECT).eq("id", id).maybeSingle());
export const listClaimEvents = (claimId) =>
  run(from("hr_benefit_events").select("id, action, from_status, to_status, note, actor_employee_id, occurred_at").eq("claim_id", claimId).order("occurred_at").order("id"));
export const listBenefitHistory = (employeeId) =>
  run(from("hr_benefit_events")
    .select("id, action, from_status, to_status, note, occurred_at, claim_id, enrollment_id, request_id, plan:hr_benefit_types!hr_benefit_events_benefit_type_id_fkey(id, name)")
    .eq("employee_id", employeeId).order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(1000));

export const saveClaim = ({ id = null, enrollment, expenseDate, amount, description }) =>
  rpc("hr_save_benefit_claim", { p_claim: id, p_enrollment: enrollment, p_expense_date: expenseDate, p_amount: Number(amount), p_description: clean(description) });
export const submitClaim = (id, note) => rpc("hr_submit_benefit_claim", { p_claim: id, p_note: clean(note) });
export const cancelClaim = (id, reason) => rpc("hr_cancel_benefit_claim", { p_claim: id, p_reason: clean(reason) });
/** action: approve | reject | return */
export const decideClaim = (id, action, note, approvedAmount) =>
  rpc("hr_decide_benefit_claim", { p_claim: id, p_action: action, p_note: clean(note), p_approved_amount: num(approvedAmount) });
export const recordClaimPayment = (id, reference, paidOn) => rpc("hr_record_benefit_claim_payment", { p_claim: id, p_reference: clean(reference), p_paid_on: paidOn || null });

export const benefitBalances = (employeeId = null, onDate = null) => rpc("hr_benefit_balances", { p_employee: employeeId, p_on: onDate || null });
export const benefitsOverview = (onDate = null) => rpc("hr_benefits_overview", { p_on: onDate || null });

// --------------------------------------------------------------- documents
export function checkClaimFile(file) {
  if (!file) return { error: "Choose a file." };
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const mime = FILE_TYPES[ext];
  if (!mime) return { error: "Only PDF, PNG, JPEG and WEBP files can be attached." };
  if (file.type && file.type !== mime && !(mime === "image/jpeg" && file.type === "image/jpg")) return { error: "The file extension does not match its type." };
  if (file.size <= 0) return { error: "The file is empty." };
  if (file.size > CLAIM_FILE_MAX_BYTES) return { error: "The file is larger than 10 MB." };
  return { mime };
}

async function sha256Hex(file) {
  try {
    if (!globalThis.crypto?.subtle || !file.arrayBuffer) return null;
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;   // duplicate-document detection is best effort
  }
}

/** Register the file on the server (it decides who may attach), then upload to the returned private path. */
export async function uploadClaimDocument(claimId, file) {
  const chk = checkClaimFile(file);
  if (chk.error) return { data: null, error: chk.error };
  const checksum = await sha256Hex(file);
  const reg = await rpc("hr_register_benefit_claim_document", { p_claim: claimId, p_file_name: file.name, p_mime_type: chk.mime, p_size_bytes: file.size, p_checksum: checksum });
  if (reg.error) return reg;
  try {
    const { error } = await supabase.storage.from(CLAIM_FILE_BUCKET).upload(reg.data.storage_path, file, { upsert: false, contentType: chk.mime });
    if (error) return { data: reg.data, error: `The file was registered, but the upload failed: ${error.message}. Remove it and try again.` };
  } catch (e) {
    return { data: reg.data, error: `The file was registered, but the upload failed: ${e?.message ?? "network error"}. Remove it and try again.` };
  }
  return { data: reg.data, error: null };
}
export const removeClaimDocument = (id) => rpc("hr_remove_benefit_claim_document", { p_document: id });

export async function getClaimDocumentUrl(doc, download = false) {
  if (!doc?.storage_path) return { data: null, error: "No file is available." };
  try {
    const { data, error } = await supabase.storage.from(CLAIM_FILE_BUCKET).createSignedUrl(doc.storage_path, 60, download ? { download: doc.file_name } : undefined);
    if (error) return { data: null, error: "You cannot open this file." };
    return { data: data.signedUrl, error: null };
  } catch {
    return { data: null, error: "Network error: could not reach the server." };
  }
}

/**
 * Save a claim (create or update), upload new documents, then submit.
 * Returns { id, error }. When something fails after the draft exists, the
 * draft id is returned so the employee can retry from the claim.
 */
export async function saveAndSubmitClaim({ id, enrollment, expenseDate, amount, description, files = [], submit = true }) {
  const saved = await saveClaim({ id, enrollment, expenseDate, amount, description });
  if (saved.error) return { id, error: saved.error };
  const claimId = saved.data;
  for (const f of files) {
    const up = await uploadClaimDocument(claimId, f);
    if (up.error) return { id: claimId, error: `${up.error} The claim was saved as a draft.` };
  }
  if (!submit) return { id: claimId, error: null };
  const s = await submitClaim(claimId);
  if (s.error) return { id: claimId, error: `${s.error} The claim was saved as a draft.` };
  return { id: claimId, error: null };
}
