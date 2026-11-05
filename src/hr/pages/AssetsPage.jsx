// Module 11 — Asset Allocation (HR): overview, asset register (add/edit,
// detail with assignment history and chronological asset history), employee
// assignments, handover queue, damage reports, return tracking and employee
// asset requests. Status changes go through SECURITY DEFINER RPCs; master
// fields are direct table writes allowed by RLS for assets.manage. Purchase
// cost is only loaded / shown / edited with assets.view_cost.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowRightLeft, ClipboardCheck, Download, PackageCheck, PackagePlus, Pencil, Plus, RotateCcw, ShieldAlert, Undo2, Wrench } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { exportCsv, formatDate, formatMoney, useHrQuery } from "@/lib/hr/client";
import {
  ASSET_CATEGORIES, ASSET_CONDITIONS, ASSET_STATUSES, ASSET_TAG_PATTERN, REQUEST_STATUSES, SETTABLE_STATUSES, assetLabel, assignAsset,
  decideAssetRequest, fulfillAssetRequest, getAsset, getAssetAssignments, getAssetCosts, getAssetEvents, getHandoverForAssignment, listAssetRequests,
  listAssets, listAssetTypes, listAssignments, logAssetMaintenance, returnAsset, saveAsset, setAssetStatus, transferAsset,
} from "@/lib/hr/assets";
import { toOptions, useEmployeeOptions, useOrg } from "@/lib/hr/org";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, DescriptionList, EmptyState, ErrorState, Field, InlineError, Input, Loading,
  Modal, PageHeader, SearchInput, Select, StatusBadge, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";
import { AccessoriesInput, AccessoryList, ActionModal, AssetHistory, AssetStatus, dueText, empText, label, opts, today } from "@/hr/components/assets/shared";
import OverviewTab from "@/hr/components/assets/OverviewTab";
import HandoversTab, { HandoverDetail } from "@/hr/components/assets/HandoversTab";
import DamageTab, { DamageForm } from "@/hr/components/assets/DamageTab";
import ReturnsTab, { StartReturnModal } from "@/hr/components/assets/ReturnsTab";

const TABS = ["overview", "inventory", "assignments", "handovers", "damage", "returns", "requests"];

