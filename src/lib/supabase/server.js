// Server-side Supabase client used by Server Components, Server Actions
// and Route Handlers.
//
// This used to be created with a service-role/secret key that bypassed
// Row Level Security. That key is not available in this hosting
// environment, so the client is now session-aware instead: it uses the
// publishable key plus the visitor's auth cookies. Public visitors get
// the anon role (RLS exposes published blog posts, published portfolio
// projects, open job postings, and lets them submit contact forms /
// applications), while a signed-in admin gets the authenticated role,
// which RLS grants full read/write on the content and lead tables.
//
// It is async because Next.js requires `cookies()` to be awaited, so
// every call site must `await createServerSupabaseClient()`.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function await createServerSupabaseClient() {
  let cookieStore = null;
  try {
    cookieStore = await cookies();
  } catch {
    // Called outside a request scope (e.g. during static generation) —
    // fall back to an anonymous client with no session cookies.
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore ? cookieStore.getAll() : [];
        },
        setAll(cookiesToSet) {
          if (!cookieStore) return;
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component render — cookies are read-only here. The
            // proxy refreshes the session on every request anyway.
          }
        },
      },
    }
  );
}
