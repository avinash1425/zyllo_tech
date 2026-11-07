// Benefit categories (208): add / edit / deactivate. Codes are fixed once used by a plan.
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { useHrQuery } from "@/lib/hr/client";
import { listBenefitCategories, listBenefitPlans, saveBenefitCategory } from "@/lib/hr/benefits";
import { Badge, Button, Checkbox, DataTable, Field, Input, Textarea, Toolbar, useToast } from "@/hr/ui";
import { ActionModal } from "./shared";

function CategoryForm({ category, onClose, onSaved }) {
  const isNew = !category?.id;
  const [v, setV] = useState({ code: "", name: "", description: "", claimable_default: false, active: true, sort_order: 100, ...(category ?? {}) });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  return (
    <ActionModal title={isNew ? "Add category" : `Edit ${category.name}`} submitLabel={isNew ? "Add category" : "Save"} size="md" onClose={onClose}
      onSubmit={async () => {
        const errs = {};
        if (isNew && !/^[a-z][a-z0-9_]{1,39}$/.test(v.code.trim())) errs.code = "2–40 characters: lower-case letters, digits and _ (start with a letter).";
        if (v.name.trim().length < 2) errs.name = "Enter a name (2–80 characters).";
        setErrors(errs);
        if (Object.keys(errs).length) return { error: "Fix the highlighted fields." };
        const res = await saveBenefitCategory(v, category?.id);
        if (res.error) return { error: /duplicate|already exists/i.test(res.error) ? "A category with this code or name already exists." : res.error };
        onSaved(isNew); return {};
      }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Code" required error={errors.code} hint={isNew ? "e.g. learning, meal" : "Fixed after creation"}><Input value={v.code} disabled={!isNew} maxLength={40} onChange={set("code")} /></Field>
        <Field label="Name" required error={errors.name}><Input value={v.name} maxLength={80} onChange={set("name")} /></Field>
        <Field label="Sort order"><Input type="number" min={0} max={10000} value={v.sort_order} onChange={set("sort_order")} /></Field>
        <div className="flex flex-col justify-end gap-2">
          <Checkbox label="New plans accept claims by default" checked={Boolean(v.claimable_default)} onChange={set("claimable_default")} />
          <Checkbox label="Active" checked={Boolean(v.active)} onChange={set("active")} />
        </div>
        <Field label="Description" className="sm:col-span-2"><Textarea value={v.description ?? ""} maxLength={1000} onChange={set("description")} /></Field>
      </div>
      <p className="text-xs text-slate-500">Inactive categories stay on existing plans but cannot be chosen for new or changed plans.</p>
    </ActionModal>
  );
}

export default function CategoriesTab({ canManage, onChanged }) {
  const { notify } = useToast();
  const list = useHrQuery(() => listBenefitCategories(), []);
  const plans = useHrQuery(() => listBenefitPlans(), []);
  const [edit, setEdit] = useState(null);   // {} = new
  const count = (code) => (plans.data ?? []).filter((p) => p.category === code).length;
  return (
    <>
      <Toolbar>
        <p className="flex-1 text-sm text-slate-600">Group plans by type: health insurance, wellness, learning allowance, meal and more.</p>
        {canManage && <Button onClick={() => setEdit({})}><Plus className="h-4 w-4" aria-hidden="true" />Add category</Button>}
      </Toolbar>
      <DataTable caption="Benefit categories" rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload} emptyTitle="No categories"
        columns={[
          { key: "name", header: "Category", sortable: true, render: (r) => <div><p className="font-medium text-[#101a3a]">{r.name}</p><p className="font-mono text-xs text-slate-500">{r.code}</p></div> },
          { key: "description", header: "Description", render: (r) => <p className="max-w-md text-sm">{r.description ?? "—"}</p> },
          { key: "plans", header: "Plans", render: (r) => count(r.code) },
          { key: "claimable_default", header: "Claims by default", render: (r) => (r.claimable_default ? "Yes" : "No") },
          { key: "active", header: "Status", render: (r) => <Badge tone={r.active ? "green" : "slate"}>{r.active ? "active" : "inactive"}</Badge> },
          ...(canManage ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => <Button size="sm" variant="ghost" onClick={() => setEdit(r)}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button> }] : []),
        ]} />
      {edit && <CategoryForm category={edit.id ? edit : null} onClose={() => setEdit(null)}
        onSaved={(isNew) => { setEdit(null); notify(isNew ? "Category added." : "Category saved."); list.reload(); onChanged?.(); }} />}
    </>
  );
}
