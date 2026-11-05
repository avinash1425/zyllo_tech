// Module 12 — report exports (CSV / XLSX / PDF) and filter handling. Synthetic data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  analyticsToDoc, buildCsv, buildReportPdf, buildXlsxWorkbook, computeTotals, inferType, plainValue, reportToDoc, safeText, sheetName, PDF_MAX_ROWS,
} from "../../src/lib/hr/reportExport.js";
import { defaultFilters, filtersFromParams, filtersToParams, validateFilters, describeFilters } from "../../src/lib/hr/reportFilters.js";

const report = {
  report: "payroll_summary", title: "Payroll summary", from: "2026-08-01", to: "2026-10-31", scope: "company", generated_at: "2026-11-05T06:30:00Z",
  columns: [{ key: "period", label: "Period" }, { key: "basis", label: "Basis" }, { key: "employees", label: "Employees" },
    { key: "gross", label: "Gross" }, { key: "net", label: "Net" }, { key: "adjustment", label: "Adjustment" }],
  rows: [
    { period: "2026-09-01 – 2026-09-30", basis: "Final", employees: 2, gross: 90000.5, net: 81000, adjustment: -250 },
    { period: "=HYPERLINK(\"http://evil\")", basis: "+cmd|' /C calc'!A0", employees: 1, gross: 52000, net: 46800, adjustment: -5 },
  ],
  total: 2, totals: { employees: 3, gross: 142000.5, net: 127800, adjustment: -255 }, note: "Final = finalized or paid.",
};
const filters = [{ label: "Department", value: "R Operations" }, { label: "Status", value: "approved" }];

test("formula injection is neutralised for text but negative numbers stay numeric", () => {
  assert.equal(safeText("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(safeText("+1+2"), "'+1+2");
  assert.equal(safeText("@cmd"), "'@cmd");
  assert.equal(safeText("-5"), "-5");                 // numeric text is not a formula
  assert.equal(safeText("-1+1"), "'-1+1");
  assert.equal(plainValue(-250, "money"), -250);
  assert.equal(plainValue("-12.5", "num"), -12.5);
  assert.equal(plainValue("=1+1", "text"), "'=1+1");
});

test("CSV carries title, period, timestamp, filters, rows and totals", () => {
  const csv = buildCsv(reportToDoc(report, filters));
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "Report,Payroll summary");
  assert.equal(lines[1], "Reporting period,2026-08-01 to 2026-10-31");
  assert.match(lines[2], /^Generated,2026-11-05 12:00 IST$/);
  assert.match(csv, /Filters,Department: R Operations; Status: approved/);
  assert.match(csv, /Period,Basis,Employees,Gross,Net,Adjustment/);
  assert.match(csv, /,2,90000\.5,81000,-250\r\n/, "numbers unquoted, negative numbers not prefixed");
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/evil""\)"/, "formula text prefixed and quoted");
  assert.match(csv, /'\+cmd\|' \/C calc'!A0/);
  assert.match(csv, /\r\nTotal,,3,142000\.5,127800,-255$/);
});

test("type inference keeps money, dates and percentages typed", () => {
  assert.equal(inferType("gross"), "money");
  assert.equal(inferType("attendance_pct"), "pct");
  assert.equal(inferType("joining_date"), "date");
  assert.equal(inferType("generated_at"), "datetime");
  assert.equal(inferType("employees", [{ employees: 3 }]), "int");
  assert.equal(inferType("employee", [{ employee: "A" }]), "text");
});

test("analytics totals only sum flagged columns", () => {
  const cols = [{ key: "department", type: "text" }, { key: "headcount", type: "int", total: true }, { key: "pct", type: "pct" }];
  assert.deepEqual(computeTotals(cols, [{ department: "A", headcount: 3, pct: 60 }, { department: "B", headcount: 2, pct: 40 }]), { headcount: 5 });
});

test("XLSX keeps numbers, dates and money native and adds metadata + totals", async () => {
  const doc = analyticsToDoc({
    category: "headcount", title: "Headcount", from: "2026-07-01", to: "2026-10-31", generated_at: "2026-11-05T06:30:00Z", scope: "team",
    cards: [{ key: "total_employees", label: "Total employees", value: 11, format: "int" }],
    sections: [{ key: "trend", title: "Monthly headcount trend: [draft]", columns: [
      { key: "month", label: "Month", type: "text" }, { key: "as_of", label: "As of", type: "date" },
      { key: "headcount", label: "Headcount", type: "int" }, { key: "exits", label: "Exits", type: "int", total: true }],
      rows: [{ month: "2026-09", as_of: "2026-09-30", headcount: 10, exits: 1 }, { month: "2026-10", as_of: "2026-10-31", headcount: 11, exits: 2 }] }],
    definitions: [{ metric: "Headcount", formula: "Joined on or before the date and not yet left." }], unavailable: [],
  }, filters);
  const wb = buildXlsxWorkbook(doc, ExcelJS);
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf);
  const summary = back.getWorksheet("Summary");
  assert.equal(summary.getCell("A1").value, "Report");
  assert.equal(summary.getCell("B2").value, "2026-07-01 to 2026-10-31");
  assert.equal(summary.getCell("B4").value, "Your team");
  const ws = back.worksheets[1];
  assert.equal(ws.name, "Monthly headcount trend draft");   // [] removed, <= 31 chars
  assert.equal(ws.getCell("C2").value, 10);
  assert.ok(ws.getCell("B2").value instanceof Date, "date cell is a real date");
  assert.equal(ws.getCell("B2").value.toISOString().slice(0, 10), "2026-09-30");
  assert.equal(ws.getCell("A4").value, "Total");
  assert.equal(ws.getCell("D4").value, 3);
  assert.equal(ws.getCell("C4").value, null, "headcount is not summed");
});

