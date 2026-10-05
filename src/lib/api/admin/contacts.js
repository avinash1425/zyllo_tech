
import { supabase } from "@/lib/supabase/client";

export async function updateSubmissionStatus(submissionId, newStatus) {
  if (!["new", "contacted", "closed"].includes(newStatus)) {
    return { status: "error", message: "Invalid status." };
  }

  const { error } = await supabase
    .from("contact_submissions")
    .update({ status: newStatus })
    .eq("id", submissionId);

  if (error) {
    console.error("Failed to update submission status:", error.message);
    return { status: "error", message: "Could not update status." };
  }

  return { status: "success" };
}

export async function deleteSubmission(submissionId) {
  const { error } = await supabase
    .from("contact_submissions")
    .delete()
    .eq("id", submissionId);

  if (error) {
    console.error("Failed to delete submission:", error.message);
    return { status: "error", message: "Could not delete submission." };
  }

  return { status: "success" };
}

export async function fetchSubmissions() {
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
