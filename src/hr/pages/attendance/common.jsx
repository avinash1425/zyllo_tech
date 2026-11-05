// Shared pieces for the Attendance & Time screens (HR and Employee Portal).
import { fullName } from "@/lib/hr/client";
import { Badge, StatusBadge } from "@/hr/ui";

// Computed statuses that the shared StatusBadge has no tone for.
const EXTRA_TONES = { holiday: "violet", weekend: "slate", not_started: "blue", upcoming: "slate" };
const LABELS = { weekend: "weekly off", not_started: "not started" };

export function AttStatusBadge({ status }) {
  if (EXTRA_TONES[status]) return <Badge tone={EXTRA_TONES[status]}>{LABELS[status] ?? String(status).replace(/_/g, " ")}</Badge>;
  return <StatusBadge status={status} />;
}

/** Works with both hr_employees rows and overview { employee: { name, employee_code } } objects. */
export function EmployeeCell({ e }) {
  if (!e) return <span className="text-slate-400">Unknown</span>;
  return (
    <div className="min-w-[10rem]">
      <p className="font-semibold text-[#101a3a]">{e.name || fullName(e)}</p>
      <p className="font-mono text-xs text-slate-500">{e.employee_code}</p>
    </div>
  );
}

export const empLabel = (e) => (e ? `${e.name || fullName(e)} (${e.employee_code})` : "—");

export const STAGE_LABEL = { manager: "Manager review", hr: "HR review", completed: "Completed" };
