// Employee Portal — My HR Requests → Resignation tab: submit / track /
// withdraw (company policy), clearance status and final settlement status +
// statement. Uses the existing exit RPCs (hr_my_lifecycle, hr_submit_resignation,
// hr_withdraw_resignation, hr_settlement_statement); withdrawal rights and
// visibility come from the server.
import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, DoorOpen, FileText, ShieldAlert, Wallet } from "lucide-react";
import { formatDate, formatMoney, useHrQuery } from "@/lib/hr/client";
import { CLEARANCE_LABELS, submitResignation, withdrawExit } from "@/lib/hr/exits";
import { myLifecycle, settlementStatement } from "@/lib/hr/lifecycle";
import { openSettlementStatement } from "@/lib/hr/settlementStatement";
import { Badge, Button, Card, ConfirmDialog, DescriptionList, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal, Textarea, useToast } from "@/hr/ui";
import { RESIGNATION_STATUS_LABEL, cx, today } from "@/hr/pages/lifecycle/shared";

const STEPS = ["submitted", "under_review", "approved"];
const TONE = { submitted: "amber", under_review: "blue", approved: "green", rejected: "red", withdrawn: "slate" };
const POLICY = {
  before_hr_approval: "You can withdraw until HR approves your resignation.",
  before_clearance: "You can withdraw until exit clearance starts.",
  never: "Company policy does not allow withdrawing a submitted resignation; contact HR.",
};

function ResignModal({ onClose, onDone }) {
  const { notify } = useToast();
  const [reason, setReason] = useState("");
  const [lwd, setLwd] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  function next() {
    if (reason.trim().length < 3) { setError("Please give a reason (at least 3 characters)."); return; }
    if (lwd && lwd < today()) { setError("The proposed last working day is in the past."); return; }
    setError(null); setConfirming(true);
  }
  return (
    <>
      <Modal open={!confirming} onClose={onClose} title="Submit resignation"
        footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={next}>Continue</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-600">Your reporting manager reviews it first (if you have one), then HR confirms your last working day. Submitting does not end your access; you keep working through your notice period.</p>
          <Field label="Reason" required><Textarea value={reason} maxLength={4000} onChange={(e) => setReason(e.target.value)} /></Field>
          <Field label="Proposed last working day" hint="Leave empty to use your notice period."><Input type="date" min={today()} value={lwd} onChange={(e) => setLwd(e.target.value)} /></Field>
          <InlineError message={error} />
        </div>
      </Modal>
      <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} tone="danger" title="Confirm resignation"
        message={`Submit your resignation${lwd ? ` with a proposed last working day of ${formatDate(lwd)}` : ""}? Your manager and HR will be notified.`}
        confirmLabel="Submit resignation"
        onConfirm={async () => { const res = await submitResignation(reason, lwd); if (!res.error) { notify("Resignation submitted."); onDone(); } return res; }} />
    </>
  );
}

