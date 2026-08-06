// Server-only Supabase client — uses the secret key, which bypasses Row
// Level Security entirely. NEVER import this file from a "use client"
// component or expose SUPABASE_SECRET_KEY to the browser. Use this only
// inside Server Components, Server Actions, and Route Handlers (e.g. for
// the admin panel's create/edit/delete operations).
import { createClient } from "@supabase/supabase-js";

export function createServerSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
