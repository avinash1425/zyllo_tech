// Benefits dashboard: live figures from hr_benefits_overview (208). Plan-year
// figures use each plan's own plan year containing the chosen date.
import { useState } from "react";
import { BadgeCheck, ClipboardCheck, HeartPulse, Hourglass, Layers, Percent, Users, Wallet } from "lucide-react";
import { useHrQuery } from "@/lib/hr/client";
import { benefitsOverview, planYearLabel } from "@/lib/hr/benefits";
import { Card, DataTable, ErrorState, Field, Input, KpiCard } from "@/hr/ui";
import { money, today } from "./shared";

export default function OverviewTab({ onOpen }) {
  const [on, setOn] = useState(today());
  const q = useHrQuery(() => benefitsOverview(on), [on]);
  const d = q.data ?? {};
  const k = d.kpis ?? {};
  const loading = q.loading && !q.data;
  const kpis = [
    { label: "Enrolled employees", value: k.enrolled_employees, hint: k.active_enrollments != null ? `${k.active_enrollments} active enrollments` : undefined, icon: Users, tone: "navy", go: "enrollments" },
    { label: "Benefit plans", value: k.plans_active, hint: k.plans_total != null ? `${k.plans_total} in total (incl. inactive)` : undefined, icon: Layers, tone: "teal", go: "plans" },
    { label: "Pending claims", value: k.pending_claims, hint: k.pending_claim_amount != null ? `${money(k.pending_claim_amount)} awaiting review` : undefined, icon: Hourglass, tone: "orange", go: "claims" },
    { label: "Enrollment requests", value: k.pending_enrollment_requests, hint: "Self-enrollment requests to decide", icon: ClipboardCheck, tone: "orange", go: "enrollments" },
    { label: "Approved this plan year", value: k.approved_amount_year != null ? money(k.approved_amount_year) : undefined, icon: BadgeCheck, tone: "green", go: "claims" },
    { label: "Approved, not yet paid", value: k.approved_unpaid_claims, hint: "Record external payments in Claims", icon: Wallet, tone: "slate", go: "claims" },
    { label: "Limit utilisation", value: k.utilisation_pct != null ? `${k.utilisation_pct}%` : "—", hint: k.limit_total_year ? `of ${money(k.limit_total_year)} total annual limits` : "No plan with an annual limit", icon: Percent, tone: "teal", go: "reports" },
  ];
  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <p className="text-sm text-slate-600">Benefits are administered here only. Approved claims are <strong>not</strong> added to payroll; HR records any payment made outside payroll.</p>
          <Field label="Figures as of" className="sm:w-48"><Input type="date" value={on} onChange={(e) => setOn(e.target.value || today())} /></Field>
        </div>
      </Card>
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((x) => <KpiCard key={x.label} label={x.label} value={x.value} hint={x.hint} icon={x.icon} tone={x.tone} loading={loading} onClick={() => onOpen(x.go)} />)}
          </div>
          <div className="mt-4">
            <DataTable caption="Plans" rows={d.plans ?? (loading ? null : [])} loading={loading} pageSize={20} emptyTitle="No benefit plans yet"
              emptyDescription="Create categories and plans to start enrolling employees."
              columns={[
                { key: "name", header: "Plan", render: (r) => <div><p className="font-medium text-[#101a3a]">{r.name}</p><p className="text-xs text-slate-500">{r.code} · {r.category_name}{r.active ? "" : " · inactive"}</p></div> },
                { key: "enrolled", header: "Enrolled", render: (r) => <span>{r.enrolled}{r.suspended ? <span className="text-xs text-slate-500"> (+{r.suspended} suspended)</span> : null}</span> },
                { key: "plan_year_start", header: "Plan year", render: (r) => planYearLabel(r.plan_year_start) },
                { key: "pending_claims", header: "Pending claims" },
                { key: "approved_amount", header: "Approved (year)", render: (r) => (r.claimable ? money(r.approved_amount) : "—") },
                { key: "limit_total", header: "Total limit", render: (r) => (r.limit_total != null ? money(r.limit_total) : r.claimable ? "No limit" : "Not claimable") },
                { key: "utilisation_pct", header: "Utilisation", render: (r) => (r.utilisation_pct != null ? `${r.utilisation_pct}%` : "—") },
              ]} />
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><HeartPulse className="h-3.5 w-3.5" aria-hidden="true" />Utilisation = approved claims in the plan year ÷ (annual limit × currently enrolled employees).</p>
        </>
      )}
    </>
  );
}
