// Employee Portal — My Onboarding: joining checklist, induction (with
// acknowledgements), required documents and probation status. Data comes
// from hr_my_lifecycle(), which never includes HR notes, evidence notes,
// manager feedback or HR comments.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Ban, CheckCircle2, Circle, Clock3, FileText, Hourglass, ShieldCheck } from "lucide-react";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { INDUCTION_CATEGORIES, TASK_CATEGORIES, acknowledgeOnboardingTask, myLifecycle } from "@/lib/hr/lifecycle";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Loading, PageHeader, StatusBadge, Tabs, useToast } from "@/hr/ui";
import { DueDate, LifecycleTimeline, Progress, lifecycleSteps } from "@/hr/pages/lifecycle/shared";

const catLabel = (c) => TASK_CATEGORIES.find((x) => x.value === c)?.label ?? c;
const OWNER = { hr: "HR", manager: "Your manager", it: "IT", payroll: "Payroll", employee: "You" };

function TaskList({ tasks, onAck }) {
  if (!tasks.length) return <EmptyState title="Nothing here" description="No items in this list." />;
  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((t) => {
        const done = ["completed", "waived"].includes(t.status);
        const Icon = t.status === "completed" ? CheckCircle2 : t.status === "waived" ? Ban : t.status === "in_progress" ? Clock3 : Circle;
        return (
          <li key={t.id} className="rounded-xl border border-slate-100 px-3 py-2.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-[#101a3a]">
                  <Icon className={t.status === "completed" ? "h-4 w-4 text-emerald-600" : t.status === "waived" ? "h-4 w-4 text-slate-400" : "h-4 w-4 text-amber-500"} aria-hidden="true" />
                  {t.title}
                  {t.kind === "acknowledgement" && !done && <Badge tone="violet">Needs your acknowledgement</Badge>}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{catLabel(t.category)} · {OWNER[t.owner_role] ?? t.owner_role} · Due <DueDate value={t.due_date} status={t.status} />{t.completed_at ? ` · done ${formatDate(t.completed_at)}` : ""}</p>
                {t.description && <p className="mt-1 text-sm text-slate-600">{t.description}</p>}
                {t.kind === "training" && t.training_status && <p className="mt-1 text-xs text-slate-500">Training: <StatusBadge status={t.training_status} /> — open <Link className="font-semibold text-[#1f4693] hover:underline" to="/employee/training">My Training</Link></p>}
                {t.acknowledged_at && <p className="mt-1 text-xs text-emerald-700">You acknowledged this on {formatDateTime(t.acknowledged_at)}.</p>}
              </div>
              {t.kind === "acknowledgement" && !done && <Button size="sm" onClick={() => onAck(t)}><ShieldCheck className="h-4 w-4" aria-hidden="true" />Acknowledge</Button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function MyOnboardingPage() {
  const { notify } = useToast();
  const q = useHrQuery(myLifecycle, []);
  const [tab, setTab] = useState("checklist");
  const [ack, setAck] = useState(null);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  const d = q.data ?? {};
  const o = d.onboarding;
  const tasks = o?.tasks ?? [];
  const induction = tasks.filter((t) => INDUCTION_CATEGORIES.includes(t.category));
  const checklist = tasks.filter((t) => !INDUCTION_CATEGORIES.includes(t.category));
  const doneCount = tasks.filter((t) => ["completed", "waived"].includes(t.status)).length;
  const pendingAck = tasks.filter((t) => t.kind === "acknowledgement" && !["completed", "waived"].includes(t.status)).length;
  const p = d.probation ?? {};
  return (
    <>
      <PageHeader title="My Onboarding" description="Your joining checklist, induction, documents and probation status." />
      <Card className="mb-4"><LifecycleTimeline steps={lifecycleSteps({ employee: d.employee, onboarding: o, exit: d.exit, settlement: d.settlement })} title="My employment timeline" /></Card>
      {!o ? (
        <Card><EmptyState title="No onboarding checklist" description="HR has not opened an onboarding checklist for you. If you have just joined, it will appear here." /></Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Checklist progress</p><div className="mt-2"><Progress done={doneCount} total={tasks.length} tone={doneCount === tasks.length ? "green" : "orange"} /></div><p className="mt-1 text-xs text-slate-500">{o.status === "completed" ? `Completed ${formatDate(o.completed_at)}` : "In progress"}</p></Card>
            <Card><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Joining</p><p className="mt-1 text-sm font-semibold text-[#101a3a]">{formatDate(o.actual_joining_date ?? o.joining_date)}</p><p className="text-xs text-slate-500">HR coordinator: {o.coordinator || "—"} · Manager: {o.manager || "—"}</p></Card>
            <Card><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Needs you</p><p className="mt-1 text-sm font-semibold text-[#101a3a]">{pendingAck ? `${pendingAck} acknowledgement(s)` : "Nothing right now"}</p>{d.missing_documents && <p className="text-xs text-amber-800">Documents still needed: {d.missing_documents}</p>}</Card>
          </div>
          <Tabs value={tab} onChange={setTab} label="Onboarding sections" tabs={[
            { value: "checklist", label: "Joining checklist", count: checklist.length },
            { value: "induction", label: "Induction", count: induction.length },
            { value: "documents", label: "Documents" },
            { value: "probation", label: "Probation" },
          ]} />
          {tab === "checklist" && <Card><TaskList tasks={checklist} onAck={setAck} /></Card>}
          {tab === "induction" && <Card><TaskList tasks={induction} onAck={setAck} /></Card>}
        </>
      )}
      {(tab === "documents" || !o) && (
        <Card className="mt-4" title={<span className="inline-flex items-center gap-2"><FileText className="h-4 w-4" aria-hidden="true" />Required documents</span>}>
          {d.missing_documents ? <p className="text-sm text-amber-900">Still needed or awaiting verification: <strong>{d.missing_documents}</strong>.</p> : <p className="text-sm text-emerald-700">All required documents are verified.</p>}
          <p className="mt-2 text-sm text-slate-600">Upload documents in <Link className="font-semibold text-[#1f4693] hover:underline" to="/employee/documents">My Documents</Link>. HR is notified of every upload and verifies it.</p>
        </Card>
      )}
      {(tab === "probation" || !o) && (
        <Card className="mt-4" title={<span className="inline-flex items-center gap-2"><Hourglass className="h-4 w-4" aria-hidden="true" />Probation</span>}>
          {!p.probation_end_date && !p.confirmation_date ? <p className="text-sm text-slate-600">No probation period applies to you.</p> : (
            <ul className="flex flex-col gap-1.5 text-sm">
              <li>Status: <strong>{p.in_probation ? "On probation" : p.confirmation_date ? "Confirmed" : d.employee?.status?.replace(/_/g, " ")}</strong></li>
              {p.probation_end_date && <li>Probation end date: <strong>{formatDate(p.probation_end_date)}</strong></li>}
              {p.confirmation_date && <li>Confirmed on: <strong>{formatDate(p.confirmation_date)}</strong></li>}
              {p.review_open && <li className="text-slate-600">Your probation review is in progress.</li>}
              {p.last_decision?.decision === "extended" && <li className="text-orange-800">Probation extended to {formatDate(p.last_decision.extended_to)}.</li>}
            </ul>
          )}
        </Card>
      )}
      <ConfirmDialog open={Boolean(ack)} onClose={() => setAck(null)} title={ack?.title ?? "Acknowledge"}
        message={`${ack?.description ? `${ack.description} ` : ""}By acknowledging you confirm you have read and will follow this policy. Your acknowledgement is recorded with the date and time.`}
        confirmLabel="I acknowledge"
        onConfirm={async () => { const res = await acknowledgeOnboardingTask(ack.id); if (!res.error) { notify("Acknowledgement recorded."); q.reload(); } return res; }} />
    </>
  );
}
