"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Star,
  Mail,
  Phone,
  Calendar,
  Briefcase,
  ExternalLink,
  Download,
  Eye,
  X,
  FileSpreadsheet,
  ClipboardList,
  FolderOpen,
  FileText,
  Link2Off,
  RefreshCw,
  PackageCheck,
} from "lucide-react";
import { updateApplicationStatus, updateApplicationProspectRating } from "../careers/actions";
import ResumeViewer from "../careers/[id]/ResumeViewer";

const STATUS_STYLES = {
  new: "bg-[#5b7fd4]/10 text-[#1f4693]",
  reviewed: "bg-[#676b7a]/10 text-[#676b7a]",
  shortlisted: "bg-[#f7941e]/10 text-[#db7d17]",
  interview: "bg-purple-100 text-purple-700",
  offer: "bg-[#1f4693]/10 text-[#1f4693]",
  hired: "bg-[#3b6d11]/10 text-[#3b6d11]",
  rejected: "bg-red-50 text-red-600",
};

const STATUS_LABELS = {
  new: "New",
  reviewed: "Reviewed",
  shortlisted: "Shortlisted",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
};

const PIPELINE = ["new", "reviewed", "shortlisted", "interview", "offer", "hired"];
const ALL_STATUSES = [...PIPELINE, "rejected"];

function availableStatusOptions(currentStatus) {
  if (currentStatus === "hired") return ["hired"];
  if (currentStatus === "rejected") return ["rejected", "new"];
  const idx = PIPELINE.indexOf(currentStatus);
  return [...PIPELINE.slice(idx), "rejected"];
}

const EXPERIENCE_BANDS = [
  { key: "all", label: "All experience", test: () => true },
  { key: "0-2", label: "0–2 yrs", test: (y) => y !== null && y <= 2 },
  { key: "3-5", label: "3–5 yrs", test: (y) => y !== null && y >= 3 && y <= 5 },
  { key: "6-10", label: "6–10 yrs", test: (y) => y !== null && y >= 6 && y <= 10 },
  { key: "10+", label: "10+ yrs", test: (y) => y !== null && y > 10 },
];

function prospectLabel(rating) {
  if (!rating) return null;
  if (rating <= 2) return "Low";
  if (rating <= 3) return "Medium";
  return "High";
}

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

function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// "2026-08" -> "August 2026", used both as the <option> label and as the
// key files are grouped/filtered by (uploadedAt.slice(0, 7) already gives
// the same "YYYY-MM" form directly from the ISO timestamp).
function formatMonthKey(key) {
  const [year, month] = key.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function StarRating({ value, onChange, disabled, size = "h-3.5 w-3.5" }) {
  return (
    <div className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onChange(value === n ? null : n);
          }}
          aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}
          className="disabled:cursor-default"
        >
          <Star
            className={`${size} transition-colors ${
              value && n <= value ? "fill-[#f7941e] text-[#f7941e]" : "fill-transparent text-[#d5d8de]"
            } ${disabled ? "" : "hover:text-[#f7941e]"}`}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
}

