import { createServerSupabaseClient } from "@/lib/supabase/server";
import ContactsManager from "./ContactsManager";

async function getSubmissions() {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("contact_submissions")
    .select("id, full_name, email, phone, company, service, message, status, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load contact submissions:", error.message);
    return [];
  }

  return data ?? [];
}

export default async function AdminContactsPage() {
  const submissions = await getSubmissions();
  return <ContactsManager initialSubmissions={submissions} />;
}
