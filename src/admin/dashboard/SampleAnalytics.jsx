import { Eye, MousePointerClick, TrendingUp, Users, Info } from "lucide-react";
import GradientStatCard from "../GradientStatCard";
import TrafficChart from "../TrafficChart";
import SamplePill from "../SamplePill";

/** Clearly-labelled placeholder analytics. None of these figures are real. */
export default function SampleAnalytics({ traffic }) {
  return (
    <section aria-labelledby="sample-analytics-heading" className="rounded-2xl border border-dashed border-[#d9dce3] bg-[#f1f2f6]/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="sample-analytics-heading" className="text-base font-semibold text-[#2b303b]">Sample analytics</h2>
        <SamplePill />
      </div>
      <p role="note" className="mt-2 flex items-start gap-2 rounded-lg bg-white px-3 py-2 text-xs leading-relaxed text-[#4b4f5c] ring-1 ring-[#e7e9ee]">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1f4693]" aria-hidden="true" />
        <span>
          <strong>Sample data.</strong> Visitors, page views, bounce rate and the trend chart below are
          illustrative placeholders, not real traffic. Connect an analytics tool to replace them.
        </span>
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <GradientStatCard icon={Users} label="Total Visitors" value={traffic.visitors} accent="#1f4693" badgeLabel="Last 30 days" delta="+0.3%" note="vs prior period" sample />
        <GradientStatCard icon={Eye} label="Page Views" value={traffic.pageViews} accent="#7c3aed" badgeLabel="Last 30 days" delta="-3.5%" deltaDirection="down" deltaGood={false} note={`vs prior period · ${traffic.pagesPerVisit} pages/visit`} sample />
        <GradientStatCard icon={MousePointerClick} label="Bounce Rate" value={traffic.bounceRate} accent="#f7941e" badgeLabel="Avg Rate" delta="+3.0%" deltaGood={false} note="vs prior period" sample />
        <GradientStatCard icon={TrendingUp} label="Conversion Rate" value={traffic.conversionRate} accent="#3b6d11" badgeLabel="All Time" delta="+101.1%" note={`vs prior period · ${traffic.leadsTotal} leads`} sample />
      </div>
      <div className="mt-4 min-w-0 rounded-2xl border border-[#e7e9ee] bg-white p-5">
        <h3 className="text-sm font-semibold text-[#2b303b]">Website traffic (sample)</h3>
        <p className="mt-0.5 text-xs text-[#676b7a]">Daily visitors and pageviews, last 30 days</p>
        <div className="mt-3">
          <TrafficChart days={30} />
        </div>
      </div>
    </section>
  );
}
