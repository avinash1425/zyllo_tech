import { useEffect, useState } from "react";
import { ClipboardEdit, Loader2, Plus, Send } from "lucide-react";
import { getMySessionsByDay } from "@/lib/api/employee/attendance";
import { CORRECTION_STATUS, cancelCorrection, getMyCorrections, requestCorrection, toHm } from "@/lib/api/employee/corrections";
import { Alert, Badge, Chips, Empty, Panel } from "@/components/portal/PortalUI";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL } from "@/components/portal/portalStyles";
import { correctionMinDate, formatDate, formatTime, todayIst } from "./attendanceFormat";
import { useAccess } from "@/lib/access";

/** Badge tone per correction status. */
const TONE = { pending: "amber", approved: "green", rejected: "red", cancelled: "slate" };
/** Chip key for "+ Add a missing session" (target === ""). */
const ADD = "__add";

function Form({ employeeId, initialDate, onSent, onClose }) {
  const today = todayIst().iso;
  const [date, setDate] = useState(initialDate || today);
  const [sessions, setSessions] = useState(null);
  const [target, setTarget] = useState(""); // session id, or "" = add a missing session
  const [inHm, setInHm] = useState("");
  const [outHm, setOutHm] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getMySessionsByDay(employeeId, date, date)
      .then((m) => {
        if (!active) return;
        const list = m.get(date) ?? [];
        setSessions(list);
        // Pre-select the last session (most often the missed / auto punch out).
        const last = list[list.length - 1];
        setTarget(last ? last.id : "");
        setInHm(last ? toHm(last.punch_in_at) : "");
        setOutHm(last ? toHm(last.punch_out_at) : "");
      })
      .catch(() => active && setSessions([]));
    return () => {
      active = false;
    };
  }, [employeeId, date]);

  function pick(s) {
    setTarget(s ? s.id : "");
    setInHm(s ? toHm(s.punch_in_at) : "");
    setOutHm(s ? toHm(s.punch_out_at) : "");
  }

  async function submit(e) {
    e.preventDefault();
    if (!reason.trim()) return setError("Write a reason.");
    if (!target && (!inHm || !outHm)) return setError("Enter both punch in and punch out for the missing session.");
    setBusy(true);
    setError("");
    const r = await requestCorrection({ date, attendanceId: target, inHm, outHm, reason });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onSent();
  }

  const choices = [
    ...(sessions ?? []).map((s, i) => ({
      key: s.id,
      label: `${i + 1}. ${formatTime(s.punch_in_at)} → ${s.punch_out_at ? formatTime(s.punch_out_at) : "now"}${s.auto_punched_out ? " (auto)" : ""}`,
    })),
    { key: ADD, label: "+ Add a missing session" },
  ];

  return (
    <form
      onSubmit={submit}
      noValidate
      className="mb-5 rounded-2xl border border-[#dce6f7] bg-gradient-to-br from-[#f8faff] to-white p-4 sm:p-5"
    >
      <p className="mb-4 flex items-center gap-2 text-sm font-bold text-[#101a3a]">
        <span className="h-4 w-1 rounded-full bg-gradient-to-b from-[#f7941e] to-[#f96706]" aria-hidden="true" />
        Request an attendance correction
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="cr-date" className={LABEL}>
            Day
          </label>
          <input
            id="cr-date"
            type="date"
            min={correctionMinDate()}
            max={today}
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className={INPUT(false)}
          />
          <p className="mt-1 text-xs text-[#9aa0ad]">Today or up to 30 days back.</p>
        </div>
        <div>
          <p className={LABEL}>What to correct</p>
          {sessions === null ? (
            <p className="flex items-center gap-2 text-xs text-[#676b7a]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Loading…
            </p>
          ) : (
            <Chips
              label="Session to correct"
              items={choices}
              value={target || ADD}
              onChange={(k) => pick(k === ADD ? null : sessions.find((s) => s.id === k))}
            />
          )}
        </div>
        <div>
          <label htmlFor="cr-in" className={LABEL}>
            Correct punch in
          </label>
          <input id="cr-in" type="time" value={inHm} onChange={(e) => setInHm(e.target.value)} className={INPUT(false)} />
        </div>
        <div>
          <label htmlFor="cr-out" className={LABEL}>
            Correct punch out
          </label>
          <input id="cr-out" type="time" value={outHm} onChange={(e) => setOutHm(e.target.value)} className={INPUT(false)} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="cr-reason" className={LABEL}>
            Reason
          </label>
          <textarea
            id="cr-reason"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Forgot to punch out; I left at 7:10 PM."
            className={`${INPUT(false)} resize-y`}
          />
        </div>
      </div>
      <p className="mt-3 text-xs text-[#9aa0ad]">Times are India time. The admin approves or rejects; you get a notification.</p>
      <Alert kind="err" className="mt-3">
        {error}
      </Alert>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={BTN_PRIMARY}>
          <Send className="h-4 w-4" aria-hidden="true" />
          {busy ? "Sending…" : "Send request"}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={BTN_SECONDARY}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Times({ inAt, outAt }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-[#2b303b]">
      {inAt ? formatTime(inAt) : "—"} <span className="text-[#9aa0ad]">→</span> {outAt ? formatTime(outAt) : "—"}
    </span>
  );
}

/**
 * Employee: attendance correction requests (migration 242). `openFor` = a date
 * to open the form for (set by the history table's "Correct" link).
 */
export default function CorrectionsCard({ employeeId, openFor, onChanged }) {
  const { can } = useAccess();
  const canEdit = can("emp.attendance.edit");
  const [list, setList] = useState(null);
  const [formDate, setFormDate] = useState(null); // null = closed, "" = today
  const [reload, setReload] = useState(0);
  const [message, setMessage] = useState("");
  const [lastOpen, setLastOpen] = useState(openFor);

  // Opened from the history table.
  if (openFor && openFor !== lastOpen) {
    setLastOpen(openFor);
    setFormDate(openFor.split("#")[0]);
  }

  useEffect(() => {
    let active = true;
    getMyCorrections()
      .then((d) => active && setList(d))
      .catch(() => active && setList([]));
    return () => {
      active = false;
    };
  }, [reload]);

  async function cancel(id) {
    const r = await cancelCorrection(id);
    setMessage(r.ok ? "Request cancelled." : r.message);
    setReload((n) => n + 1);
  }

  return (
    <Panel
      id="ep-corrections"
      icon={ClipboardEdit}
      title="Attendance corrections"
      subtitle="Missed or wrong punch? Ask the admin to fix it."
      className="scroll-mt-24"
      action={
        canEdit &&
        formDate === null && (
          <button type="button" onClick={() => setFormDate("")} className={BTN_SECONDARY}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Request a correction
          </button>
        )
      }
    >
      {canEdit && formDate !== null && (
        <Form
          key={formDate}
          employeeId={employeeId}
          initialDate={formDate}
          onClose={() => setFormDate(null)}
          onSent={() => {
            setFormDate(null);
            setMessage("Request sent to the admin.");
            setReload((n) => n + 1);
            onChanged?.();
          }}
        />
      )}
      <Alert kind="ok" className="mb-4">
        {message}
      </Alert>
      {list === null ? (
        <p className="flex items-center gap-2 text-sm text-[#676b7a]">
          <Loader2 className="h-4 w-4 animate-spin text-[#1f4693]" aria-hidden="true" />
          Loading…
        </p>
      ) : list.length === 0 ? (
        <Empty
          icon={ClipboardEdit}
          className="!py-6"
          message="Forgot to punch in or out, or punched out automatically at 8 PM? Ask for a correction and the admin will fix it."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((c) => {
            const st = CORRECTION_STATUS[c.status];
            const tone = TONE[c.status];
            return (
              <li
                key={c.id}
                className="flex flex-col gap-2 rounded-xl border border-[#eef1f7] bg-[#fbfcfe] px-4 py-3 transition-colors hover:border-[#dce6f7] hover:bg-[#f8faff] sm:flex-row sm:items-start sm:gap-4"
              >
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-[#101a3a]">
                    {formatDate(c.work_date)} · {c.kind === "add" ? "Add missing session" : "Fix punch times"}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-[#676b7a]">
                    {c.kind === "fix" && (
                      <>
                        Was <Times inAt={c.old_in} outAt={c.old_out} /> ·
                      </>
                    )}
                    Asked <Times inAt={c.requested_in ?? c.old_in} outAt={c.requested_out ?? c.old_out} />
                  </p>
                  <p className="mt-1 break-words text-xs text-[#2b303b]">{c.reason}</p>
                  {c.decision_comment && (
                    <p className="mt-1 rounded-lg bg-white px-2.5 py-1.5 text-xs text-[#676b7a] ring-1 ring-inset ring-[#eef1f7]">
                      Admin: {c.decision_comment}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {tone ? (
                    <Badge tone={tone} dot>
                      {st?.label}
                    </Badge>
                  ) : (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${st?.chip}`}>{st?.label}</span>
                  )}
                  {canEdit && c.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => cancel(c.id)}
                      className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
