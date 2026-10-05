import DashboardView from "../dashboard/DashboardView";
import ScrollToTopButton from "../ScrollToTopButton";
import AdminLoading from "../AdminLoading";
import useAdminData from "../useAdminData";
import { fetchDashboardData, getTrafficSummary } from "@/lib/api/admin/dashboard";

export default function AdminOverviewPage() {
  const { data, loading, reload } = useAdminData(fetchDashboardData);
  if (loading || !data) return <AdminLoading variant="dashboard" />;

  const traffic = getTrafficSummary(data.totals.contactsTotal + data.totals.applicantsTotal);

  return (
    <>
      <DashboardView data={data} traffic={traffic} onRefresh={reload} />
      <ScrollToTopButton />
    </>
  );
}
