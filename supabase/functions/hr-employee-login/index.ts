// POST { employee_id: uuid, action: "create" | "reset" | "activate" | "deactivate" }
// HR manages Employee ID sign-in (no email). The caller must hold
// employees.manage_login — checked with the caller's own JWT via
// public.hr_can_manage_login() before the service role is used.
// "create" / "reset" return a one-time temporary_password for the HR user to
// hand to the employee; it is never logged or stored by this function.
import { json, preflight } from "../_shared/cors.ts";
import { callerClient, serviceClient } from "../_shared/hr.ts";
import { manageEmployeeLogin } from "../_shared/employee_login.ts";

const NO_STORE = { "Cache-Control": "no-store", "Pragma": "no-cache" };

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405, NO_STORE);

  const caller = callerClient(req);
  if (!caller) return json(req, { error: "Sign in required." }, 401, NO_STORE);
  const { data: who, error: whoErr } = await caller.auth.getUser();
  if (whoErr || !who?.user) return json(req, { error: "Sign in required." }, 401, NO_STORE);

  let body: { employee_id?: unknown; action?: unknown };
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON body." }, 400, NO_STORE); }

  try {
    const res = await manageEmployeeLogin({
      caller, admin: serviceClient(), callerUserId: who.user.id, employeeId: body.employee_id, action: body.action,
    });
    return json(req, res.body, res.status, NO_STORE);
  } catch (_e) {
    // Never echo internals (or anything that could contain a password).
    return json(req, { error: "The request could not be completed." }, 500, NO_STORE);
  }
});
