import Image from "@/lib/nx/image";
import Link from "@/lib/nx/link";
import { usePathname } from "@/lib/nx/navigation";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  Mail,
  Newspaper,
  Briefcase,
  Users,
  FolderKanban,
  Search,
  BarChart3,
  Menu,
  X,
  LogOut,
  Home,
  ChevronDown,
  ExternalLink,
  ClipboardList,
  Building2,
  KeyRound,
  UsersRound,
  UserCog,
  ListChecks,
  CalendarCheck,
  Palmtree,
  FileText,
  BellRing,
  Bell,
  CircleUserRound,
  ShieldCheck,
  UserCog as UserCog2,
} from "lucide-react";
import { useAccess } from "@/lib/access";
import RoleSwitcher from "@/components/portal/RoleSwitcher";
import { useAuth } from "@/lib/auth";
import AdminSearch from "./AdminSearch";
import { getAdminInboxSummary, INBOX_CHANGED } from "@/lib/api/admin/inbox";

const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true, perm: "dashboard" }],
  },
  {
    label: "Content",
    items: [
      { href: "/admin/contacts", label: "Contact Submissions", icon: Mail, perm: "website.contacts" },
      { href: "/admin/blog", label: "Blog Posts", icon: Newspaper, perm: "website.blog" },
      { href: "/admin/portfolio", label: "Portfolio", icon: FolderKanban, perm: "website.portfolio" },
    ],
  },
  {
    label: "Hiring",
    items: [
      { href: "/admin/careers", label: "Careers", icon: Briefcase, perm: "website.careers" },
      { href: "/admin/job-applications", label: "Job Applications", icon: Users, perm: "website.job_applications" },
    ],
  },
  {
    label: "Growth",
    items: [
      { href: "/admin/seo", label: "SEO", icon: Search, perm: "website.seo" },
      { href: "/admin/search-console", label: "Search Console", icon: BarChart3, perm: "website.search_console" },
    ],
  },
  {
    label: "Projects",
    items: [
      {
        href: "/admin/project-tracker",
        label: "Project Tracker",
        perm: "projects.tracker",
        icon: ClipboardList,
        exact: true,
        also: ["/admin/project-tracker/projects/"],
      },
      { href: "/admin/project-tracker/companies", label: "Clients", icon: Building2, perm: "projects.clients" },
      { href: "/admin/project-tracker/access", label: "Access & Logins", icon: KeyRound, perm: "projects.logins" },
    ],
  },
  {
    label: "Employee Portal",
    items: [
      { href: "/admin/employee-portal", label: "Employee Portal", icon: UsersRound, exact: true, perm: "portal.dashboard" },
      { href: "/admin/employees", label: "Employee Management", icon: UserCog, perm: "portal.employees" },
      { href: "/admin/project-management", label: "Project Management", icon: ListChecks, perm: "portal.projects" },
      { href: "/admin/attendance", label: "Attendance Management", icon: CalendarCheck, perm: "portal.attendance" },
      { href: "/admin/leave", label: "Leave Management", icon: Palmtree, perm: "portal.leave" },
      { href: "/admin/reports", label: "Daily Work Reports", icon: FileText, perm: "portal.reports" },
      { href: "/admin/notifications", label: "Notifications Management", icon: BellRing, perm: "portal.notifications" },
      { href: "/admin/inbox", label: "Notifications", icon: Bell, badge: "inbox", perm: "portal.inbox" },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/admin/settings/users", label: "Users & Roles", icon: UserCog2, perm: "settings.users" },
      { href: "/admin/settings/roles", label: "Roles & Permissions", icon: ShieldCheck, perm: "settings.roles" },
    ],
  },
];

/** First menu page the user may open (used when they may not see the website dashboard). */
export function firstAllowedHref(can) {
  for (const section of NAV_SECTIONS) for (const item of section.items) if (!item.perm || can(item.perm)) return item.href;
  return null;
}

const NAV_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

