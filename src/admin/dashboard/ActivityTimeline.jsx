import Link from "@/lib/nx/link";
import { Briefcase, Clock, MessageSquare } from "lucide-react";
import Card from "./Card";
import EmptyState from "../EmptyState";

const META = {
  contact: { label: "Contact", icon: MessageSquare, color: "#d9650a", bg: "#f7941e1f", href: "/admin/contacts", verb: "contacted us about" },
  applicant: { label: "Applicant", icon: Briefcase, color: "#1f4693", bg: "#1f46931a", href: "/admin/job-applications", verb: "applied for" },
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
    <Card icon={Clock} title="Recent activity" subtitle="Latest events across contacts and applications">
      {items.length === 0 ? (
        <EmptyState icon={Clock} title="Nothing yet" message="New contact submissions and applicants will show up here." className="py-12" />
      ) : (
        <ol className="mt-4 flex flex-col">
          {items.map((item, i) => {
            const m = META[item.type] ?? META.contact;
            const Icon = m.icon;
            return (
              <li key={`${item.type}-${item.id}`} className="relative flex gap-3 pb-4 last:pb-0">
                {i !== items.length - 1 && (
                  <span aria-hidden="true" className="absolute bottom-0 left-[17px] top-9 w-px bg-[#e7e9ee]" />
                )}
                <span
                  className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  style={{ backgroundColor: m.bg, color: m.color }}
                  aria-hidden="true"
                >
                  {initials(item.name)}
                  <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white ring-1 ring-[#e7e9ee]">
                    <Icon className="h-2.5 w-2.5" />
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[#2b303b]">
                    <Link
                      href={m.href}
                      className="font-semibold hover:text-[#d9650a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f96706]"
                    >
                      {item.name}
                    </Link>{" "}
                    <span className="text-[#676b7a]">{m.verb}</span>{" "}
                    <span className="break-words font-medium">{item.subtitle}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-[#676b7a]">
                    {m.label} · <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
