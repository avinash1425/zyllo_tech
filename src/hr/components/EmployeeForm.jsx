// Structured Add / Edit Employee form (Employee Master).
// Sections: Personal · Contact · Employment · Deployment · Contract · Identification.
// - Personal / contact PII and HR remarks are shown only with employees.view_sensitive.
// - Identification is shown only with employees.view_identity.
// - Banking & payroll identifiers are never part of this form: they live on the
//   profile's "Banking & payroll" tab for payroll users only.
// The server enforces every one of these rules independently (RLS + checks).
import { useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button, Field, InlineError, Input, Select, Textarea } from "@/hr/ui";
import { toOptions } from "@/lib/hr/org";
import { from, run, useHrQuery } from "@/lib/hr/client";
import {
  CONTRACT_TYPES, DEPLOYMENT_STATUSES, EMP_FIELDS, GENDERS, IDENTITY_FIELDS, MARITAL_STATUSES, PRIVATE_FIELDS, WORK_ARRANGEMENTS,
  createEmployee, listIdentityRequirements, saveEmployeeIdentity, saveEmployeeRemarks, updateEmployee, upsertEmployeePrivate,
} from "@/lib/hr/employees";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^[+0-9 ()-]{7,20}$/;
const ISO2 = /^[A-Z]{2}$/;
const PASSPORT = /^[A-Za-z0-9]{5,20}$/;
const NATIONAL_ID = /^[A-Za-z0-9 -]{4,40}$/;
const PERMIT = /^[A-Za-z0-9/ -]{3,40}$/;
const PROJECT = /^[A-Za-z0-9/_. -]{1,60}$/;
const today = () => new Date().toLocaleDateString("en-CA");

// Which section each field lives in (for the error markers on the section nav).
const SECTION_OF = {
  first_name: "personal", last_name: "personal", display_name: "personal", name_arabic: "personal", date_of_birth: "personal", gender: "personal", nationality: "personal", marital_status: "personal",
  company_email: "contact", personal_email: "contact", phone: "contact", emergency_contact_phone: "contact",
  employment_type: "employment", probation_end_date: "employment", source_department_id: "employment",
  deployment_client: "deployment", deployment_project_code: "deployment", deployment_end_date: "deployment",
  contract_end_date: "contract", notice_period_days: "contract", remarks: "contract",
  national_id_type: "identity", national_id_number: "identity", passport_number: "identity", passport_country: "identity", passport_expiry: "identity", work_permit_number: "identity", visa_number: "identity",
};

export function validateEmployee(v, { isNew, canSensitive, canIdentity }) {
  const e = {};
  if (!v.first_name?.trim()) e.first_name = "First name is required.";
  else if (v.first_name.trim().length > 80) e.first_name = "Max 80 characters.";
  if (v.last_name && v.last_name.length > 80) e.last_name = "Max 80 characters.";
  if (v.name_arabic && v.name_arabic.trim().length > 120) e.name_arabic = "Max 120 characters.";
  if (isNew && !v.company_email?.trim()) e.company_email = "Company email is required (work email, used for the portal invitation).";
  if (v.company_email && !EMAIL.test(v.company_email.trim())) e.company_email = "Enter a valid email address.";
  if (!v.employment_type) e.employment_type = "Choose an employment type.";
  if (v.joining_date && v.probation_end_date && v.probation_end_date < v.joining_date) e.probation_end_date = "Probation end must be on or after the joining date.";
  if (v.source_department_id && v.source_department_id === v.department_id) e.source_department_id = "Source department is only needed when it differs from the department.";
  if (v.contract_start_date && v.contract_end_date && v.contract_end_date < v.contract_start_date) e.contract_end_date = "Contract end must be on or after the start date.";
  if (v.notice_period_days !== undefined && v.notice_period_days !== null && String(v.notice_period_days).trim() !== "") {
    const n = Number(v.notice_period_days);
    if (!Number.isInteger(n) || n < 0 || n > 365) e.notice_period_days = "Enter whole days between 0 and 365.";
  }
  if (v.deployment_status === "deployed" && !v.deployment_client?.trim()) e.deployment_client = "Client is required for a deployed employee.";
  if (v.deployment_project_code && !PROJECT.test(v.deployment_project_code.trim())) e.deployment_project_code = "Letters, digits, / _ . - and spaces only (max 60).";
  if (v.deployment_start_date && v.deployment_end_date && v.deployment_end_date < v.deployment_start_date) e.deployment_end_date = "End must be on or after the start.";
  if (canSensitive) {
    if (v.personal_email && !EMAIL.test(v.personal_email.trim())) e.personal_email = "Enter a valid email address.";
    if (v.phone && !PHONE.test(v.phone)) e.phone = "Use digits, spaces, + ( ) - only (7–20 characters).";
    if (v.emergency_contact_phone && !PHONE.test(v.emergency_contact_phone)) e.emergency_contact_phone = "Use digits, spaces, + ( ) - only.";
    if (v.date_of_birth && v.date_of_birth > today()) e.date_of_birth = "Date of birth cannot be in the future.";
    if (v.nationality && !ISO2.test(v.nationality)) e.nationality = "Use the two-letter country code, e.g. IN or AE.";
    if (v.remarks && v.remarks.length > 4000) e.remarks = "Max 4000 characters.";
  }
  if (canIdentity) {
    if (v.national_id_number && !v.national_id_type) e.national_id_type = "Choose the ID type.";
    if (v.national_id_number && !NATIONAL_ID.test(v.national_id_number.trim())) e.national_id_number = "4–40 letters, digits, spaces or dashes.";
    if (v.passport_number && !PASSPORT.test(v.passport_number.trim())) e.passport_number = "5–20 letters or digits, no spaces.";
    if (v.passport_country && !ISO2.test(v.passport_country)) e.passport_country = "Two-letter country code.";
    if (v.passport_issue_date && v.passport_expiry && v.passport_expiry <= v.passport_issue_date) e.passport_expiry = "Expiry must be after the issue date.";
    if (v.work_permit_number && !PERMIT.test(v.work_permit_number.trim())) e.work_permit_number = "3–40 letters, digits, / - or spaces.";
    if (v.visa_number && !PERMIT.test(v.visa_number.trim())) e.visa_number = "3–40 letters, digits, / - or spaces.";
  }
  return e;
}

