// Employee: My Profile. Sections (tabs, deep-linkable with ?tab=):
//   personal    – personal information, contact details, emergency contact
//                 (self-service edit via RPC hr_update_my_contact)
//   employment  – employment details, reporting manager, identification
//                 (read only; managed by HR) and the employment timeline
//   bank        – salary bank accounts, masked (RPC hr_my_bank_accounts);
//                 changes only through a Payroll-reviewed profile change request
//   requests    – the employee's profile change requests (Module 10
//                 workflow "profile_change") with status; new request form
// RLS limits every query to the employee's own records.
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BadgeCheck, Landmark, Lock, Mail, Pencil, Plus, UserCog } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, fullName, rpc, useHrQuery } from "@/lib/hr/client";
import {
  CONTRACT_TYPES, DEPLOYMENT_STATUSES, GENDERS, MARITAL_STATUSES, arrangementLabel, getEmployee, getEmployeeIdentity, getEmployeePrivate,
  getReportingManager, labelOf,
} from "@/lib/hr/employees";
import { myBankAccounts } from "@/lib/hr/payroll";
import { listMyRequests } from "@/lib/hr/requests";
import { EmploymentTimeline } from "@/hr/components/EmployeeProfileSections";
import { RequestStatusBadge } from "@/hr/requests/RequestWidgets";
import { ProfileChangeForm } from "@/employee/requests/NewRequestForms";
import {
  Badge, Button, Card, DataTable, DescriptionList, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal, PageHeader, StatusBadge, Tabs, useToast,
} from "@/hr/ui";

const PHONE = /^[+0-9 ()-]{7,20}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TAB_KEYS = ["personal", "employment", "bank", "requests"];
// Requests still waiting on someone (employee or approver).
const OPEN_STATUSES = ["draft", "submitted", "pending_approval", "returned", "approved", "in_progress", "open"];

export default function MyProfilePage() {
  const { hr, refreshProfile } = useAuth();
  const id = hr?.employee?.id;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TAB_KEYS.includes(params.get("tab")) ? params.get("tab") : "personal";
  const setTab = (t) => setParams(t === "personal" ? {} : { tab: t }, { replace: true });

  const emp = useHrQuery(() => getEmployee(id), [id]);
  const priv = useHrQuery(() => getEmployeePrivate(id), [id]);
  const identity = useHrQuery(() => getEmployeeIdentity(id), [id]);
  const requests = useHrQuery(async () => {
    const res = await listMyRequests(id);
    return { ...res, data: res.data?.filter((r) => r.workflow === "profile_change") ?? null };
  }, [id]);
  const [editing, setEditing] = useState(false);
  const [requesting, setRequesting] = useState(null);   // null | "contact" | "bank"
  const { notify } = useToast();

  if (!id) return <ErrorState message="Your account is not linked to an employee record." />;
  if (emp.loading && !emp.data) return <Loading />;
  if (emp.error) return <ErrorState message={emp.error} onRetry={emp.reload} />;
  if (!emp.data) return <ErrorState message="Your employee record could not be found." onRetry={emp.reload} />;
  const e = emp.data;
  const openCount = (requests.data ?? []).filter((r) => OPEN_STATUSES.includes(r.status)).length;

  return (
    <>
      <PageHeader title={fullName(e)}
        description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono font-bold text-[#1f4693]">{e.employee_code}</span><StatusBadge status={e.status} />
          {e.designation?.name && <span className="text-slate-600">{e.designation.name}{e.department?.name ? ` · ${e.department.name}` : ""}</span>}</span>}
        actions={<>
          <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" aria-hidden="true" />Update contact details</Button>
          <Button onClick={() => setRequesting("contact")}><UserCog className="h-4 w-4" aria-hidden="true" />Request a change</Button>
        </>} />

      <Tabs label="Profile sections" value={tab} onChange={setTab} tabs={[
        { value: "personal", label: "Personal & contact" },
        { value: "employment", label: "Employment" },
        { value: "bank", label: "Bank details" },
        { value: "requests", label: "Update requests", ...(openCount ? { count: openCount } : {}) },
      ]} />

      {tab === "personal" && <PersonalTab employee={e} priv={priv} onEdit={() => setEditing(true)} onRequest={() => setRequesting("contact")} />}
      {tab === "employment" && <EmploymentTab employee={e} identity={identity} onRequest={() => setRequesting("contact")} />}
      {tab === "bank" && <BankTab onRequest={() => setRequesting("bank")} />}
      {tab === "requests" && <RequestsTab requests={requests} onRequest={() => setRequesting("contact")} onOpen={(r) => navigate(`/employee/requests/${r.id}`)} />}

      {editing && <ContactModal employee={e} initial={priv.data ?? {}} onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); priv.reload(); emp.reload(); refreshProfile(); notify("Contact details saved."); }} />}
      {requesting && <ProfileChangeForm employeeId={id} startWithBank={requesting === "bank"} onClose={() => setRequesting(null)}
        onDone={() => { setRequesting(null); requests.reload(); setTab("requests"); }} />}
    </>
  );
}

