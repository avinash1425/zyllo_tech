import { supabase } from "@/integrations/supabase/client";
import { useAsyncData } from "@/lib/useAsyncData";
import OpenPositionsGrid from "./OpenPositionsGrid";

async function getOpenPositions() {
  const { data: jobs, error } = await supabase
    .from("job_postings")
    .select(
      "id, title, department, location, employment_type, total_openings, description"
    )
    .eq("status", "open")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load job postings:", error.message);
    return [];
  }
  if (!jobs || jobs.length === 0) return [];

  const { data: selectedApps, error: appsError } = await supabase
    .from("job_applications")
    .select("job_id")
    .eq("status", "hired");

  if (appsError) {
    console.error("Failed to load selected applicants:", appsError.message);
  }

  const selectedByJobId = {};
  for (const app of selectedApps ?? []) {
    selectedByJobId[app.job_id] = (selectedByJobId[app.job_id] ?? 0) + 1;
  }

  return jobs.map((job) => ({
    ...job,
    remaining: Math.max(job.total_openings - (selectedByJobId[job.id] ?? 0), 0),
  }));
}

export default function OpenPositions() {
  const positions = useAsyncData(getOpenPositions, []);

  return (
    <section
      id="open-positions"
      className="relative overflow-hidden border-t border-[#e7e9ee] bg-[#fafbfc] py-6 lg:py-8 scroll-mt-24"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/3 h-72 w-72 rounded-full bg-[#1f4693]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/3 h-72 w-72 rounded-full bg-[#f7941e]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-bold tracking-[0.2em] text-[#1f4693] uppercase">
            Open Positions
          </span>

          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#2b303b] sm:text-4xl">
            Roles we're currently hiring for
          </h2>

          <p className="mt-4 text-lg leading-relaxed text-[#676b7a]">
            Don&apos;t see the right fit? We&apos;re always open to hearing
            from strong candidates.
          </p>
        </div>

        <OpenPositionsGrid positions={positions} />
      </div>
    </section>
  );
}
