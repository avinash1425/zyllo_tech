// Skeleton placeholders shaped like the dashboard (stat cards + a table) so the
// layout does not jump when data arrives. Animation is disabled for users who
// prefer reduced motion.
function Block({ className = "" }) {
  return <div className={`rounded-lg bg-[#e7e9ee] motion-safe:animate-pulse ${className}`} />;
}

export default function AdminLoading({ label = "Loading…" }) {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>

      <div className="flex flex-col gap-3">
        <Block className="h-7 w-48" />
        <Block className="h-4 w-72 max-w-full" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <Block className="h-10 w-10 rounded-xl" />
              <Block className="h-5 w-20 rounded-full" />
            </div>
            <Block className="mt-5 h-4 w-24" />
            <Block className="mt-2 h-8 w-32" />
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm">
        <div className="border-b border-[#e7e9ee] bg-[#fafbfc] px-5 py-3.5">
          <Block className="h-3.5 w-full max-w-md" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-[#e7e9ee] px-5 py-4 last:border-0"
          >
            <Block className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Block className="h-3.5 w-1/3" />
              <Block className="h-3 w-1/2" />
            </div>
            <Block className="hidden h-6 w-20 rounded-full sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
