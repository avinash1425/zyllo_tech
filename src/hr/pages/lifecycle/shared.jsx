// Shared pieces for the Onboarding & Employee Exit module (HR + portal).
import { NavLink } from "react-router-dom";
import { Check } from "lucide-react";
import { formatDate, formatDateTime, fullName } from "@/lib/hr/client";

export const cx = (...c) => c.filter(Boolean).join(" ");
export const label = (s) => String(s ?? "").replace(/_/g, " ");
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export const empText = (e) => (e ? `${fullName(e)}${e.employee_code ? ` (${e.employee_code})` : ""}` : "—");
export const isOverdue = (due, status) => Boolean(due && due < today() && !["completed", "waived", "decided", "cancelled", "not_applicable"].includes(status));

export const RESIGNATION_STATUS_LABEL = { submitted: "Submitted", under_review: "Under review", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn" };

/** Section navigation inside the module (links, so every section has its own URL). */
export function SubNav({ items }) {
  return (
    <nav aria-label="Onboarding and exit sections" className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end}
          className={({ isActive }) => cx("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition",
            isActive ? "bg-gradient-to-r from-[#f7941e] to-[#f96706] text-white" : "text-slate-600 hover:bg-slate-100")}>
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Progress({ done, total, tone = "orange" }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex min-w-[7rem] items-center gap-2" title={`${done} of ${total} done`}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
        <div className={cx("h-full rounded-full", tone === "green" ? "bg-emerald-500" : "bg-gradient-to-r from-[#f7941e] to-[#f96706]")} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums text-slate-600">{done}/{total}</span>
    </div>
  );
}

/**
 * Employee lifecycle timeline: joining → onboarding → probation →
 * confirmation → resignation → clearance → settlement → exit.
 * `steps`: [{ key, label, date?, state: "done"|"current"|"upcoming"|"skipped", note? }]
 */
export function LifecycleTimeline({ steps, title = "Employee lifecycle" }) {
  return (
    <ol aria-label={title} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-0">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-start gap-2 sm:flex-1 sm:flex-col sm:items-center sm:text-center" aria-current={s.state === "current" ? "step" : undefined}>
          <div className="flex items-center sm:w-full">
            <span className={cx("hidden h-0.5 flex-1 sm:block", i === 0 ? "invisible" : s.state === "upcoming" ? "bg-slate-200" : "bg-emerald-300")} aria-hidden="true" />
            <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-2",
              s.state === "done" ? "bg-emerald-500 text-white ring-emerald-500"
                : s.state === "current" ? "bg-[#f96706] text-white ring-[#f96706]"
                : s.state === "skipped" ? "bg-slate-100 text-slate-400 ring-slate-200" : "bg-white text-slate-400 ring-slate-200")}>
              {s.state === "done" ? <Check className="h-4 w-4" aria-hidden="true" /> : s.state === "skipped" ? "–" : i + 1}
            </span>
            <span className={cx("hidden h-0.5 flex-1 sm:block", i === steps.length - 1 ? "invisible" : steps[i + 1]?.state === "upcoming" ? "bg-slate-200" : "bg-emerald-300")} aria-hidden="true" />
          </div>
          <div className="min-w-0 sm:mt-1 sm:px-1">
            <p className={cx("text-xs font-semibold", s.state === "current" ? "text-[#c24f05]" : s.state === "done" ? "text-emerald-700" : "text-slate-500")}>
              {s.label}<span className="sr-only">{s.state === "done" ? " — done" : s.state === "current" ? " — current" : ""}</span>
            </p>
            {s.date && <p className="text-[11px] text-slate-500">{formatDate(s.date)}</p>}
            {s.note && <p className="text-[11px] text-slate-500">{s.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Build lifecycle steps from an employee record (+ optional onboarding case / exit). */
export function lifecycleSteps({ employee, onboarding, exit, settlement }) {
  const st = employee?.status;
  const exited = st === "exited" || exit?.status === "closed";
  const inExit = exit && !["withdrawn", "rejected"].includes(exit.status);
  const confirmed = Boolean(employee?.confirmation_date) || (st === "active" && !employee?.probation_end_date) || (inExit && st !== "probation");
  const steps = [
    { key: "join", label: "Joining", date: onboarding?.actual_joining_date ?? employee?.joining_date,
      state: onboarding ? (onboarding.joining_status === "joined" ? "done" : "current") : employee?.joining_date ? "done" : "upcoming" },
    { key: "onboarding", label: "Onboarding", date: onboarding?.completed_at,
      state: !onboarding ? (st === "onboarding" ? "current" : "skipped") : onboarding.status === "completed" ? "done" : onboarding.status === "cancelled" ? "skipped" : onboarding.joining_status === "joined" ? "current" : "upcoming" },
    { key: "probation", label: "Probation", date: employee?.probation_end_date, note: employee?.probation_end_date ? "ends" : undefined,
      state: !employee?.probation_end_date ? "skipped" : st === "probation" ? "current" : confirmed || inExit || exited ? "done" : "upcoming" },
    { key: "confirmed", label: "Confirmed", date: employee?.confirmation_date, state: confirmed ? "done" : "upcoming" },
  ];
  if (inExit || exited) {
    const order = ["submitted", "manager_review", "hr_review", "notice_period", "clearance", "final_settlement", "closed"];
    const idx = order.indexOf(exit?.status ?? "closed");
    steps.push(
      { key: "resignation", label: exit?.exit_type === "resignation" ? "Resignation" : "Exit initiated", date: exit?.resignation_date, state: idx >= 3 ? "done" : "current" },
      { key: "clearance", label: "Clearance", state: idx > 4 ? "done" : idx === 4 ? "current" : "upcoming" },
      { key: "settlement", label: "Final settlement", date: settlement?.paid_on, state: ["approved", "paid"].includes(settlement?.status) || idx > 5 ? "done" : idx === 5 ? "current" : "upcoming" },
      { key: "exit", label: "Exit", date: exit?.approved_last_working_day, state: exited ? "done" : "upcoming" },
    );
  }
  return steps;
}

export function EventList({ events, empty = "No history yet." }) {
  if (!events?.length) return <p className="text-sm text-slate-600">{empty}</p>;
  return (
    <ol className="relative flex flex-col gap-3 border-l-2 border-slate-100 pl-4">
      {events.map((ev) => (
        <li key={ev.id} className="relative text-sm">
          <span className="absolute -left-[21px] mt-1.5 h-2 w-2 rounded-full bg-[#f96706]" aria-hidden="true" />
          <p className="font-semibold capitalize text-[#101a3a]">{label(ev.event_type)}</p>
          <p className="text-xs text-slate-500">{formatDateTime(ev.created_at)}</p>
          {ev.note && <p className="mt-0.5 whitespace-pre-line text-slate-700">{ev.note}</p>}
        </li>
      ))}
    </ol>
  );
}

export function DueDate({ value, status }) {
  if (!value) return <span className="text-slate-400">—</span>;
  const overdue = isOverdue(value, status);
  return <span className={cx("whitespace-nowrap", overdue && "font-semibold text-rose-700")}>{formatDate(value)}{overdue ? " · overdue" : ""}</span>;
}
