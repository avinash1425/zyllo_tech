// Shared filter bar for the documents overview and directory.
import { X } from "lucide-react";
import { VERIFICATION_STATUSES } from "@/lib/hr/documents";
import { DOC_GROUPS, EXPIRY_STATUSES } from "@/lib/hr/documentCenter";
import { toOptions, useOrg } from "@/lib/hr/org";
import { Button, Field, Input, SearchInput, Select } from "@/hr/ui";

export const EMPTY_FILTERS = { search: "", employee: "", department: "", legal_entity: "", category: "", group: "", status: "", expiry_status: "", uploaded_from: "", uploaded_to: "", archived: false };

export default function DocumentFilters({ value, onChange, employees, categories, hide = [], showSearch = true }) {
  const org = useOrg();
  const set = (k) => (e) => onChange({ ...value, [k]: typeof e === "string" ? e : e.target.value });
  const show = (k) => !hide.includes(k);
  const active = Object.entries(value).some(([k, v]) => !hide.includes(k) && v && k !== "archived");
  const entities = org.data?.legalEntities ?? [];
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {showSearch && show("search") && <div className="sm:col-span-2 lg:col-span-1"><SearchInput value={value.search} onChange={set("search")} placeholder="Title, employee or ID…" label="Search documents" /></div>}
        {show("employee") && <Select aria-label="Employee" placeholder="All employees" value={value.employee} onChange={set("employee")} options={employees ?? []} />}
        {show("department") && <Select aria-label="Department" placeholder="All departments" value={value.department} onChange={set("department")} options={toOptions(org.data?.departments, "name", "id", { activeOnly: false })} />}
        {show("legal_entity") && entities.length > 1 && <Select aria-label="Company" placeholder="All companies" value={value.legal_entity} onChange={set("legal_entity")} options={toOptions(entities, "name", "id", { activeOnly: false })} />}
        {show("group") && <Select aria-label="Document type" placeholder="All document types" value={value.group} onChange={set("group")} options={DOC_GROUPS} />}
        {show("category") && <Select aria-label="Category" placeholder="All categories" value={value.category} onChange={set("category")} options={(categories ?? []).filter((c) => !value.group || c.doc_group === value.group).map((c) => ({ value: c.id, label: c.name }))} />}
        {show("status") && <Select aria-label="Verification status" placeholder="Any verification status" value={value.status} onChange={set("status")} options={VERIFICATION_STATUSES.map((s) => ({ value: s, label: s }))} />}
        {show("expiry_status") && <Select aria-label="Expiry status" placeholder="Any expiry status" value={value.expiry_status} onChange={set("expiry_status")} options={EXPIRY_STATUSES} />}
      </div>
      {show("uploaded_from") && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Uploaded from" className="sm:w-44"><Input type="date" value={value.uploaded_from} onChange={set("uploaded_from")} /></Field>
          <Field label="Uploaded to" className="sm:w-44"><Input type="date" value={value.uploaded_to} onChange={set("uploaded_to")} /></Field>
          {active && <Button variant="ghost" size="sm" className="sm:mb-1" onClick={() => onChange({ ...EMPTY_FILTERS, ...Object.fromEntries(hide.map((k) => [k, value[k]])) })}><X className="h-4 w-4" aria-hidden="true" />Clear filters</Button>}
        </div>
      )}
    </div>
  );
}
