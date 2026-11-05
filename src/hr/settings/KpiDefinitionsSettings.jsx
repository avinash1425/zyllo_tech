// HR Settings tab: KPI definitions used to score goals. KPIs are never
// deleted; deactivate them instead. Writes require performance.manage (RLS).
// Scoring (database, hr_private.kpi_score), as a percentage clamped to the cap:
//   ratio = actual ÷ target · inverse_ratio = target ÷ actual
//   binary = 100 when the target is met (by direction) else 0 · manual = actual is the score
//   direction "target exact" = 100 − |actual − target| ÷ |target| × 100
import { Card } from "@/hr/ui";
import MasterDataEditor from "@/hr/components/MasterDataEditor";
import { KPI_DIRECTIONS, KPI_FORMULAS, label } from "@/lib/hr/performance";

const FORMULA_HINT = {
  ratio: "actual ÷ target",
  inverse_ratio: "target ÷ actual",
  binary: "100 if met, else 0",
  manual: "actual is the score (0–100)",
};

const config = {
  table: "hr_kpi_definitions",
  title: "KPI definitions",
  singular: "KPI",
  select: "id, name, description, unit, direction, formula_type, default_weight, active",
  orderBy: "name",
  description: "Goal scores are computed only from these definitions and the targets and actuals recorded on goals — never from hours or attendance.",
  columns: [
    { key: "name", header: "Name" },
    { key: "unit", header: "Unit", render: (r) => r.unit ?? "—" },
    { key: "direction", header: "Direction", render: (r) => label(r.direction) },
    { key: "formula_type", header: "Formula", render: (r) => <span>{label(r.formula_type)}<span className="block text-xs text-slate-500">{FORMULA_HINT[r.formula_type]}</span></span> },
    { key: "default_weight", header: "Default weight", render: (r) => `${Number(r.default_weight)}%` },
  ],
  fields: [
    { key: "name", label: "Name", required: true, wide: true, pattern: "^.{2,120}$", patternMessage: "2–120 characters." },
    { key: "description", label: "Description", type: "textarea", wide: true },
    { key: "unit", label: "Unit", hint: "e.g. tickets, %, hours to respond" },
    { key: "default_weight", label: "Default weight (%)", type: "number", min: 0, max: 100, step: "0.01", required: true, hint: "Pre-fills the goal weight." },
    { key: "direction", label: "Direction", type: "select", required: true, placeholder: undefined, options: KPI_DIRECTIONS.map((d) => ({ value: d, label: label(d) })) },
    { key: "formula_type", label: "Formula", type: "select", required: true, placeholder: undefined, options: KPI_FORMULAS.map((f) => ({ value: f, label: `${label(f)} — ${FORMULA_HINT[f]}` })) },
  ],
  defaults: { direction: "higher_is_better", formula_type: "ratio", default_weight: 0 },
};

export default function KpiDefinitionsSettings({ canEdit }) {
  return <Card><MasterDataEditor config={config} canEdit={canEdit} /></Card>;
}
