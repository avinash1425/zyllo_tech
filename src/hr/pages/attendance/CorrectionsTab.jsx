// Attendance corrections / regularization approval queue (single workflow,
// hr_attendance_corrections). The server enforces the approval sequence
// (manager -> optional HR review), blocks self-approval and only the final
// approval changes attendance. This screen shows original vs proposed
// values and the request history.
import { useState } from "react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import { CORRECTION_STATUSES, decideCorrection, formatTime, listCorrectionEvents, listCorrections, requestTypeLabel } from "@/lib/hr/attendance";
import { Badge, Button, ConfirmDialog, DataTable, DescriptionList, ErrorState, Field, Loading, Modal, Select, Toolbar, useToast } from "@/hr/ui";
import { AttStatusBadge, EmployeeCell, STAGE_LABEL, empLabel } from "./common";

const ACTION_LABEL = { submitted: "Submitted", manager_approved: "Approved by manager (sent to HR)", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled by employee" };

function Proposed({ r, tz }) {
  const parts = [];
  if (r.requested_check_in_at) parts.push(`in ${formatTime(r.requested_check_in_at, tz)}`);
  if (r.requested_check_out_at) parts.push(`out ${formatTime(r.requested_check_out_at, tz)}`);
  if (r.requested_status) parts.push(`status ${r.requested_status.replace(/_/g, " ")}`);
  return <span className="whitespace-nowrap">{parts.join(" · ") || "—"}</span>;
}
function Original({ r, tz }) {
  if (!r.original_check_in_at && !r.original_status) return <span className="text-slate-400">no record</span>;
  return <span className="whitespace-nowrap">in {formatTime(r.original_check_in_at, tz)} · out {formatTime(r.original_check_out_at, tz)}{r.original_status ? ` · ${r.original_status.replace(/_/g, " ")}` : ""}</span>;
}

export default function CorrectionsTab({ tz, onChanged }) {
  const { hr, hasPermission } = useAuth();
  const { notify } = useToast();
  const isHr = hasPermission("attendance.approve");
  const canApprove = isHr || hasPermission("attendance.approve_team");
  const [status, setStatus] = useState("pending");
  const q = useHrQuery(() => listCorrections({ status }), [status]);
  const [deciding, setDeciding] = useState(null);
  const [detail, setDetail] = useState(null);
  const me = hr?.employee?.id;
  // The server is authoritative; this only hides buttons that would be refused.
  const actionable = (r) => r.status === "pending" && r.employee_id !== me && (isHr || (r.approval_stage === "manager" && !r.manager_decided_at));

  return (
    <>
      <Toolbar>
        <Field label="Status" className="sm:w-48"><Select placeholder="All" value={status} onChange={(e) => setStatus(e.target.value)} options={CORRECTION_STATUSES.map((s) => ({ value: s, label: s }))} /></Field>
      </Toolbar>
      <DataTable caption="Attendance corrections and regularization requests" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} onRowClick={setDetail}
        emptyTitle={status === "pending" ? "No requests waiting" : "No correction requests"}
        columns={[
          { key: "employee", header: "Employee", render: (r) => <EmployeeCell e={r.employee} /> },
          { key: "work_date", header: "Date", render: (r) => formatDate(r.work_date) },
          { key: "type", header: "Type", render: (r) => <span className="whitespace-nowrap">{requestTypeLabel(r.request_type)}</span> },
          { key: "orig", header: "Recorded", render: (r) => <Original r={r} tz={tz} /> },
          { key: "prop", header: "Proposed", render: (r) => <Proposed r={r} tz={tz} /> },
          { key: "reason", header: "Reason", render: (r) => <span className="line-clamp-2 max-w-xs">{r.reason}</span> },
          { key: "status", header: "Status", render: (r) => (
            <div className="flex flex-col gap-1"><AttStatusBadge status={r.status} />{r.status === "pending" && <Badge tone="blue">{STAGE_LABEL[r.approval_stage]}</Badge>}</div>) },
          { key: "created_at", header: "Requested", render: (r) => formatDateTime(r.created_at) },
          ...(canApprove ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => actionable(r) && (
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="success" onClick={() => setDeciding({ row: r, approve: true })}>Approve</Button>
              <Button size="sm" variant="danger" onClick={() => setDeciding({ row: r, approve: false })}>Reject</Button>
            </div>) }] : []),
        ]} />
      <ConfirmDialog open={Boolean(deciding)} onClose={() => setDeciding(null)}
        title={deciding?.approve ? "Approve request?" : "Reject request?"} tone={deciding?.approve ? "success" : "danger"}
        confirmLabel={deciding?.approve ? "Approve" : "Reject"}
        message={deciding ? `${empLabel(deciding.row.employee)} · ${formatDate(deciding.row.work_date)} · ${requestTypeLabel(deciding.row.request_type)}. ${
          deciding.approve ? "If this is the final approval, the server recalculates the attendance record; the original values stay in the request history." : "The employee will be notified with your reason."}` : ""}
        requireReason={deciding ? !deciding.approve : false} reasonLabel={deciding?.approve ? "Note (optional)" : "Reason for rejection"}
        onConfirm={async (note) => {
          const res = await decideCorrection(deciding.row.id, deciding.approve, note);
          if (res.error) return { error: res.error };
          notify(!deciding.approve ? "Request rejected." : res.data?.approval_stage === "hr" ? "Approved — sent to HR for final review." : "Request approved and attendance recalculated.");
          q.reload(); onChanged?.();
          return {};
        }} />
      {detail && <CorrectionDetail row={detail} tz={tz} onClose={() => setDetail(null)} />}
    </>
  );
}

