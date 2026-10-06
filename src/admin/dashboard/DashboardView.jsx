import { MessageSquare, Users, Briefcase, CalendarDays, UserPlus, UserCheck } from "lucide-react";
import HeroBanner from "./HeroBanner";
import KpiCard from "./KpiCard";
import SolidKpiCard from "./SolidKpiCard";
import WeeklyActivityChart from "./WeeklyActivityChart";
import LeadDonut from "./LeadDonut";
import ActivityTimeline from "./ActivityTimeline";
import ApplicantsRanking from "./ApplicantsRanking";
import QuickActions from "./QuickActions";
import SampleAnalytics from "./SampleAnalytics";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Presentational dashboard layout. All figures come from real loaded data except `traffic`. */
export default function DashboardView({ data, traffic, onRefresh }) {
  const { weeklyCounts, totals, applicantsByJob, activity } = data;
  const contactsThisWeek = weeklyCounts.reduce((s, d) => s + d.contacts, 0);
  const applicantsThisWeek = weeklyCounts.reduce((s, d) => s + d.applicants, 0);
  const contactSeries = weeklyCounts.map((d) => d.contacts);
  const applicantSeries = weeklyCounts.map((d) => d.applicants);
  const today = weeklyCounts[weeklyCounts.length - 1] ?? { contacts: 0, applicants: 0 };

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const todayLabel = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const heroStats = [
    { value: contactsThisWeek, label: "Contacts (7d)" },
    { value: applicantsThisWeek, label: "Applicants (7d)" },
    { value: totals.openPositions, label: "Open roles" },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <HeroBanner greeting={greeting} todayLabel={todayLabel} stats={heroStats} onRefresh={onRefresh} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SolidKpiCard icon={MessageSquare} label="Contact submissions" value={totals.contactsTotal} hint="All time" from="#f7941e" to="#f96706" href="/admin/contacts" chip={`${today.contacts} today`} />
        <SolidKpiCard icon={Users} label="Job applicants" value={totals.applicantsTotal} hint="All time" from="#1f4693" to="#173a52" href="/admin/job-applications" chip={`${today.applicants} today`} />
        <SolidKpiCard icon={Briefcase} label="Open positions" value={totals.openPositions} hint={`${totals.totalPositions} total · ${plural(totals.totalOpenings, "opening", "openings")}`} from="#3089a6" to="#1f6f8b" href="/admin/careers" />
        <SolidKpiCard icon={UserCheck} label="Hired candidates" value={totals.selectedTotal} hint="Status: hired" from="#173a52" to="#3089a6" href="/admin/job-applications" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <KpiCard icon={CalendarDays} label="Contacts this week" value={contactsThisWeek} hint="Last 7 days" series={contactSeries} sparkId="zt-spark-c" from="#f7941e" to="#f96706" accent="#f96706" href="/admin/contacts" />
        <KpiCard icon={UserPlus} label="Applicants this week" value={applicantsThisWeek} hint="Last 7 days" series={applicantSeries} sparkId="zt-spark-a" from="#1f4693" to="#101a3a" accent="#1f4693" href="/admin/job-applications" />
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
    </div>
  );
}
