import { useEffect, useMemo, useState } from "react";
import Link from "@/lib/nx/link";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ClipboardList, Plus, Send, Trash2, Users } from "lucide-react";
import { getMyProjects } from "@/lib/api/employee/projects";
import {
  REPORT_DAYS_BACK,
  TEXT_MAX,
  getMyReport,
  getMyReports,
  getTeamReports,
  parseHours,
  saveMyReport,
  validateReport,
} from "@/lib/api/employee/reports";
import { dayName, formatDate, formatHours, todayIst } from "../attendanceFormat";
import { CARD } from "../projectsUi";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  INPUT,
  ReportFacts,
  ReportStatusChip,
  ReportView,
  ReviewNote,
  fmtHours,
} from "../reportsUi";

/** "YYYY-MM-DD" n days before iso. */
function isoMinus(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

const FIELDS = [
  { key: "task_updates", label: "Task updates", hint: "What you did on your tasks today" },
  { key: "completed_work", label: "Completed work", hint: "What is finished" },
  { key: "pending_work", label: "Pending work", hint: "What is left / carried to tomorrow" },
];

const toEntry = (it) => ({
  project_id: it.project_id,
  project_name: it.project_name,
  project_code: it.project_code,
  task_updates: it.task_updates ?? "",
  completed_work: it.completed_work ?? "",
  pending_work: it.pending_work ?? "",
  hours: it.hours == null ? "" : String(Number(it.hours)),
});

/** Tabs at the top: My reports / Team reports (team only for managers). */
export function ReportTabs({ active, hasTeam, waiting }) {
  const tab = (on) =>
    `inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold ${
      on ? "bg-[#1f4693] text-white" : "border border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]"
    }`;
  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/employee/reports" className={tab(active === "mine")}>
        <ClipboardList size={16} aria-hidden="true" /> My reports
      </Link>
      {hasTeam && (
        <Link href="/employee/reports/team" className={tab(active === "team")}>
          <Users size={16} aria-hidden="true" /> Team reports
          {waiting > 0 && (
            <span className="rounded-full bg-[#f7941e] px-1.5 text-[11px] font-bold text-white">{waiting}</span>
          )}
        </Link>
      )}
    </div>
  );
}

