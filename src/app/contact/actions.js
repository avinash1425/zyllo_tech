"use server";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";

// Uses the publishable-key client (not the secret-key one) even though
// this runs on the server — the contact_submissions table's RLS policy
// only allows public inserts, which is exactly the access this action
// needs. No admin/service-role privileges required here.
export async function submitContactForm(prevState, formData) {
  const fullName = formData.get("fullName")?.toString().trim();
  const email = formData.get("email")?.toString().trim();
  const phone = formData.get("phone")?.toString().trim();
  const company = formData.get("company")?.toString().trim();
  const service = formData.get("service")?.toString().trim();
  const message = formData.get("description")?.toString().trim();

  if (!fullName || !email || !message) {
    return { status: "error", message: "Please fill in your name, email, and project details." };
  }

  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase.from("contact_submissions").insert({
    full_name: fullName,
    email,
    phone: phone || null,
    company: company || null,
    service: service || null,
    message,
  });

  if (error) {
    console.error("Failed to save contact submission:", error.message);
    return {
      status: "error",
      message: "Something went wrong sending your message. Please try again.",
    };
  }

  return { status: "success", message: "Thanks — we've got your message." };
}
