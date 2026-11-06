// Employee ID sign-in: core logic shared by hr-employee-login (HR actions)
// and hr-change-my-password (employee self-service). Runtime-neutral (no Deno
// or esm.sh imports) so it can be exercised from Node against a dev project.
//
// Security rules:
// - Every HR action is authorised FIRST with the caller's own JWT
//   (public.hr_can_manage_login -> employees.manage_login, RLS context).
//   The service-role client is used only after that check passes.
// - Temporary passwords are generated here with a CSPRNG, returned once in
//   the HTTP response to the authorised HR user and never logged or stored
//   (Supabase Auth keeps only its bcrypt hash).
// - No email is ever sent: accounts are created with email_confirm = true
//   at an internal, never-mailed address (<employee id>@staff.zyllotech.com).

// deno-lint-ignore-file no-explicit-any
type Client = any;

export const LOGIN_DOMAIN = "staff.zyllotech.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAN_FOREVER = "876000h"; // ~100 years; reversible by "Activate"

export type Result = { status: number; body: Record<string, unknown> };
const fail = (status: number, error: string): Result => ({ status, body: { error } });

// ------------------------------------------------------------------ passwords
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGIT = "23456789";
const SYMBOL = "!@#$%*-_+=?";
const ALL = UPPER + LOWER + DIGIT + SYMBOL;

/** Uniform random index in [0, n) using rejection sampling (no modulo bias). */
function randomIndex(n: number): number {
  const limit = Math.floor(256 / n) * n;
  const buf = new Uint8Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** 16-character one-time password with upper, lower, digit and symbol. */
export function generateTemporaryPassword(length = 16): string {
  for (;;) {
    let pw = "";
    for (let i = 0; i < length; i++) pw += ALL[randomIndex(ALL.length)];
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) return pw;
  }
}

/** Server-side password policy for the employee's own password. */
export function passwordProblems(pw: string, loginId?: string | null): string[] {
  const p: string[] = [];
  if (typeof pw !== "string" || pw.length < 12) p.push("at least 12 characters");
  if (typeof pw === "string" && pw.length > 72) p.push("at most 72 characters");
  if (!/[a-z]/.test(pw ?? "") || !/[A-Z]/.test(pw ?? "")) p.push("upper- and lower-case letters");
  if (!/\d/.test(pw ?? "")) p.push("a number");
  if (loginId && typeof pw === "string" && pw.toLowerCase().includes(String(loginId).toLowerCase())) p.push("not your Employee ID");
  return p;
}

/** session_id claim of an access token the Auth server has already verified. */
export function sessionIdFromAuthHeader(authHeader: string | null): string | null {
  const token = (authHeader ?? "").replace(/^bearer\s+/i, "");
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const claims = JSON.parse(atob(b64));
    return typeof claims.session_id === "string" && UUID.test(claims.session_id) ? claims.session_id : null;
  } catch {
    return null;
  }
}

const rpcError = (e: { message?: string } | null | undefined, fallback: string) => e?.message?.trim() || fallback;

// ------------------------------------------------------------------ HR actions
export type ManageInput = { caller: Client; admin: Client; callerUserId: string; employeeId: unknown; action: unknown };

/**
 * create | reset | activate | deactivate an Employee ID login.
 * `caller` is a client acting with the caller's JWT, `admin` the service-role client.
 */
