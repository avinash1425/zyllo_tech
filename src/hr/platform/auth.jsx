// HRMS authentication = Supabase Auth (same session as the rest of the site).
// Roles/permissions come from the server: public.hr_me(). They drive
// navigation/UX only; every table and RPC re-checks access with RLS.
// Kept separate from the site's own AuthContext (src/contexts/AuthContext.tsx)
// so the HRMS permission model does not change the website's admin/user login.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/hr/platform/supabase";
import { destinationFor, hrPortalFor, loginEmailFor, signInDestination } from "@/hr/platform/account";

const AuthContext = createContext(null);

// Routing rules live in account.js (pure, unit-tested); re-exported here so
// existing imports keep working. There is ONE login page: /login.
export {
  EMPLOYEE_LOGIN_DOMAIN, LOGIN_PATH, SET_PASSWORD_PATH, destinationFor, hrPortalFor, loginEmailFor, safeNext,
  signInDestination, usableNext,
} from "@/hr/platform/account";
export const HR_LOGIN_PATH = "/login"; // legacy name; /hr/login now redirects to /login

// Used by the unified /login page right after a successful sign-in (or when an
// already signed-in user opens /login): decides where the account goes.
// Website Admin -> /admin, HR Admin -> /hr, Employee -> /employee, Employee ID
// account with a temporary/expired password -> /employee/set-password,
// nothing granted -> /account-pending. A ?next= is honoured only when usable.
export async function resolveSignIn(next) {
  const [{ data: me, error }, isSiteAdmin] = await Promise.all([
    supabase.rpc("hr_me").then((r) => r, () => ({ data: null, error: true })),
    loadSiteAdmin().catch(() => false),
  ]);
  const hr = error ? null : me;
  if (hr?.session_ended) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    return { sessionEnded: true, destination: null };
  }
  return { sessionEnded: false, destination: signInDestination({ hr, isSiteAdmin, next }) };
}

// Kept for compatibility (older callers): the HRMS portal for the current session.
export async function loadHrPortal() {
  const { data, error } = await supabase.rpc("hr_me");
  return error ? null : hrPortalFor(data);
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
  const [sessionEnded, setSessionEnded] = useState(false);

  const loadProfile = useCallback(async (sessionUser) => {
    if (!sessionUser) { setHr(null); setIsSiteAdmin(false); return { hr: null, isSiteAdmin: false }; }
    const [{ data: me }, admin] = await Promise.all([
      supabase.rpc("hr_me").then((r) => r, () => ({ data: null })),
      loadSiteAdmin().catch(() => false),
    ]);
    // Migration 202: this device's session was ended elsewhere (sign-out on
    // all devices, reset, deactivation, exit revocation). Clear it locally and
    // send the user to sign in again instead of showing "Access disabled".
    if (me?.session_ended) {
      setSessionEnded(true);
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      setUser(null); setHr(null); setIsSiteAdmin(false);
      return { hr: null, isSiteAdmin: false, sessionEnded: true };
    }
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
    sessionEnded,
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
      setSessionEnded(false);
      const profile = await loadProfile(res.data.user);
      if (profile.sessionEnded) return generic;
      return { ...res, hr: profile.hr, destination: destinationFor({ user: res.data.user, ...profile }) };
    },
    // Self-registration is disabled for the HRMS: HR creates Employee ID
    // logins (Edge Function hr-employee-login).
    signUp: async () => ({
      data: null,
      error: { message: "Accounts are created by Zyllo Tech HR. Ask HR for your Employee ID and temporary password." },
    }),
    // Ordinary sign-out ends THIS device's session only. Security revocations
    // (deactivate, reset, exit, suspension) end all sessions server-side.
    signOut: async () => {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      setUser(null); setHr(null); setIsSiteAdmin(false);
    },
  }), [user, hr, isSiteAdmin, loading, sessionEnded, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
