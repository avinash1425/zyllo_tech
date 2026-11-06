// Pure helpers for sign-in mapping, post-sign-in routing and account display
// (no React, no Supabase) so they can be unit-tested with `npm test`.

// ------------------------------------------------------------------ routing
// One login page for everyone (Website Admin, HR Admin, Employee).
export const LOGIN_PATH = "/login";
export const SET_PASSWORD_PATH = "/employee/set-password";
const HR_HOME_PERMISSIONS = ["dashboard.view", "dashboard.view_team", "employees.view", "employees.view_team", "payroll.view", "settings.view", "recruitment.view", "reports.view", "reports.view_team"];

// The HRMS portal an hr_me() payload grants, or null when it grants none.
// An Employee ID account with a temporary or expired password has no access
// until it chooses a new one (enforced in the database too).
export function hrPortalFor(hr) {
  if (hr?.login?.password_change_required) return SET_PASSWORD_PATH;
  const perms = hr?.permissions ?? [];
  if (perms.some((p) => HR_HOME_PERMISSIONS.includes(p))) return "/hr";
  if (hr?.employee) return "/employee";
  return null;
}

// Where a signed-in account belongs: HR portal (/hr, /employee or the
// password change), then the website admin (/admin), else account-pending.
export function destinationFor({ user, hr, isSiteAdmin }) {
  if (!user) return LOGIN_PATH;
  const portal = hrPortalFor(hr);
  if (portal) return portal;
  if (isSiteAdmin) return "/admin";
  return "/account-pending";
}

// Only same-site relative paths (no open redirect), never the login page itself.
export function safeNext(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/^\/(login|hr\/login|employee\/login)(\/|$|\?)/.test(value)) return null;
  return value;
}

// Honour a ?next= HRMS path only when this account can open it; otherwise the
// user would land on a "No employee profile" / "Not authorised" dead end.
export function usableNext(next, hr) {
  if (!next) return null;
  if (hr?.login?.password_change_required) return null; // must choose a password first
  if (/^\/employee(\/|$|\?)/.test(next)) return hr?.employee ? next : null;
  if (/^\/hr(\/|$|\?)/.test(next)) return hrPortalFor(hr) === "/hr" ? next : null;
  return next;
}

// Final target after signing in on /login: a usable ?next= (website /admin
// pages only for website admins), otherwise the account's own home.
export function signInDestination({ hr, isSiteAdmin, next }) {
  const n = safeNext(next);
  let target = null;
  if (n && /^\/admin(\/|$|\?)/.test(n)) target = isSiteAdmin && !hr?.login?.password_change_required ? n : null;
  else if (n) target = usableNext(n, hr);
  return target ?? destinationFor({ user: true, hr, isSiteAdmin });
}

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
