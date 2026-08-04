"use client";

import Link from "next/link";
import {
  Mail,
  Users,
  Eye,
  Briefcase,
  ArrowRight,
  ArrowUpRight,
  MessageSquare,
  FileText,
  UserPlus,
  FolderKanban,
} from "lucide-react";

const STATS = [
  {
    label: "New Contact Leads",
    value: "24",
    change: "+12%",
    trend: "up",
    icon: Mail,
    href: "/admin/contacts",
  },
  {
    label: "Page Views (30d)",
    value: "18.4K",
    change: "+8.3%",
    trend: "up",
    icon: Eye,
    href: "/admin",
  },
  {
    label: "Job Applicants",
    value: "37",
    change: "+5",
    trend: "up",
    icon: Users,
    href: "/admin/careers",
  },
  {
    label: "Open Positions",
    value: "5",
    change: "No change",
    trend: "flat",
    icon: Briefcase,
    href: "/admin/careers",
  },
];

const RECENT_ACTIVITY = [
  {
    icon: MessageSquare,
    text: "New contact submission from Ravi Kumar",
    detail: "Service required: Web Development",
    time: "12 minutes ago",
  },
  {
    icon: UserPlus,
    text: "New applicant for Senior Full-Stack Engineer",
    detail: "Applied via Careers page",
    time: "1 hour ago",
  },
  {
    icon: MessageSquare,
    text: "New contact submission from Priya Sharma",
    detail: "Service required: AI Solutions",
    time: "3 hours ago",
  },
  {
    icon: FileText,
    text: "Blog post \"Scaling Node.js APIs\" published",
    detail: "By the Engineering team",
    time: "Yesterday",
  },
  {
    icon: UserPlus,
    text: "New applicant for Product Designer (UI/UX)",
    detail: "Applied via Careers page",
    time: "Yesterday",
  },
];

const QUICK_LINKS = [
  {
    label: "Contact Submissions",
    description: "View and respond to inbound leads",
    icon: Mail,
    href: "/admin/contacts",
  },
  {
    label: "Blog Posts",
    description: "Write, edit, and publish articles",
    icon: FileText,
    href: "/admin/blog",
  },
  {
    label: "Careers",
    description: "Manage job listings and applicants",
    icon: Briefcase,
    href: "/admin/careers",
  },
  {
    label: "Portfolio",
    description: "Update case studies and projects",
    icon: FolderKanban,
    href: "/admin/portfolio",
  },
];

export default function AdminOverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#2b303b]">Overview</h1>
        <p className="mt-1 text-sm text-[#676b7a]">
          Welcome back — here&apos;s what&apos;s happening across the site.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map(({ label, value, change, trend, icon: Icon, href }) => (
          <Link
            key={label}
            href={href}
            className="group relative overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-transparent hover:shadow-lg hover:shadow-[#f7941e]/10"
          >
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 bg-gradient-to-r from-[#f7941e] to-[#1f4693] transition-transform duration-300 group-hover:scale-x-100"
            />
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/15">
                <Icon className="h-5 w-5 text-[#f7941e]" aria-hidden="true" />
              </div>
              {trend === "up" && (
                <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-[#3b6d11]">
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  {change}
                </span>
              )}
              {trend === "flat" && (
                <span className="text-xs font-medium text-[#676b7a]">{change}</span>
              )}
            </div>
            <p className="mt-4 text-2xl font-bold tracking-tight text-[#2b303b]">{value}</p>
            <p className="mt-1 text-sm text-[#676b7a]">{label}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#2b303b]">Recent activity</h2>
            <span className="text-xs font-medium text-[#676b7a]">Last 24 hours</span>
          </div>

          <ul className="mt-4 flex flex-col">
            {RECENT_ACTIVITY.map((item, index) => {
              const Icon = item.icon;
              return (
                <li
                  key={index}
                  className={`flex items-start gap-3 py-3 ${
                    index !== RECENT_ACTIVITY.length - 1 ? "border-b border-[#e7e9ee]" : ""
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f5f6f8] text-[#676b7a]">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#2b303b]">{item.text}</p>
                    <p className="mt-0.5 text-xs text-[#676b7a]">{item.detail}</p>
                  </div>
                  <span className="shrink-0 text-xs text-[#676b7a]/70">{item.time}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-[#2b303b]">Manage</h2>
          <div className="mt-4 flex flex-col gap-2">
            {QUICK_LINKS.map(({ label, description, icon: Icon, href }) => (
              <Link
                key={label}
                href={href}
                className="group flex items-center gap-3 rounded-xl border border-[#e7e9ee] p-3 transition-all duration-200 hover:border-[#f7941e]/30 hover:bg-[#fafbfc]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/15">
                  <Icon className="h-4.5 w-4.5 text-[#f7941e]" aria-hidden="true" />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-[#2b303b]">{label}</p>
                  <p className="text-xs text-[#676b7a]">{description}</p>
                </div>
                <ArrowRight
                  className="h-4 w-4 shrink-0 text-[#676b7a]/50 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-[#f7941e]"
                  aria-hidden="true"
                />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
