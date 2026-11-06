// Module 9 — Employee Documents as the central document service: overview,
// directory, verification with history, letters (templates, preview, issue,
// PDF), offer-letter filing, contracts (renewal, attachments), renewal
// requests, staged reminders, policies and acknowledgements.
//
// Builds on ./documents (same bucket, same upload / signed-URL helpers).
// Every rule is enforced server-side by the RPCs / RLS in
// supabase/migrations/129_hr_employee_documents.sql; nothing here grants access.
import { errorMessage, from, rpc, run, supabase } from "./client";
import { DOC_BUCKET, checkDocumentFile, uploadDocumentObject } from "./documents";
import { LETTER_FOOTER, buildLetterPdf, sha256Hex } from "./pdf";

export const DOC_GROUPS = [
  { value: "offer_letter", label: "Offer letters" },
  { value: "appointment_letter", label: "Appointment letters" },
  { value: "contract", label: "Contracts" },
  { value: "certificate", label: "Certificates" },
  { value: "letter", label: "HR letters" },
  { value: "identity", label: "Identity documents" },
  { value: "tax", label: "Tax documents" },
  { value: "policy", label: "Policy records" },
  { value: "attachment", label: "Attachments" },
  { value: "confidential", label: "Confidential" },
  { value: "other", label: "Other" },
];
export const groupLabel = (g) => DOC_GROUPS.find((x) => x.value === g)?.label ?? g ?? "—";
export const EXPIRY_STATUSES = [
  { value: "expiring", label: "Expiring soon" },
  { value: "expired", label: "Expired" },
  { value: "valid", label: "Valid (has expiry)" },
  { value: "none", label: "No expiry" },
];
export const CONTRACT_TYPES = ["permanent", "fixed_term", "probationary", "internship", "consultancy", "other"];
export const CONTRACT_STATUSES = ["active", "expiring", "expired", "terminated"];
export const TEMPLATE_TYPES = [
  { value: "appointment_letter", label: "Appointment letter" },
  { value: "employment_contract", label: "Employment contract" },
  { value: "experience_letter", label: "Experience letter" },
  { value: "employment_confirmation", label: "Employment confirmation" },
  { value: "internship_certificate", label: "Internship certificate" },
  { value: "relieving_letter", label: "Relieving letter" },
  { value: "other_letter", label: "Other HR letter" },
];
/** Placeholders the server accepts (mirror of hr_private.doc_placeholders()). */
export const PLACEHOLDERS = [
  ["employee_name", "Employee name"], ["employee_first_name", "First name"], ["employee_id", "Employee ID"],
  ["department", "Department"], ["designation", "Designation"], ["joining_date", "Joining date"],
  ["confirmation_date", "Confirmation date"], ["employment_type", "Employment type"], ["work_location", "Work location"],
  ["manager_name", "Manager"], ["last_working_date", "Last working date"], ["internship_start_date", "Internship start"],
  ["internship_end_date", "Internship end"], ["contract_type", "Contract type"], ["contract_start_date", "Contract start"],
  ["contract_end_date", "Contract end"], ["issue_date", "Issue date"], ["effective_date", "Effective date"],
  ["reference", "Reference"], ["signatory_name", "Signatory name"], ["signatory_title", "Signatory title"],
  ["company_name", "Company name"], ["company_legal_name", "Company legal name"],
  ["terms_and_conditions", "Terms and conditions"], ["additional_notes", "Additional notes"],
  ["annual_ctc", "Annual CTC (restricted)"], ["monthly_gross", "Monthly gross (restricted)"], ["currency", "Currency (restricted)"],
];
export const COMPENSATION_KEYS = ["annual_ctc", "monthly_gross", "currency"];
/** Values HR may type when issuing (identity / employment data comes from the employee record). */
export const LETTER_INPUTS = [
  { key: "issue_date", label: "Issue date", type: "date" },
  { key: "effective_date", label: "Effective date", type: "date" },
  { key: "work_location", label: "Work location (override)" },
  { key: "signatory_name", label: "Authorised signatory" },
  { key: "signatory_title", label: "Signatory title" },
  { key: "contract_type", label: "Contract type", type: "contract_type" },
  { key: "contract_start_date", label: "Contract start", type: "date" },
  { key: "contract_end_date", label: "Contract end", type: "date" },
  { key: "terms_and_conditions", label: "Terms and conditions", type: "textarea" },
  { key: "additional_notes", label: "Additional notes", type: "textarea" },
  { key: "annual_ctc", label: "Annual CTC", comp: true },
  { key: "monthly_gross", label: "Monthly gross", comp: true },
  { key: "currency", label: "Currency (e.g. INR)", comp: true },
];
export const POLICY_CATEGORIES = [
  { value: "general", label: "General" }, { value: "code_of_conduct", label: "Code of conduct" }, { value: "hr", label: "HR" },
  { value: "leave_attendance", label: "Leave & attendance" }, { value: "it_security", label: "IT & security" },
  { value: "health_safety", label: "Health & safety" }, { value: "compliance", label: "Compliance" },
  { value: "benefits", label: "Benefits" }, { value: "handbook", label: "Employee handbook" }, { value: "other", label: "Other" },
];
export const AUDIENCE_TYPES = [
  { value: "all", label: "All employees" }, { value: "departments", label: "Departments" }, { value: "locations", label: "Locations" },
  { value: "employment_types", label: "Employment types" }, { value: "employees", label: "Specific employees" },
];

