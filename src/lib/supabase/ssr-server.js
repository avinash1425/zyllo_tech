// Session-aware Supabase client for Server Components, Server Actions,
// and Route Handlers. Uses the public/publishable key plus the visitor's
// auth cookies, so `supabase.auth.getUser()` reflects who's actually
// logged in. This is separate from server.js (the secret-key client used
// for admin data writes) — this one is for checking WHO is signed in,
// not for bypassing RLS.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSsrServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll called from a Server Component without a response to
            // write to — safe to ignore since middleware refreshes the
            // session on every request anyway.
          }
        },
      },
    }
  );
}
