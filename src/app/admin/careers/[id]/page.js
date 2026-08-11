import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import ApplicantsManager from "./ApplicantsManager";

async function getJobWithApplicants(id) {
  const supabase = await createServerSupabaseClient();

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

  return { job, applicants: applicants ?? [] };
}

export default async function AdminJobApplicantsPage({ params }) {
  const { id } = await params;
  const result = await getJobWithApplicants(id);

  if (!result) notFound();

  return <ApplicantsManager job={result.job} initialApplicants={result.applicants} />;
}
