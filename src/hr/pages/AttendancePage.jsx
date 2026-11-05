// Attendance & Time (HR / managers). Overview (server-computed, includes
// employees with no record), late arrivals, exceptions (missing punches /
// recorded absences), corrections & regularization approvals, working-hours
// summary, shift management, holiday calendar, manual entries and CSV
// export. All calculations (late, early, overtime, status, day type) are
// done by the server; this page only displays them.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Download, Plus } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { exportCsv, formatDate, fullName, minutesToHm, useHrQuery } from "@/lib/hr/client";
import { toOptions, useEmployeeOptions, useOrg } from "@/lib/hr/org";
import {
  MANUAL_NO_PUNCH_STATUSES, addDays, businessToday, formatTime, listAttendance,
  listOpenPunches, markMissingPunches, upsertManualAttendance, useBusinessTimezone, zonedIso,
} from "@/lib/hr/attendance";
import {
  Badge, Button, DataTable, ErrorState, Field, InlineError, Input, Modal, PageHeader, SearchInput, Select,
  StatusBadge, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";
import { EmployeeCell } from "./attendance/common";
import OverviewTab from "./attendance/OverviewTab";
import SummaryTab from "./attendance/SummaryTab";
import CorrectionsTab from "./attendance/CorrectionsTab";
import ShiftsTab from "./attendance/ShiftsTab";
import HolidaysTab from "./attendance/HolidaysTab";

function csvColumns(tz, deptName) {
  return [
    { label: "Date", key: "work_date" }, { label: "Employee ID", value: (r) => r.employee?.employee_code },
    { label: "Employee", value: (r) => fullName(r.employee) }, { label: "Department", value: (r) => deptName(r.employee?.department_id) },
    { label: "Status", key: "status" }, { label: `Check in (${tz})`, value: (r) => formatTime(r.check_in_at, tz).replace("—", "") },
    { label: `Check out (${tz})`, value: (r) => formatTime(r.check_out_at, tz).replace("—", "") },
    { label: "Worked minutes", key: "worked_minutes" }, { label: "Late minutes", key: "late_minutes" },
    { label: "Early leave minutes", key: "early_leave_minutes" }, { label: "Overtime minutes", key: "overtime_minutes" },
    { label: "Source", key: "source" }, { label: "Notes", key: "notes" },
  ];
}

export default function AttendancePage() {
  const { hasPermission } = useAuth();
  const tz = useBusinessTimezone();
  const org = useOrg();
  const [params, setParams] = useSearchParams();
  const canApprove = hasPermission("attendance.approve") || hasPermission("attendance.approve_team");
  const canManage = hasPermission("attendance.manage");
  const canView = hasPermission("attendance.view") || hasPermission("attendance.view_team");
  const tabs = [
    { value: "daily", label: "Overview" }, { value: "late", label: "Late arrivals" }, { value: "exceptions", label: "Exceptions" },
    ...(canApprove || canView ? [{ value: "corrections", label: "Corrections & regularization" }] : []),
    { value: "summary", label: "Working hours" },
    { value: "shifts", label: "Shifts" },
    { value: "holidays", label: "Holidays" },
  ];
  const tab = tabs.some((t) => t.value === params.get("tab")) ? params.get("tab") : "daily";
  const [manual, setManual] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const deptName = (id) => org.data?.departments?.find((d) => d.id === id)?.name ?? "";

  return (
    <>
      <PageHeader title="Attendance & Time" description={`Recorded check-ins and check-outs. Times are shown in the business timezone (${tz}).`}
        actions={canManage && <Button onClick={() => setManual(true)}><Plus className="h-4 w-4" aria-hidden="true" />Manual entry</Button>} />
      <Tabs tabs={tabs} value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} label="Attendance sections" />
      {tab === "daily" && <OverviewTab key={`d${refreshKey}`} tz={tz} org={org} initialDate={isoDate(params.get("date")) ?? undefined}
        initialDepartment={params.get("department") ?? ""} initialStatus={params.get("status") === "attended" ? "present_any" : (params.get("status") ?? "")}
        onOpenCorrections={() => setParams({ tab: "corrections" }, { replace: true })} />}
      {tab === "late" && <LateArrivals key={`l${refreshKey}`} tz={tz} org={org} deptName={deptName} />}
      {tab === "exceptions" && <Exceptions key={`e${refreshKey}`} tz={tz} deptName={deptName} />}
      {tab === "corrections" && <CorrectionsTab tz={tz} onChanged={() => setRefreshKey((k) => k + 1)} />}
      {tab === "summary" && <SummaryTab key={`s${refreshKey}`} tz={tz} org={org} />}
      {tab === "shifts" && <ShiftsTab tz={tz} />}
      {tab === "holidays" && <HolidaysTab tz={tz} />}
      {manual && <ManualEntryModal tz={tz} onClose={() => setManual(false)} onSaved={() => { setManual(false); setRefreshKey((k) => k + 1); }} />}
    </>
  );
}

