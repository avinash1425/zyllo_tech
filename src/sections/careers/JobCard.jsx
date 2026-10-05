import { Briefcase, Clock, MapPin, Users } from "lucide-react";

export function JobCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl bg-[#e3e7ef] p-[1.5px]">
      <div className="rounded-[14.5px] bg-white p-6">
        <div className="h-5 w-24 rounded-full bg-[#eef0f4]" />
        <div className="mt-4 h-7 w-3/4 rounded bg-[#eef0f4]" />
        <div className="mt-4 flex gap-4">
          <div className="h-4 w-24 rounded bg-[#eef0f4]" />
          <div className="h-4 w-20 rounded bg-[#eef0f4]" />
        </div>
        <div className="mt-6 flex gap-3">
          <div className="h-11 flex-1 rounded-full bg-[#eef0f4]" />
          <div className="h-11 flex-1 rounded-full bg-[#eef0f4]" />
        </div>
      </div>
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
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f7941e]/10 px-3 py-1 text-sm font-semibold text-[#a64b06] ring-1 ring-[#f7941e]/20">
      <Users className="h-3.5 w-3.5" aria-hidden="true" />
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

export default function JobCard({ position, onDetails, onApply, featured = false }) {
  const { title, department } = position;
  return (
    <article className="h-full rounded-2xl bg-gradient-to-br from-[#1f4693] to-[#f96706] p-[1.5px] shadow-[0_8px_24px_-14px_rgba(16,26,58,0.3)] transition-shadow duration-300 hover:shadow-[0_16px_32px_-14px_rgba(31,70,147,0.4)] motion-reduce:transition-none">
      <div className="flex h-full flex-col rounded-[14.5px] bg-white p-6">
        <div className="flex flex-wrap items-center gap-2">
          {featured && (
            <span className="rounded-full bg-[#f96706] px-3 py-1 text-sm font-semibold text-white">Featured</span>
          )}
          {department && (
            <span className="rounded-full bg-[#1f4693] px-3 py-1 text-sm font-semibold text-white">{department}</span>
          )}
        </div>
        <h3 className="mt-4 text-xl font-bold leading-snug tracking-tight text-[#1b2030] sm:text-2xl">{title}</h3>
        <MetaRow position={position} className="mt-4" />
        <div className="mt-auto grid grid-cols-2 gap-3 pt-6">
          <button
            type="button"
            onClick={() => onDetails(position)}
            aria-label={`View details for ${title}`}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#c9ced9] bg-white px-4 py-2.5 text-[15px] font-semibold text-[#1b2030] transition-colors hover:border-[#1f4693] hover:text-[#1f4693] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1f4693]/20"
          >
            View Details
          </button>
          <button
            type="button"
            onClick={() => onApply(position)}
            aria-label={`Apply now for ${title}`}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-gradient-to-r from-[#f96706] to-[#f7941e] px-4 py-2.5 text-[15px] font-bold text-white shadow-md shadow-[#f7941e]/30 transition-all hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40"
          >
            Apply Now
          </button>
        </div>
      </div>
    </article>
  );
}
