import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import {
  ArrowLeft,
  Briefcase,
  CalendarDays,
  ChevronRight,
  HeartPulse,
  KeyRound,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ShieldAlert,
  UserRound,
  Users,
} from "lucide-react";
import { getEmployee, setEmployeeAccess, updateEmployeeWork, validateWork, WORK_FIELDS } from "@/lib/api/admin/employees";
import { EMPLOYMENT_TYPES, GENDERS, MARITAL_STATUSES } from "@/lib/api/employee/profile";
import { formatDate, formatDateTime } from "@/employee/attendanceFormat";
import { AccessBadge, EmploymentTypeChoice, Field, ManagerPicker } from "../employees/ui";
import { Alert, Avatar, Badge, Detail, Empty, Panel } from "@/components/portal/PortalUI";
import { BTN_DANGER, BTN_DANGER_SOFT, BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT } from "@/components/portal/portalStyles";
import CertificateCard from "../employees/CertificateCard";

const labelOf = (list, value) => list.find((o) => o.value === value)?.label;
/** Empty values -> undefined, so <Detail> shows "Not added". */
const val = (v) => (v == null || v === "" || v === false ? undefined : v);
const DL = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";
const BY_EMPLOYEE = "Filled in by the employee";

function Msg({ message }) {
  if (!message.text) return null;
  return (
    <Alert kind={message.kind === "ok" ? "ok" : "err"} className="mb-4">
      {message.text}
    </Alert>
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
      reporting_manager_name: emp.manager_name ?? "",
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
      <Panel icon={Briefcase} title="Work details" subtitle="Editing — shown read-only in the employee's My Profile" className="ring-2 ring-[#1f4693]/10">
        <Msg message={message} />
        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <dl>
            <Detail label="Employee ID">
              <span className="font-mono">{emp.employee_code}</span>
            </Detail>
          </dl>
          {input("full_name", "Full name")}
          {input("department", "Department", { placeholder: "e.g. Engineering" })}
          {input("designation", "Designation", { placeholder: "e.g. Software Developer" })}
          {input("date_of_joining", "Date of joining", { type: "date" })}
          {input("work_location", "Work location", { placeholder: "e.g. Guntur office" })}
          <EmploymentTypeChoice id="wk-type" value={form.employment_type} onChange={(v) => set("employment_type", v)} />
          <ManagerPicker
            employeeId={emp.id}
            value={form.reporting_manager_id}
            onChange={(v) => set("reporting_manager_id", v)}
            name={form.reporting_manager_name ?? ""}
            onNameChange={(v) => set("reporting_manager_name", v)}
          />
          <div className="flex flex-wrap gap-2 border-t border-[#eef0f4] pt-4 sm:col-span-2">
            <button type="submit" disabled={saving} className={BTN_PRIMARY}>
              {saving ? "Saving…" : "Save work details"}
            </button>
            <button type="button" disabled={saving} onClick={() => setEditing(false)} className={BTN_SECONDARY}>
              Cancel
            </button>
          </div>
        </form>
      </Panel>
    );
  }

  const m = emp.manager;
  return (
    <Panel
      icon={Briefcase}
      title="Work details"
      subtitle="Shown read-only in the employee's My Profile"
      action={
        <button type="button" onClick={startEdit} className={BTN_SECONDARY}>
          <Pencil size={14} aria-hidden="true" /> Edit
        </button>
      }
    >
      <Msg message={message} />
      <dl className={DL}>
        <Detail label="Employee ID">
          <span className="font-mono">{emp.employee_code}</span>
        </Detail>
        <Detail label="Full name">{emp.full_name}</Detail>
        <Detail label="Department">{val(emp.department)}</Detail>
        <Detail label="Designation">{val(emp.designation)}</Detail>
        <Detail label="Reporting manager">
          {m ? (
            <Link href={`/admin/employees/${m.id}`} className="hover:text-[#1f4693] hover:underline">
              {m.full_name}
              <span className="block text-xs font-normal text-[#676b7a]">
                {[m.designation, m.employee_code].filter(Boolean).join(" · ")}
                {!m.is_active && " · access off"}
              </span>
            </Link>
          ) : emp.manager_name ? (
            <>
              {emp.manager_name}
              <span className="block text-xs font-normal text-amber-700">Not in the portal</span>
            </>
          ) : undefined}
        </Detail>
        <Detail label="Date of joining">{val(emp.date_of_joining && formatDate(emp.date_of_joining))}</Detail>
        <Detail label="Employment type">{val(EMPLOYMENT_TYPES[emp.employment_type])}</Detail>
        <Detail label="Work location">{val(emp.work_location)}</Detail>
        <Detail label="Account status">
          <AccessBadge active={emp.is_active} />
        </Detail>
      </dl>
    </Panel>
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
    <Panel icon={KeyRound} title="Portal access" subtitle="Sign-in to the Employee Portal" action={<AccessBadge active={emp.is_active} />}>
      <Msg message={message} />
      <dl className="grid gap-3 sm:grid-cols-3">
        <Detail label="Status">
          <AccessBadge active={emp.is_active} />
        </Detail>
        <Detail label="Last sign-in">{val(emp.last_sign_in_at && formatDateTime(emp.last_sign_in_at))}</Detail>
        <Detail label="Right now">
          {emp.is_active && emp.punched_in ? (
            <Badge tone="blue" dot>
              Punched in
            </Badge>
          ) : (
            <span className="font-normal text-[#676b7a]">Not punched in</span>
          )}
        </Detail>
      </dl>
      <div className="mt-5 border-t border-[#eef0f4] pt-4">
        {emp.is_active ? (
          confirming ? (
            <div role="alertdialog" aria-labelledby="access-off-title" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p id="access-off-title" className="flex items-center gap-2 font-semibold">
                <ShieldAlert size={16} aria-hidden="true" /> Turn off portal access for {emp.full_name}?
              </p>
              <p className="mt-1 text-xs leading-relaxed">
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
            <button type="button" onClick={() => setConfirming(true)} className={BTN_DANGER_SOFT}>
              Turn off portal access
            </button>
          )
        ) : (
          <button type="button" disabled={busy} onClick={() => change(true)} className={BTN_PRIMARY}>
            {busy ? "Turning on…" : "Turn on portal access"}
          </button>
        )}
      </div>
    </Panel>
  );
}

