import Link from "@/lib/nx/link";
import { Briefcase } from "lucide-react";
import Card from "./Card";
import EmptyState from "../EmptyState";

export default function ApplicantsRanking({ jobs }) {
  const max = Math.max(1, ...jobs.map((j) => j.applicants));
  return (
    <Card
      icon={Briefcase}
      title="Applicants by job"
      subtitle="Postings ranked by applications received"
      action={
        <Link href="/admin/careers" className="shrink-0 text-xs font-semibold text-[#1f4693] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f96706]">
          View all
        </Link>
      }
    >
      {jobs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No job postings yet"
          message="Create a position from the Careers page to start collecting applicants."
          action={
            <Link href="/admin/careers" className="rounded-full bg-gradient-to-r from-[#f7941e] to-[#f96706] px-4 py-2 text-xs font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f96706]">
              Go to Careers
            </Link>
          }
          className="py-12"
        />
      ) : (
        <ol className="mt-4 flex max-h-[420px] flex-col gap-4 overflow-y-auto pr-1">
          {jobs.map((job, i) => (
            <li key={job.id}>
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#f1f2f5] text-[11px] font-bold tabular-nums text-[#4b4f5c]">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#2b303b]">{job.title}</span>
                {job.status !== "open" && (
                  <span className="shrink-0 rounded-full bg-[#676b7a]/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#4b4f5c]">
                    Closed
                  </span>
                )}
                <span className="shrink-0 text-sm font-semibold tabular-nums text-[#2b303b]">{job.applicants}</span>
              </div>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#f1f2f5]"
                role="progressbar"
                aria-label={`${job.title}: ${job.applicants} applicants`}
                aria-valuemin={0}
                aria-valuemax={max}
                aria-valuenow={job.applicants}
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#f7941e] to-[#f96706] motion-safe:transition-all motion-safe:duration-500"
                  style={{ width: `${(job.applicants / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
