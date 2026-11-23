// Small shared pieces for the My Projects pages.
import { HEALTH, PRIORITY, PROJECT_STATUS } from "@/lib/api/employee/projects";
import { todayIst } from "./attendanceFormat";

export const CARD = "rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-[0_1px_2px_rgba(16,26,58,0.06)] sm:p-5";

export function Chip({ map, value, prefix = "" }) {
  const s = map[value];
  if (!s) return null;
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.chip}`}>
      {prefix}
      {s.label}
    </span>
  );
}

export const StatusChip = ({ value }) => <Chip map={PROJECT_STATUS} value={value} />;
export const HealthChip = ({ value }) => <Chip map={HEALTH} value={value} />;
export const PriorityChip = ({ value }) => <Chip map={PRIORITY} value={value} prefix="Priority: " />;

export function ProgressBar({ value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#eef0f5]" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-gradient-to-r from-[#f7941e] to-[#1f4693]" style={{ width: `${v}%` }} />
      </div>
      <span className="w-10 text-right text-xs font-bold tabular-nums text-[#2b303b]">{v}%</span>
    </div>
  );
}

/** Whole days from today (India) to a "YYYY-MM-DD" date; negative = past. */
export function daysUntil(iso) {
  if (!iso) return null;
  const t = todayIst().iso;
  const toUtc = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(iso) - toUtc(t)) / 86_400_000);
}

/** "Due in 3 days" / "Due today" / "Overdue by 2 days" with a colour. */
export function DeadlineText({ iso, done }) {
  const n = daysUntil(iso);
  if (n == null) return <span className="text-[#9aa0ad]">No deadline</span>;
  if (done) return <span className="text-[#676b7a]">Was due {iso.split("-").reverse().join("-")}</span>;
  if (n < 0) return <span className="font-semibold text-red-600">Overdue by {-n} day{n === -1 ? "" : "s"}</span>;
  if (n === 0) return <span className="font-semibold text-amber-700">Due today</span>;
  return <span className={n <= 3 ? "font-semibold text-amber-700" : "text-[#4a5880]"}>Due in {n} day{n === 1 ? "" : "s"}</span>;
}
