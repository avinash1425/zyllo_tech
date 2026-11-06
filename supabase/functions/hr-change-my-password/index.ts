// POST { current_password: string, new_password: string }
// An employee who signs in with an Employee ID replaces a temporary or
// expired password (or changes it voluntarily). The current password is
// verified through Supabase Auth; the change clears the "must change" flag
// and ends every session (the app signs in again with the new password).
// Passwords are never logged or stored here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";
import { callerClient, serviceClient } from "../_shared/hr.ts";
import { changeOwnPassword, sessionIdFromAuthHeader } from "../_shared/employee_login.ts";

const NO_STORE = { "Cache-Control": "no-store", "Pragma": "no-cache" };

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405, NO_STORE);

  const caller = callerClient(req);
  if (!caller) return json(req, { error: "Sign in required." }, 401, NO_STORE);
  // getUser() validates the token with the Auth server before its claims are trusted.
  const { data: who, error: whoErr } = await caller.auth.getUser();
  if (whoErr || !who?.user) return json(req, { error: "Sign in required." }, 401, NO_STORE);

  let body: { current_password?: unknown; new_password?: unknown };
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON body." }, 400, NO_STORE); }

  const verifier = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    const res = await changeOwnPassword({
      admin: serviceClient(), verifier, userId: who.user.id,
      sessionId: sessionIdFromAuthHeader(req.headers.get("Authorization")),
      currentPassword: body.current_password, newPassword: body.new_password,
    });
    return json(req, res.body, res.status, NO_STORE);
  } catch (_e) {
    return json(req, { error: "The request could not be completed." }, 500, NO_STORE);
  }
});
