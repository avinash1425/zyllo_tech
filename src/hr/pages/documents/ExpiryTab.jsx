// Expiry & renewal reminders. Staged schedule (days before the date, 0 = on
// the day), recipients and email opt-in come from the 'documents' settings
// (never hard-coded). The job is hr_run_document_reminders(): run here by
// HR, or by a scheduler with the service role (see docs/hrms/MODULE_9_DOCUMENTS.md).
import { useEffect, useState } from "react";
import { BellRing, PlayCircle, RotateCcw, Save } from "lucide-react";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { expiringDocuments, getDocument } from "@/lib/hr/documents";
import {
  documentSettings, listReminderEmails, listReminderRuns, reminderSchedule, runDocumentReminders, saveDocumentSettings,
} from "@/lib/hr/documentCenter";
import { Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, ErrorState, Field, InlineError, Input, Loading, Select, StatusBadge, Toolbar, useToast } from "@/hr/ui";
import { DocumentDetailModal, ExpiryText } from "@/hr/pages/DocumentsPage";

const daysText = (a) => (Array.isArray(a) ? a.join(", ") : "");
const parseDays = (s) => String(s).split(/[\s,]+/).filter(Boolean).map(Number);

function Settings() {
  const { notify } = useToast();
  const q = useHrQuery(() => documentSettings(), []);
  const [v, setV] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setV({ ...q.data, expiry_reminder_days: daysText(q.data.expiry_reminder_days), renewal_reminder_days: daysText(q.data.renewal_reminder_days) });
  }, [q.data]);
  if (q.loading && !v) return <Card title="Reminder settings"><Loading /></Card>;
  if (q.error) return <Card title="Reminder settings"><ErrorState message={q.error} onRetry={q.reload} /></Card>;
  if (!v) return null;
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  async function save() {
    const exp = parseDays(v.expiry_reminder_days); const ren = parseDays(v.renewal_reminder_days);
    if (exp.some((n) => !Number.isInteger(n) || n < 0 || n > 365) || ren.some((n) => !Number.isInteger(n) || n < 0 || n > 365)) {
      setError("Reminder days must be whole numbers between 0 and 365, separated by commas."); return;
    }
    setBusy(true); setError(null);
    const res = await saveDocumentSettings({
      expiry_reminder_days: exp, renewal_reminder_days: ren, expiring_soon_days: Number(v.expiring_soon_days),
      acknowledgement_reminder_hours: Number(v.acknowledgement_reminder_hours),
      notify_employee: v.notify_employee, notify_hr: v.notify_hr, notify_manager: v.notify_manager, email_reminders: v.email_reminders,
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Reminder settings saved.");
    q.reload();
  }
  return (
    <Card title="Reminder settings" actions={<Button size="sm" loading={busy} onClick={save}><Save className="h-4 w-4" aria-hidden="true" />Save</Button>}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Expiry reminders (days before)" hint="e.g. 30, 15, 7, 0 — 0 means on the expiry date. Categories may override."><Input value={v.expiry_reminder_days} onChange={set("expiry_reminder_days")} /></Field>
        <Field label="Contract renewal reminders (days before)" hint="Sent to HR before a contract's renewal date."><Input value={v.renewal_reminder_days} onChange={set("renewal_reminder_days")} /></Field>
        <Field label="“Expiring soon” window (days)"><Input type="number" min={1} max={365} value={v.expiring_soon_days} onChange={set("expiring_soon_days")} /></Field>
        <Field label="Minimum gap between acknowledgement reminders (hours)"><Input type="number" min={1} max={720} value={v.acknowledgement_reminder_hours} onChange={set("acknowledgement_reminder_hours")} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        <Checkbox label="Notify the employee" checked={Boolean(v.notify_employee)} onChange={set("notify_employee")} />
        <Checkbox label="Notify HR (document managers)" checked={Boolean(v.notify_hr)} onChange={set("notify_hr")} />
        <Checkbox label="Notify the manager (non-confidential, non-compensation)" checked={Boolean(v.notify_manager)} onChange={set("notify_manager")} />
        <Checkbox label="Also email the employee" checked={Boolean(v.email_reminders)} onChange={set("email_reminders")} />
      </div>
      <p className="mt-2 text-xs text-slate-500">In-app notifications are always used. Emails are only queued when enabled; each one shows as “sent” only after the email dispatcher confirms delivery with a configured provider.</p>
      <div className="mt-2"><InlineError message={error} /></div>
    </Card>
  );
}

function ManageView({ canManage, myEmployeeId }) {
  const { notify } = useToast();
  const [days, setDays] = useState("60");
  const [confirm, setConfirm] = useState(false);
  const [selected, setSelected] = useState(null);
  const schedule = useHrQuery(() => reminderSchedule(days), [days]);
  const runs = useHrQuery(() => listReminderRuns(), []);
  const emails = useHrQuery(() => listReminderEmails(), []);
  async function open(id) {
    const res = await getDocument(id);
    if (res.error || !res.data) notify(res.error || "Document not found.", "error"); else setSelected(res.data);
  }
  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <Select aria-label="Window" className="sm:w-56" value={days} onChange={(e) => setDays(e.target.value)}
          options={[{ value: "30", label: "Due within 30 days" }, { value: "60", label: "Due within 60 days" }, { value: "90", label: "Due within 90 days" }, { value: "180", label: "Due within 180 days" }]} />
        <p className="text-sm text-slate-600">Includes already-expired documents.</p>
        <Button className="sm:ml-auto" onClick={() => setConfirm(true)}><PlayCircle className="h-4 w-4" aria-hidden="true" />Run reminders now</Button>
      </Toolbar>
      <DataTable caption="Upcoming expiry and renewal dates" rowKey={(r) => `${r.document_id}-${r.event}`} rows={schedule.data} loading={schedule.loading} error={schedule.error} onRetry={schedule.reload}
        emptyTitle="Nothing due" emptyDescription={`No document expires or needs renewal within ${days} days.`} onRowClick={(r) => open(r.document_id)}
        columns={[
          { key: "employee_name", header: "Employee", render: (r) => <div><p className="font-semibold text-[#101a3a]">{r.employee_name}</p><p className="font-mono text-xs text-slate-500">{r.employee_code}</p></div> },
          { key: "title", header: "Document", render: (r) => <div><p>{r.title}</p><p className="text-xs text-slate-500">{r.category_name}</p></div> },
          { key: "event", header: "Event", render: (r) => <Badge tone={r.event === "renewal" ? "blue" : "slate"}>{r.event}</Badge> },
          { key: "due_date", header: "Date", sortable: true, render: (r) => <ExpiryText date={r.due_date} /> },
          { key: "days_left", header: "Days", sortable: true, render: (r) => <Badge tone={r.days_left < 0 ? "red" : r.days_left <= 7 ? "orange" : "amber"}>{r.days_left < 0 ? `${-r.days_left} ago` : r.days_left === 0 ? "today" : r.days_left}</Badge> },
          { key: "last_stage_sent", header: "Reminders", render: (r) => (
            <div className="text-xs">
              {r.last_stage_sent != null ? <p>last: {r.last_stage_sent === 0 ? "on the day" : `${r.last_stage_sent}-day`} · {formatDateTime(r.last_sent_at)}</p> : <p className="text-slate-500">none sent yet</p>}
              {r.next_stage != null && <p className="text-slate-500">next: {r.next_stage === 0 ? "on the day" : `${r.next_stage} days before`}</p>}
            </div>) },
          { key: "verification_status", header: "Status", render: (r) => <div className="flex flex-col items-start gap-1"><StatusBadge status={r.verification_status} />{r.renewal_request_open && <Badge tone="blue"><RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" />renewal requested</Badge>}</div> },
        ]} />
      {canManage && <Settings />}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Recent reminder runs">
          <p className="mb-2 text-xs text-slate-500">Scheduler status: no production scheduler is configured by this module. Runs appear here when started by HR (“manual”) or by a configured scheduler (“scheduler”).</p>
          <DataTable caption="Reminder runs" rows={runs.data} loading={runs.loading} error={runs.error} onRetry={runs.reload} emptyTitle="No runs yet" pageSize={5}
            columns={[
              { key: "started_at", header: "Run", render: (r) => <div className="text-xs"><p className="font-semibold">{formatDateTime(r.started_at)}</p><p>{r.trigger_source} · as of {formatDate(r.as_of)}</p></div> },
              { key: "reminders", header: "Reminders" },
              { key: "notifications", header: "Notifications" },
              { key: "emails_queued", header: "Emails" },
              { key: "expired_marked", header: "Marked expired" },
            ]} />
        </Card>
        <Card title="Reminder emails (delivery state)">
          <DataTable caption="Reminder emails" rows={emails.data} loading={emails.loading} error={emails.error} onRetry={emails.reload} emptyTitle="No reminder emails" emptyDescription="Email reminders are off, or none were needed." pageSize={5}
            columns={[
              { key: "to_email", header: "To" },
              { key: "status", header: "Status", render: (r) => <div><StatusBadge status={r.status} />{r.last_error && <p className="mt-1 max-w-[14rem] text-xs text-rose-700">{r.last_error}</p>}</div> },
              { key: "created_at", header: "Queued", render: (r) => formatDateTime(r.created_at) },
            ]} />
        </Card>
      </div>
      {selected && <DocumentDetailModal doc={selected} canManage={canManage} myEmployeeId={myEmployeeId} onClose={() => setSelected(null)} onChanged={schedule.reload} />}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Run document reminders" confirmLabel="Run now"
        message="Marks documents past their expiry date as expired, then sends one reminder for each stage reached (per your settings). Stages already sent for the same date are skipped, so running again is safe."
        onConfirm={async () => {
          const res = await runDocumentReminders();
          if (!res.error) { notify(`${res.data.reminders} reminder(s), ${res.data.notifications} notification(s), ${res.data.emails_queued} email(s) queued, ${res.data.expired_marked} marked expired.`); schedule.reload(); runs.reload(); emails.reload(); }
          return res;
        }} />
    </div>
  );
}

/** Read-only view for document viewers / managers (no reminder controls). */
function ViewOnly() {
  const [days, setDays] = useState("30");
  const q = useHrQuery(() => expiringDocuments(days), [days]);
  return (
    <>
      <Toolbar>
        <Select aria-label="Expiring within" className="sm:w-56" value={days} onChange={(e) => setDays(e.target.value)}
          options={[{ value: "30", label: "Expiring within 30 days" }, { value: "60", label: "Expiring within 60 days" }, { value: "90", label: "Expiring within 90 days" }]} />
        <p className="flex items-center gap-1 text-sm text-slate-600"><BellRing className="h-4 w-4" aria-hidden="true" />HR sends the reminders.</p>
      </Toolbar>
      <DataTable caption="Expiring documents" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} rowKey="document_id"
        emptyTitle="Nothing expiring" emptyDescription={`No documents expire within ${days} days.`}
        columns={[
          { key: "employee_name", header: "Employee", render: (r) => <div><p className="font-semibold text-[#101a3a]">{r.employee_name}</p><p className="font-mono text-xs text-slate-500">{r.employee_code}</p></div> },
          { key: "category_name", header: "Category" },
          { key: "title", header: "Title" },
          { key: "expiry_date", header: "Expiry", sortable: true, render: (r) => <ExpiryText date={r.expiry_date} /> },
          { key: "verification_status", header: "Status", render: (r) => <StatusBadge status={r.verification_status} /> },
        ]} />
    </>
  );
}

export default function ExpiryTab({ canManage, myEmployeeId }) {
  return canManage ? <ManageView canManage={canManage} myEmployeeId={myEmployeeId} /> : <ViewOnly />;
}
