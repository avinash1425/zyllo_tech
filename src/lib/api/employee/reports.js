// Employee Portal: Daily Work Report (migration 234).
// One report per day, one entry per assigned project. Everything goes through
// security-definer RPCs that check the same rules again in the database.
import { supabase } from "@/lib/supabase/client";

export const REPORT_STATUS = {
  draft: { label: "Draft", chip: "bg-slate-100 text-slate-700" },
  submitted: { label: "Submitted", chip: "bg-sky-100 text-sky-800" },
  reviewed: { label: "Reviewed", chip: "bg-emerald-100 text-emerald-800" },
  returned: { label: "Sent back", chip: "bg-amber-100 text-amber-800" },
};

/** How many days back a report can be written (same as the database). */
export const REPORT_DAYS_BACK = 7;
export const TEXT_MAX = 2000;

// Messages raised by the database that are safe and clear to show as they are.
const DB_MESSAGES =
  /future date|last 7 days|at most 20 project|Notes must be|at least one project|No reporting manager|already submitted|only report on projects|added only once|Hours spent must|Total hours|Write what you worked on|at most 2000|Only a submitted report|Write a comment|Comment must be|Report not found|Not an active employee/i;

function friendly(error, fallback) {
  const msg = error?.message ?? "";
  return DB_MESSAGES.test(msg) ? msg : fallback;
}

/** { date, date_allowed, manager, worked_minutes, report|null } */
export async function getMyReport(dateIso) {
  const { data, error } = await supabase.rpc("ep_my_report", { p_date: dateIso });
  if (error) throw error;
  return data;
}

export async function getMyReports(fromIso, toIso) {
  const { data, error } = await supabase.rpc("ep_my_reports", { p_from: fromIso, p_to: toIso });
  if (error) throw error;
  return data ?? [];
}

/** Hours as typed ("7.5", "7,5") -> number, or NaN. */
export function parseHours(v) {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return Number.NaN;
  return Number(s);
}

/** Same rules as the database; returns { items: [{field: msg}], form: msg } or null. */
export function validateReport(entries, notes, submit) {
  const items = entries.map((e) => {
    const err = {};
    const h = parseHours(e.hours);
    if (Number.isNaN(h) || h <= 0 || h > 24) err.hours = "Enter hours between 0.25 and 24 (e.g. 2 or 1.5).";
    if (![e.task_updates, e.completed_work, e.pending_work].some((t) => String(t ?? "").trim())) {
      err.completed_work = "Write what you worked on for this project.";
    }
    for (const k of ["task_updates", "completed_work", "pending_work"]) {
      if (String(e[k] ?? "").length > TEXT_MAX) err[k] = `Keep it under ${TEXT_MAX} characters.`;
    }
    return err;
  });
  let form = "";
  const total = entries.reduce((s, e) => s + (parseHours(e.hours) || 0), 0);
  if (total > 24) form = "Total hours for the day cannot be more than 24.";
  if (String(notes ?? "").length > TEXT_MAX) form = `Notes must be at most ${TEXT_MAX} characters.`;
  if (submit && entries.length === 0) form = "Add at least one project entry before submitting.";
  const hasItemErrors = items.some((e) => Object.keys(e).length);
  return hasItemErrors || form ? { items, form } : null;
}

export async function saveMyReport(dateIso, notes, entries, submit) {
  const p_items = entries.map((e) => ({
    project_id: e.project_id,
    task_updates: String(e.task_updates ?? "").trim(),
    completed_work: String(e.completed_work ?? "").trim(),
    pending_work: String(e.pending_work ?? "").trim(),
    hours: parseHours(e.hours),
  }));
  const { data, error } = await supabase.rpc("ep_save_my_report", {
    p_date: dateIso,
    p_notes: String(notes ?? "").trim(),
    p_items,
    p_submit: submit,
  });
  if (error) return { ok: false, message: friendly(error, "Could not save the report. Please try again.") };
  return { ok: true, data };
}

// ---------------------------------------------------------------- manager
/** { team: [...people who report to me], reports: [...] } */
export async function getTeamReports() {
  const { data, error } = await supabase.rpc("ep_team_reports");
  if (error) throw error;
  return data ?? { team: [], reports: [] };
}

export async function getTeamReport(reportId) {
  const { data, error } = await supabase.rpc("ep_team_report", { p_report: reportId });
  if (error) throw error;
  return data;
}

/** action: "reviewed" | "returned" (returned needs a comment). */
export async function reviewReport(reportId, action, comment) {
  const { data, error } = await supabase.rpc("ep_review_report", {
    p_report: reportId,
    p_action: action,
    p_comment: String(comment ?? "").trim(),
  });
  if (error) return { ok: false, message: friendly(error, "Could not save the review. Please try again.") };
  return { ok: true, report: data };
}