export default function DailyReportPage() {
  const today = todayIst().iso;
  const [params] = useSearchParams();
  // ?date=YYYY-MM-DD (links from notifications); otherwise today.
  const [date, setDate] = useState(() => {
    const d = params.get("date");
    return d && /^d{4}-d{2}-d{2}$/.test(d) && d <= today ? d : today;
  });
  const [dayData, setDay] = useState(null); // ep_my_report result (of dayData.date)
  const [projects, setProjects] = useState(null);
  const [history, setHistory] = useState([]);
  const [team, setTeam] = useState({ team: [], reports: [] });
  const [entries, setEntries] = useState([]);
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState(null);
  const [message, setMessage] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [pendingDate, setPendingDate] = useState(null);
  const [loadError, setLoadError] = useState("");

  const loadHistory = () =>
    getMyReports(isoMinus(today, 60), today)
      .then(setHistory)
      .catch(() => {}); // history is optional

  // Day: report + manager + attendance. Until it arrives, `day` is null.
  const day = dayData?.date === date ? dayData : null;
  useEffect(() => {
    let active = true;
    getMyReport(date)
      .then((d) => {
        if (!active) return;
        setDay(d);
        setEntries((d.report?.items ?? []).map(toEntry));
        setNotes(d.report?.notes ?? "");
        setDirty(false);
        setLoadError("");
      })
      .catch(() => active && setLoadError("Could not load the report. Please refresh the page."));
    return () => {
      active = false;
    };
  }, [date]);

  useEffect(() => {
    getMyProjects().then(setProjects).catch(() => setProjects([]));
    getTeamReports().then(setTeam).catch(() => {});
    getMyReports(isoMinus(today, 60), today)
      .then(setHistory)
      .catch(() => {});
  }, [today]);

  const strip = useMemo(() => Array.from({ length: REPORT_DAYS_BACK + 1 }, (_, i) => isoMinus(today, i)), [today]);
  const statusByDate = useMemo(() => new Map(history.map((r) => [r.report_date, r.status])), [history]);

  function chooseDate(iso) {
    if (iso === date) return;
    if (dirty) {
      setPendingDate(iso);
      return;
    }
    switchTo(iso);
  }

  function switchTo(iso) {
    setMessage({ kind: "", text: "" });
    setLoadError("");
    setErrors(null);
    setConfirmSubmit(false);
    setDirty(false);
    setDate(iso);
  }

  const report = day?.report ?? null;
  const editable = !!day && day.date_allowed && (!report || ["draft", "returned"].includes(report.status));
  const addable = (projects ?? []).filter((p) => !entries.some((e) => e.project_id === p.id));
  const total = entries.reduce((s, e) => s + (parseHours(e.hours) || 0), 0);
  const worked = day?.worked_minutes;
  const overAttendance = worked != null && total * 60 > worked + 30;

  function change(i, key, value) {
    setEntries((list) => list.map((e, j) => (j === i ? { ...e, [key]: value } : e)));
    setDirty(true);
    setConfirmSubmit(false);
  }
  function addProject(p) {
    setEntries((list) => [
      ...list,
      { project_id: p.id, project_name: p.name, project_code: p.project_code, task_updates: "", completed_work: "", pending_work: "", hours: "" },
    ]);
    setDirty(true);
  }
  function removeEntry(i) {
    setEntries((list) => list.filter((_, j) => j !== i));
    setDirty(true);
    setConfirmSubmit(false);
  }

  async function save(submit) {
    const v = validateReport(entries, notes, submit);
    setErrors(v);
    if (v) {
      setMessage({ kind: "error", text: v.form || "Please fix the highlighted fields." });
      setConfirmSubmit(false);
      return false;
    }
    setBusy(true);
    setMessage({ kind: "", text: "" });
    const res = await saveMyReport(date, notes, entries, submit);
    setBusy(false);
    setConfirmSubmit(false);
    if (!res.ok) {
      setMessage({ kind: "error", text: res.message });
      return false;
    }
    setDay(res.data);
    setEntries((res.data.report?.items ?? []).map(toEntry));
    setNotes(res.data.report?.notes ?? "");
    setDirty(false);
    setMessage({
      kind: "ok",
      text: submit ? `Report submitted to ${res.data.report?.submitted_to?.full_name ?? "your manager"}.` : "Draft saved.",
    });
    loadHistory();
    return true;
  }

  async function resolvePending(action) {
    const target = pendingDate;
    if (action === "stay") return setPendingDate(null);
    if (action === "save" && !(await save(false))) return setPendingDate(null);
    setPendingDate(null);
    switchTo(target);
  }

  const waiting = team.reports.filter((r) => r.status === "submitted").length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <ReportTabs active="mine" hasTeam={team.team.length > 0} waiting={waiting} />

      {/* Day picker: buttons, no dropdown */}
      <section className={CARD} aria-label="Choose the day">
        <p className="mb-2 text-xs font-semibold text-[#4a5880]">Report for</p>
        <div className="flex flex-wrap gap-1.5">
          {strip.map((iso, i) => {
            const on = iso === date;
            const st = statusByDate.get(iso);
            return (
              <button
                key={iso}
                type="button"
                aria-pressed={on}
                onClick={() => chooseDate(iso)}
                className={`flex min-w-[5.5rem] flex-col items-start rounded-lg border px-3 py-1.5 text-left ${
                  on ? "border-[#1f4693] bg-[#1f4693] text-white" : "border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]"
                }`}
              >
                <span className="text-xs font-bold">{i === 0 ? "Today" : i === 1 ? "Yesterday" : dayName(iso, "short")}</span>
                <span className={`text-[11px] ${on ? "text-white/80" : "text-[#9aa0ad]"}`}>
                  {formatDate(iso).replace(/ \d{4}$/, "")}
                  {st ? ` · ${st === "returned" ? "sent back" : st}` : ""}
                </span>
              </button>
            );
          })}
        </div>
        {pendingDate && (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="flex-1">You have unsaved changes on this report.</span>
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => resolvePending("save")}>
              Save draft and switch
            </button>
            <button type="button" className={BTN_SECONDARY} onClick={() => resolvePending("discard")}>
              Discard changes
            </button>
            <button type="button" className={BTN_SECONDARY} onClick={() => resolvePending("stay")}>
              Stay
            </button>
          </div>
        )}
      </section>

      {loadError && <p role="alert" className="text-sm text-red-700">{loadError}</p>}
      {!day && !loadError && <p className="text-sm text-[#676b7a]">Loading…</p>}

      {day && (
        <>
          <section className={CARD}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-[#101a3a]">
                Daily work report · {dayName(date)}, {formatDate(date)}
              </h2>
              {report ? (
                <ReportStatusChip status={report.status} />
              ) : (
                <span className="text-xs text-[#9aa0ad]">Not started</span>
              )}
            </div>
            {report && !editable ? (
              <ReportFacts report={report} workedMinutes={worked} />
            ) : (
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">Reporting manager</dt>
                  <dd className="mt-0.5 text-sm font-bold text-[#101a3a]">
                    {day.manager ? day.manager.full_name : <span className="text-amber-700">Not set</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">Attendance that day</dt>
                  <dd className="mt-0.5 text-sm font-bold text-[#101a3a]">{worked == null ? "No punch" : formatHours(worked)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">Hours in this report</dt>
                  <dd className="mt-0.5 text-sm font-bold text-[#101a3a]">{fmtHours(total)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">Projects</dt>
                  <dd className="mt-0.5 text-sm font-bold text-[#101a3a]">{entries.length}</dd>
                </div>
              </dl>
            )}
            {editable && !day.manager && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                No reporting manager is set for you yet, so you can save drafts but not submit. Ask the admin to set one.
              </p>
            )}
          </section>

          <ReviewNote report={report} forEmployee />

          {report && !editable && <ReportView report={report} />}
          {!report && !day.date_allowed && (
            <p className={`${CARD} text-sm text-[#676b7a]`}>No report was written for this day.</p>
          )}

          {editable && (
            <>
              {entries.map((e, i) => {
                const err = errors?.items?.[i] ?? {};
                const id = `r-${e.project_id}`;
                return (
                  <section key={e.project_id} className={CARD} aria-label={`Entry for ${e.project_name}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-[#101a3a]">{e.project_name}</h3>
                      <span className="font-mono text-[11px] text-[#9aa0ad]">{e.project_code}</span>
                      <span className="flex-1" />
                      <label htmlFor={`${id}-hours`} className="text-xs font-semibold text-[#4a5880]">
                        Hours spent
                      </label>
                      <input
                        id={`${id}-hours`}
                        inputMode="decimal"
                        value={e.hours}
                        onChange={(ev) => change(i, "hours", ev.target.value)}
                        placeholder="e.g. 3.5"
                        aria-invalid={!!err.hours}
                        aria-describedby={err.hours ? `${id}-hours-e` : undefined}
                        className={`${INPUT(err.hours)} !w-24 text-right tabular-nums`}
                      />
                      <button
                        type="button"
                        onClick={() => removeEntry(i)}
                        className="rounded-lg p-2 text-[#9aa0ad] hover:bg-red-50 hover:text-red-600"
                        aria-label={`Remove ${e.project_name}`}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </div>
                    {err.hours && (
                      <p id={`${id}-hours-e`} className="mt-1 text-right text-xs text-red-600">
                        {err.hours}
                      </p>
                    )}
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {FIELDS.map((f) => (
                        <div key={f.key}>
                          <label htmlFor={`${id}-${f.key}`} className="mb-1 block text-xs font-semibold text-[#4a5880]">
                            {f.label}
                          </label>
                          <textarea
                            id={`${id}-${f.key}`}
                            rows={4}
                            maxLength={TEXT_MAX}
                            value={e[f.key]}
                            placeholder={f.hint}
                            onChange={(ev) => change(i, f.key, ev.target.value)}
                            aria-invalid={!!err[f.key]}
                            className={INPUT(err[f.key])}
                          />
                          {err[f.key] && <p className="mt-1 text-xs text-red-600">{err[f.key]}</p>}
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}

              <section className={CARD} aria-labelledby="r-add">
                <p id="r-add" className="mb-2 text-xs font-semibold text-[#4a5880]">
                  {entries.length ? "Add another project" : "Choose a project you worked on"}
                </p>
                {projects === null ? (
                  <p className="text-sm text-[#676b7a]">Loading your projects…</p>
                ) : projects.length === 0 ? (
                  <p className="text-sm text-[#676b7a]">You are not assigned to any project yet.</p>
                ) : addable.length === 0 ? (
                  <p className="text-sm text-[#676b7a]">All your projects are in this report.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {addable.map((p) => (
                      <button key={p.id} type="button" onClick={() => addProject(p)} className={BTN_SECONDARY}>
                        <Plus size={14} aria-hidden="true" />
                        {p.name}
                        <span className="font-mono text-[11px] font-normal text-[#9aa0ad]">{p.project_code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className={CARD}>
                <label htmlFor="r-notes" className="mb-1 block text-xs font-semibold text-[#4a5880]">
                  Notes / blockers for your manager (optional)
                </label>
                <textarea
                  id="r-notes"
                  rows={3}
                  maxLength={TEXT_MAX}
                  value={notes}
                  onChange={(ev) => {
                    setNotes(ev.target.value);
                    setDirty(true);
                  }}
                  className={INPUT(false)}
                />
              </section>

              <section className={`${CARD} flex flex-col gap-3`}>
                {overAttendance && (
                  <p className="flex items-start gap-2 text-sm text-amber-800">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    You reported {fmtHours(total)}, but your attendance for this day is {formatHours(worked)}.
                  </p>
                )}
                {message.text && (
                  <p
                    role={message.kind === "error" ? "alert" : "status"}
                    className={`rounded-lg px-3 py-2 text-sm ${
                      message.kind === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"
                    }`}
                  >
                    {message.text}
                  </p>
                )}
                {confirmSubmit ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 text-sm text-[#2b303b]">
                      Submit this report to <b>{day.manager?.full_name}</b>? You cannot change it after submitting
                      (unless it is sent back).
                    </span>
                    <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => save(true)}>
                      <Send size={16} aria-hidden="true" />
                      {busy ? "Submitting…" : "Yes, submit"}
                    </button>
                    <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => setConfirmSubmit(false)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 text-sm font-semibold text-[#101a3a]">Total: {fmtHours(total)}</span>
                    <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => save(false)}>
                      {busy ? "Saving…" : "Save draft"}
                    </button>
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      disabled={busy || !day.manager || entries.length === 0}
                      onClick={() => {
                        const v = validateReport(entries, notes, true);
                        setErrors(v);
                        if (v) return setMessage({ kind: "error", text: v.form || "Please fix the highlighted fields." });
                        setMessage({ kind: "", text: "" });
                        setConfirmSubmit(true);
                      }}
                    >
                      <Send size={16} aria-hidden="true" />
                      Submit to {day.manager?.full_name ?? "manager"}
                    </button>
                  </div>
                )}
              </section>
            </>
          )}

          {!editable && message.text && message.kind === "ok" && (
            <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {message.text}
            </p>
          )}
        </>
      )}

      <section className={CARD} aria-labelledby="r-hist">
        <h2 id="r-hist" className="mb-3 text-base font-bold text-[#101a3a]">
          My recent reports
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-[#676b7a]">No reports in the last 60 days.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#eef0f5] text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Projects</th>
                  <th className="py-2 pr-3">Hours</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id} className="border-b border-[#f3f4f8] last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-[#101a3a]">
                      {formatDate(r.report_date)} <span className="text-[#9aa0ad]">{dayName(r.report_date, "short")}</span>
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">{r.projects}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{fmtHours(r.total_hours)}</td>
                    <td className="py-2.5 pr-3">
                      <ReportStatusChip status={r.status} />
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          chooseDate(r.report_date);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="text-xs font-semibold text-[#1f4693] hover:underline"
                      >
                        {r.report_date === date ? "Open" : "View"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
