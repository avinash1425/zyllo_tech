// Module 12 — HR Reports & Analytics data layer.
// Every number comes from the server (public.hr_report_analytics / hr_report_page /
// hr_report_export / hr_my_report_summary), computed under the caller's RLS.
// Filters are validated here for UX and again on the server.
import { rpc } from "./client.js";
import { defaultFilters, describeFilters, filtersFromParams, filtersToParams, monthStartIso, todayIso, validateFilters } from "./reportFilters.js";

export const CATEGORIES = [
  { key: "overview", label: "Overview" },
  { key: "headcount", label: "Headcount" },
  { key: "attendance", label: "Attendance", anyOf: ["attendance.view", "attendance.view_team"] },
  { key: "leave", label: "Leave", anyOf: ["leave.view", "leave.view_team", "leave.manage"] },
  { key: "payroll", label: "Payroll", anyOf: ["payroll.view"] },
  { key: "hiring", label: "Hiring", anyOf: ["recruitment.view", "recruitment.manage"] },
  { key: "attrition", label: "Attrition" },
  { key: "performance", label: "Performance", anyOf: ["performance.view", "performance.view_team", "performance.manage"] },
  { key: "templates", label: "All reports" },
];

// Row-level report templates (hr_report) related to each category, shown as
// "Detailed records" under the analytics.
export const RELATED_TEMPLATES = {
  headcount: ["headcount", "new_joiners", "employee_status", "department_distribution", "workforce_by_location"],
  attendance: ["attendance_employee", "attendance_daily", "attendance_regularizations", "late_arrivals", "absence", "attendance_summary"],
  leave: ["leave_balances", "leave_history", "upcoming_leave"],
  payroll: ["payroll_summary"],
  hiring: ["recruitment_pipeline"],
  attrition: ["completed_exits", "exit_summary"],
  performance: ["performance_summary"],
};


export { defaultFilters, describeFilters, filtersFromParams, filtersToParams, monthStartIso, todayIso, validateFilters };

const base = (f) => ({
  p_from: f.from || null, p_to: f.to || null, p_department: f.department || null, p_manager: f.manager || null,
  p_employment_type: f.type || null, p_legal_entity: f.company || null, p_employee: f.employee || null, p_location: f.location || null,
});

export const loadAnalytics = (category, f) => rpc("hr_report_analytics", { p_category: category, ...base(f) });
export const loadReportPage = (report, f, page = 1, pageSize = 50) =>
  rpc("hr_report_page", { p_report: report, ...base(f), p_status: f.status || null, p_offset: (page - 1) * pageSize, p_limit: pageSize });
/** Server-gated, audited export. source: "report" | "analytics". */
export const loadExport = (source, key, format, f) =>
  rpc("hr_report_export", { p_source: source, p_key: key, p_format: format, ...base(f), p_status: source === "report" ? f.status || null : null });
export const loadMySummary = (f) => rpc("hr_my_report_summary", { p_from: f.from || null, p_to: f.to || null });

