// Shared status pill. Maps the status strings used across the admin area to
// colours. Unknown statuses fall back to a neutral grey and show the raw value.
const STATUS_META = {
  // contact submissions
  new: { label: "New", cls: "bg-[#1f4693]/10 text-[#1f4693] ring-[#1f4693]/20", dot: "#1f4693" },
  contacted: { label: "Contacted", cls: "bg-[#3089a6]/10 text-[#216478] ring-[#3089a6]/25", dot: "#3089a6" },
  closed: { label: "Closed", cls: "bg-[#676b7a]/10 text-[#4b4f5c] ring-[#676b7a]/20", dot: "#676b7a" },
  // blog / portfolio
  draft: { label: "Draft", cls: "bg-[#676b7a]/10 text-[#4b4f5c] ring-[#676b7a]/20", dot: "#676b7a" },
  published: { label: "Published", cls: "bg-[#3089a6]/10 text-[#216478] ring-[#3089a6]/20", dot: "#3089a6" },
  // job postings
  open: { label: "Open", cls: "bg-[#3089a6]/10 text-[#216478] ring-[#3089a6]/20", dot: "#3089a6" },
  // applicants
  reviewed: { label: "Reviewed", cls: "bg-[#3089a6]/10 text-[#216478] ring-[#3089a6]/25", dot: "#3089a6" },
  shortlisted: { label: "Shortlisted", cls: "bg-[#f7941e]/12 text-[#a85a00] ring-[#f7941e]/25", dot: "#f7941e" },
  interview: { label: "Interview", cls: "bg-[#f96706]/10 text-[#a84300] ring-[#f96706]/25", dot: "#f96706" },
  offer: { label: "Offer", cls: "bg-[#173a52]/10 text-[#173a52] ring-[#173a52]/25", dot: "#173a52" },
  hired: { label: "Hired", cls: "bg-[#3089a6]/10 text-[#216478] ring-[#3089a6]/20", dot: "#3089a6" },
  rejected: { label: "Rejected", cls: "bg-red-50 text-red-700 ring-red-200", dot: "#dc2626" },
};

// "closed" for a job posting reads as an ended state; keep it neutral grey.
export default function StatusBadge({ status, label, className = "" }) {
  const meta = STATUS_META[status] ?? {
    label: status ?? "Unknown",
    cls: "bg-[#676b7a]/10 text-[#4b4f5c] ring-[#676b7a]/20",
    dot: "#676b7a",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${meta.cls} ${className}`}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: meta.dot }}
      />
      {label ?? meta.label}
    </span>
  );
}
