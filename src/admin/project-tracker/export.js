// Export helpers: CSV, Excel (.xlsx via exceljs, loaded on demand) and
// print-to-PDF. Exports contain only what the report columns list — never
// credential references, storage paths or document links.
import { safeCell, slug, toCSV } from "./lib/csv";
import { plainValue } from "./cells";
import { formatDateTime } from "./lib/format";

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** sheets: [{ name, columns, rows }] */
export function exportCSV(title, sheet) {
  const cols = sheet.columns.map((c) => ({ label: c.label, value: (r) => plainValue(c, r) }));
  const csv = toCSV(cols, sheet.rows, { title, generatedAt: formatDateTime(new Date().toISOString()) });
  download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${slug(title)}-${stamp()}.csv`);
}

export async function exportXLSX(title, sheets) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Zyllo Tech Project Tracker";
  wb.created = new Date();
  const used = new Set();
  for (const s of sheets) {
    let name = String(s.name || "Sheet").replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
    while (used.has(name)) name = `${name.slice(0, 28)}_${used.size}`;
    used.add(name);
    const ws = wb.addWorksheet(name);
    ws.addRow([safeCell(title)]).font = { bold: true, size: 13 };
    ws.addRow([`${s.name} · generated ${formatDateTime(new Date().toISOString())}`]).font = { italic: true, color: { argb: "FF676B7A" } };
    ws.addRow([]);
    const header = ws.addRow(s.columns.map((c) => c.label));
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF101A3A" } }; });
    for (const r of s.rows) ws.addRow(s.columns.map((c) => safeCell(plainValue(c, r))));
    if (s.rows.length === 0) ws.addRow(["No records."]);
    s.columns.forEach((c, i) => {
      const longest = Math.max(String(c.label).length, ...s.rows.slice(0, 200).map((r) => String(plainValue(c, r) ?? "").length));
      ws.getColumn(i + 1).width = Math.min(60, Math.max(10, longest + 2));
    });
    ws.views = [{ state: "frozen", ySplit: 4 }];
  }
  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${slug(title)}-${stamp()}.xlsx`);
}

const PRINT_CSS = `
  *{box-sizing:border-box} body{font:12px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1f2430;margin:24px}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:22px 0 6px;padding-bottom:4px;border-bottom:2px solid #101a3a}
  h3{font-size:13px;margin:14px 0 4px} p{margin:2px 0} .meta{color:#676b7a;font-size:11px}
  table{width:100%;border-collapse:collapse;margin:6px 0 10px;page-break-inside:auto} tr{page-break-inside:avoid}
  th,td{border:1px solid #d9dce3;padding:4px 6px;text-align:left;vertical-align:top;word-break:break-word}
  th{background:#f1f3f7;font-weight:600} dl{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 16px;margin:6px 0}
  dt{color:#676b7a;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em} dd{margin:0 0 6px}
  .noprint,button{display:none!important} a{color:inherit;text-decoration:none}
  @page{size:A4;margin:14mm}`;

/** Print an element's content (already escaped by React) in a clean window → user can "Save as PDF". */
export function printElement(el, title) {
  if (!el) return;
  const w = window.open("", "_blank", "width=1000,height=800");
  if (!w) throw new Error("Allow pop-ups for this site to print or save as PDF.");
  w.opener = null;
  const doc = w.document;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title></title><style>${PRINT_CSS}</style></head><body></body></html>`);
  doc.close();
  doc.title = title;
  doc.body.innerHTML = el.innerHTML;
  // strip interactive elements and any inline scripts defensively
  doc.querySelectorAll("script, button, input, select, textarea, .noprint").forEach((n) => n.remove());
  setTimeout(() => { w.focus(); w.print(); }, 150);
}
