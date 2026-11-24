import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";
import AdminLoading from "./AdminLoading";
import AdminShell from "./AdminShell";
import DashboardPage from "./pages/DashboardPage";
import BlogPage from "./pages/BlogPage";
import CareersPage from "./pages/CareersPage";
import ApplicantsPage from "./pages/ApplicantsPage";
import ContactsPage from "./pages/ContactsPage";
import JobApplicationsPage from "./pages/JobApplicationsPage";
import PortfolioPage from "./pages/PortfolioPage";
import SearchConsolePage from "./pages/SearchConsolePage";
import SeoPage from "./pages/SeoPage";
import ProjectTrackerDashboardPage from "./pages/ProjectTrackerDashboardPage";
import ProjectTrackerCompaniesPage from "./pages/ProjectTrackerCompaniesPage";
import ProjectTrackerCompanyPage from "./pages/ProjectTrackerCompanyPage";
import ProjectTrackerProjectPage from "./pages/ProjectTrackerProjectPage";
import AccessCompaniesPage from "./pages/AccessCompaniesPage";
import AccessCompanyPage from "./pages/AccessCompanyPage";
import AccessProjectPage from "./pages/AccessProjectPage";
import EmployeePortalDashboardPage from "./pages/EmployeePortalDashboardPage";
import EmployeesPage from "./pages/EmployeesPage";
import EmployeeDetailPage from "./pages/EmployeeDetailPage";
import ProjectManagementPage from "./pages/ProjectManagementPage";
import ProjectManagementDetailPage from "./pages/ProjectManagementDetailPage";
import AttendanceAdminPage from "./pages/AttendanceAdminPage";
import LeaveAdminPage from "./pages/LeaveAdminPage";
import ReportsAdminPage from "./pages/ReportsAdminPage";
import NotificationsAdminPage from "./pages/NotificationsAdminPage";
import AdminNotificationsPage from "./pages/AdminNotificationsPage";
import SettingsUsersPage from "./pages/SettingsUsersPage";
import SettingsRolesPage from "./pages/SettingsRolesPage";
import MyProfilePage from "./pages/MyProfilePage";
import { AccessProvider, useAccess } from "@/lib/access";
import { firstAllowedHref } from "./AdminShell";
import { ShieldOff } from "lucide-react";
import ChangePasswordCard from "@/components/portal/ChangePasswordCard";

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f7fb] p-4 sm:p-8">
      <AdminLoading label="Checking your access…" />
    </div>
  );
}

function NotAuthorised({ onSignOut }) {
  // An Employee Portal account (active or turned off) belongs on /employee.
  const [access, setAccess] = useState(undefined);
  useEffect(() => {
    let active = true;
    supabase.rpc("ep_my_access").then(({ data }) => {
      if (active) setAccess(data ?? null);
    });
    return () => {
      active = false;
    };
  }, []);
  if (access === undefined) return <Spinner />;
  if (access === "active" || access === "disabled") return <Navigate to="/employee" replace />;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#fafbfc] p-6 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-[#2b303b]">Not authorised</h1>
      <p className="max-w-sm text-sm text-[#676b7a]">
        Your account does not have access to the admin area.
      </p>
      <button
        type="button"
        onClick={onSignOut}
        className="rounded-lg bg-gradient-to-r from-[#f7941e] to-[#1f4693] px-4 py-2 text-sm font-semibold text-white"
      >
        Sign out
      </button>
    </div>
  );
}

/** A page the user may open only with permission `perm` (the database checks it again). */
function Gate({ perm, children }) {
  const { loading, can } = useAccess();
  if (loading) return <Spinner />;
  if (can(perm)) return children;
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-inset ring-red-600/15">
        <ShieldOff className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="text-lg font-bold text-[#101a3a]">No access</h1>
      <p className="max-w-sm text-sm text-[#676b7a]">Your role does not include this page. Ask a Super Admin to change your role in Settings → Users &amp; Roles.</p>
    </div>
  );
}

/** Admin-area users signed in with the emailed one-time password must choose their own first (migration 268). */
function MustChangePassword({ children, onSignOut }) {
  const { access, refresh } = useAccess();
  if (!access?.must_change_password) return children;
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f7fb] p-4">
      <div className="w-full max-w-3xl">
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-[#101a3a]">Choose your own password</h1>
        <p className="mb-4 text-sm text-[#676b7a]">You signed in with the one-time password from your email. Set your own password to continue.</p>
        <ChangePasswordCard onChanged={refresh} />
        <button type="button" onClick={onSignOut} className="mt-4 text-sm font-semibold text-[#1f4693] hover:underline">
          Sign out
        </button>
      </div>
    </div>
  );
}

/** /admin: the website dashboard, or the first page the user may open. */
function HomeGate() {
  const { loading, can } = useAccess();
  if (loading) return <Spinner />;
  if (can("dashboard")) return <DashboardPage />;
  const href = firstAllowedHref(can);
  return href && href !== "/admin" ? <Navigate to={href} replace /> : <Gate perm="dashboard" />;
}

