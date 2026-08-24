import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

function Field({ field, value, onChange }) {
  const shared = {
    id: field.name,
    name: field.name,
    value: value ?? "",
    onChange: (event) => onChange(field.name, event.target.value),
    className: inputClass,
    placeholder: field.placeholder,
  };

  return (
    <label className="block space-y-1.5" htmlFor={field.name}>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {field.label}
      </span>
      {field.type === "textarea" ? (
        <textarea {...shared} rows={field.rows ?? 4} />
      ) : field.type === "select" ? (
        <select {...shared}>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input {...shared} type={field.type ?? "text"} />
      )}
    </label>
  );
}

export default function ResourceManager({ table, title, description, fields, listLabel }) {
  const emptyRow = useMemo(
    () => Object.fromEntries(fields.map((field) => [field.name, field.defaultValue ?? ""])),
    [fields],
  );

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(`Could not load ${title.toLowerCase()}: ${error.message}`);
    } else {
      setRows(data ?? []);
    }
    setLoading(false);
  }, [table, title]);

  useEffect(() => {
    load();
  }, [load]);

  const startCreate = () => setEditing({ ...emptyRow });
  const startEdit = (row) => {
    const next = { id: row.id };
    fields.forEach((field) => {
      next[field.name] = row[field.name] ?? field.defaultValue ?? "";
    });
    setEditing(next);
  };

  const setValue = (name, value) =>
    setEditing((current) => ({ ...current, [name]: value }));

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    const payload = {};
    fields.forEach((field) => {
      let value = editing[field.name];
      if (typeof value === "string") value = value.trim();
      if (field.type === "number") value = value === "" ? null : Number(value);
      payload[field.name] = value === "" ? (field.nullable ? null : "") : value;
    });

    const query = editing.id
      ? supabase.from(table).update(payload).eq("id", editing.id)
      : supabase.from(table).insert(payload);
    const { error } = await query;
    setSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editing.id ? "Changes saved." : "Created successfully.");
    setEditing(null);
    load();
  };

  const remove = async (row) => {
    if (!window.confirm("Delete this entry permanently?")) return;
    const { error } = await supabase.from(table).delete().eq("id", row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Deleted.");
    load();
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus size={16} /> New
        </button>
      </div>

      {editing && (
        <form onSubmit={save} className="mt-6 space-y-4 rounded-xl border border-border bg-background/60 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            {fields.map((field) => (
              <div key={field.name} className={field.type === "textarea" ? "md:col-span-2" : ""}>
                <Field field={field} value={editing[field.name]} onChange={setValue} />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              <X size={16} /> Cancel
            </button>
          </div>
        </form>
      )}

      <div className="mt-6 space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No {listLabel} yet. Create the first one.</p>
        ) : (
          rows.map((row) => (
            <article
              key={row.id}
              className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {row[fields[0].name] || "Untitled"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {row.status ? `${row.status} · ` : ""}
                  {new Date(row.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(row)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => remove(row)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
