// Employee Management — employee profile: overview (lifecycle, completeness),
// job & reporting (manager, direct reports), personal (PII), identification,
// documents, banking & payroll (payroll users only), exit (from Exit
// Management), employment timeline, access & roles. Assignment changes
// (promotion, transfer, manager, lifecycle) are recorded with an effective
// date and reason. Every tab is permission-gated here AND by RLS.
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Camera, ExternalLink, KeyRound, Mail, Pencil, Plus, Shuffle, TrendingUp, UserCog } from "lucide-react";
import Link from "@/hr/platform/link";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, fullName, useHrQuery } from "@/lib/hr/client";
import {
  CONTRACT_TYPES, DEPLOYMENT_STATUSES, GENDERS, MARITAL_STATUSES, PAYMENT_MODES, arrangementLabel, assignRole, completeness, getEmployee,
  getEmployeeIdentity, getEmployeePrivate, getEmployeeRemarks, getEmployeeRoles, getExitClearance, getIdentityStatus, getLatestExit, getPayrollIdentifiers,
  inviteEmployee, labelOf, listBankAccounts, listRoles, revokeRole, saveBankAccount, savePayrollIdentifiers, setPortalAccess,
} from "@/lib/hr/employees";
import { ChangeAssignmentModal, EmployeeDocumentsSection, EmploymentTimeline, LifecycleCard, ReportingSection } from "@/hr/components/EmployeeProfileSections";
import EmployeeAssetsPanel from "@/hr/components/EmployeeAssetsPanel";
import { checkAvatarFile, getAvatarUrl } from "@/lib/hr/documents";
import { rpc, supabase } from "@/lib/hr/client";
import { toOptions, useEmployeeOptions, useOrg } from "@/lib/hr/org";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, DescriptionList, EmptyState, ErrorState, Field, InlineError, Input,
  Loading, Modal, PageHeader, Select, StatusBadge, Tabs, useToast,
} from "@/hr/ui";
import EmployeeForm, { saveEmployeeAll } from "@/hr/components/EmployeeForm";

const mask = (v) => (v ? `•••• ${String(v).slice(-4)}` : null);
const daysLeft = (d) => (d ? Math.round((new Date(`${d}T00:00:00`) - new Date(new Date().toLocaleDateString("en-CA") + "T00:00:00")) / 86400000) : null);
function ExpiryBadge({ date }) {
  if (!date) return null;
  const n = daysLeft(date);
  if (n < 0) return <Badge tone="red">expired</Badge>;
  if (n <= 60) return <Badge tone="amber">{n} days left</Badge>;
  return <Badge tone="green">valid</Badge>;
}

