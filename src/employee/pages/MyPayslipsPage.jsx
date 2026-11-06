// Employee self-service: "My Payroll & Payslips".
//   Overview · Payslips (view / PDF / print / query) · Salary details ·
//   Earnings & deductions (financial year, month by month) · Payment history ·
//   Tax documents (annual tax statement PDF, Form 16 and declarations) ·
//   Requests (payroll queries + salary-related HR requests + claims) ·
//   Bank account.
// RLS and SECURITY DEFINER RPCs return only the caller's own data; every
// amount was computed by the server — this page only displays and adds up.
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileDown, Landmark, MessageSquareWarning, Printer } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, formatMoney, useHrQuery } from "@/lib/hr/client";
import { listMyPayrollQueries, listMyPayslips, myBankAccounts, myPayrollPayments, mySalaryStructure } from "@/lib/hr/payroll";
import { availableFinancialYears, financialYearOf, fyLabel, summarizePayments, summarizeYear } from "@/lib/hr/payrollSummary";
import { downloadPayslipPdf } from "@/lib/hr/payslipPdf";
import {
  Badge, Button, Card, DataTable, EmptyState, ErrorState, Loading, Modal, PageHeader, Select, Tabs, useToast,
} from "@/hr/ui";
import PayrollOverview from "@/employee/payroll/PayrollOverview";
import EarningsDeductions from "@/employee/payroll/EarningsDeductions";
import PaymentHistory from "@/employee/payroll/PaymentHistory";
import TaxDocuments from "@/employee/payroll/TaxDocuments";
import SalaryRequests, { QueryModal } from "@/employee/payroll/SalaryRequests";
import { PAY_TONE, label, monthOf, payLabel, period, useCompany } from "@/employee/payroll/shared";

const TAB_KEYS = ["overview", "payslips", "salary", "earnings", "payments", "tax", "requests", "bank"];