function TeamCard({ reports }) {
  if (!reports?.length) return null;
  return (
    <Panel icon={Users} title="Reports to this employee" action={<Badge tone="blue">{reports.length}</Badge>}>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => (
          <li key={r.id}>
            <Link
              href={`/admin/employees/${r.id}`}
              className="group flex items-center gap-3 rounded-xl border border-[#eef1f7] bg-[#fbfcfe] p-3 transition-colors hover:border-[#1f4693]/25 hover:bg-[#f4f7ff]"
            >
              <Avatar name={r.full_name} size="h-9 w-9 text-xs" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[#101a3a] group-hover:text-[#1f4693]">{r.full_name}</span>
                <span className="block truncate text-xs text-[#676b7a]">{[r.designation, r.employee_code].filter(Boolean).join(" · ")}</span>
              </span>
              {!r.is_active && <AccessBadge active={false} />}
              <ChevronRight size={15} className="shrink-0 text-[#c4cad6] group-hover:text-[#1f4693]" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PersonalCards({ emp }) {
  const p = emp.personal ?? {};
  const contacts = emp.emergency_contacts ?? [];
  return (
    <>
      <Panel icon={UserRound} title="Personal details" subtitle={BY_EMPLOYEE}>
        <dl className={DL}>
          <Detail label="Date of birth">{val(p.date_of_birth && formatDate(p.date_of_birth))}</Detail>
          <Detail label="Gender">{val(labelOf(GENDERS, p.gender))}</Detail>
          <Detail label="Blood group">{val(p.blood_group)}</Detail>
          <Detail label="Marital status">{val(labelOf(MARITAL_STATUSES, p.marital_status))}</Detail>
          <Detail label="Nationality">{val(p.nationality)}</Detail>
        </dl>
      </Panel>
      <Panel icon={Phone} title="Contact information" subtitle={BY_EMPLOYEE}>
        <dl className={DL}>
          <Detail label="Mobile number">{val(p.phone)}</Detail>
          <Detail label="Alternate number">{val(p.alternate_phone)}</Detail>
          <Detail label="Current address" wide>
            {val(p.current_address)}
          </Detail>
          <Detail label="Permanent address">{val(p.permanent_address)}</Detail>
        </dl>
      </Panel>
      <Panel icon={HeartPulse} title="Emergency contacts" subtitle={BY_EMPLOYEE}>
        {contacts.length === 0 ? (
          <Empty icon={HeartPulse} title="Not added" message="The employee has not added emergency contacts yet." className="py-6" />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {contacts.map((c, i) => (
              <li
                key={i}
                className={`rounded-xl p-4 ring-1 ring-inset ${i === 0 ? "bg-[#fffaf3] ring-[#f7941e]/25" : "bg-[#f8fafd] ring-[#eef1f7]"}`}
              >
                <div className="flex items-start gap-3">
                  <Avatar name={c.name} size="h-9 w-9 text-xs" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#101a3a]">
                      <span className="break-words">{c.name}</span>
                      {i === 0 && <Badge tone="orange">Primary</Badge>}
                    </p>
                    <p className="text-xs text-[#676b7a]">{c.relationship}</p>
                    <p className="mt-2 flex items-center gap-1.5 text-sm tabular-nums text-[#2b303b]">
                      <Phone size={13} className="text-[#9aa0ad]" aria-hidden="true" />
                      {c.phone}
                    </p>
                    {c.alternate_phone && <p className="ml-[19px] text-xs tabular-nums text-[#676b7a]">{c.alternate_phone}</p>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function Fact({ icon: Icon, label, children }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#eef2fb] text-[#1f4693]">
        <Icon size={15} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-[#9aa0ad]">{label}</span>
        <span className="block truncate text-[13px] font-semibold text-[#101a3a]">{children ?? <span className="font-normal text-[#b0b8cc]">Not added</span>}</span>
      </span>
    </div>
  );
}

function ProfileHeader({ emp }) {
  return (
    <section className={`${CARD} overflow-hidden`}>
      <div aria-hidden="true" className="relative h-20 bg-gradient-to-br from-[#101a3a] via-[#173a52] to-[#3089a6] sm:h-24">
        <div className="absolute -right-6 -top-12 h-40 w-40 rounded-full bg-[#f7941e]/40 blur-[60px]" />
      </div>
      <div className="px-5 pb-5">
        <div className="relative z-10 -mt-10 flex flex-col gap-3 sm:-mt-12 sm:flex-row sm:items-end">
          <span className="rounded-full bg-white p-1 shadow-[0_6px_16px_-6px_rgba(16,26,58,0.35)] self-start">
            <Avatar name={emp.full_name} size="h-20 w-20 text-2xl sm:h-24 sm:w-24 sm:text-3xl" />
          </span>
          <div className="min-w-0 flex-1 sm:pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-words text-xl font-bold tracking-tight text-[#101a3a] sm:text-2xl">{emp.full_name}</h1>
              <AccessBadge active={emp.is_active} />
              {emp.is_active && emp.punched_in && <Badge tone="blue">Punched in now</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-[#676b7a]">
              {[emp.designation, emp.department].filter(Boolean).join(" · ") || "Designation not set"}
            </p>
          </div>
          <span className="self-start rounded-lg bg-[#f6f7fb] px-2.5 py-1 font-mono text-xs font-semibold text-[#4a5068] ring-1 ring-inset ring-[#e7e9ee] sm:self-end sm:mb-1">
            {emp.employee_code}
          </span>
        </div>
        <div className="mt-5 grid gap-3 border-t border-[#eef0f4] pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact icon={Briefcase} label="Employment type">
            {val(EMPLOYMENT_TYPES[emp.employment_type])}
          </Fact>
          <Fact icon={CalendarDays} label="Joined">
            {val(emp.date_of_joining && formatDate(emp.date_of_joining))}
          </Fact>
          <Fact icon={Users} label="Reports to">
            {emp.manager?.full_name ?? emp.manager_name}
          </Fact>
          <Fact icon={MapPin} label="Work location">
            {val(emp.work_location)}
          </Fact>
        </div>
      </div>
    </section>
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
    <Link href="/admin/employees" className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-[#1f4693] hover:underline">
      <ArrowLeft size={16} aria-hidden="true" /> All employees
    </Link>
  );

  if (emp === undefined)
    return (
      <p role="status" className="text-sm text-[#676b7a]">
        Loading…
      </p>
    );
  if (!emp) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Alert kind="err">{error}</Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {back}
      <ProfileHeader emp={emp} />
      {/* Order: personal, contact, emergency contacts, work details, certificate, team, portal access. */}
      <PersonalCards emp={emp} />
      <WorkCard key={`w-${emp.id}`} emp={emp} onSaved={setEmp} />
      <CertificateCard emp={emp} />
      <TeamCard reports={emp.direct_reports} />
      <AccessCard key={`a-${emp.id}`} emp={emp} onSaved={setEmp} />
    </div>
  );
}
