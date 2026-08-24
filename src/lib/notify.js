import { supabase } from "@/integrations/supabase/client";

// Fire-and-forget admin notification. Never blocks or fails the user's submission.
export function notifyAdmin(type, data) {
  try {
    void supabase.functions
      .invoke("notify-admin", { body: { type, data } })
      .catch((error) => console.warn("Admin notification failed:", error?.message));
  } catch (error) {
    console.warn("Admin notification failed:", error?.message);
  }
}
