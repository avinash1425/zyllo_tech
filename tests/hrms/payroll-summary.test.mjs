// Employee Portal — My Payroll & Payslips: financial-year summaries and the
// annual salary & tax statement PDF (pure JS, synthetic data only).
import test from "node:test";
import assert from "node:assert/strict";
import {
  availableFinancialYears, ayLabel, financialYearOf, fyLabel, fyMonths, netChange, slipLines, summarizePayments, summarizeYear, taxBucketOf, TAX_BUCKET_LABELS,
} from "../../src/lib/hr/payrollSummary.js";
import { buildTaxStatementPdf, taxStatementFileName } from "../../src/lib/hr/payslipPdf.js";

const slip = (id, start, { gross, ded, net, reimb = 0, lop = 0, earnings, deductions, adjustments = [], employer = [] }) => ({
  id, period_start: start, period_end: `${start.slice(0, 8)}28`, currency: "INR", gross, total_deductions: ded, reimbursements: reimb, net, lop_days: lop,
  breakdown: { earnings, deductions, adjustments, employer_contributions: employer },
});
const slips = [
  slip("mar", "2026-03-01", { gross: 30000, ded: 2000, net: 28000, earnings: [{ code: "BASIC", name: "Basic", amount: 30000 }], deductions: [{ code: "TDS", name: "Income Tax (TDS)", amount: 2000, statutory_rule: "TDS" }] }),
  slip("apr", "2026-04-01", {
    gross: 50500, ded: 4700, net: 46100, reimb: 300, lop: 1,
    earnings: [{ code: "BASIC", name: "Basic", amount: 30000 }, { code: "HRA", name: "HRA", amount: 20000 }],
    deductions: [{ code: "PF_EMPLOYEE", name: "PF", amount: 1800, statutory_rule: "EPF" }, { code: "PROFESSIONAL_TAX", name: "PT", amount: 200, statutory_rule: "PT" },
      { code: "TDS", name: "Income Tax (TDS)", amount: 2500, statutory_rule: "TDS" }],
    adjustments: [{ label: "Referral award", amount: 500 }, { label: "Laptop recovery", amount: -200 }],
    employer: [{ code: "PF_EMPLOYER", name: "PF (employer)", amount: 1800, statutory_rule: "EPF" }],
  }),
  slip("may", "2026-05-01", {
    gross: 50000, ded: 4500, net: 45500,
    earnings: [{ code: "BASIC", name: "Basic", amount: 30000 }, { code: "HRA", name: "HRA", amount: 20000 }],
    deductions: [{ code: "PF_EMPLOYEE", name: "PF", amount: 1800, statutory_rule: "EPF" }, { code: "PROFESSIONAL_TAX", name: "PT", amount: 200, statutory_rule: "PT" },
      { code: "TDS", name: "Income Tax (TDS)", amount: 2500, statutory_rule: "TDS" }],
  }),
];

test("Indian financial year boundaries", () => {
  assert.equal(financialYearOf("2026-03-31"), 2025);
  assert.equal(financialYearOf("2026-04-01"), 2026);
  assert.equal(financialYearOf(""), null);
  assert.equal(fyLabel(2026), "FY 2026-27");
  assert.equal(fyLabel(2099), "FY 2099-00");
  assert.equal(ayLabel(2026), "AY 2027-28");
  const m = fyMonths(2026);
  assert.equal(m.length, 12);
  assert.deepEqual([m[0].key, m[8].key, m[11].key], ["2026-04", "2026-12", "2027-03"]);
  assert.deepEqual(availableFinancialYears(slips), [2026, 2025]);
});

test("slip lines include one-off adjustments on the right side", () => {
  const l = slipLines(slips[1]);
  assert.ok(l.earnings.some((x) => x.name === "Referral award" && x.amount === 500 && x.adjustment));
  assert.ok(l.deductions.some((x) => x.name === "Laptop recovery" && x.amount === 200 && x.adjustment));
});

