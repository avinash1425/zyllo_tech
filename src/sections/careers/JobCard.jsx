import { ArrowRight, Clock, MapPin } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { deptTheme } from "@/components/careers/deptTheme";

export function JobCardSkeleton() {
  return (
    <div className="animate-pulse rounded-3xl border border-[#e7e9ee] bg-white p-7">
      <div className="h-14 w-14 rounded-2xl bg-[#eef0f4]" />
      <div className="mt-6 h-5 w-3/4 rounded bg-[#eef0f4]" />
      <div className="mt-2 h-5 w-1/2 rounded bg-[#eef0f4]" />
      <div className="mt-5 space-y-2.5">
        <div className="h-3.5 w-2/5 rounded bg-[#eef0f4]" />
        <div className="h-3.5 w-1/3 rounded bg-[#eef0f4]" />
      </div>
      <div className="mt-8 h-12 w-full rounded-full bg-[#eef0f4]" />
    </div>
  );
}

// Progress-style pill: one pip per remaining opening (capped at 5).
export function OpeningsPill({ remaining }) {
  const pips = Math.max(0, Math.min(5, remaining));
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-[#f7941e]/10 py-1 pl-2.5 pr-3 text-[13px] font-semibold text-[#a64b06] ring-1 ring-[#f7941e]/20">
      <span className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: pips }).map((_, i) => (
          <span key={i} className="h-1.5 w-3 rounded-full bg-gradient-to-r from-[#f96706] to-[#ffb15c]" />
        ))}
      </span>
      {remaining} opening{remaining === 1 ? "" : "s"} left
    </span>
  );
}

export default function JobCard({ position, onDetails, onApply, index = 0 }) {
  const { title, department, location, employment_type: type, remaining } = position;
  const reduce = useReducedMotion();
  const theme = deptTheme(department);
  const Icon = theme.icon;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay: (index % 3) * 0.08, ease: [0.16, 1, 0.3, 1] }}
      className="h-full"
    >
      <article className="group relative h-full rounded-3xl bg-[#e9ecf2] p-px shadow-[0_1px_2px_rgba(16,26,58,0.05),0_8px_24px_-12px_rgba(16,26,58,0.12)] transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_2px_4px_rgba(16,26,58,0.06),0_28px_48px_-16px_rgba(31,70,147,0.28)] focus-within:shadow-[0_28px_48px_-16px_rgba(31,70,147,0.28)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
        {/* gradient border, revealed on hover / keyboard focus */}
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[#f7941e] via-[#ffb15c] to-[#3089a6] opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100"
        />
        <div className="relative flex h-full flex-col overflow-hidden rounded-[calc(1.5rem-1px)] bg-white p-6 sm:p-7">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-[0.07] blur-2xl transition-opacity duration-300 group-hover:opacity-20"
            style={{ background: theme.from }}
          />

          <div className="relative flex items-start justify-between gap-3">
            <span
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105"
              style={{
                background: `linear-gradient(135deg, ${theme.from}, ${theme.to})`,
                boxShadow: `0 12px 24px -10px ${theme.from}`,
              }}
            >
              <Icon className="h-7 w-7" aria-hidden="true" />
            </span>
            <OpeningsPill remaining={remaining} />
          </div>

          <div className="relative mt-6">
            {department && (
              <p className="text-[13px] font-bold uppercase tracking-[0.14em]" style={{ color: theme.from }}>
                {department}
              </p>
            )}
            <h3 className="mt-1.5 text-xl font-bold leading-snug tracking-tight text-[#1b2030]">{title}</h3>
          </div>

          <ul className="relative mt-4 space-y-2 text-[15px] text-[#4a5668]">
            {location && (
              <li className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#3089a6]/10 text-[#3089a6]">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                {location}
              </li>
            )}
            {type && (
              <li className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#3089a6]/10 text-[#3089a6]">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                {type}
              </li>
            )}
          </ul>

          <div className="relative mt-auto flex flex-col gap-2.5 pt-7">
            <button
              type="button"
              onClick={() => onApply(position)}
              aria-label={`Apply now for ${title}`}
              className="group/apply inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#f96706] via-[#f7941e] to-[#ffb15c] px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#f7941e]/30 transition-all duration-200 hover:shadow-xl hover:shadow-[#f96706]/35 hover:brightness-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f7941e]/40"
            >
              Apply now
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/apply:translate-x-1" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onDetails(position)}
              aria-label={`View details for ${title}`}
              className="inline-flex w-full items-center justify-center rounded-full border border-transparent px-6 py-3 text-sm font-semibold text-[#1f4693] transition-colors duration-200 hover:border-[#1f4693]/20 hover:bg-[#1f4693]/5 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1f4693]/20"
            >
              View details
            </button>
          </div>
        </div>
      </article>
    </motion.div>
  );
}
