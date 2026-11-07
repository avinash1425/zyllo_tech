// Benefit plans (hr_benefit_types, 114 + 208): add / edit / deactivate.
// Direct table writes allowed by RLS for benefits.manage; the server guards
// categories and refuses a plan-year change once claims exist.
import { useMemo, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { useHrQuery } from "@/lib/hr/client";
import { CONTRIBUTION_FREQUENCIES, MONTHS, eligibilitySummary, label, listBenefitCategories, listBenefitPlans, saveBenefitPlan } from "@/lib/hr/benefits";
import { Badge, Button, Checkbox, DataTable, Field, Input, Select, Textarea, Toolbar, useToast } from "@/hr/ui";
import { ActionModal, limitText, money, opts } from "./shared";

export const EMPTY_PLAN = {
  code: "", name: "", category: "", description: "", provider: "", coverage_amount: "", annual_limit: "", claimable: false, claim_requires_document: true,
  self_enrollment: false, plan_year_start_month: 4, employer_contribution: 0, employee_contribution: 0, contribution_frequency: "monthly",
  employer_contribution_note: "", employee_contribution_note: "", allows_dependants: false, active: true,
  eligible_employment_types: [], min_tenure_months: 0, eligible_grade_ids: [], eligible_location_ids: [], allow_during_probation: true,
};

/** Multi-select as a checkbox list (keeps the existing UI kit; no new widget). */
export function CheckList({ label: lbl, hint, options, value, onChange }) {
  const set = new Set(value ?? []);
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-semibold text-[#173a52]">{lbl}</legend>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      <div className="mt-1 flex max-h-40 flex-wrap gap-x-4 gap-y-1.5 overflow-y-auto rounded-xl border border-slate-200 p-2">
        {options.length ? options.map((o) => (
          <Checkbox key={o.value} label={o.label} checked={set.has(o.value)}
            onChange={(e) => { const n = new Set(set); if (e.target.checked) n.add(o.value); else n.delete(o.value); onChange([...n]); }} />
        )) : <span className="text-xs text-slate-500">None configured</span>}
      </div>
    </fieldset>
  );
}

export function EligibilityFields({ v, setV, org }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <CheckList label="Employment types" hint="None ticked = every employment type." value={v.eligible_employment_types}
          options={(org?.employmentTypes ?? []).filter((t) => t.active !== false).map((t) => ({ value: t.code, label: t.name }))}
          onChange={(a) => setV((s) => ({ ...s, eligible_employment_types: a }))} />
      </div>
      <Field label="Minimum service (months)" hint="Measured at the enrollment start date"><Input type="number" min={0} max={120} value={v.min_tenure_months ?? 0}
        onChange={(e) => setV((s) => ({ ...s, min_tenure_months: e.target.value }))} /></Field>
      <div className="flex items-end"><Checkbox label="Allowed during probation" checked={v.allow_during_probation !== false}
        onChange={(e) => setV((s) => ({ ...s, allow_during_probation: e.target.checked }))} /></div>
      <CheckList label="Grades" hint="None ticked = every grade." value={v.eligible_grade_ids}
        options={(org?.grades ?? []).filter((g) => g.active !== false).map((g) => ({ value: g.id, label: g.name }))}
        onChange={(a) => setV((s) => ({ ...s, eligible_grade_ids: a }))} />
      <CheckList label="Work locations" hint="None ticked = every location." value={v.eligible_location_ids}
        options={(org?.locations ?? []).filter((l) => l.active !== false).map((l) => ({ value: l.id, label: l.name }))}
        onChange={(a) => setV((s) => ({ ...s, eligible_location_ids: a }))} />
    </div>
  );
}

export function validatePlan(v, { isNew }) {
  const errs = {};
  if (isNew && !/^[A-Z0-9_-]{2,20}$/.test(String(v.code ?? "").trim().toUpperCase())) errs.code = "2–20 characters: letters, digits, _ or -.";
  if (String(v.name ?? "").trim().length < 2) errs.name = "Enter the plan name (2–120 characters).";
  if (!v.category) errs.category = "Choose a category.";
  for (const k of ["coverage_amount", "annual_limit"]) if (v[k] !== "" && v[k] != null && !(Number(v[k]) >= 0)) errs[k] = "Enter zero or more.";
  if (v.annual_limit !== "" && v.annual_limit != null && !(Number(v.annual_limit) > 0)) errs.annual_limit = "Enter an amount greater than zero, or leave empty for no limit.";
  for (const k of ["employer_contribution", "employee_contribution"]) if (v[k] !== "" && v[k] != null && !(Number(v[k]) >= 0)) errs[k] = "Enter zero or more.";
  const t = Number(v.min_tenure_months);
  if (!(t >= 0 && t <= 120)) errs.min_tenure_months = "0–120 months.";
  return errs;
}

