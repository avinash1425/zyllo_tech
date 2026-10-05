import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import PortfolioManager from "../portfolio/PortfolioManager";
import { fetchProjects } from "@/lib/api/admin/portfolio";

export default function AdminPortfolioPage() {
  const { data, loading, reload } = useAdminData(fetchProjects);
  if (loading || !data) return <AdminLoading />;
  return <PortfolioManager initialProjects={data} onReload={reload} />;
}
