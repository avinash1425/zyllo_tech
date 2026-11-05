// Payroll reports. Every export needs payroll.export and is written to the
// audit log (hr_log_payroll_export) BEFORE the file is produced.
import { useState } from "react";
import { Download } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { exportCsv, formatDateTime, formatMoney, fullName, useHrQuery } from "@/lib/hr/client";
import { listPayments, listRunItems, listRuns, logExport, postFinalizationChanges, statutoryReport } from "@/lib/hr/payroll";
import { Button, Card, DataTable, EmptyState, Field, InlineError, Select, Toolbar, useToast } from "@/hr/ui";
import { label, period } from "./shared";

export default function ReportsTab() {
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const runs = useHrQuery(() => listRuns(), []);
  const [runId, setRunId] = useState("");
  const run = (runs.data ?? []).find((r) => r.id === runId);
  const stat = useHrQuery(() => (runId ? statutoryReport(runId) : Promise.resolve({ data: [] })), [runId]);
  const changes = useHrQuery(() => (runId && run?.finalized_at ? postFinalizationChanges(runId) : Promise.resolve({ data: [] })), [runId, run?.finalized_at]);
  const [error, setError] = useState(null);
  const canExport = hasPermission("payroll.export");

  async function doExport(kind, rowsLoader, columns, file) {
    setError(null);
    const rows = await rowsLoader();
    if (rows.error) { setError(rows.error); return; }
    const audit = await logExport(kind, runId, rows.data.length);
    if (audit.error) { setError(audit.error); return; }
    exportCsv(file, rows.data, columns);
    notify(`Exported ${rows.data.length} row(s). The export was recorded in the audit log.`);
  }

  const REGISTER = [
    { label: "Employee ID", value: (r) => r.employee?.employee_code }, { label: "Employee", value: (r) => fullName(r.employee) }, { label: "Currency", key: "currency" },
    { label: "Working days", key: "working_days" }, { label: "Payable days", key: "payable_days" }, { label: "LOP days", key: "lop_days" },
    { label: "Earnings", value: (r) => (r.breakdown?.earnings ?? []).map((l) => `${l.code}=${l.amount}`).join(" ") },
    { label: "Deductions", value: (r) => (r.breakdown?.deductions ?? []).map((l) => `${l.code}=${l.amount}`).join(" ") },
    { label: "Adjustments", value: (r) => (r.breakdown?.adjustments ?? []).map((l) => `${l.label}=${l.amount}`).join(" | ") },
    { label: "Gross", key: "gross" }, { label: "Total deductions", key: "total_deductions" }, { label: "Employer contributions", key: "employer_contributions" },
    { label: "Reimbursements", key: "reimbursements" }, { label: "Net", key: "net" },
    { label: "Errors", value: (r) => (r.breakdown?.validation?.errors ?? []).map((x) => x.code).join(" ") },
    { label: "Warnings", value: (r) => (r.breakdown?.validation?.warnings ?? []).map((x) => x.code).join(" ") },
  ];

  return (
    <>
      <Toolbar>
        <Field label="Payroll run" className="sm:w-72"><Select placeholder="Choose a run" value={runId} onChange={(e) => setRunId(e.target.value)} options={(runs.data ?? []).map((r) => ({ value: r.id, label: `${period(r)} · ${label(r.status)}` }))} /></Field>
      </Toolbar>
      <InlineError message={error} />
      {!runId ? <EmptyState title="Choose a payroll run" description="Reports are generated from the run's stored payroll records." /> : (
        <div className="flex flex-col gap-4">
          <Card title="Exports" actions={!canExport ? <span className="text-xs text-slate-500">Requires payroll.export</span> : null}>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={!canExport} onClick={() => doExport("payroll_register", () => listRunItems(runId), REGISTER, `payroll-register-${run.period_start}`)}><Download className="h-4 w-4" aria-hidden="true" />Payroll register</Button>
              <Button variant="secondary" disabled={!canExport || !stat.data?.length} onClick={() => doExport("statutory_report", () => statutoryReport(runId), [
                { label: "Rule", key: "rule_code" }, { label: "State", key: "state_code" }, { label: "Employee ID", key: "employee_code" }, { label: "Employee", key: "employee_name" },
                { label: "Contribution base", key: "contribution_base" }, { label: "Employee amount", key: "employee_amount" }, { label: "Employer amount", key: "employer_amount" },
                { label: "Validation reference", key: "validation_reference" }], `statutory-${run.period_start}`)}><Download className="h-4 w-4" aria-hidden="true" />Statutory report</Button>
              <Button variant="secondary" disabled={!canExport || !["finalized", "paid"].includes(run.status)} onClick={() => doExport("payment_status", () => listPayments({ runId }), [
                { label: "Employee ID", value: (r) => r.employee?.employee_code }, { label: "Employee", value: (r) => fullName(r.employee) }, { label: "Net due", key: "amount" },
                { label: "Paid", key: "amount_paid" }, { label: "Status", key: "status" }, { label: "Method", key: "method" }, { label: "Payment date", key: "payment_date" },
                { label: "Reference", key: "reference" }, { label: "Failure reason", key: "failure_reason" }, { label: "Reconciled at", key: "reconciled_at" }], `payments-${run.period_start}`)}><Download className="h-4 w-4" aria-hidden="true" />Payment status</Button>
            </div>
            <p className="mt-2 text-xs text-slate-500">Exports contain confidential salary data. Bank account numbers are never included. Each export is audited (who, when, which run, how many rows).</p>
          </Card>
          <Card title="Statutory contributions" padded={false}>
            <DataTable caption="Statutory contributions" rows={stat.data} rowKey={(r) => `${r.rule_code}-${r.employee_id}`} loading={stat.loading} error={stat.error} onRetry={stat.reload}
              emptyTitle="No statutory contributions" emptyDescription="Only rules approved with a professional validation reference are applied."
              columns={[
                { key: "rule_code", header: "Rule", render: (r) => <span className="font-mono text-xs font-bold">{r.rule_code}{r.state_code ? ` (${r.state_code})` : ""}</span> },
                { key: "employee", header: "Employee", render: (r) => <span>{r.employee_name} <span className="font-mono text-xs text-slate-500">{r.employee_code}</span></span> },
                { key: "contribution_base", header: "Base", render: (r) => formatMoney(r.contribution_base) },
                { key: "employee_amount", header: "Employee", render: (r) => formatMoney(r.employee_amount) },
                { key: "employer_amount", header: "Employer", render: (r) => formatMoney(r.employer_amount) },
              ]} />
          </Card>
          {run?.finalized_at && (
            <Card title="Changed after finalization (raise a correction if pay is affected)" padded={false}>
              <DataTable caption="Changes after finalization" rows={changes.data} rowKey="record_id" loading={changes.loading} error={changes.error} onRetry={changes.reload}
                emptyTitle="No leave or attendance changes since finalization"
                columns={[
                  { key: "change_type", header: "Source", render: (r) => label(r.change_type) },
                  { key: "employee", header: "Employee", render: (r) => <span>{r.employee_name} <span className="font-mono text-xs text-slate-500">{r.employee_code}</span></span> },
                  { key: "detail", header: "Change" },
                  { key: "changed_at", header: "Changed", render: (r) => formatDateTime(r.changed_at) },
                ]} />
            </Card>
          )}
        </div>
      )}
    </>
  );
}