// ------------------------------------------------------- personal & contact
function PersonalTab({ employee: e, priv, onEdit, onRequest }) {
  if (priv.loading && !priv.data) return <Loading />;
  if (priv.error) return <ErrorState message={priv.error} onRetry={priv.reload} />;
  const p = priv.data ?? {};
  const address = [p.address_line1, p.address_line2, p.city, p.state, p.postal_code, p.country].filter(Boolean).join(", ") || null;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Personal information" actions={<Button size="sm" variant="secondary" onClick={onRequest}>Request correction</Button>}>
        <DescriptionList items={[
          { label: "Full name", value: [e.first_name, e.last_name].filter(Boolean).join(" ") || null },
          { label: "Preferred name", value: e.display_name },
          { label: "Date of birth", value: p.date_of_birth ? formatDate(p.date_of_birth) : null },
          { label: "Gender", value: labelOf(GENDERS, p.gender) },
          { label: "Nationality", value: p.nationality },
          { label: "Marital status", value: labelOf(MARITAL_STATUSES, p.marital_status) },
        ]} />
        <p className="mt-3 text-xs text-slate-500">Name, date of birth and gender are maintained by HR. Use Request correction if any of these are wrong.</p>
      </Card>
      <Card title="Contact details" actions={<Button size="sm" variant="secondary" onClick={onEdit}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit</Button>}>
        <DescriptionList items={[
          { label: "Company email", value: e.company_email },
          { label: "Personal email", value: p.personal_email },
          { label: "Phone", value: p.phone },
          { label: "Address", value: address },
        ]} />
        <p className="mt-3 text-xs text-slate-500">Visible to you and authorised HR only. Your company email is set by HR.</p>
      </Card>
      <Card title="Emergency contact" className="lg:col-span-2" actions={<Button size="sm" variant="secondary" onClick={onEdit}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit</Button>}>
        {p.emergency_contact_name || p.emergency_contact_phone ? (
          <DescriptionList items={[
            { label: "Name", value: p.emergency_contact_name },
            { label: "Relation", value: p.emergency_contact_relation },
            { label: "Phone", value: p.emergency_contact_phone },
          ]} />
        ) : (
          <EmptyState title="No emergency contact" description="Add someone HR can reach in an emergency."
            action={<Button size="sm" onClick={onEdit}>Add emergency contact</Button>} />
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- employment
function EmploymentTab({ employee: e, identity, onRequest }) {
  const id = identity.data;
  const masked = (num, expiry) => `•••• ${String(num).slice(-4)}${expiry ? ` · expires ${formatDate(expiry)}` : ""}`;
  const idItems = id ? [
    id.national_id_number && { label: id.national_id_type ?? "National ID", value: masked(id.national_id_number, id.national_id_expiry) },
    id.passport_number && { label: "Passport", value: masked(id.passport_number, id.passport_expiry) },
    id.work_permit_number && { label: id.work_permit_type ?? "Work permit", value: masked(id.work_permit_number, id.work_permit_expiry) },
    id.visa_number && { label: id.visa_type ?? "Visa", value: masked(id.visa_number, id.visa_expiry) },
  ].filter(Boolean) : [];
  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Employment details (managed by HR)" className="lg:col-span-2">
          <DescriptionList items={[
            { label: "Employee ID", value: e.employee_code },
            { label: "Company", value: e.legal_entity?.name },
            { label: "Department", value: e.department?.name },
            { label: "Designation", value: e.designation?.name },
            { label: "Grade / band", value: e.grade?.name },
            { label: "Employment type", value: e.employment_type ? e.employment_type.replace(/_/g, " ") : null },
            { label: "Joining date", value: e.joining_date ? formatDate(e.joining_date) : null },
            { label: "Probation end", value: e.probation_end_date ? formatDate(e.probation_end_date) : null },
            ...(e.confirmation_date ? [{ label: "Confirmed on", value: formatDate(e.confirmation_date) }] : []),
            { label: "Work location", value: e.location?.name },
            { label: "Work arrangement", value: arrangementLabel(e.work_arrangement) },
            { label: "Shift", value: e.shift ? `${e.shift.name} (${e.shift.start_time?.slice(0, 5)}–${e.shift.end_time?.slice(0, 5)})` : "Company default" },
            { label: "Contract type", value: labelOf(CONTRACT_TYPES, e.contract_type) },
            ...(e.contract_end_date ? [{ label: "Contract end", value: formatDate(e.contract_end_date) }] : []),
            { label: "Notice period", value: e.notice_period_days != null ? `${e.notice_period_days} days` : null },
            ...(e.deployment_status ? [{ label: "Deployment", value: [labelOf(DEPLOYMENT_STATUSES, e.deployment_status), e.deployment_client, e.deployment_project_code].filter(Boolean).join(" · ") }] : []),
          ]} />
          <p className="mt-3 text-xs text-slate-500">Something wrong here? <button type="button" className="font-semibold text-[#1f4693] underline" onClick={onRequest}>Request a correction</button> or raise an HR request.</p>
        </Card>
        <ManagerCard managerId={e.manager_id} fallback={e.manager} />
      </div>
      {idItems.length > 0 && (
        <Card title="Identification (maintained by HR)" className="mt-4">
          <DescriptionList items={idItems} />
          <p className="mt-3 text-xs text-slate-500">Numbers are masked. To correct them, upload the renewed document in My Documents or raise a “Profile update” HR request.</p>
        </Card>
      )}
      <div className="mt-4"><EmploymentTimeline employeeId={e.id} /></div>
    </>
  );
}

function ManagerCard({ managerId, fallback }) {
  const q = useHrQuery(() => getReportingManager(managerId), [managerId]);
  const m = q.data ?? fallback;
  return (
    <Card title="Reporting manager">
      {!managerId ? <p className="text-sm text-slate-600">No reporting manager is assigned. Contact HR if this is wrong.</p>
        : q.loading && !q.data ? <Loading />
        : !m ? <p className="text-sm text-slate-600">Your manager's details are not available.</p>
        : (
          <div className="flex items-start gap-3">
            <div aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#1f4693]/10 text-sm font-bold text-[#1f4693]">
              {fullName(m).split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-[#101a3a]">{fullName(m)}</p>
              <p className="text-sm text-slate-600">{[m.designation?.name, m.department?.name].filter(Boolean).join(" · ") || m.employee_code}</p>
              {m.company_email && (
                <a href={`mailto:${m.company_email}`} className="mt-1 inline-flex items-center gap-1 break-all text-sm font-semibold text-[#1f4693] hover:underline">
                  <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{m.company_email}
                </a>
              )}
            </div>
          </div>
        )}
      <p className="mt-3 text-xs text-slate-500">Your manager approves your leave, attendance corrections and claims. Manager changes are made by HR.</p>
    </Card>
  );
}

// ---------------------------------------------------------------------- bank
function BankTab({ onRequest }) {
  const bank = useHrQuery(() => myBankAccounts(), []);
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Lock className="h-4 w-4 text-slate-500" aria-hidden="true" />Bank information (restricted)</span>}
      actions={<Button size="sm" onClick={onRequest}><Landmark className="h-3.5 w-3.5" aria-hidden="true" />Request bank change</Button>}>
      <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
        Account numbers are masked. Only the Payroll team can see full bank details. You cannot edit them here: changes go through a request that Payroll reviews and verifies before your salary is paid into the new account.
      </p>
      {bank.loading && !bank.data ? <Loading /> : bank.error ? <ErrorState message={bank.error} onRetry={bank.reload} /> : !(bank.data ?? []).length ? (
        <EmptyState icon={Landmark} title="No bank account on file" description="Your salary account has not been added yet. Submit your bank details for Payroll to verify."
          action={<Button size="sm" onClick={onRequest}>Add bank details</Button>} />
      ) : (
        <ul className="flex flex-col gap-3">
          {bank.data.map((b) => (
            <li key={b.id} className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <p className="font-semibold text-[#101a3a]">{b.bank_name}</p>
                {b.is_primary && <Badge tone="blue">Salary account</Badge>}
                {b.verified ? <Badge tone="green"><BadgeCheck className="mr-1 inline h-3 w-3" aria-hidden="true" />Verified</Badge> : <Badge tone="amber">Pending verification</Badge>}
              </div>
              <DescriptionList items={[
                { label: "Account holder", value: b.account_holder },
                { label: "Account number", value: b.account_last4 ? `•••• •••• ${b.account_last4}` : null },
                { label: "IFSC", value: b.ifsc },
              ]} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ requests
function RequestsTab({ requests, onRequest, onOpen }) {
  return (
    <Card title="Profile update requests" actions={<Button size="sm" onClick={onRequest}><Plus className="h-3.5 w-3.5" aria-hidden="true" />New request</Button>}>
      <p className="mb-3 text-sm text-slate-600">
        Changes that need approval — such as a new address with proof, nationality, marital status or bank details — are tracked here. HR reviews personal and contact changes; Payroll reviews bank changes. Your profile updates automatically once a request is approved.
      </p>
      <DataTable caption="My profile update requests" rows={requests.data} loading={requests.loading} error={requests.error} onRetry={requests.reload}
        emptyTitle="No profile update requests" emptyDescription="Use New request to ask HR to change your details." onRowClick={onOpen}
        columns={[
          { key: "subject", header: "Request", render: (r) => <span className="font-semibold text-[#101a3a]">{r.subject}</span> },
          { key: "status", header: "Status", render: (r) => <RequestStatusBadge status={r.status} /> },
          { key: "created_at", header: "Submitted", sortable: true, render: (r) => formatDateTime(r.submitted_at ?? r.created_at) },
          { key: "last_activity_at", header: "Last update", sortable: true, render: (r) => formatDateTime(r.last_activity_at) },
        ]} />
    </Card>
  );
}

// ------------------------------------------------- direct contact self-edit
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
      <p className="mb-3 text-sm text-slate-600">These changes save immediately. For bank details, nationality or marital status, use Request a change.</p>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {F("display_name", "Preferred name")}{F("personal_email", "Personal email", "email")}{F("phone", "Phone", "tel")}
        {F("address_line1", "Address line 1")}{F("address_line2", "Address line 2")}{F("city", "City")}{F("state", "State")}{F("postal_code", "Postal code")}
      </div>
      <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Emergency contact</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {F("emergency_contact_name", "Name")}{F("emergency_contact_relation", "Relation")}{F("emergency_contact_phone", "Phone", "tel")}
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}
