import { useEffect, useState } from "react";
import Link from "@/lib/nx/link";
import { Check, Copy, RefreshCw, UserPlus, X } from "lucide-react";
import { createEmployee, generatePassword, suggestEmployeeCode, validateNewEmployee } from "@/lib/api/admin/employees";
import { Banner, EmploymentTypeChoice, Field, ManagerPicker } from "./ui";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT } from "./styles";

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
      className="inline-flex items-center gap-1 text-xs font-semibold text-[#1f4693] hover:underline"
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
      <div role="dialog" aria-modal="true" aria-labelledby="ne-title" className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[#eef0f5] px-5 py-4">
          <UserPlus className="h-5 w-5 text-[#1f4693]" aria-hidden="true" />
          <h2 id="ne-title" className="flex-1 text-base font-bold text-[#101a3a]">
            {created ? "Employee added" : "Add employee"}
          </h2>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="rounded-lg p-1.5 text-[#676b7a] hover:bg-[#f6f7fb]">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {created ? (
          <div className="flex flex-col gap-4 p-5">
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
              {created.employee.full_name} ({created.employee.employee_code}) can now sign in to the Employee Portal.
            </p>
            {created.employee.linked_existing_account ? (
              <p className="text-sm text-[#2b303b]">
                This email already had a sign-in account, so it was linked. Their existing password was <b>not</b> changed.
              </p>
            ) : (
              <div className="rounded-xl border border-[#eef0f5] bg-[#f9fafc] p-4 text-sm">
                <p className="mb-3 font-semibold text-[#101a3a]">Share these sign-in details with the employee</p>
                <dl className="grid gap-2 sm:grid-cols-[8rem_1fr]">
                  <dt className="text-[#676b7a]">Sign-in page</dt>
                  <dd className="font-mono">{window.location.origin}/login</dd>
                  <dt className="text-[#676b7a]">Email</dt>
                  <dd className="flex flex-wrap items-center gap-2 font-mono">
                    {created.employee.work_email} <CopyButton text={created.employee.work_email} label="Copy" />
                  </dd>
                  <dt className="text-[#676b7a]">Temporary password</dt>
                  <dd className="flex flex-wrap items-center gap-2 font-mono">
                    {created.password} <CopyButton text={created.password} label="Copy" />
                  </dd>
                </dl>
                <p className="mt-3 text-xs text-[#9aa0ad]">
                  The password is shown only now — it is stored encrypted and cannot be seen again.
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
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
            <Banner kind="err">{message}</Banner>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">Sign-in account</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {input("employee_code", "Employee ID", { placeholder: "e.g. ZT-001", mono: true, upper: true, hint: "Letters, numbers and dashes." })}
              {input("full_name", "Full name", { placeholder: "e.g. Ravi Kumar" })}
              {input("email", "Work email", { type: "email", placeholder: "name@zyllotech.com", hint: "They sign in with this email." })}
              <Field id="ne-password" label="Temporary password" error={errors.password} hint="At least 8 characters. Share it with the employee.">
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
                  <button type="button" onClick={() => set("password", generatePassword())} className={BTN_SECONDARY} aria-label="Generate a new password" title="Generate a new password">
                    <RefreshCw size={14} aria-hidden="true" />
                  </button>
                </div>
              </Field>
            </div>

            <p className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">
              Work details <span className="normal-case tracking-normal">(can be changed later)</span>
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {input("department", "Department", { placeholder: "e.g. Engineering" })}
              {input("designation", "Designation", { placeholder: "e.g. Software Developer" })}
              {input("date_of_joining", "Date of joining", { type: "date" })}
              {input("work_location", "Work location", { placeholder: "e.g. Guntur office" })}
              <EmploymentTypeChoice id="ne-type" value={form.employment_type} onChange={(v) => set("employment_type", v)} />
              <ManagerPicker employeeId={null} value={form.reporting_manager_id} onChange={(v) => set("reporting_manager_id", v)} />
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
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
