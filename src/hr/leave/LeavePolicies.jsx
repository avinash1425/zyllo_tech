// Leave policies (migration 160). Leave types are configurable policy; every
// change is a proposal that a second HR user approves (maker-checker,
// setting leave.policy_approval). The server validates each proposal by a
// dry run, refuses self-approval and stale proposals, and snapshots every
// applied change as a policy version. Existing balances and requests keep
// the values they were created with.
import { useMemo, useState } from "react";
import { History, Plus } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { useOrg } from "@/lib/hr/org";
import { ACCRUAL_LABELS, POLICY_FIELDS, decidePolicy, listLeaveTypes, listPolicyChanges, listPolicyVersions, proposePolicy, withdrawPolicy } from "@/lib/hr/leave";
import { Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, Field, InlineError, Input, Loading, ErrorState, Modal, Select, Textarea, useToast } from "@/hr/ui";

const n = (v) => (v == null || v === "" ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }));

export const POLICY_LABELS = {
  code: "Code", name: "Name", description: "Description", paid: "Paid", annual_entitlement: "Annual entitlement", accrual: "Accrual",
  carry_forward_max: "Max carry forward", carry_forward_expiry_months: "Carry-forward expires after (months)", allow_half_day: "Half days allowed",
  requires_document_after_days: "Document required beyond (days)", allow_during_probation: "Allowed during probation",
  allow_negative: "Negative balance allowed", max_negative: "Max negative", counts_weekends: "Weekends count", counts_holidays: "Holidays count",
  active: "Active", sort_order: "Sort order", eligible_employment_types: "Eligible employment types", min_days_per_request: "Min days / request",
  max_days_per_request: "Max days / request", min_notice_days: "Advance notice (days)", effective_from: "Effective from", effective_to: "Effective to",
};

function fmtValue(k, v) {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "all";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (k === "accrual") return v;
  return String(v);
}