export function PlanFormModal({ plan, categories, org, onClose, onSaved, section = "all" }) {
  const isNew = !plan?.id;
  const [v, setV] = useState(() => ({ ...EMPTY_PLAN, ...(plan ?? {}),
    coverage_amount: plan?.coverage_amount ?? "", annual_limit: plan?.annual_limit ?? "",
    eligible_employment_types: plan?.eligible_employment_types ?? [], eligible_grade_ids: plan?.eligible_grade_ids ?? [], eligible_location_ids: plan?.eligible_location_ids ?? [] }));
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const catOptions = (categories ?? []).filter((c) => c.active || c.code === plan?.category).map((c) => ({ value: c.code, label: c.active ? c.name : `${c.name} (inactive)` }));
  const onlyRules = section === "eligibility";
  return (
    <ActionModal title={onlyRules ? `Eligibility rules · ${plan.name}` : isNew ? "Add benefit plan" : `Edit ${plan.name}`} submitLabel={isNew ? "Add plan" : "Save"} size="lg" onClose={onClose}
      onSubmit={async () => {
        const errs = validatePlan(v, { isNew });
        setErrors(errs);
        if (Object.keys(errs).length) return { error: "Fix the highlighted fields." };
        const res = await saveBenefitPlan(onlyRules ? {
          eligible_employment_types: v.eligible_employment_types, min_tenure_months: v.min_tenure_months, eligible_grade_ids: v.eligible_grade_ids,
          eligible_location_ids: v.eligible_location_ids, allow_during_probation: v.allow_during_probation,
        } : v, plan?.id);
        if (res.error) return { error: /duplicate|already exists/i.test(res.error) ? "Another plan already uses this code or name." : res.error };
        onSaved(isNew); return {};
      }}>
      {!onlyRules && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Code" required error={errors.code} hint={isNew ? "e.g. MED-GROUP, LEARN" : "Fixed after creation"}><Input value={v.code} disabled={!isNew} maxLength={20} onChange={set("code")} /></Field>
            <Field label="Plan name" required error={errors.name}><Input value={v.name} maxLength={120} onChange={set("name")} /></Field>
            <Field label="Category" required error={errors.category}>
              <Select placeholder="Choose a category" value={v.category} options={catOptions}
                onChange={(e) => { const c = (categories ?? []).find((x) => x.code === e.target.value); setV((s) => ({ ...s, category: e.target.value, ...(isNew && c ? { claimable: c.claimable_default } : {}) })); }} />
            </Field>
            <Field label="Provider" hint="Insurer, vendor or platform"><Input value={v.provider ?? ""} maxLength={120} onChange={set("provider")} /></Field>
            <Field label="Coverage / sum insured (INR)" error={errors.coverage_amount} hint="Optional, informational"><Input type="number" min={0} step="0.01" value={v.coverage_amount} onChange={set("coverage_amount")} /></Field>
            <Field label="Plan year starts in"><Select value={String(v.plan_year_start_month)} onChange={set("plan_year_start_month")} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea value={v.description ?? ""} maxLength={2000} onChange={set("description")} /></Field>
          </div>
          <h3 className="mt-1 text-sm font-bold text-[#101a3a]">Contributions</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Employer contribution (INR)" error={errors.employer_contribution}><Input type="number" min={0} step="0.01" value={v.employer_contribution} onChange={set("employer_contribution")} /></Field>
            <Field label="Employee contribution (INR)" error={errors.employee_contribution}><Input type="number" min={0} step="0.01" value={v.employee_contribution} onChange={set("employee_contribution")} /></Field>
            <Field label="Frequency"><Select value={v.contribution_frequency} onChange={set("contribution_frequency")} options={opts(CONTRIBUTION_FREQUENCIES)} /></Field>
            <Field label="Employer contribution note" className="sm:col-span-3 lg:col-span-1"><Input value={v.employer_contribution_note ?? ""} maxLength={500} onChange={set("employer_contribution_note")} /></Field>
            <Field label="Employee contribution note" className="sm:col-span-3 lg:col-span-2"><Input value={v.employee_contribution_note ?? ""} maxLength={500} onChange={set("employee_contribution_note")} /></Field>
          </div>
          <p className="text-xs text-slate-500">Contributions are recorded for reference only; nothing is deducted or paid through payroll.</p>
          <h3 className="mt-1 text-sm font-bold text-[#101a3a]">Claims and enrollment</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Checkbox label="Employees can claim against this plan" checked={Boolean(v.claimable)} onChange={set("claimable")} />
              <Checkbox label="Claims need a supporting document" checked={Boolean(v.claim_requires_document)} onChange={set("claim_requires_document")} disabled={!v.claimable} />
              <Checkbox label="Employees may request enrollment (self-enrollment)" checked={Boolean(v.self_enrollment)} onChange={set("self_enrollment")} />
              <Checkbox label="Covers dependants" checked={Boolean(v.allows_dependants)} onChange={set("allows_dependants")} />
              <Checkbox label="Active" checked={Boolean(v.active)} onChange={set("active")} />
            </div>
            <Field label="Annual claim limit (INR)" error={errors.annual_limit} hint="Per employee per plan year. Empty = no limit.">
              <Input type="number" min={0} step="0.01" value={v.annual_limit} onChange={set("annual_limit")} disabled={!v.claimable} />
            </Field>
          </div>
          <h3 className="mt-1 text-sm font-bold text-[#101a3a]">Eligibility rules</h3>
        </>
      )}
      <EligibilityFields v={v} setV={setV} org={org} />
      {errors.min_tenure_months && <p className="text-xs font-medium text-red-600" role="alert">{errors.min_tenure_months}</p>}
      <p className="text-xs text-slate-500">Rules apply to new enrollments and requests. Existing enrollments are not changed; HR can still enroll an ineligible employee by recording an override reason.</p>
    </ActionModal>
  );
}

