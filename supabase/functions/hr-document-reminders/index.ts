// Runs the Employee Documents reminder job (Module 9):
// public.hr_run_document_reminders() marks expired documents / contracts and
// sends the staged expiry + contract-renewal reminders configured in the
// 'documents' HR setting (in-app; email only when enabled, delivered by
// hr-email-dispatch).
//
// Callers:
//   * a scheduler with the SERVICE ROLE key  -> runs as 'scheduler'
//     (optional body { "as_of": "YYYY-MM-DD" } for controlled test runs)
//   * a signed-in user holding documents.manage -> runs as 'manual' (today)
//
// No schedule is created by this repository. See docs/hrms/MODULE_9_DOCUMENTS.md
// ("Scheduling the reminder job") for the cron set-up an administrator may
// apply after approval.
import { json, preflight } from "../_shared/cors.ts";
import { callerClient, callerProfile, isServiceRoleRequest, rpcMessage, serviceClient } from "../_shared/hr.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  let body: { as_of?: string } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const asOf = typeof body.as_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.as_of) ? body.as_of : null;

  if (isServiceRoleRequest(req)) {
    const { data, error } = await serviceClient().rpc("hr_run_document_reminders", { p_as_of: asOf, p_trigger: "scheduler" });
    if (error) return json(req, { error: rpcMessage(error, "The reminder job failed.") }, 500);
    return json(req, data);
  }

  const caller = callerClient(req);
  const profile = caller ? await callerProfile(caller) : null;
  if (!caller || !profile || !profile.permissions.includes("documents.manage")) return json(req, { error: "Not allowed." }, 403);
  // Run AS the caller so the RPC re-checks the permission (as_of is ignored for users).
  const { data, error } = await caller.rpc("hr_run_document_reminders", { p_as_of: null, p_trigger: "manual" });
  if (error) return json(req, { error: rpcMessage(error, "The reminder job failed.") }, 400);
  return json(req, data);
});
