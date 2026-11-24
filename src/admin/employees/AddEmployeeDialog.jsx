import { useEffect, useState } from "react";
import Link from "@/lib/nx/link";
import { Briefcase, Check, CheckCircle2, Copy, KeyRound, RefreshCw, UserPlus, X } from "lucide-react";
import { createEmployee, generatePassword, suggestEmployeeCode, validateNewEmployee } from "@/lib/api/admin/employees";
import { EmploymentTypeChoice, Field, ManagerPicker } from "./ui";
import { Alert } from "@/components/portal/PortalUI";
import { BTN_PRIMARY, BTN_SECONDARY, ICON_BTN, INPUT } from "@/components/portal/portalStyles";
import { checkRealEmail } from "@/lib/emailCheck";

const SECTION = "mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#8a90a0]";
const SECTION_ICON = "flex h-6 w-6 items-center justify-center rounded-md bg-[#eef2fb] text-[#1f4693]";
const DT = "text-[11px] font-bold uppercase tracking-wider text-[#9aa0ad] sm:pt-0.5";

const EMPTY = {
  employee_code: "",
  full_name: "",
  email: "",
  password: "",
  department: "",
  designation: "",
  date_of_joining: "",
  employment_type: "",
  work_location: "",
  reporting_manager_id: "",
  reporting_manager_name: "",
};

function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
      className="inline-flex items-center gap-1 rounded-md border border-[#dce6f7] bg-white px-2 py-0.5 font-sans text-xs font-semibold text-[#1f4693] transition-colors hover:bg-[#f0f4ff]"
    >
      {done ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      {done ? "Copied" : label}
    </button>
  );
}

/**
 * Admin: add a new employee — creates their sign-in account (work email +
 * temporary password) and their Employee Portal record in one step
 * (ep_admin_create_employee, migration 240). If the email already has a
 * sign-in account, that account is linked and its password is not changed.
 */
