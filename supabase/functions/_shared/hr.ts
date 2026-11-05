// Shared helpers for HRMS Edge Functions.
// - callerClient(): a client acting AS the caller (their JWT), so RLS and
//   hr_private.has_permission() evaluate for that user.
// - serviceClient(): service-role client. Only used AFTER the caller's
//   permission has been verified with callerClient(). Never exposed to browsers.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function callerClient(req: Request): SupabaseClient | null {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

export function serviceClient(): SupabaseClient {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not available to this function.");
  return createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
}

/** Returns the caller's hr_me() payload, or null when not signed in. */
export async function callerProfile(client: SupabaseClient): Promise<{ user_id: string; permissions: string[]; roles: string[] } | null> {
  const { data: u, error } = await client.auth.getUser();
  if (error || !u?.user) return null;
  const { data, error: meError } = await client.rpc("hr_me");
  if (meError || !data) return null;
  return data as { user_id: string; permissions: string[]; roles: string[] };
}

export function isServiceRoleRequest(req: Request): boolean {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const auth = req.headers.get("Authorization") ?? "";
  return Boolean(key) && auth === `Bearer ${key}`;
}

/** Extracts the human message from a PostgREST/RPC error raised by hr_private.fail(). */
export function rpcMessage(err: { message?: string } | null | undefined, fallback: string): string {
  return err?.message?.trim() || fallback;
}
