// Review cycles: create / edit (draft or active), start (creates the reviews
// for in-scope employees, re-runnable for new joiners), recompute goal scores,
// close. performance.manage only; others see the list read-only.
import { useState } from "react";
import { Calculator, Lock, Pencil, Play, Plus, UserPlus } from "lucide-react";
import { formatDate } from "@/lib/hr/client";
import { closeCycle, computeScores, saveCycle, startCycle } from "@/lib/hr/performance";
import { CYCLE_TYPES, label } from "@/lib/hr/performanceRules";
import { Button, ConfirmDialog, DataTable, Field, Input, Select, Toolbar, useToast } from "@/hr/ui";
import { ActionModal, PerfBadge, opts } from "./shared";

function CycleForm({ cycle, onClose, onSaved }) {
  const isNew = !cycle?.id;
  const [v, setV] = useState({ name: "", cycle_type: "quarterly", period_start: "", period_end: "", self_assessment_due: "", manager_review_due: "", ...(cycle ?? {}) });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <ActionModal title={isNew ? "New review cycle" : `Edit ${cycle.name}`} submitLabel={isNew ? "Create cycle" : "Save"} onClose={onClose}
      onSubmit={async () => {
        if ((v.name ?? "").trim().length < 2) return { error: "Name the cycle (2–120 characters)." };
        if (!v.period_start || !v.period_end) return { error: "Choose the review period." };
        if (v.period_end < v.period_start) return { error: "The period cannot end before it starts." };
        if (v.self_assessment_due && v.manager_review_due && v.manager_review_due < v.self_assessment_due) return { error: "The manager review is due after the self-assessment." };
        const res = await saveCycle(v, cycle?.id);
        if (res.error) return { error: /duplicate|already exists/i.test(res.error) ? "A cycle with this name already exists." : res.error };
        onSaved(isNew); return {};
      }}>
      <Field label="Cycle name" required hint="e.g. FY 2026–27 H2 review"><Input value={v.name} maxLength={120} onChange={set("name")} /></Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Cycle type" required hint="Intern cycles cover interns only; others cover everyone else.">
          <Select value={v.cycle_type} onChange={set("cycle_type")} options={opts(CYCLE_TYPES)} disabled={!isNew && cycle.status !== "draft"} />
        </Field>
        <span />
        <Field label="Period start" required><Input type="date" value={v.period_start} onChange={set("period_start")} /></Field>
        <Field label="Period end" required><Input type="date" value={v.period_end} onChange={set("period_end")} /></Field>
        <Field label="Self-assessment due"><Input type="date" value={v.self_assessment_due ?? ""} onChange={set("self_assessment_due")} /></Field>
        <Field label="Manager review due"><Input type="date" value={v.manager_review_due ?? ""} onChange={set("manager_review_due")} /></Field>
      </div>
      <p className="text-xs text-slate-500">New cycles start as draft. Starting a cycle creates a review for every active / probation employee who joined by the period end and notifies them.</p>
    </ActionModal>
  );
}

export default function CyclesTab({ ctx }) {
  const { notify } = useToast();
  const [modal, setModal] = useState(null);   // { type, row }
  const close = () => setModal(null);
  const done = (msg) => { notify(msg); ctx.reloadCycles(); };
  return (
    <>
      {ctx.canManage && <Toolbar><Button onClick={() => setModal({ type: "form" })}><Plus className="h-4 w-4" aria-hidden="true" />New review cycle</Button></Toolbar>}
      <DataTable caption="Review cycles" rows={ctx.cycles} loading={ctx.cyclesLoading} error={ctx.cyclesError} onRetry={ctx.reloadCycles}
        emptyTitle="No review cycles" emptyDescription={ctx.canManage ? "Create the first cycle to set goals and run reviews." : undefined}
        columns={[
          { key: "name", header: "Cycle", sortable: true, render: (r) => <span className="font-semibold text-[#101a3a]">{r.name}</span> },
          { key: "cycle_type", header: "Type", render: (r) => label(r.cycle_type) },
          { key: "period_start", header: "Period", sortable: true, render: (r) => `${formatDate(r.period_start)} – ${formatDate(r.period_end)}` },
          { key: "self_assessment_due", header: "Self due", render: (r) => formatDate(r.self_assessment_due) },
          { key: "manager_review_due", header: "Manager due", render: (r) => formatDate(r.manager_review_due) },
          { key: "status", header: "Status", render: (r) => <PerfBadge value={r.status} /> },
          ...(ctx.canManage ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (
            <span className="flex flex-wrap gap-1">
              {r.status !== "closed" && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "form", row: r })}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>}
              {r.status === "draft" && <Button size="sm" variant="success" onClick={() => setModal({ type: "start", row: r })}><Play className="h-4 w-4" aria-hidden="true" />Start</Button>}
              {r.status === "active" && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "start", row: r })}><UserPlus className="h-4 w-4" aria-hidden="true" />Add joiners</Button>}
              {r.status !== "draft" && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "scores", row: r })}><Calculator className="h-4 w-4" aria-hidden="true" />Scores</Button>}
              {r.status === "active" && <Button size="sm" variant="secondary" onClick={() => setModal({ type: "close", row: r })}><Lock className="h-4 w-4" aria-hidden="true" />Close</Button>}
            </span>) }] : []),
        ]} />
      {modal?.type === "form" && <CycleForm cycle={modal.row} onClose={close} onSaved={(isNew) => { close(); done(isNew ? "Review cycle created as draft." : "Review cycle saved."); }} />}
      <ConfirmDialog open={modal?.type === "start"} onClose={close} title={modal?.row?.status === "draft" ? `Start ${modal?.row?.name}?` : `Add new joiners to ${modal?.row?.name}?`}
        message={modal?.row?.status === "draft" ? "The cycle becomes active and a review is created for every in-scope employee, who is notified. Goals can then be set and assessed." : "Creates reviews for in-scope employees who do not have one yet."}
        confirmLabel={modal?.row?.status === "draft" ? "Start cycle" : "Add joiners"}
        onConfirm={async () => { const res = await startCycle(modal.row.id); if (res.error) return res; done(`${res.data?.reviews_created ?? 0} review(s) created.`); return {}; }} />
      <ConfirmDialog open={modal?.type === "scores"} onClose={close} title="Recompute goal scores"
        message="Recalculates every goal score from its KPI formula, target and actual, and rolls the weighted score up to the reviews that are not finalized."
        confirmLabel="Recompute"
        onConfirm={async () => { const res = await computeScores(modal.row.id); if (res.error) return res; done(`${res.data?.goals_scored ?? 0} goal(s) scored, ${res.data?.reviews_updated ?? 0} review(s) updated.`); return {}; }} />
      <ConfirmDialog open={modal?.type === "close"} onClose={close} title={`Close ${modal?.row?.name}?`} tone="danger"
        message="Closing freezes goals, progress and assessments for this cycle. It cannot be reopened. Reviews that are not finalized stay as they are."
        confirmLabel="Close cycle"
        onConfirm={async () => { const res = await closeCycle(modal.row.id); if (res.error) return res; done(`Cycle closed${res.data?.unfinalized_reviews ? ` — ${res.data.unfinalized_reviews} review(s) were not finalized` : ""}.`); return {}; }} />
    </>
  );
}