// HR Dashboard click-through: ?date / ?from / ?to must be ISO dates; "attended"
// (present, late or half day) maps to the overview's "present_any" filter.
const isoDate = (v) => (/^d{4}-d{2}-d{2}$/.test(v ?? "") ? v : null);

function useFiltered(rows, f) {
  return useMemo(() => {
    const s = f.search?.trim().toLowerCase();
    return (rows ?? []).filter((r) =>
      (!f.department || r.employee?.department_id === f.department)
      && (!s || fullName(r.employee).toLowerCase().includes(s) || r.employee?.employee_code?.toLowerCase().includes(s)));
  }, [rows, f.department, f.search]);
}

function LateArrivals({ tz, org, deptName }) {
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const today = businessToday(tz);
  const [params] = useSearchParams();
  const [f, setF] = useState(() => ({ from: isoDate(params.get("from")) ?? addDays(today, -6), to: isoDate(params.get("to")) ?? today, department: params.get("department") ?? "", search: "" }));
  const invalid = !f.from || !f.to || f.to < f.from;
  const q = useHrQuery(() => (invalid ? Promise.resolve({ data: [], error: null }) : listAttendance({ from: f.from, to: f.to })), [f.from, f.to, invalid]);
  const all = useFiltered(q.data, f);
  const rows = useMemo(() => all.filter((r) => r.late_minutes > 0), [all]);
  const repeat = useMemo(() => {
    const m = {};
    for (const r of rows) m[r.employee_id] = (m[r.employee_id] ?? 0) + 1;
    return m;
  }, [rows]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: typeof e === "string" ? e : e.target.value }));
  return (
    <>
      <Toolbar>
        <Field label="From" className="sm:w-44"><Input type="date" value={f.from} max={today} onChange={set("from")} /></Field>
        <Field label="To" className="sm:w-44" error={invalid ? "Must be on or after From." : undefined}><Input type="date" value={f.to} max={today} onChange={set("to")} /></Field>
        <Field label="Department" className="sm:w-48"><Select placeholder="All departments" value={f.department} onChange={set("department")} options={toOptions(org.data?.departments, "name", "id", { activeOnly: false })} /></Field>
        <div className="flex flex-1 items-end gap-2 self-stretch sm:self-end">
          <SearchInput value={f.search} onChange={set("search")} placeholder="Search name or ID…" label="Search employees" />
          {hasPermission("attendance.export") && (
            <Button variant="secondary" disabled={!rows.length} onClick={() => { exportCsv(`late-arrivals-${f.from}-to-${f.to}`, rows, csvColumns(tz, deptName)); notify(`Exported ${rows.length} rows.`); }}>
              <Download className="h-4 w-4" aria-hidden="true" />Export CSV
            </Button>
          )}
        </div>
      </Toolbar>
      <DataTable caption="Late arrivals" rows={rows} loading={q.loading} error={q.error} onRetry={q.reload} pageSize={50}
        emptyTitle="No late arrivals" emptyDescription="Nobody checked in after their shift grace period in this range."
        columns={[
          { key: "work_date", header: "Date", sortable: true, render: (r) => formatDate(r.work_date, { weekday: "short", day: "2-digit", month: "short" }) },
          { key: "employee", header: "Employee", sortable: true, sortValue: (r) => fullName(r.employee).toLowerCase(), render: (r) => <EmployeeCell e={r.employee} /> },
          { key: "check_in_at", header: "Checked in", render: (r) => formatTime(r.check_in_at, tz) },
          { key: "expected", header: "Shift start", render: (r) => formatTime(r.expected_start_at, tz) },
          { key: "late_minutes", header: "Late by", sortable: true, render: (r) => minutesToHm(r.late_minutes) },
          { key: "times", header: "Late days in range", sortValue: (r) => repeat[r.employee_id], sortable: true, render: (r) => <Badge tone={repeat[r.employee_id] >= 3 ? "red" : "amber"}>{repeat[r.employee_id]}</Badge> },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
        ]} />
    </>
  );
}

