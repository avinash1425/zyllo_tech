import { supabase } from "@/integrations/supabase/client";

export type UserRole = "admin" | "moderator" | "user";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Get role
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  const role: UserRole = roles?.some((r: any) => r.role === "admin")
    ? "admin"
    : "user";

  return {
    id: user.id,
    name: user.user_metadata?.full_name || "",
    email: user.email || "",
    role,
    createdAt: user.created_at,
  };
}

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<void> {
  const { error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { full_name: input.name },
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) throw new Error(error.message);
}

export async function authenticateUser(
  email: string,
  password: string,
): Promise<AuthUser> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw new Error(error.message);

  const user = data.user;
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  const role: UserRole = roles?.some((r: any) => r.role === "admin")
    ? "admin"
    : "user";

  return {
    id: user.id,
    name: user.user_metadata?.full_name || "",
    email: user.email || "",
    role,
    createdAt: user.created_at,
  };
}

export async function clearSession(): Promise<void> {
  await supabase.auth.signOut();
}