export default function JobApplicationsManager({ initialApplications, jobOptions, resumeFiles }) {
  const router = useRouter();
  const [applications, setApplications] = useState(initialApplications);
  const [activeTab, setActiveTab] = useState("applications");
  const [query, setQuery] = useState("");
  const [positionFilter, setPositionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [experienceFilter, setExperienceFilter] = useState("all");
  const [prospectFilter, setProspectFilter] = useState("all");
  const [viewing, setViewing] = useState(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryDesignationFilter, setLibraryDesignationFilter] = useState("all");
  const [libraryMonthFilter, setLibraryMonthFilter] = useState("all");
  const [selectedFiles, setSelectedFiles] = useState(() => new Set());
  const [libraryPreview, setLibraryPreview] = useState(null);
  const [isPending, startTransition] = useTransition();
  const [isRefreshingLibrary, startLibraryRefresh] = useTransition();
  const [isExporting, setIsExporting] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  const statusCounts = ALL_STATUSES.reduce((acc, status) => {
    acc[status] = applications.filter((a) => a.status === status).length;
    return acc;
  }, {});

  const activeExperienceBand =
    EXPERIENCE_BANDS.find((b) => b.key === experienceFilter) ?? EXPERIENCE_BANDS[0];

  const filtered = applications.filter((item) => {
    const q = query.trim().toLowerCase();
    const matchesQuery =
      q === "" ||
      item.full_name.toLowerCase().includes(q) ||
      item.email.toLowerCase().includes(q) ||
      item.job_title.toLowerCase().includes(q);

    const matchesPosition = positionFilter === "all" || item.job_id === positionFilter;
    const matchesStatus = statusFilter === "all" || item.status === statusFilter;
    const matchesExperience = activeExperienceBand.test(item.experience_years);
    const matchesProspect =
      prospectFilter === "all" || String(item.prospect_rating ?? "") === prospectFilter;

    return matchesQuery && matchesPosition && matchesStatus && matchesExperience && matchesProspect;
  });

  const libraryMonthOptions = Array.from(
    new Set(resumeFiles.filter((f) => f.uploadedAt).map((f) => f.uploadedAt.slice(0, 7)))
  ).sort((a, b) => (a < b ? 1 : -1));

  const filteredLibraryFiles = resumeFiles.filter((file) => {
    const q = libraryQuery.trim().toLowerCase();
    const matchesQuery =
      q === "" ||
      file.fileName.toLowerCase().includes(q) ||
      (file.applicant?.fullName ?? "").toLowerCase().includes(q) ||
      (file.applicant?.jobTitle ?? "").toLowerCase().includes(q);

    const matchesDesignation =
      libraryDesignationFilter === "all" || file.applicant?.jobId === libraryDesignationFilter;

    const matchesMonth =
      libraryMonthFilter === "all" ||
      (file.uploadedAt && file.uploadedAt.slice(0, 7) === libraryMonthFilter);

    return matchesQuery && matchesDesignation && matchesMonth;
  });

  const orphanedCount = resumeFiles.filter((f) => !f.applicant).length;
  const allFilteredSelected =
    filteredLibraryFiles.length > 0 &&
    filteredLibraryFiles.every((f) => selectedFiles.has(f.path));

  function toggleSelectAll() {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      const filteredPaths = filteredLibraryFiles.map((f) => f.path);
      if (allFilteredSelected) {
        filteredPaths.forEach((p) => next.delete(p));
      } else {
        filteredPaths.forEach((p) => next.add(p));
      }
      return next;
    });
  }

  function toggleFileSelection(path) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function handleRefreshLibrary() {
    startLibraryRefresh(() => {
      router.refresh();
    });
  }

  async function handleDownloadZip() {
    const filesToZip = resumeFiles.filter((f) => selectedFiles.has(f.path));
    if (filesToZip.length === 0) {
      alert("Select at least one resume to download.");
      return;
    }
    setIsZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      await Promise.all(
        filesToZip.map(async (file) => {
          const res = await fetch(file.publicUrl);
          const blob = await res.blob();
          const label = file.applicant
            ? `${file.applicant.fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${file.fileName}`
            : file.fileName;
          zip.file(label, blob);
        })
      );

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const stamp = new Date().toISOString().slice(0, 10);
      const link = document.createElement("a");
      link.href = url;
      link.download = `resumes-${stamp}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("ZIP download failed:", err);
      alert("Failed to build the ZIP file. Please try again.");
    } finally {
      setIsZipping(false);
    }
  }

  function patchApplication(id, patch) {
    setApplications((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    setViewing((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  }

  function handleStatusChange(id, newStatus) {
    patchApplication(id, { status: newStatus });
    startTransition(async () => {
      const result = await updateApplicationStatus(id, newStatus);
      if (result.status === "error") alert(result.message);
    });
  }

  function handleProspectChange(id, rating) {
    patchApplication(id, { prospect_rating: rating });
    startTransition(async () => {
      const result = await updateApplicationProspectRating(id, rating);
      if (result.status === "error") alert(result.message);
    });
  }

  async function handleExportExcel() {
    if (filtered.length === 0) {
      alert("No applications to export for the current filters.");
      return;
    }
    setIsExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Zyllo Tech Admin";
      workbook.created = new Date();

      const sheet = workbook.addWorksheet("Job Applications");
      sheet.columns = [
        { header: "Name", key: "name", width: 22 },
        { header: "Email", key: "email", width: 28 },
        { header: "Phone", key: "phone", width: 16 },
        { header: "Position", key: "position", width: 22 },
        { header: "Department", key: "department", width: 18 },
        { header: "Experience (yrs)", key: "experience", width: 14 },
        { header: "Status", key: "status", width: 14 },
        { header: "Prospect", key: "prospect", width: 12 },
        { header: "Applied", key: "applied", width: 14 },
      ];

      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7941E" } };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.alignment = { vertical: "middle", horizontal: "left" };
      });
      headerRow.height = 22;

      filtered.forEach((item) => {
        sheet.addRow({
          name: item.full_name,
          email: item.email,
          phone: item.phone || "—",
          position: item.job_title,
          department: item.job_department || "—",
          experience: item.experience_years ?? "—",
          status: STATUS_LABELS[item.status] || item.status,
          prospect: item.prospect_rating ? `${item.prospect_rating}/5` : "—",
          applied: formatDate(item.created_at),
        });
      });

      sheet.views = [{ state: "frozen", ySplit: 1 }];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const link = document.createElement("a");
      link.href = url;
      link.download = `job-applications-${stamp}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Excel export failed:", err);
      alert("Excel export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#2b303b]">Job Applications</h1>
        <p className="mt-1 text-sm text-[#676b7a]">
          Review every applicant across all open and closed positions, record decisions, and rate prospects.
        </p>
      </div>

      <div className="inline-flex w-fit items-center gap-1 rounded-full border border-[#e7e9ee] bg-white p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab("applications")}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
            activeTab === "applications"
              ? "bg-[#2b303b] text-white shadow-sm"
              : "text-[#676b7a] hover:text-[#2b303b]"
          }`}
        >
          <ClipboardList className="h-4 w-4" aria-hidden="true" />
          Applications
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("library")}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
            activeTab === "library"
              ? "bg-[#2b303b] text-white shadow-sm"
              : "text-[#676b7a] hover:text-[#2b303b]"
          }`}
        >
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
          Resume Library ({resumeFiles.length})
        </button>
      </div>

      {activeTab === "applications" && (
      <>
      <div className="flex flex-wrap items-center gap-3">
        {ALL_STATUSES.map((status) => (
          <span
            key={status}
            className="inline-flex items-center gap-2 rounded-full border border-[#e7e9ee] bg-white py-1.5 pl-2 pr-4 shadow-sm"
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${STATUS_STYLES[status]}`}
            >
              {statusCounts[status]}
            </span>
            <span className="text-xs font-medium text-[#676b7a]">{STATUS_LABELS[status]}</span>
          </span>
        ))}
      </div>

      <div className="rounded-2xl border border-[#e7e9ee] bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-[#e7e9ee] p-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-[#2b303b]">Applications Table</h2>
            <p className="mt-1 text-xs text-[#676b7a]">
              Filter by position, experience, status, or prospect rating. Click a row to read the resume and record decisions.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={isExporting}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#e7e9ee] bg-white px-3.5 py-2 text-sm font-medium text-[#2b303b] transition-colors hover:border-[#3b6d11]/40 hover:text-[#3b6d11] disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            {isExporting ? "Exporting…" : `Export Excel (${filtered.length})`}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-b border-[#e7e9ee] p-4">
          <div className="relative w-full sm:w-56">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#676b7a]/50"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-lg border border-[#e7e9ee] bg-white py-2 pl-9 pr-3 text-sm text-[#2b303b] outline-none placeholder:text-[#676b7a]/50 focus:border-[#1f4693]/50"
            />
          </div>

          <select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            className="rounded-lg border border-[#e7e9ee] bg-white px-3 py-2 text-sm text-[#2b303b] outline-none focus:border-[#1f4693]/50"
          >
            <option value="all">All designations</option>
            {jobOptions.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title}
              </option>
            ))}
          </select>

          <select
            value={experienceFilter}
            onChange={(e) => setExperienceFilter(e.target.value)}
            className="rounded-lg border border-[#e7e9ee] bg-white px-3 py-2 text-sm text-[#2b303b] outline-none focus:border-[#1f4693]/50"
          >
            {EXPERIENCE_BANDS.map((band) => (
              <option key={band.key} value={band.key}>
                {band.label}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-[#e7e9ee] bg-white px-3 py-2 text-sm text-[#2b303b] outline-none focus:border-[#1f4693]/50"
          >
            <option value="all">All statuses</option>
            {ALL_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>

          <select
            value={prospectFilter}
            onChange={(e) => setProspectFilter(e.target.value)}
            className="rounded-lg border border-[#e7e9ee] bg-white px-3 py-2 text-sm text-[#2b303b] outline-none focus:border-[#1f4693]/50"
          >
            <option value="all">All prospects</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={String(n)}>
                {n} star{n === 1 ? "" : "s"} · {prospectLabel(n)}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#e7e9ee] bg-[#fafbfc] text-xs font-bold uppercase tracking-wide text-[#676b7a]">
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Position</th>
                <th className="px-5 py-3">Experience</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Prospect</th>
                <th className="px-5 py-3">Applied</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => setViewing(item)}
                  className="cursor-pointer border-b border-[#e7e9ee] last:border-0 transition-colors hover:bg-[#fafbfc]"
                >
                  <td className="px-5 py-4">
                    <p className="font-semibold text-[#2b303b]">{item.full_name}</p>
                    <p className="mt-0.5 text-xs text-[#676b7a]">{item.email}</p>
                  </td>
                  <td className="px-5 py-4 text-[#2b303b]">{item.job_title}</td>
                  <td className="px-5 py-4 text-[#2b303b]">
                    {item.experience_years !== null && item.experience_years !== undefined
                      ? `${item.experience_years} yr${item.experience_years === 1 ? "" : "s"}`
                      : "—"}
                  </td>
                  <td className="px-5 py-4">
                    <select
                      value={item.status}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handleStatusChange(item.id, e.target.value)}
                      disabled={isPending}
                      className={`rounded-full border-0 px-2.5 py-1 text-xs font-semibold outline-none ${STATUS_STYLES[item.status]}`}
                    >
                      {availableStatusOptions(item.status).map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1.5">
                      <StarRating
                        value={item.prospect_rating}
                        disabled={isPending}
                        onChange={(rating) => handleProspectChange(item.id, rating)}
                      />
                      {item.prospect_rating && (
                        <span className="text-xs text-[#676b7a]">{prospectLabel(item.prospect_rating)}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-[#676b7a]">{formatDate(item.created_at)}</td>
                  <td className="px-5 py-4 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setViewing(item);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#1f4693] transition-colors hover:bg-[#1f4693]/10"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-[#676b7a]">
            {applications.length === 0
              ? "No applications yet — they'll appear here once someone applies to a role."
              : "No applications match your filters."}
          </div>
        )}
      </div>
      </>
      )}

      {activeTab === "library" && (
        <div className="rounded-2xl border border-[#e7e9ee] bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-[#e7e9ee] p-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-[#2b303b]">Resume Library</h2>
              <p className="mt-1 text-xs text-[#676b7a]">
                Filter resumes by designation/month and download individually or as a ZIP.
                {orphanedCount > 0 && (
                  <span className="ml-1 font-medium text-[#db7d17]">
                    {orphanedCount} unlinked file{orphanedCount === 1 ? "" : "s"}.
                  </span>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={handleRefreshLibrary}
                disabled={isRefreshingLibrary}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e9ee] bg-white px-3.5 py-2 text-sm font-medium text-[#676b7a] transition-colors hover:border-[#1f4693]/40 hover:text-[#1f4693] disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isRefreshingLibrary ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                {isRefreshingLibrary ? "Refreshing…" : "Refresh"}
              </button>
              <button
                type="button"
                onClick={handleDownloadZip}
                disabled={isZipping || selectedFiles.size === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#f7941e] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#db7d17] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PackageCheck className="h-4 w-4" aria-hidden="true" />
                {isZipping ? "Zipping…" : `Download ZIP (${selectedFiles.size})`}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 border-b border-[#e7e9ee] p-4">
            <div className="relative w-full sm:w-56">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#676b7a]/50"
                aria-hidden="true"
              />
              <input
                type="text"
                value={libraryQuery}
                onChange={(e) => setLibraryQuery(e.target.value)}
                placeholder="Search filename, position…"
                className="w-full rounded-lg border border-[#e7e9ee] bg-white py-2 pl-9 pr-3 text-sm text-[#2b303b] outline-none placeholder:text-[#676b7a]/50 focus:border-[#1f4693]/50"
              />
            </div>

            <select
              value={libraryDesignationFilter}
              onChange={(e) => setLibraryDesignationFilter(e.target.value)}
              className="rounded-lg border border-[#e7e9ee] bg-white px-3 py-2 text-sm text-[#2b303b] outline-none focus:border-[#1f4693]/50"
            >
              <option value="all">All Designations</option>
              {jobOptions.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.title}
                </option>
              ))}
            </select>

            <select
              value={libraryMonthFilter}
              onChange={(e) => setLibraryMonthFilter(e.target.value)}
              className="rounded-lg border border-[#e7e9ee] bg-white px-3 py-2 text-sm text-[#2b303b] outline-none focus:border-[#1f4693]/50"
            >
              <option value="all">All Months</option>
              {libraryMonthOptions.map((key) => (
                <option key={key} value={key}>
                  {formatMonthKey(key)}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#e7e9ee] bg-[#fafbfc] text-xs font-bold uppercase tracking-wide text-[#676b7a]">
                  <th className="w-10 px-5 py-3">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all files"
                      className="h-4 w-4 rounded border-[#e7e9ee] accent-[#f7941e]"
                    />
                  </th>
                  <th className="px-5 py-3">Applicant</th>
                  <th className="px-5 py-3">File</th>
                  <th className="px-5 py-3">Size</th>
                  <th className="px-5 py-3">Uploaded</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLibraryFiles.map((file) => (
                  <tr
                    key={file.path}
                    onClick={() => setLibraryPreview(file)}
                    className="cursor-pointer border-b border-[#e7e9ee] last:border-0 transition-colors hover:bg-[#fafbfc]"
                  >
                    <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedFiles.has(file.path)}
                        onChange={() => toggleFileSelection(file.path)}
                        aria-label={`Select ${file.fileName}`}
                        className="h-4 w-4 rounded border-[#e7e9ee] accent-[#f7941e]"
                      />
                    </td>
                    <td className="px-5 py-4">
                      {file.applicant ? (
                        <>
                          <p className="font-semibold text-[#2b303b]">{file.applicant.fullName}</p>
                          <p className="mt-0.5 text-xs text-[#676b7a]">{file.applicant.jobTitle}</p>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#db7d17]">
                          <Link2Off className="h-3.5 w-3.5" aria-hidden="true" />
                          Unlinked file
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center gap-1.5 text-[#2b303b]">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-[#676b7a]" aria-hidden="true" />
                        {file.fileName}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[#676b7a]">{formatFileSize(file.sizeBytes)}</td>
                    <td className="px-5 py-4 text-[#676b7a]">
                      {file.uploadedAt ? formatDate(file.uploadedAt) : "—"}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <a
                          href={file.publicUrl}
                          download={file.fileName}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Download ${file.fileName}`}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#3b6d11]/10 hover:text-[#3b6d11]"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLibraryPreview(file);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#1f4693] transition-colors hover:bg-[#1f4693]/10"
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          Preview
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredLibraryFiles.length === 0 && (
            <div className="py-12 text-center text-sm text-[#676b7a]">
              {resumeFiles.length === 0
                ? "No resume files yet — they'll appear here once someone applies to a role."
                : "No files match your search."}
            </div>
          )}
        </div>
      )}

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0e17]/50 px-4 py-8 backdrop-blur-sm"
          onClick={() => setViewing(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-[#e7e9ee] p-6">
              <div>
                <h2 className="text-lg font-bold text-[#2b303b]">{viewing.full_name}</h2>
                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-[#676b7a]">
                  <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
                  {viewing.job_title}
                </p>
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
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#fafbfc] hover:text-[#2b303b]"
              >
                <X className="h-4.5 w-4.5" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex flex-col gap-3 text-sm">
                <p className="flex items-center gap-2 text-[#2b303b]">
                  <Mail className="h-4 w-4 shrink-0 text-[#676b7a]" aria-hidden="true" />
                  <a href={`mailto:${viewing.email}`} className="hover:text-[#1f4693]">
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

              <div className="mt-4 flex flex-wrap items-center gap-6 rounded-xl border border-[#e7e9ee] bg-[#fafbfc] p-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[#676b7a]">Experience</p>
                  <p className="mt-1.5 text-sm font-semibold text-[#2b303b]">
                    {viewing.experience_years !== null && viewing.experience_years !== undefined
                      ? `${viewing.experience_years} year${viewing.experience_years === 1 ? "" : "s"}`
                      : "Not provided"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[#676b7a]">Prospect Rating</p>
                  <div className="mt-2">
                    <StarRating
                      value={viewing.prospect_rating}
                      disabled={isPending}
                      size="h-5 w-5"
                      onChange={(rating) => handleProspectChange(viewing.id, rating)}
                    />
                  </div>
                </div>
              </div>

              {viewing.cover_note && (
                <div className="mt-4 rounded-xl border border-[#e7e9ee] bg-[#fafbfc] p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#676b7a]">Cover Note</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#2b303b]">
                    {viewing.cover_note}
                  </p>
                </div>
              )}

              <div className="mt-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#676b7a]">Resume</p>
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
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e9ee] px-4 py-2 text-sm font-semibold text-[#676b7a] transition-colors duration-200 hover:border-[#1f4693]/40 hover:text-[#1f4693]"
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
              <label htmlFor="modal-status" className="mb-1.5 block text-xs font-medium text-[#676b7a]">
                Application Status
              </label>
              <select
                id="modal-status"
                value={viewing.status}
                disabled={isPending || viewing.status === "hired"}
                onChange={(e) => handleStatusChange(viewing.id, e.target.value)}
                className="w-full rounded-lg border border-[#e7e9ee] px-3 py-2 text-sm font-medium text-[#2b303b] outline-none focus:border-[#1f4693]/60 disabled:opacity-50"
              >
                {availableStatusOptions(viewing.status).map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
              {viewing.status === "hired" && (
                <p className="mt-1.5 text-xs text-[#676b7a]">Hired is final and can&apos;t be changed.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {libraryPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0e17]/50 px-4 py-8 backdrop-blur-sm"
          onClick={() => setLibraryPreview(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-[#e7e9ee] p-6">
              <div>
                {libraryPreview.applicant ? (
                  <>
                    <h2 className="text-lg font-bold text-[#2b303b]">
                      {libraryPreview.applicant.fullName}
                    </h2>
                    <p className="mt-0.5 flex items-center gap-1.5 text-sm text-[#676b7a]">
                      <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
                      {libraryPreview.applicant.jobTitle}
                    </p>
                  </>
                ) : (
                  <h2 className="inline-flex items-center gap-1.5 text-lg font-bold text-[#db7d17]">
                    <Link2Off className="h-4 w-4" aria-hidden="true" />
                    Unlinked file
                  </h2>
                )}
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[#676b7a]">
                  <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {libraryPreview.fileName} · {formatFileSize(libraryPreview.sizeBytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLibraryPreview(null)}
                aria-label="Close"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#fafbfc] hover:text-[#2b303b]"
              >
                <X className="h-4.5 w-4.5" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <ResumeViewer url={libraryPreview.publicUrl} />
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={libraryPreview.publicUrl}
                  download={libraryPreview.fileName}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#f7941e] px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#db7d17]"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Download
                </a>
                <a
                  href={libraryPreview.publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e9ee] px-4 py-2 text-sm font-semibold text-[#676b7a] transition-colors duration-200 hover:border-[#1f4693]/40 hover:text-[#1f4693]"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Open in New Tab
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
