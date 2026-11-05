// Employee Portal — My Benefits: own enrollments and plan eligibility
// (RLS: own rows only). Enrollment changes are made by HR; questions go
// through an HR request ("Benefits query").
import { HeartPulse } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatMoney, useHrQuery } from "@/lib/hr/client";
import { COVERAGE_LEVELS, benefitEligibility, listMyEnrollments } from "@/lib/hr/benefits";
import Link from "@/hr/platform/link";
import { Badge, Card, DataTable, EmptyState, ErrorState, Loading, PageHeader, StatusBadge } from "@/hr/ui";

export default function MyBenefitsPage() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const mine = useHrQuery(() => listMyEnrollments(me), [me]);
  const elig = useHrQuery(() => benefitEligibility(me), [me]);
  if (mine.loading && !mine.data) return <Loading />;
  if (mine.error) return <ErrorState message={mine.error} onRetry={mine.reload} />;
  const live = (mine.data ?? []).filter((r) => ["active", "suspended"].includes(r.status));
  const past = (mine.data ?? []).filter((r) => !["active", "suspended"].includes(r.status));
  return (
    <>
      <PageHeader title="My benefits" description={<>Your benefit enrollments. For changes or questions, raise a <Link href="/employee/requests" className="font-semibold text-[#1f4693] hover:underline">Benefits query</Link>.</>} />
      <div className="flex flex-col gap-4">
        {!live.length ? <Card><EmptyState icon={HeartPulse} title="No active benefits" description="When HR enrolls you in a plan, it appears here." /></Card> : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {live.map((r) => (
              <Card key={r.id} title={<span className="flex flex-wrap items-center gap-2">{r.benefit?.name}<StatusBadge status={r.status} /></span>}>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs font-semibold uppercase text-slate-500">Coverage</dt><dd>{COVERAGE_LEVELS.find((c) => c.value === r.coverage_level)?.label}{r.dependants ? ` · ${r.dependants} dependants` : ""}</dd></div>
                  <div><dt className="text-xs font-semibold uppercase text-slate-500">Since</dt><dd>{formatDate(r.start_date)}</dd></div>
                  <div><dt className="text-xs font-semibold uppercase text-slate-500">Employer contribution</dt><dd>{formatMoney(r.employer_contribution)}</dd></div>
                  <div><dt className="text-xs font-semibold uppercase text-slate-500">Your contribution</dt><dd>{formatMoney(r.employee_contribution)}</dd></div>
                  {r.policy_number && <div><dt className="text-xs font-semibold uppercase text-slate-500">Policy / member no.</dt><dd className="font-mono">{r.policy_number}</dd></div>}
                  {r.benefit?.provider && <div><dt className="text-xs font-semibold uppercase text-slate-500">Provider</dt><dd>{r.benefit.provider}</dd></div>}
                </dl>
                {r.benefit?.description && <p className="mt-3 text-sm text-slate-600">{r.benefit.description}</p>}
              </Card>
            ))}
          </div>
        )}
        <Card title="Available plans">
          {elig.error ? <ErrorState message={elig.error} onRetry={elig.reload} /> : (
            <DataTable caption="Available benefit plans" rows={elig.data} loading={elig.loading} rowKey="benefit_type_id" emptyTitle="No benefit plans configured"
              columns={[
                { key: "name", header: "Plan", render: (r) => <span className="font-semibold text-[#101a3a]">{r.name}</span> },
                { key: "category", header: "Category", render: (r) => <Badge tone="blue">{r.category}</Badge> },
                { key: "status", header: "Your status", render: (r) => (r.enrolled ? <Badge tone="green">enrolled</Badge> : r.eligible ? <Badge tone="blue">eligible</Badge> : <span className="text-xs text-slate-600">{r.reason}</span>) },
              ]} />
          )}
        </Card>
        {past.length > 0 && (
          <Card title="Past enrollments">
            <DataTable caption="Past enrollments" rows={past} pageSize={10} columns={[
              { key: "plan", header: "Plan", render: (r) => r.benefit?.name },
              { key: "period", header: "Period", render: (r) => `${formatDate(r.start_date)} – ${formatDate(r.end_date)}` },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            ]} />
          </Card>
        )}
      </div>
    </>
  );
}
