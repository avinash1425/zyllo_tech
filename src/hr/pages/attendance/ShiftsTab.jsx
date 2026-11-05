// Shift management: shift definitions (hr_shifts, RLS settings.manage or
// attendance.manage) and date-effective employee assignments
// (hr_shift_assignments, written only by RPCs that prevent overlaps and
// keep history). An employee's effective shift on a date is: assignment >
// employee's default shift (Employee Management) > company default shift.
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, minutesToHm, useHrQuery } from "@/lib/hr/client";
import { toOptions, useEmployeeOptions } from "@/lib/hr/org";
import {
  DAY_NAMES, assignShift, businessToday, cancelShiftAssignment, describeWeeklyOffRules, endShiftAssignment, listShiftAssignments, listShifts,
  saveShift, shiftHours,
} from "@/lib/hr/attendance";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, ErrorState, Field, InlineError, Input, Modal, SearchInput, Select, Textarea, Toolbar, useToast,
} from "@/hr/ui";
import { EmployeeCell, empLabel } from "./common";

function expectedOf(s) {
  if (s.expected_minutes) return s.expected_minutes;
  const [a, b] = [s.start_time, s.end_time].map((t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; });
  const span = b > a ? b - a : b + 1440 - a;
  return Math.max(span - (s.break_paid ? 0 : s.break_minutes ?? 0), 0);
}

export default function ShiftsTab({ tz }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("attendance.manage") || hasPermission("settings.manage");
  const canAssign = hasPermission("attendance.manage");
  const shifts = useHrQuery(listShifts, []);
  const [editing, setEditing] = useState(null);
  const { notify } = useToast();

  return (
    <div className="flex flex-col gap-6">
      <Card title="Shifts" padded={false} actions={canManage && <Button size="sm" onClick={() => setEditing({})}><Plus className="h-4 w-4" aria-hidden="true" />New shift</Button>}>
        <DataTable caption="Shifts" rows={shifts.data} loading={shifts.loading} error={shifts.error} onRetry={shifts.reload} emptyTitle="No shifts defined"
          emptyDescription="Without shifts, attendance uses 09:00–18:00 with a 10 minute grace period."
          columns={[
            { key: "name", header: "Shift", render: (s) => <div><p className="font-semibold text-[#101a3a]">{s.name}</p>{s.code && <p className="font-mono text-xs text-slate-500">{s.code}</p>}</div> },
            { key: "hours", header: "Hours", render: (s) => <span className="whitespace-nowrap">{shiftHours(s)}</span> },
            { key: "expected", header: "Expected", render: (s) => minutesToHm(expectedOf(s)) },
            { key: "grace", header: "Grace / break", render: (s) => `${s.grace_minutes} min / ${s.break_minutes} min${s.break_paid ? " (paid)" : ""}` },
            { key: "days", header: "Working days", render: (s) => (
              <div className="text-xs">{(s.working_days ?? []).map((d) => DAY_NAMES[d]).join(" ")}{describeWeeklyOffRules(s.weekly_off_rules) && <p className="text-slate-500">{describeWeeklyOffRules(s.weekly_off_rules)}</p>}</div>) },
            { key: "flags", header: "Status", render: (s) => (
              <div className="flex flex-wrap gap-1">{s.is_default && <Badge tone="orange">default</Badge>}{s.active ? <Badge tone="green">active</Badge> : <Badge>inactive</Badge>}</div>) },
            ...(canManage ? [{ key: "_e", header: <span className="sr-only">Actions</span>, render: (s) => <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button> }] : []),
          ]} />
      </Card>
      <Assignments tz={tz} shifts={shifts.data ?? []} canAssign={canAssign} />
      {editing && <ShiftModal shift={editing} onClose={() => setEditing(null)} onSaved={(isNew) => { setEditing(null); shifts.reload(); notify(isNew ? "Shift created." : "Shift updated."); }} />}
    </div>
  );
}

