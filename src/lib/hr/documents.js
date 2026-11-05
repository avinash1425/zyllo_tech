// Employee documents (versioned, private storage) and avatars.
// Upload = 2 steps: an RPC registers the document/version and returns the
// exact storage path, then the browser uploads the file to that path.
// Success is reported only after BOTH steps succeeded. Reads use 60-second
// signed URLs and every view/download is logged via hr_log_document_access.
import { errorMessage, from, rpc, run, supabase } from "./client";

export const DOC_BUCKET = "hr-documents";
export const AVATAR_BUCKET = "hr-avatars";
export const DOC_MAX_BYTES = 10 * 1024 * 1024;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const VERIFICATION_STATUSES = ["pending", "verified", "rejected", "expired", "replaced"];

// Extension -> canonical MIME type (must match the server allow-list).
export const DOC_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export const DOC_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xlsx";
const AVATAR_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
export const AVATAR_ACCEPT = ".png,.jpg,.jpeg,.webp";

const EMP = "id, employee_code, first_name, last_name, display_name";

export function formatBytes(n) {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const extOf = (name) => (String(name ?? "").match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "").toLowerCase();

/** Client-side file check. Returns { mime } or { error }. The server re-validates. */
export function checkDocumentFile(file) {
  if (!file) return { error: "Choose a file to upload." };
  const mime = DOC_TYPES[extOf(file.name)];
  if (!mime) return { error: "Only PDF, PNG, JPEG, WEBP, DOC, DOCX and XLSX files are allowed." };
  if (file.type && file.type !== mime) return { error: "The file extension does not match the file type." };
  if (!file.size) return { error: "The file is empty." };
  if (file.size > DOC_MAX_BYTES) return { error: `The file is ${formatBytes(file.size)}; the limit is 10 MB.` };
  return { mime };
}

export function checkAvatarFile(file) {
  if (!file) return { error: "Choose an image." };
  const ext = extOf(file.name);
  const mime = AVATAR_TYPES[ext];
  if (!mime) return { error: "Use a PNG, JPEG or WEBP image." };
  if (file.type && file.type !== mime) return { error: "The file extension does not match the image type." };
  if (!file.size) return { error: "The file is empty." };
  if (file.size > AVATAR_MAX_BYTES) return { error: `The image is ${formatBytes(file.size)}; the limit is 2 MB.` };
  return { mime, ext: ext === "jpeg" ? "jpg" : ext };
}

// ------------------------------------------------------------- categories
export async function listDocumentCategories({ activeOnly = false } = {}) {
  let q = from("hr_document_categories")
    .select("id, code, name, description, requires_expiry, employee_can_upload, employee_can_view, is_confidential, checklist_required, applies_to_employment_types, active, sort_order, doc_group, contains_compensation, reminder_days")
    .order("sort_order").order("name");
  if (activeOnly) q = q.eq("active", true);
  return run(q);
}

// -------------------------------------------------------------- documents
const DOC_COLUMNS = `id, employee_id, category_id, title, current_version, expiry_date, verification_status, verified_by, verified_at,
  rejection_reason, uploaded_by, created_at, updated_at, archived_at,
  employee:hr_employees!hr_documents_employee_id_fkey(${EMP}),
  category:hr_document_categories!hr_documents_category_id_fkey(id, code, name, requires_expiry, employee_can_upload, is_confidential, doc_group),
  versions:hr_document_versions!hr_document_versions_document_id_fkey(id, version, storage_path, file_name, mime_type, size_bytes, uploaded_by, uploaded_at)`;

/** Server-side filtered + paginated list (RLS limits what the caller sees). */
export async function listDocuments({ employee = "", category = "", status = "", search = "", archived = false, page = 1, pageSize = 25 } = {}) {
  let q = from("hr_documents").select(DOC_COLUMNS, { count: "exact" });
  if (employee) q = q.eq("employee_id", employee);
  if (category) q = q.eq("category_id", category);
  if (status) q = q.eq("verification_status", status);
  const s = search.trim().replace(/[%,()]/g, " ");
  if (s) q = q.ilike("title", `%${s}%`);
  q = archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
  q = q.order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  return run(q);
}

export async function listEmployeeDocuments(employeeId) {
  if (!employeeId) return { data: [], error: null };
  return run(from("hr_documents").select(DOC_COLUMNS).eq("employee_id", employeeId).is("archived_at", null).order("created_at", { ascending: false }).limit(500));
}

export async function getDocument(id) {
  return run(from("hr_documents").select(DOC_COLUMNS).eq("id", id).maybeSingle());
}

export const latestVersion = (doc) =>
  (doc?.versions ?? []).find((v) => v.version === doc.current_version) ?? [...(doc?.versions ?? [])].sort((a, b) => b.version - a.version)[0] ?? null;

/** Storage upload to the exact registered path. An "already exists" answer on a retry means an earlier attempt landed. */
export async function uploadDocumentObject(path, file, mime) {
  try {
    const { error } = await supabase.storage.from(DOC_BUCKET).upload(path, file, { upsert: false, contentType: mime });
    if (!error) return { data: true, error: null };
    if (/already exists|duplicate/i.test(error.message ?? "")) return { data: true, error: null };
    // The storage insert policy refuses a second object at the same path with an
    // RLS error (before any "already exists" check). On a retry that means an
    // earlier attempt may have landed: confirm by asking for a signed URL, which
    // only succeeds if the object exists and the caller may read it.
    if (/row-level security|unauthorized|permission/i.test(error.message ?? "")) {
      const { data: signed } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(path, 30);
      if (signed?.signedUrl) return { data: true, error: null };
    }
    return { data: null, error: errorMessage(error) };
  } catch (e) {
    return { data: null, error: errorMessage(e) };
  }
}

/**
 * Register + upload a new document. Returns { data, error, pending }:
 * when registration worked but the file upload failed, `pending` holds
 * { storage_path, mime } so the caller can retry the upload (allowed for 24h).
 */
export async function uploadDocument({ employeeId, categoryCode, title, expiryDate, file }) {
  const chk = checkDocumentFile(file);
  if (chk.error) return { data: null, error: chk.error };
  const reg = await rpc("hr_register_document_upload", {
    p_employee: employeeId, p_category: categoryCode, p_title: title?.trim() || null, p_file_name: file.name,
    p_mime_type: chk.mime, p_size_bytes: file.size, p_expiry_date: expiryDate || null,
  });
  if (reg.error) return { data: null, error: reg.error };
  const up = await uploadDocumentObject(reg.data.storage_path, file, chk.mime);
  if (up.error) return { data: reg.data, error: `The document was registered, but the file upload failed: ${up.error}`, pending: { storage_path: reg.data.storage_path, mime: chk.mime } };
  return { data: reg.data, error: null };
}

export async function uploadDocumentVersion({ documentId, expiryDate, file }) {
  const chk = checkDocumentFile(file);
  if (chk.error) return { data: null, error: chk.error };
  const reg = await rpc("hr_new_document_version", {
    p_document: documentId, p_file_name: file.name, p_mime_type: chk.mime, p_size_bytes: file.size, p_expiry_date: expiryDate || null,
  });
  if (reg.error) return { data: null, error: reg.error };
  const up = await uploadDocumentObject(reg.data.storage_path, file, chk.mime);
  if (up.error) return { data: reg.data, error: `Version ${reg.data.version} was registered, but the file upload failed: ${up.error}`, pending: { storage_path: reg.data.storage_path, mime: chk.mime } };
  return { data: reg.data, error: null };
}

/** Create a 60-second signed URL for a version and log the access. */
export async function getDocumentUrl(version, action = "view") {
  if (!version?.storage_path) return { data: null, error: "No file is available for this document." };
  try {
    const opts = action === "download" ? { download: version.file_name || true } : undefined;
    const { data, error } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(version.storage_path, 60, opts);
    if (error || !data?.signedUrl) {
      return { data: null, error: /not found/i.test(error?.message ?? "") ? "The file has not been uploaded yet." : errorMessage(error, "Could not open the file.") };
    }
    const log = await rpc("hr_log_document_access", { p_version: version.id, p_action: action === "download" ? "download" : "view" });
    if (log.error) return { data: null, error: log.error };
    return { data: data.signedUrl, error: null };
  } catch (e) {
    return { data: null, error: errorMessage(e) };
  }
}

/** Latest version row of a document (used by the checklist). */
export async function getLatestVersionOf(documentId) {
  const res = await getDocument(documentId);
  if (res.error) return res;
  if (!res.data) return { data: null, error: "Document not found." };
  return { data: latestVersion(res.data), error: null };
}

export const verifyDocument = (id, approve, reason) => rpc("hr_verify_document", { p_document: id, p_approve: approve, p_reason: reason || null });
export const archiveDocument = (id) => rpc("hr_archive_document", { p_document: id });
export const expiringDocuments = (days = 30) => rpc("hr_expiring_documents", { p_days: Number(days) });
export const documentChecklist = (employeeId) => (employeeId ? rpc("hr_document_checklist", { p_employee: employeeId }) : Promise.resolve({ data: [], error: null }));
export const sendExpiryReminders = (days = 30) => rpc("hr_generate_document_expiry_reminders", { p_days: Number(days) });

// ---------------------------------------------------------------- avatars
export async function getAvatarUrl(path) {
  if (!path) return { data: null, error: null };
  try {
    const { data, error } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 300);
    return { data: error ? null : data?.signedUrl ?? null, error: error ? errorMessage(error) : null };
  } catch (e) {
    return { data: null, error: errorMessage(e) };
  }
}

/** Upload the caller's own photo to <employee_id>/photo.<ext>, then point the profile at it. */
export async function uploadMyPhoto(employeeId, file) {
  const chk = checkAvatarFile(file);
  if (chk.error) return { data: null, error: chk.error };
  const path = `${employeeId}/photo.${chk.ext}`;
  try {
    const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, { upsert: true, contentType: chk.mime, cacheControl: "60" });
    if (error) return { data: null, error: errorMessage(error) };
  } catch (e) {
    return { data: null, error: errorMessage(e) };
  }
  const res = await rpc("hr_set_my_photo", { p_path: path });
  return res.error ? res : { data: path, error: null };
}

export const removeMyPhoto = () => rpc("hr_set_my_photo", { p_path: null });
