// Single browser Supabase client (publishable key + user session in
// localStorage). All access control is enforced by Row Level Security —
// see supabase/policies/*.sql. The service/secret key is never used here.
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/lib/env";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export function createBrowserSupabaseClient() {
  return supabase;
}
