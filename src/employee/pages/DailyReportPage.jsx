import { useEffect, useMemo, useState } from "react";
import Link from "@/lib/nx/link";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CalendarDays, ClipboardList, FolderPlus, History, Loader2, Plus, Send, StickyNote, Trash2, Users } from "lucide-react";
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
import { Alert, Detail, Empty, Panel } from "@/components/portal/PortalUI";
import { CARD, ICON_BTN_DANGER, LABEL, TABLE, TABLE_WRAP, TD, TH, TR } from "@/components/portal/portalStyles";
import { dayName, formatDate, formatHours, todayIst } from "../attendanceFormat";
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

/** Dot colour per report status in the day picker. */
const DAY_DOT = { draft: "bg-slate-400", submitted: "bg-sky-500", reviewed: "bg-emerald-500", returned: "bg-amber-500" };

/** Tabs at the top: My reports / Team reports (team only for managers). */
export function ReportTabs({ active, hasTeam, waiting }) {
  const tab = (on) =>
    `inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-all ${
      on
        ? "bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] text-white shadow-[0_4px_12px_-4px_rgba(31,70,147,0.55)]"
        : "text-[#4a5068] hover:bg-[#f4f7ff] hover:text-[#1f4693]"
    }`;
  return (
    <div className="max-w-full overflow-x-auto">
      <nav aria-label="Reports" className="inline-flex min-w-max gap-1 rounded-xl border border-[#e3e9f5] bg-white p-1 shadow-sm">
        <Link href="/employee/reports" className={tab(active === "mine")} aria-current={active === "mine" ? "page" : undefined}>
          <ClipboardList size={16} aria-hidden="true" /> My reports
        </Link>
        {hasTeam && (
          <Link href="/employee/reports/team" className={tab(active === "team")} aria-current={active === "team" ? "page" : undefined}>
            <Users size={16} aria-hidden="true" /> Team reports
            {waiting > 0 && (
              <span
                className={`min-w-[1.25rem] rounded-full px-1.5 text-center text-[10.5px] font-bold leading-5 ${
                  active === "team" ? "bg-white/25 text-white" : "bg-[#f96706] text-white"
                }`}
              >
                {waiting}
              </span>
            )}
          </Link>
        )}
      </nav>
    </div>
  );
}

