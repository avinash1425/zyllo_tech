// Performance history for one employee across cycles: reviews and ratings,
// goals per cycle, improvement plans, meetings and feedback. Everything is
// read under RLS, so a manager sees only their reporting line.
import { useMemo, useState } from "react";
import { History } from "lucide-react";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { listFeedback, listGoals, listMeetings, listPlans, listReviews } from "@/lib/hr/performance";
import { label, weightTotal, weightedGoalScore } from "@/lib/hr/performanceRules";
import { Card, DataTable, EmptyState, Field, Loading, Select, Toolbar } from "@/hr/ui";
import { PerfBadge, RatingBadge, TextBlock, WeightMeter } from "./shared";

export function EmployeePerformanceHistory({ employeeId, compact = false }) {
  const reviews = useHrQuery(() => listReviews({ employee: employeeId }), [employeeId]);
  const goals = useHrQuery(() => listGoals({ employee: employeeId }), [employeeId]);
  const plans = useHrQuery(() => (compact ? Promise.resolve({ data: [] }) : listPlans({ employee: employeeId })), [employeeId, compact]);
  const meetings = useHrQuery(() => (compact ? Promise.resolve({ data: [] }) : listMeetings(employeeId)), [employeeId, compact]);
  const feedback = useHrQuery(() => (compact ? Promise.resolve({ data: [] }) : listFeedback({ employee: employeeId })), [employeeId, compact]);
  const byCycle = useMemo(() => {
    const m = new Map();
    for (const g of goals.data ?? []) {
      if (!m.has(g.cycle_id)) m.set(g.cycle_id, { cycle: g.cycle, goals: [] });
      m.get(g.cycle_id).goals.push(g);
    }
    return [...m.values()].sort((a, b) => ((a.cycle?.period_start ?? "") < (b.cycle?.period_start ?? "") ? 1 : -1));
  }, [goals.data]);
  const sortedReviews = useMemo(() => [...(reviews.data ?? [])].sort((a, b) => ((a.cycle?.period_start ?? "") < (b.cycle?.period_start ?? "") ? 1 : -1)), [reviews.data]);

  if (reviews.loading && !reviews.data) return <Loading />;
  return (
    <div className="flex flex-col gap-4">
      <Card title="Reviews by cycle" padded={false}>
        <DataTable caption="Review history" rows={sortedReviews} error={reviews.error} onRetry={reviews.reload}
          emptyTitle="No reviews" emptyDescription="An employee's own review is not visible to them here until it is finalized."
          columns={[
            { key: "cycle", header: "Cycle", render: (r) => <div><p className="font-semibold text-[#101a3a]">{r.cycle?.name}</p><p className="text-xs text-slate-500">{formatDate(r.cycle?.period_start)} – {formatDate(r.cycle?.period_end)}</p></div> },
            { key: "status", header: "Stage", render: (r) => <PerfBadge value={r.status} /> },
            { key: "self_rating", header: "Self", render: (r) => <RatingBadge rating={r.self_rating} showLabel={false} /> },
            { key: "manager_rating", header: "Manager", render: (r) => <RatingBadge rating={r.manager_rating} showLabel={false} /> },
            { key: "goal_score", header: "Goal score", render: (r) => r.goal_score ?? "—" },
            { key: "final_rating", header: "Final", render: (r) => <RatingBadge rating={r.final_rating} /> },
          ]} />
      </Card>
      <Card title="Goals by cycle">
        {goals.loading && !goals.data ? <Loading /> : !byCycle.length ? <p className="text-sm text-slate-500">No goals recorded.</p> : (
          <div className="flex flex-col gap-3">
            {byCycle.map((c) => (
              <div key={c.cycle?.id} className="rounded-xl border border-slate-100 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-[#101a3a]">{c.cycle?.name} <PerfBadge value={c.cycle?.status} /></p>
                  <span className="flex items-center gap-2 text-xs text-slate-500"><WeightMeter total={weightTotal(c.goals)} /> Weighted score {weightedGoalScore(c.goals) ?? "—"}</span>
                </div>
                <ul className="flex flex-col gap-1 text-sm">
                  {c.goals.map((g) => (
                    <li key={g.id} className="flex flex-wrap justify-between gap-2"><span>{g.title} <span className="text-xs text-slate-500">({Number(g.weight)}%)</span></span><span className="flex items-center gap-2"><span className="text-xs text-slate-500">score {g.score ?? "—"}</span><PerfBadge value={g.status} /></span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
      {!compact && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Improvement plans" padded={false}>
            <DataTable caption="Improvement plans" rows={plans.data} loading={plans.loading} error={plans.error} emptyTitle="No improvement plans"
              columns={[
                { key: "title", header: "Plan", render: (p) => p.title ?? "Improvement plan" },
                { key: "end_date", header: "Period", render: (p) => `${formatDate(p.start_date)} – ${formatDate(p.end_date)}` },
                { key: "status", header: "Status", render: (p) => <PerfBadge value={p.status} /> },
              ]} />
          </Card>
          <Card title="Review meetings" padded={false}>
            <DataTable caption="Meetings" rows={meetings.data} loading={meetings.loading} error={meetings.error} emptyTitle="No meetings"
              columns={[
                { key: "scheduled_at", header: "When", render: (m) => formatDateTime(m.scheduled_at) },
                { key: "meeting_type", header: "Type", render: (m) => label(m.meeting_type) },
                { key: "status", header: "Status", render: (m) => <PerfBadge value={m.status} /> },
              ]} />
          </Card>
          <Card title="Feedback" className="lg:col-span-2">
            {feedback.loading && !feedback.data ? <Loading /> : !(feedback.data ?? []).length ? <p className="text-sm text-slate-500">No feedback recorded.</p> : (
              <ul className="flex flex-col gap-2">
                {feedback.data.map((f) => (
                  <li key={f.id} className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500"><PerfBadge value={f.feedback_type} /><span>{f.author ? `${f.author.display_name || `${f.author.first_name} ${f.author.last_name}`}` : "Colleague"}</span><span>· {formatDateTime(f.created_at)}</span><span>· {f.visibility === "private_to_hr" ? "HR only" : "shared"}</span></div>
                    <TextBlock>{f.body}</TextBlock>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

export default function HistoryTab({ ctx, initialEmployee = "" }) {
  const [employee, setEmployee] = useState(initialEmployee);
  return (
    <>
      <Toolbar>
        <Field label="Employee" className="min-w-[18rem]"><Select placeholder="Choose an employee" value={employee} onChange={(e) => setEmployee(e.target.value)} options={ctx.employeeOptions} /></Field>
      </Toolbar>
      {employee ? <EmployeePerformanceHistory employeeId={employee} /> : <Card><EmptyState icon={History} title="Choose an employee" description="See their reviews, ratings, goals, improvement plans, meetings and feedback across cycles." /></Card>}
    </>
  );
}