// ------------------------------------------------------------------ forms
function AssetFormModal({ asset, locations, canCost, onClose, onSaved }) {
  const isNew = !asset?.id;
  const [v, setV] = useState(() => ({
    asset_tag: "", asset_type: "", category: "", brand: "", model: "", serial_number: "", purchase_date: "", purchase_cost: "",
    warranty_expiry: "", condition: "new", location_id: "", storage_location: "", notes: "", is_bulk: false, quantity: 1, status: "available",
    ...(asset ?? {}),
  }));
  const [errors, setErrors] = useState({});
  const [costLoaded, setCostLoaded] = useState(isNew || !canCost);
  const [originalCost, setOriginalCost] = useState(null);
  useEffect(() => {
    if (isNew || !canCost) return;
    getAssetCosts([asset.id]).then((res) => {
      if (!res.error) { setV((s) => ({ ...s, purchase_cost: res.data[asset.id] ?? "" })); setOriginalCost(res.data[asset.id] ?? null); }
      setCostLoaded(!res.error);
    });
  }, [isNew, canCost, asset?.id]);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  async function submit() {
    const errs = {};
    if (!ASSET_TAG_PATTERN.test(v.asset_tag ?? "")) errs.asset_tag = "2–40 characters: letters, digits, _ . / - (must start with a letter or digit).";
    if ((v.asset_type ?? "").trim().length < 2) errs.asset_type = "Asset category is required (2–60 characters).";
    if (canCost && v.purchase_cost !== "" && v.purchase_cost != null && !(Number(v.purchase_cost) >= 0)) errs.purchase_cost = "Cost must be zero or more.";
    if (v.warranty_expiry && v.purchase_date && v.warranty_expiry < v.purchase_date) errs.warranty_expiry = "Warranty cannot end before the purchase date.";
    if (v.is_bulk && !(Number(v.quantity) >= 1)) errs.quantity = "Quantity must be at least 1.";
    setErrors(errs);
    if (Object.keys(errs).length) return { error: "Fix the highlighted fields." };
    const res = await saveAsset(v, asset?.id, { canCost: canCost && costLoaded, originalCost });
    if (res.error && !res.data) return { error: /duplicate|unique/i.test(res.error) ? "Another asset already uses this asset ID or serial number." : res.error };
    if (res.error) return { error: res.error };   // master data saved; cost update refused
    onSaved(isNew);
    return {};
  }
  return (
    <ActionModal title={isNew ? "Add asset" : `Edit ${asset.asset_tag}`} onClose={onClose} onSubmit={submit} size="lg" submitLabel={isNew ? "Add asset" : "Save"}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Asset ID (tag)" required error={errors.asset_tag}><Input value={v.asset_tag} onChange={set("asset_tag")} placeholder="e.g. ZT-LAP-0001" maxLength={40} /></Field>
        <Field label="Asset category" required error={errors.asset_type} hint="Choose or type a category">
          <Input value={v.asset_type} onChange={set("asset_type")} maxLength={60} list="asset-category-options" />
        </Field>
        <datalist id="asset-category-options">{ASSET_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        <Field label="Asset name / sub-category" hint="e.g. Developer laptop, 27-inch monitor"><Input value={v.category ?? ""} onChange={set("category")} maxLength={60} /></Field>
        <Field label="Brand"><Input value={v.brand ?? ""} onChange={set("brand")} maxLength={80} /></Field>
        <Field label="Model"><Input value={v.model ?? ""} onChange={set("model")} maxLength={120} /></Field>
        <Field label="Serial number" hint="Must be unique when given"><Input value={v.serial_number ?? ""} onChange={set("serial_number")} maxLength={120} /></Field>
        <Field label="Purchase date"><Input type="date" value={v.purchase_date ?? ""} onChange={set("purchase_date")} /></Field>
        {canCost
          ? <Field label="Purchase cost (INR)" error={errors.purchase_cost} hint={!costLoaded ? "Loading…" : "Visible only to roles with assets.view_cost"}><Input type="number" min={0} step="0.01" disabled={!costLoaded} value={v.purchase_cost ?? ""} onChange={set("purchase_cost")} /></Field>
          : <Field label="Purchase cost" hint="Restricted to authorised roles"><Input value="Restricted" disabled /></Field>}
        <Field label="Warranty expiry" error={errors.warranty_expiry}><Input type="date" value={v.warranty_expiry ?? ""} onChange={set("warranty_expiry")} /></Field>
        <Field label="Condition"><Select value={v.condition} onChange={set("condition")} options={opts(ASSET_CONDITIONS)} /></Field>
        <Field label="Office location"><Select placeholder="— None —" value={v.location_id ?? ""} onChange={set("location_id")} options={toOptions(locations)} /></Field>
        <Field label="Storage location" hint="e.g. IT cabinet A, shelf 2"><Input value={v.storage_location ?? ""} onChange={set("storage_location")} maxLength={120} /></Field>
        {isNew && <Field label="Initial status"><Select value={v.status} onChange={set("status")} options={[{ value: "available", label: "Available" }, { value: "in_repair", label: "In repair" }]} /></Field>}
        <div className="sm:col-span-2"><Checkbox label="Quantity-tracked accessory (e.g. headsets, cables)" checked={Boolean(v.is_bulk)} onChange={set("is_bulk")} /></div>
        {v.is_bulk && <Field label="Quantity in stock" required error={errors.quantity}><Input type="number" min={1} value={v.quantity} onChange={set("quantity")} /></Field>}
        <Field label="Notes" className="sm:col-span-2"><Textarea value={v.notes ?? ""} onChange={set("notes")} maxLength={2000} /></Field>
      </div>
      <p className="text-xs text-slate-500">{isNew ? "Warranty and purchase documents can be kept with the employee's documents once assigned." : "Status is changed through assign, return, repair and status actions, never here."}</p>
    </ActionModal>
  );
}

function AssignModal({ asset, employees, remaining, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ employee: "", expectedReturn: "", notes: "", quantity: 1, reason: "", accessories: [], issuedCondition: asset.condition });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <ActionModal title={`Assign ${asset.asset_tag}`} submitLabel="Assign" size="md" onClose={onClose}
      onSubmit={async () => {
        if (!v.employee) return { error: "Choose an employee." };
        if (v.expectedReturn && v.expectedReturn < today()) return { error: "The expected return date is in the past." };
        if (asset.is_bulk && !(Number(v.quantity) >= 1 && Number(v.quantity) <= remaining)) return { error: `Quantity must be between 1 and ${remaining}.` };
        const res = await assignAsset({ asset: asset.id, ...v, quantity: asset.is_bulk ? v.quantity : 1 });
        if (res.error) return res;
        notify(`${asset.asset_tag} assigned. The employee was asked to acknowledge the handover.`); onDone(); return {};
      }}>
      <Field label="Employee" required><Select placeholder="Choose an employee" value={v.employee} onChange={set("employee")} options={employees ?? []} /></Field>
      <Field label="Assignment reason" hint="e.g. Onboarding, Replacement, Project"><Input value={v.reason} maxLength={500} onChange={set("reason")} /></Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {asset.is_bulk && <Field label={`Quantity (available: ${remaining})`} required><Input type="number" min={1} max={remaining} value={v.quantity} onChange={set("quantity")} /></Field>}
        <Field label="Issued condition"><Select value={v.issuedCondition} onChange={set("issuedCondition")} options={opts(ASSET_CONDITIONS)} /></Field>
        <Field label="Expected return date" hint="Optional"><Input type="date" min={today()} value={v.expectedReturn} onChange={set("expectedReturn")} /></Field>
      </div>
      {!asset.is_bulk && <AccessoriesInput label="Accessories issued with it" value={v.accessories} onChange={(a) => setV((s) => ({ ...s, accessories: a }))} />}
      <Field label="Assignment notes"><Textarea value={v.notes} onChange={set("notes")} maxLength={2000} /></Field>
      <p className="text-xs text-slate-500">A handover record with the default checklist is created. The employee acknowledges receipt in their portal; HR/IT confirms afterwards.</p>
    </ActionModal>
  );
}

