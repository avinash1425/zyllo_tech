import { supabase } from "@/lib/supabase/client";

// Plain async replacement for the old "use server" action. Same
// (prevState, formData) signature so it plugs straight into React 19's
// useActionState. Requires an RLS policy allowing anon INSERT on
// contact_submissions.
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
