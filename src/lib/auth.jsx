// Client-side auth state (replaces the server-side getUser() in layout.js
// and the proxy.js session refresh — supabase-js refreshes tokens itself).
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { loadSupabase } from "@/lib/supabase/load";
import { whenIdle } from "@/lib/when-idle";

// Public pages can check the session after first paint. Pages behind login, and
// links that carry auth tokens (invites, password resets), need it straight away.
function needsAuthImmediately() {
  const { pathname, search, hash } = window.location;
  return /^\/(admin|login|signup|dashboard)(\/|$)/.test(pathname) || /(access_token|refresh_token|token_hash|code|error_description)=/.test(search + hash);
}

const AuthContext = createContext({ user: null, loading: true });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let subscription;
    (needsAuthImmediately() ? Promise.resolve() : whenIdle())
      .then(loadSupabase)
      .then((supabase) => {
        if (!active) return null;
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
          setUser(session?.user ?? null);
          setLoading(false);
        });
        subscription = sub.subscription;
        return supabase.auth.getSession().then(({ data }) => {
          if (!active) return;
          setUser(data.session?.user ?? null);
          setLoading(false);
        });
      })
      .catch(() => {
        // Client chunk failed to load: treat as signed out rather than loading forever.
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      signIn: async (email, password) => (await loadSupabase()).auth.signInWithPassword({ email, password }),
      signOut: async () => (await loadSupabase()).auth.signOut(),
    }),
    [user, loading]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