export default function EmployeeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission, user, hr } = useAuth();
  const { notify } = useToast();
  const canEdit = hasPermission("employees.edit");
  const canSensitive = hasPermission("employees.view_sensitive");
  const canIdentity = hasPermission("employees.view_identity");
  const canPayroll = hasPermission("payroll.view");
  const canPayrollEdit = hasPermission("payroll.manage");
  const canExit = ["exit.view", "exit.view_team", "exit.manage"].some((p) => hasPermission(p));
  const emp = useHrQuery(() => getEmployee(id), [id]);
  const priv = useHrQuery(() => (canSensitive ? getEmployeePrivate(id) : Promise.resolve({ data: null, error: null })), [id, canSensitive]);
  const identity = useHrQuery(() => (canIdentity ? getEmployeeIdentity(id) : Promise.resolve({ data: null, error: null })), [id, canIdentity]);
  const remarks = useHrQuery(() => (canSensitive ? getEmployeeRemarks(id) : Promise.resolve({ data: null, error: null })), [id, canSensitive]);
  const canDocs = ["documents.view", "documents.view_team", "documents.manage"].some((p) => hasPermission(p));
  const canAssets = ["assets.view", "assets.manage"].some((p) => hasPermission(p));   // Module 11
  const [historyKey, setHistoryKey] = useState(0);
  const history = useMemo(() => ({ reload: () => setHistoryKey((k) => k + 1) }), []);
  const [change, setChange] = useState(null);   // preset for ChangeAssignmentModal
  const roles = useHrQuery(() => getEmployeeRoles(emp.data?.user_id), [emp.data?.user_id]);
  const allRoles = useHrQuery(listRoles, []);
  const org = useOrg();
  const managers = useEmployeeOptions();
  const [tab, setTab] = useState("overview");
  const [modal, setModal] = useState(null);   // edit | transfer | manager | invite | access | role | photo

  const info = useMemo(() => completeness(emp.data, priv.data, identity.data, { sensitive: canSensitive, identityAccess: canIdentity }),
    [emp.data, priv.data, identity.data, canSensitive, canIdentity]);

  if (emp.loading && !emp.data) return <Loading />;
  if (emp.error) return <ErrorState message={emp.error} onRetry={emp.reload} />;
  if (!emp.data) return <EmptyState title="Employee not found" description="The record does not exist or you are not allowed to view it." action={<Button variant="secondary" onClick={() => navigate("/hr/employees")}>Back to list</Button>} />;

  const e = emp.data;
  const canInvite = hasPermission("employees.invite");
  const canRoles = hasPermission("roles.manage");
  const terminal = ["exited", "archived"].includes(e.status);
  const refreshAll = () => { emp.reload(); history.reload(); roles.reload(); managers.reload(); priv.reload(); identity.reload(); remarks.reload(); };
  const editInitial = { ...e, ...(priv.data ?? {}), ...(identity.data ?? {}), remarks: remarks.data?.remarks ?? "" };
  const isSelf = Boolean(hr?.employee?.id) && hr.employee.id === e.id && !hasPermission("roles.manage");

  return (
    <>
      <button type="button" onClick={() => navigate("/hr/employees")} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All employees
      </button>
      <div className="mb-1 flex items-start gap-4">
        <Avatar employee={e} canEdit={canEdit && !terminal} onChange={() => setModal("photo")} />
        <div className="min-w-0 flex-1">
          <PageHeader title={fullName(e)} description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono font-bold text-[#1f4693]">{e.employee_code}</span><StatusBadge status={e.status} />{e.designation?.name && <span>{e.designation.name}</span>}{e.department?.name && <span>· {e.department.name}</span>}{e.legal_entity?.name && <span>· {e.legal_entity.name}</span>}{e.name_arabic && <span dir="rtl" lang="ar">· {e.name_arabic}</span>}</span>}
            actions={<>
              {canEdit && !terminal && !isSelf && e.status !== "suspended" && <Button variant="secondary" onClick={() => setChange({ category: "promotion" })}><TrendingUp className="h-4 w-4" aria-hidden="true" />Promote</Button>}
              {canEdit && !terminal && !isSelf && e.status !== "suspended" && <Button variant="secondary" onClick={() => setChange({ category: "transfer" })}><Shuffle className="h-4 w-4" aria-hidden="true" />Transfer</Button>}
              {canEdit && !terminal && !isSelf && <Button variant="secondary" onClick={() => setChange({ category: e.status === "suspended" ? "reactivation" : "manager_change", status: e.status === "suspended" ? "active" : undefined })}><UserCog className="h-4 w-4" aria-hidden="true" />Change assignment</Button>}
              {canEdit && <Button onClick={() => setModal("edit")} disabled={(canSensitive && priv.loading) || (canIdentity && identity.loading)}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>}
            </>} />
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "overview", label: "Overview" },
        { value: "reporting", label: "Job & reporting" },
        ...(canSensitive ? [{ value: "personal", label: "Personal" }] : []),
        ...(canIdentity ? [{ value: "identity", label: "Identification" }] : []),
        ...(canDocs ? [{ value: "documents", label: "Documents" }] : []),
        { value: "history", label: "Employment history" },
        ...(canPayroll ? [{ value: "payroll", label: "Banking & payroll" }] : []),
        ...(canAssets ? [{ value: "assets", label: "Assets" }] : []),
        ...(canExit ? [{ value: "exit", label: "Exit" }] : []),
        { value: "access", label: "Access & roles" },
      ]} />

      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="flex flex-col gap-4 xl:col-span-2">
            <Card title="Employment">
              <DescriptionList items={[
                { label: "Employee ID", value: e.employee_code },
                { label: "Company email", value: e.company_email },
                { label: "Company / legal entity", value: e.legal_entity?.name },
                { label: "Department", value: e.department?.name },
                { label: "Source department", value: e.source_department?.name },
                { label: "Designation", value: e.designation?.name },
                { label: "Grade / band", value: e.grade?.name },
                { label: "Reporting manager", value: e.manager ? `${fullName(e.manager)} (${e.manager.employee_code})` : null },
                { label: "Employment type", value: e.employment_type.replace(/_/g, " ") },
                { label: "Work location", value: e.location?.name },
                { label: "Work arrangement", value: arrangementLabel(e.work_arrangement) },
                { label: "Shift", value: e.shift ? `${e.shift.name} (${e.shift.start_time?.slice(0, 5)}–${e.shift.end_time?.slice(0, 5)})` : "Company default" },
                { label: "Joining date", value: formatDate(e.joining_date) },
                { label: "Probation end", value: formatDate(e.probation_end_date) },
                { label: "Record source", value: e.source.replace(/_/g, " ") },
              ]} />
            </Card>
            <Card title="Contract">
              <DescriptionList items={[
                { label: "Contract type", value: labelOf(CONTRACT_TYPES, e.contract_type) },
                { label: "Contract period", value: e.contract_start_date || e.contract_end_date ? `${formatDate(e.contract_start_date)} – ${formatDate(e.contract_end_date)}` : null },
                { label: "Notice period", value: e.notice_period_days != null ? `${e.notice_period_days} days` : null },
                ...(canSensitive ? [{ label: "HR remarks (confidential)", value: remarks.data?.remarks }] : []),
              ]} />
            </Card>
            {(e.deployment_status || e.deployment_client) && (
              <Card title="Deployment">
                <DescriptionList items={[
                  { label: "Status", value: labelOf(DEPLOYMENT_STATUSES, e.deployment_status) },
                  { label: "Client", value: e.deployment_client },
                  { label: "Project / job number", value: e.deployment_project_code },
                  { label: "Period", value: e.deployment_start_date ? `${formatDate(e.deployment_start_date)} – ${e.deployment_end_date ? formatDate(e.deployment_end_date) : "ongoing"}` : null },
                ]} />
              </Card>
            )}
          </div>
          <div className="flex flex-col gap-4">
          <LifecycleCard employee={e} canEdit={canEdit} isSelf={isSelf} canExit={canExit} onAction={(preset) => setChange(preset)} onOpenTab={setTab} />
          <Card title="Record completeness">
            <div className="flex items-center gap-3">
              <span className="text-3xl font-extrabold text-[#101a3a]">{info.pct}%</span>
              <span className="text-sm text-slate-600">{info.filled} of {info.total} key fields recorded</span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={info.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Record completeness">
              <span className={`block h-full rounded-full ${info.pct >= 90 ? "bg-emerald-500" : info.pct >= 60 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${info.pct}%` }} />
            </div>
            {info.missing.length ? (
              <ul className="mt-3 flex flex-wrap gap-1.5">{info.missing.map((m) => <li key={m.label}><Badge tone="amber">{m.label}</Badge></li>)}</ul>
            ) : <p className="mt-3 text-sm text-emerald-700">Every key field is recorded.</p>}
            <p className="mt-3 text-xs text-slate-500">Only fields you are allowed to see are counted.</p>
          </Card>
          </div>
        </div>
      )}

      {tab === "personal" && (
        <Card title="Personal details" actions={canEdit && <Button size="sm" variant="secondary" onClick={() => setModal("edit")}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>}>
          {priv.loading ? <Loading /> : priv.error ? <ErrorState message={priv.error} onRetry={priv.reload} /> : !priv.data ? (
            <EmptyState title="No personal details recorded" />
          ) : (
            <DescriptionList items={[
              { label: "Date of birth", value: formatDate(priv.data.date_of_birth) },
              { label: "Gender", value: labelOf(GENDERS, priv.data.gender) },
              { label: "Nationality", value: priv.data.nationality },
              { label: "Marital status", value: labelOf(MARITAL_STATUSES, priv.data.marital_status) },
              { label: "Personal email", value: priv.data.personal_email },
              { label: "Mobile number", value: priv.data.phone },
              { label: "Address", value: [priv.data.address_line1, priv.data.address_line2, priv.data.city, priv.data.state, priv.data.postal_code].filter(Boolean).join(", ") || null },
              { label: "Emergency contact", value: priv.data.emergency_contact_name ? `${priv.data.emergency_contact_name}${priv.data.emergency_contact_relation ? ` (${priv.data.emergency_contact_relation})` : ""} · ${priv.data.emergency_contact_phone ?? ""}` : null },
            ]} />
          )}
        </Card>
      )}

      {tab === "identity" && <IdentityTab employee={e} identity={identity} canEdit={canEdit} onEdit={() => setModal("edit")} />}
      {tab === "payroll" && <PayrollTab employee={e} canEdit={canPayrollEdit} />}
      {tab === "assets" && canAssets && <EmployeeAssetsPanel employeeId={e.id} />}
      {tab === "exit" && <ExitTab employee={e} />}

      {tab === "reporting" && <ReportingSection employee={e} canEdit={canEdit} isSelf={isSelf} onChangeManager={() => setChange({ category: "manager_change" })} />}
      {tab === "documents" && <EmployeeDocumentsSection employee={e} canManage={hasPermission("documents.manage")} canAudit={hasPermission("documents.view") || hasPermission("documents.manage")} myEmployeeId={hr?.employee?.id} />}
      {tab === "history" && <EmploymentTimeline employeeId={e.id} refreshKey={historyKey} />}

      {tab === "access" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Portal account">
            <DescriptionList items={[
              { label: "Account", value: e.user_id ? <Badge tone="green">linked</Badge> : <Badge>not invited</Badge> },
              { label: "Portal access", value: e.portal_access ? <Badge tone="green">enabled</Badge> : <Badge tone="red">disabled</Badge> },
              { label: "Invited", value: formatDateTime(e.invited_at) },
              { label: "Activated", value: formatDateTime(e.activated_at) },
            ]} />
            {canInvite && !terminal && (
              <div className="mt-4 flex flex-wrap gap-2">
                {!e.user_id && <Button onClick={() => setModal("invite")} disabled={!e.company_email}><Mail className="h-4 w-4" aria-hidden="true" />Send secure invitation</Button>}
                {e.user_id && <Button variant={e.portal_access ? "danger" : "success"} onClick={() => setModal("access")}><KeyRound className="h-4 w-4" aria-hidden="true" />{e.portal_access ? "Disable portal access" : "Enable portal access"}</Button>}
              </div>
            )}
            {!e.company_email && canInvite && <p className="mt-2 text-xs text-slate-500">Add a company email before inviting.</p>}
          </Card>
          <Card title="Roles" actions={canRoles && e.user_id && !terminal && <Button size="sm" variant="secondary" onClick={() => setModal("role")}>Assign role</Button>}>
            {!e.user_id ? <p className="text-sm text-slate-600">Roles can be assigned after the employee accepts the invitation.</p>
              : roles.loading ? <Loading /> : roles.error ? <ErrorState message={roles.error} onRetry={roles.reload} /> : (
                <ul className="flex flex-col gap-2">
                  {(roles.data ?? []).map((r) => (
                    <li key={r.role_key} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
                      <span><span className="font-semibold text-[#101a3a]">{allRoles.data?.find((x) => x.key === r.role_key)?.name ?? r.role_key}</span><span className="block text-xs text-slate-500">since {formatDate(r.granted_at)}</span></span>
                      {canRoles && !(r.role_key === "super_admin" && e.user_id === user?.id) && <RevokeRole userId={e.user_id} role={r.role_key} onDone={() => { roles.reload(); history.reload(); }} />}
                    </li>
                  ))}
                  {!roles.data?.length && <li className="text-sm text-slate-600">No roles assigned.</li>}
                </ul>
              )}
          </Card>
        </div>
      )}

      <Modal open={modal === "edit"} onClose={() => setModal(null)} title={`Edit ${fullName(e)}`} size="xl">
        {org.data ? (
          <EmployeeForm initial={editInitial} org={org.data} managers={managers.data} canSensitive={canSensitive} canIdentity={canIdentity && canEdit}
            onCancel={() => setModal(null)}
            onSubmit={async (v) => {
              const res = await saveEmployeeAll(e.id, v, editInitial, { canSensitive, canIdentity: canIdentity && canEdit });
              if (res.error && !res.partial) return res;
              setModal(null); notify(res.error ?? "Employee updated.", res.error ? "error" : "success"); refreshAll();
              return {};
            }} />
        ) : <Loading />}
      </Modal>
      {change && org.data && (
        <ChangeAssignmentModal employee={e} org={org.data} managers={managers.data} preset={change} canArchive={hasPermission("employees.archive")}
          onClose={() => setChange(null)}
          onDone={(label) => { setChange(null); notify(`${label} recorded in the employment history.`); refreshAll(); }} />
      )}
      <PhotoModal open={modal === "photo"} onClose={() => setModal(null)} employee={e} onSaved={() => { setModal(null); emp.reload(); notify("Photo updated."); }} />
      <ConfirmDialog open={modal === "invite"} onClose={() => setModal(null)} title="Send portal invitation"
        message={`A secure invitation will be emailed to ${e.company_email}. The employee sets their own password; no password is ever stored or shown here.`}
        confirmLabel="Send invitation"
        onConfirm={async () => { const res = await inviteEmployee(e.id); if (!res.error) { notify(`Invitation sent to ${res.data.email}.`); refreshAll(); } return res; }} />
      <ConfirmDialog open={modal === "access"} onClose={() => setModal(null)} tone={e.portal_access ? "danger" : "success"}
        title={e.portal_access ? "Disable portal access" : "Enable portal access"}
        message={e.portal_access ? "The employee will immediately lose access to every HR and Employee Portal record." : "The employee will regain access with their existing account."}
        confirmLabel={e.portal_access ? "Disable access" : "Enable access"}
        onConfirm={async () => { const res = await setPortalAccess(e.id, !e.portal_access); if (!res.error) { notify(e.portal_access ? "Portal access disabled." : "Portal access enabled."); refreshAll(); } return res; }} />
      <RoleModal open={modal === "role"} onClose={() => setModal(null)} userId={e.user_id} roles={allRoles.data} current={roles.data}
        onDone={(role) => { setModal(null); notify(`Role ${role} assigned.`); roles.reload(); history.reload(); }} />
    </>
  );
}

