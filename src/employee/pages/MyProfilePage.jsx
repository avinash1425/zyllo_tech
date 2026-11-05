// Employee: own profile (read) + self-service contact details (RPC
// hr_update_my_contact; employment data is managed by HR only) and the
// employee's own employment timeline (hr_employee_timeline, self access).
import { useState } from "react";
import { Pencil } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, fullName, rpc, useHrQuery } from "@/lib/hr/client";
import { CONTRACT_TYPES, DEPLOYMENT_STATUSES, GENDERS, MARITAL_STATUSES, arrangementLabel, getEmployee, getEmployeeIdentity, getEmployeePrivate, labelOf } from "@/lib/hr/employees";
import { EmploymentTimeline } from "@/hr/components/EmployeeProfileSections";
import { Button, Card, DescriptionList, ErrorState, Field, InlineError, Input, Loading, Modal, PageHeader, StatusBadge, useToast } from "@/hr/ui";

const PHONE = /^[+0-9 ()-]{7,20}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function MyProfilePage() {
  const { hr, refreshProfile } = useAuth();
  const id = hr?.employee?.id;
  const emp = useHrQuery(() => getEmployee(id), [id]);
  const priv = useHrQuery(() => getEmployeePrivate(id), [id]);
  const identity = useHrQuery(() => getEmployeeIdentity(id), [id]);
  const [editing, setEditing] = useState(false);
  const { notify } = useToast();

  if (emp.loading && !emp.data) return <Loading />;
  if (emp.error) return <ErrorState message={emp.error} onRetry={emp.reload} />;
  const e = emp.data;
  const p = priv.data ?? {};
  return (
    <>
      <PageHeader title={fullName(e)} description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono font-bold text-[#1f4693]">{e.employee_code}</span><StatusBadge status={e.status} /></span>}
        actions={<Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" aria-hidden="true" />Update contact details</Button>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Employment (managed by HR)">
          <DescriptionList items={[
            { label: "Company email", value: e.company_email },
            { label: "Company", value: e.legal_entity?.name },
            { label: "Department", value: e.department?.name },
            { label: "Designation", value: e.designation?.name },
            { label: "Grade / band", value: e.grade?.name },
            { label: "Reporting manager", value: e.manager ? fullName(e.manager) : null },
            { label: "Employment type", value: e.employment_type.replace(/_/g, " ") },
            { label: "Joining date", value: formatDate(e.joining_date) },
            { label: "Probation end", value: formatDate(e.probation_end_date) },
            ...(e.confirmation_date ? [{ label: "Confirmed on", value: formatDate(e.confirmation_date) }] : []),
            { label: "Work location", value: e.location?.name },
            { label: "Work arrangement", value: arrangementLabel(e.work_arrangement) },
            { label: "Shift", value: e.shift ? `${e.shift.name} (${e.shift.start_time?.slice(0, 5)}–${e.shift.end_time?.slice(0, 5)})` : "Company default" },
            { label: "Contract type", value: labelOf(CONTRACT_TYPES, e.contract_type) },
            { label: "Contract end", value: e.contract_end_date ? formatDate(e.contract_end_date) : null },
            { label: "Notice period", value: e.notice_period_days != null ? `${e.notice_period_days} days` : null },
            ...(e.deployment_status ? [{ label: "Deployment", value: [labelOf(DEPLOYMENT_STATUSES, e.deployment_status), e.deployment_client, e.deployment_project_code].filter(Boolean).join(" · ") }] : []),
          ]} />
          <p className="mt-3 text-xs text-slate-500">Something wrong here? Raise an HR request.</p>
        </Card>
        <Card title="Personal & contact (visible to you and authorised HR only)">
          {priv.loading ? <Loading /> : priv.error ? <ErrorState message={priv.error} onRetry={priv.reload} /> : (
            <DescriptionList items={[
              { label: "Preferred name", value: e.display_name },
              { label: "Date of birth", value: formatDate(p.date_of_birth) },
              { label: "Gender", value: labelOf(GENDERS, p.gender) },
              { label: "Nationality", value: p.nationality },
              { label: "Marital status", value: labelOf(MARITAL_STATUSES, p.marital_status) },
              { label: "Personal email", value: p.personal_email },
              { label: "Phone", value: p.phone },
              { label: "Address", value: [p.address_line1, p.address_line2, p.city, p.state, p.postal_code].filter(Boolean).join(", ") || null },
              { label: "Emergency contact", value: p.emergency_contact_name ? `${p.emergency_contact_name}${p.emergency_contact_relation ? ` (${p.emergency_contact_relation})` : ""} · ${p.emergency_contact_phone ?? ""}` : null },
            ]} />
          )}
        </Card>
        {identity.data && (
          <Card title="Identification (maintained by HR)" className="lg:col-span-2">
            <DescriptionList items={[
              identity.data.national_id_number && { label: identity.data.national_id_type ?? "National ID", value: `•••• ${identity.data.national_id_number.slice(-4)}${identity.data.national_id_expiry ? ` · expires ${formatDate(identity.data.national_id_expiry)}` : ""}` },
              identity.data.passport_number && { label: "Passport", value: `•••• ${identity.data.passport_number.slice(-4)}${identity.data.passport_expiry ? ` · expires ${formatDate(identity.data.passport_expiry)}` : ""}` },
              identity.data.work_permit_number && { label: identity.data.work_permit_type ?? "Work permit", value: `•••• ${identity.data.work_permit_number.slice(-4)}${identity.data.work_permit_expiry ? ` · expires ${formatDate(identity.data.work_permit_expiry)}` : ""}` },
              identity.data.visa_number && { label: identity.data.visa_type ?? "Visa", value: `•••• ${identity.data.visa_number.slice(-4)}${identity.data.visa_expiry ? ` · expires ${formatDate(identity.data.visa_expiry)}` : ""}` },
            ]} />
            <p className="mt-3 text-xs text-slate-500">To correct these, upload the renewed document in My Documents or raise a “Profile update” HR request.</p>
          </Card>
        )}
      </div>
      <div className="mt-4"><EmploymentTimeline employeeId={e.id} /></div>
      {editing && <ContactModal employee={e} initial={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); priv.reload(); emp.reload(); refreshProfile(); notify("Contact details saved."); }} />}
    </>
  );
}

