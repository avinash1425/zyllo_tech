"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Mail,
  Newspaper,
  Briefcase,
  FolderKanban,
  Menu,
  X,
  Bell,
  Search,
  LogOut,
  Settings,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/contacts", label: "Contact Submissions", icon: Mail },
  { href: "/admin/blog", label: "Blog Posts", icon: Newspaper },
  { href: "/admin/careers", label: "Careers", icon: Briefcase },
  { href: "/admin/portfolio", label: "Portfolio", icon: FolderKanban },
];

export default function AdminLayout({ children }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  function isActive(item) {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  return (
    <div className="flex min-h-screen bg-[#f5f6f8]">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-white/10 bg-[#0b0e17] transition-transform duration-300 lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-6">
          <Link href="/admin" className="flex items-center gap-2 rounded-lg bg-white px-3 py-2">
            <Image
              src="/zyllo-logo.png"
              alt="Zyllo Tech"
              width={140}
              height={28}
              className="h-7 w-auto"
            />
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="ml-auto text-white/60 hover:text-white lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-6">
          <p className="px-3 text-xs font-bold uppercase tracking-[0.15em] text-white/30">
            Dashboard
          </p>
          <ul className="mt-3 flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                      active
                        ? "bg-gradient-to-r from-[#f7941e]/20 to-[#f7941e]/5 text-[#f7941e]"
                        : "text-white/60 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-white/10 p-3">
          <Link
            href="/login"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/60 transition-colors duration-200 hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4.5 w-4.5" aria-hidden="true" />
            Log out
          </Link>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-[#e7e9ee] bg-white/90 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="text-[#676b7a] hover:text-[#2b303b] lg:hidden"
            aria-label="Open sidebar"
          >
            <Menu className="h-5.5 w-5.5" aria-hidden="true" />
          </button>

          <div className="relative hidden max-w-sm flex-1 sm:block">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#676b7a]/50"
              aria-hidden="true"
            />
            <input
              type="search"
              placeholder="Search…"
              className="w-full rounded-lg border border-[#e7e9ee] bg-[#f5f6f8] py-2 pl-9 pr-3 text-sm text-[#2b303b] outline-none placeholder:text-[#676b7a]/50 focus:border-[#f7941e]/50 focus:bg-white"
            />
          </div>

          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              aria-label="Notifications"
              className="relative flex h-9 w-9 items-center justify-center rounded-full text-[#676b7a] transition-colors hover:bg-[#f5f6f8] hover:text-[#2b303b]"
            >
              <Bell className="h-4.5 w-4.5" aria-hidden="true" />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#f7941e]" />
            </button>
            <button
              type="button"
              aria-label="Settings"
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#676b7a] transition-colors hover:bg-[#f5f6f8] hover:text-[#2b303b]"
            >
              <Settings className="h-4.5 w-4.5" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-2.5 border-l border-[#e7e9ee] pl-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#f7941e] to-[#db7d17] text-sm font-semibold text-white">
                A
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-semibold text-[#2b303b]">Admin</p>
                <p className="text-xs text-[#676b7a]">Zyllo Tech</p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
