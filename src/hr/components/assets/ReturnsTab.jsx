// Return tracking: Requested -> Pending Handover -> Received -> Inspected ->
// Completed. Receipt closes the assignment; the asset stays "in inspection"
// until the inspection outcome (available / in repair / retired) is applied
// at completion.
import { useState } from "react";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import {
  ASSET_CONDITIONS, DAMAGE_CATEGORIES, DAMAGE_SEVERITIES, RETURN_OUTCOMES, RETURN_STATUSES, assetName, cancelReturn, completeReturn, inspectReturn, listReturns,
  receiveReturn, requestReturn, scheduleReturn,
} from "@/lib/hr/assets";
import { Button, Checkbox, DataTable, DescriptionList, Field, Input, Select, Textarea, Toolbar, useToast } from "@/hr/ui";
import { AccessoriesInput, AccessoryList, ActionModal, AssetDocuments, Pill, dueText, empText, label, opts, today } from "./shared";

/** HR starts a return for an active assignment (status Pending Handover). */
export function StartReturnModal({ assignment, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ reason: "", date: "" });
  return (
    <ActionModal title={`Start return · ${assignment.asset?.asset_tag ?? ""}`} submitLabel="Start return" onClose={onClose}
      onSubmit={async () => {
        if (v.reason.trim().length < 3) return { error: "Give a reason for the return." };
        if (v.date && v.date < today()) return { error: "The return date is in the past." };
        const res = await requestReturn(assignment.id, v.reason, v.date);
        if (res.error) return res;
        notify("Return started. The employee was asked to hand the equipment over."); onDone(); return {};
      }}>
      <p className="text-sm text-slate-600">Currently with <strong>{empText(assignment.employee)}</strong>.</p>
      <Field label="Reason" required><Textarea value={v.reason} maxLength={2000} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
      <Field label="Return by" hint="Optional"><Input type="date" min={today()} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
    </ActionModal>
  );
}

