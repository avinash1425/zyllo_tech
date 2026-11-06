// Pure helpers for Employee ID sign-in display and mapping (no React, no
// Supabase) so they can be unit-tested with `npm test`.

// Supabase Auth needs an email-shaped identifier, so an Employee ID (ZT-0007)
// maps to an internal, never-mailed login address (zt-0007@staff.zyllotech.com).
// Must match hr_private.employee_login_email() (migration 200). Anything that
// contains "@" is used unchanged (Website Admin / HR Admin email sign-in).
export const EMPLOYEE_LOGIN_DOMAIN = "staff.zyllotech.com";
const EMPLOYEE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function loginEmailFor(identifier) {
  const s = String(identifier ?? "").trim();
  if (s.includes("@")) return s;
  return EMPLOYEE_ID.test(s) ? `${s.toLowerCase()}@${EMPLOYEE_LOGIN_DOMAIN}` : null;
}

/** Employee ID of an Employee-ID account (hr_me().login), else null. */
export function employeeLoginIdOf(hr) {
  return hr?.login?.login_id || null;
}

/** What the account menu shows: the Employee ID, never the internal address. */
export function accountLabelFor({ user, hr }) {
  const id = employeeLoginIdOf(hr);
  if (id) return `Employee ID ${id}`;
  const email = user?.email ?? "";
  // Defensive: never surface an internal login address even if hr_me is missing.
  return email.toLowerCase().endsWith(`@${EMPLOYEE_LOGIN_DOMAIN}`) ? "" : email;
}

/** Only Employee-ID accounts get "Change password" (email accounts are unchanged). */
export function canChangeOwnPassword(hr) {
  return Boolean(employeeLoginIdOf(hr));
}
