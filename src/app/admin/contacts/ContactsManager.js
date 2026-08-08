"use client";

import { useState, useTransition } from "react";
import {
  Search,
  Mail,
  Phone,
  Trash2,
  Eye,
  X,
  Building2,
  Briefcase,
  FileSpreadsheet,
  CalendarRange,
  Inbox,
  CircleDot,
  MessageCircle,
  CheckCircle2,
} from "lucide-react";
import { updateSubmissionStatus, deleteSubmission } from "./actions";

const STATUS_LABELS = {
  new: "New",
  contacted: "Contacted",
  closed: "Closed",
};

const STATUS_STYLES = {
  new: "bg-[#f7941e]/10 text-[#f7941e]",
  contacted: "bg-[#1f4693]/10 text-[#1f4693]",
  closed: "bg-[#3b6d11]/10 text-[#3b6d11]",
};

// Forward-only workflow: New -> Contacted -> Closed. Each status's dropdown
// only offers itself plus the states ahead of it, never a state already passed.
const STATUS_OPTIONS = {
  new: ["new", "contacted", "closed"],
  contacted: ["contacted", "closed"],
  closed: ["closed"],
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "closed", label: "Closed" },
];

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ContactsManager({ initialSubmissions }) {
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const [activeFilter, setActiveFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [viewing, setViewing] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [isPending, startTransition] = useTransition();
  const [isExporting, setIsExporting] = useState(false);

  const filtered = submissions.filter((item) => {
    const matchesFilter = activeFilter === "all" || item.status === activeFilter;

    const q = query.trim().toLowerCase();
    const matchesQuery =
      q === "" ||
      item.full_name.toLowerCase().includes(q) ||
      (item.company ?? "").toLowerCase().includes(q) ||
      (item.service ?? "").toLowerCase().includes(q) ||
      item.email.toLowerCase().includes(q);

    const itemDate = new Date(item.created_at);
    const matchesFrom = dateFrom === "" || itemDate >= new Date(`${dateFrom}T00:00:00`);
    const matchesTo = dateTo === "" || itemDate <= new Date(`${dateTo}T23:59:59`);

    return matchesFilter && matchesQuery && matchesFrom && matchesTo;
  });

  function clearDateRange() {
    setDateFrom("");
    setDateTo("");
  }

  const totalCount = submissions.length;
  const newCount = submissions.filter((item) => item.status === "new").length;
  const contactedCount = submissions.filter((item) => item.status === "contacted").length;
  const closedCount = submissions.filter((item) => item.status === "closed").length;

  const SUMMARY_BADGES = [
    { key: "total", icon: Inbox, label: "Total Submissions", value: totalCount, accent: "#1f4693" },
    { key: "new", icon: CircleDot, label: "New", value: newCount, accent: "#f7941e" },
    { key: "contacted", icon: MessageCircle, label: "Contacted", value: contactedCount, accent: "#1f4693" },
    { key: "closed", icon: CheckCircle2, label: "Closed", value: closedCount, accent: "#3b6d11" },
  ];

  async function handleExportExcel() {
    if (filtered.length === 0) {
      alert("No submissions to export for the current filters.");
      return;
    }
    setIsExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Zyllo Tech Admin";
      workbook.created = new Date();

      const sheet = workbook.addWorksheet("Contact Submissions");

      sheet.columns = [
        { header: "Name", key: "name", width: 22 },
        { header: "Email", key: "email", width: 28 },
        { header: "Phone", key: "phone", width: 16 },
        { header: "Company", key: "company", width: 20 },
        { header: "Service", key: "service", width: 20 },
        { header: "Status", key: "status", width: 14 },
        { header: "Date", key: "date", width: 14 },
        { header: "Message", key: "message", width: 50 },
      ];

      // Header row: orange fill, white bold text — matches the site's
      // brand color used throughout the admin panel.
      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF7941E" },
        };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.alignment = { vertical: "middle", horizontal: "left" };
      });
      headerRow.height = 22;

      filtered.forEach((item) => {
        sheet.addRow({
          name: item.full_name,
          email: item.email,
          phone: item.phone || "—",
          company: item.company || "—",
          service: item.service || "—",
          status: STATUS_LABELS[item.status] || item.status,
          date: formatDate(item.created_at),
          message: item.message || "",
        });
      });

      sheet.getColumn("message").alignment = { wrapText: true, vertical: "top" };
      sheet.views = [{ state: "frozen", ySplit: 1 }];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const link = document.createElement("a");
      link.href = url;
      link.download = `contact-submissions-${stamp}.xlsx`;
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

  function handleStatusChange(id, newStatus) {
    setSubmissions((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: newStatus } : item))
    );
    startTransition(async () => {
      const result = await updateSubmissionStatus(id, newStatus);
      if (result.status === "error") {
        alert(result.message);
      }
    });
  }

  function handleDelete(id) {
    startTransition(async () => {
      const result = await deleteSubmission(id);
      if (result.status === "error") {
        alert(result.message);
        return;
      }
      setSubmissions((prev) => prev.filter((item) => item.id !== id));
      setDeletingId(null);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#676b7a]/50"
            aria-hidden="true"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search submissions…"
            className="w-full rounded-lg border border-[#e7e9ee] bg-white py-2 pl-9 pr-3 text-sm text-[#2b303b] outline-none placeholder:text-[#676b7a]/50 focus:border-[#1f4693]/50"
          />
        </div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#2b303b] sm:text-right">
            Contact Submissions
          </h1>
          <p className="mt-1 text-sm text-[#676b7a] sm:text-right">
            {filtered.length} of {submissions.length} submission
            {submissions.length === 1 ? "" : "s"} shown.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {SUMMARY_BADGES.map(({ key, icon: Icon, label, value, accent }) => (
          <span
            key={key}
            className="inline-flex items-center gap-2 rounded-full border border-[#e7e9ee] bg-white py-1.5 pl-2 pr-4 shadow-sm"
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: `${accent}15` }}
            >
              <Icon className="h-3.5 w-3.5" style={{ color: accent }} aria-hidden="true" />
            </span>
            <span className="text-sm font-bold text-[#2b303b]">{value}</span>
            <span className="text-xs font-medium text-[#676b7a]">{label}</span>
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-[#e7e9ee] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setActiveFilter(filter.key)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
                activeFilter === filter.key
                  ? "border-transparent bg-gradient-to-r from-[#f7941e] to-[#1f4693] text-white"
                  : "border-[#e7e9ee] bg-white text-[#676b7a] hover:border-[#f7941e]/40 hover:text-[#f7941e]"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <div className="flex flex-col gap-0.5 rounded-lg border border-[#e7e9ee] px-2.5 py-1.5">
              <label htmlFor="dateFrom" className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#676b7a]/70">
                <CalendarRange className="h-3 w-3" aria-hidden="true" />
                From
              </label>
              <input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                max={dateTo || undefined}
                className="w-[8.5rem] bg-transparent text-sm text-[#2b303b] outline-none"
              />
            </div>

            <div className="flex flex-col gap-0.5 rounded-lg border border-[#e7e9ee] px-2.5 py-1.5">
              <label htmlFor="dateTo" className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#676b7a]/70">
                <CalendarRange className="h-3 w-3" aria-hidden="true" />
                To
              </label>
              <input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                min={dateFrom || undefined}
                className="w-[8.5rem] bg-transparent text-sm text-[#2b303b] outline-none"
              />
            </div>

            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={clearDateRange}
                aria-label="Clear date range"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#676b7a] hover:bg-[#fafbfc] hover:text-[#2b303b]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleExportExcel}
            disabled={isExporting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e9ee] bg-white px-3.5 py-2 text-sm font-medium text-[#2b303b] transition-colors hover:border-[#3b6d11]/40 hover:text-[#3b6d11] disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            {isExporting ? "Exporting…" : "Export Excel"}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#e7e9ee] bg-[#fafbfc] text-xs font-bold uppercase tracking-wide text-[#676b7a]">
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Company</th>
                <th className="px-5 py-3">Service</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-[#e7e9ee] last:border-0 transition-colors hover:bg-[#fafbfc]"
                >
                  <td className="px-5 py-4">
                    <p className="font-semibold text-[#2b303b]">{item.full_name}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-[#676b7a]">
                      <Mail className="h-3 w-3" aria-hidden="true" />
                      {item.email}
                    </p>
                    {item.phone && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-[#676b7a]">
                        <Phone className="h-3 w-3" aria-hidden="true" />
                        {item.phone}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-4 text-[#2b303b]">{item.company || "—"}</td>
                  <td className="px-5 py-4 text-[#676b7a]">{item.service || "—"}</td>
                  <td className="px-5 py-4">
                    <select
                      value={item.status}
                      onChange={(e) => handleStatusChange(item.id, e.target.value)}
                      disabled={isPending}
                      className={`rounded-full border-0 px-2.5 py-1 text-xs font-semibold outline-none ${STATUS_STYLES[item.status]}`}
                    >
                      {STATUS_OPTIONS[item.status].map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-5 py-4 text-[#676b7a]">{formatDate(item.created_at)}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setViewing(item)}
                        aria-label={`View submission from ${item.full_name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#f7941e]/10 hover:text-[#f7941e]"
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingId(item.id)}
                        aria-label={`Delete submission from ${item.full_name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-[#676b7a]">
            {submissions.length === 0
              ? "No submissions yet — they'll appear here once someone fills out the contact form."
              : "No submissions match your search."}
          </div>
        )}
      </div>

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0e17]/50 px-4 backdrop-blur-sm"
          onClick={() => setViewing(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-[#e7e9ee] bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
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
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#fafbfc] hover:text-[#2b303b]"
              >
                <X className="h-4.5 w-4.5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-5 flex flex-col gap-3 text-sm">
              <p className="flex items-center gap-2 text-[#2b303b]">
                <Mail className="h-4 w-4 text-[#676b7a]" aria-hidden="true" />
                <a href={`mailto:${viewing.email}`} className="hover:text-[#f7941e]">
                  {viewing.email}
                </a>
              </p>
              {viewing.phone && (
                <p className="flex items-center gap-2 text-[#2b303b]">
                  <Phone className="h-4 w-4 text-[#676b7a]" aria-hidden="true" />
                  {viewing.phone}
                </p>
              )}
              {viewing.company && (
                <p className="flex items-center gap-2 text-[#2b303b]">
                  <Building2 className="h-4 w-4 text-[#676b7a]" aria-hidden="true" />
                  {viewing.company}
                </p>
              )}
              {viewing.service && (
                <p className="flex items-center gap-2 text-[#2b303b]">
                  <Briefcase className="h-4 w-4 text-[#676b7a]" aria-hidden="true" />
                  {viewing.service}
                </p>
              )}
              <p className="text-xs text-[#676b7a]">{formatDate(viewing.created_at)}</p>
            </div>

            <div className="mt-4 rounded-xl border border-[#e7e9ee] bg-[#fafbfc] p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[#676b7a]">
                Project Description
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#2b303b]">
                {viewing.message}
              </p>
            </div>
          </div>
        </div>
      )}

      {deletingId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0e17]/50 px-4 backdrop-blur-sm"
          onClick={() => setDeletingId(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[#e7e9ee] bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-[#2b303b]">Delete this submission?</h2>
            <p className="mt-2 text-sm text-[#676b7a]">
              This can&apos;t be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingId(null)}
                className="rounded-lg border border-[#e7e9ee] px-4 py-2 text-sm font-medium text-[#676b7a] transition-colors hover:bg-[#fafbfc]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(deletingId)}
                disabled={isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
