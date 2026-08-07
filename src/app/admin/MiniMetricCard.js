/**
 * Second-row metric card, deliberately different from DashboardStatCard's
 * gradient-header treatment: a colored icon wedge sits on the left edge,
 * the number is the dominant element, and progress renders as a segmented
 * dotted track rather than a plain filled bar.
 */
export default function MiniMetricCard({ icon: Icon, label, value, weekDelta, accent, progress }) {
  const clampedProgress = Math.max(0, Math.min(100, progress));
  const segments = 12;
  const filledSegments = Math.round((clampedProgress / 100) * segments);

  return (
    <div className="group flex overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
      <div
        className="flex w-16 shrink-0 items-center justify-center"
        style={{ backgroundColor: `${accent}12` }}
      >
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full shadow-sm transition-transform duration-300 group-hover:scale-110"
          style={{ backgroundColor: accent }}
        >
          <Icon className="h-4.5 w-4.5 text-white" aria-hidden="true" />
        </span>
      </div>

      <div className="flex-1 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm text-[#676b7a]">{label}</p>
          {weekDelta !== undefined && weekDelta !== null && (
            <span className="shrink-0 text-[11px] font-semibold" style={{ color: accent }}>
              +{weekDelta} this week
            </span>
          )}
        </div>
        <p className="mt-0.5 text-2xl font-bold text-[#2b303b]">{value}</p>

        <div className="mt-2.5 flex gap-[3px]">
          {Array.from({ length: segments }).map((_, i) => (
            <span
              key={i}
              className="h-1.5 flex-1 rounded-full transition-colors duration-300"
              style={{ backgroundColor: i < filledSegments ? accent : "#eef0f3" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
