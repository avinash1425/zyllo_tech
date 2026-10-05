import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import CareersManager from "../careers/CareersManager";
import { fetchJobPostingsWithCounts } from "@/lib/api/admin/careers";

export default function AdminCareersPage() {
  const { data, loading, reload } = useAdminData(fetchJobPostingsWithCounts);
  if (loading || !data) return <AdminLoading />;
  return <CareersManager initialPositions={data} onReload={reload} />;
}
