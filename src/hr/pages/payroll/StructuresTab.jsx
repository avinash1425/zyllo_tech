// Salary structures: draft -> submitted -> approved (maker-checker), revisions
// with effective dates (history kept), end-dating, monthly breakdown preview.
// The server refuses any change to the signed-in user's own structure.
import { useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, formatMoney, fullName, useHrQuery } from "@/lib/hr/client";
import { useEmployeeOptions } from "@/lib/hr/org";
import {
  MONEY, STRUCTURE_STATUSES, approveStructure, archiveStructure, deleteStructureItem, endStructure, listComponents, listStructureItems, listStructures,
  previewStructure, rejectStructure, reviseStructure, saveStructure, saveStructureItem, submitStructure,
} from "@/lib/hr/payroll";
import { Badge, Button, ConfirmDialog, DataTable, Field, InlineError, Input, Loading, Modal, Select, Textarea, Toolbar, useToast } from "@/hr/ui";
import { StatutoryWarning } from "@/hr/settings/SalaryComponentsSettings";
import { EmpCell, SelfNote, StructureBadge, friendly, label } from "./shared";

export default function StructuresTab() {
  const { hr, user, hasPermission } = useAuth();
  const { notify } = useToast();
  const employees = useEmployeeOptions({ includeInactive: true });
  const [employee, setEmployee] = useState("");
  const [status, setStatus] = useState("");
  const q = useHrQuery(() => listStructures(employee, { status }), [employee, status]);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(null);
  const [action, setAction] = useState(null);
  const canManage = hasPermission("payroll.manage");
  const canApprove = hasPermission("payroll.approve");
  const me = hr?.employee?.id;
  const isMine = (r) => me && r.employee_id === me;

  const ACTIONS = {
    submit: { title: "Submit for approval?", confirm: "Submit", reasonLabel: "Note for the approver (optional)", run: (r, note) => submitStructure(r.id, note), done: "Submitted for approval." },
    approve: { title: "Approve salary structure?", confirm: "Approve", tone: "success", reasonLabel: "Approval note (optional)",
      message: "It becomes active from its effective date. Any earlier approved structure is end-dated the day before.", run: (r, note) => approveStructure(r.id, note),
      done: (d) => `Approved.${d?.ended_structures?.length ? " The previous structure was end-dated." : ""}${d?.retroactive ? " It is retroactive to an approved payroll period — raise a correction for any arrears." : ""}` },
    reject: { title: "Return for correction?", confirm: "Return", tone: "danger", requireReason: true, reasonLabel: "Reason", run: (r, note) => rejectStructure(r.id, note), done: "Returned to the preparer." },
    archive: { title: "Archive this draft?", confirm: "Archive", tone: "danger", message: "Archived drafts are kept for history and never used.", run: (r) => archiveStructure(r.id), done: "Draft archived." },
  };

  return (
    <>
      <StatutoryWarning />
      <Toolbar>
        <Field label="Employee" className="sm:w-72"><Select placeholder="All employees" value={employee} onChange={(e) => setEmployee(e.target.value)} options={employees.data ?? []} /></Field>
        <Field label="Status" className="sm:w-48"><Select placeholder="Any" value={status} onChange={(e) => setStatus(e.target.value)} options={STRUCTURE_STATUSES.map((s) => ({ value: s, label: s === "rejected" ? "returned" : label(s) }))} /></Field>
        <div className="flex-1" />
        {canManage && <Button className="self-end" onClick={() => setEditing({ employee_id: employee, currency: "INR" })}><Plus className="h-4 w-4" aria-hidden="true" />New structure</Button>}
      </Toolbar>
      <DataTable caption="Salary structures" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} onRowClick={setOpen}
        emptyTitle="No salary structures" emptyDescription="Employees are only paid when they have an approved structure for the period."
        columns={[
          { key: "employee", header: "Employee", render: (r) => <EmpCell e={r.employee} /> },
          { key: "effective", header: "Effective", render: (r) => `${formatDate(r.effective_from)} – ${r.effective_to ? formatDate(r.effective_to) : "open"}` },
          { key: "annual_ctc", header: "Annual CTC", render: (r) => formatMoney(r.annual_ctc, r.currency) },
          { key: "status", header: "Status", render: (r) => <span className="flex flex-col gap-0.5"><StructureBadge status={r.status} />{r.revision_of && <span className="text-[11px] text-slate-500">revision</span>}</span> },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => {
            if (isMine(r)) return <span className="text-xs text-slate-500">Own structure — handled by another payroll user</span>;
            const preparedByMe = user?.id && (user.id === r.created_by || user.id === r.submitted_by);
            return (
              <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()} role="presentation">
                <Button size="sm" variant="ghost" onClick={() => setOpen(r)}>Details</Button>
                {canManage && ["draft", "rejected"].includes(r.status) && <><Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
                  <Button size="sm" variant="secondary" onClick={() => setAction({ key: "submit", row: r })}>Submit</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAction({ key: "archive", row: r })}>Archive</Button></>}
                {canApprove && r.status === "pending_approval" && !preparedByMe && <><Button size="sm" variant="success" onClick={() => setAction({ key: "approve", row: r })}>Approve</Button>
                  <Button size="sm" variant="danger" onClick={() => setAction({ key: "reject", row: r })}>Return</Button></>}
                {canApprove && r.status === "pending_approval" && preparedByMe && <span className="text-xs text-slate-500">Awaiting another approver</span>}
                {canManage && r.status === "active" && <Button size="sm" variant="secondary" onClick={() => setAction({ key: "revise", row: r })}>Revise</Button>}
                {canApprove && r.status === "active" && <Button size="sm" variant="ghost" onClick={() => setAction({ key: "end", row: r })}>End-date</Button>}
              </div>
            );
          } },
        ]} />
      <div className="mt-2"><SelfNote /></div>
      {editing && <StructureModal row={editing} employees={(employees.data ?? []).filter((o) => o.value !== me)} onClose={() => setEditing(null)}
        onSaved={(isNew, id) => { setEditing(null); q.reload(); notify(isNew ? "Draft created. Add its components, then submit for approval." : "Draft updated."); if (isNew) setOpen({ ...editing, id, status: "draft" }); }} />}
      {open && <StructureDetailModal structure={open} canManage={canManage && ["draft", "rejected"].includes(open.status) && !isMine(open)} onClose={() => { setOpen(null); q.reload(); }} />}
      {action && ACTIONS[action.key] && (
        <ConfirmDialog open onClose={() => setAction(null)} title={ACTIONS[action.key].title} confirmLabel={ACTIONS[action.key].confirm} tone={ACTIONS[action.key].tone}
          message={ACTIONS[action.key].message ?? `${fullName(action.row.employee)} · effective ${formatDate(action.row.effective_from)}`}
          requireReason={ACTIONS[action.key].requireReason} reasonLabel={ACTIONS[action.key].reasonLabel}
          onConfirm={async (note) => {
            const res = await ACTIONS[action.key].run(action.row, note);
            if (res.error) return { error: friendly(res.error) };
            const done = ACTIONS[action.key].done;
            notify(typeof done === "function" ? done(res.data) : done); q.reload();
            return {};
          }} />
      )}
      {action?.key === "revise" && <ReviseModal row={action.row} onClose={() => setAction(null)} onDone={(id) => { setAction(null); q.reload(); notify("Revision draft created with the current components. Adjust and submit it."); setOpen({ ...action.row, id, status: "draft", revision_of: action.row.id }); }} />}
      {action?.key === "end" && <EndModal row={action.row} onClose={() => setAction(null)} onDone={() => { setAction(null); q.reload(); notify("Structure end-dated."); }} />}
    </>
  );
}

