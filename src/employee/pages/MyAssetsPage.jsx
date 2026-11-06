// Employee Portal — My Assets: assigned equipment (details, handover
// acknowledgement, report damage, request return / replacement), return
// status, my damage reports, my asset history and my asset requests.
// RLS limits every query to the employee's own records.
import { useState } from "react";
import { CheckCircle2, Package, Plus, ShieldAlert, Undo2 } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import {
  acknowledgeHandover, acknowledgeReturn, assetName, cancelAssetRequest, cancelReturn, listDamageReports, listMyAssetEvents, listMyAssetRequests,
  listMyAssignments, listMyReturns, requestAsset, requestReturn,
} from "@/lib/hr/assets";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, Input, Loading, PageHeader, Select, StatusBadge, Tabs, Textarea, useToast,
} from "@/hr/ui";
import { AccessoryList, ActionModal, AssetHistory, ChecklistView, Pill, dueText, label, one, today } from "@/hr/components/assets/shared";
import { DamageDetail, DamageForm } from "@/hr/components/assets/DamageTab";
import { ReturnDetail } from "@/hr/components/assets/ReturnsTab";

export default function MyAssetsPage() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const { notify } = useToast();
  const [tab, setTab] = useState("current");
  const asg = useHrQuery(() => listMyAssignments(me), [me]);
  const rets = useHrQuery(() => listMyReturns(me), [me]);
  const dmg = useHrQuery(() => (me ? listDamageReports() : Promise.resolve({ data: [] })), [me]);
  const reqs = useHrQuery(() => listMyAssetRequests(me), [me]);
  const hist = useHrQuery(() => (tab === "history" ? listMyAssetEvents() : Promise.resolve({ data: null })), [tab]);
  const [modal, setModal] = useState(null);   // { type, row }
  const active = (asg.data ?? []).filter((x) => x.status === "active");
  const pastAsg = (asg.data ?? []).filter((x) => x.status !== "active");
  const openReturns = (rets.data ?? []).filter((r) => !["completed", "cancelled"].includes(r.status));
  const openReturnFor = (assignmentId) => openReturns.find((r) => r.assignment_id === assignmentId);
  const pendingAck = active.filter((x) => one(x.handover)?.status === "pending_acknowledgement" || (!one(x.handover) && !x.acknowledged_at)).length;
  const reload = () => { asg.reload(); rets.reload(); dmg.reload(); };

  if (!me) return <ErrorState message="Your account is not linked to an employee record." />;

  return (
    <>
      <PageHeader title="My Assets" description="Company equipment assigned to you. Acknowledge what you receive, report damage and request returns here."
        actions={<Button onClick={() => setModal({ type: "request" })}><Plus className="h-4 w-4" aria-hidden="true" />Request an asset</Button>} />
      {pendingAck > 0 && <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">{pendingAck} item(s) waiting for your handover acknowledgement.</p>}
      <Tabs value={tab} onChange={setTab} label="My asset sections" tabs={[
        { value: "current", label: "Assigned to me", count: asg.data ? active.length : undefined },
        { value: "returns", label: "Returns", count: rets.data ? openReturns.length : undefined },
        { value: "damage", label: "Damage reports" },
        { value: "history", label: "History" },
        { value: "requests", label: "My requests", count: reqs.data ? (reqs.data ?? []).filter((r) => r.status === "pending").length : undefined },
      ]} />

      {tab === "current" && (asg.loading && !asg.data ? <Loading /> : asg.error ? <ErrorState message={asg.error} onRetry={asg.reload} /> : !active.length ? (
        <Card><EmptyState icon={Package} title="No assets assigned" description="Items HR/IT assigns to you will appear here." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {active.map((x) => {
            const h = one(x.handover);
            const ret = openReturnFor(x.id);
            const needsAck = h ? h.status === "pending_acknowledgement" : !x.acknowledged_at;
            return (
              <Card key={x.id}>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-[#101a3a]">{assetName(x.asset)}</p>
                      <p className="text-xs text-slate-500">{x.asset?.asset_type} · <span className="font-mono">{x.asset?.asset_tag}</span>{x.asset?.serial_number ? ` · S/N ${x.asset.serial_number}` : ""}</p>
                    </div>
                    {needsAck ? <Badge tone="amber">please acknowledge</Badge> : h ? <Pill kind="handover" value={h.status} /> : <Badge tone="green">acknowledged</Badge>}
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div><dt className="text-xs text-slate-500">Assigned</dt><dd>{formatDate(x.assigned_at)}</dd></div>
                    <div><dt className="text-xs text-slate-500">Expected return</dt><dd>{dueText(x.expected_return_date)}</dd></div>
                    {x.quantity > 1 && <div><dt className="text-xs text-slate-500">Quantity</dt><dd>{x.quantity}</dd></div>}
                    <div><dt className="text-xs text-slate-500">Issued condition</dt><dd>{label(x.issued_condition ?? x.asset?.condition)}</dd></div>
                    <div className="col-span-2"><dt className="text-xs text-slate-500">Accessories</dt><dd><AccessoryList items={x.accessories} /></dd></div>
                  </dl>
                  {x.notes && <p className="text-sm text-slate-600">{x.notes}</p>}
                  {ret && <p className="text-sm text-[#1f4693]">Return {label(ret.status)}{ret.requested_return_date ? ` · by ${formatDate(ret.requested_return_date)}` : ""}</p>}
                  <div className="mt-1 flex flex-wrap gap-2">
                    {needsAck && <Button size="sm" variant="success" onClick={() => setModal({ type: "ack", row: x })}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Acknowledge handover</Button>}
                    {!needsAck && h && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "ack", row: x })}>Handover details</Button>}
                    <Button size="sm" variant="secondary" onClick={() => setModal({ type: "damage", row: x })}><ShieldAlert className="h-4 w-4" aria-hidden="true" />Report damage</Button>
                    {!ret && <Button size="sm" variant="secondary" onClick={() => setModal({ type: "return", row: x })}><Undo2 className="h-4 w-4" aria-hidden="true" />Request return</Button>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ))}

      {tab === "returns" && (
        <DataTable caption="My returns" rows={rets.data} loading={rets.loading} error={rets.error} onRetry={rets.reload} onRowClick={(r) => setModal({ type: "return_detail", row: r })}
          emptyTitle="No returns" emptyDescription="Use “Request return” on an asset assigned to you."
          columns={[
            { key: "asset", header: "Asset", render: (r) => <div><p className="font-medium">{assetName(r.asset)}</p><p className="font-mono text-xs text-slate-500">{r.asset?.asset_tag}</p></div> },
            { key: "requested_at", header: "Requested", render: (r) => formatDate(r.requested_at) },
            { key: "requested_return_date", header: "Return by", render: (r) => formatDate(r.requested_return_date) },
            { key: "status", header: "Status", render: (r) => <Pill kind="return" value={r.status} /> },
            { key: "missing_accessories", header: "Missing", render: (r) => (r.missing_accessories?.length ? r.missing_accessories.join(", ") : "—") },
            { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (
              <span className="flex gap-1">
                {r.status === "requested" && r.source === "employee" && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setModal({ type: "cancel_return", row: r }); }}>Cancel</Button>}
                {["received", "inspected", "completed"].includes(r.status) && !r.employee_acknowledged_at && <Button size="sm" variant="success" onClick={(e) => { e.stopPropagation(); setModal({ type: "ack_return", row: r }); }}>Confirm return</Button>}
              </span>) },
          ]} />
      )}

      {tab === "damage" && (
        <DataTable caption="My damage reports" rows={dmg.data} loading={dmg.loading} error={dmg.error} onRetry={dmg.reload} onRowClick={(r) => setModal({ type: "damage_detail", row: r })}
          emptyTitle="No damage reports"
          columns={[
            { key: "asset", header: "Asset", render: (r) => <div><p className="font-medium">{assetName(r.asset)}</p><p className="font-mono text-xs text-slate-500">{r.asset?.asset_tag}</p></div> },
            { key: "incident_date", header: "Incident", render: (r) => formatDate(r.incident_date) },
            { key: "severity", header: "Severity", render: (r) => <Pill kind="severity" value={r.severity} /> },
            { key: "status", header: "Status", render: (r) => <Pill kind="damage" value={r.status} /> },
            { key: "resolution_notes", header: "Resolution", render: (r) => r.resolution_notes ?? "—" },
          ]} />
      )}

      {tab === "history" && (
        <div className="flex flex-col gap-4">
          <Card title="Timeline">
            {hist.loading && !hist.data ? <Loading /> : hist.error ? <ErrorState message={hist.error} onRetry={hist.reload} /> : <AssetHistory events={hist.data} showCost={false} showAsset />}
          </Card>
          <DataTable caption="Past assignments" rows={asg.data ? pastAsg : null} loading={asg.loading} error={asg.error} onRetry={asg.reload}
            emptyTitle="No past assignments"
            columns={[
              { key: "asset", header: "Asset", render: (r) => <div><p className="font-medium">{assetName(r.asset)}</p><p className="font-mono text-xs text-slate-500">{r.asset?.asset_tag}</p></div> },
              { key: "assigned_at", header: "Assigned", render: (r) => formatDate(r.assigned_at) },
              { key: "returned_at", header: "Returned", render: (r) => formatDate(r.returned_at) },
              { key: "return_condition", header: "Condition", render: (r) => r.return_condition ?? "—" },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            ]} />
        </div>
      )}

      {tab === "requests" && (
        <DataTable caption="My asset requests" rows={reqs.data} loading={reqs.loading} error={reqs.error} onRetry={reqs.reload}
          emptyTitle="No requests" emptyDescription="Need equipment? Use “Request an asset”."
          columns={[
            { key: "asset_type", header: "Asset", render: (r) => <div><p className="font-medium">{r.asset_type}</p>{r.request_kind === "replacement" && <p className="text-xs text-slate-500">Replacement</p>}</div> },
            { key: "reason", header: "Reason", render: (r) => <p className="max-w-xs whitespace-pre-line">{r.reason}</p> },
            { key: "created_at", header: "Requested", render: (r) => formatDateTime(r.created_at) },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "decision_note", header: "HR note", render: (r) => r.decision_note ?? "—" },
            { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => r.status === "pending" && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "cancel", row: r })}>Cancel</Button> },
          ]} />
      )}

      {modal?.type === "ack" && <HandoverAckModal assignment={modal.row} onClose={() => setModal(null)} onDone={() => { setModal(null); asg.reload(); }} />}
      {modal?.type === "damage" && <DamageForm assignment={modal.row} asset={modal.row.asset} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); setTab("damage"); }} />}
      {modal?.type === "damage_detail" && <DamageDetail report={modal.row} employeeView myEmployeeId={me} onClose={() => setModal(null)} onDone={() => { setModal(null); dmg.reload(); }} />}
      {modal?.type === "return" && <ReturnRequestModal assignment={modal.row} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); setTab("returns"); }} />}
      {modal?.type === "return_detail" && <ReturnDetail ret={modal.row} employeeView myEmployeeId={me} onClose={() => setModal(null)} onDone={() => { setModal(null); rets.reload(); }} />}
      <ConfirmDialog open={modal?.type === "cancel_return"} onClose={() => setModal(null)} tone="danger" title="Cancel return request"
        message={modal?.row ? `Cancel your return request for ${modal.row.asset?.asset_tag}?` : ""} confirmLabel="Cancel request"
        onConfirm={async () => { const res = await cancelReturn(modal.row.id); if (!res.error) { notify("Return request cancelled."); rets.reload(); } return res; }} />
      <ConfirmDialog open={modal?.type === "ack_return"} onClose={() => setModal(null)} tone="success" title="Confirm return"
        message={modal?.row ? `Confirm that you handed ${assetName(modal.row.asset)} (${modal.row.asset?.asset_tag}) over to HR/IT.` : ""} confirmLabel="I handed it over"
        onConfirm={async () => { const res = await acknowledgeReturn(modal.row.id); if (!res.error) { notify("Return confirmed."); rets.reload(); } return res; }} />
      <ConfirmDialog open={modal?.type === "cancel"} onClose={() => setModal(null)} tone="danger" title="Cancel request"
        message={modal?.row ? `Cancel your request for ${modal.row.asset_type}?` : ""} confirmLabel="Cancel request"
        onConfirm={async () => { const res = await cancelAssetRequest(modal.row.id); if (!res.error) { notify("Request cancelled."); reqs.reload(); } return res; }} />
      {modal?.type === "request" && <RequestModal active={active} onClose={() => setModal(null)} onDone={() => { setModal(null); reqs.reload(); setTab("requests"); }} />}
    </>
  );
}

