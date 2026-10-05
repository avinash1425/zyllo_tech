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
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import AdminSearch from "./AdminSearch";

const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true }],
  },
  {
    label: "Content",
    items: [
      { href: "/admin/contacts", label: "Contact Submissions", icon: Mail },
      { href: "/admin/blog", label: "Blog Posts", icon: Newspaper },
      { href: "/admin/portfolio", label: "Portfolio", icon: FolderKanban },
    ],
  },
  {
    label: "Hiring",
    items: [
      { href: "/admin/careers", label: "Careers", icon: Briefcase },
      { href: "/admin/job-applications", label: "Job Applications", icon: Users },
    ],
  },
  {
    label: "Growth",
    items: [
      { href: "/admin/seo", label: "SEO", icon: Search },
      { href: "/admin/search-console", label: "Search Console", icon: BarChart3 },
    ],
  },
];

const NAV_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

function UserMenu({ email, onSignOut }) {
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
        className="flex items-center gap-2.5 rounded-full border border-[#e7e9ee] bg-white py-1 pl-1 pr-2.5 shadow-sm transition-colors hover:border-[#1f4693]/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693]"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#f7941e] to-[#1f4693] text-sm font-semibold text-white">
          {initial}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-semibold leading-tight text-[#2b303b]">Admin</span>
          <span className="block max-w-[140px] truncate text-xs leading-tight text-[#676b7a]">
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

export default function AdminShell({ children }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, signOut } = useAuth();

  function isActive(item) {
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

        <div className="relative flex items-center gap-3 px-4 pb-3 pt-4">
          <Link
            href="/admin"
            className="flex flex-1 items-center justify-center rounded-xl bg-white px-3 py-2 shadow-lg shadow-black/20 ring-1 ring-white/20"
            aria-label="Zyllo Tech admin home"
          >
            <Image src="/zyllo-logo.png" alt="Zyllo Tech" width={140} height={28} className="h-9 w-auto" />
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

        <nav className="admin-scroll relative flex-1 overflow-y-auto px-3 pb-2 pt-1" aria-label="Admin">
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
          <Link
            href="/"
            className="flex items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-[13.5px] font-medium text-white/90 transition-colors duration-200 hover:border-[#f7941e]/60 hover:bg-white/10 hover:text-white"
          >
            <span className="flex items-center gap-3">
              <Home className="h-[18px] w-[18px] shrink-0 text-[#ffb15c]" aria-hidden="true" />
              Back to Website
            </span>
            <ExternalLink className="h-3.5 w-3.5 text-white/40" aria-hidden="true" />
          </Link>

          <div className="mt-2 flex items-center gap-2.5 rounded-xl px-2 py-1.5">
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
        <header className="sticky top-0 z-30 border-b border-[#e7e9ee] bg-white/80 backdrop-blur-xl">
          <div className="flex h-[4.25rem] items-center gap-3 px-4 sm:gap-4 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="-ml-1 rounded-lg border border-[#e7e9ee] bg-white p-2 text-[#2b303b] shadow-sm hover:bg-[#f3f4f7] lg:hidden"
              aria-label="Open sidebar"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="min-w-0">
              <nav aria-label="Breadcrumb" className="hidden items-center gap-1.5 text-xs text-[#8a8f9c] sm:flex">
                <span>Admin</span>
                {currentSection && (
                  <>
                    <span aria-hidden="true">/</span>
                    <span>{currentSection.label}</span>
                  </>
                )}
              </nav>
              <h2 className="truncate text-base font-bold leading-tight text-[#1b2030] sm:text-lg">
                {currentItem?.label ?? "Admin"}
              </h2>
            </div>

            <div className="ml-auto hidden flex-1 justify-end sm:flex">
              <AdminSearch />
            </div>

            <Link
              href="/"
              className="hidden items-center gap-1.5 rounded-full border border-[#e7e9ee] bg-white px-3.5 py-2 text-sm font-medium text-[#2b303b] shadow-sm transition-colors hover:border-[#f7941e]/50 hover:text-[#f96706] md:inline-flex"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              View site
            </Link>

            <div className="ml-auto sm:ml-0">
              <UserMenu email={user?.email} onSignOut={signOut} />
            </div>
          </div>

          <div className="border-t border-[#e7e9ee] px-4 py-2 sm:hidden">
            <AdminSearch />
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
      <style>{`
        .admin-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.18) transparent; }
        .admin-scroll::-webkit-scrollbar { width: 6px; }
        .admin-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 9999px; }
        .admin-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  );
}