function Exceptions({ tz, deptName }) {
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const today = businessToday(tz);
  const [range, setRange] = useState({ from: addDays(today, -13), to: addDays(today, -1) });
  const [marking, setMarking] = useState(false);
  const open = useHrQuery(() => listOpenPunches(today), [today]);
  const invalid = !range.from || !range.to || range.to < range.from;
  const absent = useHrQuery(() => (invalid ? Promise.resolve({ data: [], error: null }) : listAttendance({ from: range.from, to: range.to })), [range.from, range.to, invalid]);
  const recorded = useMemo(() => (absent.data ?? []).filter((r) => r.status === "absent" || r.status === "missing_punch"), [absent.data]);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-[#101a3a]">Open punches (checked in, never checked out)</h3>
            <p className="text-xs text-slate-500">Past dates only. Marking them sets status "missing punch" and notifies each employee to request a correction.</p>
          </div>
          {hasPermission("attendance.manage") && <Button variant="secondary" onClick={() => setMarking(true)}><AlertTriangle className="h-4 w-4" aria-hidden="true" />Mark missing punches</Button>}
        </div>
        <DataTable caption="Open punches" rows={open.data} loading={open.loading} error={open.error} onRetry={open.reload}
          emptyTitle="No open punches" emptyDescription="Every past check-in has a check-out."
          columns={[
            { key: "work_date", header: "Date", render: (r) => formatDate(r.work_date) },
            { key: "employee", header: "Employee", render: (r) => <EmployeeCell e={r.employee} /> },
            { key: "dept", header: "Department", render: (r) => deptName(r.employee?.department_id) || "—" },
            { key: "in", header: "Checked in", render: (r) => formatTime(r.check_in_at, tz) },
            { key: "expected_end", header: "Shift end", render: (r) => formatTime(r.expected_end_at, tz) },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          ]} />
      </section>
      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-[#101a3a]">Recorded absences and missing punches</h3>
            <p className="text-xs text-slate-500">Only days with an attendance record. Days with no record at all are not computed in the browser.</p>
          </div>
          <div className="flex gap-2">
            <Field label="From"><Input type="date" value={range.from} max={today} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
            <Field label="To" error={invalid ? "Invalid range." : undefined}><Input type="date" value={range.to} max={today} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
          </div>
        </div>
        <DataTable caption="Recorded absences" rows={recorded} loading={absent.loading} error={absent.error} onRetry={absent.reload}
          emptyTitle="No recorded absences or missing punches"
          columns={[
            { key: "work_date", header: "Date", render: (r) => formatDate(r.work_date) },
            { key: "employee", header: "Employee", render: (r) => <EmployeeCell e={r.employee} /> },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "source", header: "Source", render: (r) => r.source },
            { key: "notes", header: "Notes", render: (r) => <span className="line-clamp-2 max-w-xs">{r.notes || "—"}</span> },
          ]} />
      </section>
      {marking && <MarkMissingModal today={today} onClose={() => setMarking(false)} onDone={(n, d) => { setMarking(false); open.reload(); absent.reload(); notify(`${n} record(s) on ${formatDate(d)} marked as missing punch.`); }} />}
    </div>
  );
}

