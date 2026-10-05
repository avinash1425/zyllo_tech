
import { supabase } from "@/lib/supabase/client";
import { resumePathFromValue, signResumePaths, withSignedResumeUrls } from "./resumeUrls";

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

  return { status: "success", message: "Position updated." };
}

// Manual override — pause a role even if slots remain, or manually reopen
// one. Note: this can be overwritten automatically the next time an
// applicant's status changes, since the DB trigger recomputes status from
// selected-count vs total_openings on every job_applications change.
export async function toggleJobStatus(id, currentStatus) {
  const nextStatus = currentStatus === "open" ? "closed" : "open";
  const { error } = await supabase
    .from("job_postings")
    .update({ status: nextStatus })
    .eq("id", id);

  if (error) {
    console.error("Failed to toggle job status:", error.message);
    return { status: "error", message: error.message };
  }

  return { status: "success" };
}

export async function deleteJobPosting(id) {
  const { error } = await supabase.from("job_postings").delete().eq("id", id);

  if (error) {
    console.error("Failed to delete job posting:", error.message);
    return { status: "error", message: error.message };
  }

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

  const { error } = await supabase
    .from("job_applications")
    .update({ status: newStatus })
    .eq("id", applicationId);

  if (error) {
    console.error("Failed to update application status:", error.message);
    return { status: "error", message: error.message };
  }

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

  const { error } = await supabase
    .from("job_applications")
    .update({ experience_years: parsed })
    .eq("id", applicationId);

  if (error) {
    console.error("Failed to update applicant experience:", error.message);
    return { status: "error", message: error.message };
  }

  return { status: "success" };
}

export async function updateApplicationProspectRating(applicationId, rating) {
  const parsed = rating === null || rating === "" ? null : Number(rating);
  if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 5)) {
    return { status: "error", message: "Rating must be between 1 and 5." };
  }

  const { error } = await supabase
    .from("job_applications")
    .update({ prospect_rating: parsed })
    .eq("id", applicationId);

  if (error) {
    console.error("Failed to update prospect rating:", error.message);
    return { status: "error", message: error.message };
  }

  return { status: "success" };
}

export async function fetchJobPostingsWithCounts() {
  const { data: jobs, error: jobsError } = await supabase
    .from("job_postings")
    .select(
      "id, title, department, location, employment_type, description, status, total_openings, created_at"
    )
    .order("created_at", { ascending: false });

  if (jobsError) {
    console.error("Failed to load job postings:", jobsError.message);
    return [];
  }

  const { data: applications, error: appsError } = await supabase
    .from("job_applications")
    .select("job_id, status");

  if (appsError) {
    console.error("Failed to load applications:", appsError.message);
  }

  const totalByJobId = {};
  const selectedByJobId = {};
  for (const app of applications ?? []) {
    totalByJobId[app.job_id] = (totalByJobId[app.job_id] ?? 0) + 1;
    if (app.status === "hired") {
      selectedByJobId[app.job_id] = (selectedByJobId[app.job_id] ?? 0) + 1;
    }
  }

  return (jobs ?? []).map((job) => {
    const selected = selectedByJobId[job.id] ?? 0;
    return {
      ...job,
      applicants: totalByJobId[job.id] ?? 0,
      selected,
      remaining: Math.max(job.total_openings - selected, 0),
    };
  });
}

// Returns null when the job does not exist (caller renders not-found).
export async function fetchJobWithApplicants(id) {
  const { data: job, error: jobError } = await supabase
    .from("job_postings")
    .select("id, title, department, status, total_openings")
    .eq("id", id)
    .single();

  if (jobError || !job) return null;

  const { data: applicants, error: appsError } = await supabase
    .from("job_applications")
    .select("id, full_name, email, phone, resume_url, cover_note, status, created_at")
    .eq("job_id", id)
    .order("created_at", { ascending: false });

  if (appsError) {
    console.error("Failed to load applicants:", appsError.message);
  }

  return { job, applicants: await withSignedResumeUrls(applicants ?? []) };
}

