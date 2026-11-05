// Assets held by one employee + asset clearance (Module 11). Self-contained so
// Employee Management (profile) and Onboarding & Exit can mount it without
// duplicating asset logic:
//
//   import EmployeeAssetsPanel from "@/hr/components/EmployeeAssetsPanel";
//   <EmployeeAssetsPanel employeeId={e.id} />                    // profile tab
//   <EmployeeAssetsPanel employeeId={x.employee_id} exitId={x.id} mode="exit" />   // exit clearance
//
// Data: hr_asset_assignments (history survives transfers and exit),
// hr_employee_asset_clearance, hr_start_exit_asset_returns,
// hr_record_asset_clearance. Permission checks are enforced server-side.
import { useState } from "react";
import { CheckCircle2, ClipboardList, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { assetName, employeeAssetClearance, listAssignments, recordAssetClearance, startExitAssetReturns } from "@/lib/hr/assets";
import { Badge, Button, Card, Checkbox, DataTable, ErrorState, Field, Input, Loading, StatusBadge, Textarea, useToast } from "@/hr/ui";
import { AccessoryList, ActionModal, Pill, dueText, label, today } from "@/hr/components/assets/shared";

function ClearanceModal({ employeeId, exitId, clearance, onClose, onDone }) {
  const { notify } = useToast();
  const [note, setNote] = useState("");
  const [ack, setAck] = useState(false);
  const issues = clearance?.issues_count > 0;
  return (
    <ActionModal title="Record asset clearance" submitLabel="Record clearance" tone="success" onClose={onClose}
      onSubmit={async () => {
        if (issues && (!ack || !note.trim())) return { error: "Acknowledge the open issues and add a note." };
        const res = await recordAssetClearance(employeeId, { exitId, note, acknowledgeIssues: ack });
        if (res.error) return res;
        notify("Asset clearance recorded."); onDone(); return {};
      }}>
      <p className="text-sm text-slate-600">All assigned equipment has been returned and inspected. Your name and the time are recorded.</p>
      {issues && (
        <div className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
          {clearance.missing_accessories.map((m) => <p key={m.return_id}>Missing from {m.asset_tag}: {m.missing.join(", ")}</p>)}
          {clearance.open_damage_reports.map((d) => <p key={d.damage_report_id}>Unresolved damage on {d.asset_tag} ({label(d.status)}, {d.severity})</p>)}
          <p className="mt-1 text-xs">Any recovery must follow approved company policy through the payroll approval workflow. Nothing is deducted automatically.</p>
        </div>
      )}
      {issues && <Checkbox label="I have reviewed the missing / damaged items above" checked={ack} onChange={(e) => setAck(e.target.checked)} />}
      <Field label={issues ? "Note" : "Note (optional)"} required={issues}><Textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></Field>
    </ActionModal>
  );
}

function StartReturnsModal({ employeeId, exitId, onClose, onDone }) {
  const { notify } = useToast();
  const [date, setDate] = useState("");
  return (
    <ActionModal title="Generate return checklist" submitLabel="Start returns" onClose={onClose}
      onSubmit={async () => {
        if (date && date < today()) return { error: "The return date is in the past." };
        const res = await startExitAssetReturns(employeeId, exitId, date);
        if (res.error) return res;
        notify(res.data ? `${res.data} return(s) started. The employee was notified.` : "Every asset already has a return in progress."); onDone(); return {};
      }}>
      <p className="text-sm text-slate-600">Creates a return (Pending Handover) for every asset still assigned. HR/IT then records receipt, inspects and completes each return in Assets → Returns.</p>
      <Field label="Return by" hint="Defaults to the approved last working day"><Input type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
    </ActionModal>
  );
}

export default function EmployeeAssetsPanel({ employeeId, exitId = null, mode = "profile" }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("assets.manage");
  const canStart = canManage || hasPermission("exit.manage");
  const [modal, setModal] = useState(null);
  const history = useHrQuery(() => listAssignments({ employee: employeeId, status: "" }), [employeeId]);
  const clearance = useHrQuery(() => employeeAssetClearance(employeeId), [employeeId]);
  const c = clearance.data;
  const reload = () => { history.reload(); clearance.reload(); };
  const done = () => { setModal(null); reload(); };
  const outstanding = c?.outstanding ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card title={mode === "exit" ? "Asset clearance" : "Assigned assets"}
        actions={canStart && outstanding.some((o) => o.return_status === "not_started") && mode === "exit"
          ? <Button size="sm" variant="secondary" onClick={() => setModal("start")}><ClipboardList className="h-4 w-4" aria-hidden="true" />Generate return checklist</Button> : null}>
        {clearance.loading && !c ? <Loading /> : clearance.error ? <ErrorState message={clearance.error} onRetry={clearance.reload} /> : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {c.all_returned ? <Badge tone="green">all equipment returned</Badge> : <Badge tone="amber">{outstanding.length} item(s) outstanding</Badge>}
              {c.issues_count > 0 && <Badge tone="red">{c.issues_count} issue(s) to review</Badge>}
              {c.cleared && <Badge tone="green">asset clearance recorded</Badge>}
              {c.last_clearance && <span className="text-xs text-slate-500">Last clearance {formatDateTime(c.last_clearance.cleared_at)}{c.last_clearance.notes ? ` · ${c.last_clearance.notes}` : ""}</span>}
            </div>
            {outstanding.length > 0 && (
              <ul className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-100">
                {outstanding.map((o) => (
                  <li key={o.assignment_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0"><span className="font-mono text-xs font-bold text-[#1f4693]">{o.asset_tag}</span> · {o.name || o.asset_type}{o.quantity > 1 ? ` ×${o.quantity}` : ""}
                      {o.accessories?.length > 0 && <span className="block text-xs text-slate-500">With: {o.accessories.join(", ")}</span>}</span>
                    <span className="flex items-center gap-2">
                      {o.requested_return_date && <span className="text-xs">{dueText(o.requested_return_date)}</span>}
                      {o.return_status === "not_started" ? <Badge tone="slate">return not started</Badge> : <Pill kind="return" value={o.return_status} />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {mode === "exit" && canManage && !c.cleared && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="success" disabled={!c.can_clear} onClick={() => setModal("clear")}><ShieldCheck className="h-4 w-4" aria-hidden="true" />Record asset clearance</Button>
                {!c.can_clear && <span className="text-xs text-slate-500">Available once every asset is received, inspected and the return completed.</span>}
              </div>
            )}
            {mode === "exit" && c.cleared && <p className="flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Asset clearance complete.</p>}
          </div>
        )}
      </Card>
      <DataTable caption="Asset assignment history" rows={history.data} loading={history.loading} error={history.error} onRetry={history.reload} pageSize={10}
        emptyTitle="No assets ever assigned"
        columns={[
          { key: "asset", header: "Asset", render: (r) => <div className="min-w-[9rem]"><p className="font-mono text-xs font-bold text-[#1f4693]">{r.asset?.asset_tag}</p><p className="text-xs text-slate-500">{assetName(r.asset)} · {r.asset?.asset_type}</p></div> },
          { key: "assigned_at", header: "Assigned", render: (r) => formatDate(r.assigned_at) },
          { key: "accessories", header: "Accessories", render: (r) => <AccessoryList items={r.accessories} empty="—" /> },
          { key: "acknowledged_at", header: "Acknowledged", render: (r) => (r.acknowledged_at ? formatDate(r.acknowledged_at) : r.status === "active" ? <Badge tone="amber">pending</Badge> : "—") },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "returned_at", header: "Returned", render: (r) => (r.returned_at ? `${formatDate(r.returned_at)}${r.return_condition ? ` · ${r.return_condition}` : ""}` : "—") },
        ]} />
      {modal === "clear" && <ClearanceModal employeeId={employeeId} exitId={exitId} clearance={c} onClose={() => setModal(null)} onDone={done} />}
      {modal === "start" && <StartReturnsModal employeeId={employeeId} exitId={exitId} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}
