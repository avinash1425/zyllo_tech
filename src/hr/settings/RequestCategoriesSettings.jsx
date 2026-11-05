// HR Settings tab: HR request categories (hr_request_categories). Direct
// writes are allowed by RLS for hr_requests.manage or settings.manage. No
// deletes: categories are deactivated.
import { useHrQuery } from "@/lib/hr/client";
import { listRoles } from "@/lib/hr/employees";
import { Badge, Card, ErrorState, Loading } from "@/hr/ui";
import MasterDataEditor from "@/hr/components/MasterDataEditor";

export default function RequestCategoriesSettings({ canEdit }) {
  const roles = useHrQuery(listRoles, []);
  if (roles.loading && !roles.data) return <Loading />;
  if (roles.error) return <ErrorState message={roles.error} onRetry={roles.reload} />;
  const roleName = (key) => roles.data?.find((r) => r.key === key)?.name ?? key;

  const config = {
    table: "hr_request_categories",
    title: "HR request categories",
    singular: "request category",
    orderBy: "sort_order",
    select: "id, code, name, description, default_assignee_role, sla_hours, is_confidential, active, sort_order",
    description: "New requests are routed to staff holding the default role (and hr_requests.manage). Confidential categories (e.g. grievances) are visible only to hr_requests.manage holders, never to managers.",
    columns: [
      { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs">{r.code}</span> },
      { key: "name", header: "Name" },
      { key: "default_assignee_role", header: "Routed to", render: (r) => (r.default_assignee_role ? roleName(r.default_assignee_role) : "Any HR staff") },
      { key: "sla_hours", header: "SLA (hours)" },
      { key: "is_confidential", header: "Confidential", render: (r) => (r.is_confidential ? <Badge tone="red">confidential</Badge> : "—") },
    ],
    fields: [
      { key: "code", label: "Code", required: true, createOnly: true, pattern: "^[a-z][a-z0-9_]{1,40}$", patternMessage: "lowercase letters, digits and _ (2–41 characters, starting with a letter)." },
      { key: "name", label: "Name", required: true },
      { key: "description", label: "Description", type: "textarea", wide: true },
      { key: "default_assignee_role", label: "Route new requests to role", type: "select", placeholder: "Any HR staff", options: (roles.data ?? []).map((r) => ({ value: r.key, label: r.name })) },
      { key: "sla_hours", label: "SLA (hours, 1–2160)", type: "number", min: 1, max: 2160, required: true },
      { key: "sort_order", label: "Sort order", type: "number", min: 0, max: 1000 },
      { key: "is_confidential", label: "Confidential (only hr_requests.manage can see these requests)", type: "checkbox" },
    ],
    defaults: { sla_hours: 48, sort_order: 10 },
    transform: (p) => ({ ...p, is_confidential: Boolean(p.is_confidential), sort_order: p.sort_order == null ? 0 : p.sort_order }),
  };

  return <Card><MasterDataEditor config={config} canEdit={canEdit} /></Card>;
}