const nameOf = (rows, id) => (rows ?? []).find((r) => r.id === id)?.name ?? null;

/** Read-only display of an assignment field in Edit mode (changed via Change assignment). */
function LockedField({ label, value }) {
  return (
    <Field label={label} hint="Use Change assignment on the profile.">
      <Input value={value || "—"} disabled readOnly />
    </Field>
  );
}

const changed = (v, initial, keys) => keys.some((k) => (v[k] ?? "") !== (initial[k] ?? ""));
const anyValue = (v, keys) => keys.some((k) => v[k] !== undefined && v[k] !== null && String(v[k]).trim() !== "");

/**
 * Saves the employee record and, when permitted and changed, the PII row, identity
 * row and HR remarks. Returns { data: { id, employee_code }, error, partial }.
 */
export async function saveEmployeeAll(id, v, initial, { canSensitive, canIdentity }) {
  // Friendly duplicate checks (the database UNIQUE constraints remain authoritative).
  if (v.company_email?.trim() && v.company_email.trim().toLowerCase() !== (initial.company_email ?? "").toLowerCase()) {
    let q = from("hr_employees").select("id, employee_code").ilike("company_email", v.company_email.trim());
    if (id) q = q.neq("id", id);
    const dup = await run(q.limit(1));
    if (dup.data?.length) return { error: `An employee with this company email already exists (${dup.data[0].employee_code}).` };
  }
  if (canIdentity && v.passport_number?.trim() && v.passport_number.trim().toUpperCase() !== (initial.passport_number ?? "")) {
    let q = from("hr_employee_identity").select("employee_id").eq("passport_number", v.passport_number.trim().toUpperCase());
    if (id) q = q.neq("employee_id", id);
    const dup = await run(q.limit(1));
    if (dup.data?.length) return { error: "This passport number already exists for another employee." };
  }

  let empId = id, code = initial.employee_code;
  if (!id) {
    const res = await createEmployee(v, { withPrivate: canSensitive });
    if (res.error && !res.data) return res;
    empId = res.data.id; code = res.data.employee_code;
    if (res.error) return { data: res.data, error: res.error, partial: true };
  } else if (changed(v, initial, EMP_FIELDS)) {
    const res = await updateEmployee(id, v);
    if (res.error) return res;
  }
  const problems = [];
  if (id && canSensitive && changed(v, initial, PRIVATE_FIELDS)) {
    const p = await upsertEmployeePrivate(empId, v);
    if (p.error) problems.push(`personal details: ${p.error}`);
  }
  if (canSensitive && (v.remarks ?? "") !== (initial.remarks ?? "")) {
    const p = await saveEmployeeRemarks(empId, v.remarks);
    if (p.error) problems.push(`HR remarks: ${p.error}`);
  }
  if (canIdentity && (id ? changed(v, initial, IDENTITY_FIELDS) : anyValue(v, IDENTITY_FIELDS))) {
    const p = await saveEmployeeIdentity(empId, v);
    if (p.error) problems.push(`identification: ${p.error}`);
  }
  const data = { id: empId, employee_code: code };
  return problems.length ? { data, error: `Employee ${code ?? ""} saved, but ${problems.join("; ")}`, partial: true } : { data, error: null };
}

