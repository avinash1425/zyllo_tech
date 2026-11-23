// Shared pieces for the Daily Work Report pages (employee + manager).
import { REPORT_STATUS } from "@/lib/api/employee/reports";
import { formatDate, formatHours } from "./attendanceFormat";
import { CARD } from "./projectsUi";

export const BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-60";
export const BTN_PRIMARY = `${BTN} bg-gradient-to-r from-[#f7941e] to-[#1f4693] text-white`;
export const BTN_SECONDARY = `${BTN} border border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]`;
export const INPUT = (err) =>
  `w-full rounded-lg border bg-white px-3 py-2 text-sm text-[#2b303b] outline-none focus:border-[#1f4693] focus:ring-2 focus:ring-[#1f4693]/15 ${
    err ? "border-red-400" : "border-[#dce1ec]"
  }`;

/** 7.5 -> "7.5 h" */
export const fmtHours = (h) => `${Number(h ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })} h`;

export function ReportStatusChip({ status }) {
  const s = REPORT_STATUS[status];
  if (!s) return null;
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.chip}`}>{s.label}</span>;
}

/** Manager's comment, shown on returned / reviewed reports. */
export function ReviewNote({ report, forEmployee = false }) {
  if (!report || !["returned", "reviewed"].includes(report.status)) return null;
  const returned = report.status === "returned";
  if (!returned && !report.review_comment) return null;
  return (
    <div
      role={returned ? "alert" : undefined}
      className={`rounded-xl px-4 py-3 text-sm ${returned ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}
    >
      <p className="font-semibold">
        {returned ? "Sent back for changes" : "Reviewed"}
        {report.reviewed_by?.full_name ? ` by ${report.reviewed_by.full_name}` : ""}
      </p>
      {report.review_comment && <p className="mt-1 whitespace-pre-line">{report.review_comment}</p>}
      {returned && forEmployee && <p className="mt-1 text-xs">Make the changes below and submit again.</p>}
    </div>
  );
}

function Block({ label, text }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">{label}</p>
      <p className="mt-0.5 whitespace-pre-line break-words text-sm text-[#101a3a]">
        {text || <span className="text-[#b0b8cc]">—</span>}
      </p>
    </div>
  );
}

/** Read-only report: one card per project + notes. */
export function ReportView({ report }) {
  return (
    <div className="flex flex-col gap-3">
      {report.items.map((it) => (
        <section key={it.project_id} className={CARD}>
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-bold text-[#101a3a]">{it.project_name}</h3>
            <span className="font-mono text-[11px] text-[#9aa0ad]">{it.project_code}</span>
            <span className="flex-1" />
            <span className="rounded-full bg-[#f0f4ff] px-2.5 py-0.5 text-xs font-bold text-[#1f4693]">{fmtHours(it.hours)}</span>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Block label="Task updates" text={it.task_updates} />
            <Block label="Completed work" text={it.completed_work} />
            <Block label="Pending work" text={it.pending_work} />
          </div>
        </section>
      ))}
      {report.notes && (
        <section className={CARD}>
          <Block label="Notes / blockers" text={report.notes} />
        </section>
      )}
    </div>
  );
}

/** Date, hours and who it went to — the top of a report. */
export function ReportFacts({ report, workedMinutes, showEmployee }) {
  const items = [
    showEmployee && { label: "Employee", value: `${report.employee.full_name} (${report.employee.employee_code})` },
    { label: "Date", value: formatDate(report.report_date) },
    { label: "Hours reported", value: fmtHours(report.total_hours) },
    { label: "Attendance that day", value: workedMinutes == null ? "No punch" : formatHours(workedMinutes) },
    report.submitted_to && { label: "Submitted to", value: report.submitted_to.full_name },
  ].filter(Boolean);
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((x) => (
        <div key={x.label}>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">{x.label}</dt>
          <dd className="mt-0.5 text-sm font-bold text-[#101a3a]">{x.value}</dd>
        </div>
      ))}
    </dl>
  );
}
