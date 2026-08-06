// Browser/public Supabase client — uses the publishable key, safe to use
// in client components. Relies on Row Level Security (RLS) policies to
// control what data is actually readable/writable from here.
import { createClient } from "@supabase/supabase-js";

export function createBrowserSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
