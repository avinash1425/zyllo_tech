// Module 14 — HR Settings: company profile, employee ID format, org master
// data, roles & permissions, notification templates, audit log.
// Module-specific settings (leave types, holidays, payroll components, review
// cycles, document categories, asset/request categories) are registered by
// those modules through SETTINGS_EXTENSIONS below.
import { useMemo, useState } from "react";
import Link from "@/hr/platform/link";
import { useAuth } from "@/hr/platform/auth";
import { formatDateTime, from, run, useHrQuery } from "@/lib/hr/client";
import { toOptions, useOrg } from "@/lib/hr/org";
import {
  Badge, Button, Card, Checkbox, DataTable, ErrorState, Field, InlineError, Input, Loading, Modal, PageHeader, Select, Textarea, useToast,
} from "@/hr/ui";
import MasterDataEditor from "@/hr/components/MasterDataEditor";
import { SETTINGS_EXTENSIONS } from "@/hr/settingsExtensions";

const TIMEZONES = ["Asia/Kolkata", "UTC", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York"];

export default function SettingsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("settings.manage");
  const org = useOrg();
  const tabs = useMemo(() => [
    ...(hasPermission("settings.view") || canManage ? [
      { value: "company", label: "Company" }, { value: "employee_id", label: "Employee ID" },
      { value: "legal_entities", label: "Legal entities" },
      { value: "departments", label: "Departments" }, { value: "designations", label: "Designations" }, { value: "grades", label: "Grades & bands" },
      { value: "locations", label: "Locations" }, { value: "shifts", label: "Shifts & working days" },
      { value: "employment_types", label: "Employment types" }, { value: "identity_rules", label: "Identity document rules" },
      { value: "templates", label: "Notification templates" },
    ] : []),
    ...(["leave.view", "leave.manage", "leave.adjust"].some((p) => hasPermission(p)) ? [{ value: "leave_balances", label: "Leave balances" }] : []),
    // Module tabs are visible to their own permission holders (e.g. documents.manage) even without settings.view.
    ...SETTINGS_EXTENSIONS.filter((x) => x.permissions.some((p) => hasPermission(p))).map((x) => ({ value: x.key, label: x.label })),
    ...(hasPermission("roles.manage") ? [{ value: "roles", label: "Roles & permissions" }] : []),
    ...(hasPermission("audit.view") ? [{ value: "audit", label: "Audit log" }] : []),
  ], [hasPermission, canManage]);
  const [tab, setTab] = useState(tabs[0]?.value);

  const configs = {
    legal_entities: { table: "hr_legal_entities", title: "Legal entities", singular: "legal entity",
      description: "Companies employees are contracted with. The country selects the identity document rules.",
      columns: [{ key: "code", header: "Code" }, { key: "name", header: "Name" }, { key: "country", header: "Country" }, { key: "registration_number", header: "Registration no." }],
      fields: [{ key: "code", label: "Code", required: true, uppercase: true, pattern: "^[A-Za-z0-9_-]{2,20}$", patternMessage: "2–20 letters, digits, _ or -." },
        { key: "name", label: "Name", required: true }, { key: "legal_name", label: "Registered legal name", wide: true },
        { key: "country", label: "Country (ISO code)", required: true, uppercase: true, pattern: "^[A-Za-z]{2}$", patternMessage: "Two-letter country code, e.g. IN or AE." },
        { key: "registration_number", label: "Registration number" }, { key: "tax_number", label: "Tax number" }, { key: "address", label: "Address", type: "textarea", wide: true }],
      defaults: { country: "IN" } },
    grades: { table: "hr_grades", title: "Grades & bands", singular: "grade", orderBy: "level",
      columns: [{ key: "code", header: "Code" }, { key: "name", header: "Name" }, { key: "level", header: "Level" }, { key: "description", header: "Description" }],
      fields: [{ key: "code", label: "Code", required: true, uppercase: true, pattern: "^[A-Za-z0-9_-]{1,20}$", patternMessage: "1–20 letters, digits, _ or -." },
        { key: "name", label: "Name", required: true }, { key: "level", label: "Level (1–50)", type: "number", min: 1, max: 50 }, { key: "description", label: "Description", type: "textarea", wide: true }] },
    identity_rules: { table: "hr_identity_requirements", title: "Identity document rules", singular: "country rule", keyField: "country", orderBy: "country",
      description: "Required identity documents per country (the employee's legal-entity country). \"Foreign\" means the nationality differs from that country.",
      columns: [{ key: "country", header: "Country" }, { key: "country_name", header: "Name" },
        { key: "national_id_types", header: "National ID types", render: (r) => (r.national_id_types ?? []).join(", ") || "—" },
        { key: "rules", header: "Required", render: (r) => [r.national_id_required && "national ID", r.passport_required && "passport", r.work_permit_required_foreign && "permit (foreign)", r.visa_required_foreign && "visa (foreign)"].filter(Boolean).join(", ") || "—" },
        { key: "expiry_reminder_days", header: "Reminder (days)" }],
      fields: [{ key: "country", label: "Country (ISO code)", required: true, createOnly: true, uppercase: true, pattern: "^[A-Za-z]{2}$", patternMessage: "Two-letter country code." },
        { key: "country_name", label: "Country name", required: true },
        { key: "national_id_types", label: "National ID types (comma-separated)", wide: true },
        { key: "expiry_reminder_days", label: "Expiry reminder (days before)", type: "number", min: 1, max: 365, required: true },
        { key: "national_id_required", label: "National ID required", type: "checkbox" }, { key: "passport_required", label: "Passport required", type: "checkbox" },
        { key: "work_permit_required_foreign", label: "Work permit required for foreign nationals", type: "checkbox" },
        { key: "visa_required_foreign", label: "Visa required for foreign nationals", type: "checkbox" },
        { key: "notes", label: "Notes (shown on the employee form)", type: "textarea", wide: true }],
      defaults: { expiry_reminder_days: 60 },
      transform: (p) => ({ ...p, national_id_types: String(Array.isArray(p.national_id_types) ? p.national_id_types.join(",") : p.national_id_types ?? "").split(",").map((x) => x.trim()).filter(Boolean),
        national_id_required: Boolean(p.national_id_required), passport_required: Boolean(p.passport_required),
        work_permit_required_foreign: Boolean(p.work_permit_required_foreign), visa_required_foreign: Boolean(p.visa_required_foreign) }) },
    departments: { table: "hr_departments", title: "Departments & organisation units", singular: "department", select: "id, code, name, parent_id, legal_entity_id, unit_type, head_employee_id, active",
      description: "Units form the Org Structure tree (division → department → unit → team). Circular parents are rejected.",
      columns: [{ key: "code", header: "Code" }, { key: "name", header: "Name" }, { key: "unit_type", header: "Type" },
        { key: "parent_id", header: "Parent", render: (r) => org.data?.departments.find((d) => d.id === r.parent_id)?.name ?? "—" },
        { key: "legal_entity_id", header: "Company", render: (r) => org.data?.legalEntities?.find((x) => x.id === r.legal_entity_id)?.name ?? "—" }],
      fields: [{ key: "code", label: "Code", required: true, uppercase: true, pattern: "^[A-Za-z0-9_-]{2,20}$", patternMessage: "2–20 letters, digits, _ or -." },
        { key: "name", label: "Name", required: true }, { key: "parent_id", label: "Parent department", type: "select", options: (v) => toOptions((org.data?.departments ?? []).filter((d) => d.id !== v.id)) },
        { key: "unit_type", label: "Unit type", type: "select", required: true, placeholder: undefined, options: ["division", "department", "unit", "team"].map((x) => ({ value: x, label: x })) },
        { key: "legal_entity_id", label: "Company / legal entity", type: "select", options: toOptions(org.data?.legalEntities) }],
      defaults: { unit_type: "department" } },
    designations: { table: "hr_designations", title: "Designations", singular: "designation", select: "id, name, department_id, level, active",
      columns: [{ key: "name", header: "Name" }, { key: "department_id", header: "Department", render: (r) => org.data?.departments.find((d) => d.id === r.department_id)?.name ?? "Any" }, { key: "level", header: "Level" }],
      fields: [{ key: "name", label: "Name", required: true }, { key: "department_id", label: "Department", type: "select", placeholder: "Any department", options: toOptions(org.data?.departments) }, { key: "level", label: "Level (1–20)", type: "number", min: 1, max: 20 }] },
    locations: { table: "hr_locations", title: "Office locations", singular: "location", select: "id, name, city, address, timezone, active",
      columns: [{ key: "name", header: "Name" }, { key: "city", header: "City" }, { key: "timezone", header: "Timezone" }],
      fields: [{ key: "name", label: "Name", required: true }, { key: "city", label: "City" }, { key: "address", label: "Address", type: "textarea", wide: true },
        { key: "timezone", label: "Timezone", type: "select", placeholder: undefined, required: true, options: TIMEZONES.map((t) => ({ value: t, label: t })) }],
      defaults: { timezone: "Asia/Kolkata" } },
    shifts: { table: "hr_shifts", title: "Shifts", singular: "shift", select: "*",
      description: "Attendance uses the employee's shift (or the default shift) for late, early-leave and overtime calculations.",
      columns: [{ key: "name", header: "Name" }, { key: "time", header: "Hours", render: (r) => `${r.start_time?.slice(0, 5)}–${r.end_time?.slice(0, 5)}` },
        { key: "grace_minutes", header: "Grace (min)" }, { key: "break_minutes", header: "Break (min)" },
        { key: "working_days", header: "Working days", render: (r) => (r.working_days ?? []).map((d) => ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]).join(" ") },
        { key: "is_default", header: "Default", render: (r) => (r.is_default ? <Badge tone="orange">default</Badge> : "—") }],
      fields: [{ key: "name", label: "Name", required: true }, { key: "start_time", label: "Start", type: "time", required: true }, { key: "end_time", label: "End", type: "time", required: true },
        { key: "grace_minutes", label: "Late grace (minutes)", type: "number", min: 0, max: 240, required: true }, { key: "break_minutes", label: "Break (minutes)", type: "number", min: 0, max: 480, required: true },
        { key: "early_leave_grace_minutes", label: "Early-leave grace (minutes)", type: "number", min: 0, max: 240, required: true },
        { key: "overtime_after_minutes", label: "Overtime counts after (minutes beyond shift)", type: "number", min: 0, max: 1440, hint: "Blank = overtime not tracked beyond the shift length." },
        { key: "working_days", label: "Working days", type: "days" }, { key: "is_default", label: "Default shift for employees without one", type: "checkbox" }],
      defaults: { grace_minutes: 10, break_minutes: 60, early_leave_grace_minutes: 10, working_days: [1, 2, 3, 4, 5] } },
    employment_types: { table: "hr_employment_types", title: "Employment types", singular: "employment type", keyField: "code", orderBy: "sort_order", select: "*",
      columns: [{ key: "code", header: "Code" }, { key: "name", header: "Name" }, { key: "probation_months", header: "Probation (months)" }, { key: "is_intern", header: "Intern", render: (r) => (r.is_intern ? "yes" : "—") }],
      fields: [{ key: "code", label: "Code", required: true, createOnly: true, pattern: "^[a-z_]{2,30}$", patternMessage: "lowercase letters and _ only." }, { key: "name", label: "Name", required: true },
        { key: "probation_months", label: "Probation (months)", type: "number", min: 0, max: 24, required: true }, { key: "sort_order", label: "Sort order", type: "number", min: 0, max: 100 },
        { key: "is_intern", label: "Intern type", type: "checkbox" }],
      defaults: { probation_months: 0, sort_order: 10 } },
  };

  if (!tabs.length) return <ErrorState message="You do not have access to HR settings." />;
  const ext = SETTINGS_EXTENSIONS.find((x) => x.key === tab);
  const groups = SETTINGS_GROUPS.map((g) => ({ ...g, items: tabs.filter((t) => (GROUP_OF[t.value] ?? "Other") === g.label) })).filter((g) => g.items.length);
  const others = tabs.filter((t) => !SETTINGS_GROUPS.some((g) => g.label === (GROUP_OF[t.value] ?? "Other")));
  if (others.length) groups.push({ label: "Other", items: others });

  return (
    <>
      <PageHeader title="HR Settings" description={canManage ? "One place for HR configuration. Changes are recorded in the audit log." : "Read-only: you do not have settings.manage."} />
      <div role="tablist" aria-label="Settings sections" className="mb-4 grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-2 xl:grid-cols-4">
        {groups.map((g) => (
          <div key={g.label} className="min-w-0">
            <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{g.label}</p>
            <div className="flex flex-wrap gap-1">
              {g.items.map((t) => (
                <button key={t.value} role="tab" type="button" aria-selected={tab === t.value} onClick={() => setTab(t.value)}
                  className={`rounded-lg px-2.5 py-1 text-left text-sm font-semibold transition ${tab === t.value ? "bg-gradient-to-r from-[#f7941e] to-[#f96706] text-white" : "text-slate-700 hover:bg-slate-100"}`}>{t.label}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {tab === "company" && <CompanySettings canEdit={canManage} />}
      {tab === "employee_id" && <EmployeeIdSettings canEdit={canManage} />}
      {configs[tab] && (org.loading ? <Loading /> : <Card><MasterDataEditor key={tab} config={configs[tab]} canEdit={canManage} /></Card>)}
      {tab === "templates" && <Card><MasterDataEditor config={{
        table: "hr_notification_templates", title: "Notification templates", singular: "template", keyField: "key", orderBy: "key",
        description: "Copy used for in-app notifications and optional emails. Placeholders like {{employee_name}} are filled by the sending module.",
        columns: [{ key: "key", header: "Key" }, { key: "channel", header: "Channel" }, { key: "subject", header: "Subject" }],
        fields: [{ key: "key", label: "Key", required: true, createOnly: true, pattern: "^[a-z][a-z0-9_.]*$", patternMessage: "lowercase, digits, . and _ only." },
          { key: "channel", label: "Channel", type: "select", required: true, placeholder: undefined, options: [{ value: "in_app", label: "In-app" }, { value: "email", label: "Email" }, { value: "both", label: "Both" }] },
          { key: "subject", label: "Subject", required: true, wide: true }, { key: "body", label: "Body", type: "textarea", required: true, wide: true }],
        defaults: { channel: "in_app" } }} canEdit={canManage} /></Card>}
      {ext && <ext.Component canEdit={ext.manage.some((p) => hasPermission(p))} />}
      {tab === "leave_balances" && (
        <Card title="Leave balances & policies">
          <p className="text-sm text-slate-600">Balances are initialised per leave year and adjusted with an audited reason in Leave Management. Entitlements, accrual and carry-forward are set per leave type (Leave types tab); the approval flow and application windows are in “Attendance, report, leave &amp; payroll rules”.</p>
          <div className="mt-3 flex flex-wrap gap-2"><Link href="/hr/leave" className="rounded-xl bg-gradient-to-r from-[#f7941e] to-[#f96706] px-4 py-2 text-sm font-semibold text-white">Open leave balances</Link></div>
        </Card>
      )}
      {tab === "roles" && <RolesMatrix />}
      {tab === "audit" && <AuditLog />}
    </>
  );
}

// Settings navigation groups (one coherent configuration area).
const SETTINGS_GROUPS = [
  { label: "Organisation" }, { label: "Time, leave & approvals" }, { label: "Pay, benefits & talent" }, { label: "Compliance, requests & access" },
];
const GROUP_OF = {
  company: "Organisation", employee_id: "Organisation", legal_entities: "Organisation", departments: "Organisation", designations: "Organisation",
  grades: "Organisation", locations: "Organisation", employment_types: "Organisation",
  shifts: "Time, leave & approvals", holidays: "Time, leave & approvals", leave_types: "Time, leave & approvals", leave_balances: "Time, leave & approvals", module_rules: "Time, leave & approvals",
  salary_components: "Pay, benefits & talent", benefit_plans: "Pay, benefits & talent", training_categories: "Pay, benefits & talent",
  review_cycles: "Pay, benefits & talent", kpi_definitions: "Pay, benefits & talent", projects: "Pay, benefits & talent",
  document_categories: "Compliance, requests & access", identity_rules: "Compliance, requests & access", request_categories: "Compliance, requests & access",
  templates: "Compliance, requests & access", roles: "Compliance, requests & access", audit: "Compliance, requests & access",
};

function useSetting(key) {
  return useHrQuery(() => run(from("hr_settings").select("key, value, updated_at").eq("key", key).maybeSingle()), [key]);
}
async function saveSetting(key, value) {
  return run(from("hr_settings").update({ value }).eq("key", key).select("key").single());
}

function CompanySettings({ canEdit }) {
  const s = useSetting("company");
  const { notify } = useToast();
  const [v, setV] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (s.loading && !s.data) return <Loading />;
  if (s.error) return <ErrorState message={s.error} onRetry={s.reload} />;
  const val = v ?? s.data?.value ?? {};
  const set = (k) => (e) => setV({ ...val, [k]: e.target.value });
  const days = val.working_days ?? [1, 2, 3, 4, 5];
  async function save() {
    if (!val.name?.trim() || !val.legal_name?.trim()) { setError("Company name and legal name are required."); return; }
    if (!days.length) { setError("Choose at least one working day."); return; }
    setBusy(true); const res = await saveSetting("company", { ...val, fiscal_year_start_month: Number(val.fiscal_year_start_month) || 4 }); setBusy(false);
    if (res.error) setError(res.error); else { setError(null); setV(null); s.reload(); notify("Company settings saved."); }
  }
  return (
    <Card title="Company profile & business calendar">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Company name" required><Input value={val.name ?? ""} onChange={set("name")} disabled={!canEdit} /></Field>
        <Field label="Legal name" required><Input value={val.legal_name ?? ""} onChange={set("legal_name")} disabled={!canEdit} /></Field>
        <Field label="Business timezone" hint="Used for attendance dates, leave and reports."><Select value={val.timezone ?? "Asia/Kolkata"} onChange={set("timezone")} disabled={!canEdit} options={TIMEZONES.map((t) => ({ value: t, label: t }))} /></Field>
        <Field label="Currency"><Select value={val.currency ?? "INR"} onChange={set("currency")} disabled={!canEdit} options={["INR", "USD", "AED", "SGD", "GBP"].map((c) => ({ value: c, label: c }))} /></Field>
        <Field label="Fiscal year starts (month)"><Input type="number" min={1} max={12} value={val.fiscal_year_start_month ?? 4} onChange={set("fiscal_year_start_month")} disabled={!canEdit} /></Field>
        <fieldset className="sm:col-span-2"><legend className="text-sm font-semibold text-[#173a52]">Company working days</legend>
          <div className="mt-1 flex flex-wrap gap-3">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
            <Checkbox key={d} label={d} disabled={!canEdit} checked={days.includes(i + 1)} onChange={(e) => setV({ ...val, working_days: e.target.checked ? [...new Set([...days, i + 1])].sort() : days.filter((x) => x !== i + 1) })} />))}</div>
        </fieldset>
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
      {canEdit && <div className="mt-4 flex justify-end"><Button loading={busy} onClick={save}>Save</Button></div>}
      <p className="mt-2 text-xs text-slate-500">Last updated {formatDateTime(s.data?.updated_at)}</p>
    </Card>
  );
}

function EmployeeIdSettings({ canEdit }) {
  const s = useSetting("employee_id");
  const { notify } = useToast();
  const [v, setV] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (s.loading && !s.data) return <Loading />;
  if (s.error) return <ErrorState message={s.error} onRetry={s.reload} />;
  const val = v ?? s.data?.value ?? {};
  const preview = `${val.prefix ?? "ZT"}${val.separator ?? "-"}${"1".padStart(Number(val.padding) || 4, "0")}`;
  async function save() {
    if (!/^[A-Z0-9]{1,8}$/.test(val.prefix ?? "")) { setError("Prefix must be 1–8 uppercase letters or digits."); return; }
    if (!["-", "/", "", "_"].includes(val.separator ?? "-")) { setError("Separator must be -, /, _ or empty."); return; }
    const pad = Number(val.padding);
    if (!(pad >= 3 && pad <= 8)) { setError("Padding must be between 3 and 8."); return; }
    setBusy(true); const res = await saveSetting("employee_id", { prefix: val.prefix, separator: val.separator ?? "-", padding: pad }); setBusy(false);
    if (res.error) setError(res.error); else { setError(null); setV(null); s.reload(); notify("Employee ID format saved. It applies to new employees only."); }
  }
  return (
    <Card title="Employee ID generation">
      <p className="mb-3 text-sm text-slate-600">IDs are generated by the database from a sequence, are unique, are never reused and cannot be edited. Changing the format affects only employees created afterwards.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Prefix"><Input value={val.prefix ?? ""} onChange={(e) => setV({ ...val, prefix: e.target.value.toUpperCase() })} disabled={!canEdit} /></Field>
        <Field label="Separator"><Select value={val.separator ?? "-"} onChange={(e) => setV({ ...val, separator: e.target.value })} disabled={!canEdit} options={[{ value: "-", label: "-" }, { value: "/", label: "/" }, { value: "_", label: "_" }, { value: "", label: "(none)" }]} /></Field>
        <Field label="Digits"><Input type="number" min={3} max={8} value={val.padding ?? 4} onChange={(e) => setV({ ...val, padding: e.target.value })} disabled={!canEdit} /></Field>
      </div>
      <p className="mt-3 text-sm">Preview: <span className="font-mono font-bold text-[#1f4693]">{preview}</span></p>
      <div className="mt-3"><InlineError message={error} /></div>
      {canEdit && <div className="mt-4 flex justify-end"><Button loading={busy} onClick={save}>Save</Button></div>}
    </Card>
  );
}

function RolesMatrix() {
  const { notify } = useToast();
  const roles = useHrQuery(() => run(from("hr_roles").select("key, name, description, is_system").order("name")), []);
  const perms = useHrQuery(() => run(from("hr_permissions").select("key, module, action, description").order("module").order("action")), []);
  const grants = useHrQuery(() => run(from("hr_role_permissions").select("role_key, permission_key")), []);
  const [busyKey, setBusyKey] = useState(null);
  const [creating, setCreating] = useState(false);
  if ((roles.loading || perms.loading || grants.loading) && !grants.data) return <Loading />;
  const err = roles.error || perms.error || grants.error;
  if (err) return <ErrorState message={err} onRetry={() => { roles.reload(); perms.reload(); grants.reload(); }} />;
  const has = new Set((grants.data ?? []).map((g) => `${g.role_key}|${g.permission_key}`));
  const editableRoles = (roles.data ?? []).filter((r) => r.key !== "super_admin");
  async function toggle(role, perm, on) {
    const k = `${role}|${perm}`;
    setBusyKey(k);
    const res = on
      ? await run(from("hr_role_permissions").insert({ role_key: role, permission_key: perm }))
      : await run(from("hr_role_permissions").delete().eq("role_key", role).eq("permission_key", perm));
    setBusyKey(null);
    if (res.error) notify(res.error, "error"); else grants.reload();
  }
  const modules = [...new Set((perms.data ?? []).map((p) => p.module))];
  return (
    <Card title="Role permissions" actions={<Button size="sm" onClick={() => setCreating(true)}>New custom role</Button>}>
      <p className="mb-3 text-sm text-slate-600">Super Admin always has every permission. Changes take effect immediately and are audited. Employees and interns access their own records without any permission.</p>
      <div className="relative overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead><tr className="bg-slate-50"><th scope="col" className="sticky left-0 bg-slate-50 px-3 py-2 text-left">Permission</th>{editableRoles.map((r) => <th key={r.key} scope="col" className="px-2 py-2 text-center">{r.name}</th>)}</tr></thead>
          <tbody>
            {modules.map((m) => (
              <PermissionGroup key={m} module={m} perms={perms.data.filter((p) => p.module === m)} roles={editableRoles} has={has} busyKey={busyKey} onToggle={toggle} />
            ))}
          </tbody>
        </table>
      </div>
      <NewRoleModal open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); roles.reload(); notify("Role created."); }} />
    </Card>
  );
}
function PermissionGroup({ module, perms, roles, has, busyKey, onToggle }) {
  return (
    <>
      <tr><th colSpan={roles.length + 1} scope="rowgroup" className="bg-orange-50/60 px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#c24f05]">{module.replace(/_/g, " ")}</th></tr>
      {perms.map((p) => (
        <tr key={p.key} className="border-t border-slate-100">
          <th scope="row" className="sticky left-0 bg-white px-3 py-1.5 text-left font-medium text-slate-700" title={p.description}>{p.action.replace(/_/g, " ")}<span className="block text-[10px] font-normal text-slate-500">{p.description}</span></th>
          {roles.map((r) => {
            const k = `${r.key}|${p.key}`;
            return <td key={r.key} className="px-2 py-1.5 text-center"><input type="checkbox" aria-label={`${r.name}: ${p.key}`} checked={has.has(k)} disabled={busyKey === k} onChange={(e) => onToggle(r.key, p.key, e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-[#f96706]" /></td>;
          })}
        </tr>
      ))}
    </>
  );
}
function NewRoleModal({ open, onClose, onCreated }) {
  const [v, setV] = useState({ key: "", name: "", description: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!/^[a-z][a-z_]{1,40}$/.test(v.key)) { setError("Key: lowercase letters and underscores, 2–41 characters."); return; }
    if (!v.name.trim()) { setError("Name is required."); return; }
    setBusy(true); const res = await run(from("hr_roles").insert({ key: v.key, name: v.name.trim(), description: v.description.trim() || null })); setBusy(false);
    if (res.error) setError(res.error); else { setV({ key: "", name: "", description: "" }); setError(null); onCreated(); }
  }
  return (
    <Modal open={open} onClose={onClose} title="New custom role" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Create</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Key" required hint="e.g. recruiter"><Input value={v.key} onChange={(e) => setV({ ...v, key: e.target.value })} /></Field>
        <Field label="Name" required><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Description"><Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

const AUDIT_PAGE = 50;
function AuditLog() {
  const [f, setF] = useState({ table: "", action: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const q = useHrQuery(() => {
    let x = from("hr_audit_log").select("id, occurred_at, actor_user_id, actor_employee_id, action, table_name, record_id, old_data, new_data, context", { count: "exact" });
    if (f.table) x = x.eq("table_name", f.table);
    if (f.action) x = x.eq("action", f.action);
    if (f.from) x = x.gte("occurred_at", `${f.from}T00:00:00+05:30`);
    if (f.to) x = x.lte("occurred_at", `${f.to}T23:59:59+05:30`);
    return run(x.order("occurred_at", { ascending: false }).range((page - 1) * AUDIT_PAGE, page * AUDIT_PAGE - 1));
  }, [f.table, f.action, f.from, f.to, page]);
  const upd = (k) => (e) => { setPage(1); setF((s) => ({ ...s, [k]: e.target.value })); };
  const changed = (r) => (r.old_data && r.new_data ? Object.keys(r.new_data).filter((k) => JSON.stringify(r.new_data[k]) !== JSON.stringify(r.old_data[k]) && !["updated_at"].includes(k)) : []);
  return (
    <>
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
        <Field label="Table"><Input value={f.table} onChange={upd("table")} placeholder="e.g. hr_employees" /></Field>
        <Field label="Action"><Select placeholder="Any" value={f.action} onChange={upd("action")} options={["INSERT", "UPDATE", "DELETE"].map((a) => ({ value: a, label: a }))} /></Field>
        <Field label="From"><Input type="date" value={f.from} onChange={upd("from")} /></Field>
        <Field label="To"><Input type="date" value={f.to} onChange={upd("to")} /></Field>
      </div>
      <DataTable caption="Audit log" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload}
        serverPaging={{ page, pageSize: AUDIT_PAGE, total: q.count ?? 0, onPage: setPage }} onRowClick={setDetail}
        columns={[
          { key: "occurred_at", header: "When", render: (r) => formatDateTime(r.occurred_at) },
          { key: "action", header: "Action", render: (r) => <Badge tone={r.action === "DELETE" ? "red" : r.action === "INSERT" ? "green" : "blue"}>{r.action}</Badge> },
          { key: "table_name", header: "Table", render: (r) => <span className="font-mono text-xs">{r.table_name ?? "—"}</span> },
          { key: "record_id", header: "Record", render: (r) => <span className="font-mono text-xs">{r.record_id?.slice(0, 8) ?? "—"}</span> },
          { key: "changes", header: "Changed fields", render: (r) => changed(r).join(", ") || "—" },
          { key: "actor", header: "Actor", render: (r) => <span className="font-mono text-xs">{r.actor_user_id ? r.actor_user_id.slice(0, 8) : "system"}</span> },
        ]} />
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="Audit entry" size="lg">
        {detail && <pre className="max-h-[60vh] overflow-auto rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify({ ...detail }, null, 2)}</pre>}
      </Modal>
    </>
  );
}
