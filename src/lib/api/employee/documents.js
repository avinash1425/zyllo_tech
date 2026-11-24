// Employee documents (migration 251): the employee uploads their own documents in My Profile
// (offer letter, certificates, ID proofs, …); the admin sees them on the employee's page (read-only).
// Files live in the private bucket "ep-documents" under "<employee_id>/…"; the database rows
// (ep_employee_documents) are written only through ep_add_my_document / ep_delete_my_document.
import { supabase } from "@/lib/supabase/client";
import { checkCertificateFile } from "./certificate";
import { randomId } from "@/lib/randomId";

const BUCKET = "ep-documents";
const TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
export const DOC_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp";
export const DOC_LIMIT = 50;

/**
 * Document kinds, in the order shown as buttons. Keys match the DB check constraint.
 * `hidden`: not offered when uploading (user asked 2026-11-24 to hide Offer letter and Appointment letter);
 * kept here so any existing document of that kind still shows its label. Remove `hidden` to offer it again.
 */
export const DOC_CATEGORIES = [
  { key: "offer_letter", label: "Offer letter", hidden: true },
  { key: "appointment_letter", label: "Appointment letter", hidden: true },
  { key: "education", label: "Education certificate" },
  { key: "experience", label: "Experience / relieving letter" },
  { key: "id_proof", label: "ID proof" },
  { key: "address_proof", label: "Address proof" },
  { key: "photo", label: "Photo" },
  { key: "other", label: "Other" },
];
/** Kinds the employee can choose when uploading. */
export const UPLOAD_CATEGORIES = DOC_CATEGORIES.filter((c) => !c.hidden);
export const docCategoryLabel = (key) => DOC_CATEGORIES.find((c) => c.key === key)?.label ?? "Other";

const ext = (name) => String(name ?? "").split(".").pop().toLowerCase();
const safeName = (name) => String(name ?? "document").replace(/[^\w.-]+/g, "_").slice(-120);

/** Problem with a chosen file, or "" when it is fine (same rules as certificates: PDF/image, 10 MB). */
export const checkDocumentFile = checkCertificateFile;

const COLUMNS = "id, employee_id, category, title, storage_path, file_name, file_size, mime_type, uploaded_at";

/** Employee: my documents (RLS returns only mine), newest first. */
export async function listMyDocuments() {
  const { data, error } = await supabase.from("ep_employee_documents").select(COLUMNS).order("uploaded_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Admin: one employee's documents, newest first. */
export async function listEmployeeDocuments(employeeId) {
  const { data, error } = await supabase
    .from("ep_employee_documents")
    .select(COLUMNS)
    .eq("employee_id", employeeId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Short-lived link; `download` makes the browser save the file with its name. */
export async function documentUrl(doc, { download = false } = {}) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, 300, download ? { download: doc.file_name } : undefined);
  if (error || !data?.signedUrl) throw error ?? new Error("No link");
  return data.signedUrl;
}

/** Employee: upload a file into my own folder ("<my employee id>/…"), then register it. */
export async function uploadMyDocument({ file, category, title }) {
  const problem = checkDocumentFile(file);
  if (problem) return { ok: false, message: problem };
  if (!UPLOAD_CATEGORIES.some((c) => c.key === category)) return { ok: false, message: "Choose what kind of document this is." };
  const { data: me, error: meError } = await supabase.rpc("ep_me");
  const employeeId = me?.employee_id;
  if (meError || !employeeId) return { ok: false, message: "Could not upload the file. Please sign in again." };
  const mime = TYPES[ext(file.name)];
  const path = `${employeeId}/${randomId()}-${safeName(file.name)}`;
  const { error: upError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false });
  if (upError) return { ok: false, message: "Could not upload the file. Please try again." };

  const { error } = await supabase.rpc("ep_add_my_document", {
    p_category: category,
    p_title: String(title ?? "").trim().slice(0, 120),
    p_path: path,
    p_name: file.name.slice(0, 255),
    p_size: file.size,
    p_mime: mime,
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    const msg = error.message ?? "";
    return { ok: false, message: /up to 50|not uploaded/i.test(msg) ? msg : "Could not save the document. Please try again." };
  }
  return { ok: true };
}

/** Employee: delete one of my documents (row first, then the file). */
export async function deleteMyDocument(id) {
  const { data, error } = await supabase.rpc("ep_delete_my_document", { p_id: id });
  if (error) return { ok: false, message: /not found/i.test(error.message ?? "") ? "This document was already deleted." : "Could not delete the document." };
  if (data?.old_path) await supabase.storage.from(BUCKET).remove([data.old_path]);
  return { ok: true };
}
