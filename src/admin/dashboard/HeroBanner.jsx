import DashboardRefresh from "../DashboardRefresh";
import { Sparkles } from "lucide-react";

function Stat({ value, label }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/10 px-3 py-2 ring-1 ring-inset ring-white/15">
      <p className="text-xl font-bold leading-none tabular-nums sm:text-2xl">{value}</p>
      <p className="mt-1 truncate text-[11px] font-medium text-white/80">{label}</p>
    </div>
  );
}

/** Compact navy-to-teal hero: greeting, date, 3 real-data mini stats, refresh. */
export default function HeroBanner({ greeting, todayLabel, stats, onRefresh }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#101a3a] via-[#173a52] to-[#3089a6] px-5 py-5 text-white shadow-[0_12px_32px_-16px_rgba(16,26,58,0.6)] sm:px-7">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -right-8 -top-20 h-60 w-60 rounded-full bg-[#f7941e]/40 blur-[70px]" />
        <div className="absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-[#3089a6]/30 blur-[70px]" />
        <div className="absolute -left-10 top-0 h-40 w-40 rounded-full bg-[#1f4693]/40 blur-[70px]" />
        <svg viewBox="0 0 200 100" fill="none" className="absolute -right-4 top-1/2 h-40 w-auto -translate-y-1/2 text-white/[0.07] sm:right-24 sm:h-44">
          <path d="M100 50C85 22 55 14 38 28 20 43 20 57 38 72c17 14 47 6 62-22Zm0 0c15 28 45 36 62 22 18-15 18-29 0-44-17-14-47-6-62 22Z" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
        </svg>
      </div>
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/75">
            <Sparkles className="h-3.5 w-3.5 text-[#ffb15c]" aria-hidden="true" />
            {todayLabel}
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight sm:text-[32px] sm:leading-9">{greeting}</h1>
          <p className="mt-1 text-sm text-white/80">Here is your website at a glance</p>
        </div>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center lg:shrink-0">
          <div className="grid grid-cols-3 gap-2">
            {stats.map((s) => (
              <Stat key={s.label} {...s} />
            ))}
          </div>
          <div className="shrink-0 [&_button]:border-white/25 [&_button]:bg-white/10 [&_button]:text-white [&_button:hover]:bg-white/20 [&_button:hover]:text-white [&_button:focus-visible]:outline-white [&_span]:bg-white/10 [&_span]:text-white/85 [&_span]:shadow-none [&_span]:ring-white/20">
            <DashboardRefresh onRefresh={onRefresh} />
          </div>
        </div>
      </div>
    </div>
  );
}
