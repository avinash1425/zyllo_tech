// Module-specific settings tabs plugged into HR Settings. Each entry:
// { key, label, permissions (any → tab visible), manage (any → editable), Component({ canEdit }) }.
// Tabs are shown to holders of their own permissions even without settings.view.
import DocumentCategoriesSettings from "@/hr/settings/DocumentCategoriesSettings";
import RequestCategoriesSettings from "@/hr/settings/RequestCategoriesSettings";
import LeaveTypesSettings from "@/hr/settings/LeaveTypesSettings";
import HolidaysSettings from "@/hr/settings/HolidaysSettings";
import SalaryComponentsSettings from "@/hr/settings/SalaryComponentsSettings";
import ProjectsSettings from "@/hr/settings/ProjectsSettings";
import ModuleRulesSettings from "@/hr/settings/ModuleRulesSettings";


export const SETTINGS_EXTENSIONS = [
  { key: "module_rules", label: "Attendance, report, leave & payroll rules", permissions: ["settings.view", "settings.manage"], manage: ["settings.manage"], Component: ModuleRulesSettings },
  { key: "leave_types", label: "Leave types", permissions: ["leave.view", "leave.manage"], manage: ["leave.manage"], Component: LeaveTypesSettings },
  { key: "holidays", label: "Holidays", permissions: ["leave.view", "leave.manage"], manage: ["leave.manage"], Component: HolidaysSettings },
  { key: "salary_components", label: "Salary components", permissions: ["payroll.view"], manage: ["payroll.manage"], Component: SalaryComponentsSettings },
  { key: "projects", label: "Projects", permissions: ["daily_reports.manage", "daily_reports.view"], manage: ["daily_reports.manage"], Component: ProjectsSettings },
  { key: "document_categories", label: "Document categories", permissions: ["settings.view", "settings.manage", "documents.manage"], manage: ["settings.manage", "documents.manage"], Component: DocumentCategoriesSettings },
  { key: "request_categories", label: "HR request categories", permissions: ["settings.view", "settings.manage", "hr_requests.manage"], manage: ["settings.manage", "hr_requests.manage"], Component: RequestCategoriesSettings },
];
