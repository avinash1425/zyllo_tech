// Shared bits for the Payroll module screens.
import { formatDate, fullName } from "@/lib/hr/client";
import { RUN_STEP_LABELS } from "@/lib/hr/payroll";
import { Badge } from "@/hr/ui";

export const label = (s) => String(s ?? "").replace(/_/g, " ");
export const period = (r) => (r ? `${formatDate(r.period_start)} – ${formatDate(r.period_end)}` : "—");
export const EmpCell = ({ e }) => (e
  ? <div className="min-w-[10rem]"><p className="font-semibold text-[#101a3a]">{fullName(e)}</p><p className="font-mono text-xs text-slate-500">{e.employee_code}</p></div>
  : "—");

const PAY_TONE = { pending: "amber", processing: "blue", partially_paid: "orange", paid: "green", failed: "red", reconciled: "violet", not_started: "slate" };
export const PaymentBadge = ({ status }) => <Badge tone={PAY_TONE[status] ?? "slate"}>{label(status || "not_started")}</Badge>;

const RUN_TONE = { draft: "slate", calculated: "blue", reviewed: "amber", approved: "violet", finalized: "orange", paid: "green" };
export const RunBadge = ({ status }) => <Badge tone={RUN_TONE[status] ?? "slate"}>{RUN_STEP_LABELS[status] ?? label(status)}</Badge>;

const STRUCT_TONE = { draft: "slate", pending_approval: "amber", active: "green", rejected: "red", archived: "slate" };
export const StructureBadge = ({ status }) => <Badge tone={STRUCT_TONE[status] ?? "slate"}>{status === "rejected" ? "returned" : label(status)}</Badge>;

/** Map raw database errors to plain language. */
export function friendly(error) {
  if (!error) return error;
  if (/hr_salary_structures_no_overlap|exclusion constraint/i.test(error)) return "This overlaps an approved salary structure. Approving a revision end-dates the previous structure automatically; otherwise adjust the dates.";
  if (/hr_employee_bank_accounts_primary/i.test(error)) return "This employee already has an active primary account. Unset it first.";
  if (/hr_payroll_statutory_enrollments_no_overlap/i.test(error)) return "This employee already has an enrolment for that rule overlapping these dates.";
  if (/You do not have permission/i.test(error)) return "You do not have permission to do that. Payroll users cannot change their own salary, bank details or statutory data.";
  return error;
}

export const SelfNote = () => (
  <p className="text-xs text-slate-500">Server-enforced: nobody can prepare, approve or pay changes to their own compensation. A second authorised person is always required.</p>
);
