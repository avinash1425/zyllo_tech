// Employee Portal (/employee/*). Self-service pages over the same Supabase
// data as HR Operations; RLS limits every query to the employee's own records.
// Pages are registered only when functional.
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import {
  BarChart3, Bell, BookOpen, CalendarCheck, ClipboardCheck, DoorOpen, UserCheck, ClipboardList, Clock, FileText, HeartHandshake, KanbanSquare, LayoutDashboard, Package, User, Wallet,
} from "lucide-react";
import Seo from "@/hr/platform/Seo";
import AppShell from "@/hr/AppShell";
import { Loading, ToastProvider } from "@/hr/ui";
import { RequireEmployee } from "@/lib/hr/guards";
import { useAuth } from "@/hr/platform/auth";

export const EMPLOYEE_PAGES = [
  { path: "", label: "My Dashboard", icon: LayoutDashboard, section: "Me", page: lazy(() => import("./pages/EmployeeDashboardPage.jsx")), end: true },
  { path: "profile", label: "My Profile", icon: User, section: "Me", page: lazy(() => import("./pages/MyProfilePage.jsx")) },
  { path: "onboarding", label: "My Onboarding", icon: ClipboardCheck, section: "Me", page: lazy(() => import("./pages/MyOnboardingPage.jsx")) },
  { path: "attendance", label: "My Attendance", icon: Clock, section: "Work", page: lazy(() => import("./pages/MyAttendancePage.jsx")) },
  { path: "daily-reports", label: "My Daily Reports", icon: ClipboardList, section: "Work", page: lazy(() => import("./pages/MyDailyReportsPage.jsx")) },
  { path: "tasks", label: "My Tasks & Projects", icon: KanbanSquare, section: "Work", page: lazy(() => import("./pages/MyTasksPage.jsx")) },
  { path: "leave", label: "My Leave", icon: CalendarCheck, section: "Work", page: lazy(() => import("./pages/MyLeavePage.jsx")) },
  { path: "payslips", label: "My Payslips", icon: Wallet, section: "Records", page: lazy(() => import("./pages/MyPayslipsPage.jsx")) },
  { path: "documents", label: "My Documents", icon: FileText, section: "Records", page: lazy(() => import("./pages/MyDocumentsPage.jsx")) },
  { path: "assets", label: "My Assets", icon: Package, section: "Records", page: lazy(() => import("./pages/MyAssetsPage.jsx")) },
  { path: "internship", label: "My Internship", icon: GraduationCap, section: "Records", page: lazy(() => import("./pages/MyInternshipPage.jsx")), when: (hr) => hr?.employee?.employment_type === "intern" },
  { path: "interviews", label: "My Interviews", icon: UserCheck, section: "Work", page: lazy(() => import("./pages/MyInterviewsPage.jsx")) },
  { path: "resignation", label: "My Resignation", icon: DoorOpen, section: "Records", page: lazy(() => import("./pages/MyResignationPage.jsx")) },
  { path: "reports", label: "My Reports", icon: BarChart3, section: "Records", page: lazy(() => import("./pages/MyReportsPage.jsx")) },
  { path: "requests", label: "My HR Requests", icon: HeartHandshake, section: "Company", page: lazy(() => import("./pages/MyHrRequestsPage.jsx")) },
  { path: "notifications", label: "Notifications", icon: Bell, section: "Company", page: lazy(() => import("./pages/NotificationsPage.jsx")) },
];
const SECTIONS = ["Me", "Work", "Records", "Company"];

const HR_ENTRY = ["dashboard.view", "dashboard.view_team", "employees.view", "employees.view_team", "settings.view", "payroll.view", "recruitment.view", "reports.view", "reports.view_team"];

export default function EmployeeApp() {
  const { hasPermission, hr } = useAuth();
  // `when` hides pages that only apply to some employees (e.g. interns); the route still exists.
  const pages = EMPLOYEE_PAGES.filter((p) => p.page);
  const navPages = pages.filter((p) => !p.when || p.when(hr));
  const sections = SECTIONS.map((label) => ({
    label, items: navPages.filter((p) => p.section === label).map((p) => ({ to: `/employee${p.path ? `/${p.path}` : ""}`, label: p.label, icon: p.icon, end: p.end })),
  })).filter((s) => s.items.length);
  const first = pages[0];
  return (
    <RequireEmployee>
      <ToastProvider>
        <Seo title="Employee Portal" noindex />
        <AppShell portalName="Employee Portal" sections={sections} notificationsPath="/employee/notifications"
          switchTo={HR_ENTRY.some((p) => hasPermission(p)) ? { href: "/hr", label: "HR Operations" } : undefined}>
          <Suspense fallback={<Loading />}>
            <Routes>
              {pages.map((p) => {
                const Page = p.page;
                return p.path ? <Route key={p.path} path={`${p.path}/*`} element={<Page />} /> : <Route key="index" index element={<Page />} />;
              })}
              {/* Notification links that map to other pages */}
              <Route path="exit" element={<Navigate to="/employee/resignation" replace />} />
              <Route path="team/exits" element={<Navigate to="/hr/exits" replace />} />
              <Route path="*" element={<Navigate to={`/employee${first?.path ? `/${first.path}` : ""}`} replace />} />
            </Routes>
          </Suspense>
        </AppShell>
      </ToastProvider>
    </RequireEmployee>
  );
}
