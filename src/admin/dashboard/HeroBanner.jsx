import DashboardRefresh from "../DashboardRefresh";

/** Navy-to-teal hero with greeting, date, real-data summary and refresh. */
export default function HeroBanner({ greeting, todayLabel, summary, onRefresh }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#101a3a] via-[#143a63] to-[#0f6f75] p-6 text-white shadow-sm sm:p-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -right-10 -top-16 h-56 w-56 rounded-full bg-[#f7941e]/35 blur-[80px]" />
        <div className="absolute -bottom-20 left-1/4 h-48 w-48 rounded-full bg-[#2dd4bf]/20 blur-[80px]" />
      </div>
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">{todayLabel}</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{greeting}, welcome back</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/80">{summary}</p>
        </div>
        <div className="shrink-0 [&_button]:border-white/25 [&_button]:bg-white/10 [&_button]:text-white [&_button:hover]:bg-white/20 [&_button:hover]:text-white [&_button:focus-visible]:outline-white [&_span]:bg-white/10 [&_span]:text-white/85 [&_span]:shadow-none [&_span]:ring-white/20">
          <DashboardRefresh onRefresh={onRefresh} />
        </div>
      </div>
    </div>
  );
}
