import { createServerSupabaseClient } from "@/lib/supabase/server";
import JobApplicationsManager from "./JobApplicationsManager";

// Global, cross-job view of every application — distinct from the
// per-job list at /admin/careers/[id]. Joins job_postings for the
// Position/Department columns via PostgREST's embedded-resource syntax.
async function getAllApplications() {
  const supabase = await createServerSupabaseClient();

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

  return (data ?? []).map((app) => ({
    ...app,
    job_title: app.job_postings?.title ?? "Unknown position",
    job_department: app.job_postings?.department ?? "",
  }));
}

async function getJobTitleOptions() {
  const supabase = await createServerSupabaseClient();
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
async function getResumeLibrary(applications) {
  const supabase = await createServerSupabaseClient();
  const bucket = supabase.storage.from("resumes");

  // Public URL -> applicant, so files can be matched back to who
  // uploaded them without a second DB round trip.
  const byUrl = new Map();
  for (const app of applications) {
    if (app.resume_url) {
      byUrl.set(app.resume_url, app);
    }
  }

  const { data: topLevel, error: topError } = await bucket.list("", { limit: 1000 });
  if (topError) {
    console.error("Failed to list resumes bucket:", topError.message);
    return [];
  }

  // Real files at the bucket root have metadata (size, mimetype); the
  // virtual per-job folders don't. Only recurse into the folder-like
  // entries — stray root-level files are vanishingly unlikely given the
  // upload path is always "{job_id}/{filename}", but handled anyway.
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

  return allFiles.map((file) => {
    const publicUrl = `/api/media/resumes/${file.__path}`;
    const applicant = byUrl.get(publicUrl) ?? null;


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

export default async function AdminJobApplicationsPage() {
  const [applications, jobOptions] = await Promise.all([
    getAllApplications(),
    getJobTitleOptions(),
  ]);
  const resumeFiles = await getResumeLibrary(applications);

  return (
    <JobApplicationsManager
      initialApplications={applications}
      jobOptions={jobOptions}
      resumeFiles={resumeFiles}
    />
  );
}
