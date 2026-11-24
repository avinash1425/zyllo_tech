import { useEffect, useState } from "react";
import { Briefcase, HeartPulse, Pencil, Phone, Plus, Star, Trash2, UserRound } from "lucide-react";
import {
  BLOOD_GROUPS,
  EMPLOYMENT_TYPES,
  GENDERS,
  MARITAL_STATUSES,
  PERSONAL_FIELDS,
  getMyProfile,
  saveMyEmergencyContacts,
  updateMyPersonal,
  validateContacts,
  validatePersonal,
} from "@/lib/api/employee/profile";
import { Alert, Avatar, Badge, Chips, Detail, Hero, Panel } from "@/components/portal/PortalUI";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL } from "@/components/portal/portalStyles";
import { formatDate } from "../attendanceFormat";
import MyCertificateCard from "../MyCertificateCard";
import MyDocumentsCard from "../MyDocumentsCard";
import ChangePasswordCard from "@/components/portal/ChangePasswordCard";

const EMPTY_CONTACT = { name: "", relationship: "", phone: "", alternate_phone: "" };
const labelOf = (list, value) => list.find((o) => o.value === value)?.label;
const show = (v) => (v == null || v === "" ? <span className="font-normal text-[#b0b8cc]">Not added</span> : v);
/** Responsive grid for <Detail> tiles. */
const DL = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";

function EditButton({ onClick, children = "Edit" }) {
  return (
    <button type="button" onClick={onClick} className={BTN_SECONDARY}>
      <Pencil size={14} aria-hidden="true" /> {children}
    </button>
  );
}

function Field({ id, label, error, children, wide }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/** Chip group instead of a dropdown (project rule: no <select>). Click again to clear. */
function Choice({ label, options, value, onChange, wide }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <p className={LABEL} aria-hidden="true">
        {label}
      </p>
      <Chips
        label={label}
        size="md"
        value={value}
        onChange={(k) => onChange(value === k ? "" : k)}
        items={options.map((o) => ({ key: o.value, label: o.label }))}
      />
    </div>
  );
}

function completeness(profile) {
  const p = profile.personal ?? {};
  // Emails are hidden for now (no email features yet), so they do not count here.
  const keys = ["date_of_birth", "gender", "blood_group", "marital_status", "nationality", "phone", "current_address", "permanent_address"];
  const filled = keys.filter((k) => p[k]).length + (profile.emergency_contacts?.length ? 1 : 0);
  return Math.round((filled / (keys.length + 1)) * 100);
}

