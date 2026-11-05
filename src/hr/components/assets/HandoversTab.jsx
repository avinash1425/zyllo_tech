// Handover queue: issued condition, accessories, checklist, notes, employee
// acknowledgement (timestamp + terms version) and HR/IT confirmation, with
// handover documents stored through Module 9.
import { useState } from "react";
import { useHrQuery, formatDate, formatDateTime } from "@/lib/hr/client";
import { ASSET_CONDITIONS, HANDOVER_STATUSES, assetName, confirmHandover, listHandovers, updateHandover } from "@/lib/hr/assets";
import { Button, DataTable, DescriptionList, Field, Select, Textarea, Toolbar, useToast } from "@/hr/ui";
import { AccessoriesInput, AccessoryList, ActionModal, AssetDocuments, ChecklistView, Pill, empText, label, opts } from "./shared";

export function HandoverDetail({ handover: h, canManage, myEmployeeId, onClose, onDone }) {
  const { notify } = useToast();
  const [mode, setMode] = useState(null);       // edit | confirm
  const [note, setNote] = useState("");
  const [v, setV] = useState(() => ({ issuedCondition: h.issued_condition, accessories: h.accessories ?? [], checklist: h.checklist ?? [], notes: h.notes ?? "" }));
  const isOwn = h.employee_id === myEmployeeId;
  const canEdit = canManage && h.status === "pending_acknowledgement";
  const canConfirm = canManage && h.status === "acknowledged" && !isOwn;

  if (mode === "edit") {
    return (
      <ActionModal title={`Edit handover · ${h.asset?.asset_tag}`} size="lg" submitLabel="Save handover" onClose={() => setMode(null)}
        onSubmit={async () => {
          const res = await updateHandover(h.id, v);
          if (res.error) return res;
          notify("Handover updated."); onDone(); return {};
        }}>
        <Field label="Issued condition"><Select value={v.issuedCondition} onChange={(e) => setV({ ...v, issuedCondition: e.target.value })} options={opts(ASSET_CONDITIONS)} /></Field>
        <AccessoriesInput label="Included accessories" value={v.accessories} onChange={(a) => setV({ ...v, accessories: a })} />
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-semibold text-[#173a52]">Handover checklist</legend>
          {v.checklist.map((c, i) => (
            <label key={i} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-[#f96706]" checked={Boolean(c.done)}
                onChange={(e) => setV({ ...v, checklist: v.checklist.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} />
              {c.item}
            </label>
          ))}
        </fieldset>
        <Field label="Handover notes"><Textarea value={v.notes} maxLength={2000} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </ActionModal>
    );
  }
  if (mode === "confirm") {
    return (
      <ActionModal title="Confirm handover" submitLabel="Confirm handover" tone="success" onClose={() => setMode(null)}
        onSubmit={async () => {
          const res = await confirmHandover(h.id, note);
          if (res.error) return res;
          notify("Handover confirmed."); onDone(); return {};
        }}>
        <p className="text-sm text-slate-600">Confirm that <strong>{empText(h.employee)}</strong> received <strong>{assetName(h.asset)}</strong> ({h.asset?.asset_tag}) as recorded.</p>
        <Field label="Note (optional)"><Textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></Field>
      </ActionModal>
    );
  }

  return (
    <ActionModal title={`Handover · ${h.asset?.asset_tag ?? ""}`} size="lg" hideSubmit onClose={onClose}>
      <DescriptionList items={[
        { label: "Asset", value: `${assetName(h.asset)} · ${h.asset?.asset_type ?? ""}${h.asset?.serial_number ? ` · S/N ${h.asset.serial_number}` : ""}` },
        { label: "Employee", value: empText(h.employee) },
        { label: "Status", value: <Pill kind="handover" value={h.status} /> },
        { label: "Handover date", value: formatDate(h.handover_date) },
        { label: "Issued condition", value: label(h.issued_condition) },
        { label: "Included accessories", value: <AccessoryList items={h.accessories} /> },
        { label: "Employee acknowledgement", value: h.acknowledged_at ? `${formatDateTime(h.acknowledged_at)} · terms ${h.acknowledged_terms_version}` : "Not yet acknowledged" },
        { label: "HR/IT confirmation", value: h.confirmed_at ? `${formatDateTime(h.confirmed_at)}${h.confirmation_note ? ` · ${h.confirmation_note}` : ""}` : "Not confirmed" },
        h.notes && { label: "Notes", value: h.notes },
      ]} />
      <section>
        <h4 className="mb-1 text-sm font-bold text-[#101a3a]">Checklist</h4>
        <ChecklistView items={h.checklist} />
      </section>
      <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
        The employee acknowledgement is an in-app confirmation of receipt recorded with a timestamp and the terms version shown (“{h.terms_version}”). It is not a legally binding digital signature.
      </p>
      <AssetDocuments kind="handover" recordId={h.id} employeeId={h.employee_id} canAttach={canManage && h.status !== "cancelled"} />
      {(canEdit || canConfirm) && (
        <div className="flex flex-wrap gap-2">
          {canEdit && <Button variant="secondary" onClick={() => setMode("edit")}>Edit handover</Button>}
          {canConfirm && <Button variant="success" onClick={() => setMode("confirm")}>Confirm handover</Button>}
        </div>
      )}
      {canManage && h.status === "acknowledged" && isOwn && <p className="text-xs text-slate-500">Another asset manager must confirm a handover of equipment issued to you.</p>}
    </ActionModal>
  );
}

export default function HandoversTab({ canManage, employees, myEmployeeId }) {
  const [f, setF] = useState({ status: "open", employee: "" });
  const [selected, setSelected] = useState(null);
  const list = useHrQuery(() => listHandovers(f), [f.status, f.employee]);
  return (
    <>
      <Toolbar>
        <Select aria-label="Handover status" className="sm:w-56" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}
          options={[{ value: "open", label: "Open (pending / to confirm)" }, ...opts(HANDOVER_STATUSES), { value: "", label: "All" }]} />
        <Select aria-label="Employee" className="sm:w-64" placeholder="All employees" value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })} options={employees ?? []} />
      </Toolbar>
      <DataTable caption="Handover queue" rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload} onRowClick={setSelected}
        emptyTitle="No handovers" emptyDescription="A handover is created every time equipment is assigned."
        columns={[
          { key: "asset", header: "Asset", render: (r) => <div className="min-w-[9rem]"><p className="font-mono text-xs font-bold text-[#1f4693]">{r.asset?.asset_tag}</p><p className="text-xs text-slate-500">{assetName(r.asset)}</p></div> },
          { key: "employee", header: "Employee", render: (r) => empText(r.employee) },
          { key: "handover_date", header: "Handover date", sortable: true, render: (r) => formatDate(r.handover_date) },
          { key: "issued_condition", header: "Condition", render: (r) => label(r.issued_condition) },
          { key: "accessories", header: "Accessories", render: (r) => <AccessoryList items={r.accessories} /> },
          { key: "status", header: "Status", render: (r) => <Pill kind="handover" value={r.status} /> },
          { key: "acknowledged_at", header: "Acknowledged", render: (r) => (r.acknowledged_at ? formatDate(r.acknowledged_at) : "—") },
        ]} />
      {selected && <HandoverDetail handover={selected} canManage={canManage} myEmployeeId={myEmployeeId} onClose={() => setSelected(null)}
        onDone={() => { setSelected(null); list.reload(); }} />}
    </>
  );
}
