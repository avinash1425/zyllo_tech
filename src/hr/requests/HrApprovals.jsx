// Module 10 — HR Operations: requests overview (KPIs from database records),
// the centralized approval inbox (requests + Module 5 attendance
// corrections) and request configuration (routing per type, policies).
// Every count and row comes from hr_requests_overview / hr_approval_inbox,
// which apply the same visibility rules as RLS on the server.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, Inbox, RotateCcw, Settings2, SlidersHorizontal, UserCheck, XCircle } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { useEmployeeOptions, useOrg, toOptions } from "@/lib/hr/org";
import { formatTimeRange } from "@/hr/requests/time";
import {
  INBOX_BOXES, NEXT_ACTION_LABELS, STAGE_LABELS, WORKFLOW_LABELS, approvalInbox, decideAttendanceCorrection, listWorkflowCategories,
  requestPolicies, requestsOverview, saveRequestPolicy, setCategoryRouting, stageLabel,
} from "@/lib/hr/requestWorkflows";
import { RequestStatusBadge, WorkflowBadge } from "@/hr/requests/RequestWidgets";
import {
  Badge, Button, Card, Checkbox, DataTable, ErrorState, Field, InlineError, Input, KpiCard, Loading, Modal, SearchInput, Select,
  Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";

const label = (s) => String(s ?? "").replace(/_/g, " ");
const TYPE_OPTIONS = Object.entries(WORKFLOW_LABELS).map(([value, l]) => ({ value, label: l }));
const STATUS_OPTIONS = ["draft", "open", "in_progress", "waiting_on_employee", "pending_approval", "returned", "approved", "rejected", "resolved", "completed", "closed", "cancelled"]
  .map((s) => ({ value: s, label: label(s) }));

// ----------------------------------------------------------------- filters
const EMPTY_FILTERS = { workflow: "", employee: "", department: "", legal_entity: "", status: "", approver: "", from: "", to: "", search: "" };
export function useRequestFilters(initial) {
  const [f, setF] = useState(() => ({ ...EMPTY_FILTERS, ...(initial ?? {}) }));
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: typeof e === "string" ? e : e.target.value }));
  return [f, set, setF];
}

export function RequestFilters({ f, set, showStatus = true }) {
  const org = useOrg();
  const employees = useEmployeeOptions();
  const empOpts = employees.data ?? [];
  // On phones the secondary filters fold behind a toggle so the list stays in view.
  const [open, setOpen] = useState(false);
  const active = ["workflow", "status", "employee", "department", "legal_entity", "approver", "from", "to"].filter((k) => f[k]).length;
  return (
    <Toolbar>
      <SearchInput value={f.search} onChange={set("search")} placeholder="Search subject, employee or ID…" label="Search requests" />
      <Button type="button" size="sm" variant="secondary" className="sm:hidden" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />{open ? "Hide filters" : `Filters${active ? ` (${active})` : ""}`}
      </Button>
      <div className={`${open ? "flex flex-col gap-2" : "hidden"} sm:contents`}>
      <Select aria-label="Request type" className="sm:w-44" placeholder="All types" value={f.workflow} onChange={set("workflow")} options={TYPE_OPTIONS} />
      {showStatus && <Select aria-label="Status" className="sm:w-44" placeholder="Any status" value={f.status} onChange={set("status")} options={STATUS_OPTIONS} />}
      <Select aria-label="Employee" className="sm:w-48" placeholder="Any employee" value={f.employee} onChange={set("employee")} options={empOpts} />
      <Select aria-label="Department" className="sm:w-44" placeholder="Any department" value={f.department} onChange={set("department")} options={toOptions(org.data?.departments)} />
      {(org.data?.legalEntities ?? []).length > 1 && (
        <Select aria-label="Company" className="sm:w-44" placeholder="Any company" value={f.legal_entity} onChange={set("legal_entity")} options={toOptions(org.data?.legalEntities)} />
      )}
      <Select aria-label="Approver" className="sm:w-48" placeholder="Any approver" value={f.approver} onChange={set("approver")} options={empOpts} />
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">From<Input type="date" value={f.from} onChange={set("from")} aria-label="Submitted from" /></label>
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">To<Input type="date" value={f.to} min={f.from || undefined} onChange={set("to")} aria-label="Submitted to" /></label>
      </div>
    </Toolbar>
  );
}

