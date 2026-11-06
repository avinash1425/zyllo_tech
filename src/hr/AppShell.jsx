// Router-based portal shell for HR Operations and the Employee Portal.
// Same visual language as the original PortalShell (dark navy sidebar,
// orange active state, white header) but driven by real routes and the
// signed-in user's server-side permissions — no demo users or fake counts.
import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronDown, ExternalLink, Globe, KeyRound, LayoutGrid, LogOut, Menu, Repeat, X } from "lucide-react";
import Image from "@/hr/platform/image";
import Link from "@/hr/platform/link";
import { useAuth } from "@/hr/platform/auth";
import { accountLabelFor, canChangeOwnPassword, employeeLoginIdOf } from "@/hr/platform/account";
import { from, run } from "@/lib/hr/client";

const cx = (...c) => c.filter(Boolean).join(" ");

/** Active when the path is the item or below it, unless it falls under one of item.exclude. */
export function isActiveItem(item, pathname) {
  const under = (base) => pathname === base || pathname.startsWith(base + "/");
  if (item.exclude?.some(under)) return false;
  return item.end ? pathname === item.to : under(item.to);
}

export function allowed(item, hasPermission) {
  if (!item.permissions?.length) return true;
  return item.permissions.some((p) => hasPermission(p));
}

function useUnreadNotifications(userId) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    async function load() {
      const res = await run(from("hr_notifications").select("id", { count: "exact", head: true }).is("read_at", null));
      if (active && !res.error) setCount(res.count ?? 0);
    }
    load();
    const t = setInterval(load, 60000);
    return () => { active = false; clearInterval(t); };
  }, [userId]);
  return count;
}

