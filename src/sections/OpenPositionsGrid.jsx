"use client";

import { useMemo, useState } from "react";
import Link from "@/lib/nx/link";
import { ArrowRight, Briefcase, Clock, FileText, MapPin, Search, SearchX, Users } from "lucide-react";
import Modal from "@/components/Modal";
import ApplyForm from "@/components/ApplyForm";
import ModalHeader from "@/components/careers/ModalHeader";
import JobCard, { JobCardSkeleton } from "@/sections/careers/JobCard";

const TITLE_ID = "careers-modal-title";

function openingsLabel(n) {
  return `${n} opening${n === 1 ? "" : "s"} left`;
}

function jobChips(job) {
  return [
    { icon: Briefcase, label: job.department },
    { icon: MapPin, label: job.location },
    { icon: Clock, label: job.employment_type },
  ].filter((c) => c.label);
}

function ContactBand() {
  return (
    <div className="relative mt-12 overflow-hidden rounded-3xl bg-gradient-to-br from-[#101a3a] via-[#173a52] to-[#1f4693] px-6 py-10 text-center text-white sm:px-12">
      <span aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[#f96706]/30 blur-[90px]" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-[#3089a6]/30 blur-[90px]" />
      <div className="relative mx-auto max-w-xl">
        <h3 className="text-2xl font-bold tracking-tight sm:text-3xl">Don&apos;t see your role?</h3>
        <p className="mt-3 text-base leading-relaxed text-white/80">
          We are always keen to meet talented people. Tell us about yourself and we will keep you in mind for
          future openings.
        </p>
        <Link
          href="/contact"
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-[#f7941e] px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#f7941e]/30 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#db7d17] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#ffb15c]/60"
        >
          Get in touch
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

// Renders the Open Positions list (filter chips, search, cards, skeletons,
// empty states) and owns the single popup that switches between a role
// "details" view and the "apply" form (same ApplyForm / submit action as the
// /careers/:id page — the submit flow itself is untouched).
export default function OpenPositionsGrid({ positions, loading = false }) {
  const [activeJob, setActiveJob] = useState(null);
  const [modalView, setModalView] = useState("details"); // "details" | "apply"
  const [modalOpen, setModalOpen] = useState(false); // view is kept while the exit animation runs
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
    setModalView("details");
    setModalOpen(true);
  }

  function openApply(job) {
    setActiveJob(job);
    setModalView("apply");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function viewOtherRoles() {
    setModalOpen(false);
    setTimeout(() => {
      document.getElementById("open-positions")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    }, 50);
  }

  if (loading) {
    return (
      <div className="mt-8" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading open positions</span>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <JobCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <>
        <div className="mx-auto mt-8 max-w-xl rounded-3xl border border-[#e7e9ee] bg-white p-8 text-center shadow-sm sm:p-10">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f7941e] to-[#f96706] text-white shadow-lg shadow-[#f7941e]/30">
            <FileText className="h-7 w-7" aria-hidden="true" />
          </span>
          <h3 className="mt-5 text-xl font-bold text-[#2b303b]">No open roles right now &mdash; send your resume</h3>
          <p className="mt-2 text-base leading-relaxed text-[#676b7a]">
            We may not be hiring for a specific role today, but we are always happy to hear from strong
            candidates.
          </p>
          <Link
            href="/contact"
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-[#f7941e] px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#f7941e]/30 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#db7d17] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40"
          >
            Send your resume
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </>
    );
  }

  const chipClass = (active) =>
    `inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/30 ${
      active
        ? "border-transparent bg-gradient-to-r from-[#1f4693] to-[#173a52] text-white shadow-md shadow-[#1f4693]/25"
        : "border-[#e7e9ee] bg-white text-[#2b303b] hover:border-[#1f4693]/40 hover:text-[#1f4693]"
    }`;

  return (
    <>
      <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div role="group" aria-label="Filter by department" className="flex flex-wrap gap-2">
          {["All", ...departments].map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={department === d}
              onClick={() => setDepartment(d)}
              className={chipClass(department === d)}
            >
              {d}
            </button>
          ))}
        </div>

        <div className="relative w-full lg:max-w-xs">
          <label htmlFor="role-search" className="sr-only">
            Search roles
          </label>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#676b7a]" aria-hidden="true" />
          <input
            id="role-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search roles, location..."
            className="w-full rounded-full border border-[#d5d9e2] bg-white py-2.5 pl-10 pr-4 text-sm text-[#2b303b] placeholder:text-[#676b7a]/70 outline-none transition-all focus:border-[#f7941e] focus:ring-4 focus:ring-[#f7941e]/15"
          />
        </div>
      </div>

      <p className="mt-4 text-sm text-[#676b7a]" role="status" aria-live="polite">
        Showing {filtered.length} of {positions.length} role{positions.length === 1 ? "" : "s"}
      </p>

      {filtered.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-[#d5d9e2] bg-white p-10 text-center">
          <SearchX className="mx-auto h-8 w-8 text-[#676b7a]" aria-hidden="true" />
          <p className="mt-3 text-base font-semibold text-[#2b303b]">No roles match your filters</p>
          <button
            type="button"
            onClick={() => {
              setDepartment("All");
              setQuery("");
            }}
            className="mt-3 text-sm font-semibold text-[#1f4693] underline underline-offset-4 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/30"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((position) => (
            <JobCard key={position.id} position={position} onDetails={openDetails} onApply={openApply} />
          ))}
        </div>
      )}

      <ContactBand />

      <Modal
        isOpen={modalOpen && Boolean(activeJob)}
        onClose={closeModal}
        maxWidthClassName="max-w-2xl"
        labelledBy={TITLE_ID}
        showClose={false}
        scroll={false}
      >
        {activeJob && modalView === "details" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <ModalHeader
              titleId={TITLE_ID}
              eyebrow="Role details"
              title={activeJob.title}
              chips={jobChips(activeJob)}
              onClose={closeModal}
            />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f7941e]/10 px-3 py-1 text-xs font-semibold text-[#a64b06]">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                {openingsLabel(activeJob.remaining)}
              </span>
              {activeJob.description ? (
                <div className="mt-5">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-[#2b303b]">About this role</h3>
                  <p className="mt-2 whitespace-pre-line leading-relaxed text-[#676b7a]">{activeJob.description}</p>
                </div>
              ) : (
                <p className="mt-5 text-[#676b7a]">
                  Full details for this role are shared during the process. Apply to get started.
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3 border-t border-[#e7e9ee] bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-end sm:px-8">
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex items-center justify-center rounded-full border border-[#e7e9ee] bg-white px-5 py-3 text-sm font-semibold text-[#2b303b] transition-colors hover:border-[#1f4693]/40 hover:text-[#1f4693] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1f4693]/20"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setModalView("apply")}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-[#f7941e] px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-[#f7941e]/30 transition-colors hover:bg-[#db7d17] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40 sm:flex-none"
              >
                Apply now
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {activeJob && modalView === "apply" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <ModalHeader
              titleId={TITLE_ID}
              eyebrow="Apply for this role"
              title={activeJob.title}
              chips={jobChips(activeJob)}
              onClose={closeModal}
            />
            <ApplyForm
              key={activeJob.id}
              jobId={activeJob.id}
              jobTitle={activeJob.title}
              variant="modal"
              onClose={closeModal}
              onViewOthers={viewOtherRoles}
            />
          </div>
        )}
      </Modal>
    </>
  );
}
