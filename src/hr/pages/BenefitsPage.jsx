// Benefits — plans (catalogue), enrollments and eligibility.
// Plans: direct table writes (benefits.manage, RLS). Enrollments: RPCs that
// check eligibility (employment type, tenure) and record overrides.
import { useMemo, useState } from "react";
import { Download, Plus } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { exportCsv, formatDate, formatMoney, fullName, useHrQuery } from "@/lib/hr/client";
import { useEmployeeOptions, useOrg, toOptions } from "@/lib/hr/org";
import {
  BENEFIT_CATEGORIES, COVERAGE_LEVELS, ENROLLMENT_STATUSES, FREQUENCIES, benefitEligibility, enrollBenefit, listBenefitTypes, listEnrollments, setEnrollmentStatus,
} from "@/lib/hr/benefits";
import { Badge, Button, Card, DataTable, Field, InlineError, Input, KpiCard, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea, Toolbar, useToast } from "@/hr/ui";
import MasterDataEditor from "@/hr/components/MasterDataEditor";
import { HeartPulse, PauseCircle, Users } from "lucide-react";

const opt = (list) => list.map((v) => ({ value: v, label: v.replace(/_/g, " ") }));
const today = () => new Date().toLocaleDateString("en-CA");

export function benefitPlanConfig(employmentTypes) {
  return {
    table: "hr_benefit_types", title: "Benefit plans", singular: "benefit plan", orderBy: "name",
    description: "Eligibility is checked on enrollment: employment types (blank = all) and minimum months of service by the start date.",
    columns: [
      { key: "code", header: "Code" }, { key: "name", header: "Plan" }, { key: "category", header: "Category", render: (r) => <Badge tone="blue">{r.category}</Badge> },
      { key: "eligible", header: "Eligible types", render: (r) => (r.eligible_employment_types?.length ? r.eligible_employment_types.join(", ").replace(/_/g, " ") : "All") },
      { key: "min_tenure_months", header: "Min. service", render: (r) => (r.min_tenure_months ? `${r.min_tenure_months} mo` : "—") },
      { key: "employer_contribution", header: "Employer", render: (r) => (Number(r.employer_contribution) ? `${formatMoney(r.employer_contribution)} / ${r.contribution_frequency.replace(/_/g, " ")}` : "—") },
    ],
    fields: [
      { key: "code", label: "Code", required: true, uppercase: true, createOnly: true, pattern: "^[A-Za-z0-9_-]{2,20}$", patternMessage: "2–20 letters, digits, _ or -." },
      { key: "name", label: "Plan name", required: true },
      { key: "category", label: "Category", type: "select", required: true, placeholder: undefined, options: opt(BENEFIT_CATEGORIES) },
      { key: "provider", label: "Provider" },
      { key: "eligible_employment_types", label: "Eligible employment types (comma-separated codes; blank = all)", hint: (employmentTypes ?? []).map((t) => t.code).join(", "), wide: true },
      { key: "min_tenure_months", label: "Minimum service (months)", type: "number", min: 0, max: 120, required: true },
      { key: "employer_contribution", label: "Employer contribution", type: "number", min: 0, max: 100000000, step: "0.01", required: true },
      { key: "employee_contribution", label: "Employee contribution", type: "number", min: 0, max: 100000000, step: "0.01", required: true },
      { key: "contribution_frequency", label: "Contribution frequency", type: "select", required: true, placeholder: undefined, options: opt(FREQUENCIES) },
      { key: "allows_dependants", label: "Covers dependants", type: "checkbox" },
      { key: "description", label: "Coverage details", type: "textarea", wide: true },
    ],
    defaults: { category: "health", min_tenure_months: 0, employer_contribution: 0, employee_contribution: 0, contribution_frequency: "monthly" },
    validate: (v) => {
      const codes = new Set((employmentTypes ?? []).map((t) => t.code));
      const list = String(Array.isArray(v.eligible_employment_types) ? v.eligible_employment_types.join(",") : v.eligible_employment_types ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      const bad = list.filter((x) => !codes.has(x));
      return bad.length ? { eligible_employment_types: `Unknown employment type: ${bad.join(", ")}` } : {};
    },
    transform: (p) => {
      const raw = Array.isArray(p.eligible_employment_types) ? p.eligible_employment_types.join(",") : p.eligible_employment_types ?? "";
      const list = String(raw).split(",").map((x) => x.trim()).filter(Boolean);
      return { ...p, eligible_employment_types: list.length ? list : null };
    },
  };
}

export default function BenefitsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("benefits.manage");
  const [tab, setTab] = useState("enrollments");
  const org = useOrg();
  return (
    <>
      <PageHeader title="Benefits" description="Benefit plans, eligibility and employee enrollments. Managers do not see team benefits." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "enrollments", label: "Enrollments" }, { value: "plans", label: "Plans" }]} label="Benefits sections" />
      {tab === "enrollments" && <Enrollments canManage={canManage} />}
      {tab === "plans" && <Card><MasterDataEditor key="plans" config={benefitPlanConfig(org.data?.employmentTypes)} canEdit={canManage} /></Card>}
    </>
  );
}

