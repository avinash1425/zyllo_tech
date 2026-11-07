// Performance reports with CSV export (data already scoped by RLS):
// review results, goal / KPI results, department summary, improvement plans.
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { exportCsv, formatDate, fullName, useHrQuery } from "@/lib/hr/client";
import { listGoals, listPlans, listReviews } from "@/lib/hr/performance";
import { REVIEW_STATUS_LABELS, ratingLabel } from "@/lib/hr/performanceRules";
import { useOrg } from "@/lib/hr/org";
import { Button, Card, DataTable, Toolbar, useToast } from "@/hr/ui";
import { CycleSelect, RatingBadge, defaultCycleId } from "./shared";

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

export default function ReportsTab({ ctx }) {
  const { notify } = useToast();
  const [pickedCycle, setCycle] = useState("");
  const cycle = pickedCycle || defaultCycleId(ctx.cycles);
  const reviews = useHrQuery(() => (cycle ? listReviews({ cycle }) : Promise.resolve({ data: [] })), [cycle]);
  const goals = useHrQuery(() => (cycle ? listGoals({ cycle }) : Promise.resolve({ data: [] })), [cycle]);
  const plans = useHrQuery(() => listPlans(), []);
  const org = useOrg();
  const cyc = ctx.cycles.find((c) => c.id === cycle);
  const deptName = (id) => org.data?.departments?.find((d) => d.id === id)?.name ?? "Unassigned";
  const revs = useMemo(() => (reviews.data ?? []).filter((r) => r.employee_id !== ctx.me), [reviews.data, ctx.me]);
  const byDept = useMemo(() => {
    const m = new Map();
    for (const r of revs) {
      const k = deptName(r.employee?.department_id);
      if (!m.has(k)) m.set(k, { department: k, reviews: 0, finalized: 0, sum: 0 });
      const d = m.get(k); d.reviews += 1;
      if (r.status === "finalized" && r.final_rating != null) { d.finalized += 1; d.sum += Number(r.final_rating); }
    }
    return [...m.values()].map((d) => ({ ...d, completion: pct(d.finalized, d.reviews), avg: d.finalized ? Math.round((d.sum / d.finalized) * 100) / 100 : null }))
      .sort((a, b) => a.department.localeCompare(b.department));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revs, org.data]);
  const slug = (cyc?.name ?? "cycle").replace(/[^A-Za-z0-9]+/g, "-");

  function exportReviews() {
    exportCsv(`performance-reviews-${slug}`, revs, [
      { label: "Employee code", value: (r) => r.employee?.employee_code },
      { label: "Employee", value: (r) => fullName(r.employee) },
      { label: "Department", value: (r) => deptName(r.employee?.department_id) },
      { label: "Manager", value: (r) => fullName(r.manager) },
      { label: "Cycle", value: () => cyc?.name },
      { label: "Stage", value: (r) => REVIEW_STATUS_LABELS[r.status] ?? r.status },
      { label: "Self rating", value: (r) => r.self_rating },
      { label: "Manager rating", value: (r) => r.manager_rating },
      { label: "Goal score", value: (r) => (r.goal_score == null ? null : Number(r.goal_score)) },
      { label: "Final rating", value: (r) => (r.final_rating == null ? null : Number(r.final_rating)) },
      { label: "Rating band", value: (r) => (r.final_rating == null ? "" : ratingLabel(r.final_rating)) },
      { label: "Self submitted", value: (r) => r.self_submitted_at },
      { label: "Manager submitted", value: (r) => r.manager_submitted_at },
      { label: "Finalized", value: (r) => r.finalized_at },
    ]);
    notify("Review results exported.");
  }
  function exportGoals() {
    exportCsv(`performance-goals-${slug}`, (goals.data ?? []).filter((g) => g.employee_id !== ctx.me), [
      { label: "Employee code", value: (g) => g.employee?.employee_code },
      { label: "Employee", value: (g) => fullName(g.employee) },
      { label: "Department", value: (g) => deptName(g.employee?.department_id) },
      { label: "Goal", key: "title" },
      { label: "KPI", value: (g) => g.kpi?.name },
      { label: "Unit", value: (g) => g.kpi?.unit },
      { label: "Weight %", value: (g) => Number(g.weight) },
      { label: "Target", value: (g) => (g.target_value == null ? null : Number(g.target_value)) },
      { label: "Actual", value: (g) => (g.actual_value == null ? null : Number(g.actual_value)) },
      { label: "Score", value: (g) => (g.score == null ? null : Number(g.score)) },
      { label: "Status", key: "status" },
      { label: "Due date", key: "due_date" },
      { label: "Last progress", key: "last_progress_at" },
    ]);
    notify("Goal and KPI results exported.");
  }
  function exportPlans() {
    exportCsv("improvement-plans", (plans.data ?? []).filter((p) => p.employee_id !== ctx.me), [
      { label: "Employee code", value: (p) => p.employee?.employee_code },
      { label: "Employee", value: (p) => fullName(p.employee) },
      { label: "Title", key: "title" },
      { label: "Start", key: "start_date" },
      { label: "End", key: "end_date" },
      { label: "Status", key: "status" },
      { label: "Owner", value: (p) => fullName(p.owner) },
      { label: "Acknowledged", key: "employee_acknowledged_at" },
      { label: "Closed", key: "closed_at" },
      { label: "Outcome notes", key: "outcome_notes" },
    ]);
    notify("Improvement plans exported.");
  }

  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <CycleSelect cycles={ctx.cycles} value={cycle} onChange={setCycle} />
        <span className="flex flex-wrap items-end gap-2 sm:ml-auto">
          <Button variant="secondary" onClick={exportReviews} disabled={!revs.length}><Download className="h-4 w-4" aria-hidden="true" />Reviews CSV</Button>
          <Button variant="secondary" onClick={exportGoals} disabled={!(goals.data ?? []).length}><Download className="h-4 w-4" aria-hidden="true" />Goals / KPIs CSV</Button>
          <Button variant="secondary" onClick={exportPlans} disabled={!(plans.data ?? []).length}><Download className="h-4 w-4" aria-hidden="true" />Improvement plans CSV</Button>
        </span>
      </Toolbar>
      <Card title={`Department summary${cyc ? ` · ${cyc.name}` : ""}`} padded={false}>
        <DataTable caption="Department summary" rows={reviews.data ? byDept : null} loading={reviews.loading} error={reviews.error} onRetry={reviews.reload} rowKey="department"
          emptyTitle="No reviews in this cycle"
          columns={[
            { key: "department", header: "Department", sortable: true },
            { key: "reviews", header: "Reviews", sortable: true },
            { key: "finalized", header: "Finalized", sortable: true },
            { key: "completion", header: "Completion", sortable: true, render: (d) => `${d.completion}%` },
            { key: "avg", header: "Avg final rating", sortable: true, render: (d) => <RatingBadge rating={d.avg} /> },
          ]} />
      </Card>
      <Card title="Review results" padded={false}>
        <DataTable caption="Review results" rows={reviews.data ? revs : null} loading={reviews.loading} pageSize={15}
          columns={[
            { key: "employee", header: "Employee", sortable: true, sortValue: (r) => fullName(r.employee), render: (r) => fullName(r.employee) },
            { key: "dept", header: "Department", render: (r) => deptName(r.employee?.department_id) },
            { key: "status", header: "Stage", render: (r) => REVIEW_STATUS_LABELS[r.status] },
            { key: "goal_score", header: "Goal score", sortable: true, render: (r) => r.goal_score ?? "—" },
            { key: "final_rating", header: "Final", sortable: true, render: (r) => <RatingBadge rating={r.final_rating} /> },
            { key: "finalized_at", header: "Finalized", render: (r) => formatDate(r.finalized_at) },
          ]} />
      </Card>
      <p className="text-xs text-slate-500">Exports contain only the employees you may see{ctx.canViewAll ? "" : " (your reporting line)"}. Performance data is confidential — store exported files securely.</p>
    </div>
  );
}
