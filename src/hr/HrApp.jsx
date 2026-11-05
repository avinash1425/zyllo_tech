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
  Award, BarChart3, CalendarCheck, ClipboardList, Clock, FileText, Gauge, GraduationCap, HeartHandshake, HeartPulse,
  LogOut, Megaphone, Network, Package, School, Settings, UserCheck, UserPlus, Users, Wallet,
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
  // ---- HR Workspace (reference tabs 1–12)
  { path: "", label: "HR Dashboard", icon: Gauge, section: "HR Workspace", permissions: ["dashboard.view", "dashboard.view_team"], page: lazy(() => import("./pages/HrDashboardPage.jsx")), end: true },
  { path: "employees", label: "Employee Management", icon: Users, section: "HR Workspace", permissions: ["employees.view", "employees.view_team"], page: lazy(() => import("./pages/EmployeesPage.jsx")) },
  { path: "recruitment", label: "Recruitment & Hiring", icon: UserPlus, section: "HR Workspace", permissions: ["recruitment.view", "recruitment.manage", "recruitment.convert", "recruitment.export", ...INTERN_PERMS], page: lazy(() => import("./pages/RecruitmentPage.jsx")), exclude: ["/hr/recruitment/interns"] },
  // HRMS module 4 (after Recruitment & Hiring): joining, documents, induction, probation, resignation, clearance, F&F.
  { path: "onboarding-exit", label: "Onboarding & Exit", icon: UserCheck, section: "HR Workspace", permissions: LIFECYCLE_PERMISSIONS, page: lazy(() => import("./pages/lifecycle/OnboardingExitPage.jsx")) },
  { path: "org-structure", label: "Org Structure", icon: Network, section: "HR Workspace", permissions: ["employees.view", "employees.view_team"], page: lazy(() => import("./pages/OrgStructurePage.jsx")) },
  { path: "leave", label: "Leave Management", icon: CalendarCheck, section: "HR Workspace", permissions: ["leave.view", "leave.view_team", "leave.manage"], page: lazy(() => import("./pages/LeavePage.jsx")) },
  { path: "attendance", label: "Attendance & Time", icon: Clock, section: "HR Workspace", permissions: ["attendance.view", "attendance.view_team"], page: lazy(() => import("./pages/AttendancePage.jsx")) },
  { path: "payroll", label: "Payroll", icon: Wallet, section: "HR Workspace", permissions: ["payroll.view", "payroll.manage", "payroll.approve"], page: lazy(() => import("./pages/PayrollPage.jsx")) },
  { path: "benefits", label: "Benefits", icon: HeartPulse, section: "HR Workspace", permissions: ["benefits.view", "benefits.manage"], page: lazy(() => import("./pages/BenefitsPage.jsx")) },
  { path: "documents", label: "Visa & Documents", icon: FileText, section: "HR Workspace", permissions: ["documents.view", "documents.view_team", "documents.manage"], page: lazy(() => import("./pages/DocumentsPage.jsx")) },
  { path: "training", label: "Training", icon: GraduationCap, section: "HR Workspace", permissions: ["training.view", "training.view_team", "training.assign_team", "training.manage"], page: lazy(() => import("./pages/TrainingPage.jsx")) },
  { path: "performance", label: "Performance", icon: Award, section: "HR Workspace", permissions: ["performance.view", "performance.view_team", "performance.review_team", "performance.manage"], page: lazy(() => import("./pages/PerformancePage.jsx")) },
  { path: "reports", label: "HR Reports", icon: BarChart3, section: "HR Workspace", permissions: ["reports.view", "reports.view_team"], page: lazy(() => import("./pages/ReportsPage.jsx")) },
  // ---- Requests (separate sidebar section, as in the reference)
  // Module 10: scoped approvers (payroll / finance / managers) reach the inbox without hr_requests.manage.
  { path: "requests", label: "Requests & Approvals", icon: HeartHandshake, section: "Requests", permissions: ["hr_requests.view", "hr_requests.manage", "hr_requests.payroll", "hr_requests.finance", "hr_requests.approve_team"], page: lazy(() => import("./pages/HrRequestsPage.jsx")) },
  // ---- Zyllo Tech lifecycle & operations modules (kept)
  { path: "daily-reports", label: "Daily Work Reports", icon: ClipboardList, section: "Lifecycle & Operations", permissions: ["daily_reports.view", "daily_reports.view_team", "daily_reports.manage"], page: lazy(() => import("./pages/DailyReportsPage.jsx")) },
  { nav: "/hr/recruitment/interns", label: "Intern Management", icon: School, section: "Lifecycle & Operations", permissions: INTERN_PERMS },
  { path: "announcements", label: "Announcements", icon: Megaphone, section: "Lifecycle & Operations", permissions: ["announcements.manage", "announcements.view_all"], page: lazy(() => import("./pages/AnnouncementsPage.jsx")) },
  { path: "assets", label: "Assets", icon: Package, section: "Lifecycle & Operations", permissions: ["assets.view", "assets.manage"], page: lazy(() => import("./pages/AssetsPage.jsx")) },
  { path: "exits", label: "Exit Management", icon: LogOut, section: "Lifecycle & Operations", permissions: ["exit.view", "exit.view_team", "exit.approve_team", "exit.manage", "exit.clearance_it"], page: lazy(() => import("./pages/ExitsPage.jsx")) },
  // ---- Administration
  { path: "settings", label: "HR Settings", icon: Settings, section: "Administration", permissions: ["settings.view", "settings.manage", "roles.manage", "audit.view", ...SETTINGS_EXTENSIONS.flatMap((x) => x.permissions)], page: lazy(() => import("./pages/SettingsPage.jsx")) },
];

// Friendly / reference-style aliases → existing URLs (old links keep working).
export const HR_ALIASES = [
  ["dashboard", ""], ["employee-master", "employees"], ["employee-management", "employees"], ["org", "org-structure"], ["organization", "org-structure"],
  ["leave-management", "leave"], ["attendance-time", "attendance"], ["visa-documents", "documents"], ["interns", "recruitment/interns"],
  ["hr-reports", "reports"], ["hr-requests", "requests"], ["hr-settings", "settings"], ["exit-management", "exits"],
  ["onboarding", "onboarding-exit/onboarding"], ["probation", "onboarding-exit/probation"], ["final-settlement", "onboarding-exit/settlement"],
];

const ENTRY_PERMISSIONS = [...new Set(HR_MODULES.flatMap((m) => m.permissions))];
const SECTION_ORDER = ["HR Workspace", "Requests", "Lifecycle & Operations", "Administration"];

function navSections(modules) {
  return SECTION_ORDER.map((label) => ({
    label,
    items: modules.filter((m) => m.section === label && (m.page || m.nav)).map((m) => ({
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
