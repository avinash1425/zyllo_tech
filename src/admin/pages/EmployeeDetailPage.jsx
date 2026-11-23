import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import { ArrowLeft, Briefcase, HeartPulse, KeyRound, Pencil, Phone, UserRound, Users } from "lucide-react";
import { getEmployee, setEmployeeAccess, updateEmployeeWork, validateWork, WORK_FIELDS } from "@/lib/api/admin/employees";
import { EMPLOYMENT_TYPES, GENDERS, MARITAL_STATUSES } from "@/lib/api/employee/profile";
import { formatDate, formatDateTime } from "@/employee/attendanceFormat";
import {
  AccessBadge,
  Avatar,
  Banner,
  EmploymentTypeChoice,
  Field,
  ManagerPicker,
} from "../employees/ui";
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT } from "../employees/styles";

const labelOf = (list, value) => list.find((o) => o.value === value)?.label;
const show = (v) => (v == null || v === "" ? <span className="text-[#b0b8cc]">Not added</span> : v);

function CardHeader({ icon: Icon, title, note, action }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Icon className="h-5 w-5 text-[#1f4693]" aria-hidden="true" />
      <h2 className="text-base font-bold text-[#101a3a]">{title}</h2>
      {note && <span className="rounded-full bg-[#f0f4ff] px-2 py-0.5 text-[11px] font-semibold text-[#4a5880]">{note}</span>}
      <span className="flex-1" />
      {action}
    </div>
  );
}

function Item({ label, children, wide }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line break-words text-sm font-medium text-[#101a3a]">{children}</dd>
    </div>
  );
}

function WorkCard({ emp, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState({ kind: "", text: "" });
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setForm({
      ...Object.fromEntries(WORK_FIELDS.map((k) => [k, emp[k] ?? ""])),
      reporting_manager_id: emp.manager?.id ?? "",
    });
    setErrors({});
    setMessage({ kind: "", text: "" });
    setEditing(true);
  }
  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    const errs = validateWork(form);
    if (Object.keys(errs).length) {
      setErrors(errs);
      setMessage({ kind: "err", text: "Please fix the highlighted fields." });
      return;
    }
    setSaving(true);
    const result = await updateEmployeeWork(emp.id, form);
    setSaving(false);
    if (!result.ok) return setMessage({ kind: "err", text: result.message });
    onSaved(result.employee);
    setEditing(false);
    setMessage({ kind: "ok", text: "Work details saved. The employee sees them in My Profile." });
  }

  const input = (k, label, props = {}) => (
    <Field id={`wk-${k}`} label={label} error={errors[k]} wide={props.wide}>
      <input
        id={`wk-${k}`}
        type={props.type ?? "text"}
        placeholder={props.placeholder}
        value={form[k] ?? ""}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={errors[k] ? "true" : undefined}
        aria-describedby={errors[k] ? `wk-${k}-error` : undefined}
        className={INPUT(errors[k])}
      />
    </Field>
  );

  if (editing) {
    return (
      <section className={CARD}>
        <CardHeader icon={Briefcase} title="Work details" note="Shown read-only in the employee's My Profile" />
        <Banner kind={message.kind}>{message.text}</Banner>
        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Item label="Employee ID">
            <span className="font-mono">{emp.employee_code}</span>
          </Item>
          {input("full_name", "Full name")}
          {input("department", "Department", { placeholder: "e.g. Engineering" })}
          {input("designation", "Designation", { placeholder: "e.g. Software Developer" })}
          {input("date_of_joining", "Date of joining", { type: "date" })}
          {input("work_location", "Work location", { placeholder: "e.g. Guntur office" })}
          <EmploymentTypeChoice id="wk-type" value={form.employment_type} onChange={(v) => set("employment_type", v)} />
          <ManagerPicker employeeId={emp.id} value={form.reporting_manager_id} onChange={(v) => set("reporting_manager_id", v)} />
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" disabled={saving} className={BTN_PRIMARY}>
              {saving ? "Saving…" : "Save work details"}
            </button>
            <button type="button" disabled={saving} onClick={() => setEditing(false)} className={BTN_SECONDARY}>
              Cancel
            </button>
          </div>
        </form>
      </section>
    );
  }

  const m = emp.manager;
  return (
    <section className={CARD}>
      <CardHeader
        icon={Briefcase}
        title="Work details"
        note="Shown read-only in the employee's My Profile"
        action={
          <button type="button" onClick={startEdit} className={BTN_SECONDARY}>
            <Pencil size={14} aria-hidden="true" /> Edit
          </button>
        }
      />
      <Banner kind={message.kind}>{message.text}</Banner>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Item label="Employee ID">
          <span className="font-mono">{emp.employee_code}</span>
        </Item>
        <Item label="Full name">{emp.full_name}</Item>
        <Item label="Department">{show(emp.department)}</Item>
        <Item label="Designation">{show(emp.designation)}</Item>
        <Item label="Reporting manager">
          {m ? (
            <Link href={`/admin/employees/${m.id}`} className="hover:text-[#1f4693] hover:underline">
              {m.full_name}
              <span className="block text-xs font-normal text-[#676b7a]">
                {[m.designation, m.employee_code].filter(Boolean).join(" · ")}
                {!m.is_active && " · access off"}
              </span>
            </Link>
          ) : (
            show(null)
          )}
        </Item>
        <Item label="Date of joining">{show(emp.date_of_joining && formatDate(emp.date_of_joining))}</Item>
        <Item label="Employment type">{show(EMPLOYMENT_TYPES[emp.employment_type])}</Item>
        <Item label="Work location">{show(emp.work_location)}</Item>
        <Item label="Work email">{show(emp.work_email)}</Item>
        <Item label="Account status">
          <AccessBadge active={emp.is_active} />
        </Item>
      </dl>
    </section>
  );
}

