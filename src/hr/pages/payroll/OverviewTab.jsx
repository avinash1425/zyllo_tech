// Payroll overview: every amount comes from payroll records (hr_payroll_overview RPC, payroll.view).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { formatMoney, useHrQuery } from "@/lib/hr/client";
import { toOptions, useEmployeeOptions, useOrg } from "@/lib/hr/org";
import { PAYMENT_STATUSES, RUN_STEPS, payrollOverview } from "@/lib/hr/payroll";
import { Card, DataTable, ErrorState, Field, Input, KpiCard, Select, Toolbar } from "@/hr/ui";
import { PaymentBadge, RunBadge, label, period } from "./shared";

export default function OverviewTab({ onOpenTab }) {
  const navigate = useNavigate();
  const org = useOrg();
  const employees = useEmployeeOptions({ includeInactive: true });
  const [f, setF] = useState({ month: "", legalEntity: "", department: "", employee: "", status: "" });
  const q = useHrQuery(() => payrollOverview({ ...f, month: f.month ? `${f.month}-01` : null }), [f.month, f.legalEntity, f.department, f.employee, f.status]);
  const d = q.data;
  const t = d?.totals ?? {};
  const pay = d?.payments ?? {};
  const pend = d?.pending ?? {};
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const payCount = (s) => pay[s]?.count ?? 0;
  const payAmt = (s) => pay[s]?.amount ?? 0;
  const approvals = [
    ["Runs to submit", pend.runs_to_submit, "runs"], ["Runs to approve", pend.runs_to_approve, "approvals"], ["Runs to finalize", pend.runs_to_finalize, "approvals"],
    ["Salary structures", pend.structures, "approvals"], ["Variable pay entries", pend.adjustments, "approvals"], ["Statutory rules", pend.statutory_rules, "statutory"],
    ["Queries to prepare", pend.corrections_to_prepare, "corrections"], ["Corrections to approve", pend.corrections_to_approve, "approvals"],
    ["Unverified bank accounts", pend.bank_accounts_unverified, "bank"],
  ];

  return (
    <>
      <Toolbar>
        <Field label="Payroll month" className="sm:w-44"><Input type="month" value={f.month} onChange={set("month")} /></Field>
        <Field label="Company" className="sm:w-48"><Select placeholder="All" value={f.legalEntity} onChange={set("legalEntity")} options={toOptions(org.data?.legalEntities)} /></Field>
        <Field label="Department" className="sm:w-48"><Select placeholder="All" value={f.department} onChange={set("department")} options={toOptions(org.data?.departments)} /></Field>
        <Field label="Employee" className="sm:w-56"><Select placeholder="All" value={f.employee} onChange={set("employee")} options={employees.data ?? []} /></Field>
        <Field label="Status" className="sm:w-44"><Select placeholder="Any" value={f.status} onChange={set("status")}
          options={[...RUN_STEPS, ...PAYMENT_STATUSES.filter((s) => !RUN_STEPS.includes(s))].map((s) => ({ value: s, label: label(s) }))} /></Field>
      </Toolbar>
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : (
        <>
          <p className="mb-3 text-sm text-slate-600">Payroll month: <strong>{d ? new Date(`${d.month}T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "…"}</strong></p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Employees in payroll" value={t.employees ?? 0} tone="navy" loading={q.loading} />
            <KpiCard label="Gross payroll" value={formatMoney(t.gross ?? 0)} tone="teal" loading={q.loading} />
            <KpiCard label="Total deductions" value={formatMoney(t.deductions ?? 0)} tone="red" loading={q.loading} />
            <KpiCard label="Net payroll" value={formatMoney(t.net ?? 0)} tone="green" loading={q.loading} hint={Number(t.employer_contributions) ? `+ employer cost ${formatMoney(t.employer_contributions)}` : undefined} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Payments completed" value={payCount("paid") + payCount("reconciled")} hint={formatMoney(Number(payAmt("paid")) + Number(payAmt("reconciled")))} tone="green" loading={q.loading} onClick={() => onOpenTab("payments")} />
            <KpiCard label="Payments pending" value={payCount("pending") + payCount("processing")} hint={formatMoney(Number(payAmt("pending")) + Number(payAmt("processing")))} tone="orange" loading={q.loading} onClick={() => onOpenTab("payments")} />
            <KpiCard label="Partially paid" value={payCount("partially_paid")} tone="orange" loading={q.loading} onClick={() => onOpenTab("payments")} />
            <KpiCard label="Payments failed" value={payCount("failed")} tone="red" loading={q.loading} onClick={() => onOpenTab("payments")} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <Card title="Payroll runs this month" padded={false}>
                <DataTable caption="Payroll runs this month" rows={d?.runs ?? []} loading={q.loading} onRowClick={(r) => navigate(`/hr/payroll/runs/${r.id}`)}
                  emptyTitle="No payroll run for this month" emptyDescription="Create one on the Payroll runs tab."
                  columns={[
                    { key: "period", header: "Period", render: (r) => <span className="font-semibold">{period(r)}</span> },
                    { key: "scope", header: "Scope", render: (r) => r.legal_entity || "All companies" },
                    { key: "status", header: "Status", render: (r) => <RunBadge status={r.status} /> },
                    { key: "payment_status", header: "Payment", render: (r) => (["finalized", "paid"].includes(r.status) ? <PaymentBadge status={r.payment_status} /> : "—") },
                    { key: "employees", header: "Employees", render: (r) => r.employees },
                    { key: "net", header: "Net", render: (r) => <strong>{formatMoney(r.net)}</strong> },
                    { key: "flags", header: "Checks", render: (r) => (r.items_with_errors ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{r.items_with_errors} error(s)</span>
                      : r.items_with_warnings ? <span className="text-xs text-amber-700">{r.items_with_warnings} warning(s)</span> : "—") },
                  ]} />
              </Card>
            </div>
            <Card title="Waiting for action">
              <ul className="divide-y divide-slate-100">
                {approvals.map(([k, v, tab]) => (
                  <li key={k}>
                    <button type="button" onClick={() => onOpenTab(tab)} className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:text-[#1f4693]">
                      <span>{k}</span><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${v ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-500"}`}>{v ?? 0}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">Counts across all payroll months.</p>
            </Card>
          </div>

          {(d?.trend ?? []).length > 0 && (
            <Card title="Net payroll — last 6 months (approved and later)" className="mt-4">
              <ul className="flex flex-col gap-2">
                {d.trend.map((m) => {
                  const max = Math.max(...d.trend.map((x) => Number(x.gross)));
                  return (
                    <li key={m.month} className="grid grid-cols-[6rem_1fr_8rem] items-center gap-3 text-sm">
                      <span className="text-slate-600">{new Date(`${m.month}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</span>
                      <span className="h-2.5 rounded-full bg-slate-100"><span className="block h-2.5 rounded-full bg-[#1f4693]" style={{ width: `${max ? (Number(m.net) / max) * 100 : 0}%` }} /></span>
                      <span className="text-right tabular-nums">{formatMoney(m.net)}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}