// ---------------------------------------------------------------- overview
export function RequestsOverview({ onOpenBox }) {
  const [f, set] = useRequestFilters();
  const key = JSON.stringify(f);
  const ov = useHrQuery(() => requestsOverview(f), [key]);
  const o = ov.data ?? {};
  const cards = [
    { box: "all", label: "Total requests", value: o.total, icon: ClipboardList, tone: "navy" },
    { box: "pending", label: "Pending", value: o.pending, icon: Clock, tone: "orange" },
    { box: "assigned", label: "Awaiting my action", value: o.awaiting_me, icon: UserCheck, tone: "teal" },
    { box: "overdue", label: "Overdue", value: o.overdue, icon: AlertTriangle, tone: "red" },
    { box: "approved", label: "Approved (fulfilment)", value: o.approved, icon: CheckCircle2, tone: "green" },
    { box: "returned", label: "Returned for correction", value: o.returned, icon: RotateCcw, tone: "slate" },
    { box: "rejected", label: "Rejected", value: o.rejected, icon: XCircle, tone: "red" },
    { box: "completed", label: "Completed", value: o.completed, icon: CheckCircle2, tone: "green" },
  ];
  return (
    <>
      <RequestFilters f={f} set={set} showStatus={false} />
      {ov.error ? <ErrorState message={ov.error} onRetry={ov.reload} /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((c) => <KpiCard key={c.box} label={c.label} value={c.value} icon={c.icon} tone={c.tone} loading={ov.loading && !ov.data} onClick={() => onOpenBox(c.box, f)} />)}
          </div>
          {o.by_type && Object.keys(o.by_type).length > 0 && (
            <Card title="By request type" className="mt-4">
              <ul className="flex flex-wrap gap-2">
                {Object.entries(o.by_type).map(([w, n]) => <li key={w} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-sm"><WorkflowBadge workflow={w} /><span className="font-bold">{n}</span></li>)}
              </ul>
            </Card>
          )}
          {o.generated_at && <p className="mt-3 text-xs text-slate-500">Counted from database records you are allowed to see · {formatDateTime(o.generated_at)}</p>}
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------- inbox
function AttendanceDecisionModal({ row, onClose, onDone }) {
  const { notify } = useToast();
  const [approve, setApprove] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit() {
    if (!approve && !note.trim()) { setError("Please give a reason for rejecting."); return; }
    setBusy(true); setError(null);
    const res = await decideAttendanceCorrection(row.id, approve, note);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(approve ? "Correction approved. Attendance was updated by the Attendance service." : "Correction rejected.");
    onDone();
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title="Attendance correction" size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button variant={approve ? "success" : "danger"} loading={busy} onClick={submit}>{approve ? "Approve" : "Reject"}</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <p><span className="font-semibold">{row.employee_name}</span> ({row.employee_code}) · {formatDate(row.work_date)}</p>
        {row.request_type && <p>Type: {label(row.request_type)}</p>}
        <p>Requested: {formatTimeRange(row.requested_check_in_at, row.requested_check_out_at)}{row.requested_status ? ` · status ${label(row.requested_status)}` : ""}</p>
        <p className="whitespace-pre-line text-slate-700">Reason: {row.reason}</p>
        {row.evidence_note && <p className="text-slate-700">Evidence: {row.evidence_note}</p>}
        <p className="text-xs text-slate-500">Decided by the Attendance &amp; Time service; the original punch data is kept and the change is audited.</p>
        <Field label="Decision"><Select value={approve ? "1" : "0"} onChange={(e) => setApprove(e.target.value === "1")} options={[{ value: "1", label: "Approve" }, { value: "0", label: "Reject" }]} /></Field>
        <Field label="Note" required={!approve}><Textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

export function ApprovalInbox({ initialBox = "assigned", initialFilters, onBoxChange }) {
  const navigate = useNavigate();
  const [box, setBoxState] = useState(INBOX_BOXES.some((b) => b.value === initialBox) ? initialBox : "assigned");
  const setBox = (b) => { setBoxState(b); onBoxChange?.(b); };
  const [filters, set] = useRequestFilters(initialFilters);
  const key = JSON.stringify(filters);
  const list = useHrQuery(() => approvalInbox(box, filters), [box, key]);
  const ov = useHrQuery(() => requestsOverview(filters), [key]);
  const [att, setAtt] = useState(null);
  const counts = { assigned: ov.data?.awaiting_me, pending: ov.data?.pending, overdue: ov.data?.overdue, approved: ov.data?.approved,
                   returned: ov.data?.returned, rejected: ov.data?.rejected, completed: ov.data?.completed, all: ov.data?.total };
  const open = (r) => (r.source === "attendance_correction" ? (r.next_action === "decide" ? setAtt(r) : navigate("/hr/attendance")) : navigate(`/hr/requests/${r.id}`));
  return (
    <>
      <Tabs label="Inbox" value={box} onChange={setBox} tabs={INBOX_BOXES.map((b) => ({ ...b, count: counts[b.value] }))} />
      <RequestFilters f={filters} set={set} />
      <DataTable caption="Approval inbox" rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
        rowKey={(r) => `${r.source}:${r.id}`} onRowClick={open}
        emptyTitle={box === "assigned" ? "Nothing is waiting for you" : "No requests match"} emptyDescription="Adjust the filters or choose another box."
        columns={[
          { key: "subject", header: "Request", render: (r) => (
            <div className="min-w-[14rem]">
              <p className="font-semibold text-[#101a3a]">{r.subject}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500"><WorkflowBadge workflow={r.workflow} />{r.category && r.workflow === "helpdesk" ? r.category : null}</p>
            </div>) },
          { key: "employee", header: "Employee", render: (r) => <div><p>{r.employee_name}</p><p className="text-xs text-slate-500">{r.employee_code}{r.department ? ` · ${r.department}` : ""}</p></div> },
          { key: "status", header: "Status", render: (r) => <div className="flex flex-col items-start gap-1"><RequestStatusBadge status={r.status} />{r.stage_role && <span className="text-xs text-slate-500">{stageLabel(r.stage_role)} stage</span>}</div> },
          { key: "next_action", header: "Your action", render: (r) => (r.next_action ? <Badge tone="orange">{NEXT_ACTION_LABELS[r.next_action] ?? label(r.next_action)}</Badge> : <span className="text-slate-400">—</span>) },
          { key: "submitted_at", header: "Submitted", sortable: true, render: (r) => formatDateTime(r.submitted_at) },
          { key: "sla_due_at", header: "Due", sortable: true, render: (r) => (
            <span className={r.overdue ? "inline-flex items-center gap-1 font-semibold text-rose-700" : ""}>
              {r.overdue && <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}{formatDateTime(r.sla_due_at)}{r.overdue && <span className="sr-only"> (overdue)</span>}
            </span>) },
        ]} />
      {att && <AttendanceDecisionModal row={att} onClose={() => setAtt(null)} onDone={() => { setAtt(null); list.reload(); ov.reload(); }} />}
    </>
  );
}

// ----------------------------------------------------------- configuration
function RoutingModal({ category, onClose, onDone }) {
  const { notify } = useToast();
  const [stages, setStages] = useState(category.approval_stages ?? []);
  const [attach, setAttach] = useState(category.requires_attachment);
  const [sla, setSla] = useState(String(category.sla_hours ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const toggle = (s) => setStages((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));
  const move = (i, d) => setStages((x) => { const y = [...x]; const j = i + d; if (j < 0 || j >= y.length) return y; [y[i], y[j]] = [y[j], y[i]]; return y; });
  async function save() {
    if (!stages.length) { setError("Choose at least one approval stage."); return; }
    setBusy(true); setError(null);
    const res = await setCategoryRouting(category.id, stages, attach, sla);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Routing saved.");
    onDone();
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title={`Approval route — ${category.name}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">Stages run in order. Only the stages you choose are used — requests do not pass through every department.</p>
        <div className="flex flex-wrap gap-3">{Object.keys(STAGE_LABELS).map((s) => <Checkbox key={s} label={STAGE_LABELS[s]} checked={stages.includes(s)} onChange={() => toggle(s)} />)}</div>
        <ol className="flex flex-col gap-1">
          {stages.map((s, i) => (
            <li key={s} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
              <span>{i + 1}. {STAGE_LABELS[s]}</span>
              <span className="flex gap-1"><Button size="sm" variant="ghost" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>↑</Button><Button size="sm" variant="ghost" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === stages.length - 1}>↓</Button></span>
            </li>
          ))}
        </ol>
        {category.workflow === "profile_change" && <p className="text-xs text-slate-500">Bank detail changes are always reviewed by Payroll in addition to this route.</p>}
        {stages.includes("manager") && <p className="text-xs text-slate-500">When an employee has no manager who can approve, the manager stage is handled by HR.</p>}
        <Checkbox label="Attachment required (e.g. receipt)" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
        <Field label="Response target (hours)"><Input type="number" min={1} max={2160} value={sla} onChange={(e) => setSla(e.target.value)} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function PolicyCard({ title, policyKey, value, fields, canEdit, onSaved, description }) {
  const { notify } = useToast();
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cur = v ?? value ?? {};
  const set = (k, t) => (e) => setV({ ...cur, [k]: t === "bool" ? e.target.checked : e.target.value });
  async function save() {
    const out = {};
    for (const fl of fields) {
      const x = cur[fl.key];
      if (fl.type === "bool") out[fl.key] = Boolean(x);
      else if (fl.type === "list") out[fl.key] = String(Array.isArray(x) ? x.join(",") : x ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      else out[fl.key] = x === "" || x === null || x === undefined ? (fl.nullable ? null : x) : Number(x);
    }
    setBusy(true); setError(null);
    const res = await saveRequestPolicy(policyKey, out);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Policy saved.");
    setV(null);
    onSaved();
  }
  return (
    <Card title={title} actions={canEdit && <Button size="sm" loading={busy} onClick={save} disabled={!v}>Save</Button>}>
      {description && <p className="mb-3 text-sm text-slate-600">{description}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((fl) => fl.type === "bool" ? (
          <Checkbox key={fl.key} label={fl.label} checked={Boolean(cur[fl.key])} disabled={!canEdit} onChange={set(fl.key, "bool")} />
        ) : (
          <Field key={fl.key} label={fl.label} hint={fl.hint}>
            <Input type={fl.type === "list" ? "text" : "number"} disabled={!canEdit} value={Array.isArray(cur[fl.key]) ? cur[fl.key].join(", ") : cur[fl.key] ?? ""} onChange={set(fl.key)} />
          </Field>
        ))}
      </div>
      <InlineError message={error} />
    </Card>
  );
}

export function RequestConfiguration() {
  const { hasPermission } = useAuth();
  const canRoute = hasPermission("settings.manage") || hasPermission("hr_requests.manage");
  const canPolicy = hasPermission("settings.manage");
  const cats = useHrQuery(() => listWorkflowCategories(), []);
  const pol = useHrQuery(() => requestPolicies(), []);
  const [editing, setEditing] = useState(null);
  const workflowCats = useMemo(() => (cats.data ?? []).filter((c) => c.workflow !== "helpdesk"), [cats.data]);
  return (
    <div className="flex flex-col gap-4">
      <Card title={<span className="inline-flex items-center gap-2"><Settings2 className="h-4 w-4" aria-hidden="true" />Approval routing by request type</span>}>
        <DataTable caption="Request routing" rows={workflowCats} loading={cats.loading} error={cats.error} onRetry={cats.reload}
          onRowClick={canRoute ? (c) => setEditing(c) : undefined}
          columns={[
            { key: "name", header: "Request type", render: (c) => <div><p className="font-semibold text-[#101a3a]">{c.name}</p><WorkflowBadge workflow={c.workflow} /></div> },
            { key: "approval_stages", header: "Route", render: (c) => <span className="text-sm">Employee → {(c.approval_stages ?? []).map((s) => STAGE_LABELS[s]).join(" → ")}</span> },
            { key: "requires_attachment", header: "Attachment", render: (c) => (c.requires_attachment ? "Required" : "Optional") },
            { key: "sla_hours", header: "Target", render: (c) => `${c.sla_hours} h` },
            { key: "active", header: "Offered", render: (c) => (c.active ? <Badge tone="green">active</Badge> : <Badge>off</Badge>) },
          ]} />
        {!canRoute && <p className="mt-2 text-xs text-slate-500">Read-only: changing routes needs settings.manage or hr_requests.manage.</p>}
        <p className="mt-2 text-xs text-slate-500">Attendance corrections are routed by the Attendance &amp; Time settings (manager, then optional HR review).</p>
      </Card>
      {pol.loading && !pol.data ? <Loading /> : pol.error ? <ErrorState message={pol.error} onRetry={pol.reload} /> : (
        <>
          <PolicyCard title="Salary advance policy" policyKey="salary_advances" value={pol.data?.salary_advances} canEdit={canPolicy} onSaved={() => { pol.reload(); cats.reload(); }}
            description="Advances stay disabled until the company policy is approved. Nothing is paid or deducted automatically: Finance records and a second Finance user verifies each disbursement; repayments are recorded with a reference."
            fields={[
              { key: "enabled", label: "Salary advances enabled", type: "bool" },
              { key: "max_percent_of_monthly_ctc", label: "Maximum (% of monthly CTC)" },
              { key: "max_amount", label: "Absolute maximum (optional)", nullable: true },
              { key: "min_service_months", label: "Minimum service (months)" },
              { key: "max_open_advances", label: "Open advances allowed" },
              { key: "min_repayment_months", label: "Minimum repayment months" },
              { key: "max_repayment_months", label: "Maximum repayment months" },
              { key: "allow_payroll_deduction", label: "Allow payroll deduction (needs Module 7 integration and the employee's agreement)", type: "bool" },
            ]} />
          <PolicyCard title="Request rules" policyKey="hr_requests" value={pol.data?.hr_requests} canEdit={canPolicy} onSaved={pol.reload}
            fields={[
              { key: "distinct_stage_approvers", label: "A different approver for every stage", type: "bool" },
              { key: "reopen_window_days", label: "Helpdesk reopen window (days)" },
              { key: "reimbursement_max_age_days", label: "Oldest claimable expense (days)" },
              { key: "attendance_correction_sla_hours", label: "Attendance correction target (hours)" },
              { key: "reimbursement_currencies", label: "Claim currencies", type: "list", hint: "Comma-separated ISO codes, e.g. INR, USD" },
            ]} />
          {!canPolicy && <p className="text-xs text-slate-500">Read-only: changing policies needs settings.manage.</p>}
        </>
      )}
      {editing && <RoutingModal category={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); cats.reload(); }} />}
    </div>
  );
}

export const InboxIcon = Inbox;
