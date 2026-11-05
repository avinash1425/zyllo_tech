// Module-specific settings tabs plugged into HR Settings. Each entry:
// { key, label, permissions (any → tab visible), manage (any → editable), Component({ canEdit }) }.
// Tabs are shown to holders of their own permissions even without settings.view.
import DocumentCategoriesSettings from "@/hr/settings/DocumentCategoriesSettings";
import RequestCategoriesSettings from "@/hr/settings/RequestCategoriesSettings";
import ReviewCyclesSettings from "@/hr/settings/ReviewCyclesSettings";
import KpiDefinitionsSettings from "@/hr/settings/KpiDefinitionsSettings";
import LeaveTypesSettings from "@/hr/settings/LeaveTypesSettings";
import HolidaysSettings from "@/hr/settings/HolidaysSettings";
import SalaryComponentsSettings from "@/hr/settings/SalaryComponentsSettings";
import ProjectsSettings from "@/hr/settings/ProjectsSettings";
import ModuleRulesSettings from "@/hr/settings/ModuleRulesSettings";
import { lazy } from "react";

// Lazy: these reuse the editors of the Benefits / Training pages.
const BenefitPlansSettings = lazy(() => import("@/hr/settings/BenefitPlansSettings"));
const TrainingCategoriesSettings = lazy(() => import("@/hr/settings/TrainingCategoriesSettings"));

export const SETTINGS_EXTENSIONS = [
  { key: "module_rules", label: "Attendance, report, leave & payroll rules", permissions: ["settings.view", "settings.manage"], manage: ["settings.manage"], Component: ModuleRulesSettings },
  { key: "leave_types", label: "Leave types", permissions: ["leave.view", "leave.manage"], manage: ["leave.manage"], Component: LeaveTypesSettings },
  { key: "holidays", label: "Holidays", permissions: ["leave.view", "leave.manage"], manage: ["leave.manage"], Component: HolidaysSettings },
  { key: "salary_components", label: "Salary components", permissions: ["payroll.view"], manage: ["payroll.manage"], Component: SalaryComponentsSettings },
  { key: "benefit_plans", label: "Benefit plans", permissions: ["benefits.view", "benefits.manage"], manage: ["benefits.manage"], Component: BenefitPlansSettings },
  { key: "training_categories", label: "Training categories", permissions: ["training.view", "training.manage"], manage: ["training.manage"], Component: TrainingCategoriesSettings },
  { key: "projects", label: "Projects", permissions: ["daily_reports.manage", "daily_reports.view"], manage: ["daily_reports.manage"], Component: ProjectsSettings },
  { key: "document_categories", label: "Document categories", permissions: ["settings.view", "settings.manage", "documents.manage"], manage: ["settings.manage", "documents.manage"], Component: DocumentCategoriesSettings },
  { key: "review_cycles", label: "Review cycles", permissions: ["performance.view", "performance.manage"], manage: ["performance.manage"], Component: ReviewCyclesSettings },
  { key: "kpi_definitions", label: "KPI definitions", permissions: ["performance.view", "performance.manage"], manage: ["performance.manage"], Component: KpiDefinitionsSettings },
  { key: "request_categories", label: "HR request categories", permissions: ["settings.view", "settings.manage", "hr_requests.manage"], manage: ["settings.manage", "hr_requests.manage"], Component: RequestCategoriesSettings },
];
