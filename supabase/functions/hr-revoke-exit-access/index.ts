// POST { exit_id: uuid }
// Exit clearance step "access_revocation": bans the leaver's Supabase Auth
// account (service role) and records it on the exit case. The caller must
// hold exit.manage — checked with the caller's JWT via hr_can_revoke_exit_access().
// HR data access already stops at hr_close_exit (portal_access=false); this
// additionally blocks sign-in itself.
import { json, preflight } from "../_shared/cors.ts";
import { callerClient, serviceClient, rpcMessage } from "../_shared/hr.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const caller = callerClient(req);
  if (!caller) return json(req, { error: "Sign in required." }, 401);

  let body: { exit_id?: string };
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON body." }, 400); }
  if (!UUID.test(body.exit_id ?? "")) return json(req, { error: "exit_id must be a UUID." }, 400);

  const { data: target, error } = await caller.rpc("hr_can_revoke_exit_access", { p_exit: body.exit_id });
  if (error) return json(req, { error: rpcMessage(error, "Not allowed to revoke access for this exit.") }, 403);

  const admin = serviceClient();
  // Failures are recorded on the exit case (visible blocking state; HR retries
  // or an exit.override holder grants an audited exception). Never silent.
  const recordFailure = async (message: string) => {
    await admin.rpc("hr_record_access_revocation_failure", { p_exit: body.exit_id, p_error: message.slice(0, 1000) })
      .then(() => {}, () => {});
  };
  if (target.user_id) {
    // ~100 years: effectively permanent; reversible by an administrator.
    const { error: banErr } = await admin.auth.admin.updateUserById(target.user_id, { ban_duration: "876000h" });
    if (banErr) {
      await recordFailure(`Could not disable the sign-in account: ${banErr.message}`);
      return json(req, { error: `Could not disable the sign-in account: ${banErr.message}` }, 502);
    }
    await admin.auth.admin.signOut(target.user_id).catch(() => {});
  }
  const { error: recErr } = await admin.rpc("hr_record_auth_access_revoked", { p_exit: body.exit_id });
  if (recErr) {
    await recordFailure(`Account disabled, but recording it failed: ${recErr.message}`);
    return json(req, { error: rpcMessage(recErr, "Account disabled, but recording it failed. Retry.") }, 500);
  }

  return json(req, { revoked: true, exit_id: body.exit_id, had_account: Boolean(target.user_id) });
});