/** Drop empty filter values so the server sees only real filters. */
export function cleanFilters(obj) {
  return Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => v !== "" && v !== null && v !== undefined && v !== false));
}

// --------------------------------------------------------- overview / directory
export const documentsOverview = (filters = {}) => rpc("hr_documents_overview", { p_filters: cleanFilters(filters) });

/** Directory search (server-side filters + paging). Resolves to { data: rows, count }. */
export async function searchDocuments(filters = {}, page = 1, pageSize = 25) {
  const res = await rpc("hr_search_documents", { p_filters: cleanFilters(filters), p_page: page, p_page_size: pageSize });
  return res.error ? { data: null, error: res.error, count: null } : { data: res.data?.rows ?? [], error: null, count: res.data?.total ?? 0 };
}

// --------------------------------------------------------- review / details
export const reviewDocument = (id, approve, reason, notes) =>
  rpc("hr_review_document", { p_document: id, p_approve: approve, p_reason: reason || null, p_notes: notes || null });
export const setDocumentDetails = (id, values) => rpc("hr_set_document_details", { p_document: id, p_values: values });
export const listDocumentReviews = (documentId) =>
  run(from("hr_document_reviews").select("id, version, from_status, to_status, notes, reason, created_at").eq("document_id", documentId).order("created_at", { ascending: false }));
export const listRenewalRequests = (documentId) =>
  run(from("hr_document_renewal_requests").select("id, message, due_date, status, requested_at, fulfilled_at, fulfilled_version, fulfilled_document_id, cancelled_at").eq("document_id", documentId).order("requested_at", { ascending: false }));
export const listOpenRenewalRequests = () =>
  run(from("hr_document_renewal_requests").select("id, document_id, message, due_date, status, requested_at").eq("status", "open").order("requested_at", { ascending: false }).limit(200));
export const requestRenewal = (id, message, dueDate) => rpc("hr_request_document_renewal", { p_document: id, p_message: message || null, p_due_date: dueDate || null });
export const cancelRenewal = (requestId) => rpc("hr_cancel_document_renewal", { p_request: requestId });
export const listLetterContent = (documentId) =>
  run(from("hr_document_letter_content").select("id, seq, template_name, template_version, title, body, reference, generated_at").eq("document_id", documentId).order("seq", { ascending: false }));
