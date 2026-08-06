"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Mail,
  Phone,
  FileText,
  ExternalLink,
  Download,
  X,
  Calendar,
} from "lucide-react";
import { updateApplicationStatus } from "../actions";
import ResumeViewer from "./ResumeViewer";

const STATUS_STYLES = {
  applied: "bg-[#5b7fd4]/10 text-[#1f4693]",
  selected: "bg-[#3b6d11]/10 text-[#3b6d11]",
  rejected: "bg-red-50 text-red-600",
};

const STATUS_LABELS = {
  applied: "Applied",
  selected: "Selected",
  rejected: "Rejected",
};

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function resumeFileName(applicant) {
  const safeName = applicant.full_name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${safeName || "resume"}.pdf`;
}

export default function ApplicantsManager({ job, initialApplicants }) {
  const [applicants, setApplicants] = useState(initialApplicants);
  const [viewing, setViewing] = useState(null);
  const [isPending, startTransition] = useTransition();

  function handleStatusChange(applicationId, newStatus) {
    startTransition(async () => {
      await updateApplicationStatus(applicationId, newStatus);
      setApplicants((prev) =>
        prev.map((a) => (a.id === applicationId ? { ...a, status: newStatus } : a))
      );
    });
  }

  const selectedCount = applicants.filter((a) => a.status === "selected").length;
  const remaining = Math.max(job.total_openings - selectedCount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin/careers"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#676b7a] hover:text-[#f7941e]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Careers
        </Link>

        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#2b303b]">{job.title}</h1>
            <p className="mt-1 text-sm text-[#676b7a]">
              {job.department} · {selectedCount} of {job.total_openings} slot
              {job.total_openings === 1 ? "" : "s"} filled · {remaining} remaining ·{" "}
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                  job.status === "open"
                    ? "bg-[#3b6d11]/10 text-[#3b6d11]"
                    : "bg-[#676b7a]/10 text-[#676b7a]"
                }`}
              >
                {job.status === "open" ? "Open" : "Closed"}
              </span>
            </p>
          </div>
        </div>
      </div>

      {applicants.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#e7e9ee] bg-white p-10 text-center">
          <p className="text-sm text-[#676b7a]">No applicants yet for this role.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {applicants.map((applicant) => (
            <div
              key={applicant.id}
              role="button"
              tabIndex={0}
              onClick={() => setViewing(applicant)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setViewing(applicant);
                }
              }}
              className="flex cursor-pointer flex-col gap-4 rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[#f7941e]/30 hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-base font-semibold text-[#2b303b]">
                    {applicant.full_name}
                  </h3>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[applicant.status]}`}
                  >
                    {STATUS_LABELS[applicant.status]}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#676b7a]">
                  <a
                    href={`mailto:${applicant.email}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 hover:text-[#f7941e]"
                  >
                    <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                    {applicant.email}
                  </a>
                  {applicant.phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                      {applicant.phone}
                    </span>
                  )}
                  {applicant.resume_url && (
                    <a
                      href={applicant.resume_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 hover:text-[#f7941e]"
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      Resume
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </div>
                {applicant.cover_note && (
                  <p className="mt-2 line-clamp-2 max-w-2xl text-sm text-[#676b7a]">
                    {applicant.cover_note}
                  </p>
                )}
              </div>

              <select
                value={applicant.status}
                disabled={isPending}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => handleStatusChange(applicant.id, e.target.value)}
                className="w-full shrink-0 rounded-lg border border-[#e7e9ee] px-3 py-2 text-sm font-medium text-[#2b303b] outline-none focus:border-[#f7941e]/60 disabled:opacity-50 sm:w-40"
              >
                <option value="applied">Applied</option>
                <option value="selected">Selected</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          ))}
        </div>
      )}

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
          onClick={() => setViewing(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-[#e7e9ee] p-6">
              <div>
                <h2 className="text-lg font-bold text-[#2b303b]">{viewing.full_name}</h2>
                <span
                  className={`mt-1.5 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[viewing.status]}`}
                >
                  {STATUS_LABELS[viewing.status]}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setViewing(null)}
                aria-label="Close"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#f5f6f8] hover:text-[#2b303b]"
              >
                <X className="h-4.5 w-4.5" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex flex-col gap-3 text-sm">
                <p className="flex items-center gap-2 text-[#2b303b]">
                  <Mail className="h-4 w-4 shrink-0 text-[#676b7a]" aria-hidden="true" />
                  <a href={`mailto:${viewing.email}`} className="hover:text-[#f7941e]">
                    {viewing.email}
                  </a>
                </p>
                {viewing.phone && (
                  <p className="flex items-center gap-2 text-[#2b303b]">
                    <Phone className="h-4 w-4 shrink-0 text-[#676b7a]" aria-hidden="true" />
                    {viewing.phone}
                  </p>
                )}
                <p className="flex items-center gap-2 text-[#676b7a]">
                  <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Applied {formatDate(viewing.created_at)}
                </p>
              </div>

              {viewing.cover_note && (
                <div className="mt-4 rounded-xl border border-[#e7e9ee] bg-[#fafbfc] p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#676b7a]">
                    Cover Note
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#2b303b]">
                    {viewing.cover_note}
                  </p>
                </div>
              )}

              <div className="mt-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#676b7a]">
                  Resume
                </p>
                {viewing.resume_url ? (
                  <>
                    <ResumeViewer url={viewing.resume_url} />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a
                        href={viewing.resume_url}
                        download={resumeFileName(viewing)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#f7941e] px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#db7d17]"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                        Download Resume
                      </a>
                      <a
                        href={viewing.resume_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e9ee] px-4 py-2 text-sm font-semibold text-[#676b7a] transition-colors duration-200 hover:border-[#f7941e]/40 hover:text-[#f7941e]"
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                        Open in New Tab
                      </a>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-[#676b7a]">No resume was uploaded.</p>
                )}
              </div>
            </div>

            <div className="border-t border-[#e7e9ee] p-4">
              <label
                htmlFor="modal-status"
                className="mb-1.5 block text-xs font-medium text-[#676b7a]"
              >
                Application Status
              </label>
              <select
                id="modal-status"
                value={viewing.status}
                disabled={isPending}
                onChange={(e) => {
                  const newStatus = e.target.value;
                  handleStatusChange(viewing.id, newStatus);
                  setViewing((prev) => (prev ? { ...prev, status: newStatus } : prev));
                }}
                className="w-full rounded-lg border border-[#e7e9ee] px-3 py-2 text-sm font-medium text-[#2b303b] outline-none focus:border-[#f7941e]/60 disabled:opacity-50"
              >
                <option value="applied">Applied</option>
                <option value="selected">Selected</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
