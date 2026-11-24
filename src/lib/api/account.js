// "My profile": the signed-in user's own account (admin area and Employee Portal). Migration 263.
import { supabase } from "@/lib/supabase/client";
import { passwordProblem } from "@/lib/api/employee/password";

const KNOWN = /current password is not correct|New password|must be different|sign in again/i;

/** Change my own password after confirming the current one (checked in the database). */
export async function changeOwnPassword(current, next) {
  const problem = passwordProblem(next);
  if (problem) return { ok: false, field: "next", message: problem };
  if (current === next) return { ok: false, field: "next", message: "The new password must be different from the current one." };
  const { error } = await supabase.rpc("rbac_my_change_password", { p_current: current, p_new: next });
  if (error) {
    const msg = error.message ?? "";
    return {
      ok: false,
      field: /current password/i.test(msg) ? "current" : undefined,
      message: KNOWN.test(msg) ? msg : "Could not change the password. Please try again.",
    };
  }
  return { ok: true };
}
