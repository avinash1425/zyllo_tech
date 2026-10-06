import { ArrowRight, Briefcase, Clock, MapPin, Users } from "lucide-react";
import { deptTheme } from "@/components/careers/deptTheme";
import { parseDescription } from "@/components/careers/DescriptionBody";

export function JobCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-[#e5e8ef] bg-white p-6">
      <div className="h-5 w-24 rounded-full bg-[#eef0f4]" />
      <div className="mt-4 h-7 w-3/4 rounded bg-[#eef0f4]" />
      <div className="mt-4 flex gap-4">
        <div className="h-4 w-24 rounded bg-[#eef0f4]" />
        <div className="h-4 w-20 rounded bg-[#eef0f4]" />
      </div>
      <div className="mt-6 h-12 w-40 rounded-full bg-[#eef0f4]" />
    </div>
  );
}

export function openingsLabel(remaining) {
  if (typeof remaining !== "number") return "";
  return `${remaining} opening${remaining === 1 ? "" : "s"} left`;
}

// Kept for backward compatibility (RoleMaster still imports it).
export function OpeningsPill({ remaining }) {
  const label = openingsLabel(remaining);
  if (!label) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eef3fb] px-3 py-1 text-sm font-semibold text-[#173a52] ring-1 ring-[#dbe5f5]">
      <Users className="h-3.5 w-3.5 text-[#3089a6]" aria-hidden="true" />
      {label}
    </span>
  );
}

export function MetaRow({ position, className = "" }) {
  const items = [
    { icon: MapPin, label: position.location },
    { icon: Clock, label: position.employment_type },
    { icon: Briefcase, label: openingsLabel(position.remaining) },
  ].filter((i) => i.label);
  return (
    <ul className={`flex flex-wrap gap-x-5 gap-y-2 text-[15px] text-[#4a5668] ${className}`}>
      {items.map(({ icon: Icon, label }) => (
        <li key={label} className="inline-flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-[#3089a6]" aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}

// Plain-text excerpt: first real paragraph (or first bullets) with markdown
// markers removed. Returns "" when nothing usable exists.
export function excerptOf(text) {
  const blocks = parseDescription(text);
  const p = blocks.find((b) => b.type === "p") || blocks.find((b) => b.type === "ul");
  if (!p) return "";
  const raw = p.type === "p" ? p.text : p.items.slice(0, 2).join(". ");
  return raw
    .replace(/[*_`#>]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export default function JobCard({ position, onDetails, onApply, featured = false }) {
  const { title, department, description } = position;
  const theme = deptTheme(department);
  const excerpt = excerptOf(description);
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-[#e5e8ef] bg-white shadow-[0_1px_2px_rgba(16,26,58,0.05),0_8px_24px_-16px_rgba(16,26,58,0.18)] transition-all duration-300 hover:-translate-y-1 hover:border-[#3089a6]/60 hover:shadow-[0_2px_4px_rgba(16,26,58,0.06),0_22px_40px_-20px_rgba(23,58,82,0.35)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: `linear-gradient(180deg, ${theme.from}, ${theme.to})` }} />
      {featured && (
        <span className="absolute right-0 top-0 rounded-bl-xl bg-[#173a52] px-3.5 py-1.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-white">
          Featured
        </span>
      )}
      <div className="flex flex-1 flex-col p-6 pl-7 sm:p-7 sm:pl-8">
        {department && (
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#1f4693]">{department}</p>
        )}
        <h3 className={`mt-2 break-words text-xl font-semibold leading-snug tracking-tight text-[#173a52] sm:text-[22px] ${featured ? "pr-24" : ""}`}>
          {title}
        </h3>
        <MetaRow position={position} className="mt-4" />
        {excerpt && <p className="mt-4 line-clamp-2 text-[15px] leading-relaxed text-[#4a5668]">{excerpt}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-6 gap-y-3 pt-6">
          <button
            type="button"
            onClick={() => onApply(position)}
            aria-label={`Apply now for ${title}`}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#f96706] px-6 py-2.5 text-[15px] font-semibold text-white shadow-[0_8px_18px_-8px_rgba(249,103,6,0.7)] transition-colors hover:bg-[#e25a02] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40"
          >
            Apply now
          </button>
          <button
            type="button"
            onClick={() => onDetails(position)}
            aria-label={`View details for ${title}`}
            className="group/link inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-[15px] font-semibold text-[#1f4693] transition-colors hover:text-[#173a52] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1f4693]/20"
          >
            View details
            <ArrowRight className="h-4 w-4 transition-transform group-hover/link:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}
