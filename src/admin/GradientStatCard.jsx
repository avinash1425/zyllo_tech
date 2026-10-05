import { ArrowUpRight, ArrowDownRight, ExternalLink } from "lucide-react";
import SamplePill from "./SamplePill";

/**
 * Top-row hero stat card: a soft diagonal gradient wash across the whole
 * card (not a solid header band like DashboardStatCard), icon in a
 * colored square top-left, a pill badge top-right, then a large number,
 * label, and a delta line with an up/down arrow plus optional trailing
 * context (e.g. "· 2.56 pages/visit").
 */
export default function GradientStatCard({
  icon: Icon,
  label,
  value,
  accent,
  badgeLabel,
  delta,
  deltaDirection = "up",
  deltaGood = true,
  note,
  sample = false,
}) {
  const isUp = deltaDirection === "up";
  const DeltaIcon = isUp ? ArrowUpRight : ArrowDownRight;
  const deltaColor = deltaGood ? "#3b6d11" : "#dc2626";

  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-[#e7e9ee] p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      style={{ background: `linear-gradient(150deg, ${accent}14, ${accent}05 55%, transparent)` }}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm"
          style={{ backgroundColor: `${accent}20` }}
        >
          <Icon className="h-5 w-5" style={{ color: accent }} aria-hidden="true" />
        </span>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
        {sample && <SamplePill />}
        {badgeLabel && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold"
            style={{ backgroundColor: `${accent}18`, color: accent }}
          >
            {badgeLabel}
            <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
          </span>
        )}
        </div>
      </div>

      <p className="mt-4 text-sm font-medium text-[#676b7a]">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums text-[#2b303b]">{value}</p>

      {(delta || note) && (
        <p className="mt-2 flex flex-wrap items-center gap-1 text-xs">
          {delta && (
            <span
              className="inline-flex items-center gap-0.5 font-semibold tabular-nums"
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
  );
}