test("sheet names are unique and valid", () => {
  const used = new Set();
  assert.equal(sheetName("Summary", used), "Summary");
  assert.equal(sheetName("Summary", used), "Summary (2)");
  assert.ok(sheetName("x".repeat(60), used).length <= 31);
  assert.equal(sheetName("a/b:c*d?", used), "a b c d");
});

test("PDF is a valid multi-page document with header, all rows and page numbers", () => {
  const rows = Array.from({ length: 180 }, (_, i) => ({ period: `Row ${i + 1}`, basis: i % 2 ? "Final" : "Provisional", employees: i, gross: 1000 + i, net: 900 + i, adjustment: -i }));
  const pdf = buildReportPdf(reportToDoc({ ...report, rows, total: rows.length }, filters));
  assert.match(pdf, /^%PDF-1\.4\n/);
  assert.match(pdf, /%%EOF\n$/);
  const pages = Number(pdf.match(/\/Count (\d+)/)[1]);
  assert.ok(pages >= 3, `expected several pages, got ${pages}`);
  assert.match(pdf, /\(Payroll summary\) Tj/);
  assert.match(pdf, /Reporting period: 2026-08-01 to 2026-10-31/);
  assert.match(pdf, /Filters: Department: R Operations; Status: approved/);
  assert.match(pdf, /\(Row 1\) Tj/);
  assert.match(pdf, /\(Row 180\) Tj/, "every row is in the PDF, not just one screen page");
  assert.match(pdf, new RegExp(`Page ${pages} of ${pages}`));
  assert.match(pdf, /\(Total\) Tj/);
  // xref offsets point at the objects.
  const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(xref, xref + 4), "xref");
  assert.ok([...pdf].every((c) => c.charCodeAt(0) < 128), "standard fonts only");
});

test("PDF refuses oversized reports instead of truncating silently", () => {
  const rows = Array.from({ length: PDF_MAX_ROWS + 1 }, (_, i) => ({ period: String(i) }));
  assert.throws(() => buildReportPdf(reportToDoc({ ...report, rows })), /Use Excel or CSV/);
});

test("filters: URL persistence round-trips and rejects tampered values", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  const f = { ...defaultFilters(), from: "2026-01-01", to: "2026-03-31", department: id, type: "full_time", status: "approved" };
  const p = filtersToParams(f, { tab: "templates", report: "leave_history" });
  assert.equal(p.get("tab"), "templates");
  const back = filtersFromParams(p);
  assert.deepEqual({ ...back }, { ...f });
  const bad = filtersFromParams(new URLSearchParams("from=2026-02-31&department=1;drop&type=Full Time&status=<x>&employee=' or 1=1"));
  assert.equal(bad.from, defaultFilters().from, "invalid calendar date ignored");
  assert.equal(bad.department, "");
  assert.equal(bad.type, "");
  assert.equal(bad.status, "");
  assert.equal(bad.employee, "");
});

test("filters: client validation mirrors the server", () => {
  const ok = { ...defaultFilters(), from: "2026-01-01", to: "2026-06-30" };
  assert.equal(validateFilters(ok), null);
  assert.match(validateFilters({ ...ok, to: "2025-12-31" }), /before the start/);
  assert.match(validateFilters({ ...ok, to: "2027-06-30" }), /at most one year/);
  assert.match(validateFilters({ ...ok, manager: "nope" }), /not valid/);
});

test("filters are described with names for export headers", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  const out = describeFilters({ ...defaultFilters(), department: id, employee: id, type: "intern" },
    { org: { departments: [{ id, name: "R Engineering" }], employmentTypes: [{ code: "intern", name: "Intern" }] }, employees: [{ value: id, label: "Arun Test (ZT-1)" }] });
  assert.deepEqual(out, [{ label: "Department", value: "R Engineering" }, { label: "Employment type", value: "Intern" }, { label: "Employee", value: "Arun Test (ZT-1)" }]);
});