function Enrollments({ canManage }) {
  const { notify } = useToast();
  const [f, setF] = useState({ status: "live", benefitType: "", employee: "" });
  const plans = useHrQuery(() => listBenefitTypes(), []);
  const q = useHrQuery(() => listEnrollments(f), [f.status, f.benefitType, f.employee]);
  const employees = useEmployeeOptions();
  const [enrolling, setEnrolling] = useState(false);
  const [changing, setChanging] = useState(null);
  const rows = q.data ?? [];
  const counts = useMemo(() => ({ active: rows.filter((r) => r.status === "active").length, suspended: rows.filter((r) => r.status === "suspended").length, people: new Set(rows.map((r) => r.employee_id)).size }), [rows]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Active enrollments" value={counts.active} icon={HeartPulse} tone="green" loading={q.loading} />
        <KpiCard label="Suspended" value={counts.suspended} icon={PauseCircle} tone="orange" loading={q.loading} />
        <KpiCard label="Employees covered (listed)" value={counts.people} icon={Users} tone="navy" loading={q.loading} />
      </div>
      <Toolbar>
        <Select aria-label="Enrollment status" className="sm:w-44" value={f.status} onChange={set("status")} options={[{ value: "live", label: "Active & suspended" }, { value: "", label: "All statuses" }, ...opt(ENROLLMENT_STATUSES)]} />
        <Select aria-label="Plan" className="sm:w-56" placeholder="All plans" value={f.benefitType} onChange={set("benefitType")} options={toOptions(plans.data, "name", "id", { activeOnly: false })} />
        <Select aria-label="Employee" className="sm:w-60" placeholder="All employees" value={f.employee} onChange={set("employee")} options={employees.data ?? []} />
        <div className="flex gap-2 sm:ml-auto">
          {hasRows(rows) && <Button variant="secondary" onClick={() => { exportCsv(`benefit-enrollments-${today()}`, rows, [
            { label: "Employee ID", value: (r) => r.employee?.employee_code }, { label: "Employee", value: (r) => fullName(r.employee) }, { label: "Plan", value: (r) => r.benefit?.name },
            { label: "Status", key: "status" }, { label: "Coverage", key: "coverage_level" }, { label: "Dependants", key: "dependants" }, { label: "Start", key: "start_date" }, { label: "End", key: "end_date" },
            { label: "Employer contribution", key: "employer_contribution" }, { label: "Employee contribution", key: "employee_contribution" }, { label: "Policy number", key: "policy_number" }]); notify(`Exported ${rows.length} enrollments.`); }}>
            <Download className="h-4 w-4" aria-hidden="true" />Export CSV</Button>}
          {canManage && <Button onClick={() => setEnrolling(true)}><Plus className="h-4 w-4" aria-hidden="true" />Enroll employee</Button>}
        </div>
      </Toolbar>
      <DataTable caption="Benefit enrollments" rows={rows} loading={q.loading} error={q.error} onRetry={q.reload} pageSize={25}
        emptyTitle="No enrollments" emptyDescription={canManage ? "Enroll an employee in a plan to see it here." : undefined}
        columns={[
          { key: "employee", header: "Employee", sortable: true, sortValue: (r) => fullName(r.employee).toLowerCase(), render: (r) => <div><p className="font-semibold text-[#101a3a]">{fullName(r.employee)}</p><p className="font-mono text-xs text-slate-500">{r.employee?.employee_code}</p></div> },
          { key: "plan", header: "Plan", render: (r) => <span>{r.benefit?.name}<span className="block text-xs text-slate-500">{r.benefit?.category}</span></span> },
          { key: "coverage_level", header: "Coverage", render: (r) => `${COVERAGE_LEVELS.find((c) => c.value === r.coverage_level)?.label ?? r.coverage_level}${r.dependants ? ` · ${r.dependants} dep.` : ""}` },
          { key: "start_date", header: "Period", sortable: true, render: (r) => `${formatDate(r.start_date)} – ${r.end_date ? formatDate(r.end_date) : "ongoing"}` },
          { key: "employer_contribution", header: "Employer", render: (r) => formatMoney(r.employer_contribution) },
          { key: "status", header: "Status", render: (r) => <span className="flex flex-wrap items-center gap-1"><StatusBadge status={r.status} />{r.eligibility_override && <Badge tone="violet" title={r.eligibility_override}>override</Badge>}</span> },
          ...(canManage ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (["active", "suspended"].includes(r.status) ? <Button size="sm" variant="ghost" onClick={() => setChanging(r)}>Change</Button> : null) }] : []),
        ]} />
      {enrolling && <EnrollModal plans={plans.data ?? []} employees={employees.data ?? []} onClose={() => setEnrolling(false)} onDone={() => { setEnrolling(false); q.reload(); notify("Employee enrolled."); }} />}
      {changing && <StatusModal enrollment={changing} onClose={() => setChanging(null)} onDone={(s) => { setChanging(null); q.reload(); notify(`Enrollment ${s}.`); }} />}
    </>
  );
}
const hasRows = (r) => Array.isArray(r) && r.length > 0;