export function CorrectionDetail({ row: r, tz, onClose }) {
  const ev = useHrQuery(() => listCorrectionEvents(r.id), [r.id]);
  return (
    <Modal open onClose={onClose} title={`${requestTypeLabel(r.request_type)} — ${formatDate(r.work_date)}`} size="md">
      <DescriptionList items={[
        r.employee && { label: "Employee", value: empLabel(r.employee) },
        { label: "Status", value: <span className="flex gap-1"><AttStatusBadge status={r.status} />{r.status === "pending" && <Badge tone="blue">{STAGE_LABEL[r.approval_stage]}</Badge>}</span> },
        { label: "Recorded (at request time)", value: <Original r={r} tz={tz} /> },
        { label: "Proposed", value: <Proposed r={r} tz={tz} /> },
        r.status === "approved" && { label: "Applied result", value: `in ${formatTime(r.applied_check_in_at, tz)} · out ${formatTime(r.applied_check_out_at, tz)} · ${String(r.applied_status ?? "").replace(/_/g, " ")}` },
        { label: "Reason", value: r.reason },
        r.evidence_note && { label: "Evidence", value: r.evidence_note },
        r.manager_note && { label: "Manager note", value: r.manager_note },
        r.review_note && { label: "Final review note", value: r.review_note },
      ]} />
      <h3 className="mb-2 mt-4 text-sm font-bold text-[#101a3a]">History</h3>
      {ev.loading ? <Loading /> : ev.error ? <ErrorState message={ev.error} onRetry={ev.reload} /> : (
        <ol className="flex flex-col gap-2 border-l-2 border-slate-200 pl-4">
          {(ev.data ?? []).map((e) => (
            <li key={e.id} className="text-sm">
              <p className="font-semibold text-slate-800">{ACTION_LABEL[e.action] ?? e.action}</p>
              <p className="text-xs text-slate-500">{formatDateTime(e.created_at)}{e.stage ? ` · ${STAGE_LABEL[e.stage] ?? e.stage}` : ""}</p>
              {e.note && <p className="text-xs text-slate-700">{e.note}</p>}
            </li>
          ))}
          {!ev.data?.length && <li className="text-xs text-slate-500">No history recorded (request created before history tracking).</li>}
        </ol>
      )}
    </Modal>
  );
}
