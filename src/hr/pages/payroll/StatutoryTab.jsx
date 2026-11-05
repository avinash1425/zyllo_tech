// Statutory components (EPF, ESI, Professional Tax, TDS, …) as effective-dated
// RULES. No legal rates are built in. A rule is applied by the calculator only
// after a different payroll approver records the professional validation.
import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, formatMoney, useHrQuery } from "@/lib/hr/client";
import { toOptions, useEmployeeOptions, useOrg } from "@/lib/hr/org";
import {
  STATUTORY_METHODS, STATUTORY_SCHEMES, approveStatutoryRule, endStatutoryRule, listComponents, listStatutoryEnrollments, listStatutoryRules,
  retireStatutoryRule, returnStatutoryRule, saveStatutoryEnrollment, saveStatutoryRule, submitStatutoryRule,
} from "@/lib/hr/payroll";
import { Badge, Button, Checkbox, ConfirmDialog, DataTable, Field, InlineError, Input, Modal, Select, Tabs, Textarea, Toolbar, useToast } from "@/hr/ui";
import { EmpCell, friendly, label } from "./shared";

const STATUS_TONE = { draft: "slate", pending_validation: "amber", approved: "green", retired: "slate" };

export default function StatutoryTab() {
  const [view, setView] = useState("rules");
  return (
    <>
      <div role="note" className="mb-4 flex gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p><strong>Pending professional validation.</strong> This system ships with rule <em>templates</em> only — no rates, wage ceilings, thresholds or slabs.
          Configure each rule from current law, then a <strong>different</strong> payroll approver records who validated it (qualified payroll / tax professional) before it is applied.
          Calculations executing does <strong>not</strong> make payroll statutorily compliant.</p>
      </div>
      <Tabs value={view} onChange={setView} label="Statutory sections" tabs={[{ value: "rules", label: "Rules" }, { value: "enrollments", label: "Employee enrolment" }]} />
      {view === "rules" ? <Rules /> : <Enrollments />}
    </>
  );
}

