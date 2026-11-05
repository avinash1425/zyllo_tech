// Module 12 — My Reports (employee self-service). One server call,
// public.hr_my_report_summary(), returns ONLY the signed-in employee's own
// records under RLS: attendance (same formula as HR reports), leave balances,
// published payslips, daily work and finalized performance reviews.
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { formatDate, formatDateTime, formatMoney, useHrQuery } from "@/lib/hr/client";
import { defaultFilters, loadMySummary, validateFilters } from "@/lib/hr/reports";
import { Button, Card, DataTable, EmptyState, ErrorState, Field, InlineError, Input, Loading, PageHeader } from "@/hr/ui";

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums text-[#101a3a]">{value ?? "—"}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export default function MyReportsPage() {
  const [draft, setDraft] = useState(defaultFilters());
  const [applied, setApplied] = useState(draft);
  const [error, setError] = useState(null);
  const q = useHrQuery(() => loadMySummary(applied), [applied.from, applied.to]);
  const d = q.data;
  const apply = (e) => { e.preventDefault(); const m = validateFilters(draft); setError(m); if (!m) setApplied(draft); };
  const reqs = d?.leave?.requests ?? {};

  return (
    <>
      <PageHeader title="My Reports" description="A summary of your own records. Only you (and HR staff authorised for your records) can see these figures." />
      <Card className="mb-4">
        <form onSubmit={apply} className="flex flex-wrap items-end gap-3" aria-label="Reporting period">
          <Field label="From"><Input type="date" value={draft.from} max={draft.to} onChange={(e) => setDraft((s) => ({ ...s, from: e.target.value }))} required /></Field>
          <Field label="To"><Input type="date" value={draft.to} min={draft.from} onChange={(e) => setDraft((s) => ({ ...s, to: e.target.value }))} required /></Field>
          <Button type="submit">Show</Button>
          <Button type="button" variant="secondary" onClick={q.reload} loading={q.loading}><RefreshCw className="h-4 w-4" aria-hidden="true" />Refresh</Button>
        </form>
        <div className="mt-3"><InlineError message={error} /></div>
      </Card>

      {q.loading && !d ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !d ? null : (
        <div className="space-y-5">
          <p className="text-sm text-slate-600">{formatDate(d.from)} – {formatDate(d.to)} · last refreshed {formatDateTime(d.generated_at)}</p>
          <Card title="My attendance summary">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Attendance" value={d.attendance.pct === null ? "—" : `${d.attendance.pct}%`} hint={`${d.attendance.attended} of ${d.attendance.expected} working days`} />
              <Stat label="Absent days" value={d.attendance.absent} />
              <Stat label="Late arrivals" value={d.attendance.late} />
              <Stat label="Worked hours" value={d.attendance.worked_hours} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {formatDate(d.attendance.window_from)} – {formatDate(d.attendance.window_to)}. Attended ÷ expected working days (weekly offs, holidays and approved leave excluded; today excluded).
            </p>
          </Card>
          <Card title="My leave summary">
            <p className="mb-3 text-sm text-slate-600">
              In this period: {d.leave.approved_days} approved days · {reqs.approved ?? 0} approved · {reqs.pending_approval ?? 0} pending · {reqs.rejected ?? 0} rejected requests.
            </p>
            <DataTable caption="My leave balances" rows={d.leave.balances} rowKey="leave_type" emptyTitle="No leave balances for this year"
              columns={[{ key: "leave_type", header: "Leave type" }, { key: "credited", header: "Credited" }, { key: "used", header: "Used" },
                { key: "pending", header: "Pending (not yet used)" }, { key: "available", header: "Available" }]} />
          </Card>
          <Card title="My payslip history (last 12 months)">
            <DataTable caption="My payslips" rows={d.payslips} rowKey="period_start" emptyTitle="No published payslips"
              columns={[{ key: "period_start", header: "Period", render: (r) => `${formatDate(r.period_start)} – ${formatDate(r.period_end)}` },
                { key: "gross", header: "Gross", className: "text-right tabular-nums", render: (r) => formatMoney(r.gross, r.currency) },
                { key: "deductions", header: "Deductions", className: "text-right tabular-nums", render: (r) => formatMoney(r.deductions, r.currency) },
                { key: "net", header: "Net", className: "text-right tabular-nums", render: (r) => formatMoney(r.net, r.currency) }]} />
          </Card>
          <Card title="My daily work summary">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat label="Submitted" value={d.daily_work.submitted} />
              <Stat label="Reviewed" value={d.daily_work.reviewed} />
              <Stat label="Revision requested" value={d.daily_work.revision_requested} />
              <Stat label="Drafts" value={d.daily_work.drafts} />
              <Stat label="Hours reported" value={d.daily_work.hours} />
            </div>
          </Card>
          <Card title="My performance summary">
            {d.performance.length ? (
              <DataTable caption="My finalized reviews" rows={d.performance} rowKey="cycle"
                columns={[{ key: "cycle", header: "Cycle" }, { key: "period_end", header: "Cycle end", render: (r) => formatDate(r.period_end) },
                  { key: "final_rating", header: "Final rating (1–5)" }, { key: "finalized_at", header: "Finalized", render: (r) => formatDate(r.finalized_at) }]} />
            ) : <EmptyState title="No finalized reviews yet" description="Reviews appear here once they are finalized." />}
          </Card>
        </div>
      )}
    </>
  );
}
