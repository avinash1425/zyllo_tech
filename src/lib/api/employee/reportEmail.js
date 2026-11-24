// Daily work report -> "Send by email" (migration 266). Sending happens in the database (Resend).
import { supabase } from "@/lib/supabase/client";

export const EMAIL_RE = /^[^@\s<>",;]+@[^@\s<>",;]+\.[a-z]{2,}$/i;
const KNOWN = /Add at least one email|at most 10 email|not a valid email|Save the report first|at most 30 report emails|not set up yet|permission|Not an active employee/i;

/** [{ email, name, tag }] — reporting manager, approver, colleagues, admins (sign-in emails). */
export async function getEmailOptions() {
  const { data, error } = await supabase.rpc("ep_report_email_options");
  if (error) throw error;
  return data ?? [];
}

export async function emailMyReport(dateIso, recipients) {
  const { data, error } = await supabase.rpc("ep_email_my_report", { p_date: dateIso, p_to: recipients });
  if (error) {
    const msg = error.message ?? "";
    return { ok: false, message: KNOWN.test(msg) ? msg : "Could not send the email. Please try again." };
  }
  return { ok: true, data };
}

/** [{ id, recipients, status: sending|sent|failed, error, created_at }] for that day (also refreshes statuses). */
export async function getMyReportEmails(dateIso) {
  const { data, error } = await supabase.rpc("ep_my_report_emails", { p_date: dateIso });
  if (error) throw error;
  return data ?? [];
}

/** Resend's error JSON -> a short readable reason. */
export function emailError(raw) {
  try {
    const j = JSON.parse(raw);
    return j.message || j.error || raw;
  } catch {
    return raw || "Unknown error";
  }
}
