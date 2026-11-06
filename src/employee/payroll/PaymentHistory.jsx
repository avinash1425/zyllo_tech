// "Payment history" tab: every salary payment payroll recorded against the
// employee's released payslips (hr_my_payroll_payments — own rows only).
import { formatDate, formatMoney } from "@/lib/hr/client";
import { financialYearOf } from "@/lib/hr/payrollSummary";
import { Badge, Card, DataTable } from "@/hr/ui";
import { PAY_TONE, label, monthOf, payLabel } from "./shared";

export default function PaymentHistory({ payments, fy, yearPicker, totals, onOpenSlip }) {
  const rows = (payments.data ?? []).filter((p) => fy == null || financialYearOf(p.period_start) === fy);
  const cur = rows[0]?.currency || "INR";
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Paid to you" value={formatMoney(totals.paid, cur)} />
        <Stat label="Awaiting payment" value={formatMoney(totals.outstanding, cur)} tone={totals.outstanding > 0 ? "text-amber-700" : ""} />
        <Stat label="Payments" value={totals.count} />
        <Stat label="Last paid" value={totals.lastPaid ? formatDate(totals.lastPaid.payment_date) : "—"} />
      </div>
      <Card title="Salary payments" actions={yearPicker} padded={false}>
        <DataTable caption="Salary payment history" rows={payments.data ? rows : payments.data} loading={payments.loading} error={payments.error} onRetry={payments.reload}
          rowKey="payslip_id" onRowClick={onOpenSlip ? (r) => onOpenSlip(r.payslip_id) : undefined}
          emptyTitle="No payments in this period" emptyDescription="Payments appear here once payroll for a month is finalized."
          columns={[
            { key: "period_start", header: "Pay month", render: (r) => <span className="font-semibold">{monthOf(r)}</span> },
            { key: "net", header: "Net pay", render: (r) => formatMoney(r.net, r.currency) },
            { key: "amount_paid", header: "Amount paid", render: (r) => formatMoney(r.amount_paid, r.currency) },
            { key: "status", header: "Status", render: (r) => <Badge tone={PAY_TONE[r.status] ?? "slate"}>{payLabel(r.status)}</Badge> },
            { key: "payment_date", header: "Paid on", render: (r) => (r.payment_date ? formatDate(r.payment_date) : "—") },
            { key: "method", header: "Method", render: (r) => (r.method ? <span className="capitalize">{label(r.method)}</span> : "—") },
          ]} />
        <p className="px-4 py-3 text-xs text-slate-500">
          "Paid" means payroll recorded the payment — check your bank statement for the credit. A partly paid or failed payment is followed up by payroll;
          if it is not resolved, raise a payroll query on that payslip.
        </p>
      </Card>
    </div>
  );
}

function Stat({ label: l, value, tone = "" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
