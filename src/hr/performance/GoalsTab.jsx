// Goals / KPIs per employee per cycle. Managers (reporting line) and HR set
// goals with a target and weight; an employee's weights in a cycle must total
// exactly 100% before the goal sheet can be approved (hr_agree_goal_sheet).
// Progress (actual values) is recorded through hr_record_goal_progress and
// kept as a history; scores are computed on the server from the KPI formula.
import { useMemo, useState } from "react";
import { CheckCircle2, Pencil, Plus, Target, Trash2, TrendingUp, Users } from "lucide-react";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { agreeGoalSheet, assignGoals, deleteGoal, listGoals, listKpis, listProgress, recordProgress, saveGoal, setGoalStatus } from "@/lib/hr/performance";
import { canFitWeight, goalProgressPct, weightSummary, weightTotal } from "@/lib/hr/performanceRules";
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, Field, Input, Loading, Modal, Select, Textarea, Toolbar, useToast } from "@/hr/ui";
import { ActionModal, CycleSelect, PerfBadge, ProgressBar, WeightMeter, defaultCycleId, empText, todayLocal } from "./shared";

function kpiOptions(kpis) {
  return (kpis ?? []).filter((k) => k.active).map((k) => ({ value: k.id, label: `${k.name}${k.unit ? ` (${k.unit})` : ""}` }));
}

