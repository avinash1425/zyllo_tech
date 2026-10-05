import {
  MessageSquare,
  Users,
  Briefcase,
  CalendarDays,
  UserPlus,
  UserCheck,
  DoorOpen,
} from "lucide-react";
import HeroBanner from "../dashboard/HeroBanner";
import KpiCard from "../dashboard/KpiCard";
import WeeklyActivityChart from "../dashboard/WeeklyActivityChart";
import LeadDonut from "../dashboard/LeadDonut";
import ActivityTimeline from "../dashboard/ActivityTimeline";
import ApplicantsRanking from "../dashboard/ApplicantsRanking";
import QuickActions from "../dashboard/QuickActions";
import SampleAnalytics from "../dashboard/SampleAnalytics";
import ScrollToTopButton from "../ScrollToTopButton";
import AdminLoading from "../AdminLoading";
import useAdminData from "../useAdminData";
import { fetchDashboardData, getTrafficSummary } from "@/lib/api/admin/dashboard";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default function AdminOverviewPage() {
  const { data, loading, reload } = useAdminData(fetchDashboardData);
  if (loading || !data) return <AdminLoading />;

  const { activity, weeklyCounts, totals, applicantsByJob } = data;
  const traffic = getTrafficSummary(totals.contactsTotal + totals.applicantsTotal);
  const contactsThisWeek = weeklyCounts.reduce((sum, d) => sum + d.contacts, 0);
  const applicantsThisWeek = weeklyCounts.reduce((sum, d) => sum + d.applicants, 0);
  const contactSeries = weeklyCounts.map((d) => d.contacts);
  const applicantSeries = weeklyCounts.map((d) => d.applicants);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const todayLabel = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const summary = `This week: ${plural(contactsThisWeek, "new contact submission", "new contact submissions")} and ${plural(
    applicantsThisWeek,
    "job application",
    "job applications",
  )}, with ${plural(totals.openPositions, "open position", "open positions")} currently live.`;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <HeroBanner greeting={greeting} todayLabel={todayLabel} summary={summary} onRefresh={reload} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard icon={MessageSquare} label="Contact submissions" value={totals.contactsTotal} hint="All time" accent="#f7941e" href="/admin/contacts" />
        <KpiCard icon={Users} label="Job applicants" value={totals.applicantsTotal} hint="All time" accent="#1f4693" href="/admin/job-applications" />
        <KpiCard icon={Briefcase} label="Open positions" value={totals.openPositions} hint={`${totals.totalPositions} total · ${plural(totals.totalOpenings, "opening", "openings")}`} accent="#3b6d11" href="/admin/careers" />
        <KpiCard icon={CalendarDays} label="Contacts this week" value={contactsThisWeek} hint="Last 7 days" series={contactSeries} accent="#d9650a" href="/admin/contacts" />
        <KpiCard icon={UserPlus} label="Applicants this week" value={applicantsThisWeek} hint="Last 7 days" series={applicantSeries} accent="#1f4693" href="/admin/job-applications" />
        <KpiCard icon={UserCheck} label="Hired candidates" value={totals.selectedTotal} hint="Status: hired" accent="#0f8a84" href="/admin/job-applications" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <WeeklyActivityChart weeklyCounts={weeklyCounts} />
        </div>
        <LeadDonut contactsTotal={totals.contactsTotal} applicantsTotal={totals.applicantsTotal} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ActivityTimeline items={activity} />
        <ApplicantsRanking jobs={applicantsByJob} />
      </div>

      <QuickActions />

      <SampleAnalytics traffic={traffic} />

      <ScrollToTopButton />
    </div>
  );
}
