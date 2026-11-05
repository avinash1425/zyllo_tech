// One queue for everything that needs a second person: runs, salary
// structures, variable-pay entries and payroll corrections. Items prepared
// by (or about) the signed-in user are shown but cannot be actioned — the
// server refuses them as well.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, formatMoney, fullName, useHrQuery } from "@/lib/hr/client";
import { approveStructure, decideAdjustment, decideCorrection, listCorrectionRequests, listPendingAdjustments, listRuns, listStructures, rejectStructure } from "@/lib/hr/payroll";
import { Button, Card, ConfirmDialog, DataTable, useToast } from "@/hr/ui";
import { EmpCell, RunBadge, SelfNote, friendly, label, period } from "./shared";

export default function ApprovalsTab() {
  const { user, hr, hasPermission } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const canApprove = hasPermission("payroll.approve");
  const me = hr?.employee?.id;
  const runs = useHrQuery(() => listRuns(), []);
  const structures = useHrQuery(() => listStructures("", { status: "pending_approval" }), []);
  const adjustments = useHrQuery(() => listPendingAdjustments(), []);
  const corrections = useHrQuery(() => listCorrectionRequests({ status: "prepared" }), []);
  const [act, setAct] = useState(null);
  const pendingRuns = (runs.data ?? []).filter((r) => ["reviewed", "approved"].includes(r.status));
  const blockedReason = (row, { preparer, subject }) => {
    if (subject && me && subject === me) return "About your own pay";
    if (preparer && user?.id && preparer.includes(user.id)) return "You prepared this";
    return null;
  };
  const decision = (key, row, approve) => setAct({ key, row, approve });
  const ACTIONS = {
    structure: (a, note) => (a.approve ? approveStructure(a.row.id, note) : rejectStructure(a.row.id, note)),
    adjustment: (a, note) => decideAdjustment(a.row.id, a.approve, note),
    correction: (a, note) => decideCorrection(a.row.id, a.approve, note),
  };
  const reloadAll = () => { runs.reload(); structures.reload(); adjustments.reload(); corrections.reload(); };
  const Actions = ({ k, row, block }) => (!canApprove ? <span className="text-xs text-slate-500">Approver only</span>
    : block ? <span className="text-xs text-slate-500">{block} — another approver must decide</span>
      : <div className="flex gap-1"><Button size="sm" variant="success" onClick={() => decision(k, row, true)}>Approve</Button><Button size="sm" variant="danger" onClick={() => decision(k, row, false)}>{k === "structure" ? "Return" : "Reject"}</Button></div>);

  return (
    <div className="flex flex-col gap-4">
      <SelfNote />
      <Card title={`Payroll runs awaiting approval or finalization (${pendingRuns.length})`} padded={false}>
        <DataTable caption="Runs awaiting approval" rows={pendingRuns} loading={runs.loading} error={runs.error} onRetry={runs.reload} onRowClick={(r) => navigate(`/hr/payroll/runs/${r.id}`)} emptyTitle="Nothing to approve"
          columns={[
            { key: "period", header: "Period", render: (r) => <span className="font-semibold">{period(r)}</span> },
            { key: "status", header: "Stage", render: (r) => <RunBadge status={r.status} /> },
            { key: "reviewed_at", header: "Submitted", render: (r) => formatDateTime(r.reviewed_at) },
            { key: "checks", header: "Checks", render: (r) => `${r.validation?.employees ?? "—"} employees · ${r.validation?.items_with_warnings ?? 0} with warnings` },
            { key: "_a", header: <span className="sr-only">Open</span>, render: (r) => <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); navigate(`/hr/payroll/runs/${r.id}`); }}>{r.status === "reviewed" ? "Review & approve" : "Finalize"}</Button> },
          ]} />
      </Card>
      <Card title={`Salary structures (${structures.data?.length ?? 0})`} padded={false}>
        <DataTable caption="Salary structures awaiting approval" rows={structures.data} loading={structures.loading} error={structures.error} onRetry={structures.reload} emptyTitle="No structures waiting"
          columns={[
            { key: "employee", header: "Employee", render: (r) => <EmpCell e={r.employee} /> },
            { key: "effective", header: "Effective from", render: (r) => formatDate(r.effective_from) },
            { key: "annual_ctc", header: "Annual CTC", render: (r) => formatMoney(r.annual_ctc, r.currency) },
            { key: "type", header: "Type", render: (r) => (r.revision_of ? `Revision: ${r.revision_reason ?? ""}` : "New") },
            { key: "_a", header: <span className="sr-only">Decide</span>, render: (r) => <Actions k="structure" row={r} block={blockedReason(r, { preparer: [r.created_by, r.submitted_by], subject: r.employee_id })} /> },
          ]} />
      </Card>
      <Card title={`Variable pay, bonuses and recoveries (${adjustments.data?.length ?? 0})`} padded={false}>
        <DataTable caption="Adjustments awaiting approval" rows={adjustments.data} loading={adjustments.loading} error={adjustments.error} onRetry={adjustments.reload} emptyTitle="No entries waiting"
          columns={[
            { key: "employee", header: "Employee", render: (r) => <EmpCell e={r.employee} /> },
            { key: "run", header: "Run", render: (r) => period(r.run) },
            { key: "label", header: "Item" },
            { key: "amount", header: "Amount", render: (r) => <span className={Number(r.amount) < 0 ? "text-red-600" : "text-emerald-700"}>{formatMoney(r.amount)}</span> },
            { key: "reason", header: "Reason", render: (r) => <span className="line-clamp-2 max-w-xs">{r.reason}</span> },
            { key: "_a", header: <span className="sr-only">Decide</span>, render: (r) => <Actions k="adjustment" row={r} block={blockedReason(r, { preparer: [r.created_by], subject: r.employee_id })} /> },
          ]} />
      </Card>
      <Card title={`Payroll corrections (${corrections.data?.length ?? 0})`} padded={false}>
        <DataTable caption="Corrections awaiting approval" rows={corrections.data} loading={corrections.loading} error={corrections.error} onRetry={corrections.reload} emptyTitle="No corrections waiting"
          columns={[
            { key: "employee", header: "Employee", render: (r) => <EmpCell e={r.employee} /> },
            { key: "run", header: "Payroll", render: (r) => period(r.run) },
            { key: "category", header: "Category", render: (r) => label(r.category) },
            { key: "proposed_amount", header: "Amount", render: (r) => formatMoney(r.proposed_amount) },
            { key: "preparation_note", header: "Calculation", render: (r) => <span className="line-clamp-2 max-w-xs">{r.preparation_note}</span> },
            { key: "_a", header: <span className="sr-only">Decide</span>, render: (r) => <Actions k="correction" row={r} block={blockedReason(r, { preparer: [r.prepared_by, r.raised_by], subject: r.employee_id })} /> },
          ]} />
      </Card>
      {act && (
        <ConfirmDialog open onClose={() => setAct(null)} title={act.approve ? "Approve?" : act.key === "structure" ? "Return for correction?" : "Reject?"}
          tone={act.approve ? "success" : "danger"} confirmLabel={act.approve ? "Approve" : act.key === "structure" ? "Return" : "Reject"}
          message={`${fullName(act.row.employee)}${act.key === "correction" && act.approve ? " — the amount is added to the next open payroll run as a correction. Finalized payslips are not edited." : ""}`}
          requireReason={!act.approve} reasonLabel={act.approve ? "Note (optional)" : "Reason"}
          onConfirm={async (note) => {
            const res = await ACTIONS[act.key](act, note);
            if (res.error) return { error: friendly(res.error) };
            notify(act.approve ? "Approved." : "Decision recorded."); reloadAll();
            return {};
          }} />
      )}
    </div>
  );
}
