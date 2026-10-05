import { ArrowRight, Briefcase, Clock, MapPin, Users } from "lucide-react";

export function JobCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-[#e7e9ee] bg-white p-6">
      <div className="h-6 w-24 rounded-full bg-[#eef0f4]" />
      <div className="mt-5 h-5 w-3/4 rounded bg-[#eef0f4]" />
      <div className="mt-2 h-5 w-1/2 rounded bg-[#eef0f4]" />
      <div className="mt-5 space-y-2.5">
        <div className="h-3.5 w-2/5 rounded bg-[#eef0f4]" />
        <div className="h-3.5 w-1/3 rounded bg-[#eef0f4]" />
      </div>
      <div className="mt-6 flex gap-3">
        <div className="h-10 w-28 rounded-full bg-[#eef0f4]" />
        <div className="h-10 w-28 rounded-full bg-[#eef0f4]" />
      </div>
    </div>
  );
}

export default function JobCard({ position, onDetails, onApply }) {
  const { title, department, location, employment_type: type, remaining } = position;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:border-[#1f4693]/20 hover:shadow-xl hover:shadow-[#1f4693]/10 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1 origin-left scale-x-30 bg-gradient-to-r from-[#f96706] via-[#ffb15c] to-[#3089a6] opacity-60 transition-all duration-300 group-hover:scale-x-100 group-hover:opacity-100"
      />

      <div className="flex flex-wrap items-center gap-2">
        {department && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1f4693]/10 px-3 py-1 text-xs font-semibold text-[#1f4693]">
            <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
            {department}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f7941e]/12 px-3 py-1 text-xs font-semibold text-[#a64b06]">
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          {remaining} opening{remaining === 1 ? "" : "s"} left
        </span>
      </div>

      <h3 className="mt-4 text-lg font-bold leading-snug text-[#2b303b]">{title}</h3>

      <ul className="mt-3 space-y-1.5 text-sm text-[#676b7a]">
        {location && (
          <li className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-[#3089a6]" aria-hidden="true" />
            {location}
          </li>
        )}
        {type && (
          <li className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-[#3089a6]" aria-hidden="true" />
            {type}
          </li>
        )}
      </ul>

      <div className="mt-6 flex flex-wrap items-center gap-2.5 pt-1">
        <button
          type="button"
          onClick={() => onDetails(position)}
          aria-label={`View details for ${title}`}
          className="inline-flex items-center justify-center rounded-full border border-[#d5d9e2] bg-white px-5 py-2.5 text-sm font-semibold text-[#2b303b] transition-colors duration-200 hover:border-[#1f4693]/50 hover:text-[#1f4693] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1f4693]/20"
        >
          View details
        </button>
        <button
          type="button"
          onClick={() => onApply(position)}
          aria-label={`Apply now for ${title}`}
          className="inline-flex items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-[#f96706] to-[#f7941e] px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-[#f7941e]/30 transition-all duration-200 hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40"
        >
          Apply now
          <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