export default function ResignationSection() {
  const { notify } = useToast();
  const q = useHrQuery(myLifecycle, []);
  const [resigning, setResigning] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [error, setError] = useState(null);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  const d = q.data ?? {};
  const x = d.exit;
  const open = x && !["closed", "withdrawn", "rejected"].includes(x.status);
  const rs = x?.request_status;
  const s = d.settlement;
  const canResign = !open && ["onboarding", "probation", "active"].includes(d.employee?.status);
  async function statement() {
    setError(null);
    const res = await settlementStatement(s.id);
    if (res.error) { setError(res.error); return; }
    const err = openSettlementStatement(res.data);
    if (err) setError(err);
  }
  const resignButton = canResign && <Button variant="secondary" onClick={() => setResigning(true)}><DoorOpen className="h-4 w-4" aria-hidden="true" />Submit resignation</Button>;
  return (
    <>
      <InlineError message={error} />
      {!x ? (
        <Card>
          <EmptyState icon={DoorOpen} title="No resignation or exit case"
            description={canResign ? "If you decide to resign, submit it here. Your manager and HR are notified and you can track every step." : "You have no resignation or exit case."}
            action={resignButton} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
            <Card title={x.exit_type === "resignation" ? "Resignation" : "Exit"} actions={<span className="flex items-center gap-2"><Badge tone={TONE[rs]}>{RESIGNATION_STATUS_LABEL[rs] ?? rs}</Badge>{resignButton}</span>}>
              {x.exit_type === "resignation" && x.initiated_by === "employee" && (
                <ol className="mb-4 flex flex-col gap-2 sm:flex-row sm:gap-0" aria-label="Resignation status">
                  {STEPS.map((k, i) => {
                    const idx = STEPS.indexOf(rs);
                    const done = idx > i || (idx === i && rs === "approved");
                    const cur = idx === i && rs !== "approved";
                    return (
                      <li key={k} className="flex items-center gap-2 sm:flex-1">
                        <span className={cx("flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ring-2", done ? "bg-emerald-500 text-white ring-emerald-500" : cur ? "bg-[#f96706] text-white ring-[#f96706]" : "bg-white text-slate-400 ring-slate-200")}>{done ? "✓" : i + 1}</span>
                        <span className={cx("text-xs font-semibold", cur ? "text-[#c24f05]" : done ? "text-emerald-700" : "text-slate-500")}>{RESIGNATION_STATUS_LABEL[k]}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
              <DescriptionList items={[
                { label: "Submitted", value: formatDate(x.resignation_date) },
                { label: "Notice period", value: x.notice_period_days != null ? `${x.notice_period_days} days` : null },
                { label: "Proposed last working day", value: formatDate(x.proposed_last_working_day) },
                { label: "Approved last working day", value: formatDate(x.approved_last_working_day) },
                x.reason && { label: "Reason", value: <span className="whitespace-pre-line">{x.reason}</span> },
                x.manager_decision && { label: "Manager review", value: `${x.manager_decision}${x.manager_note ? ` — ${x.manager_note}` : ""}` },
                x.hr_note && { label: "HR decision", value: x.hr_note },
                x.relieving_letter_issued_at && { label: "Relieving letter", value: `Issued ${formatDate(x.relieving_letter_issued_at)}` },
                x.experience_letter_issued_at && { label: "Experience letter", value: `Issued ${formatDate(x.experience_letter_issued_at)}` },
              ]} />
              {open && x.initiated_by === "employee" && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {x.can_withdraw && <Button variant="secondary" onClick={() => setWithdrawing(true)}>Withdraw resignation</Button>}
                  <p className="text-xs text-slate-500">{POLICY[x.withdrawal_policy] ?? ""}</p>
                </div>
              )}
              {rs === "approved" && open && <p className="mt-3 text-xs text-slate-500">Your access continues until your last working day under company policy. Return company assets and complete your handovers before then.</p>}
            </Card>
            {x.clearance?.length > 0 && (
              <Card title="My clearance status">
                {x.open_assets > 0 && (
                  <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    You still have {x.open_assets} company asset(s) assigned. Request their return in <Link className="font-semibold text-[#1f4693] hover:underline" to="/employee/assets">My Assets</Link>.
                  </p>
                )}
                <ul className="flex flex-col gap-1.5 text-sm">
                  {x.clearance.map((i) => (
                    <li key={i.item_key} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        {i.status === "pending" ? <Circle className="h-4 w-4 text-amber-500" aria-hidden="true" /> : i.status === "waived" ? <ShieldAlert className="h-4 w-4 text-orange-500" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
                        {CLEARANCE_LABELS[i.item_key] ?? i.item_key}{i.department ? <span className="text-xs text-slate-500">· {i.department}</span> : null}
                      </span>
                      <span className="text-xs text-slate-500">{i.status === "pending" ? (i.due_date ? `due ${formatDate(i.due_date)}` : "pending") : i.status === "not_applicable" ? "not applicable" : i.status === "waived" ? "cleared by HR" : `cleared ${formatDate(i.completed_at)}`}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
          <Card title={<span className="inline-flex items-center gap-2"><Wallet className="h-4 w-4" aria-hidden="true" />Final settlement</span>}>
            {!s ? <p className="text-sm text-slate-600">{["clearance", "final_settlement"].includes(x.status) ? "Payroll will prepare your full and final settlement." : "Your full and final settlement is prepared during exit clearance."}</p> : (
              <div className="flex flex-col gap-2 text-sm">
                <p><Badge tone={["paid", "approved"].includes(s.status) ? "green" : "amber"}>{s.status === "in_preparation" ? "In preparation" : s.status === "approved" ? "Approved — payment pending" : "Paid"}</Badge></p>
                {s.net_amount != null && <p>Net settlement: <strong>{formatMoney(Math.abs(Number(s.net_amount)), s.currency)}</strong>{Number(s.net_amount) < 0 ? " (recoverable)" : ""}</p>}
                {s.paid_on && <p className="text-xs text-slate-500">Paid on {formatDate(s.paid_on)}</p>}
                {["approved", "paid"].includes(s.status) && <Button size="sm" variant="secondary" onClick={statement}><FileText className="h-4 w-4" aria-hidden="true" />Statement / PDF</Button>}
                {s.status === "in_preparation" && <p className="text-xs text-slate-500">Amounts are shown once payroll has approved the settlement.</p>}
              </div>
            )}
          </Card>
        </div>
      )}
      {resigning && <ResignModal onClose={() => setResigning(false)} onDone={() => { setResigning(false); q.reload(); }} />}
      <ConfirmDialog open={withdrawing} onClose={() => setWithdrawing(false)} title="Withdraw resignation"
        message="Your resignation will be withdrawn and your manager and HR notified." confirmLabel="Withdraw" requireReason={false} reasonLabel="Note (optional)"
        onConfirm={async (note) => { const res = await withdrawExit(x.id, note); if (!res.error) { notify("Resignation withdrawn."); q.reload(); } return res; }} />
    </>
  );
}