export const listDocumentAcknowledgements = (documentId) =>
  run(from("hr_document_acknowledgements").select("id, employee_id, version, title, statement, acknowledged_at").eq("document_id", documentId).order("acknowledged_at", { ascending: false }));
/** Fetch one document row with the columns Module 9 added (RLS-scoped). */
export const getDocumentMeta = (id) =>
  run(from("hr_documents").select("id, source, source_ref, template_id, includes_compensation, requires_acknowledgement, issue_date, effective_date, renewal_date, contract_type, contract_status, supersedes_document_id, parent_document_id, verification_notes, notes").eq("id", id).maybeSingle());
export const listAttachments = (parentId) =>
  run(from("hr_documents").select("id, title, current_version, created_at, versions:hr_document_versions!hr_document_versions_document_id_fkey(id, version, storage_path, file_name, mime_type, size_bytes, uploaded_at)").eq("parent_document_id", parentId).is("archived_at", null).order("created_at"));

async function registerAndUpload(rpcName, params, file, mime) {
  const reg = await rpc(rpcName, params);
  if (reg.error) return { data: null, error: reg.error };
  const up = await uploadDocumentObject(reg.data.storage_path, file, mime);
  if (up.error) return { data: reg.data, error: `The record was registered, but the file upload failed: ${up.error}`, pending: { storage_path: reg.data.storage_path, mime } };
  return { data: reg.data, error: null };
}

/** Upload with metadata (contracts, certificates). details: issue_date, effective_date, renewal_date, contract_type, ... */
export async function uploadDocumentEx({ employeeId, categoryCode, title, expiryDate, file, details }) {
  const chk = checkDocumentFile(file);
  if (chk.error) return { data: null, error: chk.error };
  return registerAndUpload("hr_register_document_upload_ex", {
    p_employee: employeeId, p_category: categoryCode, p_title: title?.trim() || null, p_file_name: file.name, p_mime_type: chk.mime,
    p_size_bytes: file.size, p_expiry_date: expiryDate || null, p_details: cleanFilters(details),
  }, file, chk.mime);
}

export async function renewContract({ documentId, file, expiryDate, details, title }) {
  const chk = checkDocumentFile(file);
  if (chk.error) return { data: null, error: chk.error };
  return registerAndUpload("hr_renew_contract", {
    p_document: documentId, p_file_name: file.name, p_mime_type: chk.mime, p_size_bytes: file.size, p_expiry_date: expiryDate || null,
    p_details: cleanFilters(details), p_title: title?.trim() || null,
  }, file, chk.mime);
}

export async function uploadAttachment({ parentId, title, file }) {
  const chk = checkDocumentFile(file);
  if (chk.error) return { data: null, error: chk.error };
  return registerAndUpload("hr_register_document_attachment", {
    p_parent: parentId, p_title: title?.trim() || null, p_file_name: file.name, p_mime_type: chk.mime, p_size_bytes: file.size,
  }, file, chk.mime);
}

// --------------------------------------------------------- templates / letters
const TEMPLATE_COLUMNS = "id, code, name, template_type, category_code, title, body, requires_acknowledgement, includes_compensation, status, current_version, approved_version, approved_at, updated_at";
export const listTemplates = ({ includeArchived = false } = {}) => {
  let q = from("hr_document_templates").select(TEMPLATE_COLUMNS).order("name");
  if (!includeArchived) q = q.neq("status", "archived");
  return run(q);
};
export const listTemplateVersions = (templateId) =>
  run(from("hr_document_template_versions").select("id, version, name, title, body, includes_compensation, approved_at").eq("template_id", templateId).order("version", { ascending: false }));
export const saveTemplate = (id, values) => rpc("hr_save_document_template", { p_template: id ?? null, p_values: values });
export const setTemplateStatus = (id, status) => rpc("hr_set_document_template_status", { p_template: id, p_status: status });
export const previewLetter = (templateId, employeeId, values = {}, draft = false) =>
  rpc("hr_preview_document_letter", { p_template: templateId, p_employee: employeeId || null, p_values: cleanFilters(values), p_draft: draft });