function ContactModal({ employee, initial, onClose, onSaved }) {
  const [v, setV] = useState({ display_name: employee.display_name ?? "", ...initial });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    const errs = {};
    if (v.phone && !PHONE.test(v.phone)) errs.phone = "Use digits, spaces, + ( ) - only.";
    if (v.emergency_contact_phone && !PHONE.test(v.emergency_contact_phone)) errs.emergency_contact_phone = "Use digits, spaces, + ( ) - only.";
    if (v.personal_email && !EMAIL.test(v.personal_email)) errs.personal_email = "Enter a valid email.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const res = await rpc("hr_update_my_contact", {
      p_phone: v.phone ?? null, p_personal_email: v.personal_email ?? null, p_address_line1: v.address_line1 ?? null, p_address_line2: v.address_line2 ?? null,
      p_city: v.city ?? null, p_state: v.state ?? null, p_postal_code: v.postal_code ?? null, p_emergency_name: v.emergency_contact_name ?? null,
      p_emergency_relation: v.emergency_contact_relation ?? null, p_emergency_phone: v.emergency_contact_phone ?? null, p_display_name: v.display_name ?? null,
    });
    setBusy(false);
    if (res.error) setError(res.error); else onSaved();
  }
  const F = (k, label, type = "text") => <Field label={label} error={errors[k]}><Input type={type} value={v[k] ?? ""} onChange={set(k)} /></Field>;
  return (
    <Modal open onClose={onClose} title="Update contact details" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {F("display_name", "Preferred name")}{F("personal_email", "Personal email", "email")}{F("phone", "Phone", "tel")}
        {F("address_line1", "Address line 1")}{F("address_line2", "Address line 2")}{F("city", "City")}{F("state", "State")}{F("postal_code", "Postal code")}
        {F("emergency_contact_name", "Emergency contact name")}{F("emergency_contact_relation", "Relation")}{F("emergency_contact_phone", "Emergency contact phone", "tel")}
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}