function Rules() {
  const { user, hasPermission } = useAuth();
  const { notify } = useToast();
  const q = useHrQuery(() => listStatutoryRules(), []);
  const [editing, setEditing] = useState(null);
  const [act, setAct] = useState(null);
  const canManage = hasPermission("payroll.manage");
  const canApprove = hasPermission("payroll.approve");
  const ACTIONS = {
    submit: { title: "Submit for professional validation?", confirm: "Submit", run: (r) => submitStatutoryRule(r.id), done: "Submitted for validation." },
    approve: { title: "Approve statutory rule?", confirm: "Approve", tone: "success", requireReason: true, reasonLabel: "Professional validation reference (who validated, date, document)",
      message: "Confirm a qualified payroll / tax professional has checked the rates, wage base, ceilings, eligibility and rounding. The calculator applies it from its effective date.",
      run: (r, note) => approveStatutoryRule(r.id, note), done: "Rule approved; it will be applied in the next calculation." },
    return: { title: "Return to draft?", confirm: "Return", tone: "danger", requireReason: true, reasonLabel: "Reason", run: (r, note) => returnStatutoryRule(r.id, note), done: "Returned to draft." },
    retire: { title: "Retire rule?", confirm: "Retire", tone: "danger", message: "Retired rules are kept for history and never applied.", run: (r) => retireStatutoryRule(r.id), done: "Rule retired." },
  };
  return (
    <>
      <Toolbar>
        <p className="flex-1 self-center text-sm text-slate-600">One row per rule version (code + state + company + effective dates). Approved versions are immutable — end-date them and add a new version.</p>
        {canManage && <Button className="self-end" onClick={() => setEditing({ scheme: "other", calc_method: "percent_of_wage", country: "IN", applies_to: "enrolled", rounding_mode: "half_up", rounding_precision: 2, eligibility_basis: "wage_base", wage_base_components: [], slabs: [] })}>
          <Plus className="h-4 w-4" aria-hidden="true" />New rule / version</Button>}
      </Toolbar>
      <DataTable caption="Statutory rules" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} onRowClick={(r) => canManage && r.status === "draft" && setEditing(r)}
        columns={[
          { key: "code", header: "Rule", render: (r) => <span><span className="font-mono text-xs font-bold text-[#1f4693]">{r.code}</span>{r.state_code ? <span className="ml-1 text-xs">({r.state_code})</span> : null}<br /><span className="text-xs text-slate-600">{r.name}</span></span> },
          { key: "effective", header: "Effective", render: (r) => `${formatDate(r.effective_from)} – ${r.effective_to ? formatDate(r.effective_to) : "open"}` },
          { key: "method", header: "Method", render: (r) => <span className="text-xs">{label(r.calc_method)}{r.calc_method === "percent_of_wage" ? ` · EE ${r.employee_rate ?? "—"}% / ER ${r.employer_rate ?? "—"}%` : ""}{r.wage_ceiling != null ? ` · ceiling ${formatMoney(r.wage_ceiling)}` : ""}</span> },
          { key: "status", header: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status]}>{label(r.status)}</Badge> },
          { key: "validated", header: "Validation", render: (r) => (r.validated_at ? <span className="text-xs">{formatDateTime(r.validated_at)}<br />{r.validation_reference}</span> : r.return_reason ? <span className="text-xs text-red-700">Returned: {r.return_reason}</span> : "—") },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (
            <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()} role="presentation">
              {canManage && r.status === "draft" && <><Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button><Button size="sm" variant="secondary" onClick={() => setAct({ k: "submit", r })}>Submit</Button></>}
              {canApprove && r.status === "pending_validation" && (user?.id === r.prepared_by || user?.id === r.created_by
                ? <span className="text-xs text-slate-500">Awaiting another approver</span>
                : <><Button size="sm" variant="success" onClick={() => setAct({ k: "approve", r })}>Approve</Button><Button size="sm" variant="danger" onClick={() => setAct({ k: "return", r })}>Return</Button></>)}
              {canManage && r.status === "approved" && <><Button size="sm" variant="ghost" onClick={() => setAct({ k: "end", r })}>End-date</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing({ ...r, id: undefined, status: "draft", effective_from: "", effective_to: null, validated_at: null })}>New version</Button></>}
              {canManage && ["draft", "approved"].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => setAct({ k: "retire", r })}>Retire</Button>}
            </div>) },
        ]} />
      {editing && <RuleModal row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); q.reload(); notify("Rule saved as draft."); }} />}
      {act && ACTIONS[act.k] && (
        <ConfirmDialog open onClose={() => setAct(null)} title={ACTIONS[act.k].title} confirmLabel={ACTIONS[act.k].confirm} tone={ACTIONS[act.k].tone}
          message={ACTIONS[act.k].message ?? `${act.r.code} · ${act.r.name}`} requireReason={ACTIONS[act.k].requireReason} reasonLabel={ACTIONS[act.k].reasonLabel}
          onConfirm={async (note) => {
            const res = await ACTIONS[act.k].run(act.r, note);
            if (res.error) return { error: friendly(res.error) };
            notify(ACTIONS[act.k].done); q.reload();
            return {};
          }} />
      )}
      {act?.k === "end" && <EndRuleModal rule={act.r} onClose={() => setAct(null)} onDone={() => { setAct(null); q.reload(); notify("Rule end-dated."); }} />}
    </>
  );
}

