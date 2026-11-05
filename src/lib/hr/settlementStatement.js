// Full & final settlement statement: a self-contained printable page opened in
// a new window (the browser's "Save as PDF" produces the PDF). All values are
// HTML-escaped; no data leaves the browser.
import { formatDate, formatMoney } from "./client";
import { lineTypeLabel } from "./lifecycle";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function settlementStatementHtml(s) {
  const cur = s.currency || "INR";
  const row = (l) => `<tr><td>${esc(l.label)}<div class="muted">${esc(lineTypeLabel(l.line_type))}${l.quantity != null ? ` · ${esc(l.quantity)}${l.rate != null ? ` × ${esc(formatMoney(l.rate, cur))}` : ""}` : ""}</div></td>
    <td class="num">${l.earning ? esc(formatMoney(l.amount, cur)) : ""}</td><td class="num">${l.earning ? "" : esc(formatMoney(l.amount, cur))}</td></tr>`;
  const e = s.employee ?? {};
  const x = s.exit ?? {};
  const status = s.status === "paid" ? `Paid on ${esc(formatDate(s.paid_on))}${s.payment_reference ? ` · Ref ${esc(s.payment_reference)}` : ""}`
    : s.status === "approved" ? `Approved ${esc(formatDate(s.approved_at))} · payment pending` : `DRAFT — ${esc(s.status)} (not approved)`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Full and final settlement — ${esc(e.name)}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#101a3a;margin:32px;font-size:13px}
  h1{font-size:20px;margin:0 0 4px} .muted{color:#64748b;font-size:11px} .brand{color:#f96706;font-weight:800;letter-spacing:.02em}
  table{width:100%;border-collapse:collapse;margin-top:16px} th,td{padding:8px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}
  th{font-size:11px;text-transform:uppercase;color:#64748b} .num{text-align:right;white-space:nowrap}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-top:16px} .grid div span{display:block;color:#64748b;font-size:11px}
  .total td{font-weight:700} .net td{font-size:15px;font-weight:800;border-top:2px solid #101a3a}
  .status{margin-top:12px;padding:8px 10px;border-radius:8px;background:#f1f5f9;font-weight:600}
  .note{margin-top:24px;color:#64748b;font-size:11px} @media print{body{margin:12mm}}
</style></head><body>
<div class="brand">ZYLLO TECH</div>
<h1>Full and final settlement statement</h1>
<div class="muted">Generated ${esc(new Date(s.generated_at || Date.now()).toLocaleString("en-IN"))}</div>
<div class="status">${status}</div>
<div class="grid">
  <div><span>Employee</span>${esc(e.name)} (${esc(e.employee_code)})</div>
  <div><span>Department / designation</span>${esc([e.department, e.designation].filter(Boolean).join(" · ") || "—")}</div>
  <div><span>Joining date</span>${esc(formatDate(e.joining_date))}</div>
  <div><span>Last working day</span>${esc(formatDate(x.last_working_day))}</div>
  <div><span>Exit type</span>${esc(String(x.exit_type ?? "").replace(/_/g, " "))}</div>
  <div><span>Resignation date</span>${esc(formatDate(x.resignation_date))}</div>
</div>
<table><thead><tr><th>Item</th><th class="num">Earnings</th><th class="num">Deductions</th></tr></thead><tbody>
${(s.lines ?? []).map(row).join("")}
<tr class="total"><td>Totals</td><td class="num">${esc(formatMoney(s.total_earnings, cur))}</td><td class="num">${esc(formatMoney(s.total_deductions, cur))}</td></tr>
<tr class="net"><td>Net settlement ${Number(s.net_amount) < 0 ? "(recoverable from employee)" : "(payable to employee)"}</td><td class="num" colspan="2">${esc(formatMoney(Math.abs(Number(s.net_amount)), cur))}</td></tr>
</tbody></table>
<p class="note">Amounts are as reviewed and approved by Zyllo Tech payroll. This statement records the settlement; it does not itself transfer funds.</p>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},150)})</script>
</body></html>`;
}

/** Open the statement in a new window for printing / saving as PDF. Returns an error message or null. */
export function openSettlementStatement(statement) {
  const blocked = "Your browser blocked the statement window. Allow pop-ups for this site and try again.";
  try {
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w?.document) return blocked;
    w.document.open();
    w.document.write(settlementStatementHtml(statement));
    w.document.close();
    return null;
  } catch {
    return blocked;
  }
}
