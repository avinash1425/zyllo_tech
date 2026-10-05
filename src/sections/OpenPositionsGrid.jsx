"use client";

import { useMemo, useState } from "react";
import Link from "@/lib/nx/link";
import { ArrowRight, Briefcase, Clock, FileText, MapPin, Search, SearchX } from "lucide-react";
import Modal from "@/components/Modal";
import ApplyForm from "@/components/ApplyForm";
import ModalHeader from "@/components/careers/ModalHeader";
import DescriptionBody from "@/components/careers/DescriptionBody";
import { RoleRow, DetailPanel } from "@/sections/careers/RoleMaster";
import JobCard, { JobCardSkeleton, OpeningsPill } from "@/sections/careers/JobCard";

const TITLE_ID = "careers-modal-title";

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
  const [sort, setSort] = useState("newest");
  const [selectedId, setSelectedId] = useState(null);

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
        <div className="mx-auto mt-8 max-w-xl rounded-3xl border border-[#e7e9ee] bg-white p-8 text-center shadow-[0_1px_2px_rgba(16,26,58,0.08)] sm:p-10">
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

  const sortedFiltered =
    sort === "title" ? [...filtered].sort((a, b) => String(a.title).localeCompare(String(b.title))) : filtered;
  const selected = sortedFiltered.find((p) => p.id === selectedId) || sortedFiltered[0] || null;

  const chipClass = (active) =>
    `inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-[15px] font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/30 motion-reduce:transition-none ${
      active
        ? "border-transparent bg-gradient-to-r from-[#1f4693] to-[#173a52] text-white shadow-md shadow-[#1f4693]/25"
        : "border-[#d5d9e2] bg-white text-[#2b303b] hover:border-[#1f4693]/50 hover:text-[#1f4693]"
    }`;

  const deptCount = (d) => (d === "All" ? positions.length : positions.filter((p) => p.department === d).length);

  return (
    <>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-center sm:justify-between sm:text-left">
        <p className="inline-flex items-center gap-2.5 rounded-full bg-[#1f4693]/10 px-4 py-2 text-[15px] font-bold text-[#173a52]">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#16a34a]" />
          {positions.length} open role{positions.length === 1 ? "" : "s"}
        </p>
        <p className="text-[15px] text-[#4a5668]" role="status" aria-live="polite">
          Showing {filtered.length} of {positions.length}
        </p>
      </div>

      {/* Sticky filter / search / sort toolbar */}
      <div className="z-30 mt-4 rounded-2xl border border-[#e7e9ee] bg-white/95 p-3 shadow-[0_8px_24px_-16px_rgba(16,26,58,0.25)] backdrop-blur sm:p-4 lg:sticky lg:top-[4.75rem]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div role="group" aria-label="Filter by department" className="flex flex-wrap gap-2">
            {["All", ...departments].map((d) => (
              <button key={d} type="button" aria-pressed={department === d} onClick={() => setDepartment(d)} className={chipClass(department === d)}>
                {d}
                <span className={`rounded-full px-2 py-0.5 text-[13px] ${department === d ? "bg-white/20 text-white" : "bg-[#1f4693]/10 text-[#1f4693]"}`}>
                  {deptCount(d)}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-72">
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
                className="min-h-11 w-full rounded-full border border-[#c9ced9] bg-white py-2.5 pl-10 pr-4 text-base text-[#2b303b] placeholder:text-[#4a5668]/70 outline-none transition-all focus:border-[#f7941e] focus:ring-4 focus:ring-[#f7941e]/15 sm:text-[15px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="role-sort" className="text-[15px] font-semibold text-[#2b303b]">
                Sort
              </label>
              <select
                id="role-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="min-h-11 flex-1 rounded-full border border-[#c9ced9] bg-white px-4 text-base text-[#2b303b] outline-none focus:border-[#f7941e] focus:ring-4 focus:ring-[#f7941e]/15 sm:flex-none sm:text-[15px]"
              >
                <option value="newest">Newest first</option>
                <option value="title">Title A to Z</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {sortedFiltered.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-[#c9ced9] bg-white p-10 text-center">
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
        <>
          {/* Phones + tablets: cards that open the popup */}
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:hidden">
            {sortedFiltered.map((position, i) => (
              <JobCard key={position.id} index={i} position={position} onDetails={openDetails} onApply={openApply} />
            ))}
          </div>

          {/* Desktop: master-detail */}
          <div className="mt-6 hidden items-start gap-6 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <ul aria-label="Open roles" className="max-h-[calc(100dvh-12rem)] min-h-0 space-y-3 overflow-y-auto overscroll-contain p-1 pr-2">
              {sortedFiltered.map((p) => (
                <li key={p.id}>
                  <RoleRow position={p} active={selected?.id === p.id} onSelect={() => setSelectedId(p.id)} />
                </li>
              ))}
            </ul>
            {selected && (
              <DetailPanel position={selected} onApply={() => openApply(selected)} onDetails={() => openDetails(selected)} />
            )}
          </div>
        </>
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
              step={1}
              department={activeJob.department}
              title={activeJob.title}
              chips={jobChips(activeJob)}
              onClose={closeModal}
            />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#fafbfc] px-5 py-6 sm:px-8">
              <OpeningsPill remaining={activeJob.remaining} />
              {activeJob.description ? (
                <div className="mt-5 rounded-3xl border border-[#e7e9ee] bg-white p-5 shadow-[0_1px_2px_rgba(16,26,58,0.08)] sm:p-6">
                  <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-[#1b2030]">
                    <span aria-hidden="true" className="h-1.5 w-5 rounded-full bg-gradient-to-r from-[#f96706] to-[#ffb15c]" />
                    About this role
                  </h3>
                  <DescriptionBody text={activeJob.description} className="mt-4" />
                </div>
              ) : (
                <p className="mt-5 rounded-3xl border border-dashed border-[#d5d9e2] bg-white p-5 text-[#676b7a]">
                  Full details for this role are shared during the process. Apply to get started.
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3 border-t border-[#e7e9ee] bg-white/95 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-12px_24px_-16px_rgba(16,26,58,0.18)] backdrop-blur sm:justify-end sm:px-8">
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex items-center justify-center rounded-full border border-[#e7e9ee] bg-white px-6 py-3.5 text-sm font-semibold text-[#2b303b] transition-colors hover:border-[#1f4693]/40 hover:text-[#1f4693] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1f4693]/20"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setModalView("apply")}
                className="group/next inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f96706] via-[#f7941e] to-[#ffb15c] px-8 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#f7941e]/30 transition-all hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40 sm:flex-none"
              >
                Continue to apply
                <ArrowRight className="h-4 w-4 transition-transform group-hover/next:translate-x-1" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {activeJob && modalView === "apply" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <ModalHeader
              titleId={TITLE_ID}
              eyebrow="Apply for this role"
              step={2}
              onStepChange={() => setModalView("details")}
              department={activeJob.department}
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
