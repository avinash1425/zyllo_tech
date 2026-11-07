// KPI templates (hr_kpi_definitions): measure (unit + how it is measured),
// default target, default weight, scoring direction / formula. Deactivate
// instead of deleting. Written by performance.manage; readable by all.
import { useMemo, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { useHrQuery } from "@/lib/hr/client";
import { listKpis, saveKpi } from "@/lib/hr/performance";
import { KPI_DIRECTIONS, KPI_FORMULAS, kpiScore, label } from "@/lib/hr/performanceRules";
import { Badge, Button, Checkbox, DataTable, Field, Input, SearchInput, Select, Textarea, Toolbar, useToast } from "@/hr/ui";
import { ActionModal, opts } from "./shared";

const FORMULA_HELP = {
  ratio: "Score = actual ÷ target × 100 (capped at 100).",
  inverse_ratio: "Score = target ÷ actual × 100 — for measures where lower is better.",
  binary: "Score = 100 when the target is met, otherwise 0.",
  manual: "The actual value entered IS the score (0–100), e.g. a rated assessment.",
};

function KpiForm({ kpi, onClose, onSaved }) {
  const isNew = !kpi?.id;
  const [v, setV] = useState({ name: "", category: "", description: "", unit: "", measurement: "", direction: "higher_is_better", formula_type: "ratio",
    default_weight: 0, default_target: "", active: true, ...(kpi ?? {}) });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const sample = v.default_target !== "" && v.default_target != null ? kpiScore(v.formula_type, v.direction, v.default_target, Number(v.default_target) * 0.8) : null;
  return (
    <ActionModal title={isNew ? "New KPI template" : `Edit ${kpi.name}`} size="lg" submitLabel={isNew ? "Create KPI" : "Save"} onClose={onClose}
      onSubmit={async () => {
        if ((v.name ?? "").trim().length < 2) return { error: "Name the KPI (2–120 characters)." };
        const w = Number(v.default_weight);
        if (!(w >= 0 && w <= 100)) return { error: "Default weight must be 0–100." };
        if (v.default_target !== "" && v.default_target != null && !Number.isFinite(Number(v.default_target))) return { error: "Default target must be a number." };
        const res = await saveKpi(v, kpi?.id);
        if (res.error) return { error: /duplicate|already exists/i.test(res.error) ? "A KPI with this name already exists." : res.error };
        onSaved(isNew); return {};
      }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="KPI name" required><Input value={v.name} maxLength={120} onChange={set("name")} /></Field>
        <Field label="Category" hint="e.g. Delivery, Quality, Customer"><Input value={v.category ?? ""} maxLength={80} onChange={set("category")} /></Field>
        <Field label="Unit of measure" hint="e.g. tickets, %, hours"><Input value={v.unit ?? ""} maxLength={60} onChange={set("unit")} /></Field>
        <Field label="Default target"><Input type="number" step="any" value={v.default_target ?? ""} onChange={set("default_target")} /></Field>
        <Field label="Direction"><Select value={v.direction} onChange={set("direction")} options={opts(KPI_DIRECTIONS)} /></Field>
        <Field label="Scoring formula" hint={FORMULA_HELP[v.formula_type]}><Select value={v.formula_type} onChange={set("formula_type")} options={opts(KPI_FORMULAS)} /></Field>
        <Field label="Default weight (%)" hint="Suggested weight when assigned as a goal"><Input type="number" min={0} max={100} step="0.5" value={v.default_weight} onChange={set("default_weight")} /></Field>
        <div className="flex items-end pb-2"><Checkbox label="Active (available for new goals)" checked={v.active !== false} onChange={set("active")} /></div>
        <Field label="How it is measured" className="sm:col-span-2"><Textarea value={v.measurement ?? ""} maxLength={2000} onChange={set("measurement")} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea value={v.description ?? ""} maxLength={2000} onChange={set("description")} /></Field>
      </div>
      {sample !== null && <p className="text-xs text-slate-500">Example: an actual of 80% of the target scores <strong>{sample}</strong>.</p>}
    </ActionModal>
  );
}

export default function KpisTab({ ctx }) {
  const { notify } = useToast();
  const kpis = useHrQuery(() => listKpis(), []);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (kpis.data ?? []).filter((k) => !s || [k.name, k.category, k.unit].some((x) => x?.toLowerCase().includes(s)));
  }, [kpis.data, search]);
  return (
    <>
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search KPIs…" />
        {ctx.canManage && <Button onClick={() => setModal({})}><Plus className="h-4 w-4" aria-hidden="true" />New KPI template</Button>}
      </Toolbar>
      <DataTable caption="KPI templates" rows={kpis.data ? rows : null} loading={kpis.loading} error={kpis.error} onRetry={kpis.reload}
        emptyTitle="No KPI templates" emptyDescription={ctx.canManage ? "Define KPIs once, then assign them as goals with a target and weight." : undefined}
        columns={[
          { key: "name", header: "KPI", sortable: true, render: (k) => <div><p className="font-semibold text-[#101a3a]">{k.name}</p>{k.description && <p className="max-w-xs truncate text-xs text-slate-500">{k.description}</p>}</div> },
          { key: "category", header: "Category", sortable: true, render: (k) => k.category ?? "—" },
          { key: "unit", header: "Measure", render: (k) => <div><p>{k.unit ?? "—"}</p>{k.measurement && <p className="max-w-xs truncate text-xs text-slate-500">{k.measurement}</p>}</div> },
          { key: "default_target", header: "Target", render: (k) => k.default_target ?? "—" },
          { key: "default_weight", header: "Weight", render: (k) => `${Number(k.default_weight)}%` },
          { key: "formula_type", header: "Scoring", render: (k) => <span className="text-xs">{label(k.formula_type)} · {label(k.direction)}</span> },
          { key: "active", header: "Status", render: (k) => (k.active ? <Badge tone="green">active</Badge> : <Badge>inactive</Badge>) },
          ...(ctx.canManage ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (k) => <Button size="sm" variant="ghost" onClick={() => setModal({ row: k })}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button> }] : []),
        ]} />
      {modal && <KpiForm kpi={modal.row} onClose={() => setModal(null)} onSaved={(isNew) => { setModal(null); notify(isNew ? "KPI template created." : "KPI template saved."); kpis.reload(); }} />}
    </>
  );
}
