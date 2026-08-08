import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Static list of every admin section — mirrors NAV_ITEMS in
// admin/layout.js. Lets someone type "careers" or "blog" and jump
// straight to that section, the same way the public search matches page
// names, rather than only matching content stored inside those sections.
// Keywords cover common synonyms so "jobs" or "applicants" still finds
// Careers even though the nav label itself is just "Careers".
const ADMIN_SECTIONS = [
  {
    title: "Dashboard",
    subtitle: "Overview, traffic, and recent activity",
    keywords: "dashboard home overview stats analytics traffic",
    href: "/admin",
  },
  {
    title: "Contact Submissions",
    subtitle: "Messages from the public contact form",
    keywords: "contact submissions messages inquiries leads",
    href: "/admin/contacts",
  },
  {
    title: "Blog Posts",
    subtitle: "Manage published posts and drafts",
    keywords: "blog posts articles content writing",
    href: "/admin/blog",
  },
  {
    title: "Careers",
    subtitle: "Job postings and applicants",
    keywords: "careers jobs job postings openings applicants hiring recruitment",
    href: "/admin/careers",
  },
  {
    title: "Portfolio",
    subtitle: "Featured projects and case studies",
    keywords: "portfolio projects work case studies",
    href: "/admin/portfolio",
  },
];

function normalize(value) {
  return (value || "").toString().toLowerCase();
}

function matchesSection(section, needle) {
  return [section.title, section.subtitle, section.keywords]
    .map(normalize)
    .join(" ")
    .includes(needle);
}

// Global admin search across every section backed by real data: job
// postings, applicants, blog posts, portfolio projects, and contact form
// submissions — plus the admin sections themselves (see ADMIN_SECTIONS
// above). Unlike the public /api/search route, this one is not scoped to
// "published"/"open" only — an admin needs to find drafts and closed
// items too, since that's exactly the content they're managing.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") || "").trim();

  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const needle = query.toLowerCase();
  const sectionResults = ADMIN_SECTIONS.filter((section) => matchesSection(section, needle)).map(
    (section) => ({
      type: "Section",
      title: section.title,
      subtitle: section.subtitle,
      href: section.href,
    })
  );

  const supabase = createServerSupabaseClient();
  const like = `%${query}%`;

  // Promise.allSettled, not Promise.all — a thrown error on any single
  // table (e.g. a bad embedded-join relationship) must not blank out
  // results from the other four, which is exactly what happened with
  // Promise.all: one query throwing discards every result, not just its
  // own, and the outer try/catch in AdminSearch.js then swallows it
  // silently, making the whole search look broken with no visible error.
  const [jobsRes, applicantsRes, blogRes, portfolioRes, contactsRes] = await Promise.allSettled([
    supabase
      .from("job_postings")
      .select("id, title, department, location, status")
      .or(`title.ilike.${like},department.ilike.${like},location.ilike.${like}`)
      .limit(5),
    supabase
      .from("job_applications")
      .select("id, full_name, email, job_id, status, job_postings(title)")
      .or(`full_name.ilike.${like},email.ilike.${like}`)
      .limit(5),
    supabase
      .from("blog_posts")
      .select("id, title, category, status")
      .or(`title.ilike.${like},category.ilike.${like}`)
      .limit(5),
    supabase
      .from("portfolio_projects")
      .select("id, title, tag, status")
      .or(`title.ilike.${like},tag.ilike.${like}`)
      .limit(5),
    supabase
      .from("contact_submissions")
      .select("id, full_name, email, company, service, status")
      .or(`full_name.ilike.${like},email.ilike.${like},company.ilike.${like},service.ilike.${like}`)
      .limit(5),
  ]).then((settled) =>
    settled.map((s) => {
      if (s.status === "fulfilled") return s.value;
      console.error("Admin search: one table query threw:", s.reason?.message || s.reason);
      return { data: null, error: s.reason };
    })
  );

  const results = [...sectionResults];

  for (const job of jobsRes.data ?? []) {
    results.push({
      type: "Job Posting",
      title: job.title,
      subtitle: [job.department, job.location].filter(Boolean).join(" · "),
      href: `/admin/careers/${job.id}`,
    });
  }

  for (const applicant of applicantsRes.data ?? []) {
    results.push({
      type: "Applicant",
      title: applicant.full_name,
      subtitle: `${applicant.email}${applicant.job_postings?.title ? ` · ${applicant.job_postings.title}` : ""}`,
      href: `/admin/careers/${applicant.job_id}`,
    });
  }

  for (const post of blogRes.data ?? []) {
    results.push({
      type: "Blog Post",
      title: post.title,
      subtitle: [post.category, post.status === "draft" ? "Draft" : "Published"]
        .filter(Boolean)
        .join(" · "),
      href: `/admin/blog`,
    });
  }

  for (const project of portfolioRes.data ?? []) {
    results.push({
      type: "Portfolio Project",
      title: project.title,
      subtitle: [project.tag, project.status === "draft" ? "Draft" : "Published"]
        .filter(Boolean)
        .join(" · "),
      href: `/admin/portfolio`,
    });
  }

  for (const contact of contactsRes.data ?? []) {
    results.push({
      type: "Contact Submission",
      title: contact.full_name,
      subtitle: [contact.company, contact.email].filter(Boolean).join(" · "),
      href: `/admin/contacts`,
    });
  }

  return NextResponse.json({ results });
}
