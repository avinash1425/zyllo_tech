"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Briefcase, Clock, FileText, MapPin, Search, SearchX } from "lucide-react";
import Link from "@/lib/nx/link";
import PageLoader from "@/components/PageLoader";
import Modal from "@/components/Modal";
import ModalHeader from "@/components/careers/ModalHeader";
import DescriptionBody from "@/components/careers/DescriptionBody";
import JobCard, { JobCardSkeleton, openingsLabel } from "@/sections/careers/JobCard";

const TITLE_ID = "careers-modal-title";

function jobChips(job) {
  return [
    { icon: Briefcase, label: job.department },
    { icon: MapPin, label: job.location },
    { icon: Clock, label: job.employment_type },
    { icon: null, label: openingsLabel(job.remaining) },
  ].filter((c) => c.label);
}

// Job cards grid with department chips + search, loading / empty / no-match
// states and the role-details popup. "Apply Now" (card or popup) is handled by
// the parent via onApply(job).
export default function OpenPositionsGrid({ positions, loading = false, onApply }) {
  const [activeJob, setActiveJob] = useState(null);
  const [modalOpen, setModalOpen] = useState(false); // activeJob is kept while the exit animation runs
  const [department, setDepartment] = useState("All");
  const [query, setQuery] = useState("");

  const departments = useMemo(
    () => Array.from(new Set(positions.map((p) => p.department).filter(Boolean))).sort(),
    [positions]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return positions.filter((p) => {
      if (department !== "All" && p.department !== department) return false;
      if (!q) return true;
      return [p.title, p.department, p.location, p.employment_type]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [positions, department, query]);

  function openDetails(job) {
    setActiveJob(job);
    setModalOpen(true);
  }

  function applyFromModal() {
    const job = activeJob;
    setModalOpen(false);
    setTimeout(() => onApply?.(job), 60);
  }

  if (loading) {
    return (
      <div className="mt-10" aria-busy="true">
        <PageLoader inline label="Loading open positions..." />
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-[#e5e8ef] bg-white shadow-[0_1px_2px_rgba(16,26,58,0.05),0_12px_30px_-18px_rgba(16,26,58,0.2)]">
        <div className="p-8 text-center sm:p-10">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#eef3fb] text-[#1f4693]">
            <FileText className="h-6 w-6" aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-xl font-bold text-[#1b2030]">No open roles right now</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-[#4a5668]">
            We may not be hiring for a specific role today, but we are always happy to hear from strong candidates.
          </p>
          <Link
            href="/contact"
            className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#f96706] px-7 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#e25a02] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40"
          >
            Send your resume
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    );
  }

  const chipClass = (active) =>
    `inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-[15px] font-semibold transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1f4693]/20 ${
      active
        ? "border-[#173a52] bg-[#173a52] text-white"
        : "border-transparent bg-transparent text-[#4a5668] hover:bg-[#eef3fb] hover:text-[#173a52]"
    }`;

  const newestId = positions.length > 1 ? positions[0].id : null;

  return (
    <>
      <div className="mt-10 flex flex-col gap-3 rounded-2xl border border-[#e5e8ef] bg-[#f7f9fc] p-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div role="group" aria-label="Filter by department" className="flex flex-wrap gap-1.5">
          {["All", ...departments].map((d) => (
            <button key={d} type="button" aria-pressed={department === d} onClick={() => setDepartment(d)} className={chipClass(department === d)}>
              {d}
            </button>
          ))}
        </div>
        <div className="relative w-full lg:w-72">
          <label htmlFor="role-search" className="sr-only">
            Search roles
          </label>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4a5668]" aria-hidden="true" />
          <input
            id="role-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search roles, location..."
            className="min-h-11 w-full rounded-full border border-[#d5dae4] bg-white py-2.5 pl-10 pr-4 text-base text-[#2b303b] placeholder:text-[#4a5668]/70 outline-none transition-all focus:border-[#1f4693] focus:ring-4 focus:ring-[#1f4693]/15"
          />
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        Showing {filtered.length} of {positions.length} roles
      </p>

      {filtered.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-[#c9ced9] bg-white p-10 text-center">
          <SearchX className="mx-auto h-8 w-8 text-[#4a5668]" aria-hidden="true" />
          <p className="mt-3 text-lg font-semibold text-[#2b303b]">No roles match your filters</p>
          <button
            type="button"
            onClick={() => {
              setDepartment("All");
              setQuery("");
            }}
            className="mt-3 min-h-11 text-[15px] font-semibold text-[#1f4693] underline underline-offset-4 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/30"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:gap-7">
          {filtered.map((p) => (
            <JobCard key={p.id} position={p} featured={p.id === newestId} onDetails={openDetails} onApply={onApply} />
          ))}
        </div>
      )}

      <Modal
        isOpen={modalOpen && Boolean(activeJob)}
        onClose={() => setModalOpen(false)}
        maxWidthClassName="max-w-3xl"
        labelledBy={TITLE_ID}
        showClose={false}
        scroll={false}
      >
        {activeJob && (
          <div className="flex min-h-0 flex-1 flex-col">
            <ModalHeader
              titleId={TITLE_ID}
              eyebrow="Role details"
              department={activeJob.department}
              title={activeJob.title}
              chips={jobChips(activeJob)}
              onClose={() => setModalOpen(false)}
            />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white px-6 py-7 sm:px-10 sm:py-8">
              {activeJob.description ? (
                <>
                  <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-[#173a52]">
                    <span aria-hidden="true" className="h-1.5 w-5 rounded-full bg-gradient-to-r from-[#f96706] to-[#ffb15c]" />
                    About this role
                  </h3>
                  <DescriptionBody text={activeJob.description} className="mt-4" />
                </>
              ) : (
                <p className="rounded-2xl border border-dashed border-[#d5d9e2] bg-[#fafbfc] p-5 text-base text-[#4a5668]">
                  Full details for this role are shared during the process. Apply to get started.
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3 border-t border-[#e5e8ef] bg-white px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-12px_24px_-16px_rgba(16,26,58,0.18)] sm:justify-end sm:px-10">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#c9ced9] bg-white px-6 py-3 text-[15px] font-semibold text-[#2b303b] transition-colors hover:border-[#1f4693]/40 hover:text-[#1f4693] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1f4693]/20"
              >
                Close
              </button>
              <button
                type="button"
                onClick={applyFromModal}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#f96706] px-8 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#e25a02] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40 sm:flex-none"
              >
                Apply now
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