function TransferModal({ assignment, employees, onClose, onDone }) {
  const { notify } = useToast();
  const [to, setTo] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <ActionModal title={`Reassign ${assignment.asset?.asset_tag ?? "asset"}`} submitLabel="Reassign" onClose={onClose}
      onSubmit={async () => {
        if (!to) return { error: "Choose the employee receiving the asset." };
        const res = await transferAsset(assignment.id, to, notes);
        if (res.error) return res;
        notify("Asset reassigned. A new handover was created."); onDone(); return {};
      }}>
      <p className="text-sm text-slate-600">Currently with <strong>{empText(assignment.employee)}</strong>. Their assignment is closed (kept in history) and a new one with its own handover is opened. Use a return instead if the asset should be inspected first.</p>
      <Field label="Reassign to" required><Select placeholder="Choose an employee" value={to} onChange={(e) => setTo(e.target.value)} options={(employees ?? []).filter((o) => o.value !== assignment.employee_id)} /></Field>
      <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></Field>
    </ActionModal>
  );
}

function QuickReturnModal({ assignment, onClose, onDone }) {
  const { notify } = useToast();
  const [condition, setCondition] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <ActionModal title={`Quick return · ${assignment.asset?.asset_tag ?? "asset"}`} submitLabel="Receive and inspect" onClose={onClose}
      onSubmit={async () => {
        if (!condition) return { error: "Record the condition of the returned asset." };
        const res = await returnAsset(assignment.id, condition, notes);
        if (res.error) return res;
        notify("Return received, inspected and completed."); onDone(); return {};
      }}>
      <p className="text-sm text-slate-600">For equipment handed back in person by <strong>{empText(assignment.employee)}</strong>: records receipt, your inspection and completion in one step. A damaged asset goes to repair with a damage report.</p>
      <Field label="Condition found on inspection" required><Select placeholder="Choose condition" value={condition} onChange={(e) => setCondition(e.target.value)} options={opts(ASSET_CONDITIONS)} /></Field>
      <Field label="Inspection notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></Field>
    </ActionModal>
  );
}

function MaintenanceModal({ asset, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ details: "", cost: "", complete: asset.status === "in_repair", condition: "" });
  return (
    <ActionModal title={`Maintenance · ${asset.asset_tag}`} submitLabel="Log maintenance" onClose={onClose}
      onSubmit={async () => {
        if (!v.details.trim()) return { error: "Describe the maintenance work." };
        if (v.cost !== "" && !(Number(v.cost) >= 0)) return { error: "Cost must be zero or more." };
        const res = await logAssetMaintenance({ asset: asset.id, ...v });
        if (res.error) return res;
        notify(v.complete ? "Repair completed and logged." : "Maintenance logged."); onDone(); return {};
      }}>
      <Field label="Work done / issue" required><Textarea value={v.details} onChange={(e) => setV({ ...v, details: e.target.value })} maxLength={2000} /></Field>
      <Field label="Cost (INR)"><Input type="number" min={0} step="0.01" value={v.cost} onChange={(e) => setV({ ...v, cost: e.target.value })} /></Field>
      <Checkbox label="Repair completed (asset returns to service)" checked={v.complete} onChange={(e) => setV({ ...v, complete: e.target.checked })} />
      <Field label="Condition after work" hint="Optional"><Select placeholder="Unchanged" value={v.condition} onChange={(e) => setV({ ...v, condition: e.target.value })} options={opts(ASSET_CONDITIONS)} /></Field>
      {!v.complete && asset.status === "available" && <p className="text-xs text-slate-500">An available asset moves to <em>in repair</em> until the repair is completed.</p>}
      <p className="text-xs text-slate-500">For damage, prefer a damage report: it tracks review, repair and resolution.</p>
    </ActionModal>
  );
}

