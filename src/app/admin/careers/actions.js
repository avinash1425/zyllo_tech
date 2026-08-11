"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function createJobPosting(prevState, formData) {
  const title = formData.get("title")?.toString().trim();
  const department = formData.get("department")?.toString().trim();
  const location = formData.get("location")?.toString().trim() || "Remote / India";
  const employmentType = formData.get("employmentType")?.toString().trim() || "Full-time";
  const description = formData.get("description")?.toString().trim() || "";
  const totalOpenings = Number(formData.get("totalOpenings")) || 1;

  if (!title || !department) {
    return { status: "error", message: "Title and department are required." };
  }
  if (totalOpenings < 1) {
    return { status: "error", message: "Openings must be at least 1." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("job_postings").insert({
    title,
    department,
    location,
    employment_type: employmentType,
    description,
    total_openings: totalOpenings,
    status: "open",
  });

  if (error) {
    console.error("Failed to create job posting:", error.message);
    return { status: "error", message: "Failed to create position. Please try again." };
  }

  revalidatePath("/admin/careers");
  revalidatePath("/careers");
  return { status: "success", message: "Position created." };
}

export async function updateJobPosting(prevState, formData) {
  const id = formData.get("id")?.toString();
  const title = formData.get("title")?.toString().trim();
  const department = formData.get("department")?.toString().trim();
  const location = formData.get("location")?.toString().trim();
  const employmentType = formData.get("employmentType")?.toString().trim();
  const description = formData.get("description")?.toString().trim() || "";
  const totalOpenings = Number(formData.get("totalOpenings")) || 1;

  if (!id || !title || !department) {
    return { status: "error", message: "Title and department are required." };
  }
  if (totalOpenings < 1) {
    return { status: "error", message: "Openings must be at least 1." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("job_postings")
    .update({
      title,
      department,
      location,
      employment_type: employmentType,
      description,
      total_openings: totalOpenings,
    })
    .eq("id", id);

  if (error) {
    console.error("Failed to update job posting:", error.message);
    return { status: "error", message: "Failed to update position. Please try again." };
  }

  revalidatePath("/admin/careers");
  revalidatePath("/careers");
  return { status: "success", message: "Position updated." };
}

// Manual override — pause a role even if slots remain, or manually reopen
// one. Note: this can be overwritten automatically the next time an
// applicant's status changes, since the DB trigger recomputes status from
// selected-count vs total_openings on every job_applications change.
export async function toggleJobStatus(id, currentStatus) {
  const supabase = await createServerSupabaseClient();
  const nextStatus = currentStatus === "open" ? "closed" : "open";
  const { error } = await supabase
    .from("job_postings")
    .update({ status: nextStatus })
    .eq("id", id);

  if (error) {
    console.error("Failed to toggle job status:", error.message);
    return { status: "error", message: error.message };
  }

  revalidatePath("/admin/careers");
  revalidatePath("/careers");
  return { status: "success" };
}

export async function deleteJobPosting(id) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("job_postings").delete().eq("id", id);

  if (error) {
    console.error("Failed to delete job posting:", error.message);
    return { status: "error", message: error.message };
  }

  revalidatePath("/admin/careers");
  revalidatePath("/careers");
  return { status: "success" };
}

// Update a single applicant's status through the 7-stage pipeline (New ->
// Reviewed -> Shortlisted -> Interview -> Offer -> Hired, with Rejected
// reachable from any active stage). The DB trigger automatically
// recomputes the parent job's open/closed status and remaining slots
// whenever this changes (it counts 'hired' applicants) — no manual
// bookkeeping needed here.
const VALID_STATUSES = [
  "new",
  "reviewed",
  "shortlisted",
  "interview",
  "offer",
  "hired",
  "rejected",
];

export async function updateApplicationStatus(applicationId, newStatus) {
  if (!VALID_STATUSES.includes(newStatus)) {
    return { status: "error", message: "Invalid status." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("job_applications")
    .update({ status: newStatus })
    .eq("id", applicationId);

  if (error) {
    console.error("Failed to update application status:", error.message);
    return { status: "error", message: error.message };
  }

  revalidatePath("/admin/careers");
  revalidatePath("/admin/job-applications");
  revalidatePath("/admin");
  revalidatePath("/careers");
  return { status: "success" };
}

// Admin-entered fields, both nullable, both set only from the admin side
// (never collected on the public apply form). experienceYears is a plain
// integer typed in by HR after reading the resume; prospectRating is a
// 1-5 star rating of how strong a candidate looks.
export async function updateApplicationExperience(applicationId, years) {
  const parsed = years === "" || years === null ? null : Number(years);
  if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
    return { status: "error", message: "Experience must be a non-negative number." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("job_applications")
    .update({ experience_years: parsed })
    .eq("id", applicationId);

  if (error) {
    console.error("Failed to update applicant experience:", error.message);
    return { status: "error", message: error.message };
  }

  revalidatePath("/admin/job-applications");
  return { status: "success" };
}

export async function updateApplicationProspectRating(applicationId, rating) {
  const parsed = rating === null || rating === "" ? null : Number(rating);
  if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 5)) {
    return { status: "error", message: "Rating must be between 1 and 5." };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("job_applications")
    .update({ prospect_rating: parsed })
    .eq("id", applicationId);

  if (error) {
    console.error("Failed to update prospect rating:", error.message);
    return { status: "error", message: error.message };
  }

  revalidatePath("/admin/job-applications");
  return { status: "success" };
}
