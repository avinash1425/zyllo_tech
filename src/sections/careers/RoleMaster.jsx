import { ArrowRight, Briefcase, ChevronRight, Clock, MapPin } from "lucide-react";
import { deptTheme } from "@/components/careers/deptTheme";
import DescriptionBody from "@/components/careers/DescriptionBody";
import { OpeningsPill } from "@/sections/careers/JobCard";

// Desktop master-detail pieces for the open positions list.

export function RoleRow({ position, active, onSelect }) {
  const { title, department, location, employment_type: type, remaining } = position;
  const theme = deptTheme(department);
  const Icon = theme.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`group flex w-full items-start gap-4 rounded-2xl border bg-white p-4 text-left transition-all duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40 motion-reduce:transition-none ${
        active
          ? "border-[#f7941e] shadow-[0_16px_32px_-18px_rgba(249,103,6,0.45)] ring-2 ring-[#f7941e]/30"
          : "border-[#e7e9ee] shadow-[0_1px_2px_rgba(16,26,58,0.06)] hover:border-[#1f4693]/40 hover:shadow-[0_12px_28px_-16px_rgba(31,70,147,0.35)]"
      }`}
    >
      <span
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white"
        style={{ background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}
      >
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-lg font-bold leading-snug text-[#1b2030]">{title}</span>
        <span className="mt-1 block text-[15px] leading-relaxed text-[#4a5668]">
          {[department, location, type].filter(Boolean).join(" · ")}
        </span>
        <span className="mt-2 block">
          <OpeningsPill remaining={remaining} />
        </span>
      </span>
      <ChevronRight
        className={`mt-1 h-5 w-5 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${
          active ? "translate-x-0.5 text-[#f96706]" : "text-[#4a5668]"
        }`}
        aria-hidden="true"
      />
    </button>
  );
}

export function DetailPanel({ position, onApply, onDetails }) {
  const theme = deptTheme(position.department);
  const chips = [
    { icon: MapPin, label: position.location },
    { icon: Clock, label: position.employment_type },
  ].filter((c) => c.label);
  return (
    <article
      aria-label={`${position.title} details`}
      className="sticky top-[10.5rem] flex max-h-[calc(100dvh-12rem)] min-w-0 flex-col overflow-hidden rounded-3xl border border-[#e7e9ee] bg-white shadow-[0_24px_48px_-24px_rgba(31,70,147,0.35)]"
    >
      <span aria-hidden="true" className="h-1.5 shrink-0" style={{ background: `linear-gradient(90deg, ${theme.from}, ${theme.to})` }} />
      <div className="shrink-0 border-b border-[#e7e9ee] p-6 xl:p-8">
        {position.department && (
          <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em]" style={{ color: theme.from }}>
            <Briefcase className="h-4 w-4" aria-hidden="true" />
            {position.department}
          </p>
        )}
        <h3 className="mt-1.5 break-words text-2xl font-bold leading-snug tracking-tight text-[#1b2030] xl:text-[1.75rem]">
          {position.title}
        </h3>
        <ul className="mt-4 flex flex-wrap items-center gap-2.5">
          {chips.map(({ icon: Icon, label }) => (
            <li key={label} className="inline-flex items-center gap-2 rounded-full bg-[#eef1f7] px-3.5 py-1.5 text-[15px] font-medium text-[#173a52]">
              <Icon className="h-4 w-4 text-[#3089a6]" aria-hidden="true" />
              {label}
            </li>
          ))}
          <li>
            <OpeningsPill remaining={position.remaining} />
          </li>
        </ul>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 xl:p-8">
        {position.description ? (
          <DescriptionBody text={position.description} />
        ) : (
          <p className="text-base leading-relaxed text-[#4a5668]">
            Full details for this role are shared during the process. Apply to get started.
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-[#e7e9ee] bg-[#fafbfc] px-6 py-4 xl:px-8">
        <button
          type="button"
          onClick={onApply}
          className="group/apply inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f96706] via-[#f7941e] to-[#ffb15c] px-8 py-3 text-[15px] font-bold text-white shadow-lg shadow-[#f7941e]/30 transition-all hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40 xl:flex-none"
        >
          Apply now
          <ArrowRight className="h-4 w-4 transition-transform group-hover/apply:translate-x-1 motion-reduce:transition-none" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onDetails}
          className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#1f4693]/40 bg-white px-6 py-3 text-[15px] font-semibold text-[#1f4693] transition-colors hover:border-[#1f4693] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1f4693]/20"
        >
          Open full details
        </button>
      </div>
    </article>
  );
}