function AccessCard({ emp, onSaved }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ kind: "", text: "" });

  async function change(active) {
    setBusy(true);
    const result = await setEmployeeAccess(emp.id, active);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) return setMessage({ kind: "err", text: result.message });
    onSaved(result.employee);
    setMessage({
      kind: "ok",
      text: active ? "Portal access turned on. They can sign in again." : "Portal access turned off.",
    });
  }

  return (
    <section className={CARD}>
      <CardHeader icon={KeyRound} title="Portal access" />
      <Banner kind={message.kind}>{message.text}</Banner>
      <dl className="grid gap-4 sm:grid-cols-3">
        <Item label="Status">
          <AccessBadge active={emp.is_active} />
        </Item>
        <Item label="Last sign-in">{show(emp.last_sign_in_at && formatDateTime(emp.last_sign_in_at))}</Item>
        <Item label="Right now">
          {emp.is_active && emp.punched_in ? "Punched in" : <span className="text-[#676b7a]">Not punched in</span>}
        </Item>
      </dl>
      <div className="mt-4 border-t border-[#f0f2f6] pt-4">
        {emp.is_active ? (
          confirming ? (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
              <p className="font-semibold">Turn off portal access for {emp.full_name}?</p>
              <p className="mt-1 text-xs">
                They will not be able to use the Employee Portal (punch in, reports, leave, notifications).
                {emp.punched_in && " Their current punch-in session will be closed now."}
                {emp.reports_count > 0 &&
                  ` ${emp.reports_count} ${emp.reports_count === 1 ? "person reports" : "people report"} to them — consider assigning a new manager.`}{" "}
                Their data is kept, and you can turn access back on any time.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => change(false)} className={BTN_DANGER}>
                  {busy ? "Turning off…" : "Yes, turn off access"}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={BTN_SECONDARY}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className={`${BTN_SECONDARY} text-red-700`}>
              Turn off portal access
            </button>
          )
        ) : (
          <button type="button" disabled={busy} onClick={() => change(true)} className={BTN_PRIMARY}>
            {busy ? "Turning on…" : "Turn on portal access"}
          </button>
        )}
      </div>
    </section>
  );
}

