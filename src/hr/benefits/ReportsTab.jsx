// Benefit reports + CSV: plan utilisation (hr_benefits_overview), claims by
// status / plan for a period, and the enrollment register. Amounts appear
// only for benefits.view / benefits.manage holders (the page requires them).
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { exportCsv, useHrQuery } from "@/lib/hr/client";
import { CLAIM_STATUSES, CLAIM_STATUS_LABEL, benefitsOverview, listClaims, listEnrollments, planYearLabel } from "@/lib/hr/benefits";
import { Button, Card, DataTable, Field, Input, useToast } from "@/hr/ui";
import { claimCsvColumns } from "./ClaimsTab";
import { empText, money, today } from "./shared";

const firstOfYear = () => `${today().slice(0, 4)}-01-01`;

export default function ReportsTab() {
  const { notify } = useToast();
  const [range, setRange] = useState({ from: firstOfYear(), to: today() });
  const ov = useHrQuery(() => benefitsOverview(range.to), [range.to]);
  const claims = useHrQuery(() => listClaims({ status: "", from: range.from, to: range.to }), [range.from, range.to]);
  const [busy, setBusy] = useState(false);

  const byStatus = useMemo(() => CLAIM_STATUSES.filter((s) => s !== "draft").map((s) => {
    const rows = (claims.data ?? []).filter((c) => c.status === s);
    return { status: s, count: rows.length, amount: rows.reduce((n, c) => n + Number(c.amount), 0), approved: rows.reduce((n, c) => n + Number(c.approved_amount ?? 0), 0) };
  }), [claims.data]);
  const byPlan = useMemo(() => {
    const m = new Map();
    for (const c of claims.data ?? []) {
      const k = c.plan?.id ?? "?";
      const x = m.get(k) ?? { id: k, plan: c.plan?.name ?? "—", claims: 0, claimed: 0, approved: 0, pending: 0 };
      x.claims += 1; x.claimed += Number(c.amount);
      if (["approved", "paid_externally"].includes(c.status)) x.approved += Number(c.approved_amount ?? 0);
      if (c.status === "submitted") x.pending += Number(c.amount);
      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => a.plan.localeCompare(b.plan));
  }, [claims.data]);

  function exportUtilisation() {
    exportCsv(`benefit-utilisation-${range.to}`, ov.data?.plans ?? [], [
      { label: "Plan code", key: "code" }, { label: "Plan", key: "name" }, { label: "Category", key: "category_name" }, { label: "Active", value: (r) => (r.active ? "yes" : "no") },
      { label: "Plan year", value: (r) => planYearLabel(r.plan_year_start) }, { label: "Enrolled", key: "enrolled" }, { label: "Suspended", key: "suspended" },
      { label: "Annual limit per employee", value: (r) => (r.annual_limit == null ? "" : Number(r.annual_limit)) },
      { label: "Total limit", value: (r) => (r.limit_total == null ? "" : Number(r.limit_total)) },
      { label: "Approved claims (year)", key: "approved_claims" }, { label: "Approved amount (year)", value: (r) => Number(r.approved_amount) },
      { label: "Paid externally (year)", value: (r) => Number(r.paid_amount) }, { label: "Pending claims", key: "pending_claims" },
      { label: "Pending amount", value: (r) => Number(r.pending_amount) }, { label: "Utilisation %", value: (r) => (r.utilisation_pct == null ? "" : Number(r.utilisation_pct)) },
    ]);
  }
  async function exportEnrollments() {
    setBusy(true);
    const res = await listEnrollments({ status: "" });
    setBusy(false);
    if (res.error) { notify(res.error, "error"); return; }
    exportCsv(`benefit-enrollments-all-${today()}`, res.data ?? [], [
      { label: "Employee ID", value: (r) => r.employee?.employee_code }, { label: "Employee", value: (r) => empText(r.employee) },
      { label: "Plan code", value: (r) => r.plan?.code }, { label: "Plan", value: (r) => r.plan?.name }, { label: "Status", key: "status" },
      { label: "Start date", key: "start_date" }, { label: "End date", key: "end_date" }, { label: "Coverage", key: "coverage_level" },
      { label: "Dependants", key: "dependants" }, { label: "Policy number", key: "policy_number" },
      { label: "Employer contribution", value: (r) => Number(r.employer_contribution) }, { label: "Employee contribution", value: (r) => Number(r.employee_contribution) },
      { label: "Status reason", key: "end_reason" },
    ]);
    notify(`Exported ${(res.data ?? []).length} enrollments.`);
  }

  return (
    <>
      <Card className="mb-4" title="Period">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
          <Field label="Expense date from"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="to (and utilisation as of)"><Input type="date" value={range.to} min={range.from || undefined} onChange={(e) => setRange({ ...range, to: e.target.value || today() })} /></Field>
          <Button variant="secondary" disabled={!claims.data?.length} onClick={() => exportCsv(`benefit-claims-${range.from}-${range.to}`, claims.data ?? [], claimCsvColumns)}><Download className="h-4 w-4" aria-hidden="true" />Claims CSV</Button>
          <Button variant="secondary" loading={busy} onClick={exportEnrollments}><Download className="h-4 w-4" aria-hidden="true" />Enrollments CSV</Button>
        </div>
      </Card>

      <Card title="Plan utilisation (current plan year of each plan)" className="mb-4"
        actions={<Button size="sm" variant="secondary" disabled={!ov.data?.plans?.length} onClick={exportUtilisation}><Download className="h-4 w-4" aria-hidden="true" />CSV</Button>}>
        <DataTable caption="Plan utilisation" rows={ov.data?.plans} loading={ov.loading} error={ov.error} onRetry={ov.reload} emptyTitle="No plans"
          columns={[
            { key: "name", header: "Plan", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "plan_year_start", header: "Plan year", render: (r) => planYearLabel(r.plan_year_start) },
            { key: "enrolled", header: "Enrolled" },
            { key: "approved_claims", header: "Approved claims" },
            { key: "approved_amount", header: "Approved", render: (r) => money(r.approved_amount) },
            { key: "paid_amount", header: "Paid externally", render: (r) => money(r.paid_amount) },
            { key: "limit_total", header: "Total limit", render: (r) => (r.limit_total == null ? "—" : money(r.limit_total)) },
            { key: "utilisation_pct", header: "Utilisation", render: (r) => (r.utilisation_pct == null ? "—" : `${r.utilisation_pct}%`) },
          ]} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Claims by status (expense dates in period)">
          <DataTable caption="Claims by status" rows={claims.data ? byStatus : null} loading={claims.loading} error={claims.error} onRetry={claims.reload} rowKey="status"
            columns={[
              { key: "status", header: "Status", render: (r) => CLAIM_STATUS_LABEL[r.status] },
              { key: "count", header: "Claims" },
              { key: "amount", header: "Claimed", render: (r) => money(r.amount) },
              { key: "approved", header: "Approved", render: (r) => (r.approved ? money(r.approved) : "—") },
            ]} />
        </Card>
        <Card title="Claims by plan (expense dates in period)">
          <DataTable caption="Claims by plan" rows={claims.data ? byPlan : null} loading={claims.loading} error={claims.error} onRetry={claims.reload} emptyTitle="No claims in this period"
            columns={[
              { key: "plan", header: "Plan" },
              { key: "claims", header: "Claims" },
              { key: "claimed", header: "Claimed", render: (r) => money(r.claimed) },
              { key: "pending", header: "Pending", render: (r) => money(r.pending) },
              { key: "approved", header: "Approved", render: (r) => money(r.approved) },
            ]} />
        </Card>
      </div>
    </>
  );
}
