// Admin: Daily Work Reports + Notifications Management (migration 243). Admin-only RPCs.
import { supabase } from "@/lib/supabase/client";

const KNOWN =
  /Only admins|not found|date range|Only a submitted report|Write a comment|Comment must|Invalid action|Subject must|Message must|Choose at least one|Choose a project team|Nobody active|Invalid audience|Choose a time|Reminder not found/i;
const friendly = (error, fallback) => (KNOWN.test(error?.message ?? "") ? error.message : fallback);

// ---------------------------------------------------------------- reports
/** { reports: [...], missing: [{ employee, date, status }] } between two dates (max 93 days). */
export async function getReports(fromIso, toIso) {
  const { data, error } = await supabase.rpc("ep_admin_reports", { p_from: fromIso, p_to: toIso });
  if (error) throw error;
  return data ?? { reports: [], missing: [] };
}

export async function reviewReport(id, action, comment) {
  const { data, error } = await supabase.rpc("ep_admin_review_report", {
    p_report: id,
    p_action: action,
    p_comment: String(comment ?? "").trim(),
  });
  if (error) return { ok: false, message: friendly(error, "Could not save the review. Please try again.") };
  return { ok: true, report: data };
}

// ---------------------------------------------------------------- notifications
export async function getNotifyOptions() {
  const { data, error } = await supabase.rpc("ep_admin_notify_options");
  if (error) throw error;
  return data ?? { people: [], departments: [], projects: [] };
}

/** m: { audience: 'all'|'people'|'department'|'project', to, departments, project, title, body, priority } */
export async function sendNotification(m) {
  const { data, error } = await supabase.rpc("ep_admin_send_notification", {
    p_audience: m.audience,
    p_to: m.audience === "people" ? m.to : null,
    p_departments: m.audience === "department" ? m.departments : null,
    p_project: m.audience === "project" ? m.project : null,
    p_title: String(m.title ?? "").trim(),
    p_body: String(m.body ?? "").trim(),
    p_priority: m.priority,
  });
  if (error) return { ok: false, message: friendly(error, "Could not send. Please try again.") };
  return { ok: true, recipients: data?.recipients ?? 0 };
}

export async function getReminderSettings() {
  const { data, error } = await supabase.rpc("ep_admin_reminder_settings");
  if (error) throw error;
  return data ?? [];
}

export async function saveReminder(kind, enabled, sendAt, days) {
  const { data, error } = await supabase.rpc("ep_admin_save_reminder", {
    p_kind: kind,
    p_enabled: enabled,
    p_send_at: sendAt,
    p_days: days,
  });
  if (error) return { ok: false, message: friendly(error, "Could not save the reminder.") };
  return { ok: true, settings: data };
}

export async function sendReminderNow(kind) {
  const { data, error } = await supabase.rpc("ep_admin_send_reminder_now", { p_kind: kind });
  if (error) return { ok: false, message: friendly(error, "Could not send the reminder.") };
  return { ok: true, count: data ?? 0 };
}

/** kind: 'all' | 'automatic' | 'messages' | a notification kind. → { counts, items } */
export async function getNotificationLog(kind = "all", limit = 100) {
  const { data, error } = await supabase.rpc("ep_admin_notification_log", { p_kind: kind, p_limit: limit });
  if (error) throw error;
  return data ?? { counts: {}, items: [] };
}

// ---------------------------------------------------------------- CSV export
const cell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Downloads rows (array of arrays, first = header) as a CSV file that opens in Excel. */
export function downloadCsv(filename, rows) {
  const text = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- custom scheduled reminders (migration 248)
const REMINDER_KNOWN = /Title must|Message must|Choose a time|Choose who|Choose at least one|Choose a project team|Choose today|Choose weekly|not found|Only admins/i;
const reminderError = (error, fallback) => (REMINDER_KNOWN.test(error?.message ?? "") ? error.message : fallback);

export async function getCustomReminders() {
  const { data, error } = await supabase.rpc("ep_admin_custom_reminders");
  if (error) throw error;
  return data ?? [];
}

/** r: { title, body, priority, audience, departments, project_id, people, repeat, days, send_date, send_at, enabled } */
export async function saveCustomReminder(id, r) {
  const { data, error } = await supabase.rpc("ep_admin_save_custom_reminder", { p_id: id ?? null, p: r });
  if (error) return { ok: false, message: reminderError(error, "Could not save the reminder.") };
  return { ok: true, list: data ?? [] };
}

export async function deleteCustomReminder(id) {
  const { data, error } = await supabase.rpc("ep_admin_delete_custom_reminder", { p_id: id });
  if (error) return { ok: false, message: reminderError(error, "Could not delete the reminder.") };
  return { ok: true, list: data ?? [] };
}

export async function sendCustomReminderNow(id) {
  const { data, error } = await supabase.rpc("ep_admin_send_custom_reminder_now", { p_id: id });
  if (error) return { ok: false, message: reminderError(error, "Could not send the reminder.") };
  return { ok: true, count: data ?? 0 };
}