function UserMenu({ email, onSignOut, roleName }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = (email?.[0] ?? "A").toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-11 items-center gap-2.5 rounded-xl border border-[#e7e9ee] bg-white py-1 pl-1 pr-3 shadow-[0_1px_2px_rgba(16,26,58,0.08)] transition-all hover:border-[#1f4693]/30 hover:shadow-[0_6px_16px_-10px_rgba(16,26,58,0.5)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693]"
      >
        <span className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#f7941e] to-[#1f4693] text-sm font-bold text-white">
          {initial}
          <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-[#3089a6]" />
        </span>
        <span className="hidden text-left md:block">
          <span className="block text-[13.5px] font-semibold leading-tight text-[#101a3a]">{roleName || "Admin"}</span>
          <span className="block max-w-[150px] truncate text-xs leading-tight text-[#6b7280]">
            {email || "Zyllo Tech"}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-[#676b7a] transition-transform duration-200 motion-reduce:transition-none ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-[#e7e9ee] bg-white shadow-lg"
        >
          <div className="border-b border-[#e7e9ee] px-4 py-3">
            <p className="text-sm font-semibold text-[#2b303b]">Signed in</p>
            <p className="truncate text-xs text-[#676b7a]">{email || "Zyllo Tech admin"}</p>
          </div>
          <div className="p-1.5">
            <Link
              href="/admin/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[#2b303b] transition-colors hover:bg-[#fafbfc]"
            >
              <CircleUserRound className="h-4 w-4 text-[#676b7a]" aria-hidden="true" />
              My profile
            </Link>
            <Link
              href="/"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[#2b303b] transition-colors hover:bg-[#fafbfc]"
            >
              <Home className="h-4 w-4 text-[#676b7a]" aria-hidden="true" />
              Back to Website
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-[#2b303b] transition-colors hover:bg-[#fafbfc]"
            >
              <LogOut className="h-4 w-4 text-[#676b7a]" aria-hidden="true" />
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Unread admin notifications (migration 256): polled every 60 s and refreshed when the inbox page reads some. */
function useInboxUnread(enabled) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const load = () =>
      getAdminInboxSummary()
        .then((s) => active && setUnread(Number(s?.unread) || 0))
        .catch(() => {}); // database without the inbox yet: no badge
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener(INBOX_CHANGED, load);
    return () => {
      active = false;
      clearInterval(t);
      window.removeEventListener(INBOX_CHANGED, load);
    };
  }, [enabled]);
  return enabled ? unread : 0;
}

export default function AdminShell({ children }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, signOut } = useAuth();
  const { can, access, roles, activeRole } = useAccess();
  const hasSwitcher = !!activeRole && roles.length > 1;
  const isEmployee = !hasSwitcher && (access?.roles ?? []).some((r) => r.key === "employee");
  const canInbox = can("portal.inbox");
  const inboxUnread = useInboxUnread(canInbox);
  const visibleSections = NAV_SECTIONS.map((section) => ({ ...section, items: section.items.filter((item) => !item.perm || can(item.perm)) })).filter(
    (section) => section.items.length > 0,
  );

  function isActive(item) {
    if (item.also?.some((prefix) => pathname.startsWith(prefix))) return true;
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  const currentItem = NAV_ITEMS.find(isActive);
  const currentSection = NAV_SECTIONS.find((s) => s.items.includes(currentItem));

  return (
    <div className="flex min-h-screen bg-[#f6f7fb]">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#0b0e17]/40 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[17rem] shrink-0 flex-col bg-gradient-to-b from-[#101a3a] via-[#0d1631] to-[#0a1025] text-white shadow-2xl shadow-black/20 transition-transform duration-300 motion-reduce:transition-none lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-16 -top-16 h-48 w-48 rounded-full bg-[#f7941e]/15 blur-[70px]" />
          <div className="absolute -bottom-20 -right-16 h-56 w-56 rounded-full bg-[#3089a6]/15 blur-[80px]" />
        </div>

        <div className="relative flex items-center gap-3 px-5 pb-5 pt-6">
          <Link
            href="/admin"
            className="flex flex-1 items-center gap-2.5"
            aria-label="Zyllo Tech admin home"
          >
            <Image
              src="/zyllo-icon.png"
              alt=""
              width={500}
              height={273}
              className="h-9 w-auto drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)]"
            />
            <span className="flex flex-col leading-none">
              <span className="text-[1.35rem] font-extrabold uppercase tracking-tight">
                <span className="bg-gradient-to-b from-[#ffd9a0] via-[#f96706] to-[#c24f05] bg-clip-text text-transparent">
                  Zyllo
                </span>{" "}
                <span className="bg-gradient-to-b from-[#bfe6f2] via-[#3089a6] to-[#2b6f8a] bg-clip-text text-transparent">
                  Tech
                </span>
              </span>
              <span className="mt-1 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-white/55">
                Software Solutions Pvt Ltd
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="zt-admin-scroll relative flex-1 overflow-y-auto px-3 pb-2 pt-1" aria-label="Admin">
          <div className="flex flex-col gap-4">
            {visibleSections.map((section) => (
              <div key={section.label}>
                <p className="px-3 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/40">
                  {section.label}
                </p>
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const active = isActive(item);
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => setSidebarOpen(false)}
                          aria-current={active ? "page" : undefined}
                          className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#f7941e] ${
                            active
                              ? "bg-gradient-to-r from-[#f7941e] to-[#f96706] text-white shadow-lg shadow-[#f96706]/25"
                              : "text-white/70 hover:bg-white/[0.07] hover:text-white"
                          }`}
                        >
                          <Icon
                            className={`h-[18px] w-[18px] shrink-0 transition-colors ${
                              active ? "text-white" : "text-white/50 group-hover:text-[#ffb15c]"
                            }`}
                            aria-hidden="true"
                          />
                          <span className="truncate">{item.label}</span>
                          {item.badge === "inbox" && inboxUnread > 0 && (
                            <span className="ml-auto min-w-[1.25rem] rounded-full bg-red-600 px-1.5 text-center text-[10.5px] font-bold leading-5 text-white">
                              {inboxUnread > 99 ? "99+" : inboxUnread}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="relative border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#f7941e] to-[#3089a6] text-sm font-semibold text-white">
              {(user?.email?.[0] ?? "A").toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold leading-tight text-white">Admin</span>
              <span className="block truncate text-[11px] leading-tight text-white/50">
                {user?.email || "Zyllo Tech"}
              </span>
            </span>
            <button
              type="button"
              onClick={() => signOut()}
              title="Log out"
              aria-label="Log out"
              className="rounded-lg p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f7941e]"
            >
              <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 bg-white/85 shadow-[0_1px_0_0_#e7e9ee,0_8px_24px_-18px_rgba(16,26,58,0.35)] backdrop-blur-xl">
          <div className="flex h-[4.5rem] items-center gap-3 px-4 sm:gap-4 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#e7e9ee] bg-white text-[#173a52] shadow-[0_1px_2px_rgba(16,26,58,0.08)] transition-colors hover:bg-[#f3f4f7] lg:hidden"
              aria-label="Open sidebar"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="flex min-w-0 items-center gap-3">
              {currentItem?.icon && (
                <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e] to-[#f96706] text-white shadow-[0_8px_18px_-8px_rgba(249,103,6,0.7)] sm:flex">
                  <currentItem.icon className="h-5 w-5" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0">
                <nav aria-label="Breadcrumb" className="hidden items-center gap-1.5 text-[12.5px] font-medium text-[#6b7280] sm:flex">
                  <span>Admin</span>
                  {currentSection && (
                    <>
                      <span aria-hidden="true" className="text-[#c4c8d0]">/</span>
                      <span>{currentSection.label}</span>
                    </>
                  )}
                </nav>
                <h2 className="truncate text-lg font-bold leading-tight tracking-tight text-[#101a3a] sm:text-[1.35rem]">
                  {pathname.startsWith("/admin/profile") ? "My profile" : (currentItem?.label ?? "Admin")}
                </h2>
              </div>
            </div>

            <div className="ml-auto hidden flex-1 justify-end sm:flex">
              <AdminSearch />
            </div>

            <RoleSwitcher />

            {canInbox && (
            <Link
              href="/admin/inbox"
              className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#e7e9ee] bg-white text-[#173a52] shadow-[0_1px_2px_rgba(16,26,58,0.08)] transition-all hover:border-[#f7941e]/60 hover:text-[#c24f05]"
              aria-label={inboxUnread ? `Notifications, ${inboxUnread} unread` : "Notifications"}
              title="Notifications"
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
              {inboxUnread > 0 && (
                <span className="absolute -right-1.5 -top-1.5 min-w-[1.25rem] rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-5 text-white">
                  {inboxUnread > 99 ? "99+" : inboxUnread}
                </span>
              )}
            </Link>
            )}

            {isEmployee && (
              <Link
                href="/employee"
                className="hidden h-11 items-center gap-2 rounded-xl border border-[#e7e9ee] bg-white px-4 text-sm font-semibold text-[#173a52] shadow-[0_1px_2px_rgba(16,26,58,0.08)] transition-all hover:border-[#f7941e]/60 hover:text-[#c24f05] md:inline-flex"
              >
                <UsersRound className="h-4 w-4" aria-hidden="true" />
                Employee Portal
              </Link>
            )}

            <Link
              href="/"
              className="hidden h-11 items-center gap-2 rounded-xl border border-[#e7e9ee] bg-white px-4 text-sm font-semibold text-[#173a52] shadow-[0_1px_2px_rgba(16,26,58,0.08)] transition-all hover:border-[#f7941e]/60 hover:text-[#c24f05] hover:shadow-[0_6px_16px_-8px_rgba(249,103,6,0.5)] md:inline-flex"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              View site
            </Link>

            <div className="ml-auto sm:ml-0">
              <UserMenu email={user?.email} onSignOut={signOut} roleName={activeRole?.name} />
            </div>
          </div>

          <div className="px-4 pb-3 sm:hidden">
            <AdminSearch />
          </div>
          <div aria-hidden="true" className="h-[2px] w-full bg-gradient-to-r from-[#1f4693] via-[#f7941e] to-[#3089a6] opacity-80" />
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
      <style>{`
        .zt-admin-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.18) transparent; }
        .zt-admin-scroll::-webkit-scrollbar { width: 6px; }
        .zt-admin-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 9999px; }
        .zt-admin-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  );
}
