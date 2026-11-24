// Small shared pieces for the My Projects pages (also used by admin pages).
import { HEALTH, PRIORITY, PROJECT_STATUS } from "@/lib/api/employee/projects";
import { Badge, Progress } from "@/components/portal/PortalUI";
import { todayIst } from "./attendanceFormat";

export { CARD_PAD as CARD } from "@/components/portal/portalStyles";

// Badge tone per value (status / health / priority keys do not overlap).
const TONE = {
  planning: "slate",
  in_progress: "sky",
  live: "green",
  on_hold: "amber",
  completed: "violet",
  cancelled: "red",
  on_track: "green",
  at_risk: "amber",
  off_track: "red",
  high: "red",
  medium: "amber",
  low: "slate",
};

export function Chip({ map, value, prefix = "" }) {
  const s = map[value];
  if (!s) return null;
  const tone = TONE[value];
  if (!tone) {
    return (
      <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.chip}`}>
        {prefix}
        {s.label}
      </span>
    );
  }
  return (
    <Badge tone={tone} dot>
      {prefix}
      {s.label}
    </Badge>
  );
}

export const StatusChip = ({ value }) => <Chip map={PROJECT_STATUS} value={value} />;
export const HealthChip = ({ value }) => <Chip map={HEALTH} value={value} />;
export const PriorityChip = ({ value }) => <Chip map={PRIORITY} value={value} prefix="Priority: " />;

export function ProgressBar({ value }) {
  return <Progress value={value} />;
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