function MarkMissingModal({ today, onClose, onDone }) {
  const [date, setDate] = useState(addDays(today, -1));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!date || date >= today) { setError("Choose a past date."); return; }
    setBusy(true); setError(null);
    const res = await markMissingPunches(date);
    setBusy(false);
    if (res.error) setError(res.error); else onDone(res.data ?? 0, date);
  }
  return (
    <Modal open onClose={onClose} title="Mark missing punches" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Mark and notify</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-700">Every attendance record on this date with a check-in but no check-out will be set to <strong>missing punch</strong>, and each employee will be notified.</p>
        <Field label="Date" required><Input type="date" value={date} max={addDays(today, -1)} onChange={(e) => setDate(e.target.value)} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function ManualEntryModal({ tz, onClose, onSaved }) {
  const { notify } = useToast();
  const { hr } = useAuth();
  const employees = useEmployeeOptions();
  const today = businessToday(tz);
  const [v, setV] = useState({ employee: "", date: today, inTime: "", outTime: "", status: "absent", note: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const overnight = v.inTime && v.outTime && v.outTime <= v.inTime;
  const options = (employees.data ?? []).filter((o) => o.value !== hr?.employee?.id);

  async function save() {
    const errs = {};
    if (!v.employee) errs.employee = "Choose an employee.";
    if (!v.date) errs.date = "Choose the date."; else if (v.date > today) errs.date = "Cannot be in the future.";
    if (v.outTime && !v.inTime) errs.inTime = "A check-out needs a check-in.";
    if (v.note.trim().length < 3) errs.note = "Explain the manual entry (at least 3 characters).";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await upsertManualAttendance({
      employee: v.employee, workDate: v.date, note: v.note, status: v.status,
      checkIn: v.inTime ? zonedIso(v.date, v.inTime, tz) : null,
      checkOut: v.outTime ? zonedIso(overnight ? addDays(v.date, 1) : v.date, v.outTime, tz) : null,
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(`Attendance saved: ${String(res.data?.status ?? "").replace(/_/g, " ")}.`);
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="Manual attendance entry" size="md"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save entry</Button></>}>
      {employees.error ? <ErrorState message={employees.error} onRetry={employees.reload} /> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Employee" required error={errors.employee} className="sm:col-span-2" hint="You cannot edit your own attendance.">
            <Select placeholder={employees.loading ? "Loading…" : "Choose employee"} value={v.employee} onChange={set("employee")} options={options} />
          </Field>
          <Field label="Date" required error={errors.date}><Input type="date" value={v.date} max={today} onChange={set("date")} /></Field>
          <div className="hidden sm:block" />
          <Field label={`Check-in (${tz})`} error={errors.inTime}><Input type="time" value={v.inTime} onChange={set("inTime")} /></Field>
          <Field label={`Check-out (${tz})`} hint={overnight ? "Earlier than check-in: treated as the next day." : undefined}><Input type="time" value={v.outTime} onChange={set("outTime")} /></Field>
          {!v.inTime && (
            <Field label="Status (no punch times)" className="sm:col-span-2" hint="With punch times, the status is calculated by the server.">
              <Select value={v.status} onChange={set("status")} options={MANUAL_NO_PUNCH_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} />
            </Field>
          )}
          <Field label="Note" required error={errors.note} className="sm:col-span-2"><Textarea value={v.note} maxLength={1000} onChange={set("note")} /></Field>
          <p className="text-xs text-slate-500 sm:col-span-2">This replaces any existing record for that employee and date, and is recorded in the audit log.</p>
        </div>
      )}
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}
