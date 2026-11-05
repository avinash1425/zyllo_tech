// HR Operations app (/hr/*). Modules are registered here only once they are
// functional, so the navigation never shows a link to an unbuilt page.
//
// Navigation (AIMS ERP reference alignment):
//   HR Workspace — the 12 reference modules, in reference order
//   Requests     — HR Requests (employee self-service queue), kept separate
//   Lifecycle & Operations — Zyllo Tech modules kept from the original build
//   Administration — HR Settings (single configuration area)
// Existing URLs are unchanged; friendly aliases redirect to them.
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import {
  BarChart3, CalendarCheck, ClipboardList, Clock, FileText, Gauge, HeartHandshake,
  LogOut, Package, School, Settings, UserCheck, UserPlus, Users, Wallet,
} from "lucide-react";
import Seo from "@/hr/platform/Seo";
import AppShell from "@/hr/AppShell";
import { ToastProvider, Loading } from "@/hr/ui";
import { RequireHrAccess } from "@/lib/hr/guards";
import { useAuth } from "@/hr/platform/auth";
import { SETTINGS_EXTENSIONS } from "@/hr/settingsExtensions";
import { LIFECYCLE_PERMISSIONS } from "@/hr/pages/lifecycle/permissions";

const INTERN_PERMS = ["interns.view", "interns.view_team", "interns.manage"];

// Each module: route path, nav item, permissions that unlock it, lazy page.
// `nav` items without `page` are navigation shortcuts into another module.
export const HR_MODULES = [
  // 1–12: the Zyllo Tech HRMS modules, in build-session order.
  { path: "", label: "HR Dashboard", icon: Gauge, section: "HR Modules", permissions: ["dashboard.view", "dashboard.view_team"], page: lazy(() => import("./pages/HrDashboardPage.jsx")), end: true },
  { path: "employees", label: "Employee Management", icon: Users, section: "HR Modules", permissions: ["employees.view", "employees.view_team"], page: lazy(() => import("./pages/EmployeesPage.jsx")) },
  { path: "recruitment", label: "Recruitment & Hiring", icon: UserPlus, section: "HR Modules", permissions: ["recruitment.view", "recruitment.manage", "recruitment.convert", "recruitment.export", ...INTERN_PERMS], page: lazy(() => import("./pages/RecruitmentPage.jsx")), exclude: ["/hr/recruitment/interns"] },
  { nav: "/hr/recruitment/interns", label: "Interns", icon: School, section: "HR Modules", permissions: INTERN_PERMS },
  { path: "onboarding-exit", label: "Onboarding & Exit", icon: UserCheck, section: "HR Modules", permissions: LIFECYCLE_PERMISSIONS, page: lazy(() => import("./pages/lifecycle/OnboardingExitPage.jsx")) },
  { path: "attendance", label: "Attendance & Time", icon: Clock, section: "HR Modules", permissions: ["attendance.view", "attendance.view_team"], page: lazy(() => import("./pages/AttendancePage.jsx")) },
  { path: "leave", label: "Leave Management", icon: CalendarCheck, section: "HR Modules", permissions: ["leave.view", "leave.view_team", "leave.manage"], page: lazy(() => import("./pages/LeavePage.jsx")) },
  { path: "payroll", label: "Payroll & Salary", icon: Wallet, section: "HR Modules", permissions: ["payroll.view", "payroll.manage", "payroll.approve"], page: lazy(() => import("./pages/PayrollPage.jsx")) },
  { path: "daily-reports", label: "Daily Work Reports", icon: ClipboardList, section: "HR Modules", permissions: ["daily_reports.view", "daily_reports.view_team", "daily_reports.manage"], page: lazy(() => import("./pages/DailyReportsPage.jsx")) },
  { path: "documents", label: "Employee Documents", icon: FileText, section: "HR Modules", permissions: ["documents.view", "documents.view_team", "documents.manage"], page: lazy(() => import("./pages/DocumentsPage.jsx")) },
  // Module 10: scoped approvers (payroll / finance / managers) reach the inbox without hr_requests.manage.
  { path: "requests", label: "Requests & Approvals", icon: HeartHandshake, section: "HR Modules", permissions: ["hr_requests.view", "hr_requests.manage", "hr_requests.payroll", "hr_requests.finance", "hr_requests.approve_team"], page: lazy(() => import("./pages/HrRequestsPage.jsx")) },
  { path: "assets", label: "Asset Allocation", icon: Package, section: "HR Modules", permissions: ["assets.view", "assets.manage"], page: lazy(() => import("./pages/AssetsPage.jsx")) },
  { path: "reports", label: "Reports & Analytics", icon: BarChart3, section: "HR Modules", permissions: ["reports.view", "reports.view_team"], page: lazy(() => import("./pages/ReportsPage.jsx")) },
  // Exit cases (part of Onboarding & Exit): routable from its pages, not a menu item.
  { path: "exits", label: "Exit cases", hidden: true, icon: LogOut, section: "HR Modules", permissions: ["exit.view", "exit.view_team", "exit.approve_team", "exit.manage", "exit.clearance_it"], page: lazy(() => import("./pages/ExitsPage.jsx")) },
  // ---- Administration (configuration used by the modules above)
  { path: "settings", label: "HR Settings", icon: Settings, section: "Administration", permissions: ["settings.view", "settings.manage", "roles.manage", "audit.view", ...SETTINGS_EXTENSIONS.flatMap((x) => x.permissions)], page: lazy(() => import("./pages/SettingsPage.jsx")) },
];

