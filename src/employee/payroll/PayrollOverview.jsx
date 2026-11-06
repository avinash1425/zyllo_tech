// "Overview" tab: latest payslip, this financial year at a glance, things that
// need the employee's attention, and recent months.
import { AlertTriangle, CalendarRange, FileDown, IndianRupee, Landmark, MessageSquareWarning, ReceiptText, Wallet } from "lucide-react";
import { formatDate, formatMoney, useHrQuery } from "@/lib/hr/client";
import { myBankAccounts } from "@/lib/hr/payroll";
import { netChange } from "@/lib/hr/payrollSummary";
import { Badge, Button, Card, DataTable, EmptyState, KpiCard } from "@/hr/ui";
import { PAY_TONE, monthOf, payLabel } from "./shared";

export default function PayrollOverview({ slips, payBySlip, fySummary, fyPayments, pendingQueries, onView, onPdf, onQuery, goTab }) {
  const bank = useHrQuery(() => myBankAccounts(), []);
  const list = slips.data ?? [];
  const latest = list[0];
  const change = netChange(list);
  const cur = latest?.currency || "INR";
  const latestPay = latest ? payBySlip[latest.id] : null;
  const primary = (bank.data ?? []).find((a) => a.is_primary) ?? (bank.data ?? [])[0];
  const alerts = [
    ...Object.values(payBySlip).filter((p) => p.status === "failed").map((p) => ({ key: `f-${p.payslip_id}`, tone: "red", text: `Salary payment for ${monthOf(p)} failed. Payroll will retry; check your bank account details.`, tab: "payments" })),
    ...Object.values(payBySlip).filter((p) => p.status === "partially_paid").map((p) => ({ key: `p-${p.payslip_id}`, tone: "amber", text: `Salary for ${monthOf(p)} is partly paid (${formatMoney(p.amount_paid, p.currency)} of ${formatMoney(p.net, p.currency)}).`, tab: "payments" })),
    ...(bank.data && !bank.data.length ? [{ key: "nobank", tone: "amber", text: "No salary bank account on file. Share your bank details so payroll can pay you.", tab: "bank" }] : []),
    ...(primary && !primary.verified ? [{ key: "unverified", tone: "amber", text: "Your salary bank account is not verified yet. Payroll verifies it before paying.", tab: "bank" }] : []),
    ...(pendingQueries > 0 ? [{ key: "q", tone: "blue", text: `${pendingQueries} payroll quer${pendingQueries === 1 ? "y is" : "ies are"} being looked at.`, tab: "requests" }] : []),
  ];

  if (slips.data && !list.length) {
    return (
      <div className="flex flex-col gap-4">
        <Alerts alerts={alerts} goTab={goTab} />
        <Card><EmptyState icon={ReceiptText} title="No payslips yet" description="Your first payslip appears here once payroll for the month is finalized. Meanwhile you can check your salary details and bank account." /></Card>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Alerts alerts={alerts} goTab={goTab} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Latest net pay" icon={Wallet} loading={slips.loading && !slips.data} value={latest ? formatMoney(latest.net, cur) : "—"}
          hint={latest ? `${monthOf(latest)}${change && change.diff ? ` · ${change.diff > 0 ? "▲" : "▼"} ${formatMoney(Math.abs(change.diff), cur)} vs previous` : ""}` : undefined} />
        <KpiCard label={`Paid · ${fySummary?.label ?? "this year"}`} icon={IndianRupee} tone="green" loading={slips.loading && !slips.data}
          value={formatMoney(fyPayments.paid, cur)} hint={fyPayments.outstanding > 0 ? `${formatMoney(fyPayments.outstanding, cur)} awaiting payment` : "All recorded payments"} onClick={() => goTab("payments")} />
        <KpiCard label="Gross earnings (year)" icon={CalendarRange} tone="navy" loading={slips.loading && !slips.data}
          value={formatMoney(fySummary?.totals.gross ?? 0, cur)} hint={`${fySummary?.totals.payslips ?? 0} payslip(s) · ${fySummary?.label ?? ""}`} onClick={() => goTab("earnings")} />
        <KpiCard label="Tax deducted (TDS, year)" icon={ReceiptText} tone="teal" loading={slips.loading && !slips.data}
          value={formatMoney(fySummary?.tax.tds ?? 0, cur)} hint="See Tax documents" onClick={() => goTab("tax")} />
      </div>

      {latest && (
        <Card title={`Latest payslip · ${monthOf(latest)}`}
          actions={<div className="flex flex-wrap gap-1">
            <Button size="sm" variant="secondary" onClick={() => onView(latest)}>View</Button>
            <Button size="sm" onClick={() => onPdf(latest)}><FileDown className="h-4 w-4" aria-hidden="true" />Download PDF</Button>
            <Button size="sm" variant="ghost" onClick={() => onQuery(latest)}><MessageSquareWarning className="h-4 w-4" aria-hidden="true" />Query</Button>
          </div>}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div><dt className="text-xs text-slate-500">Gross</dt><dd className="text-lg font-bold tabular-nums">{formatMoney(latest.gross, cur)}</dd></div>
            <div><dt className="text-xs text-slate-500">Deductions</dt><dd className="text-lg font-bold tabular-nums text-red-700">{formatMoney(latest.total_deductions, cur)}</dd></div>
            <div><dt className="text-xs text-slate-500">Net pay</dt><dd className="text-lg font-extrabold tabular-nums">{formatMoney(latest.net, cur)}</dd></div>
            <div><dt className="text-xs text-slate-500">Paid days</dt><dd className="text-lg font-bold">{Number(latest.payable_days)} / {Number(latest.working_days)}</dd></div>
            <div><dt className="text-xs text-slate-500">Payment</dt><dd className="mt-1">{latestPay ? <Badge tone={PAY_TONE[latestPay.status] ?? "slate"}>{payLabel(latestPay.status)}</Badge> : "—"}
              {latestPay?.payment_date && <span className="block text-xs text-slate-500">{formatDate(latestPay.payment_date)}</span>}</dd></div>
          </dl>
          {Number(latest.lop_days) > 0 && <p className="mt-3 text-xs text-amber-800">{Number(latest.lop_days)} loss-of-pay day(s) this month. If that looks wrong, raise a query with the leave or attendance reference.</p>}
        </Card>
      )}

      <Card title="Recent months" padded={false} actions={<Button size="sm" variant="ghost" onClick={() => goTab("payslips")}>All payslips</Button>}>
        <DataTable caption="Recent payslips" rows={slips.data ? list.slice(0, 6) : slips.data} loading={slips.loading} error={slips.error} onRetry={slips.reload} onRowClick={onView}
          emptyTitle="No payslips yet"
          columns={[
            { key: "period_start", header: "Month", render: (r) => <span className="font-semibold">{monthOf(r)}</span> },
            { key: "gross", header: "Gross", render: (r) => formatMoney(r.gross, r.currency) },
            { key: "total_deductions", header: "Deductions", render: (r) => formatMoney(r.total_deductions, r.currency) },
            { key: "net", header: "Net pay", render: (r) => <strong>{formatMoney(r.net, r.currency)}</strong> },
            { key: "pay", header: "Payment", render: (r) => { const p = payBySlip[r.id]; return p ? <Badge tone={PAY_TONE[p.status] ?? "slate"}>{payLabel(p.status)}</Badge> : "—"; } },
          ]} />
      </Card>
      {primary && (
        <p className="flex items-center gap-2 text-xs text-slate-500"><Landmark className="h-4 w-4" aria-hidden="true" />Salary is paid to {primary.bank_name} •••• {primary.account_last4}.
          <button type="button" className="font-semibold text-[#1f4693] underline" onClick={() => goTab("bank")}>Bank account</button></p>
      )}
    </div>
  );
}

const ALERT_TONES = { red: "border-rose-200 bg-rose-50 text-rose-900", amber: "border-amber-200 bg-amber-50 text-amber-900", blue: "border-sky-200 bg-sky-50 text-sky-900" };
function Alerts({ alerts, goTab }) {
  if (!alerts.length) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label="Needs your attention">
      {alerts.map((a) => (
        <li key={a.key} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${ALERT_TONES[a.tone]}`}>
          <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{a.text}</span>
          <button type="button" className="text-xs font-semibold underline" onClick={() => goTab(a.tab)}>View</button>
        </li>
      ))}
    </ul>
  );
}
