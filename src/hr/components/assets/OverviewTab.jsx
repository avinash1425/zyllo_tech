// Asset allocation overview: live counts from hr_asset_overview (no cached
// or client-computed totals), with category / employee / department /
// status / location / assignment-date filters.
import { useState } from "react";
import { AlertTriangle, Boxes, ClipboardCheck, PackageCheck, PackageOpen, RotateCcw, ShieldAlert, Timer, Wrench } from "lucide-react";
import { useHrQuery } from "@/lib/hr/client";
import { ASSET_STATUSES, assetOverview } from "@/lib/hr/assets";
import { toOptions } from "@/lib/hr/org";
import { Button, Card, DataTable, ErrorState, Field, Input, KpiCard, Select } from "@/hr/ui";
import { opts } from "./shared";

const EMPTY = { category: "", employee: "", department: "", status: "", location: "", from: "", to: "" };

export default function OverviewTab({ employees, org, types, onOpen }) {
  const [f, setF] = useState(EMPTY);
  const q = useHrQuery(() => assetOverview(f), [f.category, f.employee, f.department, f.status, f.location, f.from, f.to]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const d = q.data ?? {};
  const loading = q.loading && !q.data;
  const filtered = Object.values(f).some(Boolean);

  const kpis = [
    { label: "Total assets", value: d.total_assets, hint: d.total_units != null && d.total_units !== d.total_assets ? `${d.total_units} units incl. stock items` : undefined, icon: Boxes, tone: "navy", go: ["inventory"] },
    { label: "Assigned", value: d.assigned_assets, hint: d.assigned_units != null ? `${d.assigned_units} units with employees` : undefined, icon: PackageCheck, tone: "teal", go: ["assignments"] },
    { label: "Available", value: d.available_assets, icon: PackageOpen, tone: "green", go: ["inventory", { status: "available" }] },
    { label: "Under repair", value: d.under_repair, icon: Wrench, tone: "orange", go: ["inventory", { status: "in_repair" }] },
    { label: "Damaged", value: d.damaged_assets, hint: d.open_damage_reports != null ? `${d.open_damage_reports} open damage reports` : undefined, icon: ShieldAlert, tone: "red", go: ["damage"] },
    { label: "Pending handovers", value: d.pending_handovers, hint: d.pending_acknowledgements != null ? `${d.pending_acknowledgements} awaiting employee acknowledgement` : undefined, icon: ClipboardCheck, tone: "orange", go: ["handovers"] },
    { label: "Pending returns", value: d.pending_returns, hint: d.returns_awaiting_inspection != null ? `${d.returns_awaiting_inspection} received, awaiting inspection` : undefined, icon: RotateCcw, tone: "teal", go: ["returns"] },
    { label: "Overdue returns", value: d.overdue_returns, icon: Timer, tone: "red", go: ["assignments"] },
  ];

  return (
    <>
      <Card className="mb-4" title="Filters">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Asset category"><Select placeholder="All categories" value={f.category} onChange={set("category")} options={(types ?? []).map((t) => ({ value: t, label: t }))} /></Field>
          <Field label="Employee"><Select placeholder="All employees" value={f.employee} onChange={set("employee")} options={employees ?? []} /></Field>
          <Field label="Department"><Select placeholder="All departments" value={f.department} onChange={set("department")} options={toOptions(org?.departments)} /></Field>
          <Field label="Asset status"><Select placeholder="Any status" value={f.status} onChange={set("status")} options={opts(ASSET_STATUSES)} /></Field>
          <Field label="Location"><Select placeholder="All locations" value={f.location} onChange={set("location")} options={toOptions(org?.locations)} /></Field>
          <Field label="Assigned from"><Input type="date" value={f.from} onChange={set("from")} /></Field>
          <Field label="Assigned to"><Input type="date" value={f.to} min={f.from || undefined} onChange={set("to")} /></Field>
          <div className="flex items-end"><Button variant="secondary" onClick={() => setF(EMPTY)} disabled={!filtered}>Clear filters</Button></div>
        </div>
        {(f.employee || f.department || f.from || f.to) && (
          <p className="mt-2 text-xs text-slate-500">Employee, department and date filters limit counts to assets currently assigned to matching employees.</p>
        )}
      </Card>

      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((k) => <KpiCard key={k.label} label={k.label} value={k.value} hint={k.hint} icon={k.icon} tone={k.tone} loading={loading} onClick={() => onOpen(...k.go)} />)}
          </div>
          {d.warranty_expiring_30d > 0 && (
            <p className="mt-3 flex items-center gap-2 text-sm text-amber-800"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{d.warranty_expiring_30d} asset(s) have a warranty ending in the next 30 days.</p>
          )}
          <div className="mt-4">
            <DataTable caption="Assets by category" rows={d.by_category ?? (loading ? null : [])} loading={loading} rowKey="category" pageSize={20} emptyTitle="No assets match"
              columns={[
                { key: "category", header: "Category", render: (r) => <span className="font-medium">{r.category}</span> },
                { key: "total", header: "Total" },
                { key: "assigned", header: "Assigned" },
                { key: "available", header: "Available" },
              ]} />
          </div>
        </>
      )}
    </>
  );
}
