// Module rules stored in hr_settings: attendance, daily_reports, leave and
// (payroll.manage only) payroll. Reading needs settings.view, saving needs
// settings.manage (RLS). Unknown keys inside each JSON value are preserved.
import { useState } from "react";
import { useAuth } from "@/hr/platform/auth";
import { formatDateTime, from, run, useHrQuery } from "@/lib/hr/client";
import { Card, Checkbox, ErrorState, Field, InlineError, Input, Loading, Select, Button, useToast } from "@/hr/ui";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const intIn = (v, lo, hi) => Number.isInteger(Number(v)) && String(v).trim() !== "" && Number(v) >= lo && Number(v) <= hi;

export default function ModuleRulesSettings({ canEdit }) {
  const { hasPermission } = useAuth();
  const keys = ["attendance", "daily_reports", "leave", ...(hasPermission("payroll.manage") ? ["payroll"] : [])];
  const q = useHrQuery(() => run(from("hr_settings").select("key, value, updated_at").in("key", keys)), [keys.join(",")]);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  const get = (k) => q.data?.find((r) => r.key === k);
  const common = { canEdit, onSaved: q.reload };
  return (
    <div className="flex flex-col gap-4">
      {!canEdit && <p className="text-sm text-slate-600">Read-only: saving module rules requires settings.manage.</p>}
      <AttendanceRules row={get("attendance")} {...common} />
      <DailyReportRules row={get("daily_reports")} {...common} />
      <LeaveRules row={get("leave")} {...common} />
      {keys.includes("payroll") && <PayrollRules row={get("payroll")} {...common} />}
    </div>
  );
}

function useSection(row, onSaved, key, label) {
  const { notify } = useToast();
  const [v, setV] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const val = v ?? row?.value ?? {};
  async function save(next) {
    setBusy(true); setError(null);
    const res = await run(from("hr_settings").update({ value: { ...(row?.value ?? {}), ...next } }).eq("key", key).select("key").single());
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setV(null); onSaved(); notify(`${label} rules saved.`);
  }
  return { val, setV: (patch) => setV({ ...val, ...patch }), error, setError, busy, save, dirty: v !== null };
}

function Section({ title, row, canEdit, s, onSave, children }) {
  if (!row) return <Card title={title}><p className="text-sm text-slate-500">This setting does not exist yet. Apply the module's database migration first.</p></Card>;
  return (
    <Card title={title}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
      <div className="mt-3"><InlineError message={s.error} /></div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">Last updated {formatDateTime(row.updated_at)}</p>
        {canEdit && <Button loading={s.busy} disabled={!s.dirty} onClick={onSave}>Save</Button>}
      </div>
    </Card>
  );
}

function AttendanceRules({ row, canEdit, onSaved }) {
  const s = useSection(row, onSaved, "attendance", "Attendance");
  const { val } = s;
  function onSave() {
    if (!intIn(val.correction_window_days, 0, 365)) return s.setError("Correction window must be a whole number from 0 to 365 days.");
    if (!intIn(val.overnight_checkout_hours, 0, 24)) return s.setError("Overnight check-out tolerance must be a whole number from 0 to 24 hours.");
    return s.save({ correction_window_days: Number(val.correction_window_days), overnight_checkout_hours: Number(val.overnight_checkout_hours) });
  }
  return (
    <Section title="Attendance" row={row} canEdit={canEdit} s={s} onSave={onSave}>
      <Field label="Correction window (days)" hint="How far back employees may request attendance corrections.">
        <Input type="number" min={0} max={365} value={val.correction_window_days ?? ""} disabled={!canEdit} onChange={(e) => s.setV({ correction_window_days: e.target.value })} />
      </Field>
      <Field label="Overnight check-out tolerance (hours)" hint="How long after an overnight shift ends a check-out is still accepted.">
        <Input type="number" min={0} max={24} value={val.overnight_checkout_hours ?? ""} disabled={!canEdit} onChange={(e) => s.setV({ overnight_checkout_hours: e.target.value })} />
      </Field>
    </Section>
  );
}