export default function LeavePolicies({ canEdit }) {
  const { user } = useAuth();
  const { notify } = useToast();
  const org = useOrg();
  const types = useHrQuery(() => listLeaveTypes(), []);
  const changes = useHrQuery(() => listPolicyChanges(), []);
  const [editing, setEditing] = useState(null);       // leave type row, or {} for a new type
  const [history, setHistory] = useState(null);
  const [deciding, setDeciding] = useState(null);     // { change, approve }
  const empTypes = org.data?.employmentTypes ?? [];
  const typeName = (id) => (types.data ?? []).find((t) => t.id === id)?.name;
  const pending = useMemo(() => (changes.data ?? []).filter((c) => c.status === "pending"), [changes.data]);
  const pendingFor = (id) => pending.find((c) => c.leave_type_id === id);
  const reload = () => { types.reload(); changes.reload(); };

  return (
    <div className="flex flex-col gap-4">
      <Card title="Leave policies" actions={canEdit && <Button size="sm" onClick={() => setEditing({})}><Plus className="h-4 w-4" aria-hidden="true" />New leave type</Button>} padded={false}>
        <p className="px-4 pt-3 text-xs text-slate-500">
          Every change is submitted for approval by a second HR user, then saved as a new policy version. Existing balances and requests are not recalculated.
          Entitlements are company policy, not statutory values: review them before activating a type.
        </p>
        <DataTable caption="Leave policies" rows={types.data} loading={types.loading} error={types.error} onRetry={types.reload} emptyTitle="No leave types"
          columns={[
            { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs font-bold text-[#1f4693]">{r.code}</span> },
            { key: "name", header: "Name", render: (r) => <span>{r.name}{!r.paid && <Badge tone="slate" className="ml-1">unpaid</Badge>}</span> },
            { key: "annual_entitlement", header: "Days / year", render: (r) => n(r.annual_entitlement) },
            { key: "accrual", header: "Accrual" },
            { key: "carry", header: "Carry fwd", render: (r) => (Number(r.carry_forward_max) > 0 ? `${n(r.carry_forward_max)}${r.carry_forward_expiry_months ? ` (expires ${r.carry_forward_expiry_months} mo)` : ""}` : "—") },
            { key: "rules", header: "Request rules", render: (r) => (
              <span className="text-xs text-slate-600">
                {[r.min_notice_days ? `${r.min_notice_days}d notice` : null, r.min_days_per_request ? `min ${n(r.min_days_per_request)}` : null,
                  r.max_days_per_request ? `max ${n(r.max_days_per_request)}` : null, r.allow_half_day ? "half days" : "full days",
                  r.requires_document_after_days != null ? `doc > ${n(r.requires_document_after_days)}d` : null].filter(Boolean).join(" · ")}
              </span>) },
            { key: "eligible", header: "Eligible", render: (r) => (r.eligible_employment_types?.length ? r.eligible_employment_types.join(", ") : "all") },
            { key: "active", header: "Status", render: (r) => (
              <span className="flex flex-col gap-1">{r.active ? <Badge tone="green">active</Badge> : <Badge>inactive</Badge>}
                {pendingFor(r.id) && <Badge tone="orange">change pending</Badge>}<span className="text-xs text-slate-500">v{r.policy_version}</span></span>) },
            { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => setHistory(r)}><History className="h-4 w-4" aria-hidden="true" />History</Button>
                {canEdit && !pendingFor(r.id) && <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Propose change</Button>}
              </div>) },
          ]} />
      </Card>

      <Card title={`Policy changes${pending.length ? ` (${pending.length} pending)` : ""}`} padded={false}>
        <DataTable caption="Leave policy changes" rows={changes.data} loading={changes.loading} error={changes.error} onRetry={changes.reload}
          emptyTitle="No policy changes yet" pageSize={10}
          columns={[
            { key: "proposed_at", header: "Proposed", render: (c) => formatDateTime(c.proposed_at) },
            { key: "type", header: "Leave type", render: (c) => (c.action === "create" ? <span>{c.proposed?.name} <Badge tone="blue">new</Badge></span> : typeName(c.leave_type_id) ?? "—") },
            { key: "diff", header: "Change", render: (c) => (
              <ul className="min-w-[14rem] text-xs text-slate-700">
                {Object.entries(c.proposed ?? {}).filter(([k]) => c.action === "create" ? k !== "code" : true).slice(0, 8).map(([k, v]) => (
                  <li key={k}><span className="font-semibold">{POLICY_LABELS[k] ?? k}:</span> {c.action === "update" && <span className="text-slate-400 line-through">{fmtValue(k, c.previous?.[k])}</span>} {fmtValue(k, v)}</li>
                ))}
              </ul>) },
            { key: "reason", header: "Reason", render: (c) => <span className="text-xs">{c.reason}{c.effective_from && <span className="block text-slate-500">effective {formatDate(c.effective_from)}</span>}</span> },
            { key: "status", header: "Status", render: (c) => (
              <span className="flex flex-col gap-1"><Badge tone={{ pending: "orange", approved: "green", rejected: "red", withdrawn: "slate" }[c.status]}>{c.status}</Badge>
                {c.decision_note && <span className="text-xs text-slate-500">{c.decision_note}</span>}</span>) },
            { key: "_a", header: <span className="sr-only">Actions</span>, render: (c) => c.status === "pending" && canEdit && (
              c.proposed_by === user?.id
                ? <div className="flex flex-col gap-1"><span className="text-xs text-slate-500">Awaiting another HR approver</span>
                    <Button size="sm" variant="ghost" onClick={async () => { const res = await withdrawPolicy(c.id); if (res.error) notify(res.error, "error"); else { notify("Proposal withdrawn."); reload(); } }}>Withdraw</Button></div>
                : <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="success" onClick={() => setDeciding({ change: c, approve: true })}>Approve</Button>
                    <Button size="sm" variant="danger" onClick={() => setDeciding({ change: c, approve: false })}>Reject</Button></div>) },
          ]} />
      </Card>

      {editing && <PolicyModal row={editing} empTypes={empTypes} onClose={() => setEditing(null)}
        onSaved={(c) => { setEditing(null); reload(); notify(c?.status === "approved" ? "Policy change applied." : "Policy change submitted for approval."); }} />}
      {history && <HistoryModal type={history} onClose={() => setHistory(null)} />}
      <ConfirmDialog open={Boolean(deciding)} onClose={() => setDeciding(null)}
        title={deciding?.approve ? "Approve policy change?" : "Reject policy change?"} tone={deciding?.approve ? "success" : "danger"}
        confirmLabel={deciding?.approve ? "Approve and apply" : "Reject"}
        message={deciding ? `${deciding.change.action === "create" ? deciding.change.proposed?.name : typeName(deciding.change.leave_type_id)}: ${deciding.change.reason}. ${deciding.approve ? "The change applies to new requests and new balances immediately." : ""}` : ""}
        requireReason={!deciding?.approve} reasonLabel={deciding?.approve ? "Note (optional)" : "Reason for rejecting"}
        onConfirm={async (note) => {
          const res = await decidePolicy(deciding.change.id, deciding.approve, note);
          if (res.error) return { error: res.error };
          notify(deciding.approve ? "Policy change approved and applied." : "Policy change rejected.");
          reload();
          return {};
        }} />
    </div>
  );
}

