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
    <div className="flex min-h-screen bg-[#fafbfc]">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#0b0e17]/40 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-[#e7e9ee] bg-white transition-transform duration-300 motion-reduce:transition-none lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center gap-3 border-b border-[#e7e9ee] px-5">
          <Link href="/admin" className="flex items-center gap-2">
            <Image
              src="/zyllo-logo.png"
              alt="Zyllo Tech"
              width={140}
              height={28}
              className="h-10 w-auto"
            />
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="ml-auto rounded-md p-1 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#2b303b] lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="Admin">
          <div className="flex flex-col gap-6">
            {NAV_SECTIONS.map((section) => (
              <div key={section.label}>
                <p className="px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[#8a8f9c]">
                  {section.label}
                </p>
                <ul className="mt-2 flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const active = isActive(item);
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => setSidebarOpen(false)}
                          aria-current={active ? "page" : undefined}
                          className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1f4693] ${
                            active
                              ? "bg-[#1f4693]/[0.07] text-[#1f4693]"
                              : "text-[#5b606e] hover:bg-[#f3f4f7] hover:text-[#2b303b]"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-[#f7941e] to-[#f96706] transition-opacity duration-200 ${
                              active ? "opacity-100" : "opacity-0"
                            }`}
                          />
                          <Icon
                            className={`h-[18px] w-[18px] shrink-0 transition-colors ${
                              active ? "text-[#f96706]" : "text-[#8a8f9c] group-hover:text-[#2b303b]"
                            }`}
                            aria-hidden="true"
                          />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="flex flex-col gap-0.5 border-t border-[#e7e9ee] p-3">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[#5b606e] transition-colors duration-200 hover:bg-[#f3f4f7] hover:text-[#2b303b]"
          >
            <Home className="h-[18px] w-[18px] shrink-0 text-[#8a8f9c]" aria-hidden="true" />
            Back to Website
          </Link>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              signOut();
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[#5b606e] transition-colors duration-200 hover:bg-[#f3f4f7] hover:text-[#2b303b]"
            >
              <LogOut className="h-[18px] w-[18px] text-[#8a8f9c]" aria-hidden="true" />
              Log out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-[#e7e9ee] bg-white/85 backdrop-blur-md">
          <div className="flex h-16 items-center gap-3 px-4 sm:gap-4 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="-ml-1 rounded-md p-1.5 text-[#676b7a] hover:bg-[#f3f4f7] hover:text-[#2b303b] lg:hidden"
              aria-label="Open sidebar"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="min-w-0">
              {currentSection && (
                <p className="hidden text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a8f9c] sm:block">
                  {currentSection.label}
                </p>
              )}
              <p className="truncate text-sm font-semibold text-[#2b303b] sm:text-base">
                {currentItem?.label ?? "Admin"}
              </p>
            </div>

            <div className="ml-auto hidden flex-1 justify-end sm:flex">
              <AdminSearch />
            </div>

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
    </div>
  );
}