// Global, cross-job view of every application — distinct from the
// per-job list. Joins job_postings for the Position/Department columns via
// PostgREST's embedded-resource syntax.
export async function fetchAllApplications() {
  const { data, error } = await supabase
    .from("job_applications")
    .select(
      "id, full_name, email, phone, resume_url, cover_note, status, experience_years, prospect_rating, created_at, job_id, job_postings(id, title, department)"
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load job applications:", error.message);
    return [];
  }

  const signedRows = await withSignedResumeUrls(data ?? []);
  return signedRows.map((app) => ({
    ...app,
    job_title: app.job_postings?.title ?? "Unknown position",
    job_department: app.job_postings?.department ?? "",
  }));
}

export async function fetchJobTitleOptions() {
  const { data, error } = await supabase
    .from("job_postings")
    .select("id, title")
    .order("title", { ascending: true });

  if (error) {
    console.error("Failed to load job titles:", error.message);
    return [];
  }
  return data ?? [];
}

// Raw storage browser, independent of the applications table — every file
// under the 'resumes' bucket, whether or not a matching job_applications
// row still exists (upload can succeed while the follow-up DB insert
// fails, leaving an orphaned file; this view is where that surfaces).
// Storage has no real folders: files live at "{job_id}/{filename}.pdf",
// so listing the bucket root returns virtual "folder" entries and each
// one needs a second list() call to see the files inside it.
export async function fetchResumeLibrary(applications) {
  const bucket = supabase.storage.from("resumes");

  // Object path -> applicant, so files can be matched back to who
  // uploaded them without a second DB round trip. (resume_path is derived
  // from either an old public URL or a stored object path.)
  const byPath = new Map();
  for (const app of applications) {
    const p = app.resume_path ?? resumePathFromValue(app.resume_url);
    if (p) byPath.set(p, app);
  }

  const { data: topLevel, error: topError } = await bucket.list("", { limit: 1000 });
  if (topError) {
    console.error("Failed to list resumes bucket:", topError.message);
    return [];
  }

  const folders = (topLevel ?? []).filter((entry) => entry.id === null);
  const rootFiles = (topLevel ?? []).filter((entry) => entry.id !== null);

  const nested = await Promise.all(
    folders.map(async (folder) => {
      const { data: files, error } = await bucket.list(folder.name, { limit: 1000 });
      if (error) {
        console.error(`Failed to list resumes/${folder.name}:`, error.message);
        return [];
      }
      return (files ?? []).map((file) => ({ ...file, __path: `${folder.name}/${file.name}` }));
    })
  );

  const allFiles = [
    ...rootFiles.map((file) => ({ ...file, __path: file.name })),
    ...nested.flat(),
  ];

  // The bucket is private: sign every file with the admin session. The
  // field keeps its old name (publicUrl) so the UI is unchanged.
  const signed = await signResumePaths(allFiles.map((f) => f.__path));

  return allFiles.map((file) => {
    const publicUrl = signed.get(file.__path) ?? null;
    const applicant = byPath.get(file.__path) ?? null;

    return {
      path: file.__path,
      fileName: file.name,
      publicUrl,
      sizeBytes: file.metadata?.size ?? null,
      uploadedAt: file.created_at ?? file.updated_at ?? null,
      applicant: applicant
        ? {
            id: applicant.id,
            fullName: applicant.full_name,
            jobId: applicant.job_id,
            jobTitle: applicant.job_title,
            status: applicant.status,
          }
        : null,
    };
  });
}

export async function fetchJobApplicationsPageData() {
  const [applications, jobOptions] = await Promise.all([
    fetchAllApplications(),
    fetchJobTitleOptions(),
  ]);
  const resumeFiles = await fetchResumeLibrary(applications);
  return { applications, jobOptions, resumeFiles };
}
