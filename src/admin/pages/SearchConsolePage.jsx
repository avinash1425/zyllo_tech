import { useSearchParams } from "@/lib/nx/navigation";
import { Search } from "lucide-react";
import useAdminData from "../useAdminData";
import AdminLoading from "../AdminLoading";
import PageHeader from "../PageHeader";
import SearchConsoleManager from "../search-console/SearchConsoleManager";
import { getSearchConsolePerformance, saveSiteUrl } from "@/lib/api/admin/searchConsole";

export default function AdminSearchConsolePage() {
  const params = useSearchParams();
  const range = params.get("range") ?? "28d";
  const { data, loading, error, reload } = useAdminData(() => getSearchConsolePerformance(range), [range]);
  if (error && !data) return <p className="py-24 text-center text-sm text-red-600">Could not load data: {error.message}</p>;
  if (loading || !data) return <AdminLoading />;

  if (data.status === "not_connected") {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader icon={Search} title="Google Search Console" subtitle="Not connected" />
        <div className="rounded-2xl border border-[#e7e9ee] bg-white p-6 text-sm text-[#2b303b] shadow-sm">
          <p className="font-semibold">Google Search Console is not connected</p>
          <p className="mt-1 text-[#676b7a]">{data.message}</p>
          <button type="button" onClick={reload} className="mt-4 rounded-full bg-[#1f4693] px-4 py-2 text-xs font-semibold text-white">
            Check again
          </button>
        </div>
      </div>
    );
  }

  if (data.status === "selection_required") {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader icon={Search} title="Google Search Console" subtitle="Choose a property" />
        <div className="rounded-2xl border border-[#e7e9ee] bg-white p-6 text-sm shadow-sm">
          <p className="font-semibold text-[#2b303b]">Several properties cover zyllotech.com. Which one should be used?</p>
          <div className="mt-4 flex flex-col gap-2">
            {data.candidates.map((c) => (
              <button key={c} type="button" onClick={() => { saveSiteUrl(c); reload(); }}
                className="rounded-lg border border-[#e7e9ee] px-4 py-2 text-left hover:border-[#f7941e]">
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return <SearchConsoleManager performance={data} range={range} onReload={reload} />;
}