export default function DailyReportPage() {
  const today = todayIst().iso;
  const [params] = useSearchParams();
  // ?date=YYYY-MM-DD (links from notifications); otherwise today.
  const [date, setDate] = useState(() => {
    const d = params.get("date");
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today ? d : today;
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
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <ReportTabs active="mine" hasTeam={team.team.length > 0} waiting={waiting} />

      {/* Day picker: buttons, no dropdown */}
      <Panel icon={CalendarDays} title="Report for" subtitle="Choose the day">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose the day">
          {strip.map((iso, i) => {
            const on = iso === date;
            const st = statusByDate.get(iso);
            return (
              <button
                key={iso}
                type="button"
                aria-pressed={on}
                onClick={() => chooseDate(iso)}
                className={`relative flex min-w-[6rem] flex-col items-start rounded-xl border px-3 py-2 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693] ${
                  on
                    ? "border-transparent bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] text-white shadow-[0_6px_14px_-6px_rgba(31,70,147,0.6)]"
                    : "border-[#e3e9f5] bg-[#f8faff] text-[#2b303b] hover:border-[#1f4693]/30 hover:bg-[#eef2fb]"
                }`}
              >
                <span className="flex items-center gap-1.5 text-xs font-bold">
                  {st && <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-white" : DAY_DOT[st] ?? "bg-slate-400"}`} aria-hidden="true" />}
                  {i === 0 ? "Today" : i === 1 ? "Yesterday" : dayName(iso, "short")}
                </span>
                <span className={`text-[11px] ${on ? "text-white/80" : "text-[#9aa0ad]"}`}>
                  {formatDate(iso).replace(/ \d{4}$/, "")}
                  {st ? ` · ${st === "returned" ? "sent back" : st}` : ""}
                </span>
              </button>
            );
          })}
        </div>
        {pendingDate && (
          <div role="alert" className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
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
      </Panel>

      <Alert kind="err">{loadError}</Alert>
      {!day && !loadError && (
        <p className="flex items-center gap-2 text-sm text-[#676b7a]">
          <Loader2 className="h-4 w-4 animate-spin text-[#1f4693]" aria-hidden="true" />
          Loading…
        </p>
      )}

      {day && (
        <>
          <Panel
            icon={ClipboardList}
            title={`Daily work report · ${dayName(date)}, ${formatDate(date)}`}
            action={report ? <ReportStatusChip status={report.status} /> : <span className="text-xs font-semibold text-[#9aa0ad]">Not started</span>}
          >
            {report && !editable ? (
              <ReportFacts report={report} workedMinutes={worked} />
            ) : (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Detail label="Reporting manager">{day.manager ? day.manager.full_name : <span className="text-[#676b7a]">Not set</span>}</Detail>
                <Detail label="Attendance that day">{worked == null ? "No punch" : formatHours(worked)}</Detail>
                <Detail label="Hours in this report">{fmtHours(total)}</Detail>
                <Detail label="Projects">{entries.length}</Detail>
              </dl>
            )}
            {editable && !day.manager?.id && (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-[#dce6f7] bg-[#f5f8ff] px-4 py-2.5 text-sm text-[#1f4693]">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                {day.manager
                  ? `Your reporting manager (${day.manager.full_name}) is not in the portal, so your report goes to the admin for review.`
                  : "No reporting manager is set for you, so your report goes to the admin for review."}
              </p>
            )}
          </Panel>

          <ReviewNote report={report} forEmployee />

          {report && !editable && <ReportView report={report} />}
          {!report && !day.date_allowed && (
            <div className={CARD}>
              <Empty icon={ClipboardList} message="No report was written for this day." />
            </div>
          )}

          {editable && (
            <>
              {entries.map((e, i) => {
                const err = errors?.items?.[i] ?? {};
                const id = `r-${e.project_id}`;
                return (
                  <section key={e.project_id} className={CARD} aria-label={`Entry for ${e.project_name}`}>
                    <div className="flex flex-wrap items-center gap-2 border-b border-[#eef0f4] px-5 py-3.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eef2fb] text-[11px] font-bold text-[#1f4693]">
                        {i + 1}
                      </span>
                      <h3 className="text-sm font-bold text-[#101a3a]">{e.project_name}</h3>
                      <span className="rounded bg-[#f1f4fa] px-1.5 py-0.5 font-mono text-[11px] text-[#676b7a]">{e.project_code}</span>
                      <span className="flex-1" />
                      <label htmlFor={`${id}-hours`} className="text-[11px] font-bold uppercase tracking-wide text-[#8a90a0]">
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
                        className={`${INPUT(err.hours)} !w-24 !py-2 text-right tabular-nums`}
                      />
                      <button type="button" onClick={() => removeEntry(i)} className={ICON_BTN_DANGER} aria-label={`Remove ${e.project_name}`}>
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </div>
                    <div className="p-5">
                      {err.hours && (
                        <p id={`${id}-hours-e`} className="-mt-2 mb-2 text-right text-xs text-red-600">
                          {err.hours}
                        </p>
                      )}
                      <div className="grid gap-4 md:grid-cols-3">
                        {FIELDS.map((f) => (
                          <div key={f.key}>
                            <label htmlFor={`${id}-${f.key}`} className={LABEL}>
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
                    </div>
                  </section>
                );
              })}

              <section className={`${CARD} border-dashed p-5`} aria-labelledby="r-add">
                <p id="r-add" className="mb-3 flex items-center gap-2 text-sm font-bold text-[#101a3a]">
                  <FolderPlus className="h-4 w-4 text-[#d9650a]" aria-hidden="true" />
                  {entries.length ? "Add another project" : "Choose a project you worked on"}
                </p>
                {projects === null ? (
                  <p className="flex items-center gap-2 text-sm text-[#676b7a]">
                    <Loader2 className="h-4 w-4 animate-spin text-[#1f4693]" aria-hidden="true" />
                    Loading your projects…
                  </p>
                ) : projects.length === 0 ? (
                  <p className="text-sm text-[#676b7a]">You are not assigned to any project yet.</p>
                ) : addable.length === 0 ? (
                  <p className="text-sm text-[#676b7a]">All your projects are in this report.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
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

              <section className={`${CARD} p-5`}>
                <label htmlFor="r-notes" className={`${LABEL} flex items-center gap-1.5`}>
                  <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
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

              <section className={`${CARD} flex flex-col gap-3 bg-gradient-to-r from-white to-[#f8faff] p-5`}>
                {overAttendance && (
                  <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    You reported {fmtHours(total)}, but your attendance for this day is {formatHours(worked)}.
                  </p>
                )}
                <Alert kind={message.kind === "error" ? "err" : "ok"}>{message.text}</Alert>
                {confirmSubmit ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 text-sm text-[#2b303b]">
                      Submit this report to <b>{day.manager?.id ? day.manager.full_name : "the admin"}</b>? You cannot change it after submitting
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
                    <span className="flex-1 text-sm font-semibold text-[#101a3a]">
                      Total: <span className="text-lg font-extrabold tabular-nums text-[#1f4693]">{fmtHours(total)}</span>
                    </span>
                    <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => save(false)}>
                      {busy ? "Saving…" : "Save draft"}
                    </button>
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      disabled={busy || entries.length === 0}
                      onClick={() => {
                        const v = validateReport(entries, notes, true);
                        setErrors(v);
                        if (v) return setMessage({ kind: "error", text: v.form || "Please fix the highlighted fields." });
                        setMessage({ kind: "", text: "" });
                        setConfirmSubmit(true);
                      }}
                    >
                      <Send size={16} aria-hidden="true" />
                      Submit to {day.manager?.id ? day.manager.full_name : "admin"}
                    </button>
                  </div>
                )}
              </section>
            </>
          )}

          {!editable && message.text && message.kind === "ok" && <Alert kind="ok">{message.text}</Alert>}
        </>
      )}

      <Panel icon={History} title="My recent reports" subtitle="Last 60 days" flush>
        {history.length === 0 ? (
          <Empty icon={History} message="No reports in the last 60 days." />
        ) : (
          <div className={TABLE_WRAP}>
            <table className={`${TABLE} min-w-[520px]`}>
              <thead>
                <tr>
                  <th className={TH}>Date</th>
                  <th className={TH}>Projects</th>
                  <th className={TH}>Hours</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id} className={`${TR} ${r.report_date === date ? "!bg-[#eef4ff]" : ""}`}>
                    <td className={`${TD} font-semibold text-[#101a3a]`}>
                      {formatDate(r.report_date)} <span className="font-normal text-[#9aa0ad]">{dayName(r.report_date, "short")}</span>
                    </td>
                    <td className={`${TD} tabular-nums`}>{r.projects}</td>
                    <td className={`${TD} font-semibold tabular-nums text-[#101a3a]`}>{fmtHours(r.total_hours)}</td>
                    <td className={TD}>
                      <ReportStatusChip status={r.status} />
                    </td>
                    <td className={`${TD} text-right`}>
                      <button
                        type="button"
                        onClick={() => {
                          chooseDate(r.report_date);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="rounded-lg border border-[#dce6f7] bg-white px-2.5 py-1 text-xs font-semibold text-[#1f4693] transition-colors hover:bg-[#f0f4ff]"
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
      </Panel>
    </div>
  );
}
