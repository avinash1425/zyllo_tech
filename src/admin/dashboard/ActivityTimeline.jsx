import Link from "@/lib/nx/link";
import { Briefcase, Clock, MessageSquare } from "lucide-react";
import Card from "./Card";
import EmptyState from "../EmptyState";

const META = {
  contact: {
    label: "Contact",
    icon: MessageSquare,
    gradient: "linear-gradient(135deg, #ffb15c, #f96706)",
    badge: "bg-[#f7941e]/15 text-[#a84a00] ring-[#f7941e]/30",
    href: "/admin/contacts",
    verb: "contacted us about",
  },
  applicant: {
    label: "Applicant",
    icon: Briefcase,
    gradient: "linear-gradient(135deg, #3089a6, #1f4693)",
    badge: "bg-[#1f4693]/10 text-[#1f4693] ring-[#1f4693]/25",
    href: "/admin/job-applications",
    verb: "applied for",
  },
};

function timeAgo(iso) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

function initials(name = "") {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "?") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

export default function ActivityTimeline({ items }) {
  return (
    <Card icon={Clock} title="Recent activity" subtitle="Latest events across contacts and applications" className="h-full">
      {items.length === 0 ? (
        <EmptyState icon={Clock} title="Nothing yet" message="New contact submissions and applicants will show up here." className="py-12" />
      ) : (
        <ol className="mt-5 flex flex-col">
          {items.map((item, i) => {
            const m = META[item.type] ?? META.contact;
            const Icon = m.icon;
            return (
              <li key={`${item.type}-${item.id}`} className="relative flex gap-3 pb-5 last:pb-0">
                {i !== items.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-[19px] top-10 w-px bg-gradient-to-b from-[#d9dce3] to-[#eef0f4]" />}
                <span
                  className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-[0_4px_10px_-3px_rgba(16,26,58,0.35)]"
                  style={{ backgroundImage: m.gradient }}
                  aria-hidden="true"
                >
                  {initials(item.name)}
                  <span className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white text-[#2b303b] ring-1 ring-[#e7e9ee]">
                    <Icon className="h-2.5 w-2.5" />
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={m.href} className="min-w-0 truncate text-sm font-semibold text-[#2b303b] hover:text-[#d9650a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f96706]">
                      {item.name}
                    </Link>
                    <time dateTime={item.createdAt} className="shrink-0 text-xs tabular-nums text-[#676b7a]">
                      {timeAgo(item.createdAt)}
                    </time>
                  </div>
                  <p className="mt-0.5 text-sm text-[#676b7a]">
                    {m.verb} <span className="break-words font-medium text-[#2b303b]">{item.subtitle}</span>
                  </p>
                  <span className={`mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${m.badge}`}>{m.label}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