function StatusModal({ asset, onClose, onDone }) {
  const { notify } = useToast();
  const [status, setStatus] = useState("");
  const [details, setDetails] = useState("");
  const choices = SETTABLE_STATUSES.filter((s) => s !== asset.status && (s !== "available" || ["in_repair", "lost"].includes(asset.status)));
  return (
    <ActionModal title={`Change status · ${asset.asset_tag}`} submitLabel="Change status" tone="danger" onClose={onClose}
      onSubmit={async () => {
        if (!status) return { error: "Choose a status." };
        const res = await setAssetStatus(asset.id, status, details);
        if (res.error) return res;
        notify(`Asset marked ${label(status)}.`); onDone(); return {};
      }}>
      <Field label="New status" required><Select placeholder="Choose a status" value={status} onChange={(e) => setStatus(e.target.value)} options={opts(choices)} /></Field>
      <Field label="Details"><Textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} /></Field>
      <p className="text-xs text-slate-500">Retired and disposed assets must be returned (and inspected) first. Marking an assigned asset lost closes its assignment and notifies the employee. History is always kept.</p>
    </ActionModal>
  );
}

function HandoverLoader({ assignmentId, canManage, myEmployeeId, onClose, onDone }) {
  const q = useHrQuery(() => getHandoverForAssignment(assignmentId), [assignmentId]);
  if (q.loading && !q.data) return <Modal open onClose={onClose} title="Handover" size="sm"><Loading /></Modal>;
  if (q.error || !q.data) {
    return <ActionModal title="Handover" hideSubmit onClose={onClose}>{q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : <p className="text-sm text-slate-600">This assignment predates handover records. Its acknowledgement is shown in the assignment list.</p>}</ActionModal>;
  }
  return <HandoverDetail handover={q.data} canManage={canManage} myEmployeeId={myEmployeeId} onClose={onClose} onDone={onDone} />;
}

function AssignmentActions({ row, canManage, setModal }) {
  if (!canManage || row.status !== "active") return null;
  return (
    <span className="flex flex-wrap gap-1">
      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setModal({ type: "handover", assignment: row }); }}><ClipboardCheck className="h-4 w-4" aria-hidden="true" />Handover</Button>
      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setModal({ type: "start_return", assignment: row }); }}><Undo2 className="h-4 w-4" aria-hidden="true" />Start return</Button>
      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setModal({ type: "return", assignment: row }); }}><RotateCcw className="h-4 w-4" aria-hidden="true" />Quick return</Button>
      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setModal({ type: "transfer", assignment: row }); }}><ArrowRightLeft className="h-4 w-4" aria-hidden="true" />Reassign</Button>
    </span>
  );
}

function AssignmentModals({ modal, setModal, employees, canManage, myEmployeeId, done }) {
  if (!modal) return null;
  const close = () => setModal(null);
  if (modal.type === "transfer") return <TransferModal assignment={modal.assignment} employees={employees} onClose={close} onDone={done} />;
  if (modal.type === "return") return <QuickReturnModal assignment={modal.assignment} onClose={close} onDone={done} />;
  if (modal.type === "start_return") return <StartReturnModal assignment={modal.assignment} onClose={close} onDone={done} />;
  if (modal.type === "handover") return <HandoverLoader assignmentId={modal.assignment.id} canManage={canManage} myEmployeeId={myEmployeeId} onClose={close} onDone={done} />;
  return null;
}