function EndRuleModal({ rule, onClose, onDone }) {
  const [d, setD] = useState("");
  const [error, setError] = useState(null);
  return (
    <Modal open onClose={onClose} title={`End-date ${rule.code}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={async () => {
        if (!d || d < rule.effective_from) { setError("Choose a date on or after the start date."); return; }
        const res = await endStatutoryRule(rule.id, d);
        if (res.error) setError(friendly(res.error)); else onDone();
      }}>End-date</Button></>}>
      <Field label="Last day this version applies" required><Input type="date" min={rule.effective_from} value={d} onChange={(e) => setD(e.target.value)} /></Field>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function RuleModal({ row, onClose, onSaved }) {
  const org = useOrg();
  const comps = useHrQuery(() => listComponents(), []);
  const [v, setV] = useState({ ...row, slabs: row.slabs ?? [], wage_base_components: row.wage_base_components ?? [] });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const earnings = (comps.data ?? []).filter((c) => c.kind === "earning");
  const deductions = (comps.data ?? []).filter((c) => c.kind === "deduction");
  const employer = (comps.data ?? []).filter((c) => c.kind === "employer_contribution");
  const toggleBase = (code) => setV((s) => ({ ...s, wage_base_components: s.wage_base_components.includes(code) ? s.wage_base_components.filter((x) => x !== code) : [...s.wage_base_components, code] }));
  const setSlab = (i, k, val) => setV((s) => ({ ...s, slabs: s.slabs.map((x, j) => (j === i ? { ...x, [k]: val === "" ? null : Number(val) } : x)) }));
  async function save() {
    if (!/^[A-Za-z][A-Za-z0-9_]{1,29}$/.test(v.code ?? "")) { setError("Code: 2–30 letters, digits or _."); return; }
    if ((v.name ?? "").trim().length < 2) { setError("Enter a name."); return; }
    if (!v.effective_from) { setError("Choose the effective-from date."); return; }
    if (v.effective_to && v.effective_to < v.effective_from) { setError("Effective-to must be after effective-from."); return; }
    if (v.slabs.some((s) => s.from == null)) { setError("Every slab needs a 'from' amount."); return; }
    setBusy(true); setError(null);
    const res = await saveStatutoryRule(v);
    setBusy(false);
    if (res.error) setError(friendly(res.error)); else onSaved();
  }
  return (
    <Modal open onClose={onClose} size="lg" title={row.id ? `Edit ${row.code} (draft)` : "New statutory rule version (draft)"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save draft</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Code" required><Input value={v.code ?? ""} disabled={Boolean(row.id)} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Name" required className="sm:col-span-2"><Input maxLength={160} value={v.name ?? ""} onChange={set("name")} /></Field>
        <Field label="Scheme"><Select value={v.scheme} onChange={set("scheme")} options={STATUTORY_SCHEMES.map((s) => ({ value: s, label: label(s) }))} /></Field>
        <Field label="State / jurisdiction code" hint="Blank = all. Employees match via their enrolment."><Input maxLength={3} value={v.state_code ?? ""} onChange={(e) => setV({ ...v, state_code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Company"><Select placeholder="All companies" value={v.legal_entity_id ?? ""} onChange={set("legal_entity_id")} options={toOptions(org.data?.legalEntities)} /></Field>
        <Field label="Effective from" required><Input type="date" value={v.effective_from ?? ""} onChange={set("effective_from")} /></Field>
        <Field label="Effective to"><Input type="date" value={v.effective_to ?? ""} onChange={set("effective_to")} /></Field>
        <Field label="Applies to"><Select value={v.applies_to} onChange={set("applies_to")} options={[{ value: "enrolled", label: "Enrolled employees only" }, { value: "all", label: "All unless opted out" }]} /></Field>
        <Field label="Calculation method"><Select value={v.calc_method} onChange={set("calc_method")} options={STATUTORY_METHODS.map((s) => ({ value: s, label: label(s) }))} /></Field>
        <Field label="Employee component"><Select placeholder="—" value={v.employee_component_code ?? ""} onChange={set("employee_component_code")} options={deductions.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} /></Field>
        <Field label="Employer component"><Select placeholder="—" value={v.employer_component_code ?? ""} onChange={set("employer_component_code")} options={employer.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} /></Field>
      </div>
      <fieldset className="mt-3 rounded-xl border border-slate-200 p-3">
        <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500">Wage base (earning components summed)</legend>
        <div className="flex flex-wrap gap-3">{earnings.map((c) => <Checkbox key={c.code} label={`${c.code}`} checked={v.wage_base_components.includes(c.code)} onChange={() => toggleBase(c.code)} />)}</div>
      </fieldset>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {v.calc_method === "percent_of_wage" && <>
          <Field label="Employee rate %"><Input type="number" min="0" max="100" step="0.0001" value={v.employee_rate ?? ""} onChange={set("employee_rate")} /></Field>
          <Field label="Employer rate %"><Input type="number" min="0" max="100" step="0.0001" value={v.employer_rate ?? ""} onChange={set("employer_rate")} /></Field>
          <Field label="Monthly wage ceiling" hint="Contribution base is capped here (blank = no cap)."><Input type="number" min="0" step="0.01" value={v.wage_ceiling ?? ""} onChange={set("wage_ceiling")} /></Field>
        </>}
        {v.calc_method === "fixed" && <>
          <Field label="Employee amount / month"><Input type="number" min="0" step="0.01" value={v.employee_amount ?? ""} onChange={set("employee_amount")} /></Field>
          <Field label="Employer amount / month"><Input type="number" min="0" step="0.01" value={v.employer_amount ?? ""} onChange={set("employer_amount")} /></Field>
        </>}
        <Field label="Eligibility: monthly wage at most" hint="Blank = no threshold."><Input type="number" min="0" step="0.01" value={v.eligibility_wage_max ?? ""} onChange={set("eligibility_wage_max")} /></Field>
        <Field label="Threshold / slab basis"><Select value={v.eligibility_basis} onChange={set("eligibility_basis")} options={[{ value: "wage_base", label: "Wage base" }, { value: "gross", label: "Monthly gross" }]} /></Field>
        <Field label="Rounding"><Select value={`${v.rounding_mode}:${v.rounding_precision}`} onChange={(e) => { const [m, p] = e.target.value.split(":"); setV({ ...v, rounding_mode: m, rounding_precision: Number(p) }); }}
          options={[["half_up", 2], ["half_up", 0], ["up", 0], ["down", 0], ["up", 2], ["down", 2]].map(([m, p]) => ({ value: `${m}:${p}`, label: `${label(m)} to ${p ? "paise (2 dp)" : "whole rupee"}` }))} /></Field>
      </div>
      {v.calc_method === "slab" && (
        <fieldset className="mt-3 rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500">Slabs (monthly amounts)</legend>
          {v.slabs.map((s, i) => (
            <div key={i} className="mb-2 grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
              <Field label="From"><Input type="number" min="0" step="0.01" value={s.from ?? ""} onChange={(e) => setSlab(i, "from", e.target.value)} /></Field>
              <Field label="To (blank = above)"><Input type="number" min="0" step="0.01" value={s.to ?? ""} onChange={(e) => setSlab(i, "to", e.target.value)} /></Field>
              <Field label="Employee"><Input type="number" min="0" step="0.01" value={s.employee_amount ?? ""} onChange={(e) => setSlab(i, "employee_amount", e.target.value)} /></Field>
              <Field label="Employer"><Input type="number" min="0" step="0.01" value={s.employer_amount ?? ""} onChange={(e) => setSlab(i, "employer_amount", e.target.value)} /></Field>
              <Button variant="ghost" onClick={() => setV({ ...v, slabs: v.slabs.filter((_, j) => j !== i) })} aria-label="Remove slab"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setV({ ...v, slabs: [...v.slabs, { from: null, to: null, employee_amount: null, employer_amount: null }] })}><Plus className="h-4 w-4" aria-hidden="true" />Add slab</Button>
        </fieldset>
      )}
      {v.calc_method === "employee_declared" && <p className="mt-3 text-sm text-slate-600">The monthly amount is entered per employee on their enrolment (for example TDS from the employee's tax computation). This system does not compute income tax.</p>}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Legal reference"><Textarea maxLength={2000} value={v.legal_reference ?? ""} onChange={set("legal_reference")} /></Field>
        <Field label="Notes"><Textarea maxLength={2000} value={v.notes ?? ""} onChange={set("notes")} /></Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">Saving keeps the rule as a draft. Submit it for validation; a different approver records the professional validation reference.</p>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function Enrollments() {
  const { hr, hasPermission } = useAuth();
  const { notify } = useToast();
  const rules = useHrQuery(() => listStatutoryRules(), []);
  const codes = useMemo(() => [...new Set((rules.data ?? []).filter((r) => r.status !== "retired").map((r) => r.code))], [rules.data]);
  const [code, setCode] = useState("");
  const q = useHrQuery(() => listStatutoryEnrollments(code), [code]);
  const [editing, setEditing] = useState(null);
  const canManage = hasPermission("payroll.manage");
  return (
    <>
      <Toolbar>
        <Field label="Rule" className="sm:w-48"><Select placeholder="All" value={code} onChange={(e) => setCode(e.target.value)} options={codes.map((c) => ({ value: c, label: c }))} /></Field>
        <div className="flex-1" />
        {canManage && <Button className="self-end" onClick={() => setEditing({ rule_code: code || codes[0] || "", enrolled: true })}><Plus className="h-4 w-4" aria-hidden="true" />Add enrolment</Button>}
      </Toolbar>
      <DataTable caption="Statutory enrolments" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} emptyTitle="No enrolments"
        emptyDescription="Rules set to 'enrolled employees only' apply to employees listed here."
        columns={[
          { key: "employee", header: "Employee", render: (r) => <EmpCell e={r.employee} /> },
          { key: "rule_code", header: "Rule", render: (r) => <span className="font-mono text-xs font-bold">{r.rule_code}</span> },
          { key: "enrolled", header: "Status", render: (r) => <Badge tone={r.enrolled ? "green" : "slate"}>{r.enrolled ? "enrolled" : "opted out"}</Badge> },
          { key: "state_code", header: "State", render: (r) => r.state_code || "—" },
          { key: "declared", header: "Declared / month", render: (r) => (r.declared_monthly_amount != null ? formatMoney(r.declared_monthly_amount) : "—") },
          { key: "effective", header: "Effective", render: (r) => `${formatDate(r.effective_from)} – ${r.effective_to ? formatDate(r.effective_to) : "open"}` },
          ...(canManage ? [{ key: "_a", header: <span className="sr-only">Edit</span>, render: (r) => (r.employee_id === hr?.employee?.id ? <span className="text-xs text-slate-500">own</span> : <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>) }] : []),
        ]} />
      {editing && <EnrollmentModal row={editing} codes={codes} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); q.reload(); notify("Enrolment saved."); }} />}
    </>
  );
}

function EnrollmentModal({ row, codes, onClose, onSaved }) {
  const { hr } = useAuth();
  const employees = useEmployeeOptions({ includeInactive: true });
  const [v, setV] = useState({ employee_id: "", effective_from: "", effective_to: "", state_code: "", declared_monthly_amount: "", note: "", ...row });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    if (!v.employee_id || !v.rule_code || !v.effective_from) { setError("Employee, rule and effective-from are required."); return; }
    setBusy(true); setError(null);
    const res = await saveStatutoryEnrollment(v);
    setBusy(false);
    if (res.error) setError(friendly(res.error)); else onSaved();
  }
  return (
      <Modal open onClose={onClose} title={row.id ? "Edit statutory enrolment" : "Add statutory enrolment"}
        footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Employee" required className="sm:col-span-2"><Select placeholder="Choose" disabled={Boolean(row.id)} value={v.employee_id} onChange={set("employee_id")} options={(employees.data ?? []).filter((o) => o.value !== hr?.employee?.id)} /></Field>
          <Field label="Rule" required><Select value={v.rule_code} disabled={Boolean(row.id)} onChange={set("rule_code")} options={codes.map((c) => ({ value: c, label: c }))} /></Field>
          <Field label="State / jurisdiction"><Input maxLength={3} value={v.state_code ?? ""} onChange={(e) => setV({ ...v, state_code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Effective from" required><Input type="date" value={v.effective_from} onChange={set("effective_from")} /></Field>
          <Field label="Effective to"><Input type="date" value={v.effective_to ?? ""} onChange={set("effective_to")} /></Field>
          <Field label="Declared monthly amount" hint="For employee-declared rules such as TDS."><Input type="number" min="0" step="0.01" value={v.declared_monthly_amount ?? ""} onChange={set("declared_monthly_amount")} /></Field>
          <div className="self-end"><Checkbox label="Enrolled (untick to opt out)" checked={v.enrolled !== false} onChange={(e) => setV({ ...v, enrolled: e.target.checked })} /></div>
          <Field label="Note" className="sm:col-span-2"><Textarea maxLength={1000} value={v.note ?? ""} onChange={set("note")} /></Field>
        </div>
        <div className="mt-3"><InlineError message={error} /></div>
      </Modal>
  );
}
