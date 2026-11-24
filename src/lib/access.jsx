// Roles & permissions (migration 259): what the signed-in user may see and do.
// The database enforces every permission; this only decides which menus, pages and buttons to show.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

const AccessContext = createContext(null);

/** Loads rbac_my_access() once per signed-in user. */
export function AccessProvider({ userId, children }) {
  const [state, setState] = useState({ loading: true, access: null });
  const [reload, setReload] = useState(0);

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

  // can("website.blog.delete") -> that exact action (migration 261).
  // can("website.blog")        -> any action of the module (used for menus and pages).
  const can = useCallback(
    (key) => {
      const a = state.access;
      if (!a) return false;
      if (a.legacy || a.is_super_admin) return true;
      const perms = a.permissions ?? [];
      return perms.includes(key) || perms.some((p) => p.startsWith(`${key}.`));
    },
    [state.access],
  );
  const canAny = useCallback((keys) => keys.some((k) => can(k)), [can]);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  return <AccessContext.Provider value={{ ...state, can, canAny, refresh }}>{children}</AccessContext.Provider>;
}

/** { loading, access, can(key), canAny(keys), refresh() }. Outside a provider everything is allowed. */
export function useAccess() {
  return (
    useContext(AccessContext) ?? {
      loading: false,
      access: { legacy: true, permissions: [], roles: [] },
      can: () => true,
      canAny: () => true,
      refresh: () => {},
    }
  );
}
