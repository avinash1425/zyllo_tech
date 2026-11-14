import { useMemo } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Lock, DatabaseZap } from "lucide-react";
import { useAuth } from "@/lib/auth";
import AdminLoading from "../AdminLoading";
import EmptyState from "../EmptyState";
import { getMyRole, getSettings } from "@/lib/api/admin/projectTracker";
import { RoleContext } from "./context";
import { ToastProvider, Button } from "./ui";
import useLoad from "./useLoad";
import DashboardPage from "./pages/DashboardPage";
import ProjectsPage from "./pages/ProjectsPage";
import CompaniesPage from "./pages/CompaniesPage";
import CompanyDetailPage from "./pages/CompanyDetailPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import ProjectReportPage from "./pages/ProjectReportPage";
import RegisterPage from "./pages/RegisterPage";
import ReportsPage from "./pages/ReportsPage";
import AccessPage from "./pages/AccessPage";

export default function ProjectTrackerRoutes() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(async () => {
    const role = await getMyRole();
    return { role, settings: role ? await getSettings() : null };
  }, [user?.id ?? null]);
  const role = data?.role;
  const state = { loading, role: error ? null : role, error: error?.message ?? null, kind: error?.kind ?? null };

  const ctx = useMemo(() => ({
    role: state.role,
    canEdit: state.role === "editor" || state.role === "manager",
    isManager: state.role === "manager",
    email: user?.email || null,
    settings: data?.settings || null,
  }), [state.role, user?.email, data?.settings]);

  if (state.loading) return <AdminLoading label="Opening Project Tracker…" />;
  if (state.kind === "not_installed") {
    return (
      <EmptyState bordered icon={DatabaseZap} title="Project Tracker is not installed on this backend yet"
        message="The Project Tracker tables have not been created in this Supabase project. An administrator must apply supabase/project-tracker/001 and 002 (see the README there) after approval. No data has been changed."
        action={<Button onClick={reload}>Check again</Button>} />
    );
  }
  if (state.error) {
    return <EmptyState bordered title="Could not open Project Tracker" message={state.error}
      action={<Button onClick={reload}>Try again</Button>} />;
  }
  if (!state.role) {
    return <EmptyState bordered icon={Lock} title="No access to Project Tracker"
      message="Your admin account has not been given access to Project Tracker. Ask a Project Tracker manager." />;
  }

  return (
    <RoleContext.Provider value={ctx}>
      <ToastProvider>
        <Helmet><title>Project Tracker | Admin | Zyllo Tech</title></Helmet>
        <Routes>
          <Route index element={<DashboardPage />} />
          <Route path="companies" element={<CompaniesPage />} />
          <Route path="companies/:id" element={<CompanyDetailPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="projects/:id/report" element={<ProjectReportPage />} />
          <Route path="hosting" element={<RegisterPage kind="hosting" />} />
          <Route path="emails" element={<RegisterPage kind="emails" />} />
          <Route path="backups" element={<RegisterPage kind="backups" />} />
          <Route path="renewals" element={<RegisterPage kind="renewals" />} />
          <Route path="handover" element={<RegisterPage kind="handover" />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="access" element={<AccessPage />} />
          <Route path="*" element={<Navigate to="/admin/project-tracker" replace />} />
        </Routes>
      </ToastProvider>
    </RoleContext.Provider>
  );
}
