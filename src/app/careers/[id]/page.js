import { notFound } from "next/navigation";
import PageHero from "@/components/PageHero";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import ApplyForm from "./ApplyForm";

async function getJob(id) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("job_postings")
    .select("id, title, department, location, employment_type, description, status")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data;
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return {};
  return {
    title: `Apply — ${job.title} | Zyllo Tech`,
    description: `Apply for the ${job.title} role at Zyllo Tech.`,
  };
}

export default async function JobApplyPage({ params }) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job || job.status !== "open") notFound();

  return (
    <>
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
