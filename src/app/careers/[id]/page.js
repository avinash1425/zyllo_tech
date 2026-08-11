import { notFound } from "next/navigation";
import PageHero from "@/components/PageHero";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import ApplyForm from "./ApplyForm";
import JobPostingJsonLd from "@/components/JobPostingJsonLd";

async function getJob(id) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("job_postings")
    .select(
      "id, title, department, location, employment_type, description, status, created_at"
    )
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data;
}

// Fire-and-forget, same pattern as blog/[slug]/page.js's recordView.
// Not awaited — a slow/failed insert into job_application_views must
// never delay or break rendering the actual apply page. Logs one row
// per page load (no de-dup), used by the admin dashboard to compute
// submitted-applications ÷ page-views as a rough completion rate.
async function recordApplicationView(jobId) {
  const supabase = await createServerSupabaseClient();
  supabase
    .from("job_application_views")
    .insert({ job_id: jobId })
    .then(({ error }) => {
      if (error) console.error("Failed to record application view:", error.message);
    });
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job || job.status !== "open") return {};

  const description = `Apply for the ${job.title} role at Zyllo Tech — ${job.location} · ${job.employment_type}.`;

  return {
    title: `Apply — ${job.title}`,
    description,
    alternates: {
      canonical: `/careers/${job.id}`,
    },
    openGraph: {
      type: "website",
      title: `Apply — ${job.title}`,
      description,
      url: `/careers/${job.id}`,
    },
  };
}

export default async function JobApplyPage({ params }) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job || job.status !== "open") notFound();

  // Called only here (not inside getJob) — generateMetadata above also
  // calls getJob independently as part of Next.js's normal parallel
  // fetch, and logging the view from inside getJob would double-count
  // every real page load.
  recordApplicationView(job.id);

  return (
    <>
      <JobPostingJsonLd job={job} />
      <PageHero
        eyebrow={job.department}
        title={job.title}
        description={`${job.location} · ${job.employment_type}`}
      />

      <section className="bg-white py-10 lg:py-14">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          {job.description && (
            <div className="mb-10">
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">
                About this role
              </h2>
              <p className="mt-3 whitespace-pre-line leading-relaxed text-[#676b7a]">
                {job.description}
              </p>
            </div>
          )}

          <ApplyForm jobId={job.id} jobTitle={job.title} />
        </div>
      </section>
    </>
  );
}