export default function EmployeeForm({ initial = {}, org, managers, isNew, canSensitive, canIdentity, onSubmit, onCancel, submitLabel = "Save" }) {
  const [v, setV] = useState({ employment_type: "full_time", ...initial });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState("personal");
  const set = (k, transform) => (e) => { const val = e.target.value; setV((s) => ({ ...s, [k]: transform ? transform(val) : val })); };
  const upper = (x) => x.toUpperCase();
  const rules = useHrQuery(() => (canIdentity ? listIdentityRequirements() : Promise.resolve({ data: [], error: null })), [canIdentity]);

  const designations = useMemo(() => (org?.designations ?? []).filter((d) => d.active && (!v.department_id || !d.department_id || d.department_id === v.department_id)), [org, v.department_id]);
  const managerOptions = useMemo(() => (managers ?? []).filter((m) => m.value !== initial.id), [managers, initial.id]);
  const entity = (org?.legalEntities ?? []).find((x) => x.id === v.legal_entity_id);
  const rule = (rules.data ?? []).find((r) => r.country === (entity?.country ?? "IN"));
  const isForeign = rule && v.nationality && v.nationality !== rule.country;

  const sections = [
    { key: "personal", label: "Personal" },
    { key: "contact", label: "Contact" },
    { key: "employment", label: "Employment" },
    { key: "deployment", label: "Deployment" },
    { key: "contract", label: "Contract" },
    ...(canIdentity ? [{ key: "identity", label: "Identification" }] : []),
  ];
  const errorSections = new Set(Object.keys(errors).map((k) => SECTION_OF[k] ?? "employment"));

  async function submit(e) {
    e.preventDefault();
    const errs = validateEmployee(v, { isNew, canSensitive, canIdentity });
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = sections.find((s) => Object.keys(errs).some((k) => (SECTION_OF[k] ?? "employment") === s.key));
      if (first) setSection(first.key);
      setFormError("Please fix the highlighted fields.");
      return;
    }
    setBusy(true); setFormError(null);
    const res = await onSubmit(v);
    setBusy(false);
    if (res?.error) setFormError(res.error);
  }

  const grid = "grid grid-cols-1 gap-4 sm:grid-cols-2";
  const show = (key) => (section === key ? "" : "hidden");

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <nav aria-label="Form sections" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {sections.map((s) => (
          <button key={s.key} type="button" onClick={() => setSection(s.key)} aria-current={section === s.key ? "step" : undefined}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition ${section === s.key ? "bg-[#101a3a] text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
            {s.label}{errorSections.has(s.key) && <AlertCircle className="h-3.5 w-3.5 text-red-500" aria-label="has errors" />}
          </button>
        ))}
      </nav>

      <fieldset className={`${grid} ${show("personal")}`}>
        <legend className="sr-only">Personal information</legend>
        <Field label="Employee ID" hint="Generated by the system; cannot be edited."><Input value={initial.employee_code ?? "Assigned on save"} disabled readOnly /></Field>
        <Field label="First name" required error={errors.first_name}><Input value={v.first_name ?? ""} onChange={set("first_name")} autoComplete="off" /></Field>
        <Field label="Last name" error={errors.last_name}><Input value={v.last_name ?? ""} onChange={set("last_name")} autoComplete="off" /></Field>
        <Field label="Preferred / display name"><Input value={v.display_name ?? ""} onChange={set("display_name")} /></Field>
        <Field label="Name in Arabic (optional)" error={errors.name_arabic}><Input dir="rtl" lang="ar" value={v.name_arabic ?? ""} onChange={set("name_arabic")} /></Field>
        {canSensitive ? (<>
          <Field label="Gender" hint="Record only where legitimately required."><Select placeholder="— Not recorded —" value={v.gender ?? ""} onChange={set("gender")} options={GENDERS} /></Field>
          <Field label="Date of birth" error={errors.date_of_birth}><Input type="date" max={today()} value={v.date_of_birth ?? ""} onChange={set("date_of_birth")} /></Field>
          <Field label="Nationality" error={errors.nationality} hint="Two-letter country code, e.g. IN, AE."><Input maxLength={2} value={v.nationality ?? ""} onChange={set("nationality", upper)} /></Field>
          <Field label="Marital status"><Select placeholder="— Not recorded —" value={v.marital_status ?? ""} onChange={set("marital_status")} options={MARITAL_STATUSES} /></Field>
        </>) : <p className="text-sm text-slate-500 sm:col-span-2">Personal details (date of birth, gender, nationality, marital status) need personal-data access.</p>}
        <p className="text-xs text-slate-500 sm:col-span-2">The employee photograph is managed on the profile page (or by the employee in My Documents).</p>
      </fieldset>

      <fieldset className={`${grid} ${show("contact")}`}>
        <legend className="sr-only">Contact details</legend>
        <Field label="Company email (work)" required={isNew} error={errors.company_email} hint={!isNew && initial.user_id ? "Linked to a portal account; cannot be changed here." : "Used for the portal invitation."}>
          <Input type="email" value={v.company_email ?? ""} onChange={set("company_email")} disabled={!isNew && Boolean(initial.user_id)} />
        </Field>
        {canSensitive ? (<>
          <Field label="Personal email" error={errors.personal_email}><Input type="email" value={v.personal_email ?? ""} onChange={set("personal_email")} /></Field>
          <Field label="Mobile number" error={errors.phone}><Input type="tel" value={v.phone ?? ""} onChange={set("phone")} /></Field>
          <Field label="Emergency contact name"><Input value={v.emergency_contact_name ?? ""} onChange={set("emergency_contact_name")} /></Field>
          <Field label="Emergency contact relation"><Input value={v.emergency_contact_relation ?? ""} onChange={set("emergency_contact_relation")} /></Field>
          <Field label="Emergency contact number" error={errors.emergency_contact_phone}><Input type="tel" value={v.emergency_contact_phone ?? ""} onChange={set("emergency_contact_phone")} /></Field>
          <Field label="Address line 1" className="sm:col-span-2"><Input value={v.address_line1 ?? ""} onChange={set("address_line1")} /></Field>
          <Field label="Address line 2" className="sm:col-span-2"><Input value={v.address_line2 ?? ""} onChange={set("address_line2")} /></Field>
          <Field label="City"><Input value={v.city ?? ""} onChange={set("city")} /></Field>
          <Field label="State / emirate"><Input value={v.state ?? ""} onChange={set("state")} /></Field>
          <Field label="Postal code"><Input value={v.postal_code ?? ""} onChange={set("postal_code")} /></Field>
        </>) : <p className="text-sm text-slate-500 sm:col-span-2">Personal contact details need personal-data access.</p>}
      </fieldset>

      <fieldset className={`${grid} ${show("employment")}`}>
        <legend className="sr-only">Employment details</legend>
        {!isNew && (
          <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 sm:col-span-2">
            Company, department, designation, grade, reporting manager and status are changed with <strong>Change assignment</strong> on the profile,
            so every promotion, transfer and manager change is kept in the employment history with its effective date and reason.
          </p>
        )}
        {!isNew ? (<>
          <LockedField label="Company / legal entity" value={nameOf(org?.legalEntities, v.legal_entity_id)} />
          <LockedField label="Department" value={nameOf(org?.departments, v.department_id)} />
        </>) : (<>
          <Field label="Company / legal entity"><Select placeholder="— None —" value={v.legal_entity_id ?? ""} onChange={set("legal_entity_id")} options={toOptions(org?.legalEntities)} /></Field>
          <Field label="Department"><Select placeholder="— None —" value={v.department_id ?? ""} onChange={(e) => { const dep = e.target.value; setV((s) => ({ ...s, department_id: dep, designation_id: (org?.designations ?? []).some((d) => d.id === s.designation_id && (!d.department_id || d.department_id === dep)) ? s.designation_id : "" })); }} options={toOptions(org?.departments)} /></Field>
        </>)}
        <Field label="Source department" error={errors.source_department_id} hint="Only when the employee is sourced from / charged to another department.">
          <Select placeholder="— Same as department —" value={v.source_department_id ?? ""} onChange={set("source_department_id")} options={toOptions(org?.departments)} />
        </Field>
        {!isNew ? (<>
          <LockedField label="Position / designation" value={nameOf(org?.designations, v.designation_id)} />
          <LockedField label="Grade / band" value={nameOf(org?.grades, v.grade_id)} />
        </>) : (<>
          <Field label="Position / designation" hint="Only designations of the chosen department (or company-wide) are listed."><Select placeholder="— None —" value={v.designation_id ?? ""} onChange={set("designation_id")} options={toOptions(designations)} /></Field>
          <Field label="Grade / band"><Select placeholder="— None —" value={v.grade_id ?? ""} onChange={set("grade_id")} options={toOptions(org?.grades)} /></Field>
        </>)}
        <Field label="Employment type" required error={errors.employment_type}><Select value={v.employment_type ?? ""} onChange={set("employment_type")} options={toOptions(org?.employmentTypes, "name", "code")} /></Field>
        <Field label="Work location"><Select placeholder="— None —" value={v.work_location_id ?? ""} onChange={set("work_location_id")} options={toOptions(org?.locations)} /></Field>
        <Field label="Work arrangement"><Select placeholder="— Not recorded —" value={v.work_arrangement ?? ""} onChange={set("work_arrangement")} options={WORK_ARRANGEMENTS} /></Field>
        <Field label="Shift"><Select placeholder="Company default" value={v.shift_id ?? ""} onChange={set("shift_id")} options={toOptions(org?.shifts)} /></Field>
        {!isNew
          ? <LockedField label="Reporting manager" value={(managers ?? []).find((m) => m.value === v.manager_id)?.label ?? (v.manager_id ? "Assigned" : null)} />
          : <Field label="Reporting manager" hint="Self-reporting and circular reporting lines are rejected."><Select placeholder="— None —" value={v.manager_id ?? ""} onChange={set("manager_id")} options={managerOptions} /></Field>}
        <Field label="Joining date"><Input type="date" value={v.joining_date ?? ""} onChange={set("joining_date")} /></Field>
        <Field label="Probation end date" error={errors.probation_end_date} hint={isNew ? "Leave blank to derive from the employment type." : undefined}><Input type="date" value={v.probation_end_date ?? ""} onChange={set("probation_end_date")} /></Field>
        {!isNew && <LockedField label="Employment status" value={String(initial.status ?? "").replace(/_/g, " ")} />}
      </fieldset>

      <fieldset className={`${grid} ${show("deployment")}`}>
        <legend className="sr-only">Deployment details</legend>
        <p className="text-sm text-slate-600 sm:col-span-2">Optional. Use only for employees deployed to a client or project; leave blank for ordinary staff.</p>
        <Field label="Deployment status"><Select placeholder="— Not applicable —" value={v.deployment_status ?? ""} onChange={set("deployment_status")} options={DEPLOYMENT_STATUSES} /></Field>
        <Field label="Client" required={v.deployment_status === "deployed"} error={errors.deployment_client}><Input value={v.deployment_client ?? ""} onChange={set("deployment_client")} /></Field>
        <Field label="Project / job number" error={errors.deployment_project_code}><Input value={v.deployment_project_code ?? ""} onChange={set("deployment_project_code")} /></Field>
        <div />
        <Field label="Deployment start"><Input type="date" value={v.deployment_start_date ?? ""} onChange={set("deployment_start_date")} /></Field>
        <Field label="Deployment end" error={errors.deployment_end_date}><Input type="date" value={v.deployment_end_date ?? ""} onChange={set("deployment_end_date")} /></Field>
      </fieldset>

      <fieldset className={`${grid} ${show("contract")}`}>
        <legend className="sr-only">Contract details</legend>
        <Field label="Contract type"><Select placeholder="— Not recorded —" value={v.contract_type ?? ""} onChange={set("contract_type")} options={CONTRACT_TYPES} /></Field>
        <Field label="Notice period (days)" error={errors.notice_period_days}><Input type="number" min={0} max={365} step={1} value={v.notice_period_days ?? ""} onChange={set("notice_period_days")} /></Field>
        <Field label="Contract start"><Input type="date" value={v.contract_start_date ?? ""} onChange={set("contract_start_date")} /></Field>
        <Field label="Contract end" error={errors.contract_end_date}><Input type="date" value={v.contract_end_date ?? ""} onChange={set("contract_end_date")} /></Field>
        {canSensitive && (
          <Field label="HR remarks (confidential)" error={errors.remarks} hint="Visible only to HR users with personal-data access — never to the employee or their manager." className="sm:col-span-2">
            <Textarea rows={3} value={v.remarks ?? ""} onChange={set("remarks")} />
          </Field>
        )}
      </fieldset>

      {canIdentity && (
        <fieldset className={`${grid} ${show("identity")}`}>
          <legend className="sr-only">Identification documents</legend>
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 sm:col-span-2">
            {rule ? <>Rules for <strong>{rule.country_name}</strong>{entity ? ` (${entity.name})` : " (company default)"}: {[
              rule.national_id_required && "national ID required", rule.passport_required && "passport required",
              isForeign && rule.work_permit_required_foreign && "work permit required (foreign national)", isForeign && rule.visa_required_foreign && "visa required (foreign national)",
            ].filter(Boolean).join(", ") || "no mandatory identity documents"}.{rule.notes ? ` ${rule.notes}` : ""}</> : "No identity rules are configured for this company's country."}
            <span className="mt-1 block text-xs">Attach scanned copies in Visa &amp; Documents (categories Passport, Work permit, Visa, National ID). Numbers are masked in audit logs.</span>
          </div>
          <Field label="National ID type" error={errors.national_id_type}><Select placeholder="— None —" value={v.national_id_type ?? ""} onChange={set("national_id_type")}
            options={[...new Set([...(rule?.national_id_types ?? []), ...(v.national_id_type ? [v.national_id_type] : [])])].map((t) => ({ value: t, label: t }))} /></Field>
          <Field label="National ID number" error={errors.national_id_number}><Input autoComplete="off" value={v.national_id_number ?? ""} onChange={set("national_id_number")} /></Field>
          <Field label="National ID expiry"><Input type="date" value={v.national_id_expiry ?? ""} onChange={set("national_id_expiry")} /></Field>
          <div />
          <Field label="Passport number" error={errors.passport_number}><Input autoComplete="off" value={v.passport_number ?? ""} onChange={set("passport_number", upper)} /></Field>
          <Field label="Passport issuing country" error={errors.passport_country}><Input maxLength={2} value={v.passport_country ?? ""} onChange={set("passport_country", upper)} /></Field>
          <Field label="Passport issue date"><Input type="date" value={v.passport_issue_date ?? ""} onChange={set("passport_issue_date")} /></Field>
          <Field label="Passport expiry" error={errors.passport_expiry}><Input type="date" value={v.passport_expiry ?? ""} onChange={set("passport_expiry")} /></Field>
          <Field label="Work permit / labour card type"><Input value={v.work_permit_type ?? ""} onChange={set("work_permit_type")} /></Field>
          <Field label="Work permit number" error={errors.work_permit_number}><Input autoComplete="off" value={v.work_permit_number ?? ""} onChange={set("work_permit_number")} /></Field>
          <Field label="Work permit expiry"><Input type="date" value={v.work_permit_expiry ?? ""} onChange={set("work_permit_expiry")} /></Field>
          <div />
          <Field label="Visa / residence type"><Input value={v.visa_type ?? ""} onChange={set("visa_type")} /></Field>
          <Field label="Visa number" error={errors.visa_number}><Input autoComplete="off" value={v.visa_number ?? ""} onChange={set("visa_number")} /></Field>
          <Field label="Visa expiry"><Input type="date" value={v.visa_expiry ?? ""} onChange={set("visa_expiry")} /></Field>
        </fieldset>
      )}

      <p className="text-xs text-slate-500">Banking and payroll identifiers are maintained by payroll users on the employee profile.</p>
      <InlineError message={formError} />
      {Object.keys(errors).length > 0 && (
        <ul className="-mt-2 list-disc rounded-lg border border-red-100 bg-red-50/50 py-2 pl-7 pr-3 text-xs text-red-700" aria-label="Fields to fix">
          {Object.entries(errors).map(([k, msg]) => (
            <li key={k}><button type="button" className="text-left hover:underline" onClick={() => setSection(SECTION_OF[k] ?? "employment")}>{sections.find((s) => s.key === (SECTION_OF[k] ?? "employment"))?.label}: {msg}</button></li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          {sections.findIndex((s) => s.key === section) > 0 && <Button variant="ghost" onClick={() => setSection(sections[sections.findIndex((s) => s.key === section) - 1].key)}>Back</Button>}
          {sections.findIndex((s) => s.key === section) < sections.length - 1 && <Button variant="secondary" onClick={() => setSection(sections[sections.findIndex((s) => s.key === section) + 1].key)}>Next section</Button>}
        </div>
        <div className="flex gap-2">
          {onCancel && <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>}
          <Button type="submit" loading={busy}>{submitLabel}</Button>
        </div>
      </div>
    </form>
  );
}