export function GoalForm({ goal, cycleId, employeeId, employeeOptions, kpis, sheetGoals, onClose, onSaved }) {
  const isNew = !goal?.id;
  const [v, setV] = useState({ employee_id: employeeId ?? "", kpi_id: "", title: "", description: "", target_value: "", weight: "", due_date: "", ...(goal ?? {}) });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const others = (sheetGoals ?? []).filter((g) => g.employee_id === v.employee_id && g.id !== goal?.id);
  const remaining = Math.round((100 - weightTotal(others)) * 100) / 100;
  function pickKpi(id) {
    const k = (kpis ?? []).find((x) => x.id === id);
    setV((s) => ({ ...s, kpi_id: id, title: s.title || k?.name || "", target_value: s.target_value === "" && k?.default_target != null ? k.default_target : s.target_value,
      weight: s.weight === "" && k ? Math.min(Number(k.default_weight), remaining) : s.weight }));
  }
  const kpi = (kpis ?? []).find((k) => k.id === v.kpi_id);
  const locked = !isNew && goal.status !== "draft";
  return (
    <ActionModal title={isNew ? "Add goal" : "Edit goal"} size="lg" submitLabel={isNew ? "Add goal" : "Save"} onClose={onClose}
      onSubmit={async () => {
        if (!v.employee_id) return { error: "Choose the employee." };
        if ((v.title ?? "").trim().length < 2) return { error: "Give the goal a title (2–200 characters)." };
        const w = Number(v.weight || 0);
        if (!(w >= 0 && w <= 100)) return { error: "Weight must be 0–100." };
        if (!canFitWeight(others, w)) return { error: `Only ${remaining}% of weight is left for this employee in this cycle.` };
        if (v.target_value !== "" && v.target_value != null && !Number.isFinite(Number(v.target_value))) return { error: "Target must be a number." };
        const res = await saveGoal({ ...v, cycle_id: cycleId }, goal?.id);
        if (res.error) return res;
        onSaved(isNew); return {};
      }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {isNew && !employeeId && <Field label="Employee" required className="sm:col-span-2"><Select placeholder="Choose an employee" value={v.employee_id} onChange={set("employee_id")} options={employeeOptions} /></Field>}
        <Field label="KPI template" hint="Optional — sets the measure and scoring formula" className="sm:col-span-2">
          <Select placeholder="— Custom goal (no KPI) —" value={v.kpi_id ?? ""} onChange={(e) => pickKpi(e.target.value)} options={kpiOptions(kpis)} disabled={locked} />
        </Field>
        <Field label="Goal title" required className="sm:col-span-2"><Input value={v.title} maxLength={200} onChange={set("title")} /></Field>
        <Field label={`Target${kpi?.unit ? ` (${kpi.unit})` : ""}`} hint={kpi ? undefined : "Leave empty for a manually scored goal (actual 0–100 = score)"}><Input type="number" step="any" value={v.target_value ?? ""} onChange={set("target_value")} /></Field>
        <Field label="Weight (%)" required hint={`${remaining}% available for this employee`}><Input type="number" min={0} max={100} step="0.5" value={v.weight} onChange={set("weight")} /></Field>
        <Field label="Due date"><Input type="date" value={v.due_date ?? ""} onChange={set("due_date")} /></Field>
        <Field label="Description / success measure" className="sm:col-span-2"><Textarea value={v.description ?? ""} maxLength={2000} onChange={set("description")} /></Field>
      </div>
      {locked && <p className="text-xs text-slate-500">This goal is agreed: the KPI cannot change. Weight and target changes still have to keep the sheet at 100%.</p>}
    </ActionModal>
  );
}

function AssignKpiModal({ cycleId, kpis, employeeOptions, goals, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ kpi_id: "", title: "", target_value: "", weight: "", due_date: "", description: "" });
  const [selected, setSelected] = useState([]);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <ActionModal title="Assign a KPI / goal to several employees" size="lg" submitLabel={`Assign to ${selected.length}`} onClose={onClose}
      onSubmit={async () => {
        if (!selected.length) return { error: "Choose at least one employee." };
        if ((v.title ?? "").trim().length < 2) return { error: "Give the goal a title." };
        const w = Number(v.weight || 0);
        if (!(w >= 0 && w <= 100)) return { error: "Weight must be 0–100." };
        const tooMuch = selected.filter((id) => !canFitWeight((goals ?? []).filter((g) => g.employee_id === id), w));
        if (tooMuch.length) return { error: `${tooMuch.length} employee(s) do not have ${w}% of weight left in this cycle.` };
        const res = await assignGoals(selected, { ...v, cycle_id: cycleId });
        if (res.error) return res;
        notify(`Goal assigned to ${selected.length} employee(s) as draft.`); onDone(); return {};
      }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="KPI template" className="sm:col-span-2">
          <Select placeholder="— Custom goal —" value={v.kpi_id} options={kpiOptions(kpis)} onChange={(e) => {
            const k = (kpis ?? []).find((x) => x.id === e.target.value);
            setV((s) => ({ ...s, kpi_id: e.target.value, title: k?.name ?? s.title, target_value: k?.default_target ?? s.target_value, weight: k ? k.default_weight : s.weight }));
          }} />
        </Field>
        <Field label="Goal title" required className="sm:col-span-2"><Input value={v.title} maxLength={200} onChange={set("title")} /></Field>
        <Field label="Target"><Input type="number" step="any" value={v.target_value ?? ""} onChange={set("target_value")} /></Field>
        <Field label="Weight (%)" required><Input type="number" min={0} max={100} step="0.5" value={v.weight} onChange={set("weight")} /></Field>
        <Field label="Due date"><Input type="date" value={v.due_date} onChange={set("due_date")} /></Field>
      </div>
      <fieldset className="rounded-xl border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold text-[#173a52]">Employees ({selected.length} selected)</legend>
        <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
          {employeeOptions.map((o) => {
            const left = Math.round((100 - weightTotal((goals ?? []).filter((g) => g.employee_id === o.value))) * 100) / 100;
            return (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} className="h-4 w-4 rounded border-slate-300 text-[#f96706]" />
                <span className="min-w-0 flex-1 truncate">{o.label}</span><span className="text-xs text-slate-500">{left}% left</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </ActionModal>
  );
}

export function ProgressModal({ goal, onClose, onDone, canRecord = true }) {
  const { notify } = useToast();
  const [actual, setActual] = useState(goal.actual_value ?? "");
  const [note, setNote] = useState("");
  const hist = useHrQuery(() => listProgress({ goal: goal.id }), [goal.id]);
  const unit = goal.kpi?.unit ? ` ${goal.kpi.unit}` : "";
  return (
    <ActionModal title={`Progress · ${goal.title}`} size="lg" submitLabel="Record progress" hideSubmit={!canRecord} onClose={onClose}
      onSubmit={async () => {
        if (actual === "" || !Number.isFinite(Number(actual))) return { error: "Enter the current actual value." };
        const res = await recordProgress(goal.id, actual, note);
        if (res.error) return res;
        notify(`Progress recorded${res.data?.score != null ? ` — score ${res.data.score}` : ""}.`); onDone(); return {};
      }}>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><p className="text-xs text-slate-500">Target</p><p className="font-semibold">{goal.target_value ?? "—"}{unit}</p></div>
        <div><p className="text-xs text-slate-500">Current actual</p><p className="font-semibold">{goal.actual_value ?? "—"}{unit}</p></div>
        <div><p className="text-xs text-slate-500">Weight</p><p className="font-semibold">{Number(goal.weight)}%</p></div>
        <div><p className="text-xs text-slate-500">Score</p><ProgressBar value={goalProgressPct(goal)} /></div>
      </div>
      {canRecord && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={`New actual value${unit}`} required><Input type="number" step="any" value={actual} onChange={(e) => setActual(e.target.value)} /></Field>
          <Field label="Note" className="sm:col-span-2"><Input value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="What changed?" /></Field>
        </div>
      )}
      <div>
        <p className="mb-1 text-sm font-semibold text-[#173a52]">Progress history</p>
        {hist.loading && !hist.data ? <Loading /> : !(hist.data ?? []).length ? <p className="text-sm text-slate-500">No progress recorded yet.</p> : (
          <ol className="flex flex-col gap-2">
            {hist.data.map((p) => (
              <li key={p.id} className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 text-sm">
                <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{p.previous_value ?? "—"} → {p.actual_value}{unit}{p.score != null ? ` · score ${p.score}` : ""}</span><span className="text-xs text-slate-500">{formatDateTime(p.created_at)}</span></div>
                {p.note && <p className="text-slate-600">{p.note}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </ActionModal>
  );
}

function GoalSheetModal({ ctx, sheet, cycle, kpis, allGoals, onClose, onChanged }) {
  const { notify } = useToast();
  const [modal, setModal] = useState(null);
  const manage = ctx.canManageEmployee(sheet.employee_id) && cycle?.status !== "closed";
  const close = () => setModal(null);
  const changed = (msg) => { if (msg) notify(msg); close(); onChanged(); };
  const goals = (allGoals ?? []).filter((g) => g.employee_id === sheet.employee_id);
  const total = weightTotal(goals);
  const drafts = goals.filter((g) => g.status === "draft").length;
  return (
    <Modal open onClose={onClose} size="xl" title={`Goals · ${empText(sheet.employee)}`}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm text-slate-600">Total weight <WeightMeter total={total} />{drafts > 0 && <Badge tone="amber">{drafts} draft</Badge>}</span>
          {manage && (
            <span className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setModal({ type: "form" })}><Plus className="h-4 w-4" aria-hidden="true" />Add goal</Button>
              {drafts > 0 && <Button size="sm" variant="success" onClick={() => setModal({ type: "agree" })} disabled={Math.abs(total - 100) > 0.005}
                title={Math.abs(total - 100) > 0.005 ? "Weights must total exactly 100%" : undefined}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Approve goal sheet</Button>}
            </span>
          )}
        </div>
        {manage && drafts > 0 && Math.abs(total - 100) > 0.005 && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Weights total {total}%. Adjust them to exactly 100% to approve the goal sheet.</p>}
        <DataTable caption="Goals" rows={goals} emptyTitle="No goals in this cycle"
          columns={[
            { key: "title", header: "Goal", render: (g) => <div><p className="font-semibold text-[#101a3a]">{g.title}</p><p className="text-xs text-slate-500">{g.kpi?.name ?? "Custom goal"}{g.due_date ? ` · due ${formatDate(g.due_date)}` : ""}</p></div> },
            { key: "weight", header: "Weight", render: (g) => `${Number(g.weight)}%` },
            { key: "target_value", header: "Target / actual", render: (g) => `${g.target_value ?? "—"} / ${g.actual_value ?? "—"}${g.kpi?.unit ? ` ${g.kpi.unit}` : ""}` },
            { key: "score", header: "Score", render: (g) => <ProgressBar value={goalProgressPct(g)} /> },
            { key: "status", header: "Status", render: (g) => <PerfBadge value={g.status} /> },
            { key: "_a", header: <span className="sr-only">Actions</span>, render: (g) => (
              <span className="flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => setModal({ type: "progress", row: g })}><TrendingUp className="h-4 w-4" aria-hidden="true" />Progress</Button>
                {manage && !["achieved", "missed"].includes(g.status) && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "form", row: g })} aria-label="Edit goal"><Pencil className="h-4 w-4" aria-hidden="true" /></Button>}
                {manage && ["agreed", "in_progress"].includes(g.status) && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "status", row: g })}>Close</Button>}
                {manage && g.status === "draft" && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "delete", row: g })} aria-label="Delete draft goal"><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>}
              </span>) },
          ]} />
      </div>
      {modal?.type === "form" && <GoalForm goal={modal.row} cycleId={cycle.id} employeeId={sheet.employee_id} kpis={kpis} sheetGoals={goals} onClose={close} onSaved={(n) => changed(n ? "Goal added as draft." : "Goal saved.")} />}
      {modal?.type === "progress" && <ProgressModal goal={modal.row} canRecord={manage && cycle?.status === "active" && ["agreed", "in_progress"].includes(modal.row.status)} onClose={close} onDone={() => changed()} />}
      <ConfirmDialog open={modal?.type === "agree"} onClose={close} title="Approve goal sheet"
        message={`All ${drafts} draft goal(s) become agreed and the employee is notified. Weights total ${total}%.`} confirmLabel="Approve"
        onConfirm={async () => { const res = await agreeGoalSheet(sheet.employee_id, cycle.id); if (res.error) return res; changed(`${res.data?.agreed ?? 0} goal(s) agreed.`); return {}; }} />
      <ConfirmDialog open={modal?.type === "delete"} onClose={close} title="Delete draft goal?" tone="danger" message={modal?.row?.title} confirmLabel="Delete"
        onConfirm={async () => { const res = await deleteGoal(modal.row.id); if (res.error) return res; changed("Draft goal deleted."); return {}; }} />
      {modal?.type === "status" && (
        <ActionModal title={`Close goal · ${modal.row.title}`} onClose={close} submitLabel="Save"
          onSubmit={async () => { const s = modal.status ?? "achieved"; const res = await setGoalStatus(modal.row.id, s); if (res.error) return res; changed(`Goal marked ${s}.`); return {}; }}>
          <Field label="Outcome"><Select value={modal.status ?? "achieved"} onChange={(e) => setModal((m) => ({ ...m, status: e.target.value }))} options={[{ value: "achieved", label: "Achieved" }, { value: "missed", label: "Missed" }]} /></Field>
          <p className="text-xs text-slate-500">A closed goal can no longer receive progress updates. The score stays as computed from the last actual value.</p>
        </ActionModal>
      )}
    </Modal>
  );
}