// Friendly / reference-style aliases → existing URLs (old links keep working).
export const HR_ALIASES = [
  ["dashboard", ""], ["employee-master", "employees"], ["employee-management", "employees"],
  ["leave-management", "leave"], ["attendance-time", "attendance"], ["visa-documents", "documents"], ["interns", "recruitment/interns"],
  ["hr-reports", "reports"], ["hr-requests", "requests"], ["hr-settings", "settings"], ["exit-management", "exits"],
  ["onboarding", "onboarding-exit/onboarding"], ["probation", "onboarding-exit/probation"], ["final-settlement", "onboarding-exit/settlement"],
];

const ENTRY_PERMISSIONS = [...new Set(HR_MODULES.flatMap((m) => m.permissions))];
const SECTION_ORDER = ["HR Modules", "Administration"];

function navSections(modules) {
  return SECTION_ORDER.map((label) => ({
    label,
    items: modules.filter((m) => m.section === label && !m.hidden && (m.page || m.nav)).map((m) => ({
      to: m.nav ?? `/hr${m.path ? `/${m.path}` : ""}`, label: m.label, icon: m.icon, permissions: m.permissions, end: m.end, exclude: m.exclude,
    })),
  })).filter((s) => s.items.length);
}

function FirstAllowed() {
  const { hasPermission } = useAuth();
  const m = HR_MODULES.find((x) => x.page && x.permissions.some((p) => hasPermission(p)));
  return <Navigate to={m ? `/hr${m.path ? `/${m.path}` : ""}` : "/"} replace />;
}

function Gate({ module }) {
  const { hasPermission } = useAuth();
  if (!module.permissions.some((p) => hasPermission(p))) return <FirstAllowed />;
  const Page = module.page;
  return <Page />;
}

export default function HrApp() {
  const { hr } = useAuth();
  const modules = HR_MODULES.filter((m) => m.page);
  return (
    <RequireHrAccess anyOf={ENTRY_PERMISSIONS}>
      <ToastProvider>
        <Seo title="HR Operations" noindex />
        <AppShell portalName="HR Operations" sections={navSections(HR_MODULES)} notificationsPath={hr?.employee ? "/employee/notifications" : undefined}
          switchTo={hr?.employee ? { href: "/employee", label: "My Employee Portal" } : undefined}>
          <Suspense fallback={<Loading />}>
            <Routes>
              {modules.map((m) => (
                m.path ? <Route key={m.path} path={`${m.path}/*`} element={<Gate module={m} />} /> : <Route key="index" index element={<Gate module={m} />} />
              ))}
              {HR_ALIASES.map(([from, to]) => <Route key={`alias-${from}`} path={from} element={<Navigate to={`/hr${to ? `/${to}` : ""}`} replace />} />)}
              <Route path="*" element={<FirstAllowed />} />
            </Routes>
          </Suspense>
        </AppShell>
      </ToastProvider>
    </RequireHrAccess>
  );
}