// ---------------------------------------------------------- asset detail
function AssetDetail({ assetId, canManage, canCost, employees, locations, myEmployeeId, onClose, onChanged }) {
  const { notify } = useToast();
  const asset = useHrQuery(() => getAsset(assetId), [assetId]);
  const asg = useHrQuery(() => getAssetAssignments(assetId), [assetId]);
  const events = useHrQuery(() => getAssetEvents(assetId), [assetId]);
  const cost = useHrQuery(() => (canCost ? getAssetCosts([assetId]) : Promise.resolve({ data: {} })), [assetId, canCost]);
  const [modal, setModal] = useState(null);   // { type, assignment? }
  const reload = () => { asset.reload(); asg.reload(); events.reload(); cost.reload(); onChanged(); };
  const done = () => { setModal(null); reload(); };
  const a = asset.data;
  const active = (asg.data ?? []).filter((x) => x.status === "active");
  const used = active.reduce((n, x) => n + x.quantity, 0);
  const remaining = a ? a.quantity - used : 0;
  const canAssign = a && ["available", "assigned"].includes(a.status) && remaining > 0;
  const inService = a && !["retired", "lost", "disposed"].includes(a.status);
  const purchaseCost = cost.data?.[assetId];
  const withAsset = (r) => ({ ...r, asset: a });

  return (
    <>
      <Modal open onClose={onClose} title={a ? `${a.asset_tag} · ${a.asset_type}` : "Asset"} size="xl"
        footer={<>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {canManage && a && <>
            <Button variant="secondary" onClick={() => setModal({ type: "edit" })}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>
            <Button variant="secondary" onClick={() => setModal({ type: "status" })}>Change status</Button>
            {inService && <Button variant="secondary" onClick={() => setModal({ type: "damage" })}><ShieldAlert className="h-4 w-4" aria-hidden="true" />Report damage</Button>}
            {inService && <Button variant="secondary" onClick={() => setModal({ type: "maintenance" })}><Wrench className="h-4 w-4" aria-hidden="true" />Maintenance</Button>}
            {canAssign && <Button onClick={() => setModal({ type: "assign" })}><PackagePlus className="h-4 w-4" aria-hidden="true" />Assign</Button>}
          </>}
        </>}>
        {asset.loading && !a ? <Loading /> : asset.error ? <ErrorState message={asset.error} onRetry={asset.reload} /> : !a ? <EmptyState title="Asset not found" /> : (
          <div className="flex flex-col gap-5">
            {a.status === "in_inspection" && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Returned and awaiting inspection. Complete the return in <strong>Returns</strong> before it can be reassigned.</p>}
            <DescriptionList items={[
              { label: "Status", value: <AssetStatus status={a.status} /> },
              { label: "Condition", value: label(a.condition) },
              { label: "Brand / model", value: [a.brand, a.model].filter(Boolean).join(" ") || null },
              { label: "Serial number", value: a.serial_number },
              { label: "Name / sub-category", value: a.category },
              { label: "Office location", value: a.location?.name },
              { label: "Storage location", value: a.storage_location },
              { label: "Purchased", value: formatDate(a.purchase_date) },
              canCost && { label: "Purchase cost", value: cost.error ? "Unavailable" : purchaseCost != null ? formatMoney(purchaseCost) : null },
              { label: "Warranty until", value: a.warranty_expiry ? dueText(a.warranty_expiry) : null },
              a.is_bulk && { label: "Stock", value: `${a.quantity} total · ${used} assigned · ${remaining} available` },
              a.notes && { label: "Notes", value: a.notes },
            ]} />
            <section>
              <h3 className="mb-2 text-sm font-bold text-[#101a3a]">Assignment history</h3>
              <DataTable caption="Assignment history" rows={asg.data} loading={asg.loading} error={asg.error} onRetry={asg.reload} pageSize={10} emptyTitle="Never assigned"
                columns={[
                  { key: "employee", header: "Employee", render: (r) => empText(r.employee) },
                  { key: "quantity", header: "Qty" },
                  { key: "assigned_at", header: "Assigned", render: (r) => formatDate(r.assigned_at) },
                  { key: "assignment_reason", header: "Reason", render: (r) => r.assignment_reason ?? "—" },
                  { key: "accessories", header: "Accessories", render: (r) => <AccessoryList items={r.accessories} empty="—" /> },
                  { key: "expected_return_date", header: "Expected return", render: (r) => (r.status === "active" ? dueText(r.expected_return_date) : formatDate(r.expected_return_date)) },
                  { key: "acknowledged_at", header: "Acknowledged", render: (r) => (r.acknowledged_at ? formatDate(r.acknowledged_at) : r.status === "active" ? <Badge tone="amber">not yet</Badge> : "—") },
                  { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
                  { key: "returned_at", header: "Returned", render: (r) => (r.returned_at ? `${formatDate(r.returned_at)}${r.return_condition ? ` · ${r.return_condition}` : ""}` : "—") },
                  ...(canManage ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => <AssignmentActions row={withAsset(r)} canManage={canManage} setModal={setModal} /> }] : []),
                ]} />
            </section>
            <section>
              <h3 className="mb-2 text-sm font-bold text-[#101a3a]">Asset history</h3>
              {events.loading && !events.data ? <Loading /> : events.error ? <ErrorState message={events.error} onRetry={events.reload} /> : <AssetHistory events={events.data} />}
            </section>
          </div>
        )}
      </Modal>
      {modal?.type === "edit" && <AssetFormModal asset={a} locations={locations} canCost={canCost} onClose={() => setModal(null)} onSaved={() => { notify("Asset updated."); done(); }} />}
      {modal?.type === "assign" && <AssignModal asset={a} employees={employees} remaining={remaining} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "maintenance" && <MaintenanceModal asset={a} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "status" && <StatusModal asset={a} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === "damage" && <DamageForm asset={a} assignment={active.length === 1 && !a.is_bulk ? active[0] : null} onClose={() => setModal(null)} onDone={done} />}
      <AssignmentModals modal={modal} setModal={setModal} employees={employees} canManage={canManage} myEmployeeId={myEmployeeId} done={done} />
    </>
  );
}

