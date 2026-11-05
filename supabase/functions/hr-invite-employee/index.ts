// POST { employee_id: uuid }
// Sends a Supabase Auth invitation to the employee's COMPANY email and links
// the new auth user to the employee record. Caller must hold employees.invite
// (checked with the caller's own JWT via hr_can_invite()).
// Responds with success ONLY after the invite was accepted by Supabase Auth
// and the account link was committed.
import { json, preflight } from "../_shared/cors.ts";
import { callerClient, serviceClient, rpcMessage } from "../_shared/hr.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const caller = callerClient(req);
  if (!caller) return json(req, { error: "Sign in required." }, 401);
  const { data: who, error: whoErr } = await caller.auth.getUser();
  if (whoErr || !who?.user) return json(req, { error: "Sign in required." }, 401);

  let body: { employee_id?: string };
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON body." }, 400); }
  const employeeId = body.employee_id ?? "";
  if (!UUID.test(employeeId)) return json(req, { error: "employee_id must be a UUID." }, 400);

  // 1. Permission + state check AS THE CALLER (RLS / has_permission apply).
  const { data: target, error: checkErr } = await caller.rpc("hr_can_invite", { p_employee: employeeId });
  if (checkErr) return json(req, { error: rpcMessage(checkErr, "Not allowed to invite this employee.") }, 403);
  if (target.user_id) return json(req, { error: "This employee already has a linked account. Use portal access controls or a password reset instead." }, 409);

  const portalUrl = (Deno.env.get("HR_PORTAL_URL") ?? Deno.env.get("SITE_URL") ?? "https://zyllotech.com").replace(/\/$/, "");
  const admin = serviceClient();

  // 2. Invite through Supabase Auth (Supabase sends the email with its configured SMTP).
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(target.email, {
    redirectTo: `${portalUrl}/employee/activate`,
    data: { employee_id: employeeId },
  });
  if (inviteErr || !invited?.user) {
    const msg = /already been registered|already registered|exists/i.test(inviteErr?.message ?? "")
      ? "An account with this email already exists. Ask a Super Admin to link it manually."
      : `Invitation could not be sent: ${inviteErr?.message ?? "unknown error"}`;
    return json(req, { error: msg }, 502);
  }

  // 3. Link the account (service-role-only RPC; also grants the default self-service role).
  const { error: linkErr } = await admin.rpc("hr_link_invited_user", {
    p_employee: employeeId, p_user: invited.user.id, p_invited_by: who.user.id,
  });
  if (linkErr) {
    // Roll back the orphan auth user so a retry is clean.
    await admin.auth.admin.deleteUser(invited.user.id).catch(() => {});
    return json(req, { error: rpcMessage(linkErr, "The invitation was created but linking failed; nothing was saved.") }, 500);
  }

  return json(req, { invited: true, email: target.email, employee_id: employeeId });
});
