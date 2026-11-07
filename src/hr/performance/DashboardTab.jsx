// Performance dashboard: cycle progress, ratings distribution, goal-sheet
// completeness and overdue items for the caller's scope (RLS-limited data).
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Scale, Target, Users } from "lucide-react";
import { formatDate, useHrQuery } from "@/lib/hr/client";
import { listGoals, listMeetings, listPlans, listReviews } from "@/lib/hr/performance";
import { OVERDUE_LABELS, REVIEW_STATUSES, REVIEW_STATUS_LABELS, cycleProgress, overdueItems, ratingDistribution, weightSummary } from "@/lib/hr/performanceRules";
import { Card, DataTable, EmptyState, ErrorState, KpiCard, Loading, Toolbar } from "@/hr/ui";
import { CycleSelect, PerfBadge, WeightMeter, defaultCycleId, empText, todayLocal } from "./shared";

export default function DashboardTab({ ctx }) {
  const [pickedCycle, setCycle] = useState("");
  const cycle = pickedCycle || defaultCycleId(ctx.cycles);
  const reviews = useHrQuery(() => (cycle ? listReviews({ cycle }) : Promise.resolve({ data: [] })), [cycle]);
  const goals = useHrQuery(() => (cycle ? listGoals({ cycle }) : Promise.resolve({ data: [] })), [cycle]);
  const plans = useHrQuery(() => listPlans(), []);
  const meetings = useHrQuery(() => listMeetings(), []);
  const today = todayLocal();
  const revs = useMemo(() => (reviews.data ? reviews.data.filter((r) => r.employee_id !== ctx.me) : null), [reviews.data, ctx.me]);

  const progress = useMemo(() => cycleProgress(revs), [revs]);
  const dist = useMemo(() => ratingDistribution(revs), [revs]);
  const sheets = useMemo(() => weightSummary((goals.data ?? []).filter((g) => g.employee_id !== ctx.me)), [goals.data, ctx.me]);
  const overdue = useMemo(() => overdueItems({
    cycles: ctx.cycles, reviews: revs ?? [], plans: plans.data ?? [], meetings: meetings.data ?? [], today,
  }), [ctx.cycles, revs, plans.data, meetings.data, today]);
  const activePlans = (plans.data ?? []).filter((p) => ["active", "extended"].includes(p.status)).length;
  const incompleteSheets = sheets.filter((s) => s.status !== "complete").length;
  const maxDist = Math.max(1, ...dist.rows.map((r) => r.count));

  if (!ctx.cyclesLoading && !ctx.cycles.length) {
    return <Card><EmptyState icon={ClipboardList} title="No review cycles yet" description={ctx.canManage ? "Create a review cycle under Review cycles to start." : "HR has not created a review cycle yet."} /></Card>;
  }
  if (ctx.cyclesError) return <ErrorState message={ctx.cyclesError} onRetry={ctx.reloadCycles} />;
  const loading = reviews.loading && !reviews.data;

  return (
    <div className="flex flex-col gap-4">
      <Toolbar><CycleSelect cycles={ctx.cycles} value={cycle} onChange={setCycle} /></Toolbar>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Reviews in cycle" value={progress.total} icon={Users} tone="navy" loading={loading} onClick={() => ctx.openTab("reviews")} />
        <KpiCard label="Finalized" value={`${progress.completionPct}%`} hint={`${progress.finalized} of ${progress.total}`} icon={CheckCircle2} tone="green" loading={loading} />
        <KpiCard label="Awaiting calibration" value={progress.counts.calibration} icon={Scale} tone="teal" loading={loading} onClick={() => ctx.openTab("reviews")} />
        <KpiCard label="Overdue items" value={overdue.length} icon={AlertTriangle} tone={overdue.length ? "red" : "slate"} loading={loading} />
        <KpiCard label="Goal sheets not at 100%" value={incompleteSheets} hint={`${sheets.length} employees with goals`} icon={Target} tone={incompleteSheets ? "orange" : "green"} loading={goals.loading && !goals.data} onClick={() => ctx.openTab("goals")} />
        <KpiCard label="Active improvement plans" value={activePlans} icon={ClipboardList} tone="slate" loading={plans.loading && !plans.data} onClick={() => ctx.openTab("plans")} />
      </div>

      {reviews.error && <ErrorState message={reviews.error} onRetry={reviews.reload} />}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Cycle progress">
          {loading ? <Loading /> : !progress.total ? <EmptyState title="No reviews in this cycle" description="Reviews are created when the cycle is started." /> : (
            <ul className="flex flex-col gap-2.5">
              {REVIEW_STATUSES.map((s) => {
                const n = progress.counts[s];
                const pct = progress.total ? Math.round((n / progress.total) * 100) : 0;
                return (
                  <li key={s} className="flex items-center gap-3 text-sm">
                    <span className="w-40 shrink-0"><PerfBadge value={s} /></span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-gradient-to-r from-[#3089a6] to-[#1f4693]" style={{ width: `${pct}%` }} /></span>
                    <span className="w-16 text-right font-semibold text-[#101a3a]">{n} <span className="text-xs font-normal text-slate-500">({pct}%)</span></span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title="Final rating distribution" actions={dist.average !== null ? <span className="text-xs text-slate-500">Average {dist.average}</span> : null}>
          {loading ? <Loading /> : !dist.total ? <EmptyState title="No finalized reviews yet" /> : (
            <ul className="flex flex-col gap-2.5" aria-label="Finalized reviews by rounded final rating">
              {dist.rows.slice().reverse().map((r) => (
                <li key={r.rating} className="flex items-center gap-3 text-sm">
                  <span className="w-44 shrink-0 text-slate-700"><strong>{r.rating}</strong> · {r.label}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-gradient-to-r from-[#f7941e] to-[#f96706]" style={{ width: `${(r.count / maxDist) * 100}%` }} /></span>
                  <span className="w-8 text-right font-semibold text-[#101a3a]">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Overdue items" padded={false}>
        <DataTable caption="Overdue performance items" rows={overdue} loading={loading} rowKey={(r) => `${r.kind}-${r.id}`}
          emptyTitle="Nothing overdue" emptyDescription="Self-assessments, manager assessments, improvement plans and meetings are on schedule."
          columns={[
            { key: "kind", header: "Item", render: (r) => OVERDUE_LABELS[r.kind] },
            { key: "employee", header: "Employee", render: (r) => empText(r.employee) },
            { key: "cycle", header: "Cycle", render: (r) => r.cycle ?? "—" },
            { key: "due", header: "Was due", render: (r) => formatDate(r.due), sortable: true },
          ]} />
      </Card>

      {sheets.some((s) => s.status !== "complete") && (
        <Card title="Goal sheets that do not total 100%" padded={false}>
          <DataTable caption="Incomplete goal sheets" rows={sheets.filter((s) => s.status !== "complete")} rowKey="employee_id"
            columns={[
              { key: "employee", header: "Employee", render: (r) => empText(r.employee) },
              { key: "count", header: "Goals" },
              { key: "total", header: "Weight", render: (r) => <WeightMeter total={r.total} /> },
              { key: "status", header: "Status", render: (r) => (r.status === "over" ? "Over 100%" : `${r.remaining}% unassigned`) },
            ]} />
        </Card>
      )}
      <p className="text-xs text-slate-500">Statuses: {REVIEW_STATUSES.map((s) => REVIEW_STATUS_LABELS[s]).join(" → ")}. Figures cover the employees you may see{ctx.canViewAll ? "" : " (your reporting line)"}; your own review is not included.</p>
    </div>
  );
}