/** Shows exactly what is being acknowledged and records the terms version. */
function HandoverAckModal({ assignment: x, onClose, onDone }) {
  const { notify } = useToast();
  const h = one(x.handover);
  const [agree, setAgree] = useState(false);
  const pending = h ? h.status === "pending_acknowledgement" : !x.acknowledged_at;
  return (
    <ActionModal title={`Handover · ${x.asset?.asset_tag ?? ""}`} size="md" submitLabel="Acknowledge receipt" tone="success" hideSubmit={!pending} onClose={onClose}
      onSubmit={async () => {
        if (!agree) return { error: "Tick the confirmation to acknowledge receipt." };
        const res = h ? await acknowledgeHandover(h.id, h.terms_version) : { error: "Handover record not found. Reload the page." };
        if (res.error) return res;
        notify("Handover acknowledged."); onDone(); return {};
      }}>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-slate-500">Asset</dt><dd>{assetName(x.asset)} · {x.asset?.asset_type}</dd></div>
        <div><dt className="text-xs text-slate-500">Asset ID / serial</dt><dd className="font-mono">{x.asset?.asset_tag}{x.asset?.serial_number ? ` · ${x.asset.serial_number}` : ""}</dd></div>
        <div><dt className="text-xs text-slate-500">Handover date</dt><dd>{formatDate(h?.handover_date ?? x.assigned_at)}</dd></div>
        <div><dt className="text-xs text-slate-500">Issued condition</dt><dd>{label(h?.issued_condition ?? x.issued_condition)}</dd></div>
        <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Included accessories</dt><dd><AccessoryList items={h?.accessories ?? x.accessories} /></dd></div>
        {h?.notes && <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Notes</dt><dd>{h.notes}</dd></div>}
      </dl>
      {h && <section><h4 className="mb-1 text-sm font-bold text-[#101a3a]">Handover checklist</h4><ChecklistView items={h.checklist} /></section>}
      {h && <blockquote className="rounded-lg border-l-4 border-[#f96706] bg-slate-50 p-3 text-sm text-slate-700">{h.terms_text}<span className="mt-1 block text-xs text-slate-500">Terms version {h.terms_version}</span></blockquote>}
      {pending ? (
        <Checkbox label="I confirm I have received the items above in the stated condition." checked={agree} onChange={(e) => setAgree(e.target.checked)} />
      ) : (
        <p className="text-sm text-emerald-700">Acknowledged {formatDateTime(h?.acknowledged_at ?? x.acknowledged_at)}{h?.acknowledged_terms_version ? ` · terms ${h.acknowledged_terms_version}` : ""}{h?.confirmed_at ? ` · confirmed by HR/IT ${formatDate(h.confirmed_at)}` : ""}</p>
      )}
      <p className="text-xs text-slate-500">This records an in-app acknowledgement with the date, time and terms version. It is not a legally binding digital signature.</p>
    </ActionModal>
  );
}

