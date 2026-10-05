import {
  Eye,
  Users,
  MessageSquare,
  Briefcase,
  UserCheck,
  ClipboardCheck,
  DoorOpen,
  CheckCircle2,
  MousePointerClick,
  TrendingUp,
  Activity,
  BarChart3,
  ArrowRight,
} from "lucide-react";
import Link from "@/lib/nx/link";
import MiniMetricCard from "../MiniMetricCard";
import GradientStatCard from "../GradientStatCard";
import DashboardRefresh from "../DashboardRefresh";
import TrafficChart from "../TrafficChart";
import LeadDistributionDonut from "../LeadDistributionDonut";
import RecentActivity from "../RecentActivity";
import ApplicantsByJobPanel from "../ApplicantsByJobPanel";
import SamplePill from "../SamplePill";
import ScrollToTopButton from "../ScrollToTopButton";
import AdminLoading from "../AdminLoading";
import useAdminData from "../useAdminData";
import { fetchDashboardData, getTrafficSummary } from "@/lib/api/admin/dashboard";

export default function AdminOverviewPage() {
  const { data, loading, reload } = useAdminData(fetchDashboardData);
  if (loading || !data) return <AdminLoading />;

  const { activity, weeklyCounts, totals, applicantsByJob } = data;
  const traffic = getTrafficSummary(totals.contactsTotal + totals.applicantsTotal);
  const contactsThisWeek = weeklyCounts.reduce((sum, d) => sum + d.contacts, 0);
  const applicantsThisWeek = weeklyCounts.reduce((sum, d) => sum + d.applicants, 0);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const todayLabel = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  // Only figures already present in the loaded dashboard data; nothing is invented.
  const attention = [
    {
      value: contactsThisWeek,
      label: "contact submissions this week",
      href: "/admin/contacts",
      accent: "#db7d17",
    },
    {
      value: applicantsThisWeek,
      label: "job applications this week",
      href: "/admin/job-applications",
      accent: "#1f4693",
    },
    {
      value: totals.openPositions,
      label: "open positions",
      href: "/admin/careers",
      accent: "#3b6d11",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="relative overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm sm:p-6">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-16 right-0 h-40 w-40 rounded-full bg-[#f7941e]/8 blur-[90px]" />
          <div className="absolute -bottom-16 left-1/3 h-40 w-40 rounded-full bg-[#1f4693]/8 blur-[90px]" />
        </div>
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#676b7a]">
              {todayLabel}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#2b303b]">
              {greeting}, welcome back
            </h1>
            <p className="mt-1 text-sm text-[#676b7a]">
              Here&apos;s what&apos;s happening across the site.
            </p>
          </div>
          <DashboardRefresh onRefresh={reload} />
        </div>

        <div className="relative mt-5 border-t border-[#e7e9ee] pt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#676b7a]">
            Needs attention
          </p>
          <ul className="mt-2.5 flex flex-wrap gap-2">
            {attention.map((chip) => (
              <li key={chip.label}>
                <Link
                  href={chip.href}
                  className="group inline-flex items-center gap-2 rounded-full border border-[#e7e9ee] bg-white py-1.5 pl-3 pr-2.5 text-sm text-[#2b303b] shadow-sm transition-all duration-200 hover:border-[#1f4693]/30 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693] motion-reduce:transition-none"
                >
                  <span className="font-bold tabular-nums" style={{ color: chip.accent }}>
                    {chip.value}
                  </span>
                  <span className="text-[#4b4f5c]">{chip.label}</span>
                  <ArrowRight
                    className="h-3.5 w-3.5 text-[#676b7a] transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <GradientStatCard
          icon={Users}
          label="Total Visitors"
          value={traffic.visitors}
          accent="#1f4693"
          badgeLabel="Last 30 days"
          delta="+0.3%"
          note="vs prior period"
          sample
        />
        <GradientStatCard
          icon={Eye}
          label="Page Views"
          value={traffic.pageViews}
          accent="#7c3aed"
          badgeLabel="Last 30 days"
          delta="-3.5%"
          deltaDirection="down"
          deltaGood={false}
          note={`vs prior period · ${traffic.pagesPerVisit} pages/visit`}
          sample
        />
        <GradientStatCard
          icon={MousePointerClick}
          label="Bounce Rate"
          value={traffic.bounceRate}
          accent="#f7941e"
          badgeLabel="Avg Rate"
          delta="+3.0%"
          deltaGood={false}
          note="vs prior period"
          sample
        />
        <GradientStatCard
          icon={TrendingUp}
          label="Conversion Rate"
          value={traffic.conversionRate}
          accent="#3b6d11"
          badgeLabel="All Time"
          delta="+101.1%"
          note={`vs prior period · ${traffic.leadsTotal} leads`}
          sample
        />
      </div>
      <p className="-mt-2 text-xs leading-relaxed text-[#676b7a]">
        Traffic metrics above are sample data — connect an analytics tool for real numbers. Lead
        counts are real.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MiniMetricCard
          icon={Briefcase}
          label="Total Positions"
          value={totals.totalPositions}
          accent="#1f4693"
          progress={Math.min(100, (totals.totalPositions / 15) * 100)}
        />
        <MiniMetricCard
          icon={CheckCircle2}
          label="Open"
          value={totals.openPositions}
          accent="#3b6d11"
          progress={
            totals.totalPositions > 0
              ? Math.min(100, (totals.openPositions / totals.totalPositions) * 100)
              : 0
          }
        />
        <MiniMetricCard
          icon={DoorOpen}
          label="Total Openings"
          value={totals.totalOpenings}
          accent="#f7941e"
          progress={Math.min(100, (totals.totalOpenings / 60) * 100)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MiniMetricCard
          icon={MessageSquare}
          label="Contact Forms"
          value={totals.contactsTotal}
          weekDelta={contactsThisWeek}
          accent="#f7941e"
          progress={Math.min(100, (totals.contactsTotal / 120) * 100)}
        />
        <MiniMetricCard
          icon={Briefcase}
          label="Job Applications"
          value={totals.applicantsTotal}
          weekDelta={applicantsThisWeek}
          accent="#3b6d11"
          progress={Math.min(100, (totals.applicantsTotal / 400) * 100)}
        />
        <MiniMetricCard
          icon={UserCheck}
          label="Selected Candidates"
          value={totals.selectedTotal}
          accent="#1f4693"
          progress={
            totals.applicantsTotal > 0
              ? Math.min(100, (totals.selectedTotal / totals.applicantsTotal) * 100)
              : 0
          }
        />
        <MiniMetricCard
          icon={ClipboardCheck}
          label="Application Completion"
          value={
            totals.applicationViewsTotal > 0
              ? `${Math.round((totals.applicantsTotal / totals.applicationViewsTotal) * 100)}%`
              : "—"
          }
          accent="#db7d17"
          progress={
            totals.applicationViewsTotal > 0
              ? Math.min(100, (totals.applicantsTotal / totals.applicationViewsTotal) * 100)
              : 0
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Activity className="h-4 w-4 text-[#f7941e]" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-[#2b303b]">Website Traffic</h2>
            <SamplePill />
          </div>
          <p className="mt-0.5 text-xs text-[#676b7a]">Daily visitors and pageviews (Last 30 days)</p>
          <div className="mt-3">
            <TrafficChart days={30} />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[#676b7a]">
            Sample data — connect an analytics tool to show real traffic here.
          </p>
        </div>

        <div className="min-w-0 rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[#f7941e]" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-[#2b303b]">Lead Distribution</h2>
          </div>
          <p className="mt-0.5 text-xs text-[#676b7a]">Breakdown by submission type</p>
          <div className="mt-3">
            <LeadDistributionDonut
              contactsTotal={totals.contactsTotal}
              applicantsTotal={totals.applicantsTotal}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <RecentActivity items={activity} weeklyCounts={weeklyCounts} />
        <ApplicantsByJobPanel jobs={applicantsByJob} />
      </div>

      <ScrollToTopButton />
    </div>
  );
}
