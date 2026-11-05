// Damage reports: Reported -> Under Review -> Under Repair -> Resolved.
// Evidence lives in Module 9 documents. Resolved reports are read-only.
// No salary deduction is created here: any recovery must follow an approved
// company policy through the authorised payroll workflow.
import { useState } from "react";
import { formatDate, formatDateTime, formatMoney, useHrQuery } from "@/lib/hr/client";
import {
  ASSET_CONDITIONS, DAMAGE_CATEGORIES, DAMAGE_SEVERITIES, DAMAGE_STATUSES, advanceDamageReport, assetName, listAssets, listDamageReports, submitDamageReport,
} from "@/lib/hr/assets";
import { Button, DataTable, DescriptionList, Field, Input, Select, Textarea, Toolbar, useToast } from "@/hr/ui";
import { ActionModal, AssetDocuments, Pill, empText, label, opts, today } from "./shared";

const NEXT = { reported: ["under_review"], under_review: ["under_repair", "resolved"], under_repair: ["resolved"], resolved: [] };

export function DamageForm({ assignment = null, asset = null, assetChoices = null, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ asset: asset?.id ?? "", incidentDate: today(), category: "", severity: "", description: "" });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <ActionModal title={`Report damage${asset?.asset_tag ? ` · ${asset.asset_tag}` : ""}`} submitLabel="Submit report" tone="danger" onClose={onClose}
      onSubmit={async () => {
        const errs = {};
        if (!assignment && !v.asset) errs.asset = "Choose the asset.";
        if (!v.incidentDate || v.incidentDate > today()) errs.incidentDate = "The incident date must be today or earlier.";
        if (!v.category) errs.category = "Choose a category.";
        if (!v.severity) errs.severity = "Choose a severity.";
        if (v.description.trim().length < 3) errs.description = "Describe what happened (at least 3 characters).";
        setErrors(errs);
        if (Object.keys(errs).length) return { error: "Fix the highlighted fields." };
        const res = await submitDamageReport({ assignment: assignment?.id ?? null, asset: v.asset, ...v });
        if (res.error) return res;
        notify("Damage reported. Add photos from the report to support it."); onDone(res.data); return {};
      }}>
      {assetChoices && <Field label="Asset" required error={errors.asset}><Select placeholder="Choose an asset" value={v.asset} onChange={set("asset")} options={assetChoices} /></Field>}
      <Field label="Incident date" required error={errors.incidentDate}><Input type="date" max={today()} value={v.incidentDate} onChange={set("incidentDate")} /></Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Damage category" required error={errors.category}><Select placeholder="Choose" value={v.category} onChange={set("category")} options={opts(DAMAGE_CATEGORIES)} /></Field>
        <Field label="Severity" required error={errors.severity}><Select placeholder="Choose" value={v.severity} onChange={set("severity")} options={opts(DAMAGE_SEVERITIES)} /></Field>
      </div>
      <Field label="What happened?" required error={errors.description}><Textarea value={v.description} maxLength={2000} onChange={set("description")} /></Field>
    </ActionModal>
  );
}

function AdvanceModal({ report: r, status, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ notes: "", repairDetails: r.repair_details ?? "", repairCost: "", conditionAfter: status === "resolved" && r.status === "under_repair" ? "good" : "" });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <ActionModal title={`Move to ${label(status)}`} submitLabel={`Mark ${label(status)}`} tone={status === "resolved" ? "success" : "primary"} onClose={onClose}
      onSubmit={async () => {
        if (status === "resolved" && !v.notes.trim()) return { error: "Record resolution notes." };
        if (v.repairCost !== "" && !(Number(v.repairCost) >= 0)) return { error: "Repair cost must be zero or more." };
        const res = await advanceDamageReport(r.id, { status, ...v });
        if (res.error) return res;
        notify(`Damage report ${label(status)}.`); onDone(); return {};
      }}>
      {status !== "under_repair" && <Field label={status === "resolved" ? "Resolution notes" : "Review notes"} required={status === "resolved"}><Textarea value={v.notes} maxLength={2000} onChange={set("notes")} /></Field>}
      {status !== "under_review" && <Field label="Repair details"><Textarea value={v.repairDetails} maxLength={2000} onChange={set("repairDetails")} /></Field>}
      {status === "resolved" && <>
        <Field label="Repair cost (INR)" hint="Recorded for the asset history only. Nothing is deducted from salary."><Input type="number" min={0} step="0.01" value={v.repairCost} onChange={set("repairCost")} /></Field>
        <Field label="Condition after resolution" hint="Optional"><Select placeholder="Unchanged" value={v.conditionAfter} onChange={set("conditionAfter")} options={opts(ASSET_CONDITIONS)} /></Field>
      </>}
    </ActionModal>
  );
}

