// Module 13 — Announcements & Policies (data layer for announcements).
// Policies, the handbook and policy/document acknowledgements live in
// ./documentCenter (versioned policies from migration 129).
//
// Every rule is enforced server-side by RLS / RPCs in
// supabase/migrations/108_hr_announcements.sql and 191_hr_announcements_policies.sql:
// drafts are edited directly, publishing / scheduling / archiving go through
// RPCs, published content is immutable. Nothing here grants access.
import { from, rpc, run } from "./client";

export const ANNOUNCEMENT_CATEGORIES = [
  { value: "general", label: "General", tone: "slate" },
  { value: "policy", label: "HR notice", tone: "blue" },
  { value: "holiday", label: "Holiday", tone: "green" },
  { value: "event", label: "Event", tone: "violet" },
  { value: "urgent", label: "Urgent", tone: "red" },
];
export const announcementCategory = (c) => ANNOUNCEMENT_CATEGORIES.find((x) => x.value === c) ?? { value: c, label: c ?? "—", tone: "slate" };

const COLUMNS = "id, title, body, category, audience_type, audience_ids, audience_codes, status, publish_at, published_at, expires_at, archived_at, requires_acknowledgement, send_email, notified_count, emails_queued, created_at, updated_at";

/** Live = published, started and not expired. */
export function isLive(a, now = Date.now()) {
  return a?.status === "published"
    && (!a.publish_at || new Date(a.publish_at).getTime() <= now)
    && (!a.expires_at || new Date(a.expires_at).getTime() > now);
}
/** Display status: drafts / scheduled / live / expired / archived. */
export function displayStatus(a, now = Date.now()) {
  if (a.status === "published" && a.expires_at && new Date(a.expires_at).getTime() <= now) return "expired";
  if (a.status === "published") return "published";
  return a.status;
}

// ------------------------------------------------------------------ HR side
export function listAnnouncements({ status = "" } = {}) {
  let q = from("hr_announcements").select(COLUMNS).order("updated_at", { ascending: false }).limit(500);
  if (status) q = q.eq("status", status);
  return run(q);
}

/** Create a draft, or edit a draft / scheduled announcement. */
export function saveAnnouncement(id, values) {
  const row = {
    title: values.title?.trim(),
    body: values.body,
    category: values.category || "general",
    audience_type: values.audience_type || "all",
    audience_ids: values.audience_type === "employment_types" || values.audience_type === "all" ? [] : values.audience_ids ?? [],
    audience_codes: values.audience_type === "employment_types" ? values.audience_codes ?? [] : [],
    publish_at: values.publish_at || null,
    expires_at: values.expires_at || null,
    requires_acknowledgement: Boolean(values.requires_acknowledgement),
    send_email: Boolean(values.send_email),
  };
  const q = id ? from("hr_announcements").update(row).eq("id", id) : from("hr_announcements").insert(row);
  return run(q.select(COLUMNS).single());
}

/** Return a scheduled announcement to draft (it will not publish on its own). */
export const unscheduleAnnouncement = (id) => run(from("hr_announcements").update({ status: "draft" }).eq("id", id).select("id").single());
export const deleteAnnouncementDraft = (id) => run(from("hr_announcements").delete().eq("id", id).eq("status", "draft"));
/** Publishes now, or schedules when publish_at is in the future. */
export const publishAnnouncement = (id) => rpc("hr_publish_announcement", { p_announcement: id });
export const archiveAnnouncement = (id) => rpc("hr_archive_announcement", { p_announcement: id });
/** Publishes scheduled announcements whose time has come (also run by pg_cron when installed). */
export const processScheduledAnnouncements = () => rpc("hr_process_scheduled_announcements", {});
export const announcementStats = (id) => rpc("hr_announcement_stats", { p_announcement: id });
/** { [announcement_id]: { audience, read, acknowledged, reminders, last_reminded_at } } */
export async function announcementProgress() {
  const res = await rpc("hr_announcement_progress", {});
  if (res.error) return res;
  return { data: Object.fromEntries((res.data ?? []).map((r) => [r.announcement_id, r])), error: null };
}
export const announcementRecipients = (id) => rpc("hr_announcement_recipients", { p_announcement: id });
export const remindAnnouncement = (id, employeeId = null) => rpc("hr_remind_announcement", { p_announcement: id, p_employee: employeeId });

// ------------------------------------------------------------ Employee side
/** Announcements addressed to me (RLS: live + in my audience), with my receipt. */
export async function listMyAnnouncements(employeeId) {
  const a = await run(from("hr_announcements").select("id, title, body, category, publish_at, published_at, expires_at, requires_acknowledgement")
    .eq("status", "published").order("published_at", { ascending: false }).limit(200));
  if (a.error || !employeeId) return a;
  const ids = (a.data ?? []).map((x) => x.id);
  if (!ids.length) return { data: [], error: null };
  const r = await run(from("hr_announcement_receipts").select("announcement_id, read_at, acknowledged_at").eq("employee_id", employeeId).in("announcement_id", ids));
  if (r.error) return r;
  const byId = Object.fromEntries((r.data ?? []).map((x) => [x.announcement_id, x]));
  return {
    data: a.data.filter((x) => isLive({ ...x, status: "published" })).map((x) => ({ ...x, read_at: byId[x.id]?.read_at ?? null, acknowledged_at: byId[x.id]?.acknowledged_at ?? null })),
    error: null,
  };
}
export const markAnnouncementRead = (id) => rpc("hr_mark_announcement_read", { p_announcement: id });
export const acknowledgeAnnouncement = (id) => rpc("hr_acknowledge_announcement", { p_announcement: id });