function ProfileHeader({ profile }) {
  const w = profile.work;
  const pct = completeness(profile);
  return (
    <Hero
      eyebrow={w.employee_code}
      title={
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={w.full_name || "E"} size="h-12 w-12 text-lg sm:h-14 sm:w-14 sm:text-xl" ring />
          <span className="min-w-0 truncate">{w.full_name}</span>
        </span>
      }
      subtitle={[w.designation, w.department].filter(Boolean).join(" · ") || "Designation not set"}
      aside={
        <div className="w-full rounded-xl bg-white/10 px-4 py-3 ring-1 ring-inset ring-white/15 lg:w-64">
          <div className="flex justify-between text-xs font-semibold text-white/85">
            <span>Profile complete</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-white/15"
            role="progressbar"
            aria-label="Profile complete"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-gradient-to-r from-[#f7941e] to-[#ffd29a]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      }
    />
  );
}

function WorkCard({ work }) {
  const m = work.manager;
  return (
    <Panel icon={Briefcase} title="Work details" subtitle="Set by the company" action={<Badge tone="slate">Read only</Badge>}>
      <dl className={DL}>
        <Detail label="Employee ID">
          <span className="font-mono">{work.employee_code}</span>
        </Detail>
        <Detail label="Department">{show(work.department)}</Detail>
        <Detail label="Designation">{show(work.designation)}</Detail>
        <Detail label="Reporting manager">
          {m ? (
            <>
              {m.full_name}
              <span className="block text-xs font-normal text-[#676b7a]">
                {[m.designation, m.employee_code].filter(Boolean).join(" · ")}
              </span>
            </>
          ) : (
            show(null)
          )}
        </Detail>
        <Detail label="Date of joining">{show(work.date_of_joining && formatDate(work.date_of_joining))}</Detail>
        <Detail label="Employment type">{show(EMPLOYMENT_TYPES[work.employment_type])}</Detail>
        <Detail label="Work location">{show(work.work_location)}</Detail>
      </dl>
    </Panel>
  );
}

function PersonalCard({ profile, onSaved }) {
  const personal = profile.personal ?? {};
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [sameAddress, setSameAddress] = useState(false);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState({ kind: "", text: "" });
  const [saving, setSaving] = useState(false);

  function startEdit() {
    const f = Object.fromEntries(PERSONAL_FIELDS.map((k) => [k, personal[k] ?? ""]));
    setForm(f);
    setSameAddress(Boolean(f.current_address) && f.current_address === f.permanent_address);
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
    const data = sameAddress ? { ...form, permanent_address: form.current_address } : form;
    const errs = validatePersonal(data);
    if (Object.keys(errs).length) {
      setErrors(errs);
      setMessage({ kind: "err", text: "Please fix the highlighted fields." });
      return;
    }
    setSaving(true);
    const result = await updateMyPersonal(data);
    setSaving(false);
    if (!result.ok) return setMessage({ kind: "err", text: result.message });
    onSaved(result.profile);
    setEditing(false);
    setMessage({ kind: "ok", text: "Your details were saved." });
  }

  const input = (k, label, props = {}) => (
    <Field id={`pf-${k}`} label={label} error={errors[k]} wide={props.wide}>
      <input
        id={`pf-${k}`}
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        value={form[k] ?? ""}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={errors[k] ? "true" : undefined}
        aria-describedby={errors[k] ? `pf-${k}-error` : undefined}
        className={INPUT(errors[k])}
      />
    </Field>
  );
  const area = (k, label, disabled) => (
    <Field id={`pf-${k}`} label={label} error={errors[k]} wide>
      <textarea
        id={`pf-${k}`}
        rows={2}
        disabled={disabled}
        value={disabled ? form.current_address ?? "" : form[k] ?? ""}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={errors[k] ? "true" : undefined}
        className={`${INPUT(errors[k])} resize-none disabled:bg-[#f6f7fb] disabled:text-[#676b7a]`}
      />
    </Field>
  );

  if (!editing) {
    return (
      <>
        <Panel icon={UserRound} title="Personal details" action={<EditButton onClick={startEdit} />}>
          <Alert kind={message.kind || "info"} className="mb-4">
            {message.text}
          </Alert>
          <dl className={DL}>
            <Detail label="Full name">{profile.work.full_name}</Detail>
            <Detail label="Date of birth">{show(personal.date_of_birth && formatDate(personal.date_of_birth))}</Detail>
            <Detail label="Gender">{show(labelOf(GENDERS, personal.gender))}</Detail>
            <Detail label="Blood group">{show(personal.blood_group)}</Detail>
            <Detail label="Marital status">{show(labelOf(MARITAL_STATUSES, personal.marital_status))}</Detail>
            <Detail label="Nationality">{show(personal.nationality)}</Detail>
          </dl>
        </Panel>
        <Panel icon={Phone} title="Contact information" action={<EditButton onClick={startEdit} />}>
          <dl className={DL}>
            <Detail label="Mobile number">{show(personal.phone)}</Detail>
            <Detail label="Alternate number">{show(personal.alternate_phone)}</Detail>
            <Detail label="Current address" wide>
              {show(personal.current_address)}
            </Detail>
            <Detail label="Permanent address" wide>
              {show(personal.permanent_address)}
            </Detail>
          </dl>
        </Panel>
      </>
    );
  }

  return (
    <Panel icon={UserRound} title="Edit personal & contact details">
      <Alert kind={message.kind || "info"} className="mb-4">
        {message.text}
      </Alert>
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <p className="text-xs text-[#676b7a] sm:col-span-2">
          Your name, department and designation are set by the company. Ask HR if they need to change.
        </p>
        {input("date_of_birth", "Date of birth", { type: "date" })}
        {input("nationality", "Nationality", { placeholder: "e.g. Indian" })}
        <Choice label="Gender" options={GENDERS} value={form.gender} onChange={(v) => set("gender", v)} wide />
        <Choice label="Blood group" options={BLOOD_GROUPS} value={form.blood_group} onChange={(v) => set("blood_group", v)} wide />
        <Choice label="Marital status" options={MARITAL_STATUSES} value={form.marital_status} onChange={(v) => set("marital_status", v)} wide />

        <div className="flex items-center gap-3 pt-1 sm:col-span-2">
          <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-[#1f4693]">Contact</span>
          <div className="h-px flex-1 bg-[#eef0f4]" />
        </div>
        {input("phone", "Mobile number", { type: "tel", inputMode: "tel", autoComplete: "tel", placeholder: "+91 98765 43210" })}
        {input("alternate_phone", "Alternate number", { type: "tel", inputMode: "tel" })}
        {area("current_address", "Current address")}
        <label className="flex items-center gap-2 text-sm text-[#2b303b] sm:col-span-2">
          <input type="checkbox" checked={sameAddress} onChange={(e) => setSameAddress(e.target.checked)} className="h-4 w-4 accent-[#1f4693]" />
          Permanent address is the same as current address
        </label>
        {area("permanent_address", "Permanent address", sameAddress)}

        <div className="flex flex-wrap justify-end gap-2 border-t border-[#eef0f4] pt-4 sm:col-span-2">
          <button type="button" onClick={() => setEditing(false)} disabled={saving} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving ? "Saving…" : "Save details"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function EmergencyCard({ profile, onSaved }) {
  const contacts = profile.emergency_contacts ?? [];
  const [editing, setEditing] = useState(false);
  const [list, setList] = useState([]);
  const [errors, setErrors] = useState(null);
  const [message, setMessage] = useState({ kind: "", text: "" });
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setList(contacts.length ? contacts.map((c) => ({ ...EMPTY_CONTACT, ...c, alternate_phone: c.alternate_phone ?? "" })) : [{ ...EMPTY_CONTACT }]);
    setErrors(null);
    setMessage({ kind: "", text: "" });
    setEditing(true);
  }
  const set = (i, k, v) => {
    setList((l) => l.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
    if (errors?.[i]?.[k]) setErrors((e) => e.map((x, j) => (j === i ? { ...x, [k]: undefined } : x)));
  };

  async function onSubmit(e) {
    e.preventDefault();
    const errs = validateContacts(list);
    if (errs) {
      setErrors(errs);
      setMessage({ kind: "err", text: "Please fix the highlighted fields." });
      return;
    }
    setSaving(true);
    const result = await saveMyEmergencyContacts(list);
    setSaving(false);
    if (!result.ok) return setMessage({ kind: "err", text: result.message });
    onSaved(result.profile);
    setEditing(false);
    setMessage({ kind: "ok", text: "Emergency contacts saved." });
  }

  const panel = {
    icon: HeartPulse,
    title: "Emergency contacts",
    subtitle: editing ? "1 to 3 people" : undefined,
    action: !editing && <EditButton onClick={startEdit}>{contacts.length ? "Edit" : "Add"}</EditButton>,
  };

  if (!editing) {
    return (
      <Panel {...panel}>
        <Alert kind={message.kind || "info"} className="mb-4">
          {message.text}
        </Alert>
        {contacts.length === 0 ? (
          <Alert kind="warn">No emergency contact yet. Please add at least one person we can call in an emergency.</Alert>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {contacts.map((c, i) => (
              <div key={`${c.name}-${i}`} className="flex min-w-0 gap-3 rounded-xl bg-[#f8fafd] p-4 ring-1 ring-inset ring-[#eef1f7]">
                <Avatar name={c.name} size="h-10 w-10 text-sm" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-bold text-[#101a3a]">{c.name}</p>
                    {i === 0 && (
                      <Badge tone="navy">
                        <Star className="h-3 w-3" aria-hidden="true" />
                        Primary
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-[#676b7a]">{c.relationship}</p>
                  <p className="mt-2 flex items-center gap-1.5 text-sm tabular-nums text-[#2b303b]">
                    <Phone className="h-3.5 w-3.5 shrink-0 text-[#9aa0ad]" aria-hidden="true" />
                    {c.phone}
                  </p>
                  {c.alternate_phone && <p className="pl-5 text-sm tabular-nums text-[#676b7a]">{c.alternate_phone}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    );
  }

  return (
    <Panel {...panel}>
      <Alert kind={message.kind || "info"} className="mb-4">
        {message.text}
      </Alert>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {list.map((c, i) => {
          const err = errors?.[i] ?? {};
          const fid = (k) => `ec-${i}-${k}`;
          const inp = (k, label, type = "text") => (
            <Field id={fid(k)} label={label} error={err[k]}>
              <input
                id={fid(k)}
                type={type}
                inputMode={type === "tel" ? "tel" : undefined}
                value={c[k] ?? ""}
                onChange={(e) => set(i, k, e.target.value)}
                aria-invalid={err[k] ? "true" : undefined}
                aria-describedby={err[k] ? `${fid(k)}-error` : undefined}
                className={INPUT(err[k])}
              />
            </Field>
          );
          return (
            <fieldset key={i} className="min-w-0 rounded-xl border border-[#e7e9ee] bg-[#fafbff] p-4">
              <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-[#1f4693]">
                Contact {i + 1}
                {i === 0 ? " (primary)" : ""}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {inp("name", "Name")}
                {inp("relationship", "Relationship")}
                {inp("phone", "Phone", "tel")}
                {inp("alternate_phone", "Alternate phone (optional)", "tel")}
              </div>
              {list.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setList((l) => l.filter((_, j) => j !== i));
                    setErrors(null);
                  }}
                  className="mt-3 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
                >
                  <Trash2 size={13} aria-hidden="true" /> Remove contact {i + 1}
                </button>
              )}
            </fieldset>
          );
        })}
        {list.length < 3 && (
          <button type="button" onClick={() => setList((l) => [...l, { ...EMPTY_CONTACT }])} className={`${BTN_SECONDARY} self-start`}>
            <Plus size={14} aria-hidden="true" /> Add another contact
          </button>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t border-[#eef0f4] pt-4">
          <button type="button" onClick={() => setEditing(false)} disabled={saving} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving ? "Saving…" : "Save contacts"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getMyProfile()
      .then((p) => active && setProfile(p))
      .catch(() => active && setError("Could not load your profile. Please refresh the page."));
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <Alert kind="err" className="mx-auto max-w-6xl">
        {error}
      </Alert>
    );
  }
  if (!profile) return <p className="py-10 text-center text-sm text-[#676b7a]">Loading your profile…</p>;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <ProfileHeader profile={profile} />
      <WorkCard work={profile.work} />
      <MyCertificateCard isIntern={profile.work.employment_type === "intern"} />
      <PersonalCard profile={profile} onSaved={setProfile} />
      <EmergencyCard profile={profile} onSaved={setProfile} />
      <MyDocumentsCard />
      <ChangePasswordCard />
    </div>
  );
}