export default function MyPayslipsPage() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const [params, setParams] = useSearchParams();
  const [tab, setTabState] = useState(() => (TAB_KEYS.includes(params.get("tab")) ? params.get("tab") : "overview"));
  const setTab = (t) => { setTabState(t); setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; }, { replace: true }); };
  const slips = useHrQuery(() => listMyPayslips(me), [me]);
  const payments = useHrQuery(() => (me ? myPayrollPayments() : Promise.resolve({ data: [] })), [me]);
  const queries = useHrQuery(() => listMyPayrollQueries(me), [me]);
  const company = useCompany();
  const { notify } = useToast();
  const [open, setOpen] = useState(null);
  const [querying, setQuerying] = useState(null);
  const payBySlip = useMemo(() => Object.fromEntries((payments.data ?? []).map((p) => [p.payslip_id, p])), [payments.data]);

  // Financial year (April–March) shared by the year-based tabs.
  const years = useMemo(() => {
    const ys = availableFinancialYears(slips.data);
    return ys.length ? ys : [financialYearOf(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }))];
  }, [slips.data]);
  const [fyChoice, setFy] = useState(null);
  const fy = fyChoice != null && years.includes(fyChoice) ? fyChoice : years[0];
  const fySummary = useMemo(() => (slips.data ? summarizeYear(slips.data, fy) : null), [slips.data, fy]);
  const fyPayments = useMemo(() => summarizePayments(payments.data, fy), [payments.data, fy]);
  const yearPicker = (
    <div className="w-36 shrink-0">
      <Select aria-label="Financial year" value={String(fy)} onChange={(e) => setFy(Number(e.target.value))} className="py-1 text-sm"
        options={years.map((y) => ({ value: String(y), label: fyLabel(y) }))} />
    </div>
  );

  const latest = slips.data?.[0];
  const self = hr?.employee;
  const employee = {
    ...(self ? { name: self.display_name || [self.first_name, self.last_name].filter(Boolean).join(" "), employee_code: self.employee_code } : {}),
    ...Object.fromEntries(Object.entries(latest?.breakdown?.employee ?? {}).filter(([, v]) => v)),
  };
  const pdf = (slip) => { const p = payBySlip[slip.id]; downloadPayslipPdf(slip, company.data?.value ?? {}, { paymentStatus: p?.status, paymentDate: p?.payment_date }); };
  const openById = (id) => { const s = (slips.data ?? []).find((x) => x.id === id); if (s) setOpen(s); };
  const pendingQueries = (queries.data ?? []).filter((q) => ["submitted", "prepared"].includes(q.status)).length;

  if (!me) return <ErrorState message="Your account is not linked to an employee record." />;
  return (
    <>
      <PageHeader title="My Payroll & Payslips" description="Your salary details, monthly payslips, earnings and deductions, payment history, tax documents and salary-related requests." />
      <Tabs value={tab} onChange={setTab} label="Payroll sections" tabs={[
        { value: "overview", label: "Overview" },
        { value: "payslips", label: "Payslips" },
        { value: "salary", label: "Salary details" },
        { value: "earnings", label: "Earnings & deductions" },
        { value: "payments", label: "Payment history" },
        { value: "tax", label: "Tax documents" },
        { value: "requests", label: "Requests", count: pendingQueries || undefined },
        { value: "bank", label: "Bank account" },
      ]} />
      {tab === "overview" && <PayrollOverview slips={slips} payBySlip={payBySlip} fySummary={fySummary} fyPayments={fyPayments} pendingQueries={pendingQueries}
        onView={setOpen} onPdf={pdf} onQuery={setQuerying} goTab={setTab} />}
      {tab === "payslips" && (
        <Card padded={false}>
          <DataTable caption="My payslips" rows={slips.data} loading={slips.loading} error={slips.error} onRetry={slips.reload} onRowClick={setOpen}
            emptyTitle="No payslips yet" emptyDescription="Payslips appear here once payroll for a period has been finalized."
            columns={[
              { key: "period", header: "Month", render: (r) => <div><p className="font-semibold">{monthOf(r)}</p><p className="text-[11px] text-slate-500">{period(r)}</p></div> },
              { key: "payable_days", header: "Paid days", render: (r) => `${Number(r.payable_days)} / ${Number(r.working_days)}` },
              { key: "gross", header: "Gross", render: (r) => formatMoney(r.gross, r.currency) },
              { key: "total_deductions", header: "Deductions", render: (r) => formatMoney(r.total_deductions, r.currency) },
              { key: "net", header: "Net pay", render: (r) => <strong>{formatMoney(r.net, r.currency)}</strong> },
              { key: "payment", header: "Payment", render: (r) => { const p = payBySlip[r.id]; return p ? <span><Badge tone={PAY_TONE[p.status] ?? "slate"}>{payLabel(p.status)}</Badge>{p.payment_date ? <span className="block text-[11px] text-slate-500">{formatDate(p.payment_date)}</span> : null}</span> : "—"; } },
              { key: "_v", header: <span className="sr-only">Actions</span>, render: (r) => (
                <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()} role="presentation">
                  <Button size="sm" variant="ghost" onClick={() => setOpen(r)}>View</Button>
                  <Button size="sm" variant="ghost" onClick={() => pdf(r)} aria-label={`Download payslip PDF for ${period(r)}`}><FileDown className="h-4 w-4" aria-hidden="true" />PDF</Button>
                  <Button size="sm" variant="ghost" onClick={() => setQuerying(r)}><MessageSquareWarning className="h-4 w-4" aria-hidden="true" />Query</Button>
                </div>) },
            ]} />
          <p className="px-4 py-3 text-xs text-slate-500">PDFs are generated on your device from your secure payroll record; nothing is stored or shared by link. "Paid" means payroll recorded the payment — check your bank statement for the credit.</p>
        </Card>
      )}
      {tab === "salary" && <MySalary />}
      {tab === "earnings" && <EarningsDeductions summary={fySummary} yearPicker={yearPicker} />}
      {tab === "payments" && <PaymentHistory payments={payments} fy={fy} yearPicker={yearPicker} totals={fyPayments} onOpenSlip={openById} />}
      {tab === "tax" && <TaxDocuments me={me} summary={fySummary} yearPicker={yearPicker} employee={employee} company={company.data?.value ?? {}} />}
      {tab === "requests" && <SalaryRequests me={me} queries={queries} />}
      {tab === "bank" && <MyBank />}
      {open && <PayslipModal slip={open} onClose={() => setOpen(null)} onPdf={() => pdf(open)} />}
      {querying && <QueryModal slip={querying} onClose={() => setQuerying(null)} onDone={() => { setQuerying(null); queries.reload(); setTab("requests"); notify("Query sent to the payroll team."); }} />}
    </>
  );
}

