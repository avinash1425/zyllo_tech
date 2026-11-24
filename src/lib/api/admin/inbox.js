// Admin notifications inbox (migration 256): events created automatically when employees (or
// reporting managers) do something in the Employee Portal. Read state is per admin.
import { supabase } from "@/lib/supabase/client";

export const ADMIN_KINDS = {
  leave: { label: "Leave" },
  attendance: { label: "Attendance" },
  report: { label: "Daily reports" },
  project: { label: "Projects" },
  profile: { label: "Profile & documents" },
  account: { label: "Sign-ins" },
};

/** filter: "all" | "unread" | a kind. → { unread, counts: {kind: unread}, items: [...] } */
export async function getAdminInbox(filter = "all") {
  const { data, error } = await supabase.rpc("ep_admin_inbox", { p_filter: filter, p_limit: 200 });
  if (error) throw error;
  return data ?? { unread: 0, counts: {}, items: [] };
}

/** { unread } — for the bell in the admin top bar. */
export async function getAdminInboxSummary() {
  const { data, error } = await supabase.rpc("ep_admin_inbox_summary");
  if (error) throw error;
  return data ?? { unread: 0 };
}

/** ids: array of ids, or null for all. */
export async function markAdminInboxRead(ids) {
  const { error } = await supabase.rpc("ep_admin_inbox_mark_read", { p_ids: ids });
  if (error) throw error;
}

/** Tell the bell to refresh now (after reading on the page). */
export const INBOX_CHANGED = "zt-admin-inbox-changed";
export const announceInboxChanged = () => window.dispatchEvent(new Event(INBOX_CHANGED));
