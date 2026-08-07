import Link from "next/link";
import { Users } from "lucide-react";

/**
 * Ranked list of job postings by applicant count. Deliberately a single
 * panel rather than one stat card per posting — the number of open roles
 * is unbounded, so a card grid would grow without limit. Mirrors the card
 * shell used by TopPagesPanel / RecentActivity for visual consistency.
 */
export default function ApplicantsByJobPanel({ jobs }) {
  const maxApplicants = Math.max(1, ...jobs.map((j) => j.applicants));

  return (
    <div className="rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#2b303b]">Applicants by Job</h2>
        <Link
          href="/admin/careers"
          className="text-xs font-medium text-[#676b7a] hover:text-[#1f4693]"
        >
          View all
        </Link>
      </div>

      {jobs.length === 0 ? (
        <p className="mt-3 py-6 text-center text-xs text-[#676b7a]">
          No job postings yet — create one from the Careers page.
        </p>
      ) : (
        <ul className="mt-3 flex max-h-[240px] flex-col gap-3 overflow-y-auto pr-1">
          {jobs.map((job) => (
            <li key={job.id}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-xs font-medium text-[#2b303b]">
                    {job.title}
                  </span>
                  {job.status !== "open" && (
                    <span className="shrink-0 rounded-full bg-[#676b7a]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#676b7a]">
                      Closed
                    </span>
                  )}
                </div>
                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-[#2b303b]">
                  <Users className="h-3 w-3 text-[#676b7a]" aria-hidden="true" />
                  {job.applicants}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#f1f2f5]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#f7941e] to-[#1f4693] transition-all duration-500"
                  style={{ width: `${(job.applicants / maxApplicants) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
