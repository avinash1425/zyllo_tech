import { supabase } from "@/lib/supabase/client";
import { useAsync } from "@/lib/use-async";
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

  const { data: remainingRows, error: remainingError } = await supabase.rpc("job_openings_remaining");

  if (remainingError) {
    console.error("Failed to load remaining openings:", remainingError.message);
  }

  const remainingByJobId = {};
  for (const row of remainingRows ?? []) {
    remainingByJobId[row.job_id] = row.remaining;
  }

  return jobs.map((job) => ({
    ...job,
    remaining: remainingByJobId[job.id] ?? job.total_openings,
  }));
}

export default function OpenPositions() {
  const { data, loading } = useAsync(getOpenPositions, []);
  const positions = data ?? [];

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

        {!loading && <OpenPositionsGrid positions={positions} />}
      </div>
    </section>
  );
}
