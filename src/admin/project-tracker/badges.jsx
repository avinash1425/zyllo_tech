import { PROJECT_HEALTH, PROJECT_PRIORITIES, PROJECT_STATUSES, labelOf } from "@/lib/api/admin/projectTracker";
import { progressStyle, snapProgress } from "./styles";

const PILL = "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold";

const STATUS_STYLE = {
  planning:    "bg-[#1e40af] text-white",
  in_progress: "bg-[#f7941e] text-white",
  live:        "bg-emerald-600 text-white",
  on_hold:     "bg-slate-500 text-white",
  completed:   "bg-[#1f4693] text-white",
  cancelled:   "bg-red-600 text-white",
};

const PRIORITY_STYLE = {
  high:   "bg-red-600 text-white",
  medium: "bg-amber-500 text-white",
  low:    "bg-slate-400 text-white",
};

const HEALTH_DOT = {
  on_track: "bg-emerald-500",
  at_risk: "bg-amber-500",
  off_track: "bg-red-500",
};

export function StatusBadge({ status }) {
  return <span className={`${PILL} ${STATUS_STYLE[status] ?? ""}`}>{labelOf(PROJECT_STATUSES, status)}</span>;
}

export function PriorityBadge({ priority }) {
  return <span className={`${PILL} ${PRIORITY_STYLE[priority] ?? ""}`}>{labelOf(PROJECT_PRIORITIES, priority)}</span>;
}

/** Coloured dot + label; a dash when health is not set. */
export function HealthBadge({ health }) {
  if (!health) return <span className="text-[#9aa0ad]">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-[#2b303b]">
      <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${HEALTH_DOT[health] ?? "bg-[#9aa0ad]"}`} />
      {labelOf(PROJECT_HEALTH, health)}
    </span>
  );
}

export function ProgressBar({ value, className = "w-24" }) {
  const pct = snapProgress(value);
  const { color, label } = progressStyle(pct);
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} title={label}>
      <span
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${pct}% – ${label}`}
        aria-label="Progress"
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#eef0f3]"
      >
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </span>
      <span className="w-9 text-right text-xs font-bold tabular-nums" style={{ color }}>
        {pct}%
      </span>
    </span>
  );
}
