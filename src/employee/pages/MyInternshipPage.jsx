// Employee Portal — My Internship: the intern's own internship and FINALIZED
// evaluations (RLS hides drafts and other interns' records).
import { useAuth } from "@/hr/platform/auth";
import { formatDate, from, fullName, run, useHrQuery } from "@/lib/hr/client";
import { Badge, Card, DescriptionList, EmptyState, ErrorState, Loading, PageHeader, StatusBadge } from "@/hr/ui";

const CRITERIA = ["technical", "communication", "ownership", "learning", "teamwork"];

export default function MyInternshipPage() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const internships = useHrQuery(() => run(from("hr_internships")
    .select("id, start_date, end_date, project, learning_goals, status, completion_date, certificate_eligible, certificate_issued_at, mentor:hr_employees!hr_internships_mentor_id_fkey(first_name, last_name, display_name)")
    .eq("employee_id", me).order("start_date", { ascending: false })), [me]);
  const ids = (internships.data ?? []).map((i) => i.id);
  const evals = useHrQuery(() => (ids.length
    ? run(from("hr_intern_evaluations").select("id, internship_id, period, period_start, period_end, ratings, overall_rating, comments, recommendation, finalized_at").in("internship_id", ids).eq("status", "finalized").order("finalized_at", { ascending: false }))
    : Promise.resolve({ data: [], error: null })), [ids.join(",")]);

  if (internships.loading && !internships.data) return <Loading />;
  if (internships.error) return <ErrorState message={internships.error} onRetry={internships.reload} />;
  if (!internships.data?.length) return <EmptyState title="No internship on record" description="This page shows your internship programme and evaluations." />;

  return (
    <>
      <PageHeader title="My internship" />
      <div className="flex flex-col gap-4">
        {internships.data.map((i) => (
          <Card key={i.id} title={<span className="flex items-center gap-2">{i.project || "Internship"} <StatusBadge status={i.status} /></span>}>
            <DescriptionList items={[
              { label: "Mentor", value: i.mentor ? fullName(i.mentor) : null },
              { label: "Period", value: `${formatDate(i.start_date)} – ${formatDate(i.end_date)}` },
              { label: "Learning goals", value: i.learning_goals },
              { label: "Completion", value: i.completion_date ? formatDate(i.completion_date) : null },
              { label: "Certificate", value: i.certificate_issued_at ? `Issued ${formatDate(i.certificate_issued_at)}` : i.certificate_eligible ? "Eligible" : "Not yet eligible" },
            ]} />
            <h3 className="mt-5 text-sm font-bold text-[#101a3a]">Evaluations</h3>
            {evals.loading && !evals.data ? <Loading /> : evals.error ? <ErrorState message={evals.error} onRetry={evals.reload} /> : (
              (evals.data ?? []).filter((e) => e.internship_id === i.id).length === 0
                ? <p className="mt-2 text-sm text-slate-600">No finalized evaluations yet.</p>
                : (
                  <ul className="mt-2 flex flex-col gap-3">
                    {evals.data.filter((e) => e.internship_id === i.id).map((e) => (
                      <li key={e.id} className="rounded-xl border border-slate-100 p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-[#101a3a]">{e.period || `${formatDate(e.period_start)} – ${formatDate(e.period_end)}`}</span>
                          {e.overall_rating != null && <Badge tone="blue">overall {e.overall_rating}/5</Badge>}
                          {e.recommendation && <Badge tone="violet">{String(e.recommendation).replace(/_/g, " ")}</Badge>}</div>
                        <div className="mt-2 flex flex-wrap gap-2">{CRITERIA.filter((c) => e.ratings?.[c] != null).map((c) => <Badge key={c}>{c}: {e.ratings[c]}/5</Badge>)}</div>
                        {e.comments && <p className="mt-2 text-slate-700">{e.comments}</p>}
                      </li>
                    ))}
                  </ul>
                )
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