function Avatar({ employee, canEdit, onChange }) {
  const url = useHrQuery(() => getAvatarUrl(employee.photo_path), [employee.photo_path]);
  const initials = (fullName(employee)[0] || "?").toUpperCase();
  return (
    <div className="relative shrink-0">
      {url.data ? <img src={url.data} alt={`Photo of ${fullName(employee)}`} className="h-16 w-16 rounded-2xl object-cover ring-1 ring-slate-200" />
        : <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f7941e] to-[#1f4693] text-2xl font-extrabold text-white" aria-hidden="true">{initials}</span>}
      {canEdit && <button type="button" onClick={onChange} aria-label="Change photo" className="absolute -bottom-1 -right-1 rounded-full border border-slate-200 bg-white p-1.5 text-[#173a52] shadow hover:bg-slate-50"><Camera className="h-3.5 w-3.5" aria-hidden="true" /></button>}
    </div>
  );
}

function PhotoModal({ open, onClose, employee, onSaved }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save(remove = false) {
    setError(null);
    if (remove) {
      setBusy(true); const r = await rpc("hr_set_employee_photo", { p_employee: employee.id, p_path: null }); setBusy(false);
      if (r.error) setError(r.error); else onSaved();
      return;
    }
    const chk = checkAvatarFile(file);
    if (chk.error) { setError(chk.error); return; }
    const path = `${employee.id}/photo.${chk.ext}`;
    setBusy(true);
    try {
      const { error: upErr } = await supabase.storage.from("hr-avatars").upload(path, file, { upsert: true, contentType: chk.mime, cacheControl: "60" });
      if (upErr) { setBusy(false); setError(upErr.message || "Upload failed."); return; }
    } catch (err) { setBusy(false); setError(err.message || "Upload failed."); return; }
    const r = await rpc("hr_set_employee_photo", { p_employee: employee.id, p_path: path });
    setBusy(false);
    if (r.error) setError(r.error); else onSaved();
  }
  return (
    <Modal open={open} onClose={onClose} title="Employee photograph" size="sm"
      footer={<>{employee.photo_path && <Button variant="ghost" onClick={() => save(true)} disabled={busy}>Remove photo</Button>}<Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!file} onClick={() => save(false)}>Upload</Button></>}>
      <Field label="Photo (PNG, JPEG or WebP, max 2 MB)"><Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(ev) => setFile(ev.target.files?.[0] ?? null)} /></Field>
      <p className="mt-2 text-xs text-slate-500">Stored in a private bucket; shown through short-lived signed links.</p>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function IdentityTab({ employee, identity, canEdit, onEdit }) {
  const status = useHrQuery(() => getIdentityStatus(employee.id), [employee.id, identity.data?.updated_at]);
  if (identity.loading && !identity.data) return <Loading />;
  if (identity.error) return <ErrorState message={identity.error} onRetry={identity.reload} />;
  const i = identity.data ?? {};
  const missing = status.data?.missing ?? [];
  return (
    <div className="flex flex-col gap-4">
      <Card title="Identity compliance" actions={canEdit && <Button size="sm" variant="secondary" onClick={onEdit}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>}>
        {status.error ? <InlineError message={status.error} /> : missing.length
          ? <p className="text-sm text-amber-800">Rules for <strong>{status.data?.country}</strong>: missing or expired — {missing.join(", ")}.</p>
          : <p className="text-sm text-emerald-700">Meets the identity requirements for {status.data?.country ?? "the company's country"}.</p>}
        <p className="mt-2 text-xs text-slate-500">Numbers are shown masked. Scans are kept in <Link href="/hr/documents" className="font-semibold text-[#1f4693] hover:underline">Visa &amp; Documents <ExternalLink className="inline h-3 w-3" aria-hidden="true" /></Link>.</p>
      </Card>
      {!identity.data ? <EmptyState title="No identification recorded" description={canEdit ? "Use Edit → Identification to record documents." : undefined} /> : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="National ID"><DescriptionList items={[{ label: "Type", value: i.national_id_type }, { label: "Number", value: mask(i.national_id_number) }, { label: "Expiry", value: i.national_id_expiry ? <span className="flex items-center gap-2">{formatDate(i.national_id_expiry)} <ExpiryBadge date={i.national_id_expiry} /></span> : null }]} /></Card>
          <Card title="Passport"><DescriptionList items={[{ label: "Number", value: mask(i.passport_number) }, { label: "Issuing country", value: i.passport_country }, { label: "Issued", value: formatDate(i.passport_issue_date) }, { label: "Expiry", value: i.passport_expiry ? <span className="flex items-center gap-2">{formatDate(i.passport_expiry)} <ExpiryBadge date={i.passport_expiry} /></span> : null }]} /></Card>
          <Card title="Work permit / labour card"><DescriptionList items={[{ label: "Type", value: i.work_permit_type }, { label: "Number", value: mask(i.work_permit_number) }, { label: "Expiry", value: i.work_permit_expiry ? <span className="flex items-center gap-2">{formatDate(i.work_permit_expiry)} <ExpiryBadge date={i.work_permit_expiry} /></span> : null }]} /></Card>
          <Card title="Visa / residence"><DescriptionList items={[{ label: "Type", value: i.visa_type }, { label: "Number", value: mask(i.visa_number) }, { label: "Expiry", value: i.visa_expiry ? <span className="flex items-center gap-2">{formatDate(i.visa_expiry)} <ExpiryBadge date={i.visa_expiry} /></span> : null }]} /></Card>
        </div>
      )}
    </div>
  );
}

