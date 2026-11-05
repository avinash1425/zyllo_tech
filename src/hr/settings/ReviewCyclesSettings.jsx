// HR Settings tab: review cycles master data. New cycles are inserted as
// drafts (the database rejects anything else); activation, score computation
// and closing are lifecycle actions on the Performance page. Writes require
// performance.manage (RLS).
import { Badge, Card, StatusBadge } from "@/hr/ui";
import { formatDate } from "@/lib/hr/client";
import MasterDataEditor from "@/hr/components/MasterDataEditor";
import { CYCLE_TYPES, label } from "@/lib/hr/performance";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const config = {
  table: "hr_review_cycles",
  title: "Review cycles",
  singular: "review cycle",
  select: "id, name, cycle_type, period_start, period_end, self_assessment_due, manager_review_due, status",
  orderBy: "period_start",
  noActive: true,
  description: "New cycles start as drafts. Start, compute scores and close them from Performance & KPI → Review cycles. Period end must be on or after the start, and the manager review due date on or after the self-assessment due date.",
  columns: [
    { key: "name", header: "Name" },
    { key: "cycle_type", header: "Type", render: (r) => <Badge tone={r.cycle_type === "intern" ? "violet" : "slate"}>{label(r.cycle_type)}</Badge> },
    { key: "period", header: "Period", render: (r) => `${formatDate(r.period_start)} – ${formatDate(r.period_end)}` },
    { key: "due", header: "Self / manager due", render: (r) => `${formatDate(r.self_assessment_due)} / ${formatDate(r.manager_review_due)}` },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ],
  fields: [
    { key: "name", label: "Name", required: true, wide: true, pattern: "^.{2,120}$", patternMessage: "2–120 characters." },
    { key: "cycle_type", label: "Type", type: "select", required: true, placeholder: undefined, options: CYCLE_TYPES.map((t) => ({ value: t, label: label(t) })), hint: "Intern cycles cover intern employees only." },
    { key: "period_start", label: "Period start", type: "date", required: true, pattern: DATE.source, patternMessage: "Use a valid date." },
    { key: "period_end", label: "Period end", type: "date", required: true, pattern: DATE.source, patternMessage: "Use a valid date." },
    { key: "self_assessment_due", label: "Self-assessment due", type: "date" },
    { key: "manager_review_due", label: "Manager review due", type: "date" },
  ],
  defaults: { cycle_type: "quarterly" },
  validate: (v) => {
    const e = {};
    if (v.period_start && v.period_end && v.period_end < v.period_start) e.period_end = "Period end must be on or after the start.";
    if (v.self_assessment_due && v.period_start && v.self_assessment_due < v.period_start) e.self_assessment_due = "Due date is before the period starts.";
    if (v.manager_review_due && v.self_assessment_due && v.manager_review_due < v.self_assessment_due) e.manager_review_due = "Manager review is due before the self-assessment.";
    return e;
  },
};

export default function ReviewCyclesSettings({ canEdit }) {
  return <Card><MasterDataEditor config={config} canEdit={canEdit} /></Card>;
}
