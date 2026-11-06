// HRMS authentication = Supabase Auth (same session as the rest of the site).
// Roles/permissions come from the server: public.hr_me(). They drive
// navigation/UX only; every table and RPC re-checks access with RLS.
// Kept separate from the site's own AuthContext (src/contexts/AuthContext.tsx)
// so the HRMS permission model does not change the website's admin/user login.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/hr/platform/supabase";
import { loginEmailFor } from "@/hr/platform/account";

const AuthContext = createContext(null);

const HR_HOME_PERMISSIONS = ["dashboard.view", "dashboard.view_team", "employees.view", "employees.view_team", "payroll.view", "settings.view", "recruitment.view", "reports.view", "reports.view_team"];

export const HR_LOGIN_PATH = "/hr/login";
export const SET_PASSWORD_PATH = "/employee/set-password";

// Employee ID sign-in mapping (ZT-0007 -> zt-0007@staff.zyllotech.com); see account.js.
export { EMPLOYEE_LOGIN_DOMAIN, loginEmailFor } from "@/hr/platform/account";

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

// Used by the website's shared /login page: send the signed-in user to their
// HRMS portal if they have one. Returns null when hr_me() is missing (e.g. a
// project without the HRMS schema) or grants nothing, so the caller keeps its
// default (/admin).
export async function loadHrPortal() {
  const { data, error } = await supabase.rpc("hr_me");
  return error ? null : hrPortalFor(data);
}

export function destinationFor({ user, hr, isSiteAdmin }) {
  if (!user) return HR_LOGIN_PATH;
  const portal = hrPortalFor(hr);
  if (portal) return portal;
  if (isSiteAdmin) return "/admin";
  return "/account-pending";
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

async function loadSiteAdmin() {
  // Website admin = public.is_admin() (admin_users), the same check the
  // /admin route guard uses. (There is no public.has_role in this schema.)
  const { data, error } = await supabase.rpc("is_admin");
  return !error && data === true;
}

export function HrAuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [hr, setHr] = useState(null); // hr_me() payload
  const [isSiteAdmin, setIsSiteAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (sessionUser) => {
    if (!sessionUser) { setHr(null); setIsSiteAdmin(false); return { hr: null, isSiteAdmin: false }; }
    const [{ data: me }, admin] = await Promise.all([
      supabase.rpc("hr_me").then((r) => r, () => ({ data: null })),
      loadSiteAdmin().catch(() => false),
    ]);
    setHr(me ?? null);
    setIsSiteAdmin(admin);
    return { hr: me ?? null, isSiteAdmin: admin };
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      const u = data.session?.user ?? null;
      setUser(u);
      await loadProfile(u);
      if (active) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      // Defer the RPCs out of the auth callback (supabase-js recommendation).
      setTimeout(() => { if (active) loadProfile(u).finally(() => active && setLoading(false)); }, 0);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const value = useMemo(() => ({
    user,
    hr,
    isSiteAdmin,
    loading,
    destination: destinationFor({ user, hr, isSiteAdmin }),
    hasPermission: (key) => Boolean(hr?.permissions?.includes(key)),
    refreshProfile: () => loadProfile(user),
    // `identifier` is an Employee ID (Employee Portal) or an email address
    // (Website Admin / HR Admin, unchanged).
    signIn: async (identifier, password) => {
      const email = loginEmailFor(identifier);
      const generic = { data: null, error: { message: "Incorrect Employee ID / email or password, or the account is not active." } };
      if (!email) return generic;
      const res = await supabase.auth.signInWithPassword({ email, password });
      if (res.error) {
        // 429 = Auth rate limit; the lockout hook rejects with its own message.
        if (res.error.status === 429 || /too many sign-in attempts/i.test(res.error.message ?? "")) {
          return { data: null, error: { message: "Too many sign-in attempts. Wait a few minutes and try again, or contact HR." } };
        }
        return generic;
      }
      const profile = await loadProfile(res.data.user);
      return { ...res, hr: profile.hr, destination: destinationFor({ user: res.data.user, ...profile }) };
    },
    // Self-registration is disabled for the HRMS: HR creates Employee ID
    // logins (Edge Function hr-employee-login).
    signUp: async () => ({
      data: null,
      error: { message: "Accounts are created by Zyllo Tech HR. Ask HR for your Employee ID and temporary password." },
    }),
    signOut: async () => {
      await supabase.auth.signOut().catch(() => {});
      setUser(null); setHr(null); setIsSiteAdmin(false);
    },
  }), [user, hr, isSiteAdmin, loading, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
