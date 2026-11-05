// Generic master-data editor (departments, designations, locations, shifts,
// employment types, leave types, categories…). No deletes: rows are
// deactivated via `active`. Writes require settings.manage (enforced by RLS).
import { useState } from "react";
import { Plus } from "lucide-react";
import { from, run, useHrQuery } from "@/lib/hr/client";
import { Badge, Button, Checkbox, DataTable, Field, InlineError, Input, Modal, Select, Textarea, useToast } from "@/hr/ui";

/**
 * config: {
 *   table, title, keyField = "id", orderBy = "name", select = "*",
 *   columns: [{ key, header, render? }],
 *   fields: [{ key, label, type: text|number|time|date|select|textarea|checkbox|days, required?, options?, createOnly?, hint?, pattern?, min?, max? }],
 *   defaults?: {}, transform?(values) => values
 * }
 */
export default function MasterDataEditor({ config, canEdit }) {
  const { notify } = useToast();
  const q = useHrQuery(() => run(from(config.table).select(config.select ?? "*").order(config.orderBy ?? "name")), [config.table]);
  const [editing, setEditing] = useState(null);   // row or {} for new
  const keyField = config.keyField ?? "id";

  const columns = [
    ...config.columns,
    ...(config.noActive ? [] : [{ key: "active", header: "Status", render: (r) => (r.active === false ? <Badge>inactive</Badge> : <Badge tone="green">active</Badge>) }]),
    ...(canEdit ? [{ key: "_edit", header: <span className="sr-only">Actions</span>, render: (r) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(r); }}>Edit</Button> }] : []),
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-slate-600">{config.description}</p>
        {canEdit && <Button size="sm" onClick={() => setEditing({ ...(config.defaults ?? {}) })}><Plus className="h-4 w-4" aria-hidden="true" />Add</Button>}
      </div>
      <DataTable caption={config.title} columns={columns} rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} rowKey={keyField} emptyTitle={`No ${config.title.toLowerCase()} yet`} />
      {editing && (
        <EditModal config={config} row={editing} onClose={() => setEditing(null)}
          onSaved={(isNew) => { setEditing(null); q.reload(); notify(`${config.singular ?? "Record"} ${isNew ? "created" : "updated"}.`); }} />
      )}
    </div>
  );
}

const DAYS = [{ v: 1, l: "Mon" }, { v: 2, l: "Tue" }, { v: 3, l: "Wed" }, { v: 4, l: "Thu" }, { v: 5, l: "Fri" }, { v: 6, l: "Sat" }, { v: 7, l: "Sun" }];

function EditModal({ config, row, onClose, onSaved }) {
  const keyField = config.keyField ?? "id";
  const isNew = row[keyField] === undefined;
  const [v, setV] = useState(row);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));

  async function save() {
    const errs = {};
    for (const f of config.fields) {
      const val = v[f.key];
      if (f.required && (val === undefined || val === null || String(val).trim() === "")) errs[f.key] = `${f.label} is required.`;
      if (f.pattern && val && !new RegExp(f.pattern).test(String(val))) errs[f.key] = f.patternMessage ?? `${f.label} has an invalid format.`;
      if (f.type === "number" && val !== "" && val != null && ((f.min != null && Number(val) < f.min) || (f.max != null && Number(val) > f.max))) errs[f.key] = `${f.label} must be between ${f.min} and ${f.max}.`;
    }
    // Optional cross-field validation: config.validate(values) => { fieldKey: message }.
    if (config.validate) Object.assign(errs, config.validate(v) ?? {});
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const payload = {};
    for (const f of config.fields) {
      if (!isNew && f.createOnly) continue;
      let val = v[f.key];
      if (val === "") val = null;
      if (f.type === "number" && val != null) val = Number(val);
      if (f.uppercase && val) val = String(val).toUpperCase();
      payload[f.key] = val;
    }
    if (!config.noActive) payload.active = v.active !== false;
    const body = config.transform ? config.transform(payload) : payload;
    setBusy(true); setError(null);
    const res = isNew
      ? await run(from(config.table).insert(body).select(keyField).single())
      : await run(from(config.table).update(body).eq(keyField, row[keyField]).select(keyField).single());
    setBusy(false);
    if (res.error) setError(res.error); else onSaved(isNew);
  }

  return (
    <Modal open onClose={onClose} title={`${isNew ? "Add" : "Edit"} ${config.singular ?? "record"}`} size="md"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {config.fields.map((f) => {
          const disabled = !isNew && f.createOnly;
          const common = { value: v[f.key] ?? "", disabled, onChange: (e) => set(f.key, e.target.value) };
          let input;
          if (f.type === "select") input = <Select placeholder={f.placeholder ?? "— None —"} options={typeof f.options === "function" ? f.options(v) : f.options} {...common} />;
          else if (f.type === "textarea") input = <Textarea {...common} />;
          else if (f.type === "checkbox") return <div key={f.key} className="sm:col-span-2"><Checkbox label={f.label} checked={Boolean(v[f.key])} onChange={(e) => set(f.key, e.target.checked)} disabled={disabled} /></div>;
          else if (f.type === "days") return (
            <fieldset key={f.key} className="sm:col-span-2"><legend className="text-sm font-semibold text-[#173a52]">{f.label}</legend>
              <div className="mt-1 flex flex-wrap gap-3">{DAYS.map((d) => <Checkbox key={d.v} label={d.l} checked={(v[f.key] ?? []).includes(d.v)} onChange={(e) => set(f.key, e.target.checked ? [...new Set([...(v[f.key] ?? []), d.v])].sort() : (v[f.key] ?? []).filter((x) => x !== d.v))} />)}</div>
            </fieldset>);
          else input = <Input type={f.type ?? "text"} step={f.step} min={f.min} max={f.max} {...common} />;
          return <Field key={f.key} label={f.label} required={f.required} error={errors[f.key]} hint={f.hint} className={f.wide ? "sm:col-span-2" : undefined}>{input}</Field>;
        })}
        {!config.noActive && <div className="sm:col-span-2"><Checkbox label="Active" checked={v.active !== false} onChange={(e) => set("active", e.target.checked)} /></div>}
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}
