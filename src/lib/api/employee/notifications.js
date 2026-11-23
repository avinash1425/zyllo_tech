// Employee Portal: Notifications + messages (migration 235).
// Used by the employee portal and by the admin "Employee Messages" page
// (admins can message everyone; see ep_send_message for the rules).
import { supabase } from "@/lib/supabase/client";

export const KINDS = {
  project: { label: "Projects", chip: "bg-sky-100 text-sky-800" },
  leave: { label: "Leave", chip: "bg-violet-100 text-violet-800" },
  attendance: { label: "Attendance", chip: "bg-emerald-100 text-emerald-800" },
  report: { label: "Daily reports", chip: "bg-amber-100 text-amber-800" },
  message: { label: "Messages", chip: "bg-[#f0f4ff] text-[#1f4693]" },
};

const DB_MESSAGES =
  /Subject must be|Message must be|Only an admin|do not have a team|Choose at least one|at most 100 people|None of the chosen|Not an active employee/i;

function friendly(error, fallback) {
  const msg = error?.message ?? "";
  return DB_MESSAGES.test(msg) ? msg : fallback;
}

/** filter: "all" | "unread" | a kind. → { unread, items } */
export async function getMyNotifications(filter = "all") {
  const { data, error } = await supabase.rpc("ep_my_notifications", { p_filter: filter });
  if (error) throw error;
  return data ?? { unread: 0, items: [] };
}

/** { unread, urgent: [...] } — for the bell and the urgent banner. */
export async function getNotificationSummary() {
  const { data, error } = await supabase.rpc("ep_notification_summary");
  if (error) throw error;
  return data ?? { unread: 0, urgent: [] };
}

/** ids: array of ids, or null for all. */
export async function markRead(ids) {
  const { error } = await supabase.rpc("ep_mark_notifications_read", { p_ids: ids });
  if (error) throw error;
}

/** { can_all, can_team, people: [...] } */
export async function getMessageOptions() {
  const { data, error } = await supabase.rpc("ep_message_options");
  if (error) throw error;
  return data;
}

export async function getSentMessages() {
  const { data, error } = await supabase.rpc("ep_sent_messages");
  if (error) throw error;
  return data ?? [];
}

export function validateMessage(m) {
  const e = {};
  const title = String(m.title ?? "").trim();
  if (!title) e.title = "Write a subject.";
  else if (title.length > 150) e.title = "Keep it under 150 characters.";
  if (String(m.body ?? "").length > 2000) e.body = "Keep it under 2000 characters.";
  if (m.audience === "people" && (!m.to || m.to.length === 0)) e.to = "Choose at least one person.";
  return Object.keys(e).length ? e : null;
}

/** m: { audience: "people"|"team"|"all", to: [ids], title, body, priority } */
export async function sendMessage(m) {
  const { data, error } = await supabase.rpc("ep_send_message", {
    p_audience: m.audience,
    p_to: m.audience === "people" ? m.to : null,
    p_title: String(m.title ?? "").trim(),
    p_body: String(m.body ?? "").trim(),
    p_priority: m.priority || "normal",
  });
  if (error) return { ok: false, message: friendly(error, "Could not send the message. Please try again.") };
  return { ok: true, recipients: data?.recipients ?? 0 };
}

/** "5 min ago", "3 h ago", "21 Nov, 10:00 am" */
export function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
