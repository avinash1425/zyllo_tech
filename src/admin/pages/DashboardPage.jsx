import DashboardView from "../dashboard/DashboardView";
import ScrollToTopButton from "../ScrollToTopButton";
import AdminLoading from "../AdminLoading";
import useAdminData from "../useAdminData";
import { fetchDashboardData } from "@/lib/api/admin/dashboard";

export default function AdminOverviewPage() {
  const { data, loading, reload } = useAdminData(fetchDashboardData);
  if (loading || !data) return <AdminLoading variant="dashboard" />;

  return (
    <>
      <DashboardView data={data} onRefresh={reload} />
      <ScrollToTopButton />
    </>
  );
}