export default function PlansTab({ canManage, org, categoriesVersion, onChanged }) {
  const { notify } = useToast();
  const [f, setF] = useState({ category: "", status: "active" });
  const list = useHrQuery(() => listBenefitPlans(), []);
  const cats = useHrQuery(() => listBenefitCategories(), [categoriesVersion]);
  const [edit, setEdit] = useState(null);
  const catName = (code) => cats.data?.find((c) => c.code === code)?.name ?? label(code);
  const rows = useMemo(() => (list.data ?? []).filter((p) => (!f.category || p.category === f.category)
    && (f.status === "" || (f.status === "active" ? p.active : !p.active))), [list.data, f]);
  return (
    <>
      <Toolbar>
        <Select aria-label="Category" className="sm:w-56" placeholder="All categories" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}
          options={(cats.data ?? []).map((c) => ({ value: c.code, label: c.name }))} />
        <Select aria-label="Plan status" className="sm:w-40" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}
          options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }, { value: "", label: "All" }]} />
        <span className="flex-1" />
        {canManage && <Button onClick={() => setEdit({})}><Plus className="h-4 w-4" aria-hidden="true" />Add plan</Button>}
      </Toolbar>
      <DataTable caption="Benefit plans" rows={list.data ? rows : null} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle="No plans match" emptyDescription={canManage ? "Add the first plan, e.g. group health insurance or a learning allowance." : undefined}
        onRowClick={canManage ? (r) => setEdit(r) : undefined}
        columns={[
          { key: "name", header: "Plan", sortable: true, render: (r) => <div className="min-w-[12rem]"><p className="font-medium text-[#101a3a]">{r.name}</p><p className="text-xs text-slate-500">{r.code}{r.provider ? ` · ${r.provider}` : ""}</p></div> },
          { key: "category", header: "Category", sortable: true, render: (r) => catName(r.category) },
          { key: "coverage_amount", header: "Coverage", render: (r) => money(r.coverage_amount) },
          { key: "annual_limit", header: "Annual claim limit", render: (r) => (r.claimable ? limitText(r.annual_limit) : <span className="text-slate-500">Not claimable</span>) },
          { key: "contrib", header: "Contributions", render: (r) => <div className="text-xs"><p>Employer {money(r.employer_contribution)} · Employee {money(r.employee_contribution)}</p><p className="text-slate-500">{label(r.contribution_frequency)}{r.employer_contribution_note ? ` · ${r.employer_contribution_note}` : ""}</p></div> },
          { key: "plan_year_start_month", header: "Plan year", render: (r) => `From ${MONTHS[(r.plan_year_start_month ?? 4) - 1]}` },
          { key: "eligibility", header: "Eligibility", render: (r) => <p className="max-w-xs text-xs">{eligibilitySummary(r, { grades: org?.grades ?? [], locations: org?.locations ?? [], employmentTypes: org?.employmentTypes ?? [] })}</p> },
          { key: "flags", header: "Options", render: (r) => <div className="flex flex-wrap gap-1">{r.self_enrollment && <Badge tone="blue">self-enroll</Badge>}{r.allows_dependants && <Badge tone="violet">dependants</Badge>}</div> },
          { key: "active", header: "Status", render: (r) => <Badge tone={r.active ? "green" : "slate"}>{r.active ? "active" : "inactive"}</Badge> },
          ...(canManage ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEdit(r); }}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button> }] : []),
        ]} />
      {edit && <PlanFormModal plan={edit.id ? edit : null} categories={cats.data} org={org} onClose={() => setEdit(null)}
        onSaved={(isNew) => { setEdit(null); notify(isNew ? "Plan added." : "Plan saved."); list.reload(); onChanged?.(); }} />}
    </>
  );
}
