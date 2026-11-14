import { useId, useMemo, useState } from "react";
import { Banner, Button, Checkbox, PasswordInput, Select, TextArea, TextInput } from "./ui";
import { validateValues } from "./lib/validation";
import { fromDateTimeLocal, toDateTimeLocal, todayISO } from "./lib/format";

/** Initial form values from a record (edit) or field defaults (create). */
export function initialValues(fields, record, { userEmail } = {}) {
  const v = {};
  for (const f of fields) {
    let x = record ? record[f.name] : undefined;
    if (x === undefined || (x === null && !record)) {
      if (f.default !== undefined) x = f.default;
      else if (f.defaultToday) x = todayISO();
      else if (f.defaultUser) x = userEmail || "";
      else x = f.type === "checkbox" ? false : f.type === "multi" ? [] : "";
    }
    if (x === null) x = f.type === "checkbox" ? false : f.type === "multi" ? [] : "";
    if (f.type === "datetime") x = toDateTimeLocal(x);
    if (f.type === "number" && x !== "") x = String(x);
    v[f.name] = x;
  }
  return v;
}

/** Convert form values to the database shape (only visible, editable fields). */
export function toPayload(fields, values, { mode, original } = {}) {
  const out = {};
  for (const f of fields) {
    if (f.readOnly || f.secret) continue;   // secrets go to the vault RPC, never to the table
    if (mode === "edit" && f.createOnly) continue;
    const hidden = f.hidden && f.hidden(values);
    let x = values[f.name];
    if (hidden) x = f.type === "checkbox" ? false : null;
    else if (f.type === "datetime") x = x ? fromDateTimeLocal(x) : null;
    else if (f.type === "number") x = x === "" || x === null ? null : Number(x);
    else if (f.type === "domain" && typeof x === "string") x = x.trim().toLowerCase();
    else if (f.type === "email" && typeof x === "string") x = x.trim().toLowerCase();
    else if (typeof x === "string") x = x.trim() === "" ? null : x;
    if (mode === "edit" && original && JSON.stringify(original[f.name] ?? null) === JSON.stringify(x ?? null)) continue;
    out[f.name] = x;
  }
  return out;
}

function refLabel(kind, r) {
  switch (kind) {
    case "hosting": return `${r.provider} · ${r.environment} · ${r.purpose}${r.status !== "active" ? ` (${r.status})` : ""}`;
    case "domains": return r.domain_name;
    case "access": return `${r.service_name}${r.identifier_hint ? ` (${r.identifier_hint})` : ""}`;
    case "emails": return `${r.email_address} · ${r.purpose}`;
    case "repositories": return r.repo_url;
    case "milestones": return r.name;
    case "tasks": return `${r.task_code} ${r.title}`;
    case "documents": return `${r.name}${r.version ? ` v${r.version}` : ""}`;
    case "amc": return `${r.contract_number || "AMC"} (${r.start_date} – ${r.end_date})`;
    case "companies": return `${r.company_name} · ${r.company_number}`;
    default: return r.id;
  }
}

export function RefSelect({ field, value, onChange, refs, error, excludeId, required }) {
  const list = (refs?.[field.ref] || []).filter((r) => r.id !== excludeId);
  return (
    <Select label={field.label} value={value} onChange={onChange} required={required} help={field.help} error={error}
      disabled={field.readOnly} allowEmpty={!required || !value}
      placeholder={list.length ? (required ? "— Select —" : "— None —") : "— None recorded yet —"}
      options={list.map((r) => ({ value: r.id, label: refLabel(field.ref, r) }))} />
  );
}

export function FieldControl({ field: f, value, onChange, error, refs, values, recordId }) {
  const listId = useId();
  const required = typeof f.required === "function" ? f.required(values) : f.required;
  const common = { label: f.label, required, help: f.help, error, full: f.full };
  switch (f.type) {
    case "textarea":
      return <TextArea {...common} value={value} onChange={onChange} rows={f.rows || 3} maxLength={f.maxLength ?? 5000} placeholder={f.placeholder} />;
    case "select":
      return <Select {...common} value={value} onChange={onChange} options={f.options} allowEmpty={!required} />;
    case "checkbox":
      return <Checkbox label={f.label} checked={value} onChange={onChange} help={f.help} full={f.full} />;
    case "ref":
      return <RefSelect field={f} value={value} onChange={onChange} refs={refs} error={error} excludeId={recordId} required={required} />;
    case "combo":
      return (
        <>
          <TextInput {...common} value={value} onChange={onChange} list={listId} maxLength={f.maxLength} placeholder={f.placeholder} />
          <datalist id={listId}>{f.suggestions.map((s) => <option key={s} value={s} />)}</datalist>
        </>
      );
    case "password":
      return <PasswordInput {...common} value={value} onChange={onChange} disabled={f.disabled} disabledReason={f.disabledReason} />;
    case "date":
      return <TextInput {...common} type="date" value={value} onChange={onChange} />;
    case "datetime":
      return <TextInput {...common} type="datetime-local" value={value} onChange={onChange} />;
    case "number":
      return <TextInput {...common} type="number" inputMode="decimal" value={value} onChange={onChange} min={f.min} max={f.max} step="any" />;
    case "email":
      return <TextInput {...common} type="email" value={value} onChange={onChange} autoComplete="off" maxLength={254} placeholder={f.placeholder} />;
    case "url":
      return <TextInput {...common} type="url" value={value} onChange={onChange} placeholder={f.placeholder || "https://"} maxLength={1000} />;
    default:
      return <TextInput {...common} value={value} onChange={onChange} maxLength={f.maxLength ?? 300} placeholder={f.placeholder} autoComplete="off" />;
  }
}

/**
 * Generic form. onSubmit(payload) may throw; its message is shown.
 * Renders inside a <form>; the caller supplies the surrounding modal.
 */
export default function RecordForm({ fields, rules = [], record, refs, mode = record ? "edit" : "create", userEmail, onSubmit, onCancel, submitLabel, formId, hideButtons }) {
  const visibleFields = useMemo(() => fields.filter((f) => !(mode === "edit" && f.createOnly)), [fields, mode]);
  const [values, setValues] = useState(() => initialValues(visibleFields, record, { userEmail }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(name, v) {
    setValues((s) => ({ ...s, [name]: v }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  }

  async function submit(e) {
    e.preventDefault();
    const errs = validateValues(visibleFields, values, rules);
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError("Please correct the highlighted fields.");
      const firstBad = visibleFields.find((f) => errs[f.name]);
      if (firstBad) setTimeout(() => document.querySelector(`[aria-invalid="true"]`)?.focus(), 0);
      return;
    }
    setFormError("");
    setBusy(true);
    try {
      const payload = toPayload(visibleFields, values, { mode, original: record });
      await onSubmit(payload, values);
    } catch (err) {
      setFormError(err?.message || "Could not save.");
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {visibleFields.filter((f) => !(f.hidden && f.hidden(values))).map((f) => (
          <FieldControl key={f.name} field={f} value={values[f.name]} values={values} onChange={(v) => set(f.name, v)}
            error={errors[f.name]} refs={refs} recordId={record?.id} />
        ))}
      </div>
      {formError && <Banner tone="danger">{formError}</Banner>}
      {!hideButtons && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-[#eef0f4] pt-4">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>{submitLabel || (mode === "edit" ? "Save changes" : "Create")}</Button>
        </div>
      )}
    </form>
  );
}