function ShiftModal({ shift, onClose, onSaved }) {
  const isNew = !shift.id;
  const [v, setV] = useState(() => ({
    name: shift.name ?? "", code: shift.code ?? "", description: shift.description ?? "",
    start_time: String(shift.start_time ?? "09:00").slice(0, 5), end_time: String(shift.end_time ?? "18:00").slice(0, 5),
    grace_minutes: shift.grace_minutes ?? 10, break_minutes: shift.break_minutes ?? 60, break_paid: shift.break_paid ?? false,
    early_leave_grace_minutes: shift.early_leave_grace_minutes ?? 10, overtime_after_minutes: shift.overtime_after_minutes ?? "",
    expected_minutes: shift.expected_minutes ?? "", half_day_minutes: shift.half_day_minutes ?? "",
    working_days: shift.working_days ?? [1, 2, 3, 4, 5], weekly_off_rules: shift.weekly_off_rules ?? {},
    is_default: shift.is_default ?? false, active: shift.active ?? true,
  }));
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e?.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e }));
  const toggleDay = (d) => setV((s) => ({ ...s, working_days: s.working_days.includes(d) ? s.working_days.filter((x) => x !== d) : [...s.working_days, d].sort() }));
  const toggleOff = (d, w) => setV((s) => {
    const cur = s.weekly_off_rules?.[d] ?? [];
    const next = cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w].sort();
    const rules = { ...s.weekly_off_rules, [d]: next };
    if (!next.length) delete rules[d];
    return { ...s, weekly_off_rules: rules };
  });
  const overnight = v.end_time && v.start_time && v.end_time <= v.start_time;
  const num = (x) => (x === "" || x == null ? null : Number(x));

  async function save() {
    const errs = {};
    if (!v.name.trim()) errs.name = "Name is required.";
    if (v.code && !/^[A-Z0-9_-]{1,20}$/.test(v.code)) errs.code = "Use A–Z, 0–9, _ or - (max 20).";
    if (!v.start_time) errs.start_time = "Required.";
    if (!v.end_time) errs.end_time = "Required."; else if (v.end_time === v.start_time) errs.end_time = "End must differ from start.";
    for (const [k, lo, hi] of [["grace_minutes", 0, 240], ["break_minutes", 0, 480], ["early_leave_grace_minutes", 0, 240]]) {
      if (v[k] === "" || Number(v[k]) < lo || Number(v[k]) > hi) errs[k] = `Between ${lo} and ${hi}.`;
    }
    if (v.expected_minutes !== "" && (Number(v.expected_minutes) < 1 || Number(v.expected_minutes) > 1440)) errs.expected_minutes = "Between 1 and 1440.";
    if (!v.working_days.length) errs.working_days = "Choose at least one working day.";
    if (v.is_default && !v.active) errs.active = "The default shift must be active.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await saveShift({
      ...(shift.id ? { id: shift.id } : {}),
      name: v.name.trim(), code: v.code || null, description: v.description.trim() || null,
      start_time: v.start_time, end_time: v.end_time, grace_minutes: Number(v.grace_minutes), break_minutes: Number(v.break_minutes),
      break_paid: v.break_paid, early_leave_grace_minutes: Number(v.early_leave_grace_minutes), overtime_after_minutes: num(v.overtime_after_minutes),
      expected_minutes: num(v.expected_minutes), half_day_minutes: num(v.half_day_minutes), working_days: v.working_days,
      weekly_off_rules: Object.fromEntries(Object.entries(v.weekly_off_rules).filter(([d]) => v.working_days.includes(Number(d)))),
      is_default: v.is_default, active: v.active,
    });
    setBusy(false);
    if (res.error) setError(res.error); else onSaved(isNew);
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "New shift" : `Edit shift — ${shift.name}`} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save shift</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Name" required error={errors.name} className="sm:col-span-2"><Input value={v.name} maxLength={80} onChange={set("name")} /></Field>
        <Field label="Code" error={errors.code}><Input value={v.code} maxLength={20} onChange={(e) => setV((s) => ({ ...s, code: e.target.value.toUpperCase() }))} /></Field>
        <Field label="Start" required error={errors.start_time}><Input type="time" value={v.start_time} onChange={set("start_time")} /></Field>
        <Field label="End" required error={errors.end_time} hint={overnight ? "Ends the next day (overnight shift)." : undefined}><Input type="time" value={v.end_time} onChange={set("end_time")} /></Field>
        <Field label="Expected hours (minutes)" error={errors.expected_minutes} hint="Blank = shift length minus unpaid break."><Input type="number" min={1} max={1440} value={v.expected_minutes} onChange={set("expected_minutes")} /></Field>
        <Field label="Late grace (minutes)" required error={errors.grace_minutes}><Input type="number" min={0} max={240} value={v.grace_minutes} onChange={set("grace_minutes")} /></Field>
        <Field label="Break (minutes)" required error={errors.break_minutes}><Input type="number" min={0} max={480} value={v.break_minutes} onChange={set("break_minutes")} /></Field>
        <Field label="Early-leave grace (minutes)" required error={errors.early_leave_grace_minutes}><Input type="number" min={0} max={240} value={v.early_leave_grace_minutes} onChange={set("early_leave_grace_minutes")} /></Field>
        <Field label="Overtime counts after (minutes)" hint="Minutes beyond expected hours before overtime is recorded. Blank = 0."><Input type="number" min={0} max={1440} value={v.overtime_after_minutes} onChange={set("overtime_after_minutes")} /></Field>
        <Field label="Half day below (minutes worked)" hint="Blank = half of expected hours."><Input type="number" min={0} max={1440} value={v.half_day_minutes} onChange={set("half_day_minutes")} /></Field>
        <div className="flex items-end pb-2"><Checkbox label="Break is paid (not deducted)" checked={v.break_paid} onChange={set("break_paid")} /></div>
        <fieldset className="sm:col-span-3">
          <legend className="text-sm font-semibold text-[#173a52]">Working days</legend>
          <div className="mt-1 flex flex-wrap gap-3">{[1, 2, 3, 4, 5, 6, 7].map((d) => <Checkbox key={d} label={DAY_NAMES[d]} checked={v.working_days.includes(d)} onChange={() => toggleDay(d)} />)}</div>
          {errors.working_days && <p className="text-xs font-medium text-red-600" role="alert">{errors.working_days}</p>}
        </fieldset>
        <fieldset className="sm:col-span-3">
          <legend className="text-sm font-semibold text-[#173a52]">Weekly-off rules <span className="font-normal text-slate-500">(optional, e.g. 2nd and 4th Saturday off)</span></legend>
          <div className="mt-1 flex flex-col gap-1">
            {v.working_days.filter((d) => d >= 6).length === 0 && <p className="text-xs text-slate-500">Add Saturday or Sunday as a working day to set alternate weekly offs.</p>}
            {v.working_days.filter((d) => d >= 6).map((d) => (
              <div key={d} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="w-10 font-semibold">{DAY_NAMES[d]}</span>
                {[1, 2, 3, 4, 5].map((w) => <Checkbox key={w} label={`week ${w}`} checked={(v.weekly_off_rules?.[d] ?? []).includes(w)} onChange={() => toggleOff(d, w)} />)}
              </div>
            ))}
          </div>
        </fieldset>
        <Field label="Description" className="sm:col-span-3"><Textarea value={v.description} maxLength={500} onChange={set("description")} /></Field>
        <div className="flex flex-wrap gap-4 sm:col-span-3">
          <Checkbox label="Default shift for employees without one" checked={v.is_default} onChange={set("is_default")} />
          <Checkbox label="Active" checked={v.active} onChange={set("active")} />
        </div>
        {errors.active && <p className="text-xs font-medium text-red-600 sm:col-span-3" role="alert">{errors.active}</p>}
      </div>
      <p className="mt-3 text-xs text-slate-500">Changes apply to attendance recorded from now on. Records already calculated keep their stored values; an approved correction recalculates a day.</p>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function Assignments({ tz, shifts, canAssign }) {
  const { notify } = useToast();
  const today = businessToday(tz);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const q = useHrQuery(() => listShiftAssignments({ activeOnly: !showAll }), [showAll]);
  const [assigning, setAssigning] = useState(false);
  const [ending, setEnding] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const shiftName = (id) => shifts.find((s) => s.id === id)?.name ?? "—";
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((r) => !s || empLabel(r.employee).toLowerCase().includes(s));
  }, [q.data, search]);

  return (
    <Card title="Employee shift assignments" padded={false}
      actions={canAssign && <Button size="sm" onClick={() => setAssigning(true)}><Plus className="h-4 w-4" aria-hidden="true" />Assign shift</Button>}>
      <div className="px-4 pt-3">
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search employee…" label="Search assignments" />
          <div className="flex items-end pb-2"><Checkbox label="Include cancelled" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /></div>
        </Toolbar>
        <p className="mb-2 text-xs text-slate-500">Assignments override the employee's default shift for their dates. Assigning a new open-ended shift ends the current one the day before. Overlaps are rejected.</p>
      </div>
      <DataTable caption="Shift assignments" rows={rows} loading={q.loading} error={q.error} onRetry={q.reload} emptyTitle="No shift assignments"
        emptyDescription="Employees use their default shift (Employee Management) or the company default shift."
        columns={[
          { key: "employee", header: "Employee", render: (r) => <EmployeeCell e={r.employee} /> },
          { key: "shift", header: "Shift", render: (r) => <span>{r.shift?.name ?? shiftName(r.shift_id)}<br /><span className="text-xs text-slate-500">{shiftHours(r.shift)}</span></span> },
          { key: "from", header: "From", render: (r) => formatDate(r.effective_from) },
          { key: "to", header: "To", render: (r) => (r.effective_to ? formatDate(r.effective_to) : <span className="text-slate-500">open-ended</span>) },
          { key: "state", header: "State", render: (r) => (r.status === "cancelled" ? <Badge>cancelled</Badge>
            : r.effective_from > today ? <Badge tone="violet">upcoming</Badge> : r.effective_to && r.effective_to < today ? <Badge>ended</Badge> : <Badge tone="green">current</Badge>) },
          { key: "reason", header: "Reason", render: (r) => <span className="line-clamp-2 max-w-xs">{r.reason || "—"}</span> },
          ...(canAssign ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => r.status === "active" && (
            <div className="flex gap-1">
              {r.effective_from > today
                ? <Button size="sm" variant="ghost" onClick={() => setCancelling(r)}>Cancel</Button>
                : (!r.effective_to || r.effective_to >= today) && <Button size="sm" variant="ghost" onClick={() => setEnding(r)}>End</Button>}
            </div>) }] : []),
        ]} />
      {assigning && <AssignModal tz={tz} shifts={shifts} onClose={() => setAssigning(false)} onSaved={() => { setAssigning(false); q.reload(); notify("Shift assigned."); }} />}
      {ending && <EndModal row={ending} today={today} onClose={() => setEnding(null)} onSaved={() => { setEnding(null); q.reload(); notify("Assignment end date saved."); }} />}
      <ConfirmDialog open={Boolean(cancelling)} onClose={() => setCancelling(null)} title="Cancel upcoming assignment?" tone="danger" confirmLabel="Cancel assignment"
        message={cancelling ? `${empLabel(cancelling.employee)} will not move to ${cancelling.shift?.name ?? "this shift"} on ${formatDate(cancelling.effective_from)}.` : ""}
        requireReason={false} reasonLabel="Reason (optional)"
        onConfirm={async (reason) => {
          const res = await cancelShiftAssignment(cancelling.id, reason);
          if (res.error) return { error: res.error };
          q.reload(); notify("Assignment cancelled.");
          return {};
        }} />
    </Card>
  );
}

