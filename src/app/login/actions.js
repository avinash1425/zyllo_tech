"use server";

import { redirect } from "next/navigation";
import { createSsrServerClient } from "@/lib/supabase/ssr-server";

export async function signIn(prevState, formData) {
  const email = formData.get("email")?.toString().trim();
  const password = formData.get("password")?.toString();
  const next = formData.get("next")?.toString() || "/admin";

  if (!email || !password) {
    return { status: "error", message: "Please enter your email and password." };
  }

  const supabase = await createSsrServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { status: "error", message: "Invalid email or password." };
  }

  redirect(next);
}

export async function signOut() {
  const supabase = await createSsrServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