// ---------------------------------------------------------------- tabs
function Inventory({ canManage, canCost, employees, locations, myEmployeeId, initialStatus, onTypesChanged }) {
  const { notify } = useToast();
  const [f, setF] = useState({ status: initialStatus ?? "", type: "", search: "", location: "" });
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const list = useHrQuery(() => listAssets(f), [f.status, f.type, f.search, f.location]);
  const types = useHrQuery(listAssetTypes, []);
  const setFilter = (k) => (e) => setF((s) => ({ ...s, [k]: typeof e === "string" ? e : e.target.value }));
  useEffect(() => { if (initialStatus !== undefined) setF((s) => ({ ...s, status: initialStatus })); }, [initialStatus]);

  async function doExport() {
    const rows = list.data ?? [];
    let costs = {};
    if (canCost && rows.length) {
      const res = await getAssetCosts(rows.map((r) => r.id));
      if (res.error) { notify(res.error, "error"); return; }
      costs = res.data;
    }
    exportCsv(`assets-${today()}`, rows, [
      { label: "Asset ID", key: "asset_tag" }, { label: "Category", key: "asset_type" }, { label: "Name", key: "category" },
      { label: "Brand", key: "brand" }, { label: "Model", key: "model" }, { label: "Serial number", key: "serial_number" },
      { label: "Status", key: "status" }, { label: "Condition", key: "condition" }, { label: "Quantity tracked", value: (r) => (r.is_bulk ? "yes" : "no") },
      { label: "Quantity", key: "quantity" }, { label: "Office location", value: (r) => r.location?.name }, { label: "Storage location", key: "storage_location" },
      { label: "Purchase date", key: "purchase_date" },
      ...(canCost ? [{ label: "Purchase cost", value: (r) => costs[r.id] }] : []),
      { label: "Warranty expiry", key: "warranty_expiry" }, { label: "Notes", key: "notes" },
    ]);
    notify(`Exported ${rows.length} assets.`);
  }

  const columns = [
    { key: "asset_tag", header: "Asset ID", sortable: true, render: (r) => <span className="font-mono text-xs font-bold text-[#1f4693]">{r.asset_tag}</span> },
    { key: "asset_type", header: "Category", sortable: true, render: (r) => <div><p className="font-medium">{r.asset_type}</p>{r.category && <p className="text-xs text-slate-500">{r.category}</p>}</div> },
    { key: "model", header: "Brand / model", render: (r) => [r.brand, r.model].filter(Boolean).join(" ") || "—" },
    { key: "serial_number", header: "Serial", render: (r) => r.serial_number ?? "—" },
    { key: "status", header: "Status", sortable: true, render: (r) => <AssetStatus status={r.status} /> },
    { key: "condition", header: "Condition", render: (r) => label(r.condition) },
    { key: "quantity", header: "Qty", render: (r) => (r.is_bulk ? r.quantity : "1") },
    { key: "location", header: "Location", render: (r) => [r.location?.name, r.storage_location].filter(Boolean).join(" · ") || "—" },
    { key: "warranty_expiry", header: "Warranty", render: (r) => formatDate(r.warranty_expiry) },
  ];

  return (
    <>
      <Toolbar>
        <SearchInput value={f.search} onChange={setFilter("search")} placeholder="Search ID, brand, model, serial, storage…" label="Search assets" />
        <Select aria-label="Status" className="sm:w-40" placeholder="Any status" value={f.status} onChange={setFilter("status")} options={opts(ASSET_STATUSES)} />
        <Select aria-label="Asset category" className="sm:w-44" placeholder="All categories" value={f.type} onChange={setFilter("type")} options={(types.data ?? []).map((t) => ({ value: t, label: t }))} />
        <Select aria-label="Location" className="sm:w-44" placeholder="All locations" value={f.location} onChange={setFilter("location")} options={toOptions(locations)} />
        <Button variant="secondary" onClick={doExport} disabled={!list.data?.length}><Download className="h-4 w-4" aria-hidden="true" />Export CSV</Button>
        {canManage && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" />Add asset</Button>}
      </Toolbar>
      <DataTable caption="Asset register" columns={columns} rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle="No assets match" emptyDescription={canManage ? "Adjust the filters, or add the first asset." : "Adjust the filters."} onRowClick={(r) => setSelected(r.id)} />
      {selected && <AssetDetail assetId={selected} canManage={canManage} canCost={canCost} employees={employees} locations={locations} myEmployeeId={myEmployeeId}
        onClose={() => setSelected(null)} onChanged={() => { list.reload(); types.reload(); onTypesChanged?.(); }} />}
      {adding && <AssetFormModal locations={locations} canCost={canCost} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); notify("Asset added."); list.reload(); types.reload(); onTypesChanged?.(); }} />}
    </>
  );
}

