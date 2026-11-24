// Password rules + "change my password" (migration 249). The database checks the same rules
// (public.ep_password_problem); these give the user instant feedback.
import { supabase } from "@/lib/supabase/client";

export const PASSWORD_RULES = [
  { key: "length", label: "At least 6 characters", test: (p) => p.length >= 6 },
  { key: "upper", label: "1 uppercase letter (A–Z)", test: (p) => /[A-Z]/.test(p) },
  { key: "number", label: "1 number (0–9)", test: (p) => /[0-9]/.test(p) },
  { key: "special", label: "1 special character (e.g. @ # $ % !)", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

/** First problem with a password, or "" when it follows every rule. */
export function passwordProblem(p) {
  const v = String(p ?? "");
  if (/\s/.test(v)) return "Do not use spaces.";
  if (v.length > 72) return "Use at most 72 characters.";
  const missing = PASSWORD_RULES.find((r) => !r.test(v));
  return missing ? `Password needs: ${missing.label.toLowerCase()}.` : "";
}

/** The signed-in employee sets a new password (clears "must change password"). */
export async function changeMyPassword(newPassword) {
  const { error } = await supabase.rpc("ep_change_my_password", { p_new: newPassword });
  if (error) {
    const msg = error.message ?? "";
    return {
      ok: false,
      message: /New password|different from the temporary|Not an active employee/i.test(msg) ? msg : "Could not change the password. Please try again.",
    };
  }
  return { ok: true };
}
