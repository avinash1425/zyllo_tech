import { ArrowUpRight, ArrowDownRight } from "lucide-react";

/**
 * Hero stat card, distinct from the flat tint-icon pattern used elsewhere
 * in the admin panel: a solid gradient header band carries the icon and
 * range badge, with a large ghost watermark icon for texture, and the
 * number/label/delta sit on a plain white body below.
 */
export default function DashboardStatCard({
  icon: Icon,
  label,
  value,
  accent,
  accentDark,
  badgeLabel,
  delta,
  deltaDirection = "up",
  note,
}) {
  const isUp = deltaDirection === "up";
  const DeltaIcon = isUp ? ArrowUpRight : ArrowDownRight;
  const deltaColor = isUp ? "#3b6d11" : "#dc2626";
  const dark = accentDark ?? accent;

  return (
    <div className="group overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
      <div
        className="relative flex items-center justify-between overflow-hidden px-4 py-3"
        style={{ background: `linear-gradient(115deg, ${accent}, ${dark})` }}
      >
        <Icon
          aria-hidden="true"
          className="pointer-events-none absolute -right-3 -top-3 h-20 w-20 text-white/15 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-6"
        />
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm">
          <Icon className="h-4.5 w-4.5 text-white" aria-hidden="true" />
        </span>
        {badgeLabel && (
          <span className="relative inline-flex items-center rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
            {badgeLabel}
          </span>
        )}
      </div>

      <div className="p-5">
        <p className="text-sm text-[#676b7a]">{label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight text-[#2b303b]">{value}</p>

        {(delta || note) && (
          <p className="mt-2 flex items-center gap-1 text-xs">
            {delta && (
              <span
                className="inline-flex items-center gap-0.5 font-semibold"
                style={{ color: deltaColor }}
              >
                <DeltaIcon className="h-3 w-3" aria-hidden="true" />
                {delta}
              </span>
            )}
            {note && <span className="text-[#676b7a]">{note}</span>}
          </p>
        )}
      </div>
    </div>
  );
}
