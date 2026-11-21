// The app's ONE browser Supabase client (publishable key + user session).
// All access control is enforced by Row Level Security — see
// supabase/policies/*.sql. The service/secret key is never used here.
//
// It re-exports the Lovable-generated client instead of calling createClient
// again: two clients on the same project share one localStorage session key,
// which triggers "Multiple GoTrueClient instances detected" and lets both
// refresh the same refresh token (the loser's session is revoked). The website
// (/login, /admin) must use this one instance.
import { supabase } from "@/integrations/supabase/client";

export { supabase };

export function createBrowserSupabaseClient() {
  return supabase;
}