function Assignments({ canManage, employees, myEmployeeId }) {
  const [f, setF] = useState({ employee: "", status: "active" });
  const [modal, setModal] = useState(null);
  const list = useHrQuery(() => listAssignments(f), [f.employee, f.status]);
  const done = () => { setModal(null); list.reload(); };
  return (
    <>
      <Toolbar>
        <Select aria-label="Employee" className="sm:w-64" placeholder="All employees" value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })} options={employees ?? []} />
        <Select aria-label="Assignment status" className="sm:w-44" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}
          options={[{ value: "active", label: "Active" }, { value: "returned", label: "Returned" }, { value: "lost", label: "Lost" }, { value: "", label: "All (history)" }]} />
      </Toolbar>
      <DataTable caption="Asset assignments" rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle="No assignments" emptyDescription="Assign assets from the register."
        columns={[
          { key: "asset", header: "Asset", render: (r) => <div className="min-w-[10rem]"><p className="font-mono text-xs font-bold text-[#1f4693]">{r.asset?.asset_tag}</p><p className="text-xs text-slate-500">{r.asset?.asset_type} {[r.asset?.brand, r.asset?.model].filter(Boolean).join(" ")}</p></div> },
          { key: "employee", header: "Employee", render: (r) => empText(r.employee) },
          { key: "quantity", header: "Qty" },
          { key: "assigned_at", header: "Assigned", sortable: true, render: (r) => formatDate(r.assigned_at) },
          { key: "assignment_reason", header: "Reason", render: (r) => r.assignment_reason ?? "—" },
          { key: "expected_return_date", header: "Expected return", render: (r) => (r.status === "active" ? dueText(r.expected_return_date) : formatDate(r.expected_return_date)) },
          { key: "acknowledged_at", header: "Acknowledged", render: (r) => (r.acknowledged_at ? formatDate(r.acknowledged_at) : r.status === "active" ? <Badge tone="amber">pending</Badge> : "—") },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "returned_at", header: "Returned", render: (r) => (r.returned_at ? `${formatDate(r.returned_at)}${r.return_condition ? ` · ${r.return_condition}` : ""}` : "—") },
          ...(canManage ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => <AssignmentActions row={r} canManage={canManage} setModal={setModal} /> }] : []),
        ]} />
      <AssignmentModals modal={modal} setModal={setModal} employees={employees} canManage={canManage} myEmployeeId={myEmployeeId} done={done} />
    </>
  );
}

function FulfilModal({ request, onClose, onDone }) {
  const { notify } = useToast();
  const [asset, setAsset] = useState("");
  const [expectedReturn, setExpectedReturn] = useState("");
  const avail = useHrQuery(() => listAssets({ status: "available" }), []);
  const options = useMemo(() => {
    const rows = avail.data ?? [];
    const match = rows.filter((a) => a.asset_type.toLowerCase() === request.asset_type.toLowerCase());
    const rest = rows.filter((a) => !match.includes(a));
    return [...match, ...rest].map((a) => ({ value: a.id, label: `${assetLabel(a)} — ${a.asset_type}${a.is_bulk ? ` (stock, ${a.quantity} total)` : ""}` }));
  }, [avail.data, request.asset_type]);
  return (
    <ActionModal title="Fulfil asset request" submitLabel="Assign and fulfil" onClose={onClose}
      onSubmit={async () => {
        if (!asset) return { error: "Choose an available asset." };
        if (expectedReturn && expectedReturn < today()) return { error: "The expected return date is in the past." };
        const res = await fulfillAssetRequest(request.id, asset, expectedReturn);
        if (res.error) return res;
        notify("Request fulfilled and asset assigned."); onDone(); return {};
      }}>
      <p className="text-sm text-slate-600"><strong>{empText(request.employee)}</strong> requested: <strong>{request.asset_type}</strong>{request.request_kind === "replacement" && " (replacement)"}</p>
      {request.request_kind === "replacement" && <p className="text-xs text-slate-500">Start a return for the replaced asset ({request.replaces?.asset?.asset_tag ?? "see request"}) separately so it is inspected.</p>}
      {avail.loading && !avail.data ? <Loading /> : avail.error ? <ErrorState message={avail.error} onRetry={avail.reload} /> : (
        <Field label="Asset" required hint="Matching categories are listed first.">
          <Select placeholder={options.length ? "Choose an asset" : "No available assets"} value={asset} onChange={(e) => setAsset(e.target.value)} options={options} />
        </Field>
      )}
      <Field label="Expected return date" hint="Optional"><Input type="date" min={today()} value={expectedReturn} onChange={(e) => setExpectedReturn(e.target.value)} /></Field>
    </ActionModal>
  );
}

const REQ_ORDER = { pending: 0, approved: 1, fulfilled: 2, rejected: 3, cancelled: 4 };

