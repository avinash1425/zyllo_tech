import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useAsync } from "@/lib/use-async";
import OpenPositionsGrid from "./OpenPositionsGrid";
import ApplySection from "./careers/ApplySection";
import DontSeeCta from "./careers/DontSeeCta";

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

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

export default function OpenPositions() {
  const { data, loading } = useAsync(getOpenPositions, []);
  const positions = data ?? [];
  const [selectedJobId, setSelectedJobId] = useState("");

  function applyTo(job) {
    setSelectedJobId(job.id);
    scrollToId("apply");
  }

  return (
    <>
      <section id="open-positions" className="scroll-mt-24 border-t border-[#e7e9ee] bg-[#f6f8fc] py-14 lg:py-20">
        <div className="mx-auto max-w-6xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-[#173a52] sm:text-4xl">Current Job Openings</h2>
            <p className="mt-3 text-base leading-relaxed text-[#4a5668] sm:text-lg">
              Explore career opportunities across our teams.
            </p>
          </div>
          <OpenPositionsGrid positions={positions} loading={loading} onApply={applyTo} />
        </div>
      </section>

      {positions.length > 0 && (
        <ApplySection
          jobs={positions}
          selectedJobId={selectedJobId}
          onSelectJob={setSelectedJobId}
          onViewOthers={() => scrollToId("open-positions")}
        />
      )}
      <DontSeeCta />
    </>
  );
}