export function DamageDetail({ report: r, canManage, myEmployeeId, onClose, onDone, employeeView = false }) {
  const [advance, setAdvance] = useState(null);
  const isOwnAsset = r.employee_id && r.employee_id === myEmployeeId;
  const next = canManage && !isOwnAsset && !employeeView ? NEXT[r.status] : [];
  if (advance) return <AdvanceModal report={r} status={advance} onClose={() => setAdvance(null)} onDone={onDone} />;
  return (
    <ActionModal title={`Damage report · ${r.asset?.asset_tag ?? ""}`} size="lg" hideSubmit onClose={onClose}>
      <DescriptionList items={[
        { label: "Asset", value: `${assetName(r.asset)} · ${r.asset?.asset_type ?? ""}` },
        { label: "Status", value: <Pill kind="damage" value={r.status} /> },
        { label: "Employee (holder)", value: empText(r.employee) },
        { label: "Reported by", value: r.reporter ? empText(r.reporter) : "HR/IT" },
        { label: "Incident date", value: formatDate(r.incident_date) },
        { label: "Reported", value: formatDateTime(r.created_at) },
        { label: "Category", value: label(r.damage_category) },
        { label: "Severity", value: <Pill kind="severity" value={r.severity} /> },
        { label: "Description", value: r.description },
        r.review_notes && { label: "Review notes", value: r.review_notes },
        r.repair_details && { label: "Repair details", value: r.repair_details },
        r.repair_cost != null && { label: "Repair cost", value: formatMoney(r.repair_cost) },
        r.resolution_date && { label: "Resolved", value: formatDate(r.resolution_date) },
        r.resolution_notes && { label: "Resolution notes", value: r.resolution_notes },
      ]} />
      <AssetDocuments kind="damage_evidence" recordId={r.id} employeeId={r.employee_id ?? r.reporter_employee_id}
        canAttach={Boolean(r.employee_id ?? r.reporter_employee_id) && (employeeView ? r.status === "reported" : canManage && r.status !== "resolved")} />
      {r.status === "resolved" && <p className="text-xs text-slate-500">Resolved reports are final and cannot be edited.</p>}
      {!employeeView && <p className="text-xs text-slate-500">Damage costs are never deducted automatically. Any recovery must follow approved company policy through the payroll approval workflow.</p>}
      {next.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {next.map((s) => <Button key={s} variant={s === "resolved" ? "success" : "primary"} onClick={() => setAdvance(s)}>Move to {label(s)}</Button>)}
        </div>
      )}
      {canManage && isOwnAsset && !employeeView && r.status !== "resolved" && <p className="text-xs text-slate-500">Another asset manager must handle damage on equipment assigned to you.</p>}
    </ActionModal>
  );
}

export default function DamageTab({ canManage, myEmployeeId }) {
  const [status, setStatus] = useState("open");
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const list = useHrQuery(() => listDamageReports({ status }), [status]);
  const assets = useHrQuery(() => (adding ? listAssets() : Promise.resolve({ data: [] })), [adding]);
  const choices = (assets.data ?? []).filter((a) => !["retired", "disposed", "lost"].includes(a.status)).map((a) => ({ value: a.id, label: `${a.asset_tag} · ${assetName(a)}` }));
  return (
    <>
      <Toolbar>
        <Select aria-label="Report status" className="sm:w-52" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: "open", label: "Open (not resolved)" }, ...opts(DAMAGE_STATUSES), { value: "", label: "All" }]} />
        {canManage && <Button onClick={() => setAdding(true)}>Report damage</Button>}
      </Toolbar>
      <DataTable caption="Damage reports" rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload} onRowClick={setSelected}
        emptyTitle="No damage reports"
        columns={[
          { key: "asset", header: "Asset", render: (r) => <div className="min-w-[9rem]"><p className="font-mono text-xs font-bold text-[#1f4693]">{r.asset?.asset_tag}</p><p className="text-xs text-slate-500">{assetName(r.asset)}</p></div> },
          { key: "employee", header: "Holder", render: (r) => empText(r.employee) },
          { key: "incident_date", header: "Incident", sortable: true, render: (r) => formatDate(r.incident_date) },
          { key: "damage_category", header: "Category", render: (r) => label(r.damage_category) },
          { key: "severity", header: "Severity", render: (r) => <Pill kind="severity" value={r.severity} /> },
          { key: "status", header: "Status", render: (r) => <Pill kind="damage" value={r.status} /> },
          { key: "repair_cost", header: "Repair cost", render: (r) => (r.repair_cost != null ? formatMoney(r.repair_cost) : "—") },
        ]} />
      {selected && <DamageDetail report={selected} canManage={canManage} myEmployeeId={myEmployeeId} onClose={() => setSelected(null)} onDone={() => { setSelected(null); list.reload(); }} />}
      {adding && <DamageForm assetChoices={choices} onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} />}
    </>
  );
}