function StepModal({ ret: r, step, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({
    date: r.requested_return_date ?? "", note: "", returned: r.accessories_expected ?? [], condition: "", outcome: "", missing: r.missing_accessories ?? [],
    raiseDamage: false, damageCategory: "", damageSeverity: "", reason: "",
  });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const titles = { schedule: "Accept and schedule return", receive: "Record receipt", inspect: "Record inspection", complete: "Complete return", cancel: "Cancel return" };
  async function submit() {
    let res;
    if (step === "schedule") {
      if (v.date && v.date < today()) return { error: "The return date is in the past." };
      res = await scheduleReturn(r.id, v.date, v.note);
    } else if (step === "receive") {
      res = await receiveReturn(r.id, v.returned, v.note);
    } else if (step === "inspect") {
      if (!v.condition) return { error: "Record the condition." };
      if (!v.outcome) return { error: "Choose the outcome." };
      if (v.condition === "damaged" && v.outcome === "available") return { error: "A damaged asset cannot go straight back into stock." };
      const damage = v.condition === "damaged" || v.raiseDamage;
      if (damage && (!v.damageCategory || !v.damageSeverity)) return { error: "Choose the damage category and severity." };
      res = await inspectReturn(r.id, { condition: v.condition, outcome: v.outcome, notes: v.note, missingAccessories: v.missing,
        damageCategory: damage ? v.damageCategory : null, damageSeverity: damage ? v.damageSeverity : null });
    } else if (step === "complete") {
      res = await completeReturn(r.id, v.note);
    } else {
      if (!v.reason.trim()) return { error: "Give a reason for cancelling." };
      res = await cancelReturn(r.id, v.reason);
    }
    if (res.error) return res;
    notify({ schedule: "Return scheduled.", receive: "Receipt recorded. The asset is awaiting inspection.", inspect: "Inspection recorded.", complete: "Return completed.", cancel: "Return cancelled." }[step]);
    onDone(); return {};
  }
  const outcomes = (r.asset?.is_bulk ? RETURN_OUTCOMES.filter((o) => o !== "in_repair") : RETURN_OUTCOMES).filter((o) => !(v.condition === "damaged" && o === "available"));
  return (
    <ActionModal title={`${titles[step]} · ${r.asset?.asset_tag ?? ""}`} submitLabel={titles[step]} tone={step === "cancel" ? "danger" : step === "complete" ? "success" : "primary"} onClose={onClose} onSubmit={submit}>
      {step === "schedule" && <Field label="Hand over on" hint="Optional"><Input type="date" min={today()} value={v.date} onChange={set("date")} /></Field>}
      {step === "receive" && <>
        <p className="text-sm text-slate-600">Receiving closes the assignment. The asset is not available again until it is inspected and the return is completed.</p>
        <AccessoriesInput label="Accessories returned" hint={`Expected: ${(r.accessories_expected ?? []).join(", ") || "none"}`} value={v.returned} onChange={(a) => setV({ ...v, returned: a })} />
      </>}
      {step === "inspect" && <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Return condition" required><Select placeholder="Choose" value={v.condition} onChange={set("condition")} options={opts(ASSET_CONDITIONS)} /></Field>
          <Field label="Outcome" required hint="Applied when the return is completed"><Select placeholder="Choose" value={v.outcome} onChange={set("outcome")} options={opts(outcomes)} /></Field>
        </div>
        <AccessoriesInput label="Missing accessories" hint="Pre-filled from receipt; adjust if needed" value={v.missing} onChange={(a) => setV({ ...v, missing: a })} />
        {v.condition !== "damaged" && <Checkbox label="Raise a damage report" checked={v.raiseDamage} onChange={set("raiseDamage")} />}
        {(v.condition === "damaged" || v.raiseDamage) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Damage category" required><Select placeholder="Choose" value={v.damageCategory} onChange={set("damageCategory")} options={opts(DAMAGE_CATEGORIES)} /></Field>
            <Field label="Severity" required><Select placeholder="Choose" value={v.damageSeverity} onChange={set("damageSeverity")} options={opts(DAMAGE_SEVERITIES)} /></Field>
          </div>
        )}
      </>}
      {step === "complete" && (
        <p className="text-sm text-slate-600">The inspection outcome <strong>{label(r.outcome)}</strong> will be applied to the asset{r.outcome === "retired" && r.asset?.is_bulk ? " (units written off)" : ""}.</p>
      )}
      {step === "cancel"
        ? <Field label="Reason" required><Textarea value={v.reason} maxLength={2000} onChange={set("reason")} /></Field>
        : <Field label={step === "inspect" ? "Inspection notes" : "Note (optional)"}><Textarea value={v.note} maxLength={2000} onChange={set("note")} /></Field>}
    </ActionModal>
  );
}

const STEP_FOR = { requested: ["schedule", "receive", "cancel"], pending_handover: ["receive", "cancel"], received: ["inspect"], inspected: ["complete"] };
const STEP_LABEL = { schedule: "Accept & schedule", receive: "Record receipt", inspect: "Inspect", complete: "Complete", cancel: "Cancel" };

