// Module 12 — report export builders (CSV, Excel .xlsx, PDF).
//
// Pure functions over one normalised "report document" so every format
// carries the same content: title, reporting period, generation timestamp,
// scope, applied filters, notes, summary cards and tables with totals.
// Runs in the browser and in Node tests (no "@/" imports).
//
// The DATA always comes from public.hr_report_export(), which enforces the
// export permissions on the server and audits the download. Nothing here
// widens what the caller may see.
//
// Safety:
//  * spreadsheet formula injection: text starting with = + - @ TAB CR is
//    prefixed with an apostrophe in CSV and XLSX; real numbers (including
//    negative numbers) are written as numbers, never as text;
//  * numbers, money, percentages and dates keep native types in XLSX and
//    plain machine-readable values in CSV (ISO dates, unformatted numbers);
//  * PDF text is limited to the standard-font character set (sanitizePdfText).
import { sanitizePdfText, textWidth } from "./offerPdf.js";

export const PDF_MAX_ROWS = 5000;

const MONEY_KEYS = new Set(["gross", "deductions", "reimbursements", "net", "employer_contribution", "employer_contributions", "allowances", "cost", "amount", "provisional_gross"]);

/** Infer a column type for report envelopes that do not declare one. */
export function inferType(key, rows = []) {
  if (MONEY_KEYS.has(key)) return "money";
  if (/pct$|_pct|^pct$/.test(key)) return "pct";
  if (/_at$/.test(key)) return "datetime";
  if (/(^|_)date$|^date$|^from$|^to$|^start_date$|^end_date$|^as_of$/.test(key)) return "date";
  const sample = rows.find((r) => r?.[key] !== null && r?.[key] !== undefined)?.[key];
  if (typeof sample === "boolean") return "bool";
  if (typeof sample === "number") return Number.isInteger(sample) ? "int" : "num";
  return "text";
}

const NUMERIC = new Set(["int", "num", "money", "pct"]);
const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

/** Neutralise spreadsheet formula injection for TEXT values. */
export function safeText(v) {
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) && !NUMERIC_TEXT.test(s) ? `'${s}` : s;
}

function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && NUMERIC_TEXT.test(v.trim())) return Number(v);
  return null;
}

/** Sum the columns flagged `total` (or every money/int column when totals is "auto"). */
export function computeTotals(columns, rows) {
  const out = {};
  for (const c of columns) {
    if (!c.total) continue;
    let sum = 0, any = false;
    for (const r of rows) { const n = toNumber(r?.[c.key]); if (n !== null) { sum += n; any = true; } }
    if (any) out[c.key] = c.type === "money" ? Math.round(sum * 100) / 100 : Math.round(sum * 1000) / 1000;
  }
  return out;
}

