import { useState } from "react";
import Image from "@/lib/nx/image";
import Link from "@/lib/nx/link";
import { usePathname } from "@/lib/nx/navigation";
import { AlertTriangle, Bell, CalendarCheck, CircleUserRound, ClipboardList, Plane, FolderKanban, LayoutDashboard, LogOut, Menu, X } from "lucide-react";
import { formatTime } from "./attendanceFormat";

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
      { href: "/employee/projects", label: "My Projects", icon: FolderKanban },
      { href: "/employee/reports", label: "Daily Work Report", icon: ClipboardList },
      { href: "/employee/attendance", label: "Attendance Management", icon: CalendarCheck },
      { href: "/employee/leave", label: "Leave Management", icon: Plane },
      { href: "/employee/notifications", label: "Notifications", icon: Bell, badge: "unread" },
    ],
  },
];

const NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);

const BTN =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-60";

/** Sidebar + top bar for the Employee Portal (same look as the admin side). */
export default function EmployeeShell({ me, busy, message, onPunchOut, onSignOut, summary, onDismissUrgent, children }) {
  const unread = summary?.unread ?? 0;
  const urgent = summary?.urgent ?? [];
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isActive = (item) =>
    item.exact ? pathname === item.href || pathname === `${item.href}/` : pathname.startsWith(item.href);
  const current = NAV_ITEMS.find(isActive);

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
            {NAV_SECTIONS.map((section) => (
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
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-3 py-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#f7941e] to-[#1f4693] text-sm font-bold">
              {(me.full_name?.[0] ?? "E").toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold">{me.full_name}</span>
              <span className="block font-mono text-[11px] text-white/55">{me.employee_code}</span>
            </span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-[#e7e9ee] bg-white/90 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg border border-[#e7e9ee] p-2 text-[#2b303b] lg:hidden"
              aria-label="Open sidebar"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <h1 className="min-w-0 flex-1 truncate text-base font-bold text-[#101a3a] sm:text-lg">
              {current?.label ?? "Employee Portal"}
            </h1>
            <Link
              href="/employee/notifications"
              className="relative rounded-lg border border-[#e7e9ee] p-2 text-[#2b303b] hover:bg-[#f6f7fb]"
              aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
              {unread > 0 && (
                <span className="absolute -right-1.5 -top-1.5 min-w-[1.25rem] rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-5 text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              Punched in at {formatTime(me.open_session.punch_in_at)}
            </span>
            {me.open_session.auto_punch_out_at && (
              <span className="hidden text-xs text-[#676b7a] md:inline">
                Auto punch out at {formatTime(me.open_session.auto_punch_out_at)}
              </span>
            )}
            <button
              type="button"
              onClick={onPunchOut}
              disabled={busy}
              className={`${BTN} bg-gradient-to-r from-[#f7941e] to-[#1f4693] text-white`}
            >
              <LogOut size={16} aria-hidden="true" />
              {busy ? "Punching out…" : "Punch out"}
            </button>
            <button
              type="button"
              onClick={onSignOut}
              disabled={busy}
              className={`${BTN} border border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]`}
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">
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
