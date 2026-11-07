// Improvement plans (PIP): objectives, success criteria, support, start / end,
// owner; dated check-ins (on track / at risk / off track); outcome (extend
// with a new end date, completed, failed, cancelled). The employee sees and
// acknowledges their plan in the portal.
import { useMemo, useState } from "react";
import { ClipboardCheck, Flag, Pencil, Plus } from "lucide-react";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { addCheckin, closePlan, listCheckins, listPlans, listReviews, savePlan } from "@/lib/hr/performance";
import { PIP_OUTCOMES, PIP_PROGRESS, PIP_STATUSES, label } from "@/lib/hr/performanceRules";
import { Button, Card, DataTable, DescriptionList, Field, Input, Loading, Modal, Select, Textarea, Toolbar, useToast } from "@/hr/ui";
import { ActionModal, PerfBadge, TextBlock, empText, opts, todayLocal } from "./shared";

function PlanForm({ ctx, plan, onClose, onSaved }) {
  const isNew = !plan?.id;
  const [v, setV] = useState({ employee_id: "", title: "", objectives: "", success_criteria: "", support: "", start_date: todayLocal(), end_date: "", owner_id: ctx.me ?? "", review_id: "", ...(plan ?? {}) });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const reviews = useHrQuery(() => (v.employee_id ? listReviews({ employee: v.employee_id }) : Promise.resolve({ data: [] })), [v.employee_id]);
  const owners = ctx.employees.filter((e) => e.id !== v.employee_id).map((e) => ({ value: e.id, label: empText(e) }));
  return (
    <ActionModal title={isNew ? "New improvement plan" : "Edit improvement plan"} size="lg" submitLabel={isNew ? "Create plan" : "Save"} onClose={onClose}
      onSubmit={async () => {
        if (!v.employee_id) return { error: "Choose the employee." };
        if ((v.title ?? "").trim().length < 2) return { error: "Give the plan a title." };
        if (!(v.objectives ?? "").trim()) return { error: "Write the objectives." };
        if (!v.start_date || !v.end_date) return { error: "Choose the start and end dates." };
        if (v.end_date < v.start_date) return { error: "The plan cannot end before it starts." };
        const res = await savePlan(v, plan?.id);
        if (res.error) return res;
        onSaved(isNew); return {};
      }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Employee" required><Select placeholder="Choose an employee" value={v.employee_id} disabled={!isNew} onChange={(e) => setV((s) => ({ ...s, employee_id: e.target.value, review_id: "" }))} options={ctx.manageableOptions} /></Field>
        <Field label="Plan owner" hint="Runs the check-ins (not the employee)"><Select placeholder="— Me —" value={v.owner_id ?? ""} onChange={set("owner_id")} options={owners} /></Field>
        <Field label="Title" required className="sm:col-span-2"><Input value={v.title ?? ""} maxLength={200} onChange={set("title")} /></Field>
        <Field label="Start date" required><Input type="date" value={v.start_date} onChange={set("start_date")} /></Field>
        <Field label="End date" required><Input type="date" value={v.end_date} onChange={set("end_date")} /></Field>
        <Field label="Linked review" className="sm:col-span-2"><Select placeholder="— None —" value={v.review_id ?? ""} onChange={set("review_id")}
          options={(reviews.data ?? []).map((r) => ({ value: r.id, label: `${r.cycle?.name ?? "Review"} · ${label(r.status)}` }))} /></Field>
        <Field label="Objectives" required className="sm:col-span-2" hint="One per line: what must improve, measurably."><Textarea rows={5} value={v.objectives} maxLength={5000} onChange={set("objectives")} /></Field>
        <Field label="Success criteria" className="sm:col-span-2"><Textarea value={v.success_criteria ?? ""} maxLength={5000} onChange={set("success_criteria")} /></Field>
        <Field label="Support provided" className="sm:col-span-2" hint="Training, mentoring, tools, check-in frequency."><Textarea value={v.support ?? ""} maxLength={5000} onChange={set("support")} /></Field>
      </div>
      {isNew && <p className="text-xs text-slate-500">The employee is notified and can acknowledge the plan in their portal. Outcomes are recorded with “Record outcome”.</p>}
    </ActionModal>
  );
}

function PlanDetail({ ctx, plan, onClose, onChanged }) {
  const { notify } = useToast();
  const checkins = useHrQuery(() => listCheckins({ plan: plan.id }), [plan.id]);
  const [mode, setMode] = useState(null);
  const [ci, setCi] = useState({ checkin_date: todayLocal(), progress: "on_track", notes: "" });
  const [out, setOut] = useState({ outcome: "completed", notes: "", new_end: "" });
  const open = ["active", "extended"].includes(plan.status);
  const canAct = open && (ctx.canManageEmployee(plan.employee_id) || (plan.owner_id === ctx.me && plan.employee_id !== ctx.me));
  const canClose = open && ctx.canManageEmployee(plan.employee_id);
  const done = (msg) => { notify(msg); setMode(null); checkins.reload(); onChanged(); };
  return (
    <Modal open onClose={onClose} size="xl" title={`${plan.title ?? "Improvement plan"} · ${empText(plan.employee)}`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {canClose && <Button variant="ghost" onClick={() => setMode("edit")}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>}
        {canAct && <Button variant="secondary" onClick={() => setMode("checkin")}><ClipboardCheck className="h-4 w-4" aria-hidden="true" />Add check-in</Button>}
        {canClose && <Button onClick={() => setMode("outcome")}><Flag className="h-4 w-4" aria-hidden="true" />Record outcome</Button>}
      </>}>
      <div className="flex flex-col gap-4">
        <DescriptionList items={[
          { label: "Status", value: <PerfBadge value={plan.status} /> },
          { label: "Period", value: `${formatDate(plan.start_date)} – ${formatDate(plan.end_date)}` },
          { label: "Owner", value: empText(plan.owner) },
          { label: "Employee acknowledged", value: plan.employee_acknowledged_at ? formatDateTime(plan.employee_acknowledged_at) : "Not yet" },
          plan.closed_at && { label: "Closed", value: formatDateTime(plan.closed_at) },
        ]} />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card title="Objectives"><TextBlock>{plan.objectives}</TextBlock></Card>
          <Card title="Success criteria"><TextBlock>{plan.success_criteria}</TextBlock></Card>
          <Card title="Support"><TextBlock>{plan.support}</TextBlock></Card>
          <Card title="Employee comment"><TextBlock empty="No comment.">{plan.employee_comment}</TextBlock></Card>
        </div>
        {plan.outcome_notes && <Card title="Outcome notes"><TextBlock>{plan.outcome_notes}</TextBlock></Card>}
        <Card title="Check-ins" padded={false}>
          {checkins.loading && !checkins.data ? <Loading /> : (
            <DataTable caption="Check-ins" rows={checkins.data} error={checkins.error} onRetry={checkins.reload} emptyTitle="No check-ins yet"
              columns={[
                { key: "checkin_date", header: "Date", render: (c) => formatDate(c.checkin_date) },
                { key: "progress", header: "Progress", render: (c) => <PerfBadge value={c.progress} /> },
                { key: "notes", header: "Notes", render: (c) => <span className="whitespace-pre-wrap">{c.notes}</span> },
              ]} />
          )}
        </Card>
      </div>
      {mode === "edit" && <PlanForm ctx={ctx} plan={plan} onClose={() => setMode(null)} onSaved={() => done("Improvement plan saved.")} />}
      {mode === "checkin" && (
        <ActionModal title="Add check-in" onClose={() => setMode(null)} submitLabel="Save check-in"
          onSubmit={async () => {
            if (!ci.notes.trim()) return { error: "Write the check-in notes." };
            const res = await addCheckin(plan.id, ci);
            if (res.error) return res;
            done("Check-in recorded. The employee was notified."); return {};
          }}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date" required><Input type="date" max={todayLocal()} min={plan.start_date} value={ci.checkin_date} onChange={(e) => setCi({ ...ci, checkin_date: e.target.value })} /></Field>
            <Field label="Progress" required><Select value={ci.progress} onChange={(e) => setCi({ ...ci, progress: e.target.value })} options={opts(PIP_PROGRESS)} /></Field>
          </div>
          <Field label="Notes" required><Textarea rows={5} value={ci.notes} maxLength={4000} onChange={(e) => setCi({ ...ci, notes: e.target.value })} /></Field>
        </ActionModal>
      )}
      {mode === "outcome" && (
        <ActionModal title="Record outcome" onClose={() => setMode(null)} submitLabel={out.outcome === "extended" ? "Extend plan" : "Close plan"} tone={out.outcome === "failed" ? "danger" : "primary"}
          onSubmit={async () => {
            if (!out.notes.trim()) return { error: "Write the outcome notes." };
            if (out.outcome === "extended" && !(out.new_end > plan.end_date)) return { error: "Choose a new end date after the current one." };
            const res = await closePlan(plan.id, out.outcome, out.notes, out.outcome === "extended" ? out.new_end : null);
            if (res.error) return res;
            done(out.outcome === "extended" ? "Plan extended." : "Plan closed."); return {};
          }}>
          <Field label="Outcome" required><Select value={out.outcome} onChange={(e) => setOut({ ...out, outcome: e.target.value })} options={opts(PIP_OUTCOMES)} /></Field>
          {out.outcome === "extended" && <Field label="New end date" required><Input type="date" min={plan.end_date} value={out.new_end} onChange={(e) => setOut({ ...out, new_end: e.target.value })} /></Field>}
          <Field label="Notes" required hint="Shared with the employee."><Textarea rows={5} value={out.notes} maxLength={5000} onChange={(e) => setOut({ ...out, notes: e.target.value })} /></Field>
        </ActionModal>
      )}
    </Modal>
  );
}

export default function PlansTab({ ctx }) {
  const { notify } = useToast();
  const plans = useHrQuery(() => listPlans(), []);
  const [status, setStatus] = useState("");
  const [modal, setModal] = useState(null);
  const today = todayLocal();
  const rows = useMemo(() => (plans.data ?? []).filter((p) => p.employee_id !== ctx.me && (!status || (status === "open" ? ["active", "extended"].includes(p.status) : p.status === status))), [plans.data, status, ctx.me]);
  const current = modal?.type === "detail" ? (plans.data ?? []).find((p) => p.id === modal.id) : null;
  return (
    <>
      <Toolbar>
        <Field label="Status" className="min-w-[12rem]"><Select placeholder="All" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: "open", label: "Open (active / extended)" }, ...opts(PIP_STATUSES)]} /></Field>
        {ctx.manageableOptions.length > 0 && <div className="flex items-end sm:ml-auto"><Button onClick={() => setModal({ type: "new" })}><Plus className="h-4 w-4" aria-hidden="true" />New improvement plan</Button></div>}
      </Toolbar>
      <DataTable caption="Improvement plans" rows={plans.data ? rows : null} loading={plans.loading} error={plans.error} onRetry={plans.reload}
        onRowClick={(p) => setModal({ type: "detail", id: p.id })} emptyTitle="No improvement plans"
        columns={[
          { key: "employee", header: "Employee", sortable: true, sortValue: (p) => empText(p.employee), render: (p) => <span className="font-semibold text-[#101a3a]">{empText(p.employee)}</span> },
          { key: "title", header: "Plan", render: (p) => p.title ?? <span className="text-slate-500">{(p.objectives ?? "").slice(0, 60)}</span> },
          { key: "end_date", header: "Period", sortable: true, render: (p) => (
            <span className={["active", "extended"].includes(p.status) && p.end_date < today ? "font-semibold text-rose-700" : ""}>{formatDate(p.start_date)} – {formatDate(p.end_date)}</span>) },
          { key: "owner", header: "Owner", render: (p) => empText(p.owner) },
          { key: "employee_acknowledged_at", header: "Acknowledged", render: (p) => (p.employee_acknowledged_at ? formatDate(p.employee_acknowledged_at) : "—") },
          { key: "status", header: "Status", render: (p) => <PerfBadge value={p.status} /> },
        ]} />
      {modal?.type === "new" && <PlanForm ctx={ctx} onClose={() => setModal(null)} onSaved={() => { setModal(null); notify("Improvement plan created. The employee was notified."); plans.reload(); }} />}
      {current && <PlanDetail ctx={ctx} plan={current} onClose={() => setModal(null)} onChanged={plans.reload} />}
    </>
  );
}