function PayrollTab({ employee, canEdit }) {
  const { notify } = useToast();
  const ids = useHrQuery(() => getPayrollIdentifiers(employee.id), [employee.id]);
  const banks = useHrQuery(() => listBankAccounts(employee.id), [employee.id]);
  const [editIds, setEditIds] = useState(false);
  const [bank, setBank] = useState(null);
  const d = ids.data ?? {};
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Payroll-restricted: visible only to payroll users. Changes are audited with numbers redacted.</p>
      <Card title="Payroll identifiers" actions={canEdit && <Button size="sm" variant="secondary" onClick={() => setEditIds(true)}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>}>
        {ids.loading && !ids.data ? <Loading /> : ids.error ? <ErrorState message={ids.error} onRetry={ids.reload} /> : (
          <DescriptionList items={[
            { label: "Payment mode", value: labelOf(PAYMENT_MODES, d.payment_mode) },
            { label: "Tax ID (PAN / TRN)", value: mask(d.tax_id) },
            { label: "Social security / UAN", value: mask(d.social_security_number) },
            { label: "Pension / PF number", value: mask(d.pension_number) },
            { label: "Health insurance / ESIC", value: mask(d.health_insurance_number) },
            { label: "WPS person ID", value: mask(d.wps_person_id) },
            { label: "Payroll code", value: d.payroll_code },
          ]} />
        )}
      </Card>
      <Card title="Bank accounts" actions={canEdit && <Button size="sm" onClick={() => setBank({ is_primary: !(banks.data ?? []).some((b) => b.is_primary && b.active), active: true })}><Plus className="h-4 w-4" aria-hidden="true" />Add account</Button>}>
        <DataTable caption="Bank accounts" rows={banks.data} loading={banks.loading} error={banks.error} onRetry={banks.reload} emptyTitle="No bank account recorded"
          columns={[
            { key: "bank_name", header: "Bank", render: (r) => <span className="font-semibold text-[#101a3a]">{r.bank_name}{r.branch ? <span className="block text-xs font-normal text-slate-500">{r.branch}</span> : null}</span> },
            { key: "account_holder", header: "Holder" },
            { key: "account_number", header: "Account", render: (r) => mask(r.account_number) },
            { key: "codes", header: "IFSC / IBAN / SWIFT", render: (r) => [r.ifsc, r.iban && mask(r.iban), r.swift_code].filter(Boolean).join(" · ") || "—" },
            { key: "flags", header: "Status", render: (r) => <span className="flex flex-wrap gap-1">{r.is_primary && <Badge tone="orange">primary</Badge>}{r.verified ? <Badge tone="green">verified</Badge> : <Badge>unverified</Badge>}{!r.active && <Badge>inactive</Badge>}</span> },
            ...(canEdit ? [{ key: "_e", header: <span className="sr-only">Actions</span>, render: (r) => <Button size="sm" variant="ghost" onClick={() => setBank({ ...r, account_number: "" })}>Edit</Button> }] : []),
          ]} />
      </Card>
      {editIds && <PayrollIdsModal employee={employee} initial={d} onClose={() => setEditIds(false)} onSaved={() => { setEditIds(false); ids.reload(); notify("Payroll identifiers saved."); }} />}
      {bank && <BankModal employee={employee} initial={bank} onClose={() => setBank(null)} onSaved={() => { setBank(null); banks.reload(); notify("Bank account saved."); }} />}
    </div>
  );
}

