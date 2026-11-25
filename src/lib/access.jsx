// Roles & permissions (migration 259): what the signed-in user may see and do.
// The database enforces every permission; this only decides which menus, pages and buttons to show.
//
// Several roles per person (migration 269): a person can be e.g. HR and Manager. The top-bar role switcher
// picks ONE role at a time ("active role"); menus, pages and buttons then follow that role only. Switching
// never signs out and never touches punch-in. The choice is remembered per browser.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";

const AccessContext = createContext(null);

const storageKey = (userId) => `zt-active-role:${userId}`;
function readStored(userId) {
  try {
    return window.localStorage.getItem(storageKey(userId)) || null;
  } catch {
    return null;
  }
}
function writeStored(userId, key) {
  try {
    window.localStorage.setItem(storageKey(userId), key);
  } catch {
    /* private window / storage blocked: the switch still works until the page is reloaded */
  }
}

/** Does this role belong in this area? "admin" = admin dashboard, "portal" = Employee Portal. */
export function roleFits(role, area) {
  if (!role) return false;
  if (!Array.isArray(role.permissions)) return true; // database before migration 269
  if (area === "admin") return role.key === "super_admin" || !!role.admin_pages;
  // An admin-area role (Super Admin, Admin, HR) belongs on the admin dashboard even when it was also given a
  // few Employee Portal features; it only counts as a portal role when it has no admin pages at all.
  if (role.area === "admin") return !role.admin_pages && role.key !== "super_admin" && !!role.portal_features;
  return !!role.portal_features || role.key === "employee";
}

/** Where a role starts: its own area, or the other one when it has nothing in its own. */
export function roleHome(role) {
  if (!role) return "/admin";
  const preferAdmin = role.area === "admin";
  if (preferAdmin) return roleFits(role, "admin") ? "/admin" : "/employee";
  return roleFits(role, "portal") ? "/employee" : "/admin";
}

/** Loads rbac_my_access() once per signed-in user. `area` = "admin" | "portal" (which part of the site is open). */
export function AccessProvider({ userId, area = "admin", children }) {
  const [state, setState] = useState({ loading: true, access: null });
  const [reload, setReload] = useState(0);
  // The remembered role, tagged with its account so a different sign-in reads its own.
  const [choice, setChoice] = useState(() => ({ userId, key: readStored(userId) }));

  useEffect(() => {
    let active = true;
    supabase.rpc("rbac_my_access").then(({ data, error }) => {
      if (!active) return;
      // A database without roles yet (before migration 259): behave as before — everything is shown and
      // the database's own admin check still applies.
      if (error) setState({ loading: false, access: { legacy: true, permissions: [], roles: [] } });
      else setState({ loading: false, access: data });
    });
    return () => {
      active = false;
    };
  }, [userId, reload]);

  const stored = choice.userId === userId ? choice.key : readStored(userId);
  const roles = useMemo(() => state.access?.roles ?? [], [state.access]);
  // Per-role permissions exist from migration 269 on; before that the switcher stays hidden.
  const perRole = roles.length > 0 && roles.every((r) => Array.isArray(r.permissions));

  // The active role: the remembered one if it belongs in this area, else the first role that does.
  const activeRole = useMemo(() => {
    if (!perRole) return null;
    const remembered = roles.find((r) => r.key === stored);
    if (remembered && roleFits(remembered, area)) return remembered;
    return roles.find((r) => roleFits(r, area)) ?? remembered ?? roles[0];
  }, [perRole, roles, stored, area]);

  const setActiveRole = useCallback(
    (key) => {
      writeStored(userId, key);
      setChoice({ userId, key });
    },
    [userId],
  );

  // can("website.blog.delete") -> that exact action (migration 261).
  // can("website.blog")        -> any action of the module (used for menus and pages).
  const can = useCallback(
    (key) => {
      const a = state.access;
      if (!a) return false;
      if (a.legacy) return true;
      if (activeRole) {
        if (activeRole.key === "super_admin") return true;
        const perms = activeRole.permissions;
        return perms.includes(key) || perms.some((p) => p.startsWith(`${key}.`));
      }
      if (a.is_super_admin) return true;
      const perms = a.permissions ?? [];
      return perms.includes(key) || perms.some((p) => p.startsWith(`${key}.`));
    },
    [state.access, activeRole],
  );
  const canAny = useCallback((keys) => keys.some((k) => can(k)), [can]);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const value = { ...state, can, canAny, refresh, roles, activeRole, setActiveRole, area };
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

/** { loading, access, can(key), canAny(keys), refresh(), roles, activeRole, setActiveRole(key) }. Outside a provider everything is allowed. */
export function useAccess() {
  return (
    useContext(AccessContext) ?? {
      loading: false,
      access: { legacy: true, permissions: [], roles: [] },
      can: () => true,
      canAny: () => true,
      refresh: () => {},
      roles: [],
      activeRole: null,
      setActiveRole: () => {},
      area: "admin",
    }
  );
}
