// Payslip PDF — generated entirely in the browser from the payslip row the
// signed-in user is already allowed to read (RLS). Nothing is uploaded or
// stored, so there is no storage object and no public URL to leak.
//
// Dependency-free: writes a small PDF 1.4 document (A4, standard Helvetica
// fonts, WinAnsi text). Pure functions only (no DOM / supabase imports) so it
// can be unit-tested with `node --test`.

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;

// Helvetica / Helvetica-Bold glyph widths (1/1000 em) for ASCII 32..126 (Adobe AFM).
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/** Replace characters outside printable ASCII with safe equivalents. */
export function toPdfText(value) {
  return String(value ?? "")
    .replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/•/g, "*").replace(/₹/g, "INR ").replace(/ /g, " ")
    .normalize("NFKD").replace(/[^\x20-\x7E]/g, "");
}

export function textWidth(str, size, bold = false) {
  const table = bold ? W_BOLD : W_REG;
  let w = 0;
  for (const ch of toPdfText(str)) w += table[ch.charCodeAt(0) - 32] ?? 556;
  return (w * size) / 1000;
}

const esc = (s) => toPdfText(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const n = (v) => (Math.round(v * 100) / 100).toString();

/** "INR 45,100.00" — Indian digit grouping, currency code (no symbol: not in WinAnsi). */
export function pdfMoney(value, currency = "INR") {
  const num = Number(value ?? 0);
  const neg = num < 0;
  const [int, dec] = Math.abs(num).toFixed(2).split(".");
  const grouped = currency === "INR"
    ? int.replace(/(\d)(?=(\d\d)+\d$)/g, "$1,")
    : int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${currency} ${grouped}.${dec}`;
}

function fmtDate(iso) {
  if (!iso) return "-";
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return "-";
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${String(d).padStart(2, "0")} ${mon} ${y}`;
}

/** Minimal page canvas that records PDF content-stream operators. Origin = top-left. */
class Canvas {
  constructor() { this.ops = []; }
  text(x, y, str, { size = 10, bold = false, color = [0.06, 0.1, 0.23], align = "left" } = {}) {
    const s = toPdfText(str);
    let tx = x;
    if (align === "right") tx = x - textWidth(s, size, bold);
    else if (align === "center") tx = x - textWidth(s, size, bold) / 2;
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${color.map(n).join(" ")} rg ${n(tx)} ${n(PAGE_H - y)} Td (${esc(s)}) Tj ET`);
  }
  line(x1, y1, x2, y2, { width = 0.6, color = [0.8, 0.83, 0.88] } = {}) {
    this.ops.push(`${color.map(n).join(" ")} RG ${width} w ${n(x1)} ${n(PAGE_H - y1)} m ${n(x2)} ${n(PAGE_H - y2)} l S`);
  }
  rect(x, y, w, h, { fill = [0.96, 0.97, 0.98] } = {}) {
    this.ops.push(`${fill.map(n).join(" ")} rg ${n(x)} ${n(PAGE_H - y - h)} ${n(w)} ${n(h)} re f`);
  }
  /** Wrap text to a width; returns the y after the last line. */
  wrap(x, y, str, maxWidth, opts = {}) {
    const size = opts.size ?? 9;
    const words = toPdfText(str).split(/\s+/).filter(Boolean);
    let lineStr = "";
    let cy = y;
    for (const w of words) {
      const trial = lineStr ? `${lineStr} ${w}` : w;
      if (textWidth(trial, size, opts.bold) > maxWidth && lineStr) {
        this.text(x, cy, lineStr, opts); cy += size + 3; lineStr = w;
      } else lineStr = trial;
    }
    if (lineStr) { this.text(x, cy, lineStr, opts); cy += size + 3; }
    return cy;
  }
}

/** Serialise one-page content into a complete PDF byte array. */
export function renderPdf(content, { title = "Payslip" } = {}) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Title (${esc(title)}) /Producer (Zyllo Tech HRMS) >>`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character is ASCII (toPdfText), so one char = one byte and the offsets are exact.
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
  return bytes;
}

/**
 * Build the payslip PDF.
 * @param {object} slip     hr_payslips row (breakdown carries employee/employer snapshots)
 * @param {object} [company] hr_settings 'company' value (fallback employer details)
 * @param {object} [extra]  { paymentStatus, paymentDate }
 */
export function buildPayslipPdf(slip, company = {}, extra = {}) {
  const b = slip.breakdown ?? {};
  const emp = b.employee ?? {};
  const er = b.employer ?? {};
  const cur = slip.currency || "INR";
  const adj = b.adjustments ?? [];
  const earnings = [...(b.earnings ?? []).map((l) => [l.name, l.amount]), ...adj.filter((a) => Number(a.amount) > 0).map((a) => [a.label, a.amount])];
  const deductions = [...(b.deductions ?? []).map((l) => [l.name, l.amount]), ...adj.filter((a) => Number(a.amount) < 0).map((a) => [a.label, -Number(a.amount)])];
  const reimb = (b.reimbursements ?? []).map((r) => [`Reimbursement - ${String(r.category).replace(/_/g, " ")} (${fmtDate(r.claim_date)})`, r.amount]);

  const c = new Canvas();
  const right = PAGE_W - MARGIN;
  let y = MARGIN + 6;
  const employerName = er.legal_name || er.name || company.legal_name || company.name || "Company";
  c.text(MARGIN, y + 10, employerName, { size: 15, bold: true });
  c.text(right, y + 10, "PAYSLIP", { size: 15, bold: true, align: "right", color: [0.97, 0.4, 0.02] });
  y += 26;
  const erLines = [er.address || company.address, er.registration_number && `Reg. no. ${er.registration_number}`, er.tax_number && `Tax no. ${er.tax_number}`].filter(Boolean);
  for (const l of erLines) { y = c.wrap(MARGIN, y, l, 300, { size: 8.5, color: [0.35, 0.4, 0.5] }); }
  c.text(right, MARGIN + 34, `Pay period: ${fmtDate(slip.period_start)} - ${fmtDate(slip.period_end)}`, { size: 9, align: "right" });
  c.text(right, MARGIN + 46, `Pay frequency: ${b.pay_frequency || "monthly"}`, { size: 8.5, align: "right", color: [0.35, 0.4, 0.5] });
  y = Math.max(y, MARGIN + 56) + 8;
  c.line(MARGIN, y, right, y, { width: 1, color: [0.12, 0.27, 0.58] });
  y += 16;

  // Employee block
  const col2 = MARGIN + (right - MARGIN) / 2;
  const kv = (x, yy, k, v) => { c.text(x, yy, k, { size: 8, color: [0.4, 0.45, 0.55] }); c.text(x + 92, yy, v || "-", { size: 9, bold: true }); };
  kv(MARGIN, y, "Employee", emp.name); kv(col2, y, "Employee ID", emp.employee_code); y += 14;
  kv(MARGIN, y, "Designation", emp.designation); kv(col2, y, "Department", emp.department); y += 14;
  kv(MARGIN, y, "Date of joining", emp.joining_date ? fmtDate(emp.joining_date) : "-"); kv(col2, y, "Bank account", b.bank_account_last4 ? `**** ${b.bank_account_last4}` : "-"); y += 18;

  // Days
  c.rect(MARGIN, y - 11, right - MARGIN, 22);
  const third = (right - MARGIN) / 3;
  [["Working days", slip.working_days], ["Paid days", slip.payable_days], ["Loss-of-pay days", slip.lop_days]].forEach(([k, v], i) => {
    c.text(MARGIN + 8 + i * third, y + 3, `${k}: `, { size: 8.5, color: [0.4, 0.45, 0.55] });
    c.text(MARGIN + 8 + i * third + textWidth(`${k}: `, 8.5), y + 3, String(Number(v ?? 0)), { size: 9, bold: true });
  });
  y += 26;

  // Earnings | Deductions
  const colW = (right - MARGIN - 16) / 2;
  const table = (x, yy, title, rows) => {
    c.text(x, yy, title, { size: 9.5, bold: true }); c.text(x + colW, yy, "Amount", { size: 9.5, bold: true, align: "right" });
    yy += 5; c.line(x, yy, x + colW, yy, { width: 0.8, color: [0.5, 0.55, 0.62] }); yy += 12;
    let total = 0;
    if (!rows.length) { c.text(x, yy, "None", { size: 9, color: [0.45, 0.5, 0.58] }); yy += 13; }
    for (const [label, amt] of rows) {
      total += Number(amt || 0);
      const lbl = textWidth(label, 9) > colW - 90 ? `${toPdfText(label).slice(0, 40)}...` : label;
      c.text(x, yy, lbl, { size: 9 }); c.text(x + colW, yy, pdfMoney(amt, cur), { size: 9, align: "right" });
      yy += 4; c.line(x, yy, x + colW, yy, { width: 0.3 }); yy += 10;
    }
    c.text(x, yy + 2, "Total", { size: 9.5, bold: true }); c.text(x + colW, yy + 2, pdfMoney(total, cur), { size: 9.5, bold: true, align: "right" });
    return yy + 16;
  };
  const yE = table(MARGIN, y, "Earnings", earnings);
  const yD = table(MARGIN + colW + 16, y, "Deductions", deductions);
  y = Math.max(yE, yD) + 4;
  if (reimb.length) y = table(MARGIN, y, "Reimbursements (not taxable salary)", reimb) + 4;

  // Net
  c.rect(MARGIN, y, right - MARGIN, 40, { fill: [0.12, 0.27, 0.58] });
  const summary = `Gross ${pdfMoney(slip.gross, cur)}  -  Deductions ${pdfMoney(slip.total_deductions, cur)}${Number(slip.reimbursements) ? `  +  Reimbursements ${pdfMoney(slip.reimbursements, cur)}` : ""}`;
  c.text(MARGIN + 10, y + 16, summary, { size: 8.5, color: [1, 1, 1] });
  c.text(right - 10, y + 27, `Net pay ${pdfMoney(slip.net, cur)}`, { size: 14, bold: true, color: [1, 1, 1], align: "right" });
  y += 56;

  const ec = b.employer_contributions ?? [];
  if (ec.length) {
    y = c.wrap(MARGIN, y, `Employer contributions (not deducted from pay): ${ec.map((e) => `${e.name} ${pdfMoney(e.amount, cur)}`).join(", ")}`, right - MARGIN, { size: 8.5, color: [0.3, 0.35, 0.45] }) + 2;
  }
  if ((b.statutory ?? []).some((s) => s.applied)) {
    y = c.wrap(MARGIN, y, "Statutory amounts are calculated from configured rules that were approved with a professional validation reference.", right - MARGIN, { size: 8, color: [0.4, 0.45, 0.55] }) + 2;
  }
  if (extra.paymentStatus) {
    y = c.wrap(MARGIN, y, `Payment status: ${String(extra.paymentStatus).replace(/_/g, " ")}${extra.paymentDate ? ` (${fmtDate(extra.paymentDate)})` : ""}. Recorded by payroll; this document is not proof of a bank transfer.`, right - MARGIN, { size: 8, color: [0.4, 0.45, 0.55] }) + 2;
  }
  c.line(MARGIN, PAGE_H - MARGIN - 22, right, PAGE_H - MARGIN - 22);
  c.wrap(MARGIN, PAGE_H - MARGIN - 10,
    `System-generated payslip${slip.published_at ? `, released ${fmtDate(slip.published_at)}` : " (preview - not released)"}. Generated in your browser from your secure payroll record; no copy is stored. Report discrepancies through Payroll queries.`,
    right - MARGIN, { size: 7.5, color: [0.45, 0.5, 0.58] });

  return renderPdf(c.ops.join("\n"), { title: `Payslip ${fmtDate(slip.period_start)} - ${fmtDate(slip.period_end)}` });
}

export function payslipFileName(slip, code) {
  const ym = String(slip.period_start ?? "").slice(0, 7) || "period";
  return `payslip-${toPdfText(code || "employee").replace(/[^A-Za-z0-9_-]/g, "")}-${ym}.pdf`;
}

/** Browser-only: build and download. */
export function downloadPayslipPdf(slip, company, extra) {
  const bytes = buildPayslipPdf(slip, company, extra);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = payslipFileName(slip, slip.breakdown?.employee?.employee_code);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
