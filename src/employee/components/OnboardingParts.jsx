// Employee Portal — onboarding pieces used on existing pages (there is no
// separate My Onboarding page):
//   JoiningChecklistCard     My Dashboard, only while the onboarding case is open
//   OnboardingAckCard        My Documents → Acknowledgements
// Data comes from hr_my_lifecycle(), which never includes HR notes, evidence
// notes, manager feedback or HR comments. Acknowledging calls
// hr_acknowledge_onboarding_task, which re-checks ownership and case state.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ban, CheckCircle2, Circle, ClipboardCheck, Clock3, ShieldCheck } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/hr/client";
import { TASK_CATEGORIES, acknowledgeOnboardingTask } from "@/lib/hr/lifecycle";
import { Badge, Button, Card, ConfirmDialog, ErrorState, Loading, useToast } from "@/hr/ui";
import { DueDate, Progress } from "@/hr/pages/lifecycle/shared";

const DONE = ["completed", "waived"];
const catLabel = (c) => TASK_CATEGORIES.find((x) => x.value === c)?.label ?? c;
const OWNER = { hr: "HR", manager: "Your manager", it: "IT", payroll: "Payroll", employee: "You" };

/** The open onboarding case from an hr_my_lifecycle() payload, or null. */
export function openOnboarding(lifecycle) {
  const o = lifecycle?.onboarding;
  return o && o.status === "open" ? o : null;
}

/** Onboarding tasks still waiting for the employee's acknowledgement. */
export function pendingOnboardingAcks(lifecycle) {
  return (openOnboarding(lifecycle)?.tasks ?? []).filter((t) => t.kind === "acknowledgement" && !DONE.includes(t.status));
}

function TaskIcon({ status }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />;
  if (status === "waived") return <Ban className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />;
  if (status === "in_progress") return <Clock3 className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />;
  return <Circle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />;
}

/** My Dashboard card. Renders nothing unless onboarding is open. */
export function JoiningChecklistCard({ query }) {
  const navigate = useNavigate();
  const o = openOnboarding(query.data);
  if (!o) return null;
  const tasks = o.tasks ?? [];
  const done = tasks.filter((t) => DONE.includes(t.status)).length;
  const acks = pendingOnboardingAcks(query.data).length;
  const missingDocs = query.data?.missing_documents;
  const next = tasks.filter((t) => !DONE.includes(t.status)).slice(0, 5);
  return (
    <Card className="mb-4"
      title={<span className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-[#f96706]" aria-hidden="true" />Joining checklist</span>}
      actions={acks > 0 && <Button size="sm" onClick={() => navigate("/employee/documents?tab=acknowledgements")}><ShieldCheck className="h-4 w-4" aria-hidden="true" />Acknowledge ({acks})</Button>}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Progress</p>
          <Progress done={done} total={tasks.length} tone={done === tasks.length ? "green" : "orange"} />
          <p className="text-xs text-slate-500">
            Joining {formatDate(o.actual_joining_date ?? o.joining_date)}
            {o.coordinator ? ` · HR coordinator: ${o.coordinator}` : ""}{o.manager ? ` · Manager: ${o.manager}` : ""}
          </p>
          {acks > 0 && <p className="text-sm font-medium text-amber-900">{acks} item(s) need your acknowledgement.</p>}
          {missingDocs && (
            <p className="text-sm text-amber-900">Documents still needed: <strong>{missingDocs}</strong>.{" "}
              <button type="button" className="font-semibold text-[#1f4693] hover:underline" onClick={() => navigate("/employee/documents?tab=uploads")}>Upload in My Documents</button>
            </p>
          )}
        </div>
        <div className="md:col-span-2">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Still to do</p>
          {!next.length ? <p className="text-sm text-emerald-700">Every checklist item is done. HR will close your onboarding.</p> : (
            <ul className="flex flex-col gap-1.5">
              {next.map((t) => (
                <li key={t.id} className="flex items-start gap-2 text-sm">
                  <TaskIcon status={t.status} />
                  <span className="min-w-0">
                    <span className="font-semibold text-[#101a3a]">{t.title}</span>
                    {t.kind === "acknowledgement" && <> <Badge tone="violet">Needs your acknowledgement</Badge></>}
                    <span className="block text-xs text-slate-500">{catLabel(t.category)} · {OWNER[t.owner_role] ?? t.owner_role} · Due <DueDate value={t.due_date} status={t.status} /></span>
                  </span>
                </li>
              ))}
              {tasks.length - done > next.length && <li className="text-xs text-slate-500">and {tasks.length - done - next.length} more</li>}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

/** My Documents → Acknowledgements: onboarding items HR is waiting on. */
export function OnboardingAckCard({ query, onChanged }) {
  const { notify } = useToast();
  const [ack, setAck] = useState(null);
  const o = openOnboarding(query.data);
  if (query.loading && !query.data) return <Card title="Onboarding acknowledgements"><Loading /></Card>;
  if (query.error) return <Card title="Onboarding acknowledgements"><ErrorState message={query.error} onRetry={query.reload} /></Card>;
  if (!o) return null;
  const pending = pendingOnboardingAcks(query.data);
  const acknowledged = (o.tasks ?? []).filter((t) => t.kind === "acknowledgement" && t.acknowledged_at);
  if (!pending.length && !acknowledged.length) return null;
  return (
    <Card title="Onboarding acknowledgements" actions={pending.length > 0 && <Badge tone="amber">{pending.length}</Badge>}>
      {!pending.length ? (
        <p className="text-sm text-emerald-700">All caught up: HR is not waiting for any onboarding acknowledgement from you.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pending.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-[#101a3a]">{t.title}</span> <Badge tone="violet">onboarding</Badge>
                <span className="block text-xs text-slate-500">{catLabel(t.category)} · Due <DueDate value={t.due_date} status={t.status} /></span>
                {t.description && <span className="mt-1 block text-sm text-slate-600">{t.description}</span>}
              </span>
              <Button size="sm" onClick={() => setAck(t)}><ShieldCheck className="h-4 w-4" aria-hidden="true" />Acknowledge</Button>
            </li>
          ))}
        </ul>
      )}
      {acknowledged.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
          {acknowledged.map((t) => <li key={t.id}><CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />{t.title}: acknowledged {formatDateTime(t.acknowledged_at)}</li>)}
        </ul>
      )}
      <ConfirmDialog open={Boolean(ack)} onClose={() => setAck(null)} title={ack?.title ?? "Acknowledge"} tone="success"
        message={`${ack?.description ? `${ack.description} ` : ""}By acknowledging you confirm you have read and will follow this item. Your acknowledgement is recorded with the date and time.`}
        confirmLabel="I acknowledge"
        onConfirm={async () => { const res = await acknowledgeOnboardingTask(ack.id); if (!res.error) { notify("Acknowledgement recorded."); onChanged?.(); } return res; }} />
    </Card>
  );
}
