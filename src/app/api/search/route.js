import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SERVICES } from "@/data/services";

// Public site-wide search. Combines a static index of every top-level
// public page + all services (fast, no DB round trip) with live matches
// from Supabase for content that changes without a redeploy: published
// blog posts and open job postings. Mirrors the query pattern used by
// /api/admin/search/route.js, but scoped to public/published rows only —
// this endpoint has no auth check, so nothing unpublished can leak here.

const STATIC_PAGES = [
  {
    title: "Home",
    subtitle: "Zyllo Tech — software development company",
    keywords: "home zyllo tech software development company overview",
    href: "/",
  },
  {
    title: "About Us",
    subtitle: "Our story, mission, values, and team",
    keywords: "about us story mission vision values team technologies who we are",
    href: "/about",
  },
  {
    title: "Services",
    subtitle: "Everything Zyllo Tech builds",
    keywords: "services what we do offerings",
    href: "/services",
  },
  {
    title: "Industries",
    subtitle: "Sectors we build software for",
    keywords: "industries sectors startups healthcare finance retail logistics",
    href: "/industries",
  },
  {
    title: "Portfolio",
    subtitle: "Featured projects and case studies",
    keywords: "portfolio work projects case studies featured technologies",
    href: "/portfolio",
  },
  {
    title: "Blog",
    subtitle: "Engineering, design, and product notes",
    keywords: "blog articles posts writing notes ideas lessons",
    href: "/blog",
  },
  {
    title: "Careers",
    subtitle: "Open roles and life at Zyllo Tech",
    keywords: "careers jobs hiring open positions apply work with us",
    href: "/careers",
  },
  {
    title: "Contact",
    subtitle: "Get in touch or start a project",
    keywords: "contact us reach out email start project talk",
    href: "/contact",
  },
];

function normalize(value) {
  return (value || "").toString().toLowerCase();
}

function matchesQuery(haystackParts, needle) {
  const haystack = haystackParts.map(normalize).join(" ");
  return haystack.includes(needle);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") || "").trim();

  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const needle = query.toLowerCase();
  const results = [];

  for (const page of STATIC_PAGES) {
    if (matchesQuery([page.title, page.subtitle, page.keywords], needle)) {
      results.push({
        type: "Page",
        title: page.title,
        subtitle: page.subtitle,
        href: page.href,
      });
    }
  }

  for (const service of SERVICES) {
    if (
      matchesQuery(
        [service.title, service.tagline, service.description, ...(service.subServices || [])],
        needle
      )
    ) {
      results.push({
        type: "Service",
        title: service.title,
        subtitle: service.tagline,
        href: `/services/${service.slug}`,
      });
    }
  }

  const supabase = createServerSupabaseClient();
  const like = `%${query}%`;

  const [blogRes, jobsRes] = await Promise.all([
    supabase
      .from("blog_posts")
      .select("title, slug, category, excerpt")
      .eq("status", "published")
      .or(`title.ilike.${like},category.ilike.${like},excerpt.ilike.${like}`)
      .limit(5),
    supabase
      .from("job_postings")
      .select("id, title, department, location")
      .eq("status", "open")
      .or(`title.ilike.${like},department.ilike.${like},location.ilike.${like}`)
      .limit(5),
  ]);

  for (const post of blogRes.data ?? []) {
    results.push({
      type: "Blog Post",
      title: post.title,
      subtitle: post.category || post.excerpt,
      href: `/blog/${post.slug}`,
    });
  }

  for (const job of jobsRes.data ?? []) {
    results.push({
      type: "Open Role",
      title: job.title,
      subtitle: [job.department, job.location].filter(Boolean).join(" · "),
      href: `/careers/${job.id}`,
    });
  }

  return NextResponse.json({ results: results.slice(0, 20) });
}