function AssignModal({ tz, shifts, onClose, onSaved }) {
  const { hr } = useAuth();
  const employees = useEmployeeOptions();
  const [v, setV] = useState({ employee: "", shift: "", from: businessToday(tz), to: "", reason: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    const errs = {};
    if (!v.employee) errs.employee = "Choose an employee.";
    if (!v.shift) errs.shift = "Choose a shift.";
    if (!v.from) errs.from = "Choose a start date.";
    if (v.to && v.to < v.from) errs.to = "Must be on or after the start date.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await assignShift(v);
    setBusy(false);
    if (res.error) setError(res.error); else onSaved();
  }
  return (
    <Modal open onClose={onClose} title="Assign shift" size="md"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Assign</Button></>}>
      {employees.error ? <ErrorState message={employees.error} onRetry={employees.reload} /> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Employee" required error={errors.employee} className="sm:col-span-2" hint="You cannot change your own shift.">
            <Select placeholder={employees.loading ? "Loading…" : "Choose employee"} value={v.employee} onChange={set("employee")}
              options={(employees.data ?? []).filter((o) => o.value !== hr?.employee?.id)} />
          </Field>
          <Field label="Shift" required error={errors.shift} className="sm:col-span-2">
            <Select placeholder="Choose shift" value={v.shift} onChange={set("shift")} options={toOptions(shifts, (s) => `${s.name} (${shiftHours(s)})`)} />
          </Field>
          <Field label="Effective from" required error={errors.from}><Input type="date" value={v.from} onChange={set("from")} /></Field>
          <Field label="Effective to" error={errors.to} hint="Blank = open-ended."><Input type="date" value={v.to} min={v.from} onChange={set("to")} /></Field>
          <Field label="Reason" className="sm:col-span-2"><Textarea value={v.reason} maxLength={500} onChange={set("reason")} /></Field>
        </div>
      )}
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function EndModal({ row, today, onClose, onSaved }) {
  const [to, setTo] = useState(row.effective_to ?? today);
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!to || to < row.effective_from) { setError("The end date must be on or after the start date."); return; }
    setBusy(true); setError(null);
    const res = await endShiftAssignment(row.id, to, reason);
    setBusy(false);
    if (res.error) setError(res.error); else onSaved();
  }
  return (
    <Modal open onClose={onClose} title="End shift assignment" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-700">{empLabel(row.employee)} · {row.shift?.name} from {formatDate(row.effective_from)}</p>
        <Field label="Last day on this shift" required><Input type="date" value={to} min={row.effective_from} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Reason"><Textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}
