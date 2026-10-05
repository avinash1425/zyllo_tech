// Admin gate for Edge Functions. Uses the CALLER's JWT (no service key):
// the supabase client is created with the Authorization header, so
// public.is_admin() (which reads auth.uid()) evaluates for that user and
// every query runs under the admin RLS policies.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function anonClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false },
  });
}

/** Returns a user-scoped client if the caller is an admin, else null. */
export async function requireAdmin(req: Request): Promise<SupabaseClient | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error } = await client.auth.getUser();
  if (error || !userData?.user) return null;
  const { data: isAdmin, error: rpcError } = await client.rpc("is_admin");
  if (rpcError || isAdmin !== true) return null;
  return client;
}
