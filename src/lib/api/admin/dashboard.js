import { supabase } from "@/lib/supabase/client";

export async function getRecentActivity() {

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

export async function getWeeklyActivityCounts() {

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

export async function getTotalCounts() {

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
export async function getApplicantsByJob() {

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
export function getTrafficSummary(leadsTotal) {
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

export async function fetchDashboardData() {
  const [activity, weeklyCounts, totals, applicantsByJob] = await Promise.all([
    getRecentActivity(),
    getWeeklyActivityCounts(),
    getTotalCounts(),
    getApplicantsByJob(),
  ]);
  return { activity, weeklyCounts, totals, applicantsByJob };
}
