import { useEffect, useMemo, useState } from "react";
import Link from "@/lib/nx/link";
import { ChevronRight, ShieldOff, UserCheck, UserCog, UserPlus, UsersRound } from "lucide-react";
import PageHeader from "../PageHeader";
import { listEmployees } from "@/lib/api/admin/employees";
import { EMPLOYMENT_TYPES } from "@/lib/api/employee/profile";
import { AccessBadge } from "../employees/ui";
import { Alert, Avatar, Badge, Chips, Empty, MetricStrip, TableCard } from "@/components/portal/PortalUI";
import { BTN_PRIMARY, ICON_BTN, TABLE, TABLE_WRAP, TD, TH, TR } from "@/components/portal/portalStyles";
import AddEmployeeDialog from "../employees/AddEmployeeDialog";
import { useAccess } from "@/lib/access";

const FILTERS = [
  { key: "all", label: "All", icon: UsersRound, color: "#1f4693" },
  { key: "active", label: "Active", icon: UserCheck, color: "#059669" },
  { key: "disabled", label: "Access off", icon: ShieldOff, color: "#dc2626" },
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
  const { can } = useAccess();
  const canCreate = can("portal.employees.create");

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
      return [e.full_name, e.employee_code, e.department, e.designation, e.work_email, e.manager?.full_name, e.manager_name, EMPLOYMENT_TYPES[e.employment_type]]
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
          canCreate && (
            <button type="button" onClick={() => setAdding(true)} disabled={rows === null} className={BTN_PRIMARY}>
              <UserPlus size={16} aria-hidden="true" /> Add employee
            </button>
          )
        }
      />

      <MetricStrip
        items={FILTERS.map((f) => ({ ...f, value: rows === null ? "—" : counts[f.key] }))}
        selected={filter}
        onSelect={setFilter}
      />

      <TableCard
        title="Employees"
        count={rows === null ? null : shown.length}
        total={rows === null ? null : rows.length}
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search name, ID, department…"
        filters={
          <Chips
            label="Filter by portal access"
            value={filter}
            onChange={setFilter}
            items={FILTERS.map((f) => ({ key: f.key, label: f.label, count: rows === null ? null : counts[f.key] }))}
          />
        }
      >
        {error ? (
          <div className="p-5">
            <Alert kind="err">{error}</Alert>
          </div>
        ) : rows === null ? (
          <p role="status" className="p-5 text-sm text-[#676b7a]">
            Loading employees…
          </p>
        ) : shown.length === 0 ? (
          <Empty
            icon={UsersRound}
            title={rows.length ? "No employees match." : "No employees yet."}
            message={rows.length ? "Try a different search or filter." : canCreate ? "Click “Add employee” to add the first one." : undefined}
          />
        ) : (
          <>
            {/* Phones: cards */}
            <ul className="divide-y divide-[#f0f2f6] md:hidden">
              {shown.map((e) => (
                <li key={e.id}>
                  <Link href={`/admin/employees/${e.id}`} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-[#f8fafd]">
                    <Avatar name={e.full_name} size="h-10 w-10 text-sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#101a3a]">{e.full_name}</p>
                      <p className="truncate text-xs text-[#676b7a]">
                        <span className="font-mono">{e.employee_code}</span>
                        {[e.designation, e.department, EMPLOYMENT_TYPES[e.employment_type]].filter(Boolean).length > 0 && " · "}
                        {[e.designation, e.department, EMPLOYMENT_TYPES[e.employment_type]].filter(Boolean).join(" · ")}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <AccessBadge active={e.is_active} />
                        {e.is_active && e.punched_in && <Badge tone="blue">Punched in now</Badge>}
                      </div>
                    </div>
                    <ChevronRight size={16} className="shrink-0 text-[#b0b8cc]" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
            {/* Larger screens: table */}
            <div className={`hidden md:block ${TABLE_WRAP}`}>
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th scope="col" className={`${TH} pl-5`}>Employee</th>
                    <th scope="col" className={TH}>Department</th>
                    <th scope="col" className={TH}>Designation</th>
                    <th scope="col" className={TH}>Employment type</th>
                    <th scope="col" className={TH}>Reporting manager</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={`${TH} text-right`}>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => (
                    <tr key={e.id} className={`group ${TR}`}>
                      <td className={`${TD} pl-5`}>
                        <Link href={`/admin/employees/${e.id}`} className="flex items-center gap-3">
                          <Avatar name={e.full_name} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-[#101a3a] group-hover:text-[#1f4693]">{e.full_name}</span>
                            <span className="block font-mono text-xs text-[#9aa0ad]">{e.employee_code}</span>
                          </span>
                        </Link>
                      </td>
                      <td className={TD}>{dash(e.department)}</td>
                      <td className={TD}>{dash(e.designation)}</td>
                      <td className={TD}>
                        {EMPLOYMENT_TYPES[e.employment_type] ? (
                          <Badge tone={e.employment_type === "intern" ? "violet" : "slate"}>{EMPLOYMENT_TYPES[e.employment_type]}</Badge>
                        ) : (
                          dash(null)
                        )}
                      </td>
                      <td className={TD}>{dash(e.manager?.full_name ?? e.manager_name)}</td>
                      <td className={TD}>
                        <div className="flex flex-col items-start gap-1">
                          <AccessBadge active={e.is_active} />
                          {e.is_active && e.punched_in && <Badge tone="blue">Punched in now</Badge>}
                        </div>
                      </td>
                      <td className={`${TD} text-right`}>
                        <Link href={`/admin/employees/${e.id}`} aria-label={`Open ${e.full_name}`} title="Open" className={ICON_BTN}>
                          <ChevronRight size={16} aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </TableCard>

      {adding && canCreate && (
        <AddEmployeeDialog
          employees={rows ?? []}
          onClose={() => setAdding(false)}
          onCreated={(emp) => setRows((list) => [...(list ?? []), emp])}
        />
      )}
    </div>
  );
}
