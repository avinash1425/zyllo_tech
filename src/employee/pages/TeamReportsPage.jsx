import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import { ArrowLeft, CheckCircle2, ClipboardCheck, Loader2, MessageSquareText, Undo2, Users } from "lucide-react";
import { getTeamReport, getTeamReports, reviewReport } from "@/lib/api/employee/reports";
import { Alert, Avatar, Chips, Empty, Panel } from "@/components/portal/PortalUI";
import { LABEL, TABLE, TABLE_WRAP, TD, TH, TR } from "@/components/portal/portalStyles";
import { dayName, formatDate } from "../attendanceFormat";
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
import { useAccess } from "@/lib/access";

const FILTERS = [
  { key: "submitted", label: "Waiting for review" },
  { key: "all", label: "All (last 60 days)" },
];

function Loading() {
  return (
    <p className="flex items-center gap-2 text-sm text-[#676b7a]">
      <Loader2 className="h-4 w-4 animate-spin text-[#1f4693]" aria-hidden="true" />
      Loading…
    </p>
  );
}

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

  if (loadError) return <Alert kind="err">{loadError}</Alert>;
  if (!data) return <Loading />;

  const waiting = data.reports.filter((r) => r.status === "submitted").length;
  const rows = filter === "all" ? data.reports : data.reports.filter((r) => r.status === "submitted");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <ReportTabs active="team" hasTeam waiting={waiting} />

      <Panel
        icon={Users}
        title="Team reports"
        subtitle={`${data.team.length} ${data.team.length === 1 ? "person reports" : "people report"} to you`}
        action={
          <Chips
            label="Show"
            items={FILTERS.map((f) => ({ ...f, count: f.key === "submitted" && waiting > 0 ? waiting : undefined }))}
            value={filter}
            onChange={setFilter}
          />
        }
        flush
      >
        {rows.length === 0 ? (
          <Empty
            icon={ClipboardCheck}
            message={filter === "submitted" ? "Nothing waiting for your review." : "No reports in the last 60 days."}
          />
        ) : (
          <div className={TABLE_WRAP}>
            <table className={`${TABLE} min-w-[640px]`}>
              <thead>
                <tr>
                  <th className={TH}>Employee</th>
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
                {rows.map((r) => (
                  <tr key={r.id} className={TR}>
                    <td className={TD}>
                      <span className="flex items-center gap-2.5">
                        <Avatar name={r.employee.full_name} size="h-8 w-8 text-xs" />
                        <span className="min-w-0">
                          <span className="block font-semibold text-[#101a3a]">{r.employee.full_name}</span>
                          <span className="font-mono text-[11px] text-[#9aa0ad]">{r.employee.employee_code}</span>
                        </span>
                      </span>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {formatDate(r.report_date)} <span className="text-[#9aa0ad]">{dayName(r.report_date, "short")}</span>
                    </td>
                    <td className={`${TD} tabular-nums`}>{r.projects}</td>
                    <td className={`${TD} font-semibold tabular-nums text-[#101a3a]`}>{fmtHours(r.total_hours)}</td>
                    <td className={TD}>
                      <ReportStatusChip status={r.status} />
                    </td>
                    <td className={`${TD} text-right`}>
                      <Link
                        href={`/employee/reports/team/${r.id}`}
                        className={`inline-flex whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                          r.status === "submitted"
                            ? "bg-gradient-to-r from-[#f7941e] to-[#f96706] text-white shadow-sm hover:opacity-95"
                            : "border border-[#dce6f7] bg-white text-[#1f4693] hover:bg-[#f0f4ff]"
                        }`}
                      >
                        {r.status === "submitted" ? "Review" : "View"}
                      </Link>
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

/** /employee/reports/team/:reportId — read one report, mark reviewed or send back. */
export function TeamReportDetailPage() {
  const { reportId } = useParams();
  const { can } = useAccess();
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
    <Link
      href="/employee/reports/team"
      className="inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-[#1f4693] transition-colors hover:bg-[#eef2fb]"
    >
      <ArrowLeft size={16} aria-hidden="true" /> Team reports
    </Link>
  );

  if (loadError)
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        {back}
        <Alert kind="err">{loadError}</Alert>
      </div>
    );
  if (!report) return <Loading />;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      {back}
      <section className="overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-[0_1px_2px_rgba(16,26,58,0.04),0_8px_24px_-12px_rgba(16,26,58,0.10)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#eef0f4] bg-gradient-to-r from-[#f8faff] to-white px-5 py-4">
          <Avatar name={report.employee.full_name} size="h-10 w-10 text-sm" ring />
          <h2 className="min-w-0 flex-1 text-[15px] font-bold text-[#101a3a]">
            {report.employee.full_name} · {dayName(report.report_date)}, {formatDate(report.report_date)}
          </h2>
          <ReportStatusChip status={report.status} />
        </div>
        <div className="p-5">
          <ReportFacts report={report} workedMinutes={report.worked_minutes} showEmployee />
        </div>
      </section>

      <ReviewNote report={report} />
      <ReportView report={report} />

      <Alert kind={message.kind === "error" ? "err" : "ok"}>{message.text}</Alert>

      {can("team.reports.approve") && report.status === "submitted" && (
        <Panel icon={MessageSquareText} title="Your review" subtitle="Mark as reviewed, or send back with a comment">
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="rv-comment" className={LABEL}>
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
          </div>
        </Panel>
      )}
    </div>
  );
}
