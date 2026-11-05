// Employee Portal — My Training: own assignments; start a course, report
// completion (stays "unverified" until HR / the manager verifies) and see
// certificates. RLS limits rows to the employee's own assignments.
import { useState } from "react";
import { GraduationCap } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, useHrQuery } from "@/lib/hr/client";
import { isOverdue, listMyAssignments, startTraining } from "@/lib/hr/training";
import { CompleteModal } from "@/hr/pages/TrainingPage";
import Link from "@/hr/platform/link";
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Loading, PageHeader, StatusBadge, Tabs, useToast } from "@/hr/ui";

export default function MyTrainingPage() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const { notify } = useToast();
  const q = useHrQuery(() => listMyAssignments(me), [me]);
  const [tab, setTab] = useState("open");
  const [completing, setCompleting] = useState(null);
  const [busy, setBusy] = useState(null);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  const all = q.data ?? [];
  const open = all.filter((a) => ["assigned", "in_progress"].includes(a.status));
  const done = all.filter((a) => a.status === "completed");
  async function start(a) {
    setBusy(a.id); const r = await startTraining(a.id); setBusy(null);
    if (r.error) notify(r.error, "error"); else { notify("Training started."); q.reload(); }
  }
  return (
    <>
      <PageHeader title="My training" description={<>Assigned courses and your completion record. Certificates are uploaded in <Link href="/employee/documents" className="font-semibold text-[#1f4693] hover:underline">My Documents</Link> (category “Training certificate”).</>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "open", label: "To do", count: open.length }, { value: "done", label: "Completed", count: done.length }]} label="Training" />
      {tab === "open" && (!open.length ? <Card><EmptyState icon={GraduationCap} title="Nothing assigned" description="Courses assigned by HR or your manager appear here." /></Card> : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {open.map((a) => (
            <Card key={a.id} title={<span className="flex flex-wrap items-center gap-2">{a.course?.title}{a.course?.is_mandatory && <Badge tone="red">mandatory</Badge>}<StatusBadge status={a.status} />{isOverdue(a) && <Badge tone="red">overdue</Badge>}</span>}>
              <p className="text-sm text-slate-600">{a.course?.description || "No description."}</p>
              <p className="mt-2 text-xs text-slate-500">{[a.course?.delivery_mode?.replace(/_/g, " "), a.course?.duration_hours && `${a.course.duration_hours} h`, a.course?.provider, a.due_date && `due ${formatDate(a.due_date)}`, a.course?.pass_score != null && `pass mark ${a.course.pass_score}`, a.course?.certificate_required && "certificate required"].filter(Boolean).join(" · ")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {a.status === "assigned" && <Button size="sm" variant="secondary" loading={busy === a.id} onClick={() => start(a)}>Start</Button>}
                <Button size="sm" onClick={() => setCompleting(a)}>Mark complete</Button>
              </div>
            </Card>
          ))}
        </div>
      ))}
      {tab === "done" && (
        <DataTable caption="Completed training" rows={done} pageSize={15} emptyTitle="No completed training yet" columns={[
          { key: "course", header: "Course", render: (a) => a.course?.title },
          { key: "completion_date", header: "Completed", render: (a) => formatDate(a.completion_date) },
          { key: "result", header: "Result", render: (a) => `${a.result}${a.score != null ? ` · ${a.score}` : ""}` },
          { key: "verified", header: "Verification", render: (a) => (a.verified_at ? <Badge tone="green">verified</Badge> : <Badge tone="amber">awaiting verification</Badge>) },
          { key: "certificate", header: "Certificate", render: (a) => (a.certificate ? `${a.certificate.title}${a.certificate_expiry ? ` · valid to ${formatDate(a.certificate_expiry)}` : ""}` : "—") },
        ]} />
      )}
      {completing && <CompleteModal self assignment={{ ...completing, employee_id: me }} onClose={() => setCompleting(null)} onDone={() => { setCompleting(null); q.reload(); notify("Completion submitted for verification."); }} />}
    </>
  );
}