const NUM = { annual_entitlement: [0, 366, 0.5], carry_forward_max: [0, 366, 0.5], carry_forward_expiry_months: [1, 12, 1], requires_document_after_days: [0, 366, 0.5],
  max_negative: [0, 366, 0.5], sort_order: [0, 1000, 1], min_days_per_request: [0.5, 366, 0.5], max_days_per_request: [0.5, 366, 0.5], min_notice_days: [0, 365, 1] };
const BOOL = ["paid", "allow_half_day", "allow_during_probation", "allow_negative", "counts_weekends", "counts_holidays", "active"];

function PolicyModal({ row, empTypes, onClose, onSaved }) {
  const isNew = !row.id;
  const initial = useMemo(() => {
    const base = isNew ? { code: "", name: "", description: "", paid: true, annual_entitlement: 0, accrual: "annual", carry_forward_max: 0, allow_half_day: true,
      allow_during_probation: true, allow_negative: false, counts_weekends: false, counts_holidays: false, active: true, sort_order: 10, eligible_employment_types: [] } : row;
    const v = {};
    for (const k of [...POLICY_FIELDS, "code"]) v[k] = base[k] ?? (k === "eligible_employment_types" ? [] : BOOL.includes(k) ? false : "");
    return v;
  }, [row, isNew]);
  const [v, setV] = useState(initial);
  const [reason, setReason] = useState("");
  const [effective, setEffective] = useState("");
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));

  function normalise(k, val) {
    if (NUM[k]) return val === "" || val == null ? null : Number(val);
    if (BOOL.includes(k)) return Boolean(val);
    if (k === "eligible_employment_types") return val?.length ? val : null;
    if (k === "effective_from" || k === "effective_to" || k === "description") return val || null;
    return typeof val === "string" ? val.trim() : val;
  }

  async function submit() {
    const errs = {};
    if (isNew && !/^[A-Za-z][A-Za-z0-9_]{1,15}$/.test(v.code)) errs.code = "2–16 letters, digits or _; starts with a letter.";
    if (!String(v.name).trim() || String(v.name).trim().length < 2) errs.name = "Enter a name.";
    for (const [k, [min, max]] of Object.entries(NUM)) {
      if (v[k] === "" || v[k] == null) { if (k === "annual_entitlement" || k === "carry_forward_max" || k === "sort_order") errs[k] = "Required."; continue; }
      const x = Number(v[k]);
      if (!Number.isFinite(x) || x < min || x > max) errs[k] = `Between ${min} and ${max}.`;
    }
    if (v.min_days_per_request !== "" && v.max_days_per_request !== "" && v.min_days_per_request != null && v.max_days_per_request != null
        && Number(v.max_days_per_request) < Number(v.min_days_per_request)) errs.max_days_per_request = "Must be at least the minimum.";
    if (v.effective_from && v.effective_to && v.effective_to < v.effective_from) errs.effective_to = "Must be on or after the start.";
    if (reason.trim().length < 3) errs.reason = "Explain why (at least 3 characters).";
    if (effective && effective > new Date().toISOString().slice(0, 10)) errs.effective = "Future-dated changes are not supported; approved changes apply immediately.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const changes = {};
    for (const k of POLICY_FIELDS) {
      const next = normalise(k, v[k]);
      const prev = isNew ? undefined : normalise(k, row[k]);
      if (isNew || JSON.stringify(next) !== JSON.stringify(prev)) changes[k] = next;
    }
    if (!v.allow_negative) delete changes.max_negative;   // the server clears it when negative balances are off
    if (isNew) changes.code = v.code.trim().toUpperCase();
    if (!Object.keys(changes).length) { setError("Nothing has changed."); return; }
    setBusy(true); setError(null);
    const res = await proposePolicy({ leaveType: isNew ? null : row.id, changes, reason, effectiveFrom: effective });
    setBusy(false);
    if (res.error) setError(res.error); else onSaved(res.data);
  }

  const num = (k, label, hint) => (
    <Field label={label} error={errors[k]} hint={hint}><Input type="number" step={NUM[k][2]} min={NUM[k][0]} max={NUM[k][1]} value={v[k] ?? ""} onChange={set(k)} /></Field>
  );
  const toggleType = (code) => setV((s) => ({ ...s, eligible_employment_types: s.eligible_employment_types?.includes(code) ? s.eligible_employment_types.filter((x) => x !== code) : [...(s.eligible_employment_types ?? []), code] }));

  return (
    <Modal open onClose={onClose} title={isNew ? "New leave type" : `Propose change · ${row.name}`} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Submit for approval</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Code" required={isNew} error={errors.code} hint={isNew ? "e.g. CL. Cannot be changed later." : undefined}>
          <Input value={v.code} disabled={!isNew} onChange={(e) => setV((s) => ({ ...s, code: e.target.value.toUpperCase() }))} maxLength={16} />
        </Field>
        <Field label="Name" required error={errors.name}><Input value={v.name} onChange={set("name")} maxLength={80} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea value={v.description ?? ""} onChange={set("description")} maxLength={2000} /></Field>

        <h3 className="text-sm font-bold text-[#101a3a] sm:col-span-2">Entitlement</h3>
        {num("annual_entitlement", "Annual entitlement (days)")}
        <Field label="Accrual"><Select value={v.accrual} onChange={set("accrual")} options={Object.entries(ACCRUAL_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
        {num("carry_forward_max", "Max carry forward (days)", "0 = nothing carries into the next year.")}
        {num("carry_forward_expiry_months", "Carried-forward days expire after (months)", "Blank = never expire.")}

        <h3 className="text-sm font-bold text-[#101a3a] sm:col-span-2">Eligibility</h3>
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-semibold text-[#173a52]">Employment types</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {empTypes.map((et) => <Checkbox key={et.code} label={et.name} checked={(v.eligible_employment_types ?? []).includes(et.code)} onChange={() => toggleType(et.code)} />)}
          </div>
          <p className="mt-1 text-xs text-slate-500">None ticked = every employment type.</p>
        </fieldset>
        <div className="sm:col-span-2"><Checkbox label="Allowed during probation" checked={Boolean(v.allow_during_probation)} onChange={(e) => setV((s) => ({ ...s, allow_during_probation: e.target.checked }))} /></div>

        <h3 className="text-sm font-bold text-[#101a3a] sm:col-span-2">Requests</h3>
        {num("min_notice_days", "Advance notice (days)", "Blank or 0 = no notice needed (e.g. sick leave).")}
        {num("requires_document_after_days", "Document required beyond (days)", "0 = always required. Blank = never.")}
        {num("min_days_per_request", "Minimum days per request")}
        {num("max_days_per_request", "Maximum days per request")}
        <div className="flex flex-col gap-2 sm:col-span-2">
          {[["allow_half_day", "Half days allowed"], ["counts_weekends", "Weekly-off days count as leave days"], ["counts_holidays", "Holidays count as leave days"],
            ["paid", "Paid leave (unpaid leave is reported to payroll as loss of pay)"], ["allow_negative", "Allow negative balance"]].map(([k, label]) => (
            <Checkbox key={k} label={label} checked={Boolean(v[k])} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.checked }))} />
          ))}
        </div>
        {v.allow_negative && num("max_negative", "Max negative balance (days)", "Blank = no limit.")}

        <h3 className="text-sm font-bold text-[#101a3a] sm:col-span-2">Validity</h3>
        <Field label="Leave can be taken from" error={errors.effective_from}><Input type="date" value={v.effective_from ?? ""} onChange={set("effective_from")} /></Field>
        <Field label="Leave can be taken until" error={errors.effective_to}><Input type="date" value={v.effective_to ?? ""} onChange={set("effective_to")} /></Field>
        {num("sort_order", "Sort order")}
        <div className="self-end"><Checkbox label="Active" checked={Boolean(v.active)} onChange={(e) => setV((s) => ({ ...s, active: e.target.checked }))} /></div>

        <h3 className="text-sm font-bold text-[#101a3a] sm:col-span-2">Approval</h3>
        <Field label="Reason for the change" required error={errors.reason} className="sm:col-span-2"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></Field>
        <Field label="Decision date (optional, today or earlier)" error={errors.effective}
          hint="Recorded on the policy version. An approved change applies to new requests immediately; future-dated changes are not supported. To start a type later, use “Leave can be taken from”.">
          <Input type="date" max={new Date().toISOString().slice(0, 10)} value={effective} onChange={(e) => setEffective(e.target.value)} /></Field>
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function HistoryModal({ type, onClose }) {
  const q = useHrQuery(() => listPolicyVersions(type.id), [type.id]);
  return (
    <Modal open onClose={onClose} title={`Policy history · ${type.name}`} size="lg" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : (
        <ol className="flex flex-col gap-2">
          {(q.data ?? []).map((ver, i, all) => {
            const prev = all[i + 1]?.snapshot;
            const diff = prev ? Object.keys(POLICY_LABELS).filter((k) => JSON.stringify(ver.snapshot?.[k]) !== JSON.stringify(prev?.[k])) : [];
            return (
              <li key={ver.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><Badge tone="blue">v{ver.version}</Badge><span>{formatDateTime(ver.created_at)}</span>{ver.effective_from && <span>effective {formatDate(ver.effective_from)}</span>}{ver.change_id ? <Badge tone="green">approved change</Badge> : <Badge>system</Badge>}</div>
                {prev ? (diff.length ? (
                  <ul className="mt-1 text-xs text-slate-700">{diff.map((k) => <li key={k}><span className="font-semibold">{POLICY_LABELS[k]}:</span> <span className="text-slate-400 line-through">{fmtValue(k, prev[k])}</span> {fmtValue(k, ver.snapshot[k])}</li>)}</ul>
                ) : <p className="mt-1 text-xs text-slate-500">No policy field changed.</p>) : <p className="mt-1 text-xs text-slate-500">Initial version: {n(ver.snapshot?.annual_entitlement)} days/year, {ver.snapshot?.accrual} accrual.</p>}
              </li>
            );
          })}
        </ol>
      )}
    </Modal>
  );
}

