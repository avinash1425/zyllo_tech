// Internship certificate (migration 245): the admin uploads it, the intern downloads it.
// Files live in the private bucket "ep-certificates" under "<employee_id>/…"; the database
// row (ep_internship_certificates) is written only through admin RPCs.
import { supabase } from "@/lib/supabase/client";

const BUCKET = "ep-certificates";
export const CERT_MAX_BYTES = 10 * 1024 * 1024;
const CERT_TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
export const CERT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp";

const ext = (name) => String(name ?? "").split(".").pop().toLowerCase();
const safeName = (name) => String(name ?? "certificate").replace(/[^\w.-]+/g, "_").slice(-120);

/** Size as "1.2 MB" / "350 KB". */
export function fileSize(bytes) {
  const n = Number(bytes) || 0;
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Problem with a chosen file, or "" when it is fine. */
export function checkCertificateFile(file) {
  if (!file) return "Choose a file.";
  if (!CERT_TYPES[ext(file.name)]) return "Use a PDF, PNG, JPG or WEBP file.";
  if (file.size > CERT_MAX_BYTES) return "The file must be 10 MB or smaller.";
  if (file.size === 0) return "The file is empty.";
  return "";
}

/** The employee's current certificate row, or null. (Admin: any employee; employee: themself.) */
export async function getCertificate(employeeId) {
  const { data, error } = await supabase
    .from("ep_internship_certificates")
    .select("employee_id, storage_path, file_name, file_size, mime_type, uploaded_at")
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Short-lived link; `download` makes the browser save the file with its name. */
export async function certificateUrl(cert, { download = false } = {}) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(cert.storage_path, 300, download ? { download: cert.file_name } : undefined);
  if (error || !data?.signedUrl) throw error ?? new Error("No link");
  return data.signedUrl;
}

// ---------------------------------------------------------------- admin
export async function uploadCertificate(employeeId, file) {
  const problem = checkCertificateFile(file);
  if (problem) return { ok: false, message: problem };
  const mime = CERT_TYPES[ext(file.name)];
  const path = `${employeeId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error: upError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false });
  if (upError) return { ok: false, message: "Could not upload the file. Please try again." };

  const { data, error } = await supabase.rpc("ep_admin_set_certificate", {
    p_emp: employeeId,
    p_path: path,
    p_name: file.name.slice(0, 255),
    p_size: file.size,
    p_mime: mime,
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    const msg = error.message ?? "";
    return { ok: false, message: /Intern|not found|not uploaded/i.test(msg) ? msg : "Could not save the certificate. Please try again." };
  }
  if (data?.old_path) await supabase.storage.from(BUCKET).remove([data.old_path]);
  return { ok: true };
}

export async function removeCertificate(employeeId) {
  const { data, error } = await supabase.rpc("ep_admin_remove_certificate", { p_emp: employeeId });
  if (error) return { ok: false, message: /no certificate/i.test(error.message ?? "") ? error.message : "Could not remove the certificate." };
  if (data?.old_path) await supabase.storage.from(BUCKET).remove([data.old_path]);
  return { ok: true };
}

/** Employee: my own certificate (RLS returns only my row), or null. */
export async function getMyCertificate() {
  const { data, error } = await supabase
    .from("ep_internship_certificates")
    .select("employee_id, storage_path, file_name, file_size, mime_type, uploaded_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}