function EnrollModal({ plans, employees, onClose, onDone }) {
  const [v, setV] = useState({ employee_id: "", benefit_type_id: "", start_date: today(), coverage_level: "employee", dependants: 0 });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const elig = useHrQuery(() => (v.employee_id ? benefitEligibility(v.employee_id, v.start_date) : Promise.resolve({ data: null, error: null })), [v.employee_id, v.start_date]);
  const plan = plans.find((p) => p.id === v.benefit_type_id);
  const e = (elig.data ?? []).find((x) => x.benefit_type_id === v.benefit_type_id);
  const needsOverride = e && !e.eligible;

  async function save() {
    const errs = {};
    if (!v.employee_id) errs.employee_id = "Choose an employee.";
    if (!v.benefit_type_id) errs.benefit_type_id = "Choose a plan.";
    if (!v.start_date) errs.start_date = "Choose the start date.";
    const dep = Number(v.dependants || 0);
    if (!Number.isInteger(dep) || dep < 0 || dep > 20) errs.dependants = "0–20.";
    if (dep > 0 && plan && !plan.allows_dependants) errs.dependants = "This plan does not cover dependants.";
    if (needsOverride && (v.override_reason ?? "").trim().length < 5) errs.override_reason = "Explain why the eligibility rule is overridden (min 5 characters).";
    if (e?.enrolled) errs.benefit_type_id = "Already enrolled in this plan.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const r = await enrollBenefit({ ...v, override_reason: needsOverride ? v.override_reason : null });
    setBusy(false);
    if (r.error) setError(r.error); else onDone();
  }
  return (
    <Modal open onClose={onClose} title="Enroll employee in a benefit plan" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Enroll</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Employee" required error={errors.employee_id} className="sm:col-span-2"><Select placeholder="Choose an employee" value={v.employee_id} onChange={set("employee_id")} options={employees} /></Field>
        <Field label="Plan" required error={errors.benefit_type_id}><Select placeholder="Choose a plan" value={v.benefit_type_id} onChange={set("benefit_type_id")} options={plans.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }))} /></Field>
        <Field label="Start date" required error={errors.start_date}><Input type="date" value={v.start_date} onChange={set("start_date")} /></Field>
        {e && <p className={`rounded-lg px-3 py-2 text-sm sm:col-span-2 ${e.eligible ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{e.enrolled ? "Already enrolled in this plan." : e.eligible ? "Eligible on the start date." : `Not eligible: ${e.reason}`}</p>}
        {elig.error && <div className="sm:col-span-2"><InlineError message={elig.error} /></div>}
        <Field label="Coverage"><Select value={v.coverage_level} onChange={set("coverage_level")} options={COVERAGE_LEVELS} /></Field>
        <Field label="Dependants" error={errors.dependants}><Input type="number" min={0} max={20} value={v.dependants} onChange={set("dependants")} disabled={plan && !plan.allows_dependants} /></Field>
        <Field label="Employer contribution" hint={plan ? `Plan default ${formatMoney(plan.employer_contribution)}` : undefined}><Input type="number" min={0} step="0.01" value={v.employer_contribution ?? ""} onChange={set("employer_contribution")} /></Field>
        <Field label="Employee contribution" hint={plan ? `Plan default ${formatMoney(plan.employee_contribution)}` : undefined}><Input type="number" min={0} step="0.01" value={v.employee_contribution ?? ""} onChange={set("employee_contribution")} /></Field>
        <Field label="Policy / membership number"><Input value={v.policy_number ?? ""} onChange={set("policy_number")} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={v.notes ?? ""} onChange={set("notes")} /></Field>
        {needsOverride && <Field label="Eligibility override reason" required error={errors.override_reason} className="sm:col-span-2"><Textarea value={v.override_reason ?? ""} onChange={set("override_reason")} /></Field>}
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function StatusModal({ enrollment, onClose, onDone }) {
  const choices = (enrollment.status === "active" ? ["suspended", "ended", "cancelled"] : ["active", "ended", "cancelled"]);
  const [status, setStatus] = useState(choices[0]);
  const [endDate, setEndDate] = useState(today());
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (status !== "active" && !reason.trim()) { setError("Give a reason."); return; }
    if (status === "ended" && (!endDate || endDate < enrollment.start_date)) { setError("Choose an end date on or after the start date."); return; }
    setBusy(true); const r = await setEnrollmentStatus(enrollment.id, status, status === "ended" ? endDate : null, reason); setBusy(false);
    if (r.error) setError(r.error); else onDone(status);
  }
  return (
    <Modal open onClose={onClose} title={`${enrollment.benefit?.name} · ${fullName(enrollment.employee)}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="New status"><Select value={status} onChange={(e) => setStatus(e.target.value)} options={opt(choices)} /></Field>
        {status === "ended" && <Field label="End date" required><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>}
        {status !== "active" && <Field label="Reason" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
        <InlineError message={error} />
      </div>
    </Modal>
  );
}