test("tax buckets", () => {
  assert.equal(taxBucketOf({ code: "TDS" }), "tds");
  assert.equal(taxBucketOf({ code: "X", statutory_rule: "EPF" }), "pf");
  assert.equal(taxBucketOf({ code: "PROFESSIONAL_TAX" }), "pt");
  assert.equal(taxBucketOf({ code: "LWF_EMPLOYEE", statutory_rule: "LWF" }), "other");
  assert.equal(taxBucketOf({ code: "LOAN" }), null);
  assert.ok(TAX_BUCKET_LABELS.other);
});

test("year summary adds up only that financial year", () => {
  const s = summarizeYear(slips, 2026);
  assert.equal(s.totals.payslips, 2);
  assert.equal(s.totals.gross, 100500);
  assert.equal(s.totals.deductions, 9200);
  assert.equal(s.totals.net, 91600);
  assert.equal(s.totals.reimbursements, 300);
  assert.equal(s.totals.lopDays, 1);
  assert.deepEqual(s.tax, { tds: 5000, pf: 3600, esi: 0, pt: 400, other: 0 });
  assert.equal(s.taxByMonth["2026-04"].tds, 2500);
  const basic = s.earnings.find((r) => r.code === "BASIC");
  assert.equal(basic.total, 60000);
  assert.deepEqual(basic.byMonth, { "2026-04": 30000, "2026-05": 30000 });
  // one-off lines sort after recurring components
  assert.equal(s.earnings.at(-1).name, "Referral award");
  assert.equal(s.employerContributions[0].total, 1800);
  assert.equal(s.months.map((m) => m.key).join(), "2026-04,2026-05");
  assert.equal(summarizeYear(slips, 2025).tax.tds, 2000);
  assert.equal(summarizeYear([], 2026).totals.payslips, 0);
});

test("payment totals and net change", () => {
  const pays = [
    { payslip_id: "a", period_start: "2026-04-01", net: 100, amount_paid: 100, status: "paid", payment_date: "2026-05-01" },
    { payslip_id: "b", period_start: "2026-05-01", net: 100, amount_paid: 40, status: "partially_paid", payment_date: "2026-06-01" },
    { payslip_id: "c", period_start: "2026-06-01", net: 100, amount_paid: 0, status: "failed", payment_date: null },
    { payslip_id: "d", period_start: "2026-07-01", net: 100, amount_paid: 100, status: "reconciled", payment_date: "2026-08-01" },
    { payslip_id: "e", period_start: "2026-01-01", net: 999, amount_paid: 999, status: "paid", payment_date: "2026-02-01" },
  ];
  const t = summarizePayments(pays, 2026);
  assert.equal(t.count, 4);
  assert.equal(t.paid, 240);
  assert.equal(t.outstanding, 60);
  assert.equal(t.failed, 1);
  assert.equal(t.lastPaid.payslip_id, "d");
  assert.equal(summarizePayments(pays).count, 5);
  assert.deepEqual(netChange(slips), { diff: -600, percent: -1.3 });
  assert.equal(netChange(slips.slice(0, 1)), null);
});

test("tax statement PDF is a valid one-page PDF that says it is not Form 16", () => {
  const s = summarizeYear(slips, 2026);
  const bytes = buildTaxStatementPdf(s, { name: "Demo Ekam (Test)", employee_code: "ZT-0002", designation: "Engineer", department: "Engineering" },
    { legal_name: "Synthetic Entity A Pvt Ltd", address: "1 Example Road" }, { fy: s.label, ay: ayLabel(2026), months: fyMonths(2026), buckets: TAX_BUCKET_LABELS });
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  assert.ok(text.includes("SALARY & TAX STATEMENT"));
  assert.ok(text.includes("FY 2026-27"));
  assert.ok(text.includes("INR 5,000.00"), "TDS total");
  assert.ok(text.includes("INR 1,00,500.00"), "gross total with Indian grouping");
  assert.ok(text.includes("not Form 16"));
  // xref offsets point at "N 0 obj"
  const xref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.ok(text.slice(xref).startsWith("xref"));
  assert.equal(taxStatementFileName(2026, "ZT-0002"), "salary-tax-statement-ZT-0002-FY2026-27.pdf");
});
