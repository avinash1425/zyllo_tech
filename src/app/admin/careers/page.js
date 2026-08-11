import { createServerSupabaseClient } from "@/lib/supabase/server";
import CareersManager from "./CareersManager";

async function getJobPostingsWithCounts() {
  const supabase = await createServerSupabaseClient();

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

export default async function AdminCareersPage() {
  const positions = await getJobPostingsWithCounts();

  return <CareersManager initialPositions={positions} />;
}
