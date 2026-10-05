import Link from "@/lib/nx/link";
import { BookOpen, Briefcase, FolderKanban, MessageSquare, Plus, ArrowRight } from "lucide-react";
import Card from "./Card";

const ACTIONS = [
  { label: "New blog post", hint: "Write and publish", href: "/admin/blog", icon: BookOpen },
  { label: "New job position", hint: "Open a role", href: "/admin/careers", icon: Briefcase },
  { label: "Add portfolio project", hint: "Showcase your work", href: "/admin/portfolio", icon: FolderKanban },
  { label: "View contacts", hint: "Review inquiries", href: "/admin/contacts", icon: MessageSquare },
];

export default function QuickActions() {
  return (
    <Card icon={Plus} title="Quick actions" subtitle="Jump straight to common tasks">
      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ACTIONS.map(({ label, hint, href, icon: Icon }) => (
          <li key={label}>
            <Link
              href={href}
              className="group flex items-center gap-3 rounded-xl border border-[#e7e9ee] bg-[#fafbfc] p-3 transition-colors hover:border-[#f7941e]/50 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f96706] motion-reduce:transition-none"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#f7941e] to-[#f96706] text-white">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[#2b303b]">{label}</span>
                <span className="block truncate text-xs text-[#676b7a]">{hint}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-[#8a8f9c] group-hover:text-[#2b303b] motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