const pad = (n) => String(n).padStart(2, "0");
function isoDate(v) {
  if (!v) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.slice(0, 10))) return v.slice(0, 10);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isoDateTime(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  // Asia/Kolkata wall time, fixed format (locale independent).
  const ist = new Date(d.getTime() + 330 * 60000);
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())} ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())} IST`;
}

/** Machine-readable value for CSV (numbers stay numbers, dates ISO). */
export function plainValue(v, type) {
  if (v === null || v === undefined || v === "") return "";
  if (NUMERIC.has(type)) { const n = toNumber(v); return n === null ? safeText(v) : n; }
  if (type === "date") return isoDate(v);
  if (type === "datetime") return isoDateTime(v);
  if (type === "bool" || typeof v === "boolean") return v === true || v === "true" ? "Yes" : "No";
  if (typeof v === "object") return safeText(JSON.stringify(v));
  return safeText(v);
}

/** Human-readable value for PDF. */
export function displayValue(v, type, currency = "INR") {
  if (v === null || v === undefined || v === "") return "-";
  const n = toNumber(v);
  if (type === "money" && n !== null) return `${currency} ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (type === "pct" && n !== null) return `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
  if ((type === "int" || type === "num") && n !== null) return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (type === "date") return isoDate(v);
  if (type === "datetime") return isoDateTime(v);
  if (type === "bool" || typeof v === "boolean") return v === true || v === "true" ? "Yes" : "No";
  return String(v);
}

// ------------------------------------------------------------ documents
/**
 * Report document:
 * { title, from, to, generatedAt, scope, currency, filters: [{label, value}], notes: [string],
 *   cards: [{label, value, format, hint}], tables: [{title, columns: [{key, label, type, total}], rows, totals}] }
 */
export function reportToDoc(res, filterLabels = []) {
  const rows = res?.rows ?? [];
  const columns = (res?.columns ?? []).map((c) => ({ key: c.key, label: c.label, type: c.type ?? inferType(c.key, rows) }));
  const totals = res?.totals && Object.keys(res.totals).length ? res.totals : null;
  return {
    title: res?.title ?? "HR report", from: res?.from, to: res?.to, generatedAt: res?.generated_at ?? new Date().toISOString(),
    scope: res?.scope === "team" ? "Your team" : "Company-wide", currency: "INR", filters: filterLabels,
    notes: [res?.note, res?.filters_ignored?.length ? `Filters not applicable to this report: ${res.filters_ignored.join(", ")}` : null].filter(Boolean),
    cards: [], tables: [{ title: res?.title ?? "Report", columns, rows, totals }],
  };
}

export function analyticsToDoc(res, filterLabels = []) {
  const tables = (res?.sections ?? []).map((s) => {
    const columns = (s.columns ?? []).map((c) => ({ ...c, type: c.type ?? inferType(c.key, s.rows) }));
    const totals = computeTotals(columns, s.rows ?? []);
    return { title: s.title, columns, rows: s.rows ?? [], totals: Object.keys(totals).length ? totals : null, note: s.note };
  });
  return {
    title: `HR Reports — ${res?.title ?? ""}`.trim(), from: res?.from, to: res?.to, generatedAt: res?.generated_at ?? new Date().toISOString(),
    scope: res?.scope === "team" ? "Your team" : "Company-wide", currency: res?.currency ?? "INR", filters: filterLabels,
    notes: [
      ...(res?.unavailable ?? []).map((u) => `${u.category}: ${u.reason}`),
      ...(res?.filters_ignored?.length ? [`Filters not applicable: ${res.filters_ignored.join(", ")}`] : []),
      ...(res?.definitions ?? []).map((d) => `${d.metric}: ${d.formula}`),
    ],
    cards: (res?.cards ?? []).map((c) => ({ label: c.label, value: c.value, format: c.format, hint: c.hint })),
    tables,
  };
}

function metaRows(doc) {
  return [
    ["Report", doc.title],
    ["Reporting period", `${isoDate(doc.from)} to ${isoDate(doc.to)}`],
    ["Generated", isoDateTime(doc.generatedAt)],
    ["Scope", doc.scope],
    ["Filters", doc.filters?.length ? doc.filters.map((f) => `${f.label}: ${f.value}`).join("; ") : "None"],
  ];
}

const cardType = (fmt) => (fmt === "money" ? "money" : fmt === "pct" ? "pct" : fmt === "int" ? "int" : "num");

// ------------------------------------------------------------ CSV
function csvField(v) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? String(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV (CRLF, UTF-8 with BOM added at download). */
export function buildCsv(doc) {
  const lines = [];
  const push = (cells) => lines.push(cells.map(csvField).join(","));
  for (const [k, v] of metaRows(doc)) push([k, safeText(v)]);
  for (const n of doc.notes ?? []) push(["Note", safeText(n)]);
  if (doc.cards?.length) {
    lines.push("");
    push(["Summary", "Value"]);
    for (const c of doc.cards) push([safeText(c.label), plainValue(c.value, cardType(c.format))]);
  }
  for (const t of doc.tables) {
    lines.push("");
    if (doc.tables.length > 1) push([safeText(t.title)]);
    push(t.columns.map((c) => safeText(c.label + (c.type === "pct" ? " (%)" : ""))));
    for (const r of t.rows) push(t.columns.map((c) => plainValue(r[c.key], c.type)));
    if (t.totals) push(t.columns.map((c, i) => (c.key in t.totals ? t.totals[c.key] : i === 0 ? "Total" : "")));
  }
  return lines.join("\r\n");
}

// ------------------------------------------------------------ XLSX
const SHEET_BAD = /[[\]:*?/\\]/g;
export function sheetName(title, used) {
  let base = (String(title || "Sheet").replace(SHEET_BAD, " ").replace(/\s+/g, " ").trim() || "Sheet").slice(0, 31);
  let name = base, i = 2;
  while (used.has(name.toLowerCase())) { const suf = ` (${i++})`; name = base.slice(0, 31 - suf.length) + suf; }
  used.add(name.toLowerCase());
  return name;
}

function xlsxValue(v, type) {
  if (v === null || v === undefined || v === "") return null;
  if (NUMERIC.has(type)) { const n = toNumber(v); return n === null ? safeText(v) : n; }
  if (type === "date") { const s = isoDate(v); const [y, m, d] = s.split("-").map(Number); return y ? new Date(Date.UTC(y, m - 1, d)) : safeText(v); }
  if (type === "datetime") { const d = new Date(v); return Number.isNaN(d.getTime()) ? safeText(v) : d; }
  if (type === "bool" || typeof v === "boolean") return v === true || v === "true" ? "Yes" : "No";
  if (typeof v === "object") return safeText(JSON.stringify(v));
  return safeText(v);
}
const NUMFMT = { int: "#,##0", num: "#,##0.##", money: "#,##0.00", pct: '0.0"%"', date: "yyyy-mm-dd", datetime: "yyyy-mm-dd hh:mm" };

/** Build an ExcelJS workbook. Pass the ExcelJS module (dynamic import in the browser). */
export function buildXlsxWorkbook(doc, ExcelJS) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Zyllo Tech HRMS";
  wb.created = new Date(doc.generatedAt);
  const used = new Set();
  const sum = wb.addWorksheet(sheetName("Summary", used));
  sum.columns = [{ width: 28 }, { width: 70 }];
  for (const [k, v] of metaRows(doc)) { const r = sum.addRow([k, safeText(v)]); r.getCell(1).font = { bold: true }; }
  for (const n of doc.notes ?? []) sum.addRow(["Note", safeText(n)]).getCell(2).alignment = { wrapText: true };
  if (doc.cards?.length) {
    sum.addRow([]);
    sum.addRow(["Summary", "Value"]).font = { bold: true };
    for (const c of doc.cards) {
      const t = cardType(c.format);
      const row = sum.addRow([safeText(c.label), xlsxValue(c.value, t)]);
      row.getCell(2).numFmt = NUMFMT[t];
      row.getCell(2).alignment = { horizontal: "left" };
    }
  }
  for (const t of doc.tables) {
    const ws = wb.addWorksheet(sheetName(t.title, used), { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = t.columns.map((c) => ({ header: c.label + (c.type === "pct" ? " (%)" : ""), key: c.key, width: Math.min(40, Math.max(10, c.label.length + 2)), style: NUMFMT[c.type] ? { numFmt: NUMFMT[c.type] } : {} }));
    ws.getRow(1).font = { bold: true };
    for (const r of t.rows) ws.addRow(Object.fromEntries(t.columns.map((c) => [c.key, xlsxValue(r[c.key], c.type)])));
    if (t.totals) {
      const tr = ws.addRow(Object.fromEntries(t.columns.map((c, i) => [c.key, c.key in t.totals ? t.totals[c.key] : i === 0 ? "Total" : null])));
      tr.font = { bold: true };
    }
    if (t.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } };
  }
  return wb;
}

// ------------------------------------------------------------ PDF (A4 landscape, tables)
const PW = 841.89, PH = 595.28, MX = 36, MT = 40, MB = 40;
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const n2 = (n) => (Math.round(n * 100) / 100).toString();
function fit(s, size, width, bold = false) {
  let t = sanitizePdfText(s).replace(/\n/g, " ");
  if (textWidth(t, size, bold) <= width) return t;
  while (t.length > 1 && textWidth(t + "...", size, bold) > width) t = t.slice(0, -1);
  return t + "...";
}
function wrap(s, size, width) {
  const words = sanitizePdfText(s).replace(/\n/g, " ").split(/ +/);
  const out = []; let cur = "";
  for (const w of words) { const cand = cur ? `${cur} ${w}` : w; if (textWidth(cand, size) > width && cur) { out.push(cur); cur = w; } else cur = cand; }
  if (cur) out.push(cur);
  return out;
}

/** Build a PDF 1.4 string. Throws when the tables exceed PDF_MAX_ROWS rows. */
export function buildReportPdf(doc) {
  const rowsTotal = doc.tables.reduce((n, t) => n + t.rows.length, 0);
  if (rowsTotal > PDF_MAX_ROWS) throw new Error(`This report has ${rowsTotal} rows; PDF supports up to ${PDF_MAX_ROWS}. Use Excel or CSV.`);
  const pages = [[]];
  let y = PH - MT;
  const cur = () => pages[pages.length - 1];
  const newPage = () => { pages.push([]); y = PH - MT; };
  const ensure = (h) => { if (y - h < MB) { newPage(); return true; } return false; };
  const text = (s, x, size, opts = {}) => cur().push({ t: "text", s, x, y, size, bold: !!opts.bold, color: opts.color });
  const W = PW - 2 * MX;

  // Header block
  text(fit(doc.title, 15, W, true), MX, 15, { bold: true }); y -= 20;
  for (const [k, v] of metaRows(doc).slice(1)) {
    for (const [i, line] of wrap(`${k}: ${v}`, 8.5, W).entries()) { ensure(11); text(line, MX + (i ? 10 : 0), 8.5, { color: "0.32 0.32 0.31" }); y -= 11; }
  }
  if (doc.cards?.length) {
    y -= 6;
    const colW = W / 4;
    doc.cards.forEach((c, i) => {
      if (i % 4 === 0) { ensure(26); if (i) y -= 26; }
      const x = MX + (i % 4) * colW;
      cur().push({ t: "text", s: fit(c.label, 7.5, colW - 8), x, y: y - 8, size: 7.5, color: "0.32 0.32 0.31" });
      cur().push({ t: "text", s: fit(displayValue(c.value, cardType(c.format), doc.currency), 11, colW - 8, true), x, y: y - 20, size: 11, bold: true });
    });
    y -= 30;
  }
  for (const t of doc.tables) {
    const size = t.columns.length > 9 ? 6.5 : 7.5;
    const lh = size + 5;
    // Column widths from content (sampled), scaled to the page width.
    const sample = t.rows.slice(0, 200);
    const want = t.columns.map((c) => Math.min(180, Math.max(textWidth(sanitizePdfText(c.label), size, true),
      ...sample.map((r) => textWidth(sanitizePdfText(displayValue(r[c.key], c.type, doc.currency)), size))) + 8));
    const scale = Math.min(1, W / want.reduce((a, b) => a + b, 0));
    const widths = want.map((w) => w * (scale < 1 ? W / want.reduce((a, b) => a + b, 0) : 1));
    const xs = widths.reduce((acc, w, i) => (acc.push(i ? acc[i - 1] + widths[i - 1] : MX), acc), []);
    const right = (c) => NUMERIC.has(c.type);
    const cellX = (i, s, bold) => (right(t.columns[i]) ? xs[i] + widths[i] - 4 - textWidth(s, size, bold) : xs[i] + 2);
    const header = () => {
      cur().push({ t: "rect", x: MX, y: y - lh + 3, w: W, h: lh, gray: 0.93 });
      t.columns.forEach((c, i) => { const s = fit(c.label + (c.type === "pct" ? " %" : ""), size, widths[i] - 6, true); cur().push({ t: "text", s, x: cellX(i, s, true), y: y - size, size, bold: true }); });
      y -= lh;
    };
    y -= 8; ensure(lh * 3 + 16);
    text(fit(t.title, 10.5, W, true), MX, 10.5, { bold: true }); y -= 14;
    if (t.note) for (const line of wrap(t.note, 7.5, W)) { ensure(10); text(line, MX, 7.5, { color: "0.32 0.32 0.31" }); y -= 10; }
    header();
    if (!t.rows.length) { text("No records for these filters.", MX + 2, size, { color: "0.32 0.32 0.31" }); y -= lh; }
    const line = (r, bold) => {
      if (ensure(lh)) header();
      t.columns.forEach((c, i) => {
        const raw = bold && !(c.key in r) ? (i === 0 ? "Total" : "") : displayValue(r[c.key], c.type, doc.currency);
        const s = fit(raw === "-" && bold ? "" : raw, size, widths[i] - 6, bold);
        if (s) cur().push({ t: "text", s, x: cellX(i, s, bold), y: y - size, size, bold });
      });
      cur().push({ t: "line", x1: MX, x2: MX + W, y: y - lh + 2 });
      y -= lh;
    };
    for (const r of t.rows) line(r, false);
    if (t.totals) line(t.totals, true);
  }

  const total = pages.length;
  const foot = sanitizePdfText(`${doc.title} - generated ${isoDateTime(doc.generatedAt)} - Confidential`);
  const streams = pages.map((items, i) => {
    const ops = [];
    for (const it of items) {
      if (it.t === "rect") ops.push(`${it.gray} g ${n2(it.x)} ${n2(it.y)} ${n2(it.w)} ${n2(it.h)} re f`);
      else if (it.t === "line") ops.push(`0.88 G 0.4 w ${n2(it.x1)} ${n2(it.y)} m ${n2(it.x2)} ${n2(it.y)} l S`);
      else ops.push(`BT /${it.bold ? "F2" : "F1"} ${n2(it.size)} Tf ${it.color ?? "0.06 0.10 0.23"} rg ${n2(it.x)} ${n2(it.y)} Td (${esc(it.s)}) Tj ET`);
    }
    ops.push(`BT /F1 7 Tf 0.45 0.49 0.55 rg ${n2(MX)} 22 Td (${esc(fit(foot, 7, W - 80))}) Tj ET`);
    const pg = `Page ${i + 1} of ${total}`;
    ops.push(`BT /F1 7 Tf 0.45 0.49 0.55 rg ${n2(PW - MX - textWidth(pg, 7))} 22 Td (${pg}) Tj ET`);
    return ops.join("\n");
  });
  const objs = [];
  const pageIds = pages.map((_, i) => 6 + i * 2);
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${total} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objs[5] = `<< /Title (${esc(sanitizePdfText(doc.title))}) /Producer (Zyllo Tech HRMS) >>`;
  streams.forEach((s, i) => {
    const pid = pageIds[i];
    objs[pid] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(PW)} ${n2(PH)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pid + 1} 0 R >>`;
    objs[pid + 1] = `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let id = 1; id < objs.length; id++) { offsets[id] = out.length; out += `${id} 0 obj\n${objs[id]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

// ------------------------------------------------------------ browser download
export function exportFileName(doc, ext) {
  const base = `${doc.title}-${isoDate(doc.from)}-to-${isoDate(doc.to)}`.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_");
  return `${base.slice(0, 120)}.${ext}`;
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Render + download `doc` in `format` ("csv" | "xlsx" | "pdf"). */
export async function downloadDoc(doc, format) {
  if (format === "csv") return download(exportFileName(doc, "csv"), new Blob(["﻿" + buildCsv(doc)], { type: "text/csv;charset=utf-8" }));
  if (format === "pdf") {
    const pdf = buildReportPdf(doc);
    const b = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) b[i] = pdf.charCodeAt(i) & 0xff;
    return download(exportFileName(doc, "pdf"), new Blob([b], { type: "application/pdf" }));
  }
  if (format === "xlsx") {
    const ExcelJS = (await import("exceljs")).default;
    const buf = await buildXlsxWorkbook(doc, ExcelJS).xlsx.writeBuffer();
    return download(exportFileName(doc, "xlsx"), new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }
  throw new Error("Unsupported format");
}