export function ReturnDetail({ ret: r, canManage, myEmployeeId, onClose, onDone, employeeView = false }) {
  const [step, setStep] = useState(null);
  const own = r.employee_id === myEmployeeId;
  const steps = canManage && !employeeView && !own ? STEP_FOR[r.status] ?? [] : [];
  if (step) return <StepModal ret={r} step={step} onClose={() => setStep(null)} onDone={onDone} />;
  return (
    <ActionModal title={`Return · ${r.asset?.asset_tag ?? ""}`} size="lg" hideSubmit onClose={onClose}>
      <DescriptionList items={[
        { label: "Asset", value: `${assetName(r.asset)} · ${r.asset?.asset_type ?? ""}` },
        { label: "Employee", value: empText(r.employee) },
        { label: "Status", value: <Pill kind="return" value={r.status} /> },
        { label: "Source", value: label(r.source) },
        { label: "Reason", value: r.reason },
        { label: "Requested", value: formatDateTime(r.requested_at) },
        { label: "Requested return date", value: dueText(r.requested_return_date) },
        { label: "Actual return", value: r.received_at ? formatDateTime(r.received_at) : null },
        { label: "Accessories expected", value: <AccessoryList items={r.accessories_expected} /> },
        { label: "Accessories returned", value: r.received_at ? <AccessoryList items={r.accessories_returned} /> : null },
        { label: "Missing accessories", value: r.missing_accessories?.length ? <span className="font-semibold text-rose-700">{r.missing_accessories.join(", ")}</span> : r.received_at ? "None" : null },
        { label: "Return condition", value: r.return_condition ? label(r.return_condition) : null },
        { label: "Outcome", value: r.outcome ? label(r.outcome) : null },
        r.inspection_notes && { label: "Inspection notes", value: r.inspection_notes },
        { label: "Employee confirmation", value: r.employee_acknowledged_at ? formatDateTime(r.employee_acknowledged_at) : r.received_at ? "Not yet confirmed" : null },
        r.completed_at && { label: "Completed", value: formatDateTime(r.completed_at) },
        r.cancel_reason && { label: "Cancelled", value: r.cancel_reason },
      ]} />
      <AssetDocuments kind="return_confirmation" recordId={r.id} employeeId={r.employee_id} canAttach={canManage && !employeeView && r.status !== "cancelled"} />
      {steps.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {steps.map((s) => <Button key={s} variant={s === "cancel" ? "secondary" : "primary"} onClick={() => setStep(s)}>{STEP_LABEL[s]}</Button>)}
        </div>
      )}
      {canManage && own && !employeeView && STEP_FOR[r.status] && <p className="text-xs text-slate-500">Another asset manager must process the return of your equipment.</p>}
    </ActionModal>
  );
}

export default function ReturnsTab({ canManage, employees, myEmployeeId }) {
  const [f, setF] = useState({ status: "open", employee: "" });
  const [selected, setSelected] = useState(null);
  const list = useHrQuery(() => listReturns(f), [f.status, f.employee]);
  return (
    <>
      <Toolbar>
        <Select aria-label="Return status" className="sm:w-52" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}
          options={[{ value: "open", label: "Open returns" }, ...opts(RETURN_STATUSES), { value: "", label: "All" }]} />
        <Select aria-label="Employee" className="sm:w-64" placeholder="All employees" value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })} options={employees ?? []} />
      </Toolbar>
      <DataTable caption="Asset returns" rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload} onRowClick={setSelected}
        emptyTitle="No returns" emptyDescription="Start a return from an assignment, or employees request one from their portal."
        columns={[
          { key: "asset", header: "Asset", render: (r) => <div className="min-w-[9rem]"><p className="font-mono text-xs font-bold text-[#1f4693]">{r.asset?.asset_tag}</p><p className="text-xs text-slate-500">{assetName(r.asset)}</p></div> },
          { key: "employee", header: "Employee", render: (r) => empText(r.employee) },
          { key: "source", header: "Source", render: (r) => label(r.source) },
          { key: "requested_return_date", header: "Return by", render: (r) => (["requested", "pending_handover"].includes(r.status) ? dueText(r.requested_return_date) : formatDate(r.requested_return_date)) },
          { key: "received_at", header: "Received", render: (r) => formatDate(r.received_at) },
          { key: "missing_accessories", header: "Missing", render: (r) => (r.missing_accessories?.length ? <span className="text-rose-700">{r.missing_accessories.join(", ")}</span> : "—") },
          { key: "status", header: "Status", render: (r) => <Pill kind="return" value={r.status} /> },
        ]} />
      {selected && <ReturnDetail ret={selected} canManage={canManage} myEmployeeId={myEmployeeId} onClose={() => setSelected(null)} onDone={() => { setSelected(null); list.reload(); }} />}
    </>
  );
}