/** Offer letter templates are owned by Recruitment (read-only here; RLS: recruitment.manage). */
export const listOfferTemplates = () => run(from("hr_offer_letter_templates").select("id, name, subject, status, is_default, approved_at").order("name"));

/** Render letter text to PDF bytes (deterministic for the same text). */
export function letterPdf({ title, body, reference, date }) {
  return buildLetterPdf({ title, body, reference, date: typeof date === "string" ? date.slice(0, 10) : "", company: "Zyllo Tech", footerNote: LETTER_FOOTER });
}

/**
 * Store the PDF for issued letter text: register the next version, then
 * upload. Success only after both steps succeeded.
 */
export async function storeLetterPdf(documentId, letter) {
  try {
    const bytes = letterPdf({ title: letter.title, body: letter.body, reference: letter.reference, date: letter.issue_date });
    const checksum = await sha256Hex(bytes);
    const reg = await rpc("hr_register_letter_file", { p_document: documentId, p_size_bytes: bytes.length, p_checksum: checksum });
    if (reg.error) return { data: null, error: reg.error };
    const blob = new Blob([bytes], { type: "application/pdf" });
    const up = await uploadDocumentObject(reg.data.storage_path, blob, "application/pdf");
    if (up.error) return { data: reg.data, error: `The letter was issued, but storing its PDF failed: ${up.error}` };
    return { data: reg.data, error: null };
  } catch (e) {
    return { data: null, error: errorMessage(e) };
  }
}

/** Issue (server renders + stores the text), then store its PDF. */
export async function issueLetter(templateId, employeeId, values = {}) {
  const res = await rpc("hr_issue_document_letter", { p_template: templateId, p_employee: employeeId, p_values: cleanFilters(values) });
  if (res.error) return res;
  const stored = await storeLetterPdf(res.data.document_id, res.data);
  if (stored.error) return { data: res.data, error: stored.error, pendingDocument: res.data.document_id };
  return { data: { ...res.data, ...stored.data }, error: null };
}

export const pendingLetter = (documentId) => rpc("hr_pending_letter", { p_document: documentId });
/** Resume an interrupted issue: the text is on the server, rebuild + store its PDF. */
export async function resumeLetterPdf(documentId) {
  const p = await pendingLetter(documentId);
  if (p.error) return p;
  if (!p.data) return { data: null, error: "There is no issued letter waiting for its PDF." };
  return storeLetterPdf(documentId, p.data);
}

export const offerLettersForDocuments = () => rpc("hr_offer_letters_for_documents");
export async function fileOfferLetter(offerId) {
  const res = await rpc("hr_file_offer_letter", { p_offer: offerId });
  if (res.error) return res;
  const stored = await storeLetterPdf(res.data.document_id, res.data);
  if (stored.error) return { data: res.data, error: stored.error, pendingDocument: res.data.document_id };
  return { data: { ...res.data, ...stored.data }, error: null };
}

// --------------------------------------------------------- reminders / settings
export const documentSettings = () => rpc("hr_document_settings");
export const saveDocumentSettings = (values) => rpc("hr_save_document_settings", { p_values: values });
export const setCategoryReminderDays = (categoryId, days) => rpc("hr_set_category_reminder_days", { p_category: categoryId, p_days: days });
export const runDocumentReminders = () => rpc("hr_run_document_reminders", {});
export const reminderSchedule = (days = 60) => rpc("hr_document_reminder_schedule", { p_days: Number(days) });
export const listReminderRuns = () =>
  run(from("hr_document_reminder_runs").select("id, trigger_source, as_of, started_at, finished_at, expired_marked, reminders, notifications, emails_queued, status").order("started_at", { ascending: false }).limit(20));
export const listReminderEmails = () =>
  run(from("hr_email_outbox").select("id, to_email, subject, status, last_error, created_at, sent_at").eq("template_key", "document_expiry").order("created_at", { ascending: false }).limit(20));

