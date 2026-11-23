import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import { ArrowLeft, CheckCircle2, Undo2 } from "lucide-react";
import { getTeamReport, getTeamReports, reviewReport } from "@/lib/api/employee/reports";
import { dayName, formatDate } from "../attendanceFormat";
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
import { ReportTabs } from "./DailyReportPage";

const FILTERS = [
  { key: "submitted", label: "Waiting for review" },
  { key: "all", label: "All (last 60 days)" },
];

/** /employee/reports/team — reports from the people who report to me. */
export function TeamReportsPage() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("submitted");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    getTeamReports()
      .then(setData)
      .catch(() => setLoadError("Could not load team reports. Please refresh the page."));
  }, []);

  if (loadError) return <p role="alert" className="text-sm text-red-700">{loadError}</p>;
  if (!data) return <p className="text-sm text-[#676b7a]">Loading…</p>;

  const waiting = data.reports.filter((r) => r.status === "submitted").length;
  const rows = filter === "all" ? data.reports : data.reports.filter((r) => r.status === "submitted");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <ReportTabs active="team" hasTeam waiting={waiting} />

      <section className={CARD}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-[#101a3a]">Team reports</h2>
          <span className="text-xs text-[#9aa0ad]">
            {data.team.length} {data.team.length === 1 ? "person reports" : "people report"} to you
          </span>
          <span className="flex-1" />
          <div className="flex gap-1.5" role="radiogroup" aria-label="Show">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                  filter === f.key
                    ? "border-[#1f4693] bg-[#1f4693] text-white"
                    : "border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]"
                }`}
              >
                {f.label}
                {f.key === "submitted" && waiting > 0 ? ` (${waiting})` : ""}
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-[#676b7a]">
            {filter === "submitted" ? "Nothing waiting for your review." : "No reports in the last 60 days."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#eef0f5] text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">
                  <th className="py-2 pr-3">Employee</th>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Projects</th>
                  <th className="py-2 pr-3">Hours</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-[#f3f4f8] last:border-0">
                    <td className="py-2.5 pr-3">
                      <span className="font-medium text-[#101a3a]">{r.employee.full_name}</span>{" "}
                      <span className="font-mono text-[11px] text-[#9aa0ad]">{r.employee.employee_code}</span>
                    </td>
                    <td className="py-2.5 pr-3">
                      {formatDate(r.report_date)} <span className="text-[#9aa0ad]">{dayName(r.report_date, "short")}</span>
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">{r.projects}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{fmtHours(r.total_hours)}</td>
                    <td className="py-2.5 pr-3">
                      <ReportStatusChip status={r.status} />
                    </td>
                    <td className="py-2.5 text-right">
                      <Link href={`/employee/reports/team/${r.id}`} className="text-xs font-semibold text-[#1f4693] hover:underline">
                        {r.status === "submitted" ? "Review" : "View"}
                      </Link>
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

/** /employee/reports/team/:reportId — read one report, mark reviewed or send back. */
export function TeamReportDetailPage() {
  const { reportId } = useParams();
  const [report, setReport] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ kind: "", text: "" });

  useEffect(() => {
    let active = true;
    getTeamReport(reportId)
      .then((r) => active && setReport(r))
      .catch(() => active && setLoadError("This report could not be found."));
    return () => {
      active = false;
    };
  }, [reportId]);

  async function act(action) {
    if (action === "returned" && !comment.trim()) {
      setMessage({ kind: "error", text: "Write a comment saying what needs to change." });
      return;
    }
    setBusy(true);
    setMessage({ kind: "", text: "" });
    const res = await reviewReport(reportId, action, comment);
    setBusy(false);
    if (!res.ok) return setMessage({ kind: "error", text: res.message });
    setReport(res.report);
    setComment("");
    setMessage({
      kind: "ok",
      text: action === "reviewed" ? "Marked as reviewed." : `Sent back to ${res.report.employee.full_name} for changes.`,
    });
  }

  const back = (
    <Link href="/employee/reports/team" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] hover:underline">
      <ArrowLeft size={16} aria-hidden="true" /> Team reports
    </Link>
  );

  if (loadError)
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        {back}
        <p role="alert" className="text-sm text-red-700">{loadError}</p>
      </div>
    );
  if (!report) return <p className="text-sm text-[#676b7a]">Loading…</p>;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      {back}
      <section className={CARD}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-[#101a3a]">
            {report.employee.full_name} · {dayName(report.report_date)}, {formatDate(report.report_date)}
          </h2>
          <ReportStatusChip status={report.status} />
        </div>
        <ReportFacts report={report} workedMinutes={report.worked_minutes} showEmployee />
      </section>

      <ReviewNote report={report} />
      <ReportView report={report} />

      {message.text && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-lg px-3 py-2 text-sm ${message.kind === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}
        >
          {message.text}
        </p>
      )}

      {report.status === "submitted" && (
        <section className={`${CARD} flex flex-col gap-3`} aria-labelledby="rv-title">
          <h3 id="rv-title" className="text-sm font-bold text-[#101a3a]">
            Your review
          </h3>
          <div>
            <label htmlFor="rv-comment" className="mb-1 block text-xs font-semibold text-[#4a5880]">
              Comment (needed when sending back)
            </label>
            <textarea
              id="rv-comment"
              rows={3}
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className={INPUT(false)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => act("reviewed")}>
              <CheckCircle2 size={16} aria-hidden="true" />
              {busy ? "Saving…" : "Mark as reviewed"}
            </button>
            <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => act("returned")}>
              <Undo2 size={16} aria-hidden="true" />
              Send back for changes
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
