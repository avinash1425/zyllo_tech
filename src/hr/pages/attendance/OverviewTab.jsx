// Attendance overview (HR / managers): KPIs and the employee attendance list
// for one date. Everything — including employees with no record, holidays,
// weekly offs and approved leave — is computed by hr_attendance_overview
// from database records and respects the caller's scope (all / team).
import { useState } from "react";
import { CalendarOff, CheckCircle2, Clock, FileClock, Hourglass, LogOut, Plane, UserX } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { exportCsv, minutesToHm, useHrQuery } from "@/lib/hr/client";
import { toOptions } from "@/lib/hr/org";
import { OVERVIEW_STATUSES, businessToday, formatTime, getOverview } from "@/lib/hr/attendance";
import { Badge, Button, DataTable, Field, Input, KpiCard, SearchInput, Select, Toolbar, useToast } from "@/hr/ui";
import { AttStatusBadge, EmployeeCell } from "./common";

const STATUS_FILTERS = [
  ...OVERVIEW_STATUSES.map((s) => ({ value: s, label: s === "weekend" ? "weekly off" : s.replace(/_/g, " ") })),
  { value: "present_any", label: "checked in (any)" },
  { value: "missing_punch_out", label: "missing punch-out" },
];

export default function OverviewTab({ tz, org, initialDate, initialDepartment = "", initialStatus = "", onOpenCorrections }) {
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const today = businessToday(tz);
  const [f, setF] = useState({ date: initialDate || today, department: initialDepartment, company: "", status: initialStatus, search: "" });
  const [search, setSearch] = useState("");
  const q = useHrQuery(() => getOverview({ date: f.date, department: f.department, status: f.status, search: f.search, legalEntity: f.company }),
    [f.date, f.department, f.status, f.search, f.company]);
  const k = q.data?.kpis ?? {};
  const rows = q.data?.rows ?? [];
  const set = (key) => (e) => setF((s) => ({ ...s, [key]: typeof e === "string" ? e : e.target.value }));
  const companies = org.data?.legalEntities ?? [];

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Present" value={k.present ?? 0} icon={CheckCircle2} tone="green" loading={q.loading} onClick={() => setF((s) => ({ ...s, status: "present_any" }))} />
        <KpiCard label="Absent" value={k.absent ?? 0} icon={UserX} tone="red" loading={q.loading} onClick={() => setF((s) => ({ ...s, status: "absent" }))} />
        <KpiCard label="Late arrivals" value={k.late ?? 0} icon={Clock} tone="orange" loading={q.loading} onClick={() => setF((s) => ({ ...s, status: "late" }))} />
        <KpiCard label="On leave" value={k.on_leave ?? 0} icon={Plane} tone="navy" loading={q.loading} onClick={() => setF((s) => ({ ...s, status: "on_leave" }))} />
        <KpiCard label="Missing punch-out" value={k.missing_punch_out ?? 0} icon={LogOut} tone="orange" loading={q.loading} onClick={() => setF((s) => ({ ...s, status: "missing_punch_out" }))} />
        <KpiCard label="Pending corrections" value={k.pending_corrections ?? 0} icon={FileClock} tone="teal" loading={q.loading} onClick={onOpenCorrections} />
        <KpiCard label="Hours worked" value={minutesToHm(k.worked_minutes ?? 0)} hint={k.overtime_minutes ? `${minutesToHm(k.overtime_minutes)} overtime` : undefined} icon={Hourglass} tone="navy" loading={q.loading} />
        <KpiCard label="Holiday / weekly off" value={(k.holiday ?? 0) + (k.weekly_off ?? 0)} hint={k.not_started ? `${k.not_started} not started yet` : undefined} icon={CalendarOff} tone="slate" loading={q.loading} />
      </div>
      <Toolbar>
        <Field label="Date" className="sm:w-44"><Input type="date" value={f.date} max={today} onChange={set("date")} /></Field>
        <Field label="Department" className="sm:w-48"><Select placeholder="All departments" value={f.department} onChange={set("department")} options={toOptions(org.data?.departments, "name", "id", { activeOnly: false })} /></Field>
        {companies.length > 1 && <Field label="Company" className="sm:w-48"><Select placeholder="All companies" value={f.company} onChange={set("company")} options={toOptions(companies, "name", "id", { activeOnly: false })} /></Field>}
        <Field label="Status" className="sm:w-48"><Select placeholder="All statuses" value={f.status} onChange={set("status")} options={STATUS_FILTERS} /></Field>
        <form className="flex flex-1 items-end gap-2 self-stretch sm:self-end" onSubmit={(e) => { e.preventDefault(); setF((s) => ({ ...s, search })); }}>
          <SearchInput value={search} onChange={(e) => setSearch(typeof e === "string" ? e : e.target.value)} placeholder="Search name or ID, press Enter" label="Search employees" />
          {hasPermission("attendance.export") && (
            <Button type="button" variant="secondary" disabled={!rows.length} onClick={() => {
              exportCsv(`attendance-overview-${f.date}`, rows, [
                { label: "Date", key: "work_date" }, { label: "Employee ID", value: (r) => r.employee?.employee_code }, { label: "Employee", value: (r) => r.employee?.name },
                { label: "Department", value: (r) => r.employee?.department_name }, { label: "Status", key: "status" }, { label: "Shift", key: "shift_name" },
                { label: `Shift start (${tz})`, value: (r) => formatTime(r.expected_start_at, tz).replace("—", "") },
                { label: `Check in (${tz})`, value: (r) => formatTime(r.check_in_at, tz).replace("—", "") },
                { label: `Check out (${tz})`, value: (r) => formatTime(r.check_out_at, tz).replace("—", "") },
                { label: "Worked minutes", key: "worked_minutes" }, { label: "Expected minutes", key: "expected_minutes" }, { label: "Short minutes", key: "short_minutes" },
                { label: "Late minutes", key: "late_minutes" }, { label: "Overtime minutes", key: "overtime_minutes" }, { label: "Missing punch-out", value: (r) => (r.missing_punch_out ? "yes" : "") },
              ]);
              notify(`Exported ${rows.length} rows.`);
            }}>Export CSV</Button>
          )}
        </form>
      </Toolbar>
      <p className="mb-3 text-xs text-slate-500">
        Every in-scope employee is listed, including those with no punch. Holidays, weekly offs and approved leave are never counted as absences.
        Times are in the business timezone ({tz}); each record is calculated in the employee's own timezone.
      </p>
      <DataTable caption={`Attendance on ${f.date}`} rows={rows} rowKey={(r) => r.employee?.id} loading={q.loading} error={q.error} onRetry={q.reload} pageSize={50}
        emptyTitle="No employees match these filters"
        columns={[
          { key: "employee", header: "Employee", sortable: true, sortValue: (r) => r.employee?.name?.toLowerCase(), render: (r) => <EmployeeCell e={r.employee} /> },
          { key: "dept", header: "Department", render: (r) => r.employee?.department_name || "—" },
          { key: "status", header: "Status", sortable: true, render: (r) => (
            <div className="flex flex-wrap items-center gap-1">
              <AttStatusBadge status={r.status} />
              {r.missing_punch_out && r.status !== "missing_punch" && <Badge tone="orange">no punch-out</Badge>}
              {r.holiday_name && <span className="text-xs text-slate-500">{r.holiday_name}</span>}
            </div>) },
          { key: "shift", header: "Shift", render: (r) => <span className="whitespace-nowrap text-xs">{r.shift_name}<br /><span className="text-slate-500">from {formatTime(r.expected_start_at, tz)}</span></span> },
          { key: "check_in_at", header: "In", sortable: true, render: (r) => formatTime(r.check_in_at, tz) },
          { key: "check_out_at", header: "Out", render: (r) => formatTime(r.check_out_at, tz) },
          { key: "worked_minutes", header: "Worked", sortable: true, render: (r) => minutesToHm(r.worked_minutes) },
          { key: "short_minutes", header: "Short", render: (r) => (r.short_minutes ? minutesToHm(r.short_minutes) : "—") },
          { key: "late_minutes", header: "Late", sortable: true, render: (r) => (r.late_minutes ? minutesToHm(r.late_minutes) : "—") },
          { key: "overtime_minutes", header: "OT", render: (r) => (r.overtime_minutes ? minutesToHm(r.overtime_minutes) : "—") },
          { key: "source", header: "Source", render: (r) => (r.source ? <Badge tone={r.source === "self" ? "slate" : "violet"}>{r.source}</Badge> : "—") },
        ]} />
    </>
  );
}
