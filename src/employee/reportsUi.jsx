// Shared pieces for the Daily Work Report pages (employee + manager).
import { CheckCircle2, FolderKanban, StickyNote, Undo2 } from "lucide-react";
import { REPORT_STATUS } from "@/lib/api/employee/reports";
import { Badge, Detail } from "@/components/portal/PortalUI";
import { CARD } from "@/components/portal/portalStyles";
import { formatDate, formatHours } from "./attendanceFormat";

export { BTN_PRIMARY, BTN_SECONDARY, INPUT } from "@/components/portal/portalStyles";

/** 7.5 -> "7.5 h" */
export const fmtHours = (h) => `${Number(h ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })} h`;

/** Badge tone per report status. */
const STATUS_TONE = { draft: "slate", submitted: "sky", reviewed: "green", returned: "amber" };

export function ReportStatusChip({ status }) {
  const s = REPORT_STATUS[status];
  if (!s) return null;
  const tone = STATUS_TONE[status];
  if (!tone) return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.chip}`}>{s.label}</span>;
  return (
    <Badge tone={tone} dot>
      {s.label}
    </Badge>
  );
}

/** Manager's comment, shown on returned / reviewed reports. */
export function ReviewNote({ report, forEmployee = false }) {
  if (!report || !["returned", "reviewed"].includes(report.status)) return null;
  const returned = report.status === "returned";
  if (!returned && !report.review_comment) return null;
  const Icon = returned ? Undo2 : CheckCircle2;
  return (
    <div
      role={returned ? "alert" : undefined}
      className={`flex gap-3 rounded-2xl border px-4 py-3.5 text-sm ${
        returned ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${returned ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="font-semibold">
          {returned ? "Sent back for changes" : "Reviewed"}
          {report.reviewed_by?.full_name ? ` by ${report.reviewed_by.full_name}` : ""}
        </p>
        {report.review_comment && <p className="mt-1 whitespace-pre-line break-words">{report.review_comment}</p>}
        {returned && forEmployee && <p className="mt-1 text-xs">Make the changes below and submit again.</p>}
      </div>
    </div>
  );
}

function Block({ label, text }) {
  return (
    <div className="rounded-xl bg-[#f8fafd] px-3.5 py-3 ring-1 ring-inset ring-[#eef1f7]">
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-[#9aa0ad]">{label}</p>
      <p className="mt-1 whitespace-pre-line break-words text-sm text-[#101a3a]">{text || <span className="text-[#b0b8cc]">—</span>}</p>
    </div>
  );
}

/** Read-only report: one card per project + notes. */
export function ReportView({ report }) {
  return (
    <div className="flex flex-col gap-4">
      {report.items.map((it) => (
        <section key={it.project_id} className={CARD}>
          <div className="flex flex-wrap items-center gap-2 border-b border-[#eef0f4] px-5 py-3.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e]/20 to-[#f96706]/10 text-[#d9650a] ring-1 ring-inset ring-[#f7941e]/25">
              <FolderKanban className="h-4 w-4" aria-hidden="true" />
            </span>
            <h3 className="text-sm font-bold text-[#101a3a]">{it.project_name}</h3>
            <span className="rounded bg-[#f1f4fa] px-1.5 py-0.5 font-mono text-[11px] text-[#676b7a]">{it.project_code}</span>
            <span className="flex-1" />
            <Badge tone="navy">{fmtHours(it.hours)}</Badge>
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-3">
            <Block label="Task updates" text={it.task_updates} />
            <Block label="Completed work" text={it.completed_work} />
            <Block label="Pending work" text={it.pending_work} />
          </div>
        </section>
      ))}
      {report.notes && (
        <section className={`${CARD} flex gap-3 p-5`}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e]/20 to-[#f96706]/10 text-[#d9650a] ring-1 ring-inset ring-[#f7941e]/25">
            <StickyNote className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <Block label="Notes / blockers" text={report.notes} />
          </div>
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
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((x) => (
        <Detail key={x.label} label={x.label}>
          {x.value}
        </Detail>
      ))}
    </dl>
  );
}