// --------------------------------------------------------- policies
const POLICY_COLUMNS = "id, title, category, status, current_version, requires_acknowledgement, employee_visible, audience_type, audience_ids, audience_codes, published_at, archived_at, updated_at";
const POLICY_VERSION_COLUMNS = "id, policy_id, version, status, content, effective_date, change_summary, storage_path, file_name, size_bytes, published_at, created_at";
export const listPolicies = ({ status = "" } = {}) => {
  let q = from("hr_policies").select(POLICY_COLUMNS).order("updated_at", { ascending: false });
  if (status) q = q.eq("status", status);
  return run(q);
};
export const listPolicyVersions = (policyId) =>
  run(from("hr_policy_versions").select(POLICY_VERSION_COLUMNS).eq("policy_id", policyId).order("version", { ascending: false }));
/** Published policies for the signed-in employee, with the current version. */
export async function listMyPolicies() {
  const p = await run(from("hr_policies").select(POLICY_COLUMNS).eq("status", "published").order("title"));
  if (p.error) return p;
  const ids = (p.data ?? []).map((x) => x.id);
  if (!ids.length) return { data: [], error: null };
  const v = await run(from("hr_policy_versions").select(POLICY_VERSION_COLUMNS).in("policy_id", ids).eq("status", "published"));
  if (v.error) return v;
  return { data: p.data.map((x) => ({ ...x, version: v.data.find((y) => y.policy_id === x.id) ?? null })), error: null };
}
export const savePolicy = (id, values) => rpc("hr_save_policy", { p_policy: id ?? null, p_values: values });
export const publishPolicy = (id, summary) => rpc("hr_publish_policy", { p_policy: id, p_change_summary: summary || null });
export const archivePolicy = (id) => rpc("hr_archive_policy", { p_policy: id });
export const discardPolicyDraft = (id) => rpc("hr_discard_policy_draft", { p_policy: id });
export async function uploadPolicyFile(policyId, file) {
  if (!file) return { data: null, error: "Choose a PDF." };
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) return { data: null, error: "Policy files must be PDF." };
  const chk = checkDocumentFile(file);
  if (chk.error) return { data: null, error: chk.error };
  return registerAndUpload("hr_register_policy_file", { p_policy: policyId, p_file_name: file.name, p_mime_type: "application/pdf", p_size_bytes: file.size }, file, "application/pdf");
}
/** 60-second signed URL for a policy PDF (storage RLS decides). */
export async function getPolicyFileUrl(path, download = false, fileName) {
  if (!path) return { data: null, error: "This policy has no PDF." };
  try {
    const { data, error } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(path, 60, download ? { download: fileName || true } : undefined);
    if (error || !data?.signedUrl) return { data: null, error: errorMessage(error, "Could not open the file.") };
    return { data: data.signedUrl, error: null };
  } catch (e) {
    return { data: null, error: errorMessage(e) };
  }
}

// --------------------------------------------------------- acknowledgements
export const acknowledgePolicy = (policyId) => rpc("hr_acknowledge_policy", { p_policy: policyId });
export const acknowledgeDocument = (documentId) => rpc("hr_acknowledge_document", { p_document: documentId });
export const myPendingAcknowledgements = () => rpc("hr_my_pending_acknowledgements");
export const myAcknowledgements = () =>
  run(from("hr_document_acknowledgements").select("id, subject_type, policy_id, document_id, version, title, statement, acknowledged_at").order("acknowledged_at", { ascending: false }).limit(500));
export const acknowledgementTracker = (filters = {}) => rpc("hr_acknowledgement_tracker", { p_filters: cleanFilters(filters) });
export const sendAcknowledgementReminders = ({ policy = null, document = null, employee = null } = {}) =>
  rpc("hr_send_acknowledgement_reminders", { p_policy: policy, p_document: document, p_employee: employee });