export default function GoalsTab({ ctx }) {
  const { notify } = useToast();
  const [pickedCycle, setCycle] = useState("");
  const cycle = pickedCycle || defaultCycleId(ctx.cycles);
  const goals = useHrQuery(() => (cycle ? listGoals({ cycle }) : Promise.resolve({ data: [] })), [cycle]);
  const kpis = useHrQuery(() => listKpis(), []);
  const [modal, setModal] = useState(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const cyc = ctx.cycles.find((c) => c.id === cycle);
  const canEdit = cyc && cyc.status !== "closed";
  const inScope = (goals.data ?? []).filter((g) => g.employee_id !== ctx.me);
  const sheets = useMemo(() => {
    const s = weightSummary(inScope);
    if (!showEmpty) return s;
    const have = new Set(s.map((x) => x.employee_id));
    const empty = ctx.employees.filter((e) => e.id !== ctx.me && !have.has(e.id) && (ctx.canViewAll || ctx.isInMyLine(e.id)))
      .map((e) => ({ employee_id: e.id, employee: e, goals: [], count: 0, total: 0, remaining: 100, status: "empty", drafts: 0 }));
    return [...s, ...empty];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals.data, showEmpty, ctx.employees, ctx.me]);
  const today = todayLocal();
  const overdueGoals = inScope.filter((g) => g.due_date && g.due_date < today && ["agreed", "in_progress"].includes(g.status)).length;

  if (!ctx.cyclesLoading && !ctx.cycles.length) return <Card><EmptyState icon={Target} title="No review cycles yet" description="Goals belong to a review cycle." /></Card>;
  return (
    <>
      <Toolbar>
        <CycleSelect cycles={ctx.cycles} value={cycle} onChange={setCycle} />
        <span className="flex flex-wrap items-end gap-2 sm:ml-auto">
          <Button variant="secondary" onClick={() => setShowEmpty((x) => !x)}><Users className="h-4 w-4" aria-hidden="true" />{showEmpty ? "Hide" : "Show"} employees without goals</Button>
          {canEdit && ctx.manageableOptions.length > 0 && <>
            <Button variant="secondary" onClick={() => setModal({ type: "assign" })}>Assign KPI to several</Button>
            <Button onClick={() => setModal({ type: "new" })}><Plus className="h-4 w-4" aria-hidden="true" />Add goal</Button>
          </>}
        </span>
      </Toolbar>
      {cyc?.status === "draft" && <p className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">This cycle is a draft: goals can be prepared now; employees can propose goals and record progress once it is started.</p>}
      {overdueGoals > 0 && <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{overdueGoals} agreed goal(s) are past their due date.</p>}
      <DataTable caption="Goal sheets" rows={goals.data ? sheets : null} loading={goals.loading} error={goals.error} onRetry={goals.reload} rowKey="employee_id"
        onRowClick={(r) => setModal({ type: "sheet", row: r })}
        emptyTitle="No goals in this cycle" emptyDescription={canEdit ? "Add goals or assign a KPI to several employees." : undefined}
        columns={[
          { key: "employee", header: "Employee", sortable: true, sortValue: (r) => empText(r.employee), render: (r) => <span className="font-semibold text-[#101a3a]">{empText(r.employee)}</span> },
          { key: "count", header: "Goals", sortable: true },
          { key: "total", header: "Weight", sortable: true, render: (r) => <WeightMeter total={r.total} /> },
          { key: "drafts", header: "Drafts", render: (r) => (r.drafts ? <Badge tone="amber">{r.drafts} draft</Badge> : "—") },
          { key: "progress", header: "Weighted score", render: (r) => {
            const scored = r.goals.filter((g) => g.score != null && Number(g.weight) > 0);
            const w = scored.reduce((t, g) => t + Number(g.weight), 0);
            return <ProgressBar value={w ? scored.reduce((t, g) => t + Number(g.score) * Number(g.weight), 0) / w : null} />;
          } },
        ]} />
      {modal?.type === "sheet" && <GoalSheetModal ctx={ctx} sheet={modal.row} cycle={cyc} kpis={kpis.data} allGoals={goals.data} onClose={() => setModal(null)} onChanged={goals.reload} />}
      {modal?.type === "new" && <GoalForm cycleId={cycle} employeeOptions={ctx.manageableOptions} kpis={kpis.data} sheetGoals={goals.data} onClose={() => setModal(null)}
        onSaved={() => { setModal(null); notify("Goal added as draft."); goals.reload(); }} />}
      {modal?.type === "assign" && <AssignKpiModal cycleId={cycle} kpis={kpis.data} employeeOptions={ctx.manageableOptions} goals={goals.data} onClose={() => setModal(null)} onDone={() => { setModal(null); goals.reload(); }} />}
    </>
  );
}
