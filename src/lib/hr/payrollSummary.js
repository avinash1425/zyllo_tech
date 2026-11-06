// Employee payroll summaries — financial-year totals, component-by-month
// earnings / deductions, statutory (tax) totals and payment history totals.
//
// Pure functions over payslip rows the signed-in employee is already allowed
// to read (RLS: own, released payslips). Every amount was computed by the
// server at payroll calculation; this module only adds them up. No DOM or
// supabase imports so it can be unit-tested with `node --test`.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;

/** Indian financial year (April–March) a date falls in, as its starting calendar year. */
export function financialYearOf(iso) {
  const [y, m] = String(iso ?? "").slice(0, 7).split("-").map(Number);
  if (!y || !m) return null;
  return m >= 4 ? y : y - 1;
}
export const fyLabel = (fy) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
export const fyRange = (fy) => ({ start: `${fy}-04-01`, end: `${fy + 1}-03-31` });
/** Assessment year for a financial year (FY 2026-27 -> AY 2027-28). */
export const ayLabel = (fy) => `AY ${fy + 1}-${String((fy + 2) % 100).padStart(2, "0")}`;

/** The twelve months of a financial year as YYYY-MM keys with short labels. */
export function fyMonths(fy) {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;
    const y = m >= 4 ? fy : fy + 1;
    return { key: `${y}-${String(m).padStart(2, "0")}`, label: `${MONTHS[m - 1]} ${String(y).slice(2)}` };
  });
}

/** Financial years that have at least one payslip, newest first. */
export function availableFinancialYears(slips) {
  return [...new Set((slips ?? []).map((s) => financialYearOf(s.period_start)).filter((v) => v != null))].sort((a, b) => b - a);
}

// Statutory buckets shown on the tax statement. Matched on the component code
// or the statutory rule that produced the line (rule codes are configurable).
const TAX_BUCKETS = [
  { key: "tds", label: "Income tax deducted (TDS)", test: (l) => l.code === "TDS" || l.statutory_rule === "TDS" },
  { key: "pf", label: "Provident Fund (employee)", test: (l) => l.code === "PF_EMPLOYEE" || l.statutory_rule === "EPF" },
  { key: "esi", label: "State Insurance (employee)", test: (l) => l.code === "ESI_EMPLOYEE" || l.statutory_rule === "ESI" },
  { key: "pt", label: "Professional Tax", test: (l) => l.code === "PROFESSIONAL_TAX" || /^PT(_|$)/.test(String(l.statutory_rule ?? "")) },
];
export const TAX_BUCKET_LABELS = Object.fromEntries([...TAX_BUCKETS.map((b) => [b.key, b.label]), ["other", "Other statutory deductions"]]);
export function taxBucketOf(line) {
  const hit = TAX_BUCKETS.find((b) => b.test(line));
  if (hit) return hit.key;
  return line.statutory_rule ? "other" : null;
}

/** Normalised lines of one payslip: structure / statutory lines plus approved one-off adjustments. */
export function slipLines(slip) {
  const b = slip?.breakdown ?? {};
  const adj = b.adjustments ?? [];
  const line = (l, kind) => ({ key: `${kind}:${l.code ?? l.name}`, code: l.code ?? null, name: l.name ?? l.code ?? "—", amount: r2(l.amount), statutory_rule: l.statutory_rule ?? null });
  const adjLine = (a, amount) => ({ key: `adj:${a.label ?? "Adjustment"}`, code: null, name: a.label || "Adjustment", amount: r2(amount), statutory_rule: null, adjustment: true });
  return {
    earnings: [...(b.earnings ?? []).map((l) => line(l, "e")), ...adj.filter((a) => Number(a.amount) > 0).map((a) => adjLine(a, a.amount))],
    deductions: [...(b.deductions ?? []).map((l) => line(l, "d")), ...adj.filter((a) => Number(a.amount) < 0).map((a) => adjLine(a, -Number(a.amount)))],
    employer: (b.employer_contributions ?? []).map((l) => line(l, "c")),
    reimbursements: (b.reimbursements ?? []).map((x) => ({ category: x.category, amount: r2(x.amount), claim_date: x.claim_date })),
  };
}

function addRow(map, l, month) {
  const row = map.get(l.key) ?? { key: l.key, code: l.code, name: l.name, adjustment: Boolean(l.adjustment), total: 0, byMonth: {} };
  row.total = r2(row.total + l.amount);
  row.byMonth[month] = r2((row.byMonth[month] ?? 0) + l.amount);
  map.set(l.key, row);
}

