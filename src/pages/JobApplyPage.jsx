import { useParams } from "react-router-dom";
import SEOHead from "@/components/SEOHead";
import PageHero from "@/components/PageHero";
import ApplyForm from "@/components/ApplyForm";
import JobPostingJsonLd from "@/components/JobPostingJsonLd";
import NotFound from "@/pages/NotFound";
import { supabase } from "@/integrations/supabase/client";
import { useAsyncData } from "@/lib/useAsyncData";

export default function JobApplyPage() {
  const { id } = useParams();

  const result = useAsyncData(async () => {
    const { data, error } = await supabase
      .from("job_postings")
      .select("id, title, department, location, employment_type, description, status, created_at")
      .eq("id", id)
      .eq("status", "open")
      .maybeSingle();

    if (error) console.error("Failed to load job:", error.message);

    if (data) {
      supabase
        .from("job_application_views")
        .insert({ job_id: data.id })
        .then(({ error: viewError }) => {
          if (viewError) console.error("Failed to record application view:", viewError.message);
        });
    }

    return { loaded: true, job: data ?? null };
  }, { loaded: false, job: null });

  if (!result.loaded) return <div className="min-h-[60vh]" />;
  if (!result.job) return <NotFound />;

  const job = result.job;

  return (
    <>
      <SEOHead
        title={`Apply — ${job.title} | Zyllo Tech`}
        description={`Apply for the ${job.title} role at Zyllo Tech — ${job.location} · ${job.employment_type}.`}
        canonical={`/careers/${job.id}`}
      />
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
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">About this role</h2>
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