function ReturnRequestModal({ assignment: x, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ reason: "", date: "" });
  const [errors, setErrors] = useState({});
  return (
    <ActionModal title={`Request return · ${x.asset?.asset_tag ?? ""}`} submitLabel="Request return" onClose={onClose}
      onSubmit={async () => {
        const errs = {};
        if (v.reason.trim().length < 3) errs.reason = "Explain why you are returning it (at least 3 characters).";
        if (v.date && v.date < today()) errs.date = "Choose today or a later date.";
        setErrors(errs);
        if (Object.keys(errs).length) return { error: "Fix the highlighted fields." };
        const res = await requestReturn(x.id, v.reason, v.date);
        if (res.error) return res;
        notify("Return requested. HR/IT will confirm when to hand it over."); onDone(); return {};
      }}>
      <Field label="Reason" required error={errors.reason}><Textarea value={v.reason} maxLength={2000} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
      <Field label="Preferred return date" error={errors.date} hint="Optional"><Input type="date" min={today()} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
      <p className="text-xs text-slate-500">Bring all listed accessories: <AccessoryList items={x.accessories} />. The asset stays assigned to you until HR/IT receives it.</p>
    </ActionModal>
  );
}

function RequestModal({ active, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ kind: "new", type: "", reason: "", replaces: "" });
  const [errors, setErrors] = useState({});
  return (
    <ActionModal title="Request an asset" submitLabel="Submit request" onClose={onClose}
      onSubmit={async () => {
        const errs = {};
        if (v.type.trim().length < 2 || v.type.trim().length > 60) errs.type = "Enter the type of asset (2–60 characters).";
        if (v.reason.trim().length < 3) errs.reason = "Explain why you need it (at least 3 characters).";
        if (v.kind === "replacement" && !v.replaces) errs.replaces = "Choose the asset to replace.";
        setErrors(errs);
        if (Object.keys(errs).length) return { error: "Fix the highlighted fields." };
        const res = await requestAsset(v.type, v.reason, v.kind, v.replaces || null);
        if (res.error) return res;
        notify("Asset request submitted."); onDone(); return {};
      }}>
      <Field label="Request type"><Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} options={[{ value: "new", label: "New equipment" }, { value: "replacement", label: "Replacement for an asset I hold" }]} /></Field>
      {v.kind === "replacement" && (
        <Field label="Asset to replace" required error={errors.replaces}>
          <Select placeholder={active.length ? "Choose" : "No assets assigned"} value={v.replaces}
            onChange={(e) => { const a = active.find((x) => x.id === e.target.value); setV({ ...v, replaces: e.target.value, type: v.type || a?.asset?.asset_type || "" }); }}
            options={active.map((x) => ({ value: x.id, label: `${x.asset?.asset_tag} · ${assetName(x.asset)}` }))} />
        </Field>
      )}
      <Field label="Asset type" required error={errors.type} hint="e.g. Laptop, Monitor, Headset"><Input value={v.type} maxLength={60} onChange={(e) => setV({ ...v, type: e.target.value })} /></Field>
      <Field label="Reason" required error={errors.reason}><Textarea value={v.reason} maxLength={2000} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
      <p className="text-xs text-slate-500">Requested on {formatDate(today())}. HR/IT will approve or reject the request.{v.kind === "replacement" ? " Report damage separately if the asset is damaged." : ""}</p>
    </ActionModal>
  );
}