function MySalary() {
  const q = useHrQuery(() => mySalaryStructure(), []);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (q.data && q.data.visible === false) return <EmptyState title="Salary details are not shown here" description="Your company has chosen not to show salary structures in the portal. Your payslips show every payment." />;
  const c = q.data?.current;
  const cur = c?.currency || "INR";
  return (
    <div className="flex flex-col gap-4">
      {!c ? <EmptyState title="No salary structure yet" description="Your salary details appear here once payroll has set them up." /> : (
        <Card title={`Current monthly salary (as of ${formatDate(c.as_of)})`}>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><p className="text-xs text-slate-500">Monthly gross</p><p className="text-lg font-extrabold">{formatMoney(c.gross, cur)}</p></div>
            <div><p className="text-xs text-slate-500">Fixed deductions</p><p className="text-lg font-bold">{formatMoney(c.deductions, cur)}</p></div>
            <div><p className="text-xs text-slate-500">Annual gross (×12)</p><p className="text-lg font-bold">{formatMoney(c.annual_gross, cur)}</p></div>
            <div><p className="text-xs text-slate-500">Pay frequency</p><p className="text-lg font-bold capitalize">{c.pay_frequency}</p></div>
          </div>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {(c.lines ?? []).filter((l) => l.applied).map((l) => (
              <li key={l.code} className="flex justify-between gap-2 px-3 py-1.5 text-sm"><span>{l.name}{l.component_type === "variable" ? " (variable)" : ""}</span><span className={`tabular-nums ${l.kind === "deduction" ? "text-red-700" : ""}`}>{l.kind === "deduction" ? "−" : ""}{formatMoney(l.amount, cur)}</span></li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Before loss-of-pay, statutory deductions (PF, ESI, professional tax, TDS) and one-off items, which appear on each payslip.</p>
        </Card>
      )}
      {(q.data?.history ?? []).length > 0 && (
        <Card title="Salary revision history" padded={false}>
          <DataTable caption="Salary history" rows={q.data.history} rowKey="effective_from"
            columns={[
              { key: "effective_from", header: "From", render: (r) => formatDate(r.effective_from) },
              { key: "effective_to", header: "To", render: (r) => (r.effective_to ? formatDate(r.effective_to) : "current") },
              { key: "revision_reason", header: "Reason", render: (r) => r.revision_reason || "—" },
            ]} />
        </Card>
      )}
    </div>
  );
}

/** Modal wrapper with Print and (optionally) PDF download; the printed copy is portalled to <body> so only the payslip prints. */
export function PayslipModal({ slip, employee, onClose, onPdf, title = "Payslip" }) {
  return (
    <Modal open onClose={onClose} title={title} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button>
        <Button variant={onPdf ? "secondary" : "primary"} onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden="true" />Print</Button>
        {onPdf && <Button onClick={onPdf}><FileDown className="h-4 w-4" aria-hidden="true" />Download PDF</Button>}</>}>
      <PayslipView slip={slip} employee={employee} />
      {createPortal(<div className="payslip-print-root"><PayslipView slip={slip} employee={employee} /></div>, document.body)}
      <style>{`
        .payslip-print-root { display: none; }
        @media print {
          @page { size: A4; margin: 14mm; }
          body > *:not(.payslip-print-root) { display: none !important; }
          .payslip-print-root { display: block !important; color: #000; }
          .payslip-print-root * { box-shadow: none !important; }
        }
      `}</style>
    </Modal>
  );
}

function Lines({ title, rows, currency }) {
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b border-slate-300"><th className="py-1.5 text-left font-bold">{title}</th><th className="py-1.5 text-right font-bold">Amount</th></tr></thead>
      <tbody>
        {rows.map((r, i) => <tr key={`${r.code ?? r.label}-${i}`} className="border-b border-slate-100"><td className="py-1">{r.name ?? r.label}</td><td className="py-1 text-right tabular-nums">{formatMoney(r.amount, currency)}</td></tr>)}
        {!rows.length && <tr><td colSpan={2} className="py-1 text-slate-500">None</td></tr>}
      </tbody>
      <tfoot><tr><td className="pt-1.5 font-semibold">Total</td><td className="pt-1.5 text-right font-semibold tabular-nums">{formatMoney(total, currency)}</td></tr></tfoot>
    </table>
  );
}

/** Payslip layout used by employees and by payroll staff (preview of a run item). */
export function PayslipView({ slip, employee }) {
  const company = useCompany();
  const b = slip.breakdown ?? {};
  const c = { ...(company.data?.value ?? {}), ...Object.fromEntries(Object.entries(b.employer ?? {}).filter(([, val]) => val)) };
  const emp = b.employee ?? employee ?? {};
  const cur = slip.currency || "INR";
  const adj = b.adjustments ?? [];
  const earnings = [...(b.earnings ?? []), ...adj.filter((a) => Number(a.amount) > 0).map((a) => ({ label: a.label, amount: Number(a.amount) }))];
  const deductions = [...(b.deductions ?? []), ...adj.filter((a) => Number(a.amount) < 0).map((a) => ({ label: a.label, amount: -Number(a.amount) }))];
  const reimb = (b.reimbursements ?? []).map((r) => ({ label: `Reimbursement · ${label(r.category)} (${formatDate(r.claim_date)})`, amount: r.amount }));
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 text-[#101a3a]" aria-label="Payslip">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <p className="text-lg font-extrabold">{c.legal_name || c.name || "Company"}</p>
          {c.address && <p className="text-xs text-slate-500">{c.address}</p>}
          <p className="text-xs text-slate-500">Payslip for {period(slip)}{b.pay_frequency ? ` · ${b.pay_frequency}` : ""}</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-bold">{emp.name ?? "—"}</p>
          <p className="font-mono text-xs">{emp.employee_code ?? ""}</p>
          <p className="text-xs text-slate-500">{[emp.designation, emp.department].filter(Boolean).join(" · ")}</p>
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-b border-slate-200 py-3 text-xs sm:grid-cols-4">
        <div><dt className="text-slate-500">Working days</dt><dd className="font-semibold">{Number(slip.working_days)}</dd></div>
        <div><dt className="text-slate-500">Paid days</dt><dd className="font-semibold">{Number(slip.payable_days)}</dd></div>
        <div><dt className="text-slate-500">Loss of pay days</dt><dd className="font-semibold">{Number(slip.lop_days)}</dd></div>
        <div><dt className="text-slate-500">Bank account</dt><dd className="font-semibold">{b.bank_account_last4 ? `•••• ${b.bank_account_last4}` : "—"}</dd></div>
      </dl>
      <div className="grid grid-cols-1 gap-6 py-3 sm:grid-cols-2">
        <Lines title="Earnings" rows={earnings} currency={cur} />
        <Lines title="Deductions" rows={deductions} currency={cur} />
      </div>
      {reimb.length > 0 && <div className="border-t border-slate-200 py-3"><Lines title="Reimbursements" rows={reimb} currency={cur} /></div>}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-3">
        <span className="text-sm">Gross {formatMoney(slip.gross, cur)} − Deductions {formatMoney(slip.total_deductions, cur)}{Number(slip.reimbursements) ? ` + Reimbursements ${formatMoney(slip.reimbursements, cur)}` : ""}</span>
        <span className="text-lg font-extrabold">Net pay {formatMoney(slip.net, cur)}</span>
      </div>
      {(b.employer_contributions ?? []).length > 0 && (
        <p className="mt-2 text-xs text-slate-500">Employer contributions (not deducted from pay): {(b.employer_contributions).map((e) => `${e.name} ${formatMoney(e.amount, cur)}`).join(", ")}</p>
      )}
      <p className="mt-3 text-[11px] text-slate-500">This is a system-generated payslip{slip.published_at ? `, released ${formatDateTime(slip.published_at)}` : " (preview — not released)"}. Report discrepancies with the Query button on the payslip.</p>
    </article>
  );
}

function MyBank() {
  const q = useHrQuery(() => myBankAccounts(), []);
  const navigate = useNavigate();
  return (
    <Card title="Salary bank account" actions={
      <Button size="sm" variant="secondary" onClick={() => navigate("/employee/requests?new=profile")}><Landmark className="h-4 w-4" aria-hidden="true" />{q.data?.length ? "Change bank account" : "Add bank details"}</Button>}>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !q.data?.length ? (
        <EmptyState title="No bank account on file" description="The payroll team records your salary account. Raise an HR request to share your bank details securely." />
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
              <div>
                <p className="font-semibold">{a.bank_name}</p>
                <p className="text-sm text-slate-600">{a.account_holder} · <span className="font-mono">•••• {a.account_last4}</span>{a.ifsc ? ` · IFSC ${a.ifsc}` : ""}</p>
              </div>
              <div className="flex gap-1">{a.is_primary && <Badge tone="orange">primary</Badge>}<Badge tone={a.verified ? "green" : "amber"}>{a.verified ? "verified" : "not verified"}</Badge></div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">Only the last four digits are shown. Changes go through a profile change request; payroll verifies the new account before paying into it.</p>
    </Card>
  );
}
