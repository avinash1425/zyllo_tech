import Link from "@/lib/nx/link";
import { Eye, ListOrdered, MousePointerClick, Percent, Search } from "lucide-react";
import Card from "./Card";
import GradientStatCard from "../GradientStatCard";
import SearchConsoleTrendChart from "../search-console/SearchConsoleTrendChart";
import useAdminData from "../useAdminData";
import { getSearchConsolePerformance } from "@/lib/api/admin/searchConsole";

const RANGE = "28d";

/** Real Google Search performance (last 28 days) from the Search Console connection. */
export default function SearchPerformance() {
  // Loaded separately from the rest of the dashboard so a slow or
  // disconnected Search Console never blocks the database-backed cards.
  const { data, loading, error } = useAdminData(() => getSearchConsolePerformance(RANGE));

  const action = (
    <Link href={`/admin/search-console?range=${RANGE}`} className="shrink-0 text-xs font-semibold text-[#1f4693] hover:text-[#f96706]">
      Full report
    </Link>
  );

  let subtitle = "Last 28 days";
  let body;
  if (loading) {
    body = <p className="mt-4 text-sm text-[#676b7a]">Loading Google Search data…</p>;
  } else if (error || !data) {
    body = <p className="mt-4 text-sm text-red-600">Could not load Google Search data.</p>;
  } else if (data.status !== "ok") {
    body = (
      <p className="mt-4 text-sm text-[#676b7a]">
        {data.status === "selection_required"
          ? "Choose which Search Console property to use on the Search Console page."
          : data.message || "Google Search Console is not connected."}
      </p>
    );
  } else {
    const { totals } = data;
    subtitle = `${data.startDate} → ${data.endDate}`;
    body = (
      <>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <GradientStatCard icon={MousePointerClick} label="Total clicks" value={totals.clicks.toLocaleString()} accent="#1f4693" />
          <GradientStatCard icon={Eye} label="Total impressions" value={totals.impressions.toLocaleString()} accent="#173a52" />
          <GradientStatCard icon={Percent} label="Average CTR" value={`${totals.ctr.toFixed(1)}%`} accent="#f7941e" />
          <GradientStatCard icon={ListOrdered} label="Average position" value={totals.avgPosition.toFixed(1)} accent="#3089a6" />
        </div>
        <div className="mt-4 min-w-0">
          <SearchConsoleTrendChart data={data.timeSeries} />
        </div>
      </>
    );
  }

  return (
    <Card icon={Search} title="Google Search performance" subtitle={subtitle} action={action}>
      {body}
    </Card>
  );
}
