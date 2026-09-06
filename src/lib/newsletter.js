// Shared newsletter signup used by Footer and the blog Newsletter section.

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export async function subscribeToNewsletter(email) {
  // Dynamically imported so the Supabase SDK stays out of the main bundle
  // (same pattern as AuthContext.tsx).
  const { supabase } = await import("@/integrations/supabase/client");
  const { error } = await supabase
    .from("newsletter_subscribers")
    .insert({ email: email.trim() });

  if (error) {
    // 23505 = Postgres unique violation — already subscribed, treat as success.
    if (error.code === "23505") return;
    throw new Error("Something went wrong subscribing you. Please try again in a moment.");
  }
}
