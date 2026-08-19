import { useState } from "react";
import { CompatLink as Link } from "@/components/NextCompat";
import { ArrowRight, Briefcase, MapPin } from "lucide-react";
import Modal from "@/components/Modal";
import ApplyForm from "@/app/careers/[id]/ApplyForm";

// Renders the Open Positions grid and owns both modals: a "View Details"
// modal showing the full role description, and an "Apply Now" modal with
// the existing ApplyForm (same server action as the old /careers/[id]
// page — nothing about the submit flow changed, only where it's shown).
export default function OpenPositionsGrid({ positions }) {
  const [activeJob, setActiveJob] = useState(null);
  const [modalView, setModalView] = useState(null); // "details" | "apply" | null

  function openDetails(job) {
    setActiveJob(job);
    setModalView("details");
  }

  function openApply(job) {
    setActiveJob(job);
    setModalView("apply");
  }

  function closeModal() {
    setModalView(null);
  }

  if (positions.length === 0) {
    return (
      <div className="mx-auto mt-8 max-w-lg rounded-2xl border border-[#e7e9ee] bg-white p-8 text-center">
        <p className="text-base text-[#676b7a]">
          We don&apos;t have any open roles right now, but we&apos;re always
          happy to hear from strong candidates.
        </p>
        <Link
          href="/contact"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#f7941e]"
        >
          Get in touch
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {positions.map((position) => (
          <div
            key={position.id}
            className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br from-white/80 to-[#1f4693]/[0.03] p-6 pt-7 shadow-md shadow-[#1f4693]/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-transparent hover:shadow-xl hover:shadow-[#1f4693]/10"
          >
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-1 scale-x-50 bg-gradient-to-r from-[#1f4693] to-[#f7941e] opacity-40 transition-all duration-300 group-hover:scale-x-100 group-hover:opacity-100"
            />

            <h3 className="text-lg font-semibold text-[#2b303b]">{position.title}</h3>
            <div className="mt-2 flex flex-col gap-1.5 text-sm text-[#676b7a]">
              <span className="font-medium text-[#1f4693]">{position.department}</span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {position.location}
              </span>
              <span>{position.employment_type}</span>
              <span className="font-medium text-[#f7941e]">
                {position.remaining} opening{position.remaining === 1 ? "" : "s"} left
              </span>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => openDetails(position)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e9ee] bg-white px-4 py-2 text-sm font-semibold text-[#2b303b] transition-colors duration-300 hover:border-[#1f4693]/40 hover:text-[#1f4693]"
              >
                View Details
              </button>
              <button
                type="button"
                onClick={() => openApply(position)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1f4693]/10 px-4 py-2 text-sm font-semibold text-[#1f4693] transition-colors duration-300 hover:bg-[#1f4693] hover:text-white"
              >
                Apply Now
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal isOpen={modalView === "details"} onClose={closeModal} maxWidthClassName="max-w-2xl">
        {activeJob && (
          <div className="p-6 pt-14 sm:p-8 sm:pt-14">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1f4693]/10 px-3 py-1 text-xs font-semibold text-[#1f4693]">
              <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
              {activeJob.department}
            </span>

            <h2 className="mt-4 text-2xl font-bold tracking-tight text-[#2b303b]">
              {activeJob.title}
            </h2>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#676b7a]">
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {activeJob.location}
              </span>
              <span>{activeJob.employment_type}</span>
              <span className="font-medium text-[#f7941e]">
                {activeJob.remaining} opening{activeJob.remaining === 1 ? "" : "s"} left
              </span>
            </div>

            {activeJob.description && (
              <div className="mt-6">
                <h3 className="text-sm font-bold uppercase tracking-wide text-[#2b303b]">
                  About this role
                </h3>
                <p className="mt-2 whitespace-pre-line leading-relaxed text-[#676b7a]">
                  {activeJob.description}
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setModalView("apply")}
              className="mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-[#f7941e] px-8 py-3.5 text-sm font-semibold text-white shadow-[0_20px_25px_-5px_rgba(247,148,30,0.35),0_8px_10px_-6px_rgba(247,148,30,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:bg-[#db7d17]"
            >
              Apply Now
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </Modal>

      <Modal isOpen={modalView === "apply"} onClose={closeModal} maxWidthClassName="max-w-2xl">
        {activeJob && (
          <div className="p-6 pt-14 sm:p-8 sm:pt-14">
            <ApplyForm jobId={activeJob.id} jobTitle={activeJob.title} />
          </div>
        )}
      </Modal>
    </>
  );
}
