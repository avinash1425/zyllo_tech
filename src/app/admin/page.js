import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Eye, Users, Clock, MessageSquare, Briefcase, UserCheck } from "lucide-react";
import DashboardStatCard from "./DashboardStatCard";
import MiniMetricCard from "./MiniMetricCard";
import DashboardRefresh from "./DashboardRefresh";
import TrafficChart from "./TrafficChart";
import TopPagesPanel from "./TopPagesPanel";
import RecentActivity from "./RecentActivity";
import ApplicantsByJobPanel from "./ApplicantsByJobPanel";

async function getRecentActivity() {
  const supabase = createServerSupabaseClient();

  const [{ data: submissions, error: submissionsError }, { data: applicants, error: applicantsError }] =
    await Promise.all([
      supabase
        .from("contact_submissions")
        .select("id, full_name, service, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("job_applications")
        .select("id, full_name, created_at, job_postings(title)")
        .order("created_at", { ascending: false })
        .limit(5),
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
      text: `New contact submission from ${s.full_name}`,
      detail: s.service ? `Service required: ${s.service}` : "Submitted via contact form",
      createdAt: s.created_at,
    })),
    ...(applicants ?? []).map((a) => ({
      type: "applicant",
      id: a.id,
      text: `New applicant for ${a.job_postings?.title ?? "a job posting"}`,
      detail: "Applied via Careers page",
      createdAt: a.created_at,
    })),
  ];

  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return items.slice(0, 6);
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function getWeeklyActivityCounts() {
  const supabase = createServerSupabaseClient();

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
  const supabase = createServerSupabaseClient();

  const [{ count: contactsTotal }, { count: applicantsTotal }, { count: selectedTotal }] =
    await Promise.all([
      supabase.from("contact_submissions").select("id", { count: "exact", head: true }),
      supabase.from("job_applications").select("id", { count: "exact", head: true }),
      supabase
        .from("job_applications")
        .select("id", { count: "exact", head: true })
        .eq("status", "selected"),
    ]);

  return {
    contactsTotal: contactsTotal ?? 0,
    applicantsTotal: applicantsTotal ?? 0,
    selectedTotal: selectedTotal ?? 0,
  };
}

// Applicant count per job posting, ranked highest-first, for the dashboard's
// "Applicants by Job" panel. Mirrors the join pattern used in
// admin/careers/page.js (job_postings + a status-annotated job_applications
// pass) but only needs the total count per job, not per-status breakdowns.
async function getApplicantsByJob() {
  const supabase = createServerSupabaseClient();

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

// Same placeholder traffic numbers TrafficPanel used to render on its own —
// kept here so the top stat row can pull from a single source. Swap for
// real aggregates once analytics is connected.
function getTrafficSummary() {
  const visitors = 10400;
  const uniqueUsers = 8100;
  const avgSeconds = 154;

  return {
    visitors: visitors >= 1000 ? `${(visitors / 1000).toFixed(1)}K` : `${visitors}`,
    uniqueUsers: uniqueUsers >= 1000 ? `${(uniqueUsers / 1000).toFixed(1)}K` : `${uniqueUsers}`,
    avgSession: `${Math.floor(avgSeconds / 60)}m ${avgSeconds % 60}s`,
  };
}

export default async function AdminOverviewPage() {
  const [activity, weeklyCounts, totals, applicantsByJob] = await Promise.all([
    getRecentActivity(),
    getWeeklyActivityCounts(),
    getTotalCounts(),
    getApplicantsByJob(),
  ]);

  const traffic = getTrafficSummary();
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <DashboardStatCard
          icon={Eye}
          label="Total Visitors"
          value={traffic.visitors}
          accent="#f7941e"
          accentDark="#c96a0f"
          badgeLabel="Last 30 days"
          delta="+1.4%"
          note="vs prior period"
        />
        <DashboardStatCard
          icon={Users}
          label="Unique Users"
          value={traffic.uniqueUsers}
          accent="#1f4693"
          accentDark="#132c5c"
          badgeLabel="Last 30 days"
          delta="+3.0%"
          note="vs prior period"
        />
        <DashboardStatCard
          icon={Clock}
          label="Avg. Session Duration"
          value={traffic.avgSession}
          accent="#5b7fd4"
          accentDark="#1f4693"
          badgeLabel="Avg. Rate"
          delta="+0.8%"
          note="vs prior period"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-sm xl:col-span-1">
          <h2 className="text-sm font-semibold text-[#2b303b]">Website Traffic</h2>
          <p className="mt-0.5 text-xs text-[#676b7a]">Daily visitors and pageviews</p>
          <div className="mt-3">
            <TrafficChart days={30} />
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-[#676b7a]/70">
            Sample data — connect an analytics tool to show real traffic here.
          </p>
        </div>
        <div className="xl:col-span-1">
          <TopPagesPanel />
        </div>
        <div className="xl:col-span-1">
          <RecentActivity items={activity} weeklyCounts={weeklyCounts} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3">
        <ApplicantsByJobPanel jobs={applicantsByJob} />
      </div>
    </div>
  );
}