export async function manageEmployeeLogin({ caller, admin, callerUserId, employeeId, action }: ManageInput): Promise<Result> {
  if (typeof employeeId !== "string" || !UUID.test(employeeId)) return fail(400, "employee_id must be a UUID.");
  if (typeof action !== "string" || !["create", "reset", "activate", "deactivate"].includes(action)) {
    return fail(400, "action must be create, reset, activate or deactivate.");
  }

  // 1. Authorisation + state check AS THE CALLER (employees.manage_login, RLS).
  const { data: target, error: checkErr } = await caller.rpc("hr_can_manage_login", { p_employee: employeeId, p_action: action });
  if (checkErr || !target) return fail(403, rpcError(checkErr, "Not allowed to manage this employee's sign-in."));
  if (target.caller !== callerUserId) return fail(403, "Caller mismatch.");

  if (action === "create") {
    const password = generateTemporaryPassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: target.login_email,
      password,
      email_confirm: true, // no verification / invitation email
      app_metadata: { hr_login: "employee_id", employee_id: employeeId },
      user_metadata: {},
    });
    if (createErr || !created?.user) {
      const exists = /already|exists|registered/i.test(createErr?.message ?? "");
      return fail(exists ? 409 : 502, exists
        ? "A sign-in account for this Employee ID already exists. Contact a Super Admin."
        : "The sign-in account could not be created. Nothing was saved.");
    }
    const { error: linkErr } = await admin.rpc("hr_link_employee_login", {
      p_employee: employeeId, p_user: created.user.id, p_actor: callerUserId,
    });
    if (linkErr) {
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
      return fail(500, rpcError(linkErr, "The account was created but linking failed; it was removed again."));
    }
    return { status: 200, body: { ok: true, action, employee_id: employeeId, login_id: target.login_id, temporary_password: password } };
  }

  if (action === "reset") {
    // Flag + end sessions + clear lockout FIRST; then replace the password.
    const { error: beginErr } = await admin.rpc("hr_begin_password_reset", { p_employee: employeeId, p_actor: callerUserId });
    if (beginErr) return fail(500, rpcError(beginErr, "The reset could not be started. Nothing was changed."));
    const password = generateTemporaryPassword();
    const { error: upErr } = await admin.auth.admin.updateUserById(target.user_id, { password });
    if (upErr) {
      return fail(502, "Sessions were ended and a password change is now required, but the new temporary password could not be set. Try again.");
    }
    return { status: 200, body: { ok: true, action, employee_id: employeeId, login_id: target.login_id, temporary_password: password } };
  }

  if (action === "deactivate") {
    // Data access + sessions end immediately (database), then block new sign-ins (ban).
    const { error: offErr } = await admin.rpc("hr_set_employee_login_active", { p_employee: employeeId, p_enabled: false, p_actor: callerUserId });
    if (offErr) return fail(500, rpcError(offErr, "Could not deactivate the login."));
    const { error: banErr } = await admin.auth.admin.updateUserById(target.user_id, { ban_duration: BAN_FOREVER });
    if (banErr) return fail(502, "Portal access is disabled and all sessions were ended, but blocking new sign-ins failed. Try again.");
    return { status: 200, body: { ok: true, action, employee_id: employeeId, login_id: target.login_id } };
  }

  // activate: lift the ban, then re-enable portal access.
  const { error: unbanErr } = await admin.auth.admin.updateUserById(target.user_id, { ban_duration: "none" });
  if (unbanErr) return fail(502, "Could not re-enable sign-in. Nothing was changed.");
  const { error: onErr } = await admin.rpc("hr_set_employee_login_active", { p_employee: employeeId, p_enabled: true, p_actor: callerUserId });
  if (onErr) {
    await admin.auth.admin.updateUserById(target.user_id, { ban_duration: BAN_FOREVER }).catch(() => {});
    return fail(500, rpcError(onErr, "Could not activate the login."));
  }
  return { status: 200, body: { ok: true, action, employee_id: employeeId, login_id: target.login_id } };
}

// ------------------------------------------------------------------ self-service
export type ChangeInput = {
  admin: Client;
  /** Fresh anon client used only to verify the current password. */
  verifier: Client;
  userId: string;
  sessionId: string | null;
  currentPassword: unknown;
  newPassword: unknown;
};

/** The signed-in employee replaces a temporary / expired / current password. */
export async function changeOwnPassword({ admin, verifier, userId, sessionId, currentPassword, newPassword }: ChangeInput): Promise<Result> {
  if (typeof currentPassword !== "string" || !currentPassword) return fail(400, "Enter your current password.");
  if (typeof newPassword !== "string") return fail(400, "Enter a new password.");
  if (!sessionId) return fail(401, "Your session has ended. Sign in again.");

  const { data: own, error: ownErr } = await admin.rpc("hr_own_login_for_password_change", { p_user: userId, p_session: sessionId });
  if (ownErr || !own) return fail(403, rpcError(ownErr, "Password change is not available for this account."));

  const problems = passwordProblems(newPassword, own.login_id);
  if (problems.length) return fail(400, `Password needs ${problems.join(", ")}.`);
  if (newPassword === currentPassword) return fail(400, "Choose a password different from the current one.");

  // Verify the current password through Supabase Auth itself (same rate
  // limits and lockout hook as the sign-in page).
  const { data: v, error: vErr } = await verifier.auth.signInWithPassword({ email: own.login_email, password: currentPassword });
  if (vErr || v?.user?.id !== userId) return fail(400, "The current password is incorrect.");

  try {
    // Supabase Auth ends EVERY session of the user on an admin password
    // update (verified on the dev project), including the caller's; the
    // app signs in again with the new password.
    const { error: upErr } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
    if (upErr) return fail(400, /weak|pwned|leaked|length|characters/i.test(upErr.message ?? "")
      ? "That password is not allowed. Choose a stronger one."
      : "The password could not be changed. Try again.");
    // Clears the flag, stamps password_changed_at, revokes any remaining session, audits.
    const { error: doneErr } = await admin.rpc("hr_complete_own_password_change", { p_user: userId });
    if (doneErr) return fail(500, rpcError(doneErr, "Password changed, but finishing failed. Sign in again with the new password."));
    return { status: 200, body: { ok: true, sign_in_again: true } };
  } finally {
    // Ends only the verification session if it still exists (scope local).
    await verifier.auth.signOut({ scope: "local" }).catch(() => {});
  }
}