function StructureModal({ row, employees, onClose, onSaved }) {
  const [v, setV] = useState({ employee_id: "", effective_from: "", effective_to: "", annual_ctc: "", currency: "INR", notes: "", ...row });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    const errs = {};
    if (!v.employee_id) errs.employee_id = "Choose an employee.";
    if (!v.effective_from) errs.effective_from = "Required.";
    if (v.effective_to && v.effective_from && v.effective_to < v.effective_from) errs.effective_to = "Must be on or after the start.";
    if (!MONEY.test(String(v.annual_ctc).trim()) || Number(v.annual_ctc) < 0) errs.annual_ctc = "Enter a non-negative amount (max 2 decimals).";
    if (!/^[A-Za-z]{3}$/.test(v.currency ?? "")) errs.currency = "3-letter code.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await saveStructure(v);
    setBusy(false);
    if (res.error) setError(friendly(res.error)); else onSaved(!row.id, res.data?.id);
  }
  return (
    <Modal open onClose={onClose} title={row.id ? "Edit draft salary structure" : "New salary structure (draft)"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save draft</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Employee" required error={errors.employee_id} className="sm:col-span-2"><Select placeholder="Choose employee" disabled={Boolean(row.id)} value={v.employee_id} onChange={set("employee_id")} options={employees} /></Field>
        <Field label="Effective from" required error={errors.effective_from}><Input type="date" value={v.effective_from} onChange={set("effective_from")} /></Field>
        <Field label="Effective to" error={errors.effective_to} hint="Blank = open-ended."><Input type="date" value={v.effective_to ?? ""} onChange={set("effective_to")} /></Field>
        <Field label="Annual CTC" required error={errors.annual_ctc} hint="Cost to company, for reference. Monthly pay comes from the components."><Input type="number" min="0" step="0.01" value={v.annual_ctc} onChange={set("annual_ctc")} /></Field>
        <Field label="Currency" required error={errors.currency}><Input maxLength={3} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })} /></Field>
        <Field label="Pay frequency"><Input value="Monthly" disabled /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea maxLength={2000} value={v.notes ?? ""} onChange={set("notes")} /></Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">Saved as a draft. Add components, then submit; a different payroll approver activates it. You cannot prepare your own structure.</p>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function StructureDetailModal({ structure, canManage, onClose }) {
  const { notify } = useToast();
  const items = useHrQuery(() => listStructureItems(structure.id), [structure.id]);
  const preview = useHrQuery(() => previewStructure(structure.id), [structure.id, items.data]);
  const components = useHrQuery(() => listComponents(), []);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const used = new Set((items.data ?? []).map((i) => i.component_id));
  const p = preview.data;
  const cur = structure.currency || "INR";
  return (
    <Modal open onClose={onClose} size="lg" title={`Salary structure · ${structure.employee ? fullName(structure.employee) : ""}`} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">{formatDate(structure.effective_from)} – {structure.effective_to ? formatDate(structure.effective_to) : "open"} · <StructureBadge status={structure.status} /></p>
        {canManage && <Button size="sm" onClick={() => setEditing({ structure_id: structure.id })}><Plus className="h-4 w-4" aria-hidden="true" />Add component</Button>}
      </div>
      {structure.decision_note && <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"><strong>{structure.status === "rejected" ? "Returned:" : "Note:"}</strong> {structure.decision_note}</p>}
      {structure.revision_reason && <p className="mb-3 text-sm text-slate-600">Revision reason: {structure.revision_reason}</p>}
      {preview.loading && !p ? <Loading /> : p && (
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-slate-200 p-3 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-slate-500">Monthly gross</p><p className="font-bold">{formatMoney(p.gross, cur)}</p></div>
          <div><p className="text-xs text-slate-500">Fixed deductions</p><p className="font-bold">{formatMoney(p.deductions, cur)}</p></div>
          <div><p className="text-xs text-slate-500">Net before statutory</p><p className="font-bold">{formatMoney(p.net_before_statutory, cur)}</p></div>
          <div><p className="text-xs text-slate-500">Annual gross (×12)</p><p className="font-bold">{formatMoney(p.annual_gross, cur)}</p></div>
        </div>
      )}
      <DataTable caption="Structure components" rows={p?.lines ?? []} rowKey="code" loading={items.loading} error={items.error} onRetry={items.reload} emptyTitle="No components yet"
        columns={[
          { key: "name", header: "Component", render: (r) => <span>{r.name} <span className="font-mono text-xs text-slate-400">{r.code}</span></span> },
          { key: "kind", header: "Kind", render: (r) => `${label(r.kind)}${r.component_type === "variable" ? " · variable" : ""}` },
          { key: "calc", header: "Basis", render: (r) => (r.percent != null ? `${Number(r.percent)}% · ${label(r.calc_type)}` : label(r.calc_type)) },
          { key: "amount", header: "Monthly", render: (r) => <span className={r.applied ? "" : "text-slate-400 line-through"}>{formatMoney(r.amount, cur)}</span> },
          { key: "note", header: "", render: (r) => (r.note ? <Badge tone="amber">{r.note}</Badge> : null) },
          ...(canManage ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => {
            const it = (items.data ?? []).find((i) => i.component?.code === r.code);
            return it && <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setEditing(it)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => setRemoving(it)}>Remove</Button></div>;
          } }] : []),
        ]} />
      <p className="mt-2 text-xs text-slate-500">Statutory deductions (PF, ESI, PT, TDS) are not part of the structure; they come from validated statutory rules at payroll time. Amounts are rounded half-up to 2 decimals per line.</p>
      {editing && <StructureItemModal row={editing} components={(components.data ?? []).filter((c) => c.id === editing.component_id || (c.active && !used.has(c.id) && c.category !== "statutory"))} currency={cur}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); items.reload(); notify("Component saved."); }} />}
      <ConfirmDialog open={Boolean(removing)} onClose={() => setRemoving(null)} title="Remove component?" tone="danger" confirmLabel="Remove"
        message={removing ? `${removing.component?.name} will be removed from this draft.` : ""}
        onConfirm={async () => {
          const res = await deleteStructureItem(removing.id);
          if (res.error) return { error: friendly(res.error) };
          items.reload(); notify("Component removed.");
          return {};
        }} />
    </Modal>
  );
}

