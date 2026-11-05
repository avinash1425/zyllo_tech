// Working-hours summary (HR / managers): per-employee totals for a week,
// month or custom range (max 93 days), computed by hr_attendance_summary.
// Overtime and short hours are informational only — no pay is derived here.
import { useMemo, useState } from "react";
import { useAuth } from "@/hr/platform/auth";
import { exportCsv, minutesToHm, useHrQuery } from "@/lib/hr/client";
import { toOptions } from "@/lib/hr/org";
import { addDays, businessToday, getSummary, monthRange } from "@/lib/hr/attendance";
import { Badge, Button, DataTable, Field, Input, Select, Toolbar, useToast } from "@/hr/ui";
import { EmployeeCell } from "./common";
import EmployeeCalendarModal from "./EmployeeCalendarModal";

function weekRange(today) {
  const d = new Date(`${today}T00:00:00Z`);
  const iso = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const from = addDays(today, -iso);
  return { from, to: addDays(from, 6) };
}

export default function SummaryTab({ tz, org }) {
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const today = businessToday(tz);
  const [period, setPeriod] = useState("month");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [custom, setCustom] = useState(weekRange(today));
  const [department, setDepartment] = useState("");
  const [open, setOpen] = useState(null);
  const range = useMemo(() => (period === "month" ? monthRange(month) : period === "week" ? weekRange(today) : custom), [period, month, custom, today]);
  const invalid = !range.from || !range.to || range.to < range.from;
  const q = useHrQuery(() => (invalid ? Promise.resolve({ data: [], error: null }) : getSummary({ from: range.from, to: range.to, department })),
    [range.from, range.to, department, invalid]);
  const rows = q.data ?? [];
  const t = (r) => r.totals ?? {};

  return (
    <>
      <Toolbar>
        <Field label="Period" className="sm:w-40">
          <Select value={period} onChange={(e) => setPeriod(e.target.value)}
            options={[{ value: "week", label: "This week" }, { value: "month", label: "Month" }, { value: "custom", label: "Custom range" }]} />
        </Field>
        {period === "month" && <Field label="Month" className="sm:w-44"><Input type="month" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>}
        {period === "custom" && (
          <>
            <Field label="From" className="sm:w-44"><Input type="date" value={custom.from} max={today} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></Field>
            <Field label="To" className="sm:w-44" error={invalid ? "Must be on or after From." : undefined}><Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></Field>
          </>
        )}
        <Field label="Department" className="sm:w-48"><Select placeholder="All departments" value={department} onChange={(e) => setDepartment(e.target.value)} options={toOptions(org.data?.departments, "name", "id", { activeOnly: false })} /></Field>
        <div className="flex flex-1 items-end justify-end self-stretch sm:self-end">
          {hasPermission("attendance.export") && (
            <Button variant="secondary" disabled={!rows.length} onClick={() => {
              exportCsv(`attendance-summary-${range.from}-to-${range.to}`, rows, [
                { label: "Employee ID", value: (r) => r.employee?.employee_code }, { label: "Employee", value: (r) => r.employee?.name },
                { label: "Department", value: (r) => r.employee?.department_name },
                ...["working_days", "present_days", "absent_days", "leave_days", "holidays", "weekly_offs", "late_days", "late_minutes", "half_days",
                  "missing_punch_days", "expected_minutes", "worked_minutes", "short_minutes", "overtime_minutes"].map((key) => ({ label: key.replace(/_/g, " "), value: (r) => t(r)[key] })),
              ]);
              notify(`Exported ${rows.length} rows.`);
            }}>Export CSV</Button>
          )}
        </div>
      </Toolbar>
      <p className="mb-3 text-xs text-slate-500">
        {range.from} to {range.to}. Future days are not counted. Overtime and short hours are shown for review only; payroll applies them only under an approved payroll rule.
      </p>
      <DataTable caption="Working hours summary" rows={rows} rowKey={(r) => r.employee?.id} loading={q.loading} error={q.error} onRetry={q.reload} pageSize={50}
        emptyTitle="No employees in scope" onRowClick={(r) => setOpen(r.employee)}
        columns={[
          { key: "employee", header: "Employee", sortable: true, sortValue: (r) => r.employee?.name?.toLowerCase(), render: (r) => <EmployeeCell e={r.employee} /> },
          { key: "days", header: "Present / working", render: (r) => `${t(r).present_days ?? 0} / ${t(r).working_days ?? 0}` },
          { key: "absent", header: "Absent", sortable: true, sortValue: (r) => t(r).absent_days, render: (r) => (t(r).absent_days ? <Badge tone="red">{t(r).absent_days}</Badge> : "0") },
          { key: "leave", header: "Leave", render: (r) => t(r).leave_days ?? 0 },
          { key: "late", header: "Late days", sortable: true, sortValue: (r) => t(r).late_days, render: (r) => (t(r).late_days ? <Badge tone={t(r).late_days >= 3 ? "red" : "amber"}>{t(r).late_days} · {minutesToHm(t(r).late_minutes)}</Badge> : "0") },
          { key: "missing", header: "Missing punch", render: (r) => t(r).missing_punch_days ?? 0 },
          { key: "expected", header: "Expected", render: (r) => minutesToHm(t(r).expected_minutes) },
          { key: "worked", header: "Worked", sortable: true, sortValue: (r) => t(r).worked_minutes, render: (r) => minutesToHm(t(r).worked_minutes) },
          { key: "short", header: "Short", render: (r) => (t(r).short_minutes ? minutesToHm(t(r).short_minutes) : "—") },
          { key: "ot", header: "Overtime", render: (r) => (t(r).overtime_minutes ? minutesToHm(t(r).overtime_minutes) : "—") },
        ]} />
      {open && <EmployeeCalendarModal employee={open} tz={tz} month={(period === "month" ? month : range.from.slice(0, 7))} onClose={() => setOpen(null)} />}
    </>
  );
}