export default function AdminRoutes() {
  const { user, loading, signOut } = useAuth();
  const { pathname, search } = useLocation();
  // null = checking, true/false = result of the is_admin() RPC.
  const [isAdmin, setIsAdmin] = useState(null);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) {
      setIsAdmin(null);
      return undefined;
    }
    let active = true;
    setIsAdmin(null);
    supabase.rpc("is_admin").then(({ data, error }) => {
      if (!active) return;
      if (error) console.error("is_admin check failed:", error.message);
      setIsAdmin(!error && data === true);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  if (loading) return <Spinner />;
  if (!user) {
    return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  }
  if (isAdmin === null) return <Spinner />;
  if (!isAdmin) return <NotAuthorised onSignOut={signOut} />;

  return (
    <>
      <Helmet>
        <title>Admin | Zyllo Tech</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <AccessProvider userId={userId}>
      <MustChangePassword onSignOut={signOut}>
      <AdminShell>
        <Routes>
          <Route index element={<HomeGate />} />
          <Route path="blog" element={<Gate perm="website.blog"><BlogPage /></Gate>} />
          <Route path="careers" element={<Gate perm="website.careers"><CareersPage /></Gate>} />
          <Route path="careers/:id" element={<Gate perm="website.job_applications"><ApplicantsPage /></Gate>} />
          <Route path="contacts" element={<Gate perm="website.contacts"><ContactsPage /></Gate>} />
          <Route path="job-applications" element={<Gate perm="website.job_applications"><JobApplicationsPage /></Gate>} />
          <Route path="portfolio" element={<Gate perm="website.portfolio"><PortfolioPage /></Gate>} />
          <Route path="search-console" element={<Gate perm="website.search_console"><SearchConsolePage /></Gate>} />
          <Route path="seo" element={<Gate perm="website.seo"><SeoPage /></Gate>} />
          {/* Index Coverage is hidden for now; old links go to Search Console. The page
              (pages/IndexCoveragePage.jsx) is kept. To bring it back, import it, render it
              here and re-add its "Growth" item in AdminShell.jsx. */}
          <Route path="index-coverage" element={<Navigate to="/admin/search-console" replace />} />
          <Route path="project-tracker" element={<Gate perm="projects.tracker"><ProjectTrackerDashboardPage /></Gate>} />
          <Route path="project-tracker/companies" element={<Gate perm="projects.clients"><ProjectTrackerCompaniesPage /></Gate>} />
          <Route path="project-tracker/companies/:companyId" element={<Gate perm="projects.clients"><ProjectTrackerCompanyPage /></Gate>} />
          <Route path="project-tracker/projects/:projectId" element={<Gate perm="projects.tracker"><ProjectTrackerProjectPage /></Gate>} />
          <Route path="project-tracker/access" element={<Gate perm="projects.logins"><AccessCompaniesPage /></Gate>} />
          <Route path="project-tracker/access/:companyId" element={<Gate perm="projects.logins"><AccessCompanyPage /></Gate>} />
          <Route path="project-tracker/access/:companyId/:projectId" element={<Gate perm="projects.logins"><AccessProjectPage /></Gate>} />
          <Route path="employee-portal" element={<Gate perm="portal.dashboard"><EmployeePortalDashboardPage /></Gate>} />
          <Route path="employees" element={<Gate perm="portal.employees"><EmployeesPage /></Gate>} />
          <Route path="employees/:employeeId" element={<Gate perm="portal.employees"><EmployeeDetailPage /></Gate>} />
          <Route path="project-management" element={<Gate perm="portal.projects"><ProjectManagementPage /></Gate>} />
          <Route path="project-management/:projectId" element={<Gate perm="portal.projects"><ProjectManagementDetailPage /></Gate>} />
          <Route path="attendance" element={<Gate perm="portal.attendance"><AttendanceAdminPage /></Gate>} />
          <Route path="leave" element={<Gate perm="portal.leave"><LeaveAdminPage /></Gate>} />
          <Route path="reports" element={<Gate perm="portal.reports"><ReportsAdminPage /></Gate>} />
          <Route path="notifications" element={<Gate perm="portal.notifications"><NotificationsAdminPage /></Gate>} />
          <Route path="inbox" element={<Gate perm="portal.inbox"><AdminNotificationsPage /></Gate>} />
          <Route path="settings/users" element={<Gate perm="settings.users"><SettingsUsersPage /></Gate>} />
          <Route path="settings/roles" element={<Gate perm="settings.roles"><SettingsRolesPage /></Gate>} />
          <Route path="settings" element={<Navigate to="/admin/settings/users" replace />} />
          <Route path="profile" element={<MyProfilePage />} />
          <Route path="employee-messages" element={<Navigate to="/admin/notifications" replace />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </AdminShell>
      </MustChangePassword>
      </AccessProvider>
    </>
  );
}