function StructureItemModal({ row, components, currency, onClose, onSaved }) {
  const [v, setV] = useState({ component_id: "", ...row, amount: row.amount ?? "", percent: row.percent ?? "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const comp = components.find((c) => c.id === v.component_id) ?? row.component;
  const isPct = comp && ["percent_of_basic", "percent_of_gross"].includes(comp.calc_type);
  async function save() {
    if (!v.component_id) { setError("Choose a component."); return; }
    if (isPct) {
      if (v.percent === "" && comp.default_value == null) { setError("Enter a percentage."); return; }
      if (v.percent !== "" && !(Number(v.percent) >= 0 && Number(v.percent) <= 100)) { setError("Percentage must be between 0 and 100."); return; }
    } else {
      if (comp?.calc_type === "fixed" && v.amount === "") { setError("Enter a monthly amount."); return; }
      if (v.amount !== "" && (!MONEY.test(String(v.amount).trim()) || Number(v.amount) < 0)) { setError("Enter a non-negative amount (max 2 decimals)."); return; }
    }
    setBusy(true); setError(null);
    const res = await saveStructureItem({ ...v, amount: isPct ? null : v.amount, percent: isPct ? v.percent : null });
    setBusy(false);
    if (res.error) setError(friendly(res.error)); else onSaved();
  }
  return (
    <Modal open onClose={onClose} title={row.id ? "Edit component" : "Add component"} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Component" required><Select placeholder="Choose component" disabled={Boolean(row.id)} value={v.component_id} onChange={(e) => setV({ ...v, component_id: e.target.value })}
          options={components.map((c) => ({ value: c.id, label: `${c.code} · ${c.name} (${label(c.kind)}${c.component_type === "variable" ? ", variable" : ""}, ${label(c.calc_type)})${c.requires_verification ? " – unverified" : ""}` }))} /></Field>
        {comp && (isPct
          ? <Field label="Percentage" hint={comp.default_value != null ? `Blank uses the default ${Number(comp.default_value)}%.` : undefined}><Input type="number" min="0" max="100" step="0.0001" value={v.percent} onChange={(e) => setV({ ...v, percent: e.target.value })} /></Field>
          : <Field label={`Monthly amount (${currency})`} required={comp.calc_type === "fixed"}><Input type="number" min="0" step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>)}
        {comp?.requires_verification && <p className="text-xs text-amber-800">This component is unverified and will be skipped by the calculator until verified.</p>}
        {comp?.effective_from && <p className="text-xs text-slate-500">Component effective from {formatDate(comp.effective_from)}{comp.effective_to ? ` to ${formatDate(comp.effective_to)}` : ""}.</p>}
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function ReviseModal({ row, onClose, onDone }) {
  const [v, setV] = useState({ effectiveFrom: "", reason: "", annualCtc: row.annual_ctc ?? "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!v.effectiveFrom || v.effectiveFrom <= row.effective_from) { setError(`The revision must start after ${formatDate(row.effective_from)}.`); return; }
    if (v.reason.trim().length < 3) { setError("Give a reason for the revision."); return; }
    if (v.annualCtc !== "" && !MONEY.test(String(v.annualCtc).trim())) { setError("Annual CTC: a non-negative amount (max 2 decimals)."); return; }
    setBusy(true); setError(null);
    const res = await reviseStructure({ id: row.id, ...v });
    setBusy(false);
    if (res.error) setError(friendly(res.error)); else onDone(res.data);
  }
  return (
    <Modal open onClose={onClose} title="Salary revision" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Create revision draft</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">Copies the current components into a new draft. When approved, the current structure ends the day before the revision starts. History is preserved; finalized payslips never change.</p>
        <Field label="Effective from" required><Input type="date" min={row.effective_from} value={v.effectiveFrom} onChange={(e) => setV({ ...v, effectiveFrom: e.target.value })} /></Field>
        <Field label="New annual CTC"><Input type="number" min="0" step="0.01" value={v.annualCtc} onChange={(e) => setV({ ...v, annualCtc: e.target.value })} /></Field>
        <Field label="Reason" required><Textarea maxLength={1000} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="e.g. Annual increment" /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function EndModal({ row, onClose, onDone }) {
  const [v, setV] = useState({ effectiveTo: "", reason: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!v.effectiveTo || v.effectiveTo < row.effective_from) { setError("Choose an end date on or after the start date."); return; }
    if (v.reason.trim().length < 3) { setError("Give a reason."); return; }
    setBusy(true); setError(null);
    const res = await endStructure({ id: row.id, ...v });
    setBusy(false);
    if (res.error) setError(friendly(res.error)); else onDone();
  }
  return (
    <Modal open onClose={onClose} title="End-date salary structure" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={go}>End-date</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Last day" required><Input type="date" min={row.effective_from} value={v.effectiveTo} onChange={(e) => setV({ ...v, effectiveTo: e.target.value })} /></Field>
        <Field label="Reason" required><Textarea maxLength={1000} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
        <p className="text-xs text-slate-500">Approved {formatDateTime(row.approved_at)}. Finalized payroll is unaffected.</p>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}
