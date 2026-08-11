import { createServerSupabaseClient } from "@/lib/supabase/server";
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
} from "lucide-react";
import MiniMetricCard from "./MiniMetricCard";
import GradientStatCard from "./GradientStatCard";
import DashboardRefresh from "./DashboardRefresh";
import TrafficChart from "./TrafficChart";
import LeadDistributionDonut from "./LeadDistributionDonut";
import RecentActivity from "./RecentActivity";
import ApplicantsByJobPanel from "./ApplicantsByJobPanel";
import ScrollToTopButton from "./ScrollToTopButton";

async function getRecentActivity() {
  const supabase = await createServerSupabaseClient();

  const [{ data: submissions, error: submissionsError }, { data: applicants, error: applicantsError }] =
    await Promise.all([
      supabase
        .from("contact_submissions")
        .select("id, full_name, service, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("job_applications")
        .select("id, full_name, created_at, job_postings(title)")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  if (submissionsError) {
    console.error("Failed to load recent contact submissions:", submissionsError.message);
  }
  if (applicantsError) {
    console.error("Failed to load recent applicants:", applicantsError.message);
  }

  const items = [
    ...(submissions ?? []).map((s) => ({
      type: "contact",
      id: s.id,
      name: s.full_name,
      subtitle: s.service || "General inquiry",
      createdAt: s.created_at,
    })),
    ...(applicants ?? []).map((a) => ({
      type: "applicant",
      id: a.id,
      name: a.full_name,
      subtitle: a.job_postings?.title ?? "a job posting",
      createdAt: a.created_at,
    })),
  ];

  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return items.slice(0, 10);
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function getWeeklyActivityCounts() {
  const supabase = await createServerSupabaseClient();

  const since = new Date();
  since.setDate(since.getDate() - 6);
  since.setHours(0, 0, 0, 0);

  const [{ data: submissions, error: submissionsError }, { data: applicants, error: applicantsError }] =
    await Promise.all([
      supabase
        .from("contact_submissions")
        .select("created_at")
        .gte("created_at", since.toISOString()),
      supabase
        .from("job_applications")
        .select("created_at")
        .gte("created_at", since.toISOString()),
    ]);

  if (submissionsError) {
    console.error("Failed to load weekly contact counts:", submissionsError.message);
  }
  if (applicantsError) {
    console.error("Failed to load weekly applicant counts:", applicantsError.message);
  }

  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push({
      key: date.toDateString(),
      label: DAY_NAMES[date.getDay()],
      contacts: 0,
      applicants: 0,
    });
  }

  const byKey = Object.fromEntries(days.map((d) => [d.key, d]));

  for (const row of submissions ?? []) {
    const key = new Date(row.created_at).toDateString();
    if (byKey[key]) byKey[key].contacts += 1;
  }
  for (const row of applicants ?? []) {
    const key = new Date(row.created_at).toDateString();
    if (byKey[key]) byKey[key].applicants += 1;
  }

  return days.map(({ label, contacts, applicants: applicantCount }) => ({
    day: label,
    contacts,
    applicants: applicantCount,
  }));
}

async function getTotalCounts() {
  const supabase = await createServerSupabaseClient();

  const [
    { count: contactsTotal },
    { count: applicantsTotal },
    { count: selectedTotal },
    { count: applicationViewsTotal, error: viewsError },
    { data: jobRows, error: jobsError },
  ] = await Promise.all([
    supabase.from("contact_submissions").select("id", { count: "exact", head: true }),
    supabase.from("job_applications").select("id", { count: "exact", head: true }),
    supabase
      .from("job_applications")
      .select("id", { count: "exact", head: true })
      .eq("status", "hired"),
    supabase.from("job_application_views").select("id", { count: "exact", head: true }),
    // Pulling full rows (not just a count) because "Total Openings" is a
    // sum of each posting's total_openings headcount field, not a row
    // count — same math as CareersManager.js's totalPositions/
    // totalOpenings, kept in sync with that page rather than a separate
    // definition. Includes closed postings too, matching that page.
    supabase.from("job_postings").select("id, status, total_openings"),
  ]);

  if (viewsError) {
    // Most likely cause: the 006_job_application_views.sql migration
    // hasn't been run yet in this Supabase project. Don't let that break
    // the whole dashboard — just fall back to 0 views, which makes the
    // completion-rate card show "—" instead of crashing the page.
    console.error("Failed to load application view count:", viewsError.message);
  }
  if (jobsError) {
    console.error("Failed to load job postings for totals:", jobsError.message);
  }

  const jobs = jobRows ?? [];
  const totalPositions = jobs.length;
  const openPositions = jobs.filter((j) => j.status === "open").length;
  const totalOpenings = jobs.reduce((sum, j) => sum + (j.total_openings ?? 0), 0);

  return {
    contactsTotal: contactsTotal ?? 0,
    applicantsTotal: applicantsTotal ?? 0,
    selectedTotal: selectedTotal ?? 0,
    applicationViewsTotal: applicationViewsTotal ?? 0,
    totalPositions,
    openPositions,
    totalOpenings,
  };
}

// Applicant count per job posting, ranked highest-first, for the dashboard's
// "Applicants by Job" panel. Mirrors the join pattern used in
// admin/careers/page.js (job_postings + a status-annotated job_applications
// pass) but only needs the total count per job, not per-status breakdowns.
async function getApplicantsByJob() {
  const supabase = await createServerSupabaseClient();

  const [{ data: jobs, error: jobsError }, { data: applications, error: appsError }] =
    await Promise.all([
      supabase
        .from("job_postings")
        .select("id, title, status")
        .order("created_at", { ascending: false }),
      supabase.from("job_applications").select("job_id"),
    ]);

  if (jobsError) {
    console.error("Failed to load job postings:", jobsError.message);
    return [];
  }
  if (appsError) {
    console.error("Failed to load job applications:", appsError.message);
  }

  const countByJobId = {};
  for (const app of applications ?? []) {
    countByJobId[app.job_id] = (countByJobId[app.job_id] ?? 0) + 1;
  }

  return (jobs ?? [])
    .map((job) => ({
      id: job.id,
      title: job.title,
      status: job.status,
      applicants: countByJobId[job.id] ?? 0,
    }))
    .sort((a, b) => b.applicants - a.applicants);
}

// Placeholder traffic numbers — no page-view tracking or session/bounce
// detection exists yet, so Total Visitors/Page Views/Bounce Rate/Conversion
// Rate below are illustrative only (clearly labeled as sample data in the
// UI), same convention TrafficChart already uses for its own chart data.
// leadsTotal is the one real number woven in: contactsTotal + applicantsTotal
// from getTotalCounts(), shown as supporting context under Conversion Rate.
function getTrafficSummary(leadsTotal) {
  const visitors = 14636;
  const pageViews = Math.round(visitors * 2.56);
  const bounceRate = 56.5;
  const conversionRate = visitors > 0 ? (leadsTotal / visitors) * 100 : 0;

  return {
    visitors: visitors >= 1000 ? `${(visitors / 1000).toFixed(1)}K` : `${visitors}`,
    pageViews: pageViews >= 1000 ? `${(pageViews / 1000).toFixed(1)}K` : `${pageViews}`,
    pagesPerVisit: (pageViews / visitors).toFixed(2),
    bounceRate: `${bounceRate.toFixed(1)}%`,
    conversionRate: `${conversionRate.toFixed(1)}%`,
    leadsTotal,
  };
}

export default async function AdminOverviewPage() {
  const [activity, weeklyCounts, totals, applicantsByJob] = await Promise.all([
    getRecentActivity(),
    getWeeklyActivityCounts(),
    getTotalCounts(),
    getApplicantsByJob(),
  ]);

  const traffic = getTrafficSummary(totals.contactsTotal + totals.applicantsTotal);
  const contactsThisWeek = weeklyCounts.reduce((sum, d) => sum + d.contacts, 0);
  const applicantsThisWeek = weeklyCounts.reduce((sum, d) => sum + d.applicants, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="relative overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white p-6 shadow-sm">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-16 right-0 h-40 w-40 rounded-full bg-[#f7941e]/8 blur-[90px]" />
          <div className="absolute -bottom-16 left-1/3 h-40 w-40 rounded-full bg-[#1f4693]/8 blur-[90px]" />
        </div>
        <div className="relative">
          <h1 className="text-2xl font-bold tracking-tight text-[#2b303b]">Dashboard</h1>
          <p className="mt-1 text-sm text-[#676b7a]">
            Welcome back — here&apos;s what&apos;s happening across the site.
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <DashboardRefresh />
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
        />
        <GradientStatCard
          icon={TrendingUp}
          label="Conversion Rate"
          value={traffic.conversionRate}
          accent="#3b6d11"
          badgeLabel="All Time"
          delta="+101.1%"
          note={`vs prior period · ${traffic.leadsTotal} leads`}
        />
      </div>
      <p className="-mt-2 text-[10px] leading-relaxed text-[#676b7a]/70">
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
        <div className="rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#f7941e]" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-[#2b303b]">Website Traffic</h2>
          </div>
          <p className="mt-0.5 text-xs text-[#676b7a]">Daily visitors and pageviews (Last 30 days)</p>
          <div className="mt-3">
            <TrafficChart days={30} />
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-[#676b7a]/70">
            Sample data — connect an analytics tool to show real traffic here.
          </p>
        </div>

        <div className="rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-sm">
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