const ID_RE = /^[A-Za-z0-9/-]{4,30}$/;
function PayrollIdsModal({ employee, initial, onClose, onSaved }) {
  // Existing numbers are never sent back to the browser form: blank = keep.
  const [v, setV] = useState({ payment_mode: initial.payment_mode ?? "bank_transfer", payroll_code: initial.payroll_code ?? "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (ev) => setV((s) => ({ ...s, [k]: ev.target.value }));
  const fields = [["tax_id", "Tax ID (PAN / TRN)"], ["social_security_number", "Social security / UAN"], ["pension_number", "Pension / PF number"], ["health_insurance_number", "Health insurance / ESIC"], ["wps_person_id", "WPS person ID"]];
  async function save() {
    const errs = {};
    for (const [k, l] of fields) if (v[k] && !ID_RE.test(v[k].trim())) errs[k] = `${l}: 4–30 letters, digits, / or -.`;
    if (v.payroll_code && !/^[A-Za-z0-9/_-]{1,30}$/.test(v.payroll_code.trim())) errs.payroll_code = "Letters, digits, / _ - only.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const body = { payment_mode: v.payment_mode, payroll_code: v.payroll_code };
    for (const [k] of fields) body[k] = v[k]?.trim() ? v[k].trim().toUpperCase() : initial[k] ?? null;
    setBusy(true); const r = await savePayrollIdentifiers(employee.id, body); setBusy(false);
    if (r.error) setError(r.error); else onSaved();
  }
  return (
    <Modal open onClose={onClose} title="Payroll identifiers" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Payment mode"><Select value={v.payment_mode} onChange={set("payment_mode")} options={PAYMENT_MODES} /></Field>
        <Field label="Payroll code" error={errors.payroll_code}><Input value={v.payroll_code} onChange={set("payroll_code")} /></Field>
        {fields.map(([k, l]) => <Field key={k} label={l} error={errors[k]} hint={initial[k] ? `Current ${mask(initial[k])}. Leave blank to keep.` : undefined}><Input autoComplete="off" value={v[k] ?? ""} onChange={set(k)} /></Field>)}
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function BankModal({ employee, initial, onClose, onSaved }) {
  const isNew = !initial.id;
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (ev) => setV((s) => ({ ...s, [k]: ev.target.type === "checkbox" ? ev.target.checked : ev.target.value }));
  async function save() {
    const errs = {};
    if (!v.bank_name?.trim() || v.bank_name.trim().length < 2) errs.bank_name = "Bank name is required.";
    if (!v.account_holder?.trim() || v.account_holder.trim().length < 2) errs.account_holder = "Account holder is required.";
    if (isNew && !v.account_number?.trim()) errs.account_number = "Account number is required.";
    if (v.account_number && !/^[0-9A-Za-z]{6,34}$/.test(v.account_number.replace(/\s+/g, ""))) errs.account_number = "6–34 letters or digits.";
    if (v.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.ifsc.toUpperCase())) errs.ifsc = "IFSC format: 4 letters, 0, 6 letters/digits.";
    if (v.iban && !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(v.iban.replace(/\s+/g, "").toUpperCase())) errs.iban = "Enter a valid IBAN (country code, check digits, account).";
    if (v.swift_code && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v.swift_code.toUpperCase())) errs.swift_code = "SWIFT/BIC is 8 or 11 characters.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const body = { ...v };
    if (!isNew && !v.account_number?.trim()) delete body.account_number;   // keep the stored number
    if (!isNew && !v.iban?.trim()) delete body.iban;
    setBusy(true); const r = await saveBankAccount(employee.id, body); setBusy(false);
    if (r.error) setError(r.error); else onSaved();
  }
  return (
    <Modal open onClose={onClose} title={isNew ? "Add bank account" : "Edit bank account"} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Bank name" required error={errors.bank_name}><Input value={v.bank_name ?? ""} onChange={set("bank_name")} /></Field>
        <Field label="Branch"><Input value={v.branch ?? ""} onChange={set("branch")} /></Field>
        <Field label="Account holder" required error={errors.account_holder}><Input value={v.account_holder ?? ""} onChange={set("account_holder")} /></Field>
        <Field label="Account number" required={isNew} error={errors.account_number} hint={!isNew ? "Leave blank to keep the stored number." : undefined}><Input autoComplete="off" value={v.account_number ?? ""} onChange={set("account_number")} /></Field>
        <Field label="IFSC (India)" error={errors.ifsc}><Input value={v.ifsc ?? ""} onChange={set("ifsc")} /></Field>
        <Field label="IBAN" error={errors.iban} hint={!isNew && initial.iban ? "Leave blank to keep the stored IBAN." : undefined}><Input autoComplete="off" value={!isNew && v.iban === initial.iban ? "" : v.iban ?? ""} onChange={set("iban")} /></Field>
        <Field label="SWIFT / BIC" error={errors.swift_code}><Input value={v.swift_code ?? ""} onChange={set("swift_code")} /></Field>
        <div className="flex flex-col gap-2 pt-6"><Checkbox label="Primary account" checked={Boolean(v.is_primary)} onChange={set("is_primary")} /><Checkbox label="Active" checked={v.active !== false} onChange={set("active")} /></div>
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function ExitTab({ employee }) {
  const x = useHrQuery(() => getLatestExit(employee.id), [employee.id]);
  const items = useHrQuery(() => getExitClearance(x.data?.id), [x.data?.id]);
  if (x.loading && !x.data) return <Loading />;
  if (x.error) return <ErrorState message={x.error} onRetry={x.reload} />;
  const done = (items.data ?? []).filter((i) => ["completed", "waived", "not_applicable"].includes(i.status)).length;
  return (
    <Card title="Separation / exit" actions={x.data && <Link href={`/hr/exits/${x.data.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-[#1f4693] hover:underline">Open exit case <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></Link>}>
      {!x.data ? <EmptyState title="No exit case" description="Resignations and terminations are processed in Exit Management; the details appear here." /> : (
        <DescriptionList items={[
          { label: "Exit type", value: x.data.exit_type?.replace(/_/g, " ") },
          { label: "Case status", value: <StatusBadge status={x.data.status} /> },
          { label: "Resignation date", value: formatDate(x.data.resignation_date ?? employee.resignation_date) },
          { label: "Last working day", value: formatDate(x.data.approved_last_working_day ?? x.data.proposed_last_working_day ?? employee.last_working_date) },
          { label: "Reason", value: x.data.reason },
          { label: "Exit clearance", value: items.data?.length ? `${done} of ${items.data.length} items cleared` : "Not started" },
          { label: "Closed", value: x.data.closed_at ? formatDateTime(x.data.closed_at) : null },
        ]} />
      )}
    </Card>
  );
}

function RoleModal({ open, onClose, userId, roles, current, onDone }) {
  const [role, setRole] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const have = new Set((current ?? []).map((r) => r.role_key));
  async function go() {
    if (!role) { setError("Choose a role."); return; }
    setBusy(true); const res = await assignRole(userId, role); setBusy(false);
    if (res.error) setError(res.error); else { setRole(""); onDone(role); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Assign role" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Assign</Button></>}>
      <Field label="Role"><Select placeholder="Choose a role" value={role} onChange={(ev) => setRole(ev.target.value)} options={(roles ?? []).filter((r) => !have.has(r.key)).map((r) => ({ value: r.key, label: r.name }))} /></Field>
      <p className="mt-2 text-xs text-slate-500">Payroll Admin grants access to salary data. Only a Super Admin can grant Super Admin.</p>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function RevokeRole({ userId, role, onDone }) {
  const [open, setOpen] = useState(false);
  const { notify } = useToast();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Revoke</Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} tone="danger" title="Revoke role" message={`Remove the ${role.replace(/_/g, " ")} role from this account?`} confirmLabel="Revoke"
        onConfirm={async () => { const res = await revokeRole(userId, role); if (!res.error) { notify("Role revoked."); onDone(); } return res; }} />
    </>
  );
}
