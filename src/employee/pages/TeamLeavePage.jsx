import { useEffect, useState } from "react";
import { Check, MessageSquareText, Palmtree, Send, X } from "lucide-react";
import { decideLeave, getTeamLeave } from "@/lib/api/employee/leave";
import { formatDateTime } from "../attendanceFormat";
import { Alert, Avatar, Badge, Chips, Empty, Panel } from "@/components/portal/PortalUI";
import { BTN_DANGER, BTN_SECONDARY, BTN_SUCCESS, INPUT, LABEL } from "@/components/portal/portalStyles";
import { LeaveStatusChip, LeaveTabs, leaveDates } from "./LeavePage";
import { useAccess } from "@/lib/access";

const num = (v) => Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });

const FILTERS = [
  { key: "waiting", label: "Waiting for you" },
  { key: "all", label: "All (last 90 days + upcoming)" },
];

/**
 * One request for the reporting manager (migration 257):
 *   manager_review  -> step 1: "Send to admin" (note optional) or Reject
 *   pending         -> with the admin (read-only)
 *   manager_pending -> step 3: the admin approved; Approve (final) or Reject
 * A reason is required to reject.
 */
function RequestItem({ r, onDecided }) {
  const { can } = useAccess();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const review = r.status === "manager_review";
  const waiting = can("team.leave.approve") && (review || r.status === "manager_pending");

  async function act(action) {
    if (action === "rejected" && !comment.trim()) return setError("Write your feedback: the employee needs a reason when leave is rejected.");
    setBusy(true);
    setError("");
    const res = await decideLeave(r.id, action, comment);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    onDecided(res.request);
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Avatar name={r.employee?.full_name} />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-[#101a3a]">
            {r.employee?.full_name} <span className="font-mono text-[11px] font-normal text-[#9aa0ad]">{r.employee?.employee_code}</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[#2b303b]">
            <Badge tone="violet">{r.leave_name}</Badge>
            <span>{leaveDates(r)}</span>
            <span className="text-[#c0c5d2]" aria-hidden="true">
              ·
            </span>
            <span className="font-semibold">
              {num(r.days)} day{Number(r.days) === 1 ? "" : "s"}
            </span>
          </p>
          <p className="mt-2 border-l-2 border-[#f7941e]/50 pl-2.5 text-xs italic text-[#2b303b]">“{r.reason}”</p>
          <p className="mt-1.5 text-[11px] text-[#9aa0ad]">
            Applied {formatDateTime(r.created_at)}
            {r.manager_reviewed_at && ` · You sent it to the admin ${formatDateTime(r.manager_reviewed_at)}`}
            {r.admin_decided_at && ` · Approved by the admin ${formatDateTime(r.admin_decided_at)}`}
          </p>
          {r.admin_comment && (
            <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-[#fff8ef] px-2.5 py-1.5 text-xs text-[#2b303b] ring-1 ring-inset ring-[#f7941e]/25">
              <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#c2560b]" aria-hidden="true" />
              <span className="break-words">
                <span className="font-semibold text-[#c2560b]">Admin: </span>
                {r.admin_comment}
              </span>
            </p>
          )}
          {r.manager_review_comment && (
            <p className="mt-1.5 text-xs text-[#676b7a]">Your note to the admin: {r.manager_review_comment}</p>
          )}
          {r.status === "pending" && <p className="mt-1.5 text-xs font-semibold text-[#c2560b]">With the admin now — you will approve it after the admin does.</p>}
          {!waiting && r.decided_at && (
            <p className="mt-1.5 text-xs text-[#676b7a]">
              {r.status === "approved" ? "Approved" : "Rejected"} by {r.decided_by ?? "—"} on {formatDateTime(r.decided_at)}
              {r.decision_comment && ` · ${r.decision_comment}`}
            </p>
          )}
        </div>
        <div className="sm:text-right">
          <LeaveStatusChip status={r.status} />
        </div>
      </div>
      {waiting && (
        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-[#dce6f7] bg-white p-4 shadow-sm sm:ml-[52px]">
          <label htmlFor={`tl-${r.id}`}>
            <span className={LABEL}>{review ? "Note for the admin" : "Your feedback"}</span>
            <textarea
              id={`tl-${r.id}`}
              rows={2}
              maxLength={1000}
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
                if (error) setError("");
              }}
              placeholder={review ? "Optional when sending to the admin, required when rejecting." : "Optional when approving, required when rejecting."}
              className={`${INPUT(!!error)} resize-y`}
            />
          </label>
          <p className="-mt-1 text-[11px] text-[#9aa0ad]">
            {review
              ? "Step 1: review the request. Send it to the admin, or reject it (final)."
              : "Step 3: the admin approved it. Your decision is final and the employee is notified."}
          </p>
          {error && (
            <Alert kind="err" className="py-2 text-xs">
              {error}
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            {review ? (
              <button type="button" disabled={busy} onClick={() => act("forward")} className={BTN_SUCCESS}>
                <Send className="h-4 w-4" aria-hidden="true" />
                {busy ? "Saving…" : "Send to admin"}
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => act("approved")} className={BTN_SUCCESS}>
                <Check className="h-4 w-4" aria-hidden="true" />
                {busy ? "Saving…" : "Approve"}
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => act("rejected")} className={BTN_DANGER}>
              <X className="h-4 w-4" aria-hidden="true" />
              {busy ? "Saving…" : "Reject"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function TeamLeavePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("waiting");

  useEffect(() => {
    let active = true;
    getTeamLeave()
      .then((d) => active && setData(d))
      .catch(() => active && setError("Could not load team leave. Please refresh the page."));
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <Alert kind="err" className="mx-auto max-w-4xl">
        {error}
      </Alert>
    );
  }
  if (!data) return <p className="py-10 text-center text-sm text-[#676b7a]">Loading…</p>;

  const needsMe = (r) => r.status === "manager_review" || r.status === "manager_pending";
  const waiting = data.requests.filter(needsMe).length;
  const rows = filter === "all" ? data.requests : data.requests.filter(needsMe);
  const replace = (updated) => setData((d) => ({ ...d, requests: d.requests.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) }));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <LeaveTabs active="team" teamSize={1} waiting={waiting} />
      <Panel
        flush
        icon={Palmtree}
        title="Team leave requests"
        subtitle="You review your team's leave first and send it to the admin; after the admin approves, you give the final approval."
      >
        <div className="border-b border-[#eef1f7] bg-[#fafbff] px-5 py-3">
          <Chips
            items={FILTERS.map((f) => (f.key === "waiting" ? { ...f, count: waiting } : f))}
            value={filter}
            onChange={setFilter}
            label="Show"
          />
        </div>
        {rows.length === 0 ? (
          <Empty
            icon={Palmtree}
            title={filter === "waiting" ? "Nothing waiting for you" : "No team leave requests yet"}
            message={filter === "waiting" ? "New leave requests from your team, and the ones the admin approved, appear here." : undefined}
          />
        ) : (
          <ul className="divide-y divide-[#eef1f7]">
            {rows.map((r) => (
              <RequestItem key={r.id} r={r} onDecided={replace} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
