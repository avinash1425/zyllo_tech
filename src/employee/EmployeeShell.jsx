import { useEffect, useRef, useState } from "react";
import Image from "@/lib/nx/image";
import Link from "@/lib/nx/link";
import { usePathname } from "@/lib/nx/navigation";
import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  ChevronDown,
  CircleUserRound,
  ClipboardList,
  Clock,
  ExternalLink,
  FolderKanban,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Plane,
  X,
} from "lucide-react";
import { formatTime } from "./attendanceFormat";
import { useAccess } from "@/lib/access";
import RoleSwitcher from "@/components/portal/RoleSwitcher";
import { ADMIN_NAV_SECTIONS } from "@/admin/AdminShell";

const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [
      { href: "/employee", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { href: "/employee/profile", label: "My Profile", icon: CircleUserRound },
    ],
  },
  {
    label: "My work",
    items: [
      { href: "/employee/projects", label: "My Projects", icon: FolderKanban, perms: ["emp.projects"] },
      { href: "/employee/reports", label: "Daily Work Report", icon: ClipboardList, perms: ["emp.reports", "team.reports"], teamHref: "/employee/reports/team", ownPerm: "emp.reports" },
      { href: "/employee/attendance", label: "Attendance Management", icon: CalendarCheck, perms: ["emp.attendance"] },
      { href: "/employee/leave", label: "Leave Management", icon: Plane, perms: ["emp.leave", "team.leave"] },
      { href: "/employee/notifications", label: "Notifications", icon: Bell, badge: "unread" },
    ],
  },
];

const NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);

// Top bar controls: same sizes and look as the admin top bar (AdminShell).
const TOP_BTN =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#e7e9ee] bg-white px-4 text-sm font-semibold text-[#173a52] shadow-[0_1px_2px_rgba(16,26,58,0.08)] transition-all hover:border-[#f7941e]/60 hover:text-[#c24f05] hover:shadow-[0_6px_16px_-8px_rgba(249,103,6,0.5)] disabled:cursor-not-allowed disabled:opacity-60";

