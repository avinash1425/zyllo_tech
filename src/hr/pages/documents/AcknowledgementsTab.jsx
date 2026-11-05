// Acknowledgement tracking (policies + documents): pending / completed,
// policy-wise and employee-wise status, reminder status and throttled
// reminders. An acknowledgement records receipt; it is not a signature.
import { useState } from "react";
import { BellRing } from "lucide-react";
import { formatDateTime, useHrQuery } from "@/lib/hr/client";
import { acknowledgementTracker, cleanFilters, listPolicies, sendAcknowledgementReminders } from "@/lib/hr/documentCenter";
import { toOptions, useOrg } from "@/lib/hr/org";
import { Badge, Button, Card, ConfirmDialog, DataTable, ErrorState, KpiCard, Select, Tabs, Toolbar, useToast } from "@/hr/ui";

export default function AcknowledgementsTab({ employees, canManage }) {
  const { notify } = useToast();
  const org = useOrg();
  const policies = useHrQuery(() => listPolicies({ status: "published" }), []);
  const [f, setF] = useState({ subject_type: "", policy: "", employee: "", department: "", status: "" });
  const [view, setView] = useState("by_item");
  const [remind, setRemind] = useState(null);   // { policy?, document?, employee?, label }
  const q = useHrQuery(() => acknowledgementTracker(cleanFilters(f)), [JSON.stringify(f)]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const d = q.data;

  return (
    <>
      <p className="mb-3 text-sm text-slate-600">Employees acknowledge in the Employee Portal (My Documents). An acknowledgement records receipt of a specific version — it is <strong>not</strong> a legally valid digital signature.</p>
      <Toolbar>
        <Select aria-label="Type" className="sm:w-40" placeholder="Policies + documents" value={f.subject_type} onChange={set("subject_type")} options={[{ value: "policy", label: "Policies" }, { value: "document", label: "Documents" }]} />
        <Select aria-label="Policy" className="sm:w-56" placeholder="All policies" value={f.policy} onChange={set("policy")} options={toOptions(policies.data, "title", "id", { activeOnly: false })} />
        <Select aria-label="Employee" className="sm:w-56" placeholder="All employees" value={f.employee} onChange={set("employee")} options={employees ?? []} />
        <Select aria-label="Department" className="sm:w-48" placeholder="All departments" value={f.department} onChange={set("department")} options={toOptions(org.data?.departments, "name", "id", { activeOnly: false })} />
        <Select aria-label="Status" className="sm:w-40" placeholder="Any status" value={f.status} onChange={set("status")} options={[{ value: "pending", label: "Pending" }, { value: "acknowledged", label: "Acknowledged" }]} />
      </Toolbar>
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <KpiCard label="Pending" value={d?.totals?.pending} tone="orange" loading={q.loading && !d} hint="current versions only" />
            <KpiCard label="Acknowledged" value={d?.totals?.acknowledged} tone="green" loading={q.loading && !d} />
          </div>
          <Tabs value={view} onChange={setView} label="Acknowledgement views" tabs={[{ value: "by_item", label: "By policy / document" }, { value: "by_employee", label: "By employee" }, { value: "rows", label: "All records" }]} />
          {view === "by_item" && (
            <DataTable caption="Acknowledgements by item" rowKey={(r) => `${r.subject_type}-${r.item_id}-${r.version}`} rows={d?.by_item} loading={q.loading}
              emptyTitle="Nothing requires acknowledgement" columns={[
                { key: "title", header: "Policy / document", render: (r) => <div><p className="font-semibold text-[#101a3a]">{r.title}</p><p className="text-xs text-slate-500">{r.subject_type} · v{r.version}</p></div> },
                { key: "acknowledged", header: "Acknowledged", sortable: true },
                { key: "pending", header: "Pending", sortable: true, render: (r) => (r.pending ? <Badge tone="amber">{r.pending}</Badge> : <Badge tone="green">0</Badge>) },
                { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => canManage && r.pending > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => setRemind({ [r.subject_type]: r.item_id, label: `${r.pending} pending employee(s) for "${r.title}"` })}><BellRing className="h-4 w-4" aria-hidden="true" />Remind</Button>) },
              ]} />
          )}
          {view === "by_employee" && (
            <DataTable caption="Acknowledgements by employee" rowKey="employee_id" rows={d?.by_employee} loading={q.loading} emptyTitle="No records"
              columns={[
                { key: "employee_name", header: "Employee", render: (r) => <div><p className="font-semibold text-[#101a3a]">{r.employee_name}</p><p className="font-mono text-xs text-slate-500">{r.employee_code}{r.department_name ? ` · ${r.department_name}` : ""}</p></div> },
                { key: "acknowledged", header: "Acknowledged", sortable: true },
                { key: "pending", header: "Pending", sortable: true, render: (r) => (r.pending ? <Badge tone="amber">{r.pending}</Badge> : <Badge tone="green">0</Badge>) },
                { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => canManage && r.pending > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => setRemind({ employee: r.employee_id, label: `${r.pending} pending item(s) for ${r.employee_name}` })}><BellRing className="h-4 w-4" aria-hidden="true" />Remind</Button>) },
              ]} />
          )}
          {view === "rows" && (
            <DataTable caption="Acknowledgement records" rowKey={(r) => `${r.employee_id}-${r.subject_type}-${r.item_id}-${r.version}`} rows={d?.rows} loading={q.loading} emptyTitle="No records"
              columns={[
                { key: "employee_name", header: "Employee", render: (r) => <div><p className="font-semibold text-[#101a3a]">{r.employee_name}</p><p className="font-mono text-xs text-slate-500">{r.employee_code}</p></div> },
                { key: "title", header: "Item", render: (r) => <div><p>{r.title}</p><p className="text-xs text-slate-500">{r.subject_type} · v{r.version}</p></div> },
                { key: "status", header: "Status", render: (r) => <Badge tone={r.status === "acknowledged" ? "green" : "amber"}>{r.status}</Badge> },
                { key: "acknowledged_at", header: "Acknowledged", render: (r) => formatDateTime(r.acknowledged_at) },
                { key: "last_reminded_at", header: "Reminders", render: (r) => (r.reminder_count ? `${r.reminder_count} · last ${formatDateTime(r.last_reminded_at)}` : "—") },
              ]} />
          )}
        </>
      )}
      <ConfirmDialog open={Boolean(remind)} onClose={() => setRemind(null)} title="Send acknowledgement reminders" confirmLabel="Send"
        message={remind ? `Send an in-app reminder to ${remind.label}? Employees reminded recently are skipped (see Expiry & reminders → settings).` : ""}
        onConfirm={async () => {
          const res = await sendAcknowledgementReminders({ policy: remind.policy ?? null, document: remind.document ?? null, employee: remind.employee ?? null });
          if (!res.error) { notify(res.data ? `${res.data} reminder(s) sent.` : "Everyone pending was reminded recently; nothing sent."); q.reload(); }
          return res;
        }} />
      {!canManage && <Card className="mt-4"><p className="text-sm text-slate-600">Reminders are sent by HR users with document management access.</p></Card>}
    </>
  );
}
