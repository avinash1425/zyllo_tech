import { supabase } from "@/integrations/supabase/client";

const MAX_RESUME_BYTES = 5 * 1024 * 1024; // 5MB

// Ported from the Next.js server action. Resumes live in a private bucket,
// so the row stores the storage path and admins read it through a signed URL.
export async function submitApplication(prevState, formData) {
  const jobId = formData.get("jobId");
  const fullName = formData.get("fullName")?.toString().trim();
  const email = formData.get("email")?.toString().trim();
  const phone = formData.get("phone")?.toString().trim();
  const experienceYearsRaw = formData.get("experienceYears")?.toString().trim();
  const coverNote = formData.get("coverNote")?.toString().trim();
  const resumeFile = formData.get("resume");

  if (!jobId || !fullName || !email) {
    return { status: "error", message: "Please fill in all required fields." };
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

  const safeName = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const filePath = `${jobId}/${Date.now()}-${safeName || "resume"}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from("resumes")
    .upload(filePath, resumeFile, { contentType: "application/pdf", upsert: false });

  if (uploadError) {
    console.error("Failed to upload resume:", uploadError.message);
    return { status: "error", message: "Failed to upload your resume. Please try again." };
  }

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

  return { status: "success", message: "Application submitted." };
}
