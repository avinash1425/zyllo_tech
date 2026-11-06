// Shared helpers for the Employee Portal "My Payroll & Payslips" page.
import { formatDate, from, run, useHrQuery } from "@/lib/hr/client";

export const label = (s) => String(s ?? "").replace(/_/g, " ");
export const period = (s) => `${formatDate(s.period_start)} – ${formatDate(s.period_end)}`;
export const monthOf = (s) => new Date(`${String(s.period_start).slice(0, 7)}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
export const PAY_TONE = { pending: "amber", processing: "blue", partially_paid: "orange", paid: "green", failed: "red", reconciled: "green" };
/** Employees see "reconciled" as "paid": reconciliation is an internal finance step. */
export const payLabel = (status) => label(status === "reconciled" ? "paid" : status);
export const useCompany = () => useHrQuery(() => run(from("hr_settings").select("value").eq("key", "company").maybeSingle()), []);
