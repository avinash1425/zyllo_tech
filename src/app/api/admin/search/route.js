import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Global admin search. Currently searches the only sections backed by a
// real database: job postings and job applicants. Contacts, Blog, and
// Portfolio are still static/mock UI (no table to query yet) — once those
// are wired to Supabase, add matching blocks here the same way.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") || "").trim();

  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const supabase = createServerSupabaseClient();
  const like = `%${query}%`;

  const [jobsRes, applicantsRes] = await Promise.all([
    supabase
      .from("job_postings")
      .select("id, title, department, location, status")
      .or(`title.ilike.${like},department.ilike.${like},location.ilike.${like}`)
      .limit(5),
    supabase
      .from("job_applications")
      .select("id, full_name, email, job_id, status, job_postings(title)")
      .or(`full_name.ilike.${like},email.ilike.${like}`)
      .limit(5),
  ]);

  const results = [];

  for (const job of jobsRes.data ?? []) {
    results.push({
      type: "Job Posting",
      title: job.title,
      subtitle: [job.department, job.location].filter(Boolean).join(" · "),
      href: `/admin/careers/${job.id}`,
    });
  }

  for (const applicant of applicantsRes.data ?? []) {
    results.push({
      type: "Applicant",
      title: applicant.full_name,
      subtitle: `${applicant.email}${applicant.job_postings?.title ? ` · ${applicant.job_postings.title}` : ""}`,
      href: `/admin/careers/${applicant.job_id}`,
    });
  }

  return NextResponse.json({ results });
}