function TeamCard({ reports }) {
  if (!reports?.length) return null;
  return (
    <section className={CARD}>
      <CardHeader icon={Users} title="Reports to this employee" note={String(reports.length)} />
      <ul className="flex flex-col divide-y divide-[#f0f2f6]">
        {reports.map((r) => (
          <li key={r.id}>
            <Link href={`/admin/employees/${r.id}`} className="flex items-center gap-3 py-2 hover:text-[#1f4693]">
              <Avatar name={r.full_name} size="h-8 w-8 text-xs" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{r.full_name}</span>
                <span className="block text-xs text-[#676b7a]">{[r.designation, r.employee_code].filter(Boolean).join(" · ")}</span>
              </span>
              {!r.is_active && <AccessBadge active={false} />}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PersonalCards({ emp }) {
  const p = emp.personal ?? {};
  const contacts = emp.emergency_contacts ?? [];
  return (
    <>
      <section className={CARD}>
        <CardHeader icon={UserRound} title="Personal details" note="Filled in by the employee" />
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Item label="Date of birth">{show(p.date_of_birth && formatDate(p.date_of_birth))}</Item>
          <Item label="Gender">{show(labelOf(GENDERS, p.gender))}</Item>
          <Item label="Blood group">{show(p.blood_group)}</Item>
          <Item label="Marital status">{show(labelOf(MARITAL_STATUSES, p.marital_status))}</Item>
          <Item label="Nationality">{show(p.nationality)}</Item>
        </dl>
      </section>
      <section className={CARD}>
        <CardHeader icon={Phone} title="Contact information" note="Filled in by the employee" />
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Item label="Mobile number">{show(p.phone)}</Item>
          <Item label="Alternate number">{show(p.alternate_phone)}</Item>
          <Item label="Personal email">{show(p.personal_email)}</Item>
          <Item label="Current address" wide>
            {show(p.current_address)}
          </Item>
          <Item label="Permanent address">{show(p.permanent_address)}</Item>
        </dl>
      </section>
      <section className={CARD}>
        <CardHeader icon={HeartPulse} title="Emergency contacts" note="Filled in by the employee" />
        {contacts.length === 0 ? (
          <p className="text-sm text-[#b0b8cc]">Not added</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {contacts.map((c, i) => (
              <li key={i} className="rounded-xl border border-[#eef0f5] p-3">
                <p className="text-sm font-semibold text-[#101a3a]">
                  {c.name}
                  {i === 0 && (
                    <span className="ml-2 rounded-full bg-[#fff4e6] px-2 py-0.5 text-[10px] font-semibold text-[#d9650a]">Primary</span>
                  )}
                </p>
                <p className="text-xs text-[#676b7a]">{c.relationship}</p>
                <p className="mt-1 text-sm tabular-nums text-[#2b303b]">{c.phone}</p>
                {c.alternate_phone && <p className="text-xs tabular-nums text-[#676b7a]">{c.alternate_phone}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * Admin: one employee — work details (editable here, read-only for the
 * employee), reporting manager, portal access, team, and the personal
 * details the employee filled in (read-only for the admin). Migration 239.
 */
export default function EmployeeDetailPage() {
  const { employeeId } = useParams();
  const [emp, setEmp] = useState(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getEmployee(employeeId)
      .then((d) => {
        if (!active) return;
        setEmp(d);
        setError("");
      })
      .catch((e) => {
        if (!active) return;
        setEmp(null);
        setError(/not found|invalid input syntax/i.test(e?.message ?? "") ? "Employee not found." : "Could not load this employee. Please refresh the page.");
      });
    return () => {
      active = false;
    };
  }, [employeeId]);

  const back = (
    <Link href="/admin/employees" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] hover:underline">
      <ArrowLeft size={16} aria-hidden="true" /> All employees
    </Link>
  );

  if (emp === undefined) return <p className="text-sm text-[#676b7a]">Loading…</p>;
  if (!emp) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {back}
      <section className={`${CARD} flex flex-col gap-4 sm:flex-row sm:items-center`}>
        <Avatar name={emp.full_name} size="h-16 w-16 text-2xl" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-[#101a3a]">{emp.full_name}</h1>
          <p className="text-sm text-[#676b7a]">
            {[emp.designation, emp.department].filter(Boolean).join(" · ") || "Designation not set"}
          </p>
          <p className="mt-0.5 font-mono text-xs text-[#9aa0ad]">{emp.employee_code}</p>
        </div>
        <AccessBadge active={emp.is_active} />
      </section>
      <WorkCard key={`w-${emp.id}`} emp={emp} onSaved={setEmp} />
      <AccessCard key={`a-${emp.id}`} emp={emp} onSaved={setEmp} />
      <TeamCard reports={emp.direct_reports} />
      <PersonalCards emp={emp} />
    </div>
  );
}
