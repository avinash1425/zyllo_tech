import { supabase } from "@/integrations/supabase/client";
import { notifyAdmin } from "@/lib/notify";

// Ported from the Next.js server action. The contact_submissions RLS policy
// allows public inserts, so this works unchanged from the browser client.
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

  notifyAdmin("contact", { full_name: fullName, email, phone, company, service, message });

  return { status: "success", message: "Thanks — we've got your message." };
}
