// Module — Exit Management: exit cases (active / closed / all), case detail
// with the workflow stepper, events timeline, clearance checklist, and the
// actions allowed for the case status and the user's permissions. All state
// changes are RPCs; sign-in revocation is the hr-revoke-exit-access Edge
// Function. Mounted at /hr/exits/* (list at index, case at :id).
import { useState } from "react";
import { Route, Routes, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban, Check, CheckCircle2, Circle, FileSignature, KeyRound, LogOut, Plus, RotateCcw, ShieldAlert, XCircle } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, fullName, useHrQuery } from "@/lib/hr/client";
import {
  CLEARANCE_LABELS, EXIT_STEPS, EXIT_TYPES, canActOnClearance, closeExit, completeClearanceItem, exitOpenAssets, getClearanceItems, getExit, getExitEvents,
  hrReviewExit, initiateExit, listExits, managerReviewExit, moveExitToSettlement, recordExitLetter, revokeExitAccess, startExitClearance, withdrawExit,
} from "@/lib/hr/exits";
import { exitSettlementStatus, grantClearanceException, listAccessRevocationAttempts } from "@/lib/hr/lifecycle";
import { useEmployeeOptions } from "@/lib/hr/org";
import EmployeeAssetsPanel from "@/hr/components/EmployeeAssetsPanel";   // Module 11
import {
  Badge, Button, Card, ConfirmDialog, DataTable, DescriptionList, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal,
  PageHeader, Select, StatusBadge, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";

const label = (s) => String(s ?? "").replace(/_/g, " ");
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const empText = (e) => (e ? `${fullName(e)} (${e.employee_code})` : "—");
const cx = (...c) => c.filter(Boolean).join(" ");

// ----------------------------------------------------------------- stepper
/** Visual workflow. Used by HR and by the employee resignation section. */
export function ExitStepper({ exit }) {
  if (!exit) return null;
  const ended = ["withdrawn", "rejected"].includes(exit.status);
  const order = EXIT_STEPS.map((s) => s.key);
  // Withdrawn / rejected cases: show progress up to the last stage reached.
  const currentKey = ended ? (exit.hr_decided_at ? "hr_review" : exit.manager_decided_at ? "manager_review" : exit.initiated_by === "hr" ? "notice_period" : "submitted") : exit.status;
  const current = Math.max(0, order.indexOf(currentKey));
  const skipped = (key) =>
    (key === "manager_review" && (exit.initiated_by === "hr" || (!exit.manager_decision && current > order.indexOf("manager_review"))))
    || (exit.initiated_by === "hr" && ["submitted", "hr_review"].includes(key));
  return (
    <div>
      <ol className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-0" aria-label="Exit workflow">
        {EXIT_STEPS.map((s, i) => {
          const done = i < current || (exit.status === "closed" && i === current);
          const isCurrent = i === current && !done && !ended;
          const skip = skipped(s.key) && i < current;
          return (
            <li key={s.key} className="flex items-center gap-2 sm:flex-1" aria-current={isCurrent ? "step" : undefined}>
              <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-2",
                skip ? "bg-slate-100 text-slate-400 ring-slate-200" : done ? "bg-emerald-500 text-white ring-emerald-500" : isCurrent ? "bg-[#f96706] text-white ring-[#f96706]" : "bg-white text-slate-400 ring-slate-200")}>
                {skip ? "–" : done ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
              </span>
              <span className={cx("text-xs font-semibold", isCurrent ? "text-[#c24f05]" : done && !skip ? "text-emerald-700" : "text-slate-500")}>
                {s.label}{skip ? " (skipped)" : ""}<span className="sr-only">{done ? " — done" : isCurrent ? " — current step" : ""}</span>
              </span>
              {i < EXIT_STEPS.length - 1 && <span className="hidden h-0.5 flex-1 bg-slate-200 sm:mx-2 sm:block" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
      {ended && (
        <p className={cx("mt-3 rounded-lg px-3 py-2 text-sm font-semibold", exit.status === "rejected" ? "bg-rose-50 text-rose-800" : "bg-slate-100 text-slate-700")}>
          This case was {exit.status}{exit.status === "rejected" && exit.hr_note ? `: ${exit.hr_note}` : "."}
        </p>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- list
function InitiateModal({ onClose, onDone }) {
  const { notify } = useToast();
  const employees = useEmployeeOptions();
  const { hr } = useAuth();
  const [v, setV] = useState({ employee: "", type: "termination", reason: "", lwd: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function submit() {
    const errs = {};
    if (!v.employee) errs.employee = "Choose an employee.";
    if (!v.type) errs.type = "Choose the exit type.";
    if (v.reason.trim().length < 3) errs.reason = "Record the reason (at least 3 characters).";
    if (!v.lwd) errs.lwd = "Set the last working day.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await initiateExit(v);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Exit case created; the employee is now in the notice period.");
    onDone(res.data);
  }
  return (
    <Modal open onClose={onClose} title="Initiate exit" size="md"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Initiate exit</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">HR-initiated exits skip the review steps and start in the notice period. Employees submit their own resignations from the Employee Portal.</p>
        {employees.error && <InlineError message={employees.error} />}
        <Field label="Employee" required error={errors.employee}>
          <Select placeholder="Choose an employee" value={v.employee} onChange={set("employee")} options={(employees.data ?? []).filter((o) => o.value !== hr?.employee?.id)} />
        </Field>
        <Field label="Exit type" required error={errors.type}><Select value={v.type} onChange={set("type")} options={EXIT_TYPES.map((t) => ({ value: t, label: label(t) }))} /></Field>
        <Field label="Last working day" required error={errors.lwd}><Input type="date" value={v.lwd} onChange={set("lwd")} /></Field>
        <Field label="Reason" required error={errors.reason}><Textarea value={v.reason} maxLength={4000} onChange={set("reason")} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function ExitList() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [scope, setScope] = useState("active");
  const [type, setType] = useState("");
  const [creating, setCreating] = useState(false);
  const list = useHrQuery(() => listExits({ scope, type }), [scope, type]);
  return (
    <>
      <PageHeader title="Exit Management" description="Resignations, terminations and other exits from submission to closure."
        actions={hasPermission("exit.manage") && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden="true" />Initiate exit</Button>} />
      <Tabs value={scope} onChange={setScope} label="Exit case status" tabs={[{ value: "active", label: "Active" }, { value: "closed", label: "Closed / ended" }, { value: "all", label: "All" }]} />
      <Toolbar>
        <Select aria-label="Exit type" className="sm:w-48" placeholder="All exit types" value={type} onChange={(e) => setType(e.target.value)} options={EXIT_TYPES.map((t) => ({ value: t, label: label(t) }))} />
      </Toolbar>
      <DataTable caption="Exit cases" rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle={scope === "active" ? "No active exits" : "No exit cases"} onRowClick={(r) => navigate(`/hr/exits/${r.id}`)}
        columns={[
          { key: "employee", header: "Employee", render: (r) => (r.employee ? <div className="min-w-[10rem]"><p className="font-semibold text-[#101a3a]">{fullName(r.employee)}</p><p className="font-mono text-xs text-slate-500">{r.employee.employee_code}</p></div> : "—") },
          { key: "exit_type", header: "Type", render: (r) => <Badge tone={r.exit_type === "termination" ? "red" : "slate"}>{label(r.exit_type)}</Badge> },
          { key: "resignation_date", header: "Resignation date", sortable: true, render: (r) => formatDate(r.resignation_date) },
          { key: "proposed_last_working_day", header: "Proposed LWD", render: (r) => formatDate(r.proposed_last_working_day) },
          { key: "approved_last_working_day", header: "Approved LWD", sortable: true, render: (r) => formatDate(r.approved_last_working_day) },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "initiated_by", header: "Initiated by", render: (r) => label(r.initiated_by) },
        ]} />
      {creating && <InitiateModal onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); list.reload(); if (id) navigate(`/hr/exits/${id}`); }} />}
    </>
  );
}

// ------------------------------------------------------------------ detail
function HrReviewModal({ exit, onClose, onDone }) {
  const { notify } = useToast();
  const [decision, setDecision] = useState("approve");
  const [lwd, setLwd] = useState(exit.proposed_last_working_day ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (decision === "approve" && !lwd) { setError("Set the approved last working day."); return; }
    if (decision === "approve" && exit.resignation_date && lwd < exit.resignation_date) { setError("The last working day cannot be before the resignation date."); return; }
    if (decision === "reject" && !note.trim()) { setError("Add a note explaining the decision."); return; }
    setBusy(true); setError(null);
    const res = await hrReviewExit(exit.id, decision === "approve", decision === "approve" ? lwd : null, note);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(decision === "approve" ? "Resignation accepted; notice period started." : "Resignation rejected.");
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="HR review" size="md"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button variant={decision === "approve" ? "success" : "danger"} loading={busy} onClick={submit}>{decision === "approve" ? "Approve" : "Reject"}</Button></>}>
      <div className="flex flex-col gap-3">
        {exit.manager_decision && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm">Manager: <strong>{exit.manager_decision}</strong>{exit.manager_note ? ` — ${exit.manager_note}` : ""}</p>}
        <fieldset className="flex gap-4"><legend className="sr-only">Decision</legend>
          {["approve", "reject"].map((d) => (
            <label key={d} className="inline-flex items-center gap-2 text-sm font-semibold text-[#173a52]">
              <input type="radio" name="hr-decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="h-4 w-4 text-[#f96706]" />{d === "approve" ? "Approve" : "Reject"}
            </label>
          ))}
        </fieldset>
        {decision === "approve" && <Field label="Approved last working day" required hint={`Proposed: ${formatDate(exit.proposed_last_working_day)}`}><Input type="date" min={exit.resignation_date ?? undefined} value={lwd} onChange={(e) => setLwd(e.target.value)} /></Field>}
        <Field label={decision === "reject" ? "Reason" : "Note (optional)"} required={decision === "reject"}><Textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function OpenAssets({ employeeId }) {
  const q = useHrQuery(() => exitOpenAssets(employeeId), [employeeId]);
  if (q.loading && !q.data) return <Loading label="Checking assigned assets…" />;
  if (q.error) return <InlineError message={q.error} />;
  if (!q.data?.length) return <p className="text-xs font-semibold text-emerald-700">No assets are held or awaiting return inspection. If the employee ever held equipment, record the asset clearance in the Asset clearance panel before completing this item.</p>;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
      <p className="font-semibold">{q.data.length} asset(s) still assigned or awaiting return inspection — receive, inspect and complete their returns first:</p>
      <ul className="mt-1 list-disc pl-5">{q.data.map((a) => <li key={a.assignment_id}><span className="font-mono">{a.asset_tag}</span> · {a.asset_type} {[a.brand, a.model].filter(Boolean).join(" ")}{a.quantity > 1 ? ` ×${a.quantity}` : ""}</li>)}</ul>
    </div>
  );
}

function ClearanceItem({ item, exit, canAct, canReopen, canOverride, settlementApproved, onChanged }) {
  const { notify } = useToast();
  const [dialog, setDialog] = useState(null);   // completed | not_applicable | pending | revoke | exception
  const settlementStage = exit.status === "final_settlement";
  const stageOpen = exit.status === "clearance" || (settlementStage && ["final_settlement", "relieving_letter"].includes(item.item_key));
  const editable = canAct && stageOpen;
  const needsRevoke = item.item_key === "access_revocation" && !exit.auth_access_revoked_at && exit.employee?.user_id;
  const waitsForSettlement = item.item_key === "final_settlement" && !settlementApproved;
  const overdue = item.status === "pending" && item.due_date && item.due_date < today();
  return (
    <li className="rounded-xl border border-slate-100 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold text-[#101a3a]">
            {item.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : item.status === "not_applicable" ? <Ban className="h-4 w-4 text-slate-400" aria-hidden="true" /> : item.status === "waived" ? <ShieldAlert className="h-4 w-4 text-orange-600" aria-hidden="true" /> : <Circle className="h-4 w-4 text-amber-500" aria-hidden="true" />}
            {CLEARANCE_LABELS[item.item_key] ?? label(item.item_key)}
          </p>
          <p className="text-xs text-slate-500">
            {item.department ? `${item.department} · ` : ""}Owner: {label(item.owner_role)} · <StatusBadge status={item.status === "not_applicable" ? "n/a" : item.status === "waived" ? "exception" : item.status} />
            {item.due_date && item.status === "pending" ? <span className={overdue ? "font-semibold text-rose-700" : undefined}> · due {formatDate(item.due_date)}{overdue ? " (overdue)" : ""}</span> : null}
            {item.completed_at ? ` · ${formatDateTime(item.completed_at)}` : ""}
          </p>
          {item.note && <p className="mt-1 text-sm text-slate-700">{item.note}</p>}
          {item.exception_reason && <p className="mt-1 rounded-lg bg-orange-50 px-2 py-1 text-sm text-orange-900"><strong>Authorised exception:</strong> {item.exception_reason}{item.exception_at ? ` · ${formatDateTime(item.exception_at)}` : ""}</p>}
          {waitsForSettlement && item.status === "pending" && <p className="mt-1 text-xs text-slate-500">Completed automatically when payroll approves the full and final settlement.</p>}
        </div>
        {(editable || (canReopen && stageOpen) || (canOverride && stageOpen)) && (
          <span className="flex flex-wrap gap-1">
            {editable && item.status === "pending" && needsRevoke && <Button size="sm" variant="danger" onClick={() => setDialog("revoke")}><KeyRound className="h-4 w-4" aria-hidden="true" />{exit.access_revocation_status === "failed" ? "Retry revocation" : "Revoke sign-in access"}</Button>}
            {editable && item.status === "pending" && !waitsForSettlement && <Button size="sm" variant="success" disabled={Boolean(needsRevoke)} title={needsRevoke ? "Revoke sign-in access first" : undefined} onClick={() => setDialog("completed")}>Complete</Button>}
            {editable && item.status === "pending" && !needsRevoke && <Button size="sm" variant="secondary" onClick={() => setDialog("not_applicable")}>Not applicable</Button>}
            {canOverride && item.status === "pending" && <Button size="sm" variant="ghost" onClick={() => setDialog("exception")}><ShieldAlert className="h-4 w-4" aria-hidden="true" />Exception</Button>}
            {canReopen && item.status !== "pending" && exit.status === "clearance" && <Button size="sm" variant="ghost" onClick={() => setDialog("pending")}><RotateCcw className="h-4 w-4" aria-hidden="true" />Reopen</Button>}
          </span>
        )}
      </div>
      {item.item_key === "asset_return" && item.status === "pending" && <div className="mt-2"><OpenAssets employeeId={exit.employee_id} /></div>}
      {item.item_key === "access_revocation" && exit.auth_access_revoked_at && <p className="mt-1 text-xs text-emerald-700">Sign-in access revoked {formatDateTime(exit.auth_access_revoked_at)}.</p>}
      {item.item_key === "access_revocation" && exit.access_revocation_status === "failed" && !exit.auth_access_revoked_at && (
        <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-sm text-rose-800">
          <strong>Access revocation failed.</strong> {exit.access_revocation_error} The exit cannot be closed until revocation succeeds or an authorised exception is recorded.
        </p>
      )}
      <ConfirmDialog open={dialog === "exception"} onClose={() => setDialog(null)} tone="danger" title={`Authorised exception: ${CLEARANCE_LABELS[item.item_key]}`}
        message={item.item_key === "access_revocation"
          ? "Use only when the revocation service cannot complete. Portal data access still ends when the exit is closed. The exception is audited and HR is notified."
          : "This mandatory item will no longer block the exit. The exception, your name and the reason are recorded in the audit log and HR is notified."}
        confirmLabel="Record exception" requireReason reasonLabel="Reason (at least 10 characters)"
        onConfirm={async (reason) => { const res = await grantClearanceException(item.id, reason); if (!res.error) { notify("Exception recorded."); onChanged(); } return res; }} />
      <ConfirmDialog open={dialog === "completed"} onClose={() => setDialog(null)} tone="success" title={`Complete: ${CLEARANCE_LABELS[item.item_key]}`}
        message="Mark this clearance item as completed?" confirmLabel="Complete" requireReason={false} reasonLabel="Note (optional)"
        onConfirm={async (note) => { const res = await completeClearanceItem(item.id, "completed", note); if (!res.error) { notify("Clearance item completed."); onChanged(); } return res; }} />
      <ConfirmDialog open={dialog === "not_applicable"} onClose={() => setDialog(null)} title={`Not applicable: ${CLEARANCE_LABELS[item.item_key]}`}
        message="Explain why this item does not apply to this exit." confirmLabel="Mark not applicable" requireReason reasonLabel="Note"
        onConfirm={async (note) => { const res = await completeClearanceItem(item.id, "not_applicable", note); if (!res.error) { notify("Clearance item marked not applicable."); onChanged(); } return res; }} />
      <ConfirmDialog open={dialog === "pending"} onClose={() => setDialog(null)} title="Reopen clearance item" message="Set this item back to pending?" confirmLabel="Reopen"
        onConfirm={async () => { const res = await completeClearanceItem(item.id, "pending"); if (!res.error) { notify("Clearance item reopened."); onChanged(); } return res; }} />
      <ConfirmDialog open={dialog === "revoke"} onClose={() => setDialog(null)} tone="danger" title="Revoke sign-in access"
        message={`${empText(exit.employee)} will be signed out and blocked from signing in to the portal immediately. This is done on the server and cannot be undone from here.`}
        confirmLabel="Revoke access"
        onConfirm={async () => { const res = await revokeExitAccess(exit.id); if (!res.error) { notify("Sign-in access revoked. You can now complete this item."); onChanged(); } return res; }} />
    </li>
  );
}

function ExitDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission, hr } = useAuth();
  const { notify } = useToast();
  const exit = useHrQuery(() => getExit(id), [id]);
  const events = useHrQuery(() => getExitEvents(id), [id]);
  const items = useHrQuery(() => getClearanceItems(id), [id]);
  const settlement = useHrQuery(() => exitSettlementStatus(id), [id]);
  const attempts = useHrQuery(() => (hasPermission("exit.manage") || hasPermission("exit.clearance_it") ? listAccessRevocationAttempts(id) : Promise.resolve({ data: [], error: null })), [id]);
  const [dialog, setDialog] = useState(null);
  const refresh = () => { exit.reload(); events.reload(); items.reload(); settlement.reload(); attempts.reload(); };

  if (exit.loading && !exit.data) return <Loading />;
  if (exit.error) return <ErrorState message={exit.error} onRetry={exit.reload} />;
  if (!exit.data) return <EmptyState title="Exit case not found" description="It does not exist or you are not allowed to view it." action={<Button variant="secondary" onClick={() => navigate("/hr/exits")}>Back to list</Button>} />;

  const x = exit.data;
  const own = x.employee_id === hr?.employee?.id;
  const canManage = hasPermission("exit.manage") && !own;
  const canManagerReview = hasPermission("exit.approve_team") && !own && x.status === "manager_review";
  const inReview = ["submitted", "manager_review", "hr_review"].includes(x.status);
  const canWithdraw = canManage && ["submitted", "manager_review", "hr_review", "notice_period", "clearance"].includes(x.status);
  const pendingNonSettlement = (items.data ?? []).filter((i) => i.status === "pending" && !["final_settlement", "relieving_letter"].includes(i.item_key));
  const pendingAll = (items.data ?? []).filter((i) => i.status === "pending");
  const lwdReached = x.approved_last_working_day && x.approved_last_working_day <= today();
  const done = (msg) => { if (msg) notify(msg); refresh(); };

  return (
    <>
      <button type="button" onClick={() => navigate("/hr/exits")} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All exit cases
      </button>
      <PageHeader title={x.employee ? fullName(x.employee) : "Exit case"}
        description={<span className="flex flex-wrap items-center gap-2">{x.employee && <span className="font-mono font-bold text-[#1f4693]">{x.employee.employee_code}</span>}<Badge>{label(x.exit_type)}</Badge><StatusBadge status={x.status} /></span>}
        actions={<>
          {canManagerReview && <Button variant="danger" onClick={() => setDialog("mgr_reject")}>Manager: reject</Button>}
          {canManagerReview && <Button variant="success" onClick={() => setDialog("mgr_approve")}>Manager: approve</Button>}
          {canManage && inReview && <Button onClick={() => setDialog("hr_review")}>HR review</Button>}
          {canManage && x.status === "notice_period" && <Button onClick={() => setDialog("start_clearance")}>Start clearance</Button>}
          {canManage && x.status === "clearance" && <Button onClick={() => setDialog("settlement")} disabled={pendingNonSettlement.length > 0} title={pendingNonSettlement.length ? "Complete the clearance items first" : undefined}>Move to final settlement</Button>}
          {canManage && x.status === "final_settlement" && <Button variant="danger" onClick={() => setDialog("close")}><LogOut className="h-4 w-4" aria-hidden="true" />Close exit</Button>}
          {canWithdraw && <Button variant="secondary" onClick={() => setDialog("withdraw")}><XCircle className="h-4 w-4" aria-hidden="true" />Withdraw case</Button>}
        </>} />
      {own && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This is your own exit case; another HR user must process it.</p>}

      <Card className="mb-4"><ExitStepper exit={x} /></Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          <Card title="Case details">
            <DescriptionList items={[
              { label: "Employee", value: empText(x.employee) },
              { label: "Initiated by", value: label(x.initiated_by) },
              { label: "Resignation date", value: formatDate(x.resignation_date) },
              { label: "Notice period", value: x.notice_period_days != null ? `${x.notice_period_days} days` : null },
              { label: "Proposed last working day", value: formatDate(x.proposed_last_working_day) },
              { label: "Approved last working day", value: formatDate(x.approved_last_working_day) },
              { label: "Reason", value: x.reason ? <span className="whitespace-pre-line">{x.reason}</span> : null },
              x.manager_decision && { label: "Manager decision", value: `${x.manager_decision} · ${formatDateTime(x.manager_decided_at)}${x.manager_note ? ` — ${x.manager_note}` : ""}` },
              x.hr_decision && { label: "HR decision", value: `${x.hr_decision} · ${formatDateTime(x.hr_decided_at)}${x.hr_note ? ` — ${x.hr_note}` : ""}` },
              { label: "Sign-in access revoked", value: formatDateTime(x.auth_access_revoked_at) },
              { label: "Relieving letter", value: x.relieving_letter_issued_at ? `Issued ${formatDateTime(x.relieving_letter_issued_at)}` : "Not issued" },
              { label: "Experience letter", value: x.experience_letter_issued_at ? `Issued ${formatDateTime(x.experience_letter_issued_at)}` : "Not issued" },
              x.settlement_notes && { label: "Settlement notes", value: x.settlement_notes },
              x.closed_at && { label: "Closed", value: formatDateTime(x.closed_at) },
            ]} />
            {canManage && ["final_settlement", "closed"].includes(x.status) && (
              <div className="mt-4 flex flex-wrap gap-2">
                {!x.relieving_letter_issued_at && <Button size="sm" variant="secondary" onClick={() => setDialog("relieving")}><FileSignature className="h-4 w-4" aria-hidden="true" />Record relieving letter issued</Button>}
                {!x.experience_letter_issued_at && <Button size="sm" variant="secondary" onClick={() => setDialog("experience")}><FileSignature className="h-4 w-4" aria-hidden="true" />Record experience letter issued</Button>}
              </div>
            )}
          </Card>
          <Card title="Clearance checklist">
            {items.loading && !items.data ? <Loading /> : items.error ? <ErrorState message={items.error} onRetry={items.reload} /> : !items.data?.length ? (
              <EmptyState title="Clearance not started" description={x.status === "notice_period" ? "Start clearance to create the checklist." : "The checklist is created when clearance starts."} />
            ) : (
              <>
                {x.status === "clearance" && canManage && x.employee?.user_id && !x.auth_access_revoked_at && (
                  <p className="mb-3 text-xs text-slate-500">Revoke sign-in access from the access revocation item before completing it.</p>
                )}
                <ul className="flex flex-col gap-2">{items.data.map((it) => (
                  <ClearanceItem key={it.id} item={it} exit={x} onChanged={refresh}
                    canAct={canActOnClearance(it.item_key, hasPermission, { isLeaver: own, isLineManager: x.employee?.manager_id === hr?.employee?.id })}
                    canReopen={canManage} canOverride={hasPermission("exit.override") && !own}
                    settlementApproved={["approved", "paid"].includes(settlement.data?.status)} />
                ))}</ul>
              </>
            )}
          </Card>
          {["notice_period", "clearance", "final_settlement", "closed"].includes(x.status)
            && ["assets.view", "assets.manage", "exit.view", "exit.manage"].some((p) => hasPermission(p)) && (
            <EmployeeAssetsPanel employeeId={x.employee_id} exitId={x.id} mode="exit" />   /* Module 11: returns, inspection, clearance sign-off */
          )}
        </div>
        <div className="flex flex-col gap-4">
        <Card title="Full & final settlement">
          {settlement.loading && !settlement.data ? <Loading /> : settlement.error ? <InlineError message={settlement.error} /> : !settlement.data ? (
            <p className="text-sm text-slate-600">{["clearance", "final_settlement"].includes(x.status) ? "Not prepared yet. Payroll prepares it in Onboarding & Exit > Final Settlement." : "Prepared by payroll from the clearance stage."}</p>
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              <p><StatusBadge status={settlement.data.status} /></p>
              {settlement.data.submitted_at && <p className="text-xs text-slate-500">Submitted {formatDateTime(settlement.data.submitted_at)}</p>}
              {settlement.data.approved_at && <p className="text-xs text-slate-500">Approved {formatDateTime(settlement.data.approved_at)}</p>}
              {settlement.data.paid_on && <p className="text-xs text-slate-500">Paid {formatDate(settlement.data.paid_on)}</p>}
              {hasPermission("payroll.view") && <button type="button" className="text-left text-xs font-semibold text-[#1f4693] hover:underline" onClick={() => navigate(`/hr/onboarding-exit/settlement/${settlement.data.id}`)}>Open settlement</button>}
            </div>
          )}
        </Card>
        {attempts.data?.length > 0 && (
          <Card title="Access revocation attempts">
            <ul className="flex flex-col gap-1.5 text-sm">{attempts.data.map((a) => (
              <li key={a.id}><StatusBadge status={a.outcome} /> <span className="text-xs text-slate-500">{formatDateTime(a.created_at)}</span>{a.detail && <p className="text-xs text-slate-600">{a.detail}</p>}</li>
            ))}</ul>
          </Card>
        )}
        <Card title="Timeline">
          {events.loading && !events.data ? <Loading /> : events.error ? <ErrorState message={events.error} onRetry={events.reload} /> : !events.data?.length ? <p className="text-sm text-slate-600">No events yet.</p> : (
            <ol className="relative flex flex-col gap-3 border-l-2 border-slate-100 pl-4">
              {events.data.map((ev) => (
                <li key={ev.id} className="text-sm">
                  <span className="absolute -left-[5px] mt-1.5 h-2 w-2 rounded-full bg-[#f96706]" aria-hidden="true" />
                  <p className="font-semibold text-[#101a3a]">{label(ev.event_type)}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(ev.created_at)}{ev.from_status || ev.to_status ? ` · ${label(ev.from_status ?? "—")} → ${label(ev.to_status ?? "—")}` : ""}</p>
                  {ev.note && <p className="mt-0.5 whitespace-pre-line text-slate-700">{ev.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </Card>
        </div>
      </div>

      {dialog === "hr_review" && <HrReviewModal exit={x} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      <ConfirmDialog open={dialog === "mgr_approve"} onClose={() => setDialog(null)} tone="success" title="Manager review: approve"
        message="Record your approval. HR makes the final decision and sets the last working day." confirmLabel="Approve" requireReason={false} reasonLabel="Note (optional)"
        onConfirm={async (note) => { const res = await managerReviewExit(x.id, true, note); if (!res.error) done("Manager approval recorded; the case moved to HR review."); return res; }} />
      <ConfirmDialog open={dialog === "mgr_reject"} onClose={() => setDialog(null)} tone="danger" title="Manager review: raise concerns"
        message="Your concerns are recorded and the case moves to HR review." confirmLabel="Record rejection" requireReason reasonLabel="Concerns"
        onConfirm={async (note) => { const res = await managerReviewExit(x.id, false, note); if (!res.error) done("Manager decision recorded; the case moved to HR review."); return res; }} />
      <ConfirmDialog open={dialog === "start_clearance"} onClose={() => setDialog(null)} title="Start exit clearance"
        message="The clearance checklist (asset return, access revocation, handovers, HR and payroll clearance, settlement, relieving letter) is created and the employee is notified." confirmLabel="Start clearance"
        onConfirm={async () => { const res = await startExitClearance(x.id); if (!res.error) done("Clearance started."); return res; }} />
      <ConfirmDialog open={dialog === "settlement"} onClose={() => setDialog(null)} title="Move to final settlement"
        message="All clearance items except final settlement and relieving letter must be complete or not applicable." confirmLabel="Move to settlement"
        onConfirm={async () => { const res = await moveExitToSettlement(x.id); if (!res.error) done("Case moved to final settlement."); return res; }} />
      <ConfirmDialog open={dialog === "relieving"} onClose={() => setDialog(null)} title="Relieving letter issued"
        message="Record that the relieving letter has been issued to the employee. The employee is notified." confirmLabel="Record"
        onConfirm={async () => { const res = await recordExitLetter(x.id, "relieving"); if (!res.error) done("Relieving letter recorded."); return res; }} />
      <ConfirmDialog open={dialog === "experience"} onClose={() => setDialog(null)} title="Experience letter issued"
        message="Record that the experience letter has been issued to the employee. The employee is notified." confirmLabel="Record"
        onConfirm={async () => { const res = await recordExitLetter(x.id, "experience"); if (!res.error) done("Experience letter recorded."); return res; }} />
      <ConfirmDialog open={dialog === "withdraw"} onClose={() => setDialog(null)} tone="danger" title="Withdraw exit case"
        message={["notice_period", "clearance"].includes(x.status) ? "The case is withdrawn and the employee's previous employment status is restored." : "The case is withdrawn. The employee and manager are notified."}
        confirmLabel="Withdraw case" requireReason={false} reasonLabel="Note (optional)"
        onConfirm={async (note) => { const res = await withdrawExit(x.id, note); if (!res.error) done("Exit case withdrawn."); return res; }} />
      <ConfirmDialog open={dialog === "close"} onClose={() => setDialog(null)} tone="danger" title="Close exit — irreversible"
        message={`This cannot be undone. ${empText(x.employee)} will be marked as exited, their Employee Portal access will be turned off, and every role they hold will be removed. Their history and documents are kept.${pendingAll.length ? ` Pending items: ${pendingAll.map((i) => CLEARANCE_LABELS[i.item_key]).join(", ")}.` : ""}${!lwdReached ? ` The last working day (${formatDate(x.approved_last_working_day)}) has not been reached yet, so the server will refuse.` : ""}`}
        confirmLabel="Close exit permanently" requireReason={false} reasonLabel="Settlement notes (optional)"
        onConfirm={async (notes) => { const res = await closeExit(x.id, notes); if (!res.error) done("Exit closed. The employee is now marked as exited."); return res; }} />
    </>
  );
}

export default function ExitsPage() {
  return (
    <Routes>
      <Route index element={<ExitList />} />
      <Route path=":id" element={<ExitDetail />} />
    </Routes>
  );
}
