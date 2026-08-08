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
  Users,
  FolderKanban,
  Menu,
  X,
  LogOut,
  Home,
} from "lucide-react";
import { signOut } from "@/app/login/actions";
import AdminSearch from "./AdminSearch";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/contacts", label: "Contact Submissions", icon: Mail },
  { href: "/admin/blog", label: "Blog Posts", icon: Newspaper },
  { href: "/admin/careers", label: "Careers", icon: Briefcase },
  { href: "/admin/job-applications", label: "Job Applications", icon: Users },
  { href: "/admin/portfolio", label: "Portfolio", icon: FolderKanban },
];

export default function AdminShell({ children }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  function isActive(item) {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  return (
    <div className="flex min-h-screen bg-[#fafbfc]">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#0b0e17]/40 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-[#e7e9ee] bg-white transition-transform duration-300 lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-20 items-center gap-3 border-b border-[#e7e9ee] px-6">
          <Link href="/admin" className="flex items-center gap-2">
            <Image
              src="/zyllo-logo.png"
              alt="Zyllo Tech"
              width={140}
              height={28}
              className="h-12 w-auto"
            />
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="ml-auto text-[#676b7a] hover:text-[#2b303b] lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-6">
          <p className="px-3 text-xs font-bold uppercase tracking-[0.15em] text-[#9aa0ac]">
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
                    className={`group relative flex items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                      active
                        ? "bg-gradient-to-r from-[#f7941e]/12 to-[#1f4693]/8 text-[#1f4693]"
                        : "text-[#676b7a] hover:bg-[#fafbfc] hover:text-[#2b303b]"
                    }`}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-gradient-to-b from-[#f7941e] to-[#1f4693]"
                      />
                    )}
                    <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex flex-col gap-1 border-t border-[#e7e9ee] p-3">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[#676b7a] transition-colors duration-200 hover:bg-[#fafbfc] hover:text-[#2b303b]"
          >
            <Home className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
            Back to Website
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[#676b7a] transition-colors duration-200 hover:bg-[#fafbfc] hover:text-[#2b303b]"
            >
              <LogOut className="h-4.5 w-4.5" aria-hidden="true" />
              Log out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-20 items-center gap-4 border-b border-[#e7e9ee] bg-white/90 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="text-[#676b7a] hover:text-[#2b303b] lg:hidden"
            aria-label="Open sidebar"
          >
            <Menu className="h-5.5 w-5.5" aria-hidden="true" />
          </button>

          <div className="hidden flex-1 sm:block">
            <AdminSearch />
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2.5 border-l border-[#e7e9ee] pl-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#f7941e] to-[#1f4693] text-sm font-semibold text-white">
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