function Requests({ canManage, myEmployeeId }) {
  const { notify } = useToast();
  const [status, setStatus] = useState("");
  const [modal, setModal] = useState(null);
  const list = useHrQuery(() => listAssetRequests({ status }), [status]);
  const rows = useMemo(() => [...(list.data ?? [])].sort((a, b) => (REQ_ORDER[a.status] - REQ_ORDER[b.status]) || (a.created_at < b.created_at ? 1 : -1)), [list.data]);
  const done = () => { setModal(null); list.reload(); };
  return (
    <>
      <Toolbar>
        <Select aria-label="Request status" className="sm:w-48" placeholder="All statuses (pending first)" value={status} onChange={(e) => setStatus(e.target.value)} options={opts(REQUEST_STATUSES)} />
      </Toolbar>
      <DataTable caption="Asset requests" rows={rows} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle="No asset requests" emptyDescription="Employees request new or replacement equipment from their portal."
        columns={[
          { key: "employee", header: "Employee", render: (r) => empText(r.employee) },
          { key: "asset_type", header: "Asset", render: (r) => <div><p className="font-medium">{r.asset_type}</p>{r.request_kind === "replacement" && <p className="text-xs text-slate-500">Replacement{r.replaces?.asset ? ` for ${r.replaces.asset.asset_tag}` : ""}</p>}</div> },
          { key: "reason", header: "Reason", render: (r) => <p className="max-w-xs whitespace-pre-line text-sm">{r.reason}</p> },
          { key: "created_at", header: "Requested", render: (r) => formatDate(r.created_at) },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "decision_note", header: "Decision note", render: (r) => r.decision_note ?? "—" },
          ...(canManage ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => r.employee_id !== myEmployeeId && (
            <span className="flex gap-1">
              {r.status === "pending" && <Button size="sm" variant="success" onClick={() => setModal({ type: "approve", request: r })}>Approve</Button>}
              {r.status === "pending" && <Button size="sm" variant="danger" onClick={() => setModal({ type: "reject", request: r })}>Reject</Button>}
              {r.status === "approved" && <Button size="sm" onClick={() => setModal({ type: "fulfil", request: r })}><PackageCheck className="h-4 w-4" aria-hidden="true" />Fulfil</Button>}
            </span>) }] : []),
        ]} />
      <ConfirmDialog open={modal?.type === "approve"} onClose={() => setModal(null)} tone="success" title="Approve asset request"
        message={modal?.request ? `Approve ${modal.request.asset_type} for ${empText(modal.request.employee)}? You can fulfil it with a specific asset afterwards.` : ""}
        confirmLabel="Approve" requireReason={false} reasonLabel="Note (optional)"
        onConfirm={async (note) => { const res = await decideAssetRequest(modal.request.id, true, note); if (!res.error) { notify("Request approved."); done(); } return res; }} />
      <ConfirmDialog open={modal?.type === "reject"} onClose={() => setModal(null)} tone="danger" title="Reject asset request"
        message="The employee is notified with your reason." confirmLabel="Reject" requireReason reasonLabel="Reason"
        onConfirm={async (note) => { const res = await decideAssetRequest(modal.request.id, false, note); if (!res.error) { notify("Request rejected."); done(); } return res; }} />
      {modal?.type === "fulfil" && <FulfilModal request={modal.request} onClose={() => setModal(null)} onDone={done} />}
    </>
  );
}

export default function AssetsPage() {
  const { hasPermission, hr } = useAuth();
  const canManage = hasPermission("assets.manage");
  const canCost = hasPermission("assets.view_cost");
  const myEmployeeId = hr?.employee?.id;
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get("tab")) ? params.get("tab") : "overview";
  const [inventoryStatus, setInventoryStatus] = useState(undefined);
  const employees = useEmployeeOptions();
  const org = useOrg();
  const types = useHrQuery(listAssetTypes, []);
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; }, { replace: true });
  const open = (t, filter) => { setInventoryStatus(filter?.status ?? ""); setTab(t); };
  return (
    <>
      <PageHeader title="Asset Allocation" description="Company laptops, monitors and accessories: who holds them, handovers, damage, returns and full history." />
      <Tabs value={tab} onChange={setTab} label="Asset sections" tabs={[
        { value: "overview", label: "Overview" }, { value: "inventory", label: "Register" }, { value: "assignments", label: "Assignments" },
        { value: "handovers", label: "Handovers" }, { value: "damage", label: "Damage" }, { value: "returns", label: "Returns" }, { value: "requests", label: "Requests" },
      ]} />
      {employees.error && <div className="mb-3"><InlineError message={`Employee list unavailable: ${employees.error}`} /></div>}
      {tab === "overview" && <OverviewTab employees={employees.data} org={org.data} types={types.data} onOpen={open} />}
      {tab === "inventory" && <Inventory canManage={canManage} canCost={canCost} employees={employees.data} locations={org.data?.locations} myEmployeeId={myEmployeeId}
        initialStatus={inventoryStatus} onTypesChanged={types.reload} />}
      {tab === "assignments" && <Assignments canManage={canManage} employees={employees.data} myEmployeeId={myEmployeeId} />}
      {tab === "handovers" && <HandoversTab canManage={canManage} employees={employees.data} myEmployeeId={myEmployeeId} />}
      {tab === "damage" && <DamageTab canManage={canManage} myEmployeeId={myEmployeeId} />}
      {tab === "returns" && <ReturnsTab canManage={canManage} employees={employees.data} myEmployeeId={myEmployeeId} />}
      {tab === "requests" && <Requests canManage={canManage} myEmployeeId={myEmployeeId} />}
      {!canManage && <Card className="mt-4"><p className="text-sm text-slate-600">Read-only view: you do not have assets.manage.</p></Card>}
    </>
  );
}
