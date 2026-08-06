"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function updateSubmissionStatus(submissionId, newStatus) {
  if (!["new", "contacted", "closed"].includes(newStatus)) {
    return { status: "error", message: "Invalid status." };
  }

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("contact_submissions")
    .update({ status: newStatus })
    .eq("id", submissionId);

  if (error) {
    console.error("Failed to update submission status:", error.message);
    return { status: "error", message: "Could not update status." };
  }

  revalidatePath("/admin/contacts");
  return { status: "success" };
}

export async function deleteSubmission(submissionId) {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("contact_submissions")
    .delete()
    .eq("id", submissionId);

  if (error) {
    console.error("Failed to delete submission:", error.message);
    return { status: "error", message: "Could not delete submission." };
  }

  revalidatePath("/admin/contacts");
  return { status: "success" };
}