/**
 * Totals for one financial year.
 * Months are keyed by the payslip's period start month. Off-cycle payslips in
 * the same month are added together.
 */
export function summarizeYear(slips, fy) {
  const rows = (slips ?? []).filter((s) => financialYearOf(s.period_start) === fy)
    .sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
  const currencies = [...new Set(rows.map((s) => s.currency || "INR"))];
  const earnings = new Map();
  const deductions = new Map();
  const employer = new Map();
  const tax = { tds: 0, pf: 0, esi: 0, pt: 0, other: 0 };
  const taxByMonth = {};
  const months = new Map();
  const totals = { gross: 0, deductions: 0, reimbursements: 0, net: 0, lopDays: 0, payslips: rows.length };
  for (const s of rows) {
    const month = String(s.period_start).slice(0, 7);
    const m = months.get(month) ?? { key: month, gross: 0, deductions: 0, reimbursements: 0, net: 0, lopDays: 0, payslipIds: [] };
    m.gross = r2(m.gross + Number(s.gross || 0));
    m.deductions = r2(m.deductions + Number(s.total_deductions || 0));
    m.reimbursements = r2(m.reimbursements + Number(s.reimbursements || 0));
    m.net = r2(m.net + Number(s.net || 0));
    m.lopDays += Number(s.lop_days || 0);
    m.payslipIds.push(s.id);
    months.set(month, m);
    totals.gross = r2(totals.gross + Number(s.gross || 0));
    totals.deductions = r2(totals.deductions + Number(s.total_deductions || 0));
    totals.reimbursements = r2(totals.reimbursements + Number(s.reimbursements || 0));
    totals.net = r2(totals.net + Number(s.net || 0));
    totals.lopDays += Number(s.lop_days || 0);
    const L = slipLines(s);
    L.earnings.forEach((l) => addRow(earnings, l, month));
    L.deductions.forEach((l) => {
      addRow(deductions, l, month);
      const bucket = taxBucketOf(l);
      if (bucket) {
        tax[bucket] = r2(tax[bucket] + l.amount);
        taxByMonth[month] = taxByMonth[month] ?? { tds: 0, pf: 0, esi: 0, pt: 0, other: 0 };
        taxByMonth[month][bucket] = r2(taxByMonth[month][bucket] + l.amount);
      }
    });
    L.employer.forEach((l) => addRow(employer, l, month));
  }
  const byTotal = (a, b) => (a.adjustment - b.adjustment) || (b.total - a.total);
  return {
    fy, label: fyLabel(fy), currency: currencies[0] ?? "INR", mixedCurrency: currencies.length > 1,
    months: [...months.values()],
    earnings: [...earnings.values()].sort(byTotal),
    deductions: [...deductions.values()].sort(byTotal),
    employerContributions: [...employer.values()].sort(byTotal),
    tax, taxByMonth,
    totals,
  };
}

/** Payment-history totals (hr_my_payroll_payments rows), optionally limited to one financial year. */
export function summarizePayments(payments, fy = null) {
  const rows = (payments ?? []).filter((p) => fy == null || financialYearOf(p.period_start) === fy);
  const settled = (p) => ["paid", "reconciled"].includes(p.status);
  const sum = (list, f) => r2(list.reduce((s, p) => s + Number(f(p) || 0), 0));
  return {
    count: rows.length,
    paid: sum(rows, (p) => p.amount_paid),
    outstanding: sum(rows.filter((p) => !settled(p) && p.status !== "failed"), (p) => Number(p.net || 0) - Number(p.amount_paid || 0)),
    failed: rows.filter((p) => p.status === "failed").length,
    lastPaid: rows.filter((p) => settled(p) && p.payment_date).sort((a, b) => String(b.payment_date).localeCompare(String(a.payment_date)))[0] ?? null,
  };
}

/** Change in net pay between the two most recent payslips (null when fewer than two). */
export function netChange(slips) {
  const sorted = [...(slips ?? [])].sort((a, b) => String(b.period_start).localeCompare(String(a.period_start)));
  if (sorted.length < 2) return null;
  const diff = r2(Number(sorted[0].net || 0) - Number(sorted[1].net || 0));
  const base = Number(sorted[1].net || 0);
  return { diff, percent: base ? Math.round((diff / base) * 1000) / 10 : null };
}
