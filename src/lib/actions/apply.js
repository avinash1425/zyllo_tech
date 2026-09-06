import { supabase } from "@/integrations/supabase/client";
import { notifyAdmin } from "@/lib/notify";

const MAX_RESUME_BYTES = 5 * 1024 * 1024; // 5MB

// job_postings.id is a uuid; anything else is a forged form value and must not
// become a storage path segment.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ported from the Next.js server action. Resumes live in a private bucket,
// so the row stores the storage path and admins read it through a signed URL.
export async function submitApplication(prevState, formData) {
  const jobId = formData.get("jobId")?.toString().trim();
  const fullName = formData.get("fullName")?.toString().trim();
  const email = formData.get("email")?.toString().trim();
  const phone = formData.get("phone")?.toString().trim();
  const experienceYearsRaw = formData.get("experienceYears")?.toString().trim();
  const coverNote = formData.get("coverNote")?.toString().trim();
  const resumeFile = formData.get("resume");

  if (!jobId || !fullName || !email) {
    return { status: "error", message: "Please fill in all required fields." };
  }
  if (!UUID_RE.test(jobId)) {
    return { status: "error", message: "This job posting is invalid. Please reload the page and try again." };
  }

  const experienceYears =
    experienceYearsRaw === "" || experienceYearsRaw === undefined ? null : Number(experienceYearsRaw);
  if (
    experienceYears === null ||
    !Number.isFinite(experienceYears) ||
    experienceYears < 0 ||
    experienceYears > 60
  ) {
    return { status: "error", message: "Please enter your years of experience." };
  }

  if (!(resumeFile instanceof File) || resumeFile.size === 0) {
    return { status: "error", message: "Please attach your resume as a PDF." };
  }
  if (resumeFile.type !== "application/pdf") {
    return { status: "error", message: "Resume must be a PDF file." };
  }
  if (resumeFile.size > MAX_RESUME_BYTES) {
    return { status: "error", message: "Resume must be under 5MB." };
  }

  // Sanitized to [a-z0-9-] so the applicant's name can never smuggle path
  // separators or traversal into the storage key.
  const safeName = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const filePath = `${jobId.toLowerCase()}/${Date.now()}-${safeName || "resume"}.pdf`;

  // Insert the application row FIRST: the job_id foreign key validates the id
  // against a real job posting, and a failed insert leaves no orphaned resume
  // PII sitting in storage.
  const { error } = await supabase.from("job_applications").insert({
    job_id: jobId,
    full_name: fullName,
    email,
    phone: phone || null,
    experience_years: experienceYears,
    resume_url: filePath,
    cover_note: coverNote || null,
  });

  if (error) {
    console.error("Failed to submit application:", error.message);
    return {
      status: "error",
      message: "Something went wrong submitting your application. Please try again.",
    };
  }

  const { error: uploadError } = await supabase.storage
    .from("resumes")
    .upload(filePath, resumeFile, { contentType: "application/pdf", upsert: false });

  if (uploadError) {
    console.error("Failed to upload resume:", uploadError.message);
    notifyAdmin("career", {
      full_name: fullName,
      email,
      phone,
      experience_years: experienceYears,
      resume_url: null,
      cover_note: coverNote,
    });
    return {
      status: "error",
      message:
        "Your application details were received, but the resume upload failed. Please don't re-submit — our team will reach out for your resume.",
    };
  }

  notifyAdmin("career", {
    full_name: fullName,
    email,
    phone,
    experience_years: experienceYears,
    resume_url: filePath,
    cover_note: coverNote,
  });

  return { status: "success", message: "Application submitted." };
}