/** Profile button + menu (same as the admin profile menu). */
function UserMenu({ me, busy, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const item = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-[#2b303b] transition-colors hover:bg-[#fafbfc]";

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
          {(me.full_name?.[0] ?? "E").toUpperCase()}
          <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
        </span>
        <span className="hidden text-left md:block">
          <span className="block max-w-[160px] truncate text-[13.5px] font-semibold leading-tight text-[#101a3a]">{me.full_name}</span>
          <span className="block max-w-[160px] truncate font-mono text-xs leading-tight text-[#6b7280]">{me.employee_code}</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-[#676b7a] transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-[#e7e9ee] bg-white shadow-lg">
          <div className="border-b border-[#e7e9ee] px-4 py-3">
            <p className="truncate text-sm font-semibold text-[#2b303b]">{me.full_name}</p>
            <p className="truncate text-xs text-[#676b7a]">
              <span className="font-mono">{me.employee_code}</span>
            </p>
          </div>
          <div className="p-1.5">
            <Link href="/employee/profile" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <CircleUserRound className="h-4 w-4 text-[#676b7a]" aria-hidden="true" />
              My Profile
            </Link>
            <Link href="/" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <Home className="h-4 w-4 text-[#676b7a]" aria-hidden="true" />
              Back to Website
            </Link>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className={item}
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

/** Sidebar + top bar for the Employee Portal (same look as the admin side). */
export default function EmployeeShell({ me, busy, message, onPunchOut, onSignOut, summary, onDismissUrgent, children }) {
  const { canAny, access, roles, activeRole } = useAccess();
  const hasSwitcher = !!activeRole && roles.length > 1;
  // "Admin pages" button: when the active role may open admin pages (e.g. a Team Lead given Project Tracker).
  const showAdminPages = hasSwitcher ? activeRole.key === "super_admin" || !!activeRole.admin_pages : !!access?.is_admin;
  // Admin pages the active role may open (e.g. Project Tracker for a Team Lead): listed in the sidebar too,
  // so every permission given to a role shows up, also on phones.
  const adminSection = {
    label: "Admin pages",
    items: showAdminPages
      ? ADMIN_NAV_SECTIONS.flatMap((s) => s.items)
          .filter((i) => i.perm && canAny([i.perm]))
          .map(({ badge: _badge, perm, ...i }) => ({ ...i, perms: [perm], exact: true }))
      : [],
  };
  const visibleSections = [...NAV_SECTIONS, adminSection].map((section) => ({
    ...section,
    items: section.items
      .filter((i) => !i.perms || canAny(i.perms))
      // A role with only the team part (e.g. Team reports without writing own reports) opens the team page.
      .map((i) => (i.teamHref && !canAny([i.ownPerm]) ? { ...i, href: i.teamHref } : i)),
  })).filter((section) => section.items.length > 0);
  const unread = summary?.unread ?? 0;
  const urgent = summary?.urgent ?? [];
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isActive = (item) =>
    item.exact ? pathname === item.href || pathname === `${item.href}/` : pathname.startsWith(item.href);
  const current = NAV_ITEMS.find(isActive);
  const currentSection = NAV_SECTIONS.find((sec) => sec.items.includes(current));

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
          <Link href="/employee" className="flex flex-1 items-center gap-2.5" aria-label="Employee Portal home">
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
                Employee Portal
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

        <nav className="relative flex-1 overflow-y-auto px-3 pb-2 pt-1" aria-label="Employee">
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
                          {item.badge === "unread" && unread > 0 && (
                            <span className="ml-auto rounded-full bg-[#f7941e] px-1.5 text-[11px] font-bold text-white">
                              {unread > 99 ? "99+" : unread}
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
              {(me.full_name?.[0] ?? "E").toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold leading-tight text-white">{me.full_name}</span>
              <span className="block truncate font-mono text-[11px] leading-tight text-white/50">{me.employee_code}</span>
            </span>
            <button
              type="button"
              onClick={onSignOut}
              disabled={busy}
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

            <div className="flex min-w-0 flex-1 items-center gap-3">
              {current?.icon && (
                <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e] to-[#f96706] text-white shadow-[0_8px_18px_-8px_rgba(249,103,6,0.7)] sm:flex">
                  <current.icon className="h-5 w-5" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0">
                <nav aria-label="Breadcrumb" className="hidden items-center gap-1.5 text-[12.5px] font-medium text-[#6b7280] sm:flex">
                  <span>Employee Portal</span>
                  {currentSection && (
                    <>
                      <span aria-hidden="true" className="text-[#c4c8d0]">/</span>
                      <span>{currentSection.label}</span>
                    </>
                  )}
                </nav>
                <h1 className="truncate text-lg font-bold leading-tight tracking-tight text-[#101a3a] sm:text-[1.35rem]">
                  {current?.label ?? "Employee Portal"}
                </h1>
              </div>
            </div>

            {me.open_session && (
            <span
              className="hidden h-11 shrink-0 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 text-xs font-semibold text-emerald-800 xl:inline-flex"
              title={me.open_session.auto_punch_out_at ? `Auto punch out at ${formatTime(me.open_session.auto_punch_out_at)}` : undefined}
            >
              <Clock className="h-4 w-4" aria-hidden="true" />
              In since {formatTime(me.open_session.punch_in_at)}
              {me.open_session.auto_punch_out_at && (
                <span className="font-normal text-emerald-700">· auto out {formatTime(me.open_session.auto_punch_out_at)}</span>
              )}
            </span>
            )}

            <Link
              href="/employee/notifications"
              className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#e7e9ee] bg-white text-[#173a52] shadow-[0_1px_2px_rgba(16,26,58,0.08)] transition-all hover:border-[#f7941e]/60 hover:text-[#c24f05]"
              aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
              {unread > 0 && (
                <span className="absolute -right-1.5 -top-1.5 min-w-[1.25rem] rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-5 text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>

            <RoleSwitcher />

            {showAdminPages && (
              <Link href="/admin" className={`${TOP_BTN} hidden md:inline-flex`} title="Admin pages your role may open">
                <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                Admin pages
              </Link>
            )}

            <Link href="/" className={`${TOP_BTN} hidden md:inline-flex`}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              View site
            </Link>

            {me.open_session && (
            <button
              type="button"
              onClick={onPunchOut}
              disabled={busy}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f7941e] to-[#f96706] px-4 text-sm font-semibold text-white shadow-[0_8px_18px_-8px_rgba(249,103,6,0.7)] transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
              title={`Punched in at ${formatTime(me.open_session.punch_in_at)}`}
              aria-label={busy ? "Punching out" : "Punch out"}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{busy ? "Punching out…" : "Punch out"}</span>
            </button>
            )}

            <UserMenu me={me} busy={busy} onSignOut={onSignOut} />
          </div>
          <div aria-hidden="true" className="h-[2px] w-full bg-gradient-to-r from-[#1f4693] via-[#f7941e] to-[#3089a6] opacity-80" />
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          {urgent.length > 0 && (
            <div className="mx-auto mb-4 flex max-w-6xl flex-col gap-2">
              {urgent.map((n) => (
                <div key={n.id} role="alert" className="flex flex-wrap items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">
                      {n.title}
                      {n.sender_label && <span className="font-normal text-red-700"> · from {n.sender_label}</span>}
                    </p>
                    {n.body && <p className="mt-0.5 whitespace-pre-line break-words">{n.body}</p>}
                  </div>
                  {n.link && (
                    <Link href={n.link} onClick={() => onDismissUrgent?.(n.id)} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white">
                      Open
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => onDismissUrgent?.(n.id)}
                    className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                  >
                    Mark as read
                  </button>
                </div>
              ))}
            </div>
          )}
          {message && (
            <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {message}
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
