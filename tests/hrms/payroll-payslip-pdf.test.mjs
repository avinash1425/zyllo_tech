// Module 7: payslip PDF generator (pure JS, synthetic data only).
import test from "node:test";
import assert from "node:assert/strict";
import { buildPayslipPdf, pdfMoney, toPdfText, payslipFileName } from "../../src/lib/hr/payslipPdf.js";

const slip = {
  period_start: "2025-08-01", period_end: "2025-08-31", currency: "INR", working_days: 21, payable_days: 20, lop_days: 1,
  gross: 19347.62, total_deductions: 500, reimbursements: 300, net: 19147.62, published_at: "2025-09-01T10:00:00Z",
  breakdown: {
    employee: { name: "Demo Ekam (Test)", employee_code: "ZT-0002", department: "Engineering", designation: "Engineer", joining_date: "2024-01-01" },
    employer: { name: "Synthetic Entity A", legal_name: "Synthetic Entity A Pvt Ltd", address: "1 Example Road, Sample City" },
    earnings: [{ code: "BASIC", name: "Basic Salary", amount: 19047.62 }],
    deductions: [{ code: "OTHER_DEDUCTION", name: "Other Deduction", amount: 500 }],
    adjustments: [{ label: "Referral award", amount: 300 }],
    reimbursements: [{ category: "internet", amount: 300, claim_date: "2025-08-10" }],
    employer_contributions: [{ name: "Provident Fund (employer)", amount: 1000 }],
    statutory: [{ code: "EPF", applied: true }],
    bank_account_last4: "9012",
    validation: { warnings: [{ code: "x", message: "SENTINEL-INTERNAL-NOTE" }] },
  },
};

function text(bytes) { return Buffer.from(bytes).toString("latin1"); }

test("produces a structurally valid PDF with an exact xref table", () => {
  const pdf = text(buildPayslipPdf(slip, {}, { paymentStatus: "paid", paymentDate: "2025-09-01" }));
  assert.ok(pdf.startsWith("%PDF-1.4\n"));
  assert.ok(pdf.trimEnd().endsWith("%%EOF"));
  const startxref = Number(pdf.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(pdf.slice(startxref, startxref + 4), "xref");
  const offsets = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.equal(offsets.length, 7);
  offsets.forEach((off, i) => assert.equal(pdf.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1} offset`));
  const len = Number(pdf.match(/<< \/Length (\d+) >>\nstream\n/)[1]);
  const start = pdf.indexOf("stream\n") + 7;
  assert.equal(pdf.slice(start + len, start + len + 10), "\nendstream");
});

test("contains the payslip content and only ASCII", () => {
  const bytes = buildPayslipPdf(slip);
  assert.ok(bytes.every((b) => b >= 0x0a && b <= 0x7e), "ASCII only");
  const pdf = text(bytes);
  for (const s of ["Synthetic Entity A Pvt Ltd", "Demo Ekam \\(Test\\)", "ZT-0002", "Basic Salary", "Referral award", "INR 19,147.62", "**** 9012", "Loss-of-pay days"]) {
    assert.ok(pdf.includes(s), `missing ${s}`);
  }
  assert.ok(!pdf.includes("SENTINEL-INTERNAL-NOTE"), "internal fields are not printed");
});

test("money and text helpers", () => {
  assert.equal(pdfMoney(1234567.5), "INR 12,34,567.50");
  assert.equal(pdfMoney(-500, "USD"), "-USD 500.00");
  assert.equal(pdfMoney(0), "INR 0.00");
  assert.equal(toPdfText("₹ 5 – “ok” •"), "INR  5 - \"ok\" *");
  assert.equal(payslipFileName(slip, "ZT/0002"), "payslip-ZT0002-2025-08.pdf");
});