function DailyReportRules({ row, canEdit, onSaved }) {
  const s = useSection(row, onSaved, "daily_reports", "Daily report");
  const { val } = s;
  const custom = Array.isArray(val.working_days);
  const days = custom ? val.working_days : [];
  function onSave() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(val.reminder_time ?? "")) return s.setError("Reminder time must be HH:MM (24-hour).");
    if (custom && !days.length) return s.setError("Choose at least one working day, or use each employee's shift.");
    return s.save({ reminder_enabled: Boolean(val.reminder_enabled), reminder_time: val.reminder_time, working_days: custom ? [...days].sort() : null });
  }
  return (
    <Section title="Daily work reports" row={row} canEdit={canEdit} s={s} onSave={onSave}>
      <div className="sm:col-span-2"><Checkbox label="Send reminders to employees who have not submitted" checked={val.reminder_enabled !== false} disabled={!canEdit} onChange={(e) => s.setV({ reminder_enabled: e.target.checked })} /></div>
      <Field label="Reminder time (business timezone)" hint="Used by the scheduled reminder job, if one is configured.">
        <Input type="time" value={val.reminder_time ?? ""} disabled={!canEdit} onChange={(e) => s.setV({ reminder_time: e.target.value })} />
      </Field>
      <Field label="Report working days">
        <Select value={custom ? "custom" : "shift"} disabled={!canEdit} onChange={(e) => s.setV({ working_days: e.target.value === "custom" ? [1, 2, 3, 4, 5] : null })}
          options={[{ value: "shift", label: "Each employee's shift / company week" }, { value: "custom", label: "Custom days for everyone" }]} />
      </Field>
      {custom && (
        <fieldset className="sm:col-span-2"><legend className="text-sm font-semibold text-[#173a52]">Days a report is expected</legend>
          <div className="mt-1 flex flex-wrap gap-3">{DAYS.map((d, i) => (
            <Checkbox key={d} label={d} disabled={!canEdit} checked={days.includes(i + 1)}
              onChange={(e) => s.setV({ working_days: e.target.checked ? [...new Set([...days, i + 1])].sort() : days.filter((x) => x !== i + 1) })} />))}</div>
        </fieldset>
      )}
    </Section>
  );
}

function LeaveRules({ row, canEdit, onSaved }) {
  const s = useSection(row, onSaved, "leave", "Leave");
  const { val } = s;
  function onSave() {
    if (!["manager_then_hr", "manager", "hr"].includes(val.approval_flow)) return s.setError("Choose an approval flow.");
    if (!intIn(val.max_backdate_days, 0, 365)) return s.setError("Back-dating limit must be a whole number from 0 to 365 days.");
    if (!intIn(val.max_advance_days, 1, 730)) return s.setError("Advance limit must be a whole number from 1 to 730 days.");
    return s.save({ approval_flow: val.approval_flow, max_backdate_days: Number(val.max_backdate_days), max_advance_days: Number(val.max_advance_days) });
  }
  return (
    <Section title="Leave" row={row} canEdit={canEdit} s={s} onSave={onSave}>
      <Field label="Approval flow" className="sm:col-span-2" hint="Requests from employees without an active manager always go to HR.">
        <Select value={val.approval_flow ?? "manager_then_hr"} disabled={!canEdit} onChange={(e) => s.setV({ approval_flow: e.target.value })}
          options={[{ value: "manager_then_hr", label: "Manager, then HR" }, { value: "manager", label: "Manager only" }, { value: "hr", label: "HR only" }]} />
      </Field>
      <Field label="Apply up to (days in the past)"><Input type="number" min={0} max={365} value={val.max_backdate_days ?? ""} disabled={!canEdit} onChange={(e) => s.setV({ max_backdate_days: e.target.value })} /></Field>
      <Field label="Apply up to (days ahead)"><Input type="number" min={1} max={730} value={val.max_advance_days ?? ""} disabled={!canEdit} onChange={(e) => s.setV({ max_advance_days: e.target.value })} /></Field>
    </Section>
  );
}

function PayrollRules({ row, canEdit, onSaved }) {
  const s = useSection(row, onSaved, "payroll", "Payroll");
  const { val } = s;
  function onSave() {
    if (!["working_days", "calendar_days"].includes(val.proration_basis)) return s.setError("Choose a proration basis.");
    if (!/^[A-Z]{3}$/.test(val.currency ?? "")) return s.setError("Currency must be a 3-letter ISO code (e.g. INR).");
    return s.save({ require_separate_approver: Boolean(val.require_separate_approver), lop_from_attendance: Boolean(val.lop_from_attendance), proration_basis: val.proration_basis, currency: val.currency });
  }
  return (
    <Section title="Payroll" row={row} canEdit={canEdit} s={s} onSave={onSave}>
      <div className="sm:col-span-2 flex flex-col gap-2">
        <Checkbox label="Approver / finalizer must differ from the person who created or calculated the run (recommended)" checked={val.require_separate_approver !== false} disabled={!canEdit} onChange={(e) => s.setV({ require_separate_approver: e.target.checked })} />
        <Checkbox label="Count recorded 'absent' attendance days as loss of pay" checked={Boolean(val.lop_from_attendance)} disabled={!canEdit} onChange={(e) => s.setV({ lop_from_attendance: e.target.checked })} />
      </div>
      <Field label="Proration basis"><Select value={val.proration_basis ?? "working_days"} disabled={!canEdit} onChange={(e) => s.setV({ proration_basis: e.target.value })} options={[{ value: "working_days", label: "Working days" }, { value: "calendar_days", label: "Calendar days" }]} /></Field>
      <Field label="Default currency"><Input maxLength={3} value={val.currency ?? ""} disabled={!canEdit} onChange={(e) => s.setV({ currency: e.target.value.toUpperCase() })} /></Field>
      <p className="text-xs text-slate-500 sm:col-span-2">Changes apply to runs calculated afterwards. Finalized runs are never recalculated.</p>
    </Section>
  );
}
