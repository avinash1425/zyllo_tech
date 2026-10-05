import { useSearchParams } from "@/lib/nx/navigation";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import SearchConsoleManager from "../search-console/SearchConsoleManager";
import { getSearchConsolePerformance } from "@/lib/api/admin/searchConsole";

export default function AdminSearchConsolePage() {
  const params = useSearchParams();
  const range = params.get("range") ?? "28d";
  const { data, loading, error, reload } = useAdminData(() => getSearchConsolePerformance(range), [range]);
  if (error && !data) return <p className="py-24 text-center text-sm text-red-600">Could not load data: {error.message}</p>;
  if (loading || !data) return <AdminLoading />;
  return <SearchConsoleManager performance={data} range={range} onReload={reload} />;
}
