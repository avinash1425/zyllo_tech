// HR Settings tab: document categories (hr_document_categories). Direct
// writes are allowed by RLS for documents.manage or settings.manage. No
// deletes: categories are deactivated.
import { from, run, useHrQuery } from "@/lib/hr/client";
import { Badge, Card, ErrorState, Loading } from "@/hr/ui";
import MasterDataEditor from "@/hr/components/MasterDataEditor";

const yes = (v) => (v ? <Badge tone="green">yes</Badge> : <span className="text-slate-400">—</span>);

function toCodes(val) {
  if (val === null || val === undefined) return null;
  const list = (Array.isArray(val) ? val : String(val).split(",")).map((s) => String(s).trim()).filter(Boolean);
  return list.length ? [...new Set(list)] : null;
}

export default function DocumentCategoriesSettings({ canEdit }) {
  const types = useHrQuery(() => run(from("hr_employment_types").select("code, name, active").order("sort_order")), []);
  if (types.loading && !types.data) return <Loading />;
  if (types.error) return <ErrorState message={types.error} onRetry={types.reload} />;
  const typeCodes = (types.data ?? []).map((t) => t.code).join(", ");

  const config = {
    table: "hr_document_categories",
    title: "Document categories",
    singular: "document category",
    orderBy: "sort_order",
    select: "id, code, name, description, requires_expiry, employee_can_upload, employee_can_view, is_confidential, checklist_required, applies_to_employment_types, active, sort_order",
    description: "Categories drive uploads, the required-document checklist and visibility. Confidential categories are HR-only: employees and managers never see them, so employee upload and view are switched off for them.",
    columns: [
      { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs">{r.code}</span> },
      { key: "name", header: "Name" },
      { key: "requires_expiry", header: "Expiry", render: (r) => yes(r.requires_expiry) },
      { key: "checklist_required", header: "Checklist", render: (r) => yes(r.checklist_required) },
      { key: "employee_can_upload", header: "Employee uploads", render: (r) => yes(r.employee_can_upload) },
      { key: "employee_can_view", header: "Employee sees", render: (r) => yes(r.employee_can_view) },
      { key: "is_confidential", header: "Confidential", render: (r) => (r.is_confidential ? <Badge tone="red">confidential</Badge> : "—") },
      { key: "applies_to_employment_types", header: "Applies to", render: (r) => (r.applies_to_employment_types?.length ? r.applies_to_employment_types.join(", ") : "All types") },
    ],
    fields: [
      { key: "code", label: "Code", required: true, createOnly: true, pattern: "^[a-z][a-z0-9_]{1,40}$", patternMessage: "lowercase letters, digits and _ (2–41 characters, starting with a letter)." },
      { key: "name", label: "Name", required: true },
      { key: "description", label: "Description", type: "textarea", wide: true },
      { key: "sort_order", label: "Sort order", type: "number", min: 0, max: 1000 },
      { key: "applies_to_employment_types", label: "Applies to employment types", wide: true, pattern: "^[a-z0-9_,\\s]*$", patternMessage: "Comma-separated employment type codes.",
        hint: `Comma-separated codes; blank = all types. Available: ${typeCodes || "none"}.` },
      { key: "requires_expiry", label: "Requires an expiry date", type: "checkbox" },
      { key: "checklist_required", label: "Required in the employee document checklist", type: "checkbox" },
      { key: "employee_can_upload", label: "Employees may upload this category themselves", type: "checkbox" },
      { key: "employee_can_view", label: "Employees can see documents of this category", type: "checkbox" },
      { key: "is_confidential", label: "Confidential (HR only)", type: "checkbox" },
    ],
    defaults: { employee_can_view: true, sort_order: 10 },
    transform: (p) => {
      const out = {
        ...p,
        requires_expiry: Boolean(p.requires_expiry),
        checklist_required: Boolean(p.checklist_required),
        employee_can_upload: Boolean(p.employee_can_upload),
        employee_can_view: Boolean(p.employee_can_view),
        is_confidential: Boolean(p.is_confidential),
        applies_to_employment_types: toCodes(p.applies_to_employment_types),
        sort_order: p.sort_order == null ? 0 : p.sort_order,
      };
      if (out.is_confidential) { out.employee_can_upload = false; out.employee_can_view = false; }
      return out;
    },
  };

  return <Card><MasterDataEditor config={config} canEdit={canEdit} /></Card>;
}
