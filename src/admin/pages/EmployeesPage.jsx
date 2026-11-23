import { useEffect, useMemo, useState } from "react";
import Link from "@/lib/nx/link";
import { ChevronRight, Search, UserCog, UserPlus } from "lucide-react";
import PageHeader from "../PageHeader";
import { listEmployees } from "@/lib/api/admin/employees";
import { EMPLOYMENT_TYPES } from "@/lib/api/employee/profile";
import { AccessBadge, Avatar } from "../employees/ui";
import { BTN_PRIMARY } from "../employees/styles";
import AddEmployeeDialog from "../employees/AddEmployeeDialog";

const CARD = "rounded-2xl border border-[#e7e9ee] bg-white shadow-[0_1px_2px_rgba(16,26,58,0.06)]";
const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "disabled", label: "Access off" },
];

const dash = (v) => v || <span className="text-[#b0b8cc]">—</span>;

/**
 * Admin: Employee Management — every Employee Portal account with its
 * department, designation, employment type, reporting manager and portal
 * access. Add new employees here; click a row to open one. Migrations 239–240.
 */
export default function EmployeesPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let active = true;
    listEmployees()
      .then((data) => active && setRows(data))
      .catch(() => active && setError("Could not load employees. Please refresh the page."));
    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => {
    const list = rows ?? [];
    return { all: list.length, active: list.filter((e) => e.is_active).length, disabled: list.filter((e) => !e.is_active).length };
  }, [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((e) => {
      if (filter === "active" && !e.is_active) return false;
      if (filter === "disabled" && e.is_active) return false;
      if (!q) return true;
      return [e.full_name, e.employee_code, e.department, e.designation, e.work_email, e.manager?.full_name, EMPLOYMENT_TYPES[e.employment_type]]
        .filter(Boolean)
        .some((s) => s.toLowerCase().includes(q));
    });
  }, [rows, query, filter]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Employee Management"
        icon={UserCog}
        subtitle="Everyone with an Employee Portal account. Add new employees, open one to see their profile, set their work details and reporting manager, or turn their portal access on or off."
        actions={
          <button type="button" onClick={() => setAdding(true)} disabled={rows === null} className={BTN_PRIMARY}>
            <UserPlus size={16} aria-hidden="true" /> Add employee
          </button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9aa0ad]" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, ID, department…"
            aria-label="Search employees"
            className="w-full rounded-lg border border-[#dce1ec] bg-white py-2 pl-9 pr-3 text-sm text-[#2b303b] outline-none focus:border-[#1f4693] focus:ring-2 focus:ring-[#1f4693]/15"
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by portal access">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                filter === f.key
                  ? "border-[#1f4693] bg-[#1f4693] text-white"
                  : "border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]"
              }`}
            >
              {f.label} <span className="tabular-nums opacity-75">({counts[f.key]})</span>
            </button>
          ))}
        </div>
      </div>

      <section className={CARD}>
        {error ? (
          <p role="alert" className="p-5 text-sm text-red-700">{error}</p>
        ) : rows === null ? (
          <p className="p-5 text-sm text-[#676b7a]">Loading employees…</p>
        ) : shown.length === 0 ? (
          <p className="p-5 text-sm text-[#676b7a]">{rows.length ? "No employees match." : "No employees yet. Click “Add employee” to add the first one."}</p>
        ) : (
          <>
            {/* Phones: cards */}
            <ul className="divide-y divide-[#f0f2f6] md:hidden">
              {shown.map((e) => (
                <li key={e.id}>
                  <Link href={`/admin/employees/${e.id}`} className="flex items-center gap-3 p-4 hover:bg-[#f9fafc]">
                    <Avatar name={e.full_name} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#101a3a]">{e.full_name}</p>
                      <p className="truncate text-xs text-[#676b7a]">
                        <span className="font-mono">{e.employee_code}</span>
                        {[e.designation, e.department, EMPLOYMENT_TYPES[e.employment_type]].filter(Boolean).length > 0 && " · "}
                        {[e.designation, e.department, EMPLOYMENT_TYPES[e.employment_type]].filter(Boolean).join(" · ")}
                      </p>
                      <div className="mt-1"><AccessBadge active={e.is_active} /></div>
                    </div>
                    <ChevronRight size={16} className="text-[#b0b8cc]" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
            {/* Larger screens: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[#eef0f5] text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">
                    <th className="px-5 py-3">Employee</th>
                    <th className="px-3 py-3">Department</th>
                    <th className="px-3 py-3">Designation</th>
                    <th className="px-3 py-3">Employment type</th>
                    <th className="px-3 py-3">Reporting manager</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f2f6]">
                  {shown.map((e) => (
                    <tr key={e.id} className="group hover:bg-[#f9fafc]">
                      <td className="px-5 py-3">
                        <Link href={`/admin/employees/${e.id}`} className="flex items-center gap-3">
                          <Avatar name={e.full_name} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-[#101a3a] group-hover:text-[#1f4693]">{e.full_name}</span>
                            <span className="block font-mono text-xs text-[#9aa0ad]">{e.employee_code}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-[#2b303b]">{dash(e.department)}</td>
                      <td className="px-3 py-3 text-[#2b303b]">{dash(e.designation)}</td>
                      <td className="px-3 py-3 text-[#2b303b]">{dash(EMPLOYMENT_TYPES[e.employment_type])}</td>
                      <td className="px-3 py-3 text-[#2b303b]">{dash(e.manager?.full_name)}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <AccessBadge active={e.is_active} />
                          {e.is_active && e.punched_in && (
                            <span className="text-[11px] font-medium text-[#1f4693]">Punched in now</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link
                          href={`/admin/employees/${e.id}`}
                          aria-label={`Open ${e.full_name}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#1f4693] hover:underline"
                        >
                          Open <ChevronRight size={14} aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {adding && (
        <AddEmployeeDialog
          employees={rows ?? []}
          onClose={() => setAdding(false)}
          onCreated={(emp) => setRows((list) => [...(list ?? []), emp])}
        />
      )}
    </div>
  );
}
