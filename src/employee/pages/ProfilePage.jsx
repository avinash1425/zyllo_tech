import { useEffect, useState } from "react";
import { Briefcase, HeartPulse, Pencil, Phone, Plus, Trash2, UserRound } from "lucide-react";
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
import { formatDate } from "../attendanceFormat";

const CARD = "rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-[0_1px_2px_rgba(16,26,58,0.06)] sm:p-5";
const BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-60";
const BTN_PRIMARY = `${BTN} bg-gradient-to-r from-[#f7941e] to-[#1f4693] text-white`;
const BTN_SECONDARY = `${BTN} border border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]`;
const INPUT = (err) =>
  `w-full rounded-lg border bg-white px-3 py-2 text-sm text-[#2b303b] outline-none transition focus:border-[#1f4693] focus:ring-2 focus:ring-[#1f4693]/15 ${
    err ? "border-red-400" : "border-[#dce1ec]"
  }`;

const EMPTY_CONTACT = { name: "", relationship: "", phone: "", alternate_phone: "" };
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

function Field({ id, label, error, children, wide }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-[#4a5880]">
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

/** Button group instead of a dropdown (project rule: no <select>). */
function Choice({ id, label, options, value, onChange, wide }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined} role="radiogroup" aria-labelledby={`${id}-label`}>
      <p id={`${id}-label`} className="mb-1 text-xs font-semibold text-[#4a5880]">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(on ? "" : o.value)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                on ? "border-[#1f4693] bg-[#1f4693] text-white" : "border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Banner({ kind, children }) {
  if (!children) return null;
  const cls = kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700";
  return (
    <p role={kind === "ok" ? "status" : "alert"} className={`mb-4 rounded-lg px-3 py-2 text-sm ${cls}`}>
      {children}
    </p>
  );
}

function completeness(profile) {
  const p = profile.personal ?? {};
  const keys = ["date_of_birth", "gender", "blood_group", "marital_status", "nationality", "personal_email", "phone", "current_address", "permanent_address"];
  const filled = keys.filter((k) => p[k]).length + (profile.emergency_contacts?.length ? 1 : 0);
  return Math.round((filled / (keys.length + 1)) * 100);
}

function ProfileHeader({ profile }) {
  const w = profile.work;
  const pct = completeness(profile);
  return (
    <section className={`${CARD} flex flex-col gap-4 sm:flex-row sm:items-center`}>
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f7941e] to-[#1f4693] text-2xl font-bold text-white">
        {(w.full_name?.[0] ?? "E").toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-xl font-bold text-[#101a3a]">{w.full_name}</h2>
        <p className="text-sm text-[#676b7a]">
          {[w.designation, w.department].filter(Boolean).join(" · ") || "Designation not set"}
        </p>
        <p className="mt-0.5 font-mono text-xs text-[#9aa0ad]">{w.employee_code}</p>
      </div>
      <div className="w-full sm:w-56">
        <div className="flex justify-between text-xs font-semibold text-[#4a5880]">
          <span>Profile complete</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#eef0f5]">
          <div className="h-full rounded-full bg-gradient-to-r from-[#f7941e] to-[#1f4693]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </section>
  );
}

function WorkCard({ work }) {
  const m = work.manager;
  return (
    <section className={CARD}>
      <CardHeader icon={Briefcase} title="Work details" note="Set by the company" />
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Item label="Employee ID">
          <span className="font-mono">{work.employee_code}</span>
        </Item>
        <Item label="Department">{show(work.department)}</Item>
        <Item label="Designation">{show(work.designation)}</Item>
        <Item label="Reporting manager">
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
        </Item>
        <Item label="Date of joining">{show(work.date_of_joining && formatDate(work.date_of_joining))}</Item>
        <Item label="Employment type">{show(EMPLOYMENT_TYPES[work.employment_type])}</Item>
        <Item label="Work location">{show(work.work_location)}</Item>
        <Item label="Work email">{show(work.work_email)}</Item>
      </dl>
    </section>
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
        <section className={CARD}>
          <CardHeader
            icon={UserRound}
            title="Personal details"
            action={
              <button type="button" onClick={startEdit} className={BTN_SECONDARY}>
                <Pencil size={14} aria-hidden="true" /> Edit
              </button>
            }
          />
          <Banner kind={message.kind}>{message.text}</Banner>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Item label="Full name">{profile.work.full_name}</Item>
            <Item label="Date of birth">{show(personal.date_of_birth && formatDate(personal.date_of_birth))}</Item>
            <Item label="Gender">{show(labelOf(GENDERS, personal.gender))}</Item>
            <Item label="Blood group">{show(personal.blood_group)}</Item>
            <Item label="Marital status">{show(labelOf(MARITAL_STATUSES, personal.marital_status))}</Item>
            <Item label="Nationality">{show(personal.nationality)}</Item>
          </dl>
        </section>
        <section className={CARD}>
          <CardHeader
            icon={Phone}
            title="Contact information"
            action={
              <button type="button" onClick={startEdit} className={BTN_SECONDARY}>
                <Pencil size={14} aria-hidden="true" /> Edit
              </button>
            }
          />
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Item label="Mobile number">{show(personal.phone)}</Item>
            <Item label="Alternate number">{show(personal.alternate_phone)}</Item>
            <Item label="Personal email">{show(personal.personal_email)}</Item>
            <Item label="Current address" wide>
              {show(personal.current_address)}
            </Item>
            <Item label="Permanent address" wide>
              {show(personal.permanent_address)}
            </Item>
          </dl>
        </section>
      </>
    );
  }

  return (
    <section className={CARD}>
      <CardHeader icon={UserRound} title="Edit personal & contact details" />
      <Banner kind={message.kind}>{message.text}</Banner>
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <p className="text-xs text-[#676b7a] sm:col-span-2">
          Your name, department and designation are set by the company. Ask HR if they need to change.
        </p>
        {input("date_of_birth", "Date of birth", { type: "date" })}
        {input("nationality", "Nationality", { placeholder: "e.g. Indian" })}
        <Choice id="pf-gender" label="Gender" options={GENDERS} value={form.gender} onChange={(v) => set("gender", v)} wide />
        <Choice id="pf-blood" label="Blood group" options={BLOOD_GROUPS} value={form.blood_group} onChange={(v) => set("blood_group", v)} wide />
        <Choice
          id="pf-marital"
          label="Marital status"
          options={MARITAL_STATUSES}
          value={form.marital_status}
          onChange={(v) => set("marital_status", v)}
          wide
        />

        <div className="flex items-center gap-3 sm:col-span-2">
          <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-[#b0b8cc]">Contact</span>
          <div className="h-px flex-1 bg-[#eef2fb]" />
        </div>
        {input("phone", "Mobile number", { type: "tel", inputMode: "tel", autoComplete: "tel", placeholder: "+91 98765 43210" })}
        {input("alternate_phone", "Alternate number", { type: "tel", inputMode: "tel" })}
        {input("personal_email", "Personal email", { type: "email", autoComplete: "email", wide: true })}
        {area("current_address", "Current address")}
        <label className="flex items-center gap-2 text-sm text-[#2b303b] sm:col-span-2">
          <input type="checkbox" checked={sameAddress} onChange={(e) => setSameAddress(e.target.checked)} className="h-4 w-4 accent-[#1f4693]" />
          Permanent address is the same as current address
        </label>
        {area("permanent_address", "Permanent address", sameAddress)}

        <div className="flex justify-end gap-2 border-t border-[#f0f4ff] pt-4 sm:col-span-2">
          <button type="button" onClick={() => setEditing(false)} disabled={saving} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving ? "Saving…" : "Save details"}
          </button>
        </div>
      </form>
    </section>
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

  const header = (
    <CardHeader
      icon={HeartPulse}
      title="Emergency contacts"
      note={editing ? "1 to 3 people" : undefined}
      action={
        !editing && (
          <button type="button" onClick={startEdit} className={BTN_SECONDARY}>
            <Pencil size={14} aria-hidden="true" /> {contacts.length ? "Edit" : "Add"}
          </button>
        )
      }
    />
  );

  if (!editing) {
    return (
      <section className={CARD}>
        {header}
        <Banner kind={message.kind}>{message.text}</Banner>
        {contacts.length === 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            No emergency contact yet. Please add at least one person we can call in an emergency.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {contacts.map((c, i) => (
              <div key={`${c.name}-${i}`} className="rounded-xl border border-[#eef0f5] bg-[#fafbfc] p-4">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-[#101a3a]">{c.name}</p>
                  {i === 0 && <span className="rounded-full bg-[#1f4693]/10 px-2 py-0.5 text-[10px] font-bold text-[#1f4693]">Primary</span>}
                </div>
                <p className="text-xs text-[#676b7a]">{c.relationship}</p>
                <p className="mt-2 text-sm tabular-nums text-[#2b303b]">{c.phone}</p>
                {c.alternate_phone && <p className="text-sm tabular-nums text-[#676b7a]">{c.alternate_phone}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className={CARD}>
      {header}
      <Banner kind={message.kind}>{message.text}</Banner>
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
            <fieldset key={i} className="rounded-xl border border-[#eef0f5] p-4">
              <legend className="px-1 text-xs font-bold text-[#4a5880]">
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
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline"
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
        <div className="flex justify-end gap-2 border-t border-[#f0f4ff] pt-4">
          <button type="button" onClick={() => setEditing(false)} disabled={saving} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving ? "Saving…" : "Save contacts"}
          </button>
        </div>
      </form>
    </section>
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
      <p role="alert" className="mx-auto max-w-6xl rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );
  }
  if (!profile) return <p className="py-10 text-center text-sm text-[#676b7a]">Loading your profile…</p>;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <ProfileHeader profile={profile} />
      <WorkCard work={profile.work} />
      <PersonalCard profile={profile} onSaved={setProfile} />
      <EmergencyCard profile={profile} onSaved={setProfile} />
    </div>
  );
}
