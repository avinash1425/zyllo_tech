import { useEffect } from "react";
import { useParams } from "@/lib/nx/navigation";
import PageHero from "@/components/PageHero";
import { supabase } from "@/lib/supabase/client";
import { useAsync } from "@/lib/use-async";
import ApplyForm from "@/components/ApplyForm";
import DescriptionBody from "@/components/careers/DescriptionBody";
import Seo from "@/components/Seo";
import JobPostingJsonLd from "@/components/JobPostingJsonLd";
import NotFoundView from "@/components/NotFoundView";
import PageLoading from "@/components/PageLoading";

async function getJob(id) {
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

// Fire-and-forget: a slow/failed insert must never break the apply page.
// One row per page load (no de-dup); the admin dashboard uses it for a
// submitted-applications / page-views completion rate.
function recordApplicationView(jobId) {
  supabase
    .from("job_application_views")
    .insert({ job_id: jobId })
    .then(({ error }) => {
      if (error) console.error("Failed to record application view:", error.message);
    });
}

export default function CareerDetail() {
  const { id } = useParams();
  const { data: job, loading } = useAsync(() => getJob(id), [id]);
  const open = Boolean(job && job.status === "open");
  const jobId = job?.id;

  useEffect(() => {
    if (open) recordApplicationView(jobId);
  }, [open, jobId]);

  if (loading) return <PageLoading />;
  if (!open) return <NotFoundView />;

  const description = `Apply for the ${job.title} role at Zyllo Tech — ${job.location} · ${job.employment_type}.`;

  return (
    <>
      <Seo title={`Apply — ${job.title}`} description={description} path={`/careers/${job.id}`} />
      <JobPostingJsonLd job={job} />
      <PageHero
        eyebrow={job.department}
        title={job.title}
        description={`${job.location} · ${job.employment_type}`}
      />

      <section className="bg-[#fafbfc] py-10 lg:py-14">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          {job.description && (
            <div className="relative mb-10 overflow-hidden rounded-3xl border border-[#e7e9ee] bg-white p-6 shadow-[0_24px_48px_-24px_rgba(31,70,147,0.2)] sm:p-8">
              <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#f96706] via-[#ffb15c] to-[#3089a6]" />
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-[#1b2030]">
                <span aria-hidden="true" className="h-1.5 w-5 rounded-full bg-gradient-to-r from-[#f96706] to-[#ffb15c]" />
                About this role
              </h2>
              <DescriptionBody text={job.description} className="mt-4" />
            </div>
          )}

          <ApplyForm jobId={job.id} jobTitle={job.title} />
        </div>
      </section>
    </>
  );
}
