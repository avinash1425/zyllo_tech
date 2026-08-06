import { createServerSupabaseClient } from "@/lib/supabase/server";
import TrafficPanel from "./TrafficPanel";
import TopPagesPanel from "./TopPagesPanel";
import RecentActivity from "./RecentActivity";

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

export default async function AdminOverviewPage() {
  const [activity, weeklyCounts] = await Promise.all([
    getRecentActivity(),
    getWeeklyActivityCounts(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#2b303b]">Dashboard</h1>
        <p className="mt-1 text-sm text-[#676b7a]">
          Welcome back — here&apos;s what&apos;s happening across the site.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <TrafficPanel />
        </div>
        <div className="xl:col-span-1">
          <TopPagesPanel />
        </div>
        <div className="xl:col-span-1">
          <RecentActivity items={activity} weeklyCounts={weeklyCounts} />
        </div>
      </div>
    </div>
  );
}
