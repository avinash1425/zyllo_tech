// Announcements (migration 108_hr_announcements.sql). Drafts are inserted and
// edited directly (announcements.manage); publishing / scheduling / archiving
// and read + acknowledgement receipts go through RPCs. Emails are only QUEUED
// in hr_email_outbox; hr_announcement_stats reports the real delivery state.
import { from, rpc, run } from "./client";

export const ANNOUNCEMENT_STATUSES = ["draft", "scheduled", "published", "archived"];
export const ANNOUNCEMENT_CATEGORIES = ["general", "policy", "holiday", "event", "urgent"];
export const AUDIENCE_TYPES = [
  { value: "all", label: "Everyone" },
  { value: "departments", label: "Departments" },
  { value: "locations", label: "Office locations" },
  { value: "employment_types", label: "Employment types" },
  { value: "employees", label: "Specific employees" },
];
export const CATEGORY_TONE = { general: "slate", policy: "blue", holiday: "green", event: "violet", urgent: "red" };

export const label = (s) => (s ? String(s).replace(/_/g, " ") : "—");

const COLUMNS = `id, title, body, category, audience_type, audience_ids, audience_codes, status, publish_at, published_at, expires_at,
  archived_at, requires_acknowledgement, send_email, notified_count, emails_queued, created_at, updated_at`;

export async function listAnnouncements({ status = "" } = {}) {
  let q = from("hr_announcements").select(COLUMNS).limit(1000);
  if (status) q = q.eq("status", status);
  return run(q.order("created_at", { ascending: false }));
}

export async function getAnnouncement(id) {
  return run(from("hr_announcements").select(COLUMNS).eq("id", id).maybeSingle());
}

const FIELDS = ["title", "body", "category", "audience_type", "audience_ids", "audience_codes", "publish_at", "expires_at", "requires_acknowledgement", "send_email"];
function body(v) {
  const b = Object.fromEntries(FIELDS.filter((k) => k in v).map((k) => [k, v[k] === "" ? null : v[k]]));
  // Keep only the audience list that matches the type.
  b.audience_ids = ["departments", "locations", "employees"].includes(b.audience_type) ? (b.audience_ids ?? []) : [];
  b.audience_codes = b.audience_type === "employment_types" ? (b.audience_codes ?? []) : [];
  b.requires_acknowledgement = Boolean(b.requires_acknowledgement);
  b.send_email = Boolean(b.send_email);
  return b;
}

/** New announcements are always drafts (enforced by the database too). */
export async function createAnnouncement(v) {
  return run(from("hr_announcements").insert({ ...body(v), status: "draft" }).select("id").single());
}
/** Edit a draft or scheduled announcement (published content is immutable). */
export async function updateAnnouncement(id, v) {
  return run(from("hr_announcements").update(body(v)).eq("id", id).select("id").single());
}
/** Return a scheduled announcement to draft. */
export async function unscheduleAnnouncement(id) {
  return run(from("hr_announcements").update({ status: "draft" }).eq("id", id).select("id").single());
}
export async function deleteAnnouncement(id) {
  const res = await run(from("hr_announcements").delete().eq("id", id).select("id"));
  if (res.error) return res;
  if (!res.data?.length) return { data: null, error: "Only draft announcements can be deleted." };
  return { data: res.data[0], error: null };
}

// Parameter name per 108_hr_announcements.sql is p_announcement.
export const publishAnnouncement = (id) => rpc("hr_publish_announcement", { p_announcement: id });
export const archiveAnnouncement = (id) => rpc("hr_archive_announcement", { p_announcement: id });
export const announcementStats = (id) => rpc("hr_announcement_stats", { p_announcement: id });
export const markAnnouncementRead = (id) => rpc("hr_mark_announcement_read", { p_announcement: id });
export const acknowledgeAnnouncement = (id) => rpc("hr_acknowledge_announcement", { p_announcement: id });
/** Publish every scheduled announcement whose time has come → {published, notified, emails_queued}. */
export const processScheduledAnnouncements = () => rpc("hr_process_scheduled_announcements");

/** Is the announcement live right now (published, started, not expired)? */
export const isLive = (a, now = Date.now()) =>
  a?.status === "published" && new Date(a.publish_at ?? a.published_at ?? 0).getTime() <= now && (!a.expires_at || new Date(a.expires_at).getTime() > now);

/** Mirrors hr_private.announcement_targets() for one employee record. */
export function inAudience(a, me) {
  if (!a || !me) return false;
  switch (a.audience_type) {
    case "all": return true;
    case "departments": return (a.audience_ids ?? []).includes(me.department_id);
    case "locations": return (a.audience_ids ?? []).includes(me.work_location_id);
    case "employment_types": return (a.audience_codes ?? []).includes(me.employment_type);
    case "employees": return (a.audience_ids ?? []).includes(me.id);
    default: return false;
  }
}

/**
 * Announcements addressed to the caller that are live now, with the caller's
 * receipt. RLS already limits ordinary employees to these; users holding
 * announcements.manage / view_all can read every row, so the audience is
 * re-applied here against the caller's own employee record.
 */
export async function listMyAnnouncements(employeeId) {
  if (!employeeId) return { data: [], error: null };
  const [me, list, receipts] = await Promise.all([
    run(from("hr_employees").select("id, department_id, work_location_id, employment_type").eq("id", employeeId).maybeSingle()),
    run(from("hr_announcements").select(COLUMNS).eq("status", "published").order("published_at", { ascending: false }).limit(500)),
    run(from("hr_announcement_receipts").select("announcement_id, read_at, acknowledged_at").eq("employee_id", employeeId).limit(2000)),
  ]);
  const error = me.error || list.error || receipts.error;
  if (error) return { data: null, error };
  const byId = new Map((receipts.data ?? []).map((r) => [r.announcement_id, r]));
  const now = Date.now();
  const rows = (list.data ?? [])
    .filter((a) => isLive(a, now) && inAudience(a, me.data))
    .map((a) => ({ ...a, read_at: byId.get(a.id)?.read_at ?? null, acknowledged_at: byId.get(a.id)?.acknowledged_at ?? null }));
  return { data: rows, error: null };
}