export default function AddEmployeeDialog({ employees, onClose, onCreated }) {
  const [form, setForm] = useState(() => ({
    ...EMPTY,
    employee_code: suggestEmployeeCode(employees),
    password: generatePassword(),
  }));
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null); // { employee, password }

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    const errs = validateNewEmployee(form);
    if (Object.keys(errs).length) {
      setErrors(errs);
      setMessage("Please fix the highlighted fields.");
      return;
    }
    setSaving(true);
    setMessage("");
    // Employees sign in with their own real email (migration 267).
    const real = await checkRealEmail(form.email);
    if (!real.ok) {
      setSaving(false);
      setErrors({ email: real.message });
      return setMessage(real.message);
    }
    const result = await createEmployee(form);
    setSaving(false);
    if (!result.ok) return setMessage(result.message);
    setCreated({ employee: result.employee, password: form.password });
    onCreated(result.employee);
  }

  const input = (k, label, props = {}) => (
    <Field id={`ne-${k}`} label={label} error={errors[k]} hint={props.hint} wide={props.wide}>
      <input
        id={`ne-${k}`}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete ?? "off"}
        placeholder={props.placeholder}
        value={form[k] ?? ""}
        onChange={(e) => set(k, props.upper ? e.target.value.toUpperCase() : e.target.value)}
        aria-invalid={errors[k] ? "true" : undefined}
        aria-describedby={errors[k] ? `ne-${k}-error` : undefined}
        className={`${INPUT(errors[k])} ${props.mono ? "font-mono" : ""}`}
      />
    </Field>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0b1633]/50 p-4 backdrop-blur-sm sm:p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ne-title"
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-[0_24px_60px_-20px_rgba(16,26,58,0.45)]"
      >
        <div className="relative flex items-center gap-3 border-b border-[#eef0f4] px-5 py-4">
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#f7941e] via-[#f96706] to-[#1f4693]" />
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e] to-[#f96706] text-white shadow-[0_6px_14px_-6px_rgba(249,103,6,0.6)]">
            {created ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <UserPlus className="h-5 w-5" aria-hidden="true" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="ne-title" className="text-base font-bold text-[#101a3a]">
              {created ? "Employee added" : "Add employee"}
            </h2>
            <p className="text-xs text-[#676b7a]">
              {created ? "Their Employee Portal account is ready." : "Creates their sign-in account and Employee Portal record."}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className={ICON_BTN}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {created ? (
          <div className="flex flex-col gap-4 p-5">
            <Alert kind="ok">
              {created.employee.full_name} ({created.employee.employee_code}) can now sign in to the Employee Portal.
            </Alert>
            {created.employee.welcome === "sending" ? (
              <Alert kind="info">
                The sign-in email and a one-time password were emailed to <b>{created.employee.work_email}</b> (from info@zyllotech.com).
                The password is not shown here. If that mailbox does not exist you will get a notification “Mailbox does not exist”.
              </Alert>
            ) : created.employee.linked_existing_account ? (
              <Alert kind="info">
                This sign-in ID already had an account, so it was linked. Their existing password was <b>not</b> changed.
              </Alert>
            ) : (
              <div className="rounded-xl bg-[#f8fafd] p-4 text-sm ring-1 ring-inset ring-[#eef1f7]">
                <p className="mb-3 flex items-center gap-2 font-semibold text-[#101a3a]">
                  <KeyRound size={16} className="shrink-0 text-[#d9650a]" aria-hidden="true" /> Email is not set up yet — share these sign-in details with the employee
                </p>
                <dl className="grid gap-x-4 gap-y-2.5 sm:grid-cols-[9rem_1fr]">
                  <dt className={DT}>Sign-in page</dt>
                  <dd className="break-all font-mono text-[#101a3a]">{window.location.origin}/login</dd>
                  <dt className={DT}>Sign-in ID</dt>
                  <dd className="flex flex-wrap items-center gap-2 break-all font-mono text-[#101a3a]">
                    {created.employee.work_email} <CopyButton text={created.employee.work_email} label="Copy" />
                  </dd>
                  <dt className={DT}>Temporary password</dt>
                  <dd className="flex flex-wrap items-center gap-2 break-all font-mono text-[#101a3a]">
                    {created.password} <CopyButton text={created.password} label="Copy" />
                  </dd>
                </dl>
                <Alert kind="warn" className="mt-4 text-xs">
                  The password is shown only now — it is stored encrypted and cannot be seen again. The employee must change it at their first sign-in.
                </Alert>
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t border-[#eef0f4] pt-4">
              <Link href={`/admin/employees/${created.employee.id}`} className={BTN_PRIMARY}>
                Open employee
              </Link>
              <button type="button" onClick={onClose} className={BTN_SECONDARY}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="p-5">
            {message && (
              <Alert kind="err" className="mb-4">
                {message}
              </Alert>
            )}
            <p className={SECTION}>
              <span className={SECTION_ICON}>
                <KeyRound size={13} aria-hidden="true" />
              </span>
              Sign-in account
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {input("employee_code", "Employee ID", { placeholder: "e.g. ZT-001", mono: true, upper: true, hint: "Letters, numbers and dashes." })}
              {input("full_name", "Full name", { placeholder: "e.g. Ravi Kumar" })}
              {input("email", "Sign-in email (the employee's own real email)", { type: "email", placeholder: "name@gmail.com", hint: "Must be the employee's real, existing email address. They sign in with it." })}
              <Field id="ne-password" label="Temporary password" error={errors.password} hint="At least 6 characters with 1 uppercase, 1 number and 1 special character. They must change it at their first sign-in.">
                <div className="flex gap-2">
                  <input
                    id="ne-password"
                    type="text"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                    aria-invalid={errors.password ? "true" : undefined}
                    className={`${INPUT(errors.password)} font-mono`}
                  />
                  <button type="button" onClick={() => set("password", generatePassword())} className={`${BTN_SECONDARY} shrink-0 px-3`} aria-label="Generate a new password" title="Generate a new password">
                    <RefreshCw size={14} aria-hidden="true" />
                  </button>
                </div>
              </Field>
            </div>

            <p className={`${SECTION} mt-6 border-t border-[#eef0f4] pt-5`}>
              <span className={SECTION_ICON}>
                <Briefcase size={13} aria-hidden="true" />
              </span>
              Work details <span className="font-medium normal-case tracking-normal text-[#9aa0ad]">(can be changed later)</span>
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {input("department", "Department", { placeholder: "e.g. Engineering" })}
              {input("designation", "Designation", { placeholder: "e.g. Software Developer" })}
              {input("date_of_joining", "Date of joining", { type: "date" })}
              {input("work_location", "Work location", { placeholder: "e.g. Guntur office" })}
              <EmploymentTypeChoice id="ne-type" value={form.employment_type} onChange={(v) => set("employment_type", v)} />
              <ManagerPicker
                employeeId={null}
                value={form.reporting_manager_id}
                onChange={(v) => set("reporting_manager_id", v)}
                name={form.reporting_manager_name}
                onNameChange={(v) => set("reporting_manager_name", v)}
              />
            </div>

            <div className="mt-6 flex flex-wrap gap-2 border-t border-[#eef0f4] pt-4">
              <button type="submit" disabled={saving} className={BTN_PRIMARY}>
                {saving ? "Adding…" : "Add employee"}
              </button>
              <button type="button" disabled={saving} onClick={onClose} className={BTN_SECONDARY}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
