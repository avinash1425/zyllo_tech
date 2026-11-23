import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { decideLeave, getTeamLeave } from "@/lib/api/employee/leave";
import { formatDate } from "../attendanceFormat";
import { CARD } from "../projectsUi";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT } from "../reportsUi";
import { LeaveStatusChip, LeaveTabs, leaveDates } from "./LeavePage";

const num = (v) => Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });

const FILTERS = [
  { key: "pending", label: "Waiting for approval" },
  { key: "all", label: "All (last 90 days + upcoming)" },
];

function RequestCard({ r, onDecided }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function act(action) {
    if (action === "rejected" && !comment.trim()) return setMessage("Write a reason for rejecting.");
    setBusy(true);
    const res = await decideLeave(r.id, action, comment);
    setBusy(false);
    if (!res.ok) return setMessage(res.message);
    setMessage("");
    onDecided(res.request);
  }

  return (
    <section className={CARD} aria-label={`${r.employee.full_name}, ${r.leave_name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-[#101a3a]">{r.employee.full_name}</h3>
        <span className="font-mono text-[11px] text-[#9aa0ad]">{r.employee.employee_code}</span>
        <LeaveStatusChip status={r.status} />
        <span className="ml-auto text-xs text-[#9aa0ad]">Applied {formatDate(r.created_at.slice(0, 10))}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">Type</dt>
          <dd className="text-sm font-semibold text-[#101a3a]">{r.leave_name}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">Dates</dt>
          <dd className="text-sm font-semibold text-[#101a3a]">{leaveDates(r)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">Days</dt>
          <dd className="text-sm font-semibold tabular-nums text-[#101a3a]">{num(r.days)}</dd>
        </div>
      </dl>
      <p className="mt-3 whitespace-pre-line break-words rounded-lg bg-[#f6f7fb] px-3 py-2 text-sm text-[#2b303b]">{r.reason}</p>
      {r.status !== "pending" && r.decided_by && (
        <p className="mt-2 text-xs text-[#676b7a]">
          {r.status === "cancelled" ? "Cancelled by the employee." : `By ${r.decided_by}${r.decision_comment ? `: ${r.decision_comment}` : ""}`}
        </p>
      )}
      {r.status === "pending" && (
        <div className="mt-3 flex flex-col gap-2">
          <label htmlFor={`lc-${r.id}`} className="text-xs font-semibold text-[#4a5880]">
            Comment (needed when rejecting)
          </label>
          <textarea id={`lc-${r.id}`} rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} className={INPUT(false)} />
          {message && <p role="alert" className="text-sm text-red-700">{message}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => act("approved")}>
              <CheckCircle2 size={16} aria-hidden="true" /> {busy ? "Saving…" : "Approve"}
            </button>
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => act("rejected")}>
              <XCircle size={16} aria-hidden="true" /> Reject
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default function TeamLeavePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("pending");

  useEffect(() => {
    getTeamLeave()
      .then(setData)
      .catch(() => setError("Could not load team leave. Please refresh the page."));
  }, []);

  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-[#676b7a]">Loading…</p>;

  const waiting = data.requests.filter((r) => r.status === "pending").length;
  const rows = filter === "all" ? data.requests : data.requests.filter((r) => r.status === "pending");
  const replace = (updated) => setData((d) => ({ ...d, requests: d.requests.map((r) => (r.id === updated.id ? updated : r)) }));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <LeaveTabs active="team" teamSize={Math.max(1, data.team_size)} waiting={waiting} />
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Show">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="radio"
            aria-checked={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
              filter === f.key ? "border-[#1f4693] bg-[#1f4693] text-white" : "border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]"
            }`}
          >
            {f.label}
            {f.key === "pending" && waiting > 0 ? ` (${waiting})` : ""}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className={`${CARD} text-center text-sm text-[#676b7a]`}>
          {filter === "pending" ? "No leave requests waiting for you." : "No leave requests from your team."}
        </p>
      ) : (
        rows.map((r) => <RequestCard key={r.id} r={r} onDecided={replace} />)
      )}
    </div>
  );
}
