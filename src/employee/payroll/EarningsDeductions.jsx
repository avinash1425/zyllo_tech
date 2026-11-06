// "Earnings & deductions" tab: every pay component, month by month, for one
// financial year (April–March), added up from the employee's released
// payslips. Amounts were computed by payroll; nothing is recalculated here.
import { Fragment } from "react";
import { formatMoney } from "@/lib/hr/client";
import { fyMonths } from "@/lib/hr/payrollSummary";
import { Card, EmptyState } from "@/hr/ui";

export default function EarningsDeductions({ summary, yearPicker }) {
  if (!summary || !summary.totals.payslips) {
    return <Card title="Earnings & deductions" actions={yearPicker}><EmptyState title="No payslips in this financial year" description="Totals appear once a payslip for the year has been released." /></Card>;
  }
  const cur = summary.currency;
  const months = fyMonths(summary.fy).filter((m) => summary.months.some((x) => x.key === m.key));
  const byMonth = Object.fromEntries(summary.months.map((m) => [m.key, m]));
  const money = (v) => (v ? formatMoney(v, cur) : "—");
  const section = (title, rows, totalLabel, totalOf, tone = "") => (
    <Fragment key={title}>
      <tr className="bg-slate-50"><th scope="colgroup" colSpan={months.length + 2} className="px-3 py-1.5 text-left text-xs font-bold uppercase tracking-wide text-slate-600">{title}</th></tr>
      {rows.length === 0 && <tr><td colSpan={months.length + 2} className="px-3 py-1.5 text-slate-500">None</td></tr>}
      {rows.map((r) => (
        <tr key={r.key} className="border-t border-slate-100">
          <th scope="row" className="sticky left-0 bg-white px-3 py-1.5 text-left font-medium">{r.name}{r.adjustment ? <span className="ml-1 text-xs text-slate-500">(one-off)</span> : null}</th>
          {months.map((m) => <td key={m.key} className={`px-3 py-1.5 text-right tabular-nums ${tone}`}>{money(r.byMonth[m.key])}</td>)}
          <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${tone}`}>{formatMoney(r.total, cur)}</td>
        </tr>
      ))}
      {totalOf && (
        <tr className="border-t border-slate-300">
          <th scope="row" className="sticky left-0 bg-white px-3 py-1.5 text-left font-bold">{totalLabel}</th>
          {months.map((m) => <td key={m.key} className={`px-3 py-1.5 text-right font-bold tabular-nums ${tone}`}>{money(totalOf(byMonth[m.key]))}</td>)}
          <td className={`px-3 py-1.5 text-right font-extrabold tabular-nums ${tone}`}>{formatMoney(totalOf(summary.totals), cur)}</td>
        </tr>
      )}
    </Fragment>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Total label="Gross earnings" value={summary.totals.gross} cur={cur} />
        <Total label="Deductions" value={summary.totals.deductions} cur={cur} tone="text-red-700" />
        <Total label="Reimbursements" value={summary.totals.reimbursements} cur={cur} />
        <Total label="Net pay" value={summary.totals.net} cur={cur} strong />
      </div>
      <Card title={`Month-wise breakdown · ${summary.label}`} actions={yearPicker} padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <caption className="sr-only">Earnings and deductions by component and month, {summary.label}</caption>
            <thead>
              <tr className="border-b border-slate-200">
                <th scope="col" className="sticky left-0 bg-white px-3 py-2 text-left font-bold">Component</th>
                {months.map((m) => <th key={m.key} scope="col" className="px-3 py-2 text-right font-bold">{m.label}</th>)}
                <th scope="col" className="px-3 py-2 text-right font-bold">Year total</th>
              </tr>
            </thead>
            <tbody>
              {section("Earnings", summary.earnings, "Gross earnings", (t) => t?.gross)}
              {section("Deductions", summary.deductions, "Total deductions", (t) => t?.deductions, "text-red-700")}
              {Number(summary.totals.reimbursements) > 0 && (
                <tr className="border-t border-slate-200">
                  <th scope="row" className="sticky left-0 bg-white px-3 py-1.5 text-left font-medium">Reimbursements</th>
                  {months.map((m) => <td key={m.key} className="px-3 py-1.5 text-right tabular-nums">{money(byMonth[m.key]?.reimbursements)}</td>)}
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{formatMoney(summary.totals.reimbursements, cur)}</td>
                </tr>
              )}
              <tr className="border-t-2 border-slate-300 bg-orange-50/50">
                <th scope="row" className="sticky left-0 bg-orange-50 px-3 py-2 text-left font-extrabold">Net pay</th>
                {months.map((m) => <td key={m.key} className="px-3 py-2 text-right font-extrabold tabular-nums">{money(byMonth[m.key]?.net)}</td>)}
                <td className="px-3 py-2 text-right font-extrabold tabular-nums">{formatMoney(summary.totals.net, cur)}</td>
              </tr>
              {summary.employerContributions.length > 0 && section("Employer contributions (not deducted from your pay)", summary.employerContributions)}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-xs text-slate-500">
          Added up from {summary.totals.payslips} released payslip{summary.totals.payslips === 1 ? "" : "s"}. Corrections approved after a payslip was
          finalized appear as one-off lines in a later month. {summary.totals.lopDays ? `Loss-of-pay days this year: ${summary.totals.lopDays}.` : ""}
          {summary.mixedCurrency ? " Payslips this year use more than one currency; totals use the first payslip's currency." : ""}
        </p>
      </Card>
    </div>
  );
}

function Total({ label, value, cur, tone = "", strong }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 tabular-nums ${strong ? "text-xl font-extrabold text-[#101a3a]" : "text-lg font-bold"} ${tone}`}>{formatMoney(value, cur)}</p>
    </div>
  );
}
