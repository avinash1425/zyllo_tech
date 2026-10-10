import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import SeoAuditManager from "../seo/SeoAuditManager";
import { fetchSeoAudit } from "@/lib/api/admin/seo";

export default function AdminSeoPage() {
  const { data, loading, error, reload } = useAdminData(fetchSeoAudit);
  if (error && !data) return <p className="py-24 text-center text-sm text-red-600">Could not load data: {error.message}</p>;
  if (loading || !data) return <AdminLoading />;
  return <SeoAuditManager audit={data} onReload={reload} />;
}