export default function AppShell({ portalName, sections, notificationsPath, switchTo, children }) {
  const { user, hr, signOut, hasPermission } = useAuth();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const unread = useUnreadNotifications(user?.id);

  useEffect(() => { setOpen(false); setMenu(false); }, [location.pathname]);

  const visibleSections = useMemo(
    () => sections.map((s) => ({ ...s, items: s.items.filter((i) => allowed(i, hasPermission)) })).filter((s) => s.items.length),
    [sections, hasPermission],
  );
  const current = useMemo(() => {
    const items = visibleSections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label })));
    return items.filter((i) => isActiveItem(i, location.pathname)).sort((a, b) => b.to.length - a.to.length)[0];
  }, [visibleSections, location.pathname]);
  const CurrentIcon = current?.icon || LayoutGrid;

  // Employee ID accounts sign in with an internal login address that
  // employees never see: show the Employee ID instead (email accounts unchanged).
  const employeeLoginId = employeeLoginIdOf(hr);
  const accountLabel = accountLabelFor({ user, hr });
  const name = hr?.employee?.display_name || employeeLoginId || accountLabel.split("@")[0] || "";
  const initial = (name[0] || "U").toUpperCase();

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen bg-[#f6f7fb] font-sans antialiased">
      <a href="#hr-main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[90] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold">Skip to content</a>
      {open && <div className="fixed inset-0 z-40 bg-[#0b0e17]/50 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside className={cx("fixed inset-y-0 left-0 z-50 flex w-[17rem] shrink-0 flex-col bg-gradient-to-b from-[#101a3a] via-[#0d1631] to-[#0a1025] text-white shadow-2xl transition-transform duration-300 motion-reduce:transition-none lg:sticky lg:top-0 lg:h-screen lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-16 -top-16 h-48 w-48 rounded-full bg-[#f7941e]/15 blur-[70px]" />
          <div className="absolute -bottom-20 -right-16 h-56 w-56 rounded-full bg-[#3089a6]/15 blur-[80px]" />
        </div>
        <div className="relative flex items-center justify-between border-b border-white/10 px-5 pb-5 pt-6">
          <Link href="/" className="group flex flex-1 items-center gap-2.5" aria-label="Zyllo Tech home">
            <Image src="/zyllo-icon.png" alt="" width={500} height={273} className="h-9 w-auto" />
            <span className="flex flex-col leading-none">
              <span className="text-[1.35rem] font-extrabold uppercase tracking-tight">
                <span className="bg-gradient-to-b from-[#ffd9a0] via-[#f96706] to-[#c24f05] bg-clip-text text-transparent">Zyllo</span>{" "}
                <span className="bg-gradient-to-b from-[#bfe6f2] via-[#3089a6] to-[#2b6f8a] bg-clip-text text-transparent">Tech</span>
              </span>
              <span className="mt-1 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-white/55">{portalName}</span>
            </span>
          </Link>
          <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-white/70 hover:bg-white/10 lg:hidden" aria-label="Close navigation"><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>

        <nav className="relative flex-1 overflow-y-auto px-3 pb-3 pt-3" aria-label={`${portalName} navigation`}>
          <div className="flex flex-col gap-4">
            {visibleSections.map((section) => (
              <div key={section.label}>
                <p className="px-3.5 py-1 text-xs font-bold uppercase tracking-[0.16em] text-white/50">{section.label}</p>
                <div className="mt-1 flex flex-col gap-1">
                  {section.items.map((item) => {
                    const Icon = item.icon || LayoutGrid;
                    const isActive = current?.to === item.to;
                    return (
                      <RouterLink key={item.to} to={item.to} aria-current={isActive ? "page" : undefined}
                        className={cx("group flex items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-[15px] font-semibold transition-all", isActive ? "active bg-gradient-to-r from-[#f7941e] to-[#f96706] text-white shadow-lg shadow-[#f96706]/25" : "text-white/80 hover:bg-white/[0.08] hover:text-white")}>
                        <Icon className={cx("h-5 w-5 shrink-0", isActive ? "text-white" : "text-white/60 group-hover:text-[#ffb15c]")} aria-hidden="true" /><span className="truncate">{item.label}</span>
                      </RouterLink>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="border-t border-white/10 pt-3">
              {switchTo && (
                <Link href={switchTo.href} className="group flex items-center gap-3 rounded-xl px-3.5 py-2 text-[14px] font-medium text-white/75 hover:bg-white/[0.08] hover:text-white">
                  <Repeat className="h-4 w-4 text-white/40 group-hover:text-[#f7941e]" aria-hidden="true" />{switchTo.label}
                </Link>
              )}
              <Link href="/" className="group flex items-center justify-between rounded-xl px-3.5 py-2 text-[14px] font-medium text-white/70 hover:bg-white/[0.08] hover:text-white">
                <span className="flex items-center gap-3"><Globe className="h-4 w-4 text-white/40 group-hover:text-[#f7941e]" aria-hidden="true" />Public website</span>
                <ExternalLink className="h-3.5 w-3.5 text-white/30" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </nav>

        <div className="relative border-t border-white/10 p-3.5">
          <div className="flex items-center gap-3 px-2 py-1.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#f7941e] to-[#3089a6] text-sm font-bold">{initial}</span>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-bold leading-tight">{name}</span>
              <span className="mt-0.5 block truncate text-xs text-white/50" data-testid="account-label-sidebar">{accountLabel}</span>
            </div>
            <button type="button" onClick={handleSignOut} aria-label="Sign out" title="Sign out" className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-red-400"><LogOut className="h-5 w-5" aria-hidden="true" /></button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 bg-white/95 shadow-[0_1px_0_0_#e2e8f0,0_4px_16px_-10px_rgba(16,26,58,0.1)] backdrop-blur-xl">
          <div className="flex h-[4.5rem] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button type="button" onClick={() => setOpen(true)} className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-[#173a52] lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" aria-hidden="true" /></button>
            <div className="flex min-w-0 items-center gap-3">
              <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e] to-[#f96706] text-white sm:flex"><CurrentIcon className="h-5 w-5" aria-hidden="true" /></span>
              <div className="min-w-0">
                <p className="hidden text-sm font-medium text-slate-600 sm:block">{portalName}{current?.section ? ` / ${current.section}` : ""}</p>
                <h1 className="truncate text-xl font-extrabold tracking-tight text-[#101a3a] sm:text-2xl">{current?.label || portalName}</h1>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {notificationsPath && (
                <Link href={notificationsPath} className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-[#173a52] hover:bg-slate-50" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
                  <Bell className="h-5 w-5" aria-hidden="true" />
                  {unread > 0 && <span className="absolute -right-1 -top-1 min-w-[1.25rem] rounded-full bg-[#f96706] px-1 text-center text-[11px] font-bold leading-5 text-white">{unread > 99 ? "99+" : unread}</span>}
                </Link>
              )}
              <div className="relative">
                <button type="button" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu} className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white py-1 pl-1 pr-2.5 hover:border-[#1f4693]/40">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#f7941e] to-[#1f4693] text-sm font-bold text-white">{initial}</span>
                  <span className="hidden max-w-[10rem] truncate text-left text-[13px] font-semibold text-[#101a3a] md:block">{name}</span>
                  <ChevronDown className={cx("h-4 w-4 text-slate-500 transition-transform", menu && "rotate-180")} aria-hidden="true" />
                </button>
                {menu && (
                  <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                    <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                      <p className="text-sm font-bold text-[#101a3a]">{name}</p>
                      <p className="truncate text-xs text-slate-600" data-testid="account-label-menu">{accountLabel}</p>
                      {hr?.roles?.length > 0 && <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{hr.roles.join(" · ").replace(/_/g, " ")}</p>}
                    </div>
                    <div className="p-1.5">
                      {switchTo && <Link href={switchTo.href} role="menuitem" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[#2b303b] hover:bg-slate-50"><Repeat className="h-4 w-4" aria-hidden="true" />{switchTo.label}</Link>}
                      {/* Employee ID accounts only: email accounts keep their existing sign-in. */}
                      {canChangeOwnPassword(hr) && <Link href="/employee/set-password" role="menuitem" data-testid="menu-change-password" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[#2b303b] hover:bg-slate-50"><KeyRound className="h-4 w-4" aria-hidden="true" />Change password</Link>}
                      <button type="button" role="menuitem" onClick={handleSignOut} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50"><LogOut className="h-4 w-4" aria-hidden="true" />Sign out</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>
        <main id="hr-main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
