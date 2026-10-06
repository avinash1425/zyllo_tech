// Account area of the public header.
// Signed out: a small "Login" pill. Signed in (desktop): an inline strip of
// Admin pill (admins only) | avatar + email | Logout. On phones it is a stacked
// card inside the menu. The session lives in supabase-js (localStorage), so
// moving between /admin and the public site keeps you signed in; only Logout
// ends it.
import { useEffect, useState } from "react";
import { LayoutDashboard, LogOut, ShieldCheck } from "lucide-react";
import Link from "@/lib/nx/link";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

function useIsAdmin(user) {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let active = true;
    if (!user) {
      setIsAdmin(false);
      return undefined;
    }
    supabase.rpc("is_admin").then(({ data }) => {
      if (active) setIsAdmin(data === true);
    });
    return () => {
      active = false;
    };
  }, [user]);
  return isAdmin;
}

function Avatar({ email, className = "h-7 w-7 text-xs" }) {
  const initial = (email?.[0] ?? "U").toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#f7941e] to-[#1f4693] font-bold text-white ${className}`}
    >
      {initial}
    </span>
  );
}

export default function AccountBar({ mobile = false, onNavigate }) {
  const { user, loading, signOut } = useAuth();
  const isAdmin = useIsAdmin(user);

  if (loading) return null;

  if (!user) {
    if (mobile) {
      return (
        <Link
          href="/login"
          onClick={onNavigate}
          className="flex min-h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#f96706] to-[#f7941e] px-4 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(249,103,6,0.25)] transition-opacity hover:opacity-90"
        >
          Login
        </Link>
      );
    }
    return (
      <Link
        href="/login"
        className="inline-flex items-center rounded-full bg-gradient-to-r from-[#f96706] to-[#f7941e] px-3 py-[3px] text-[12px] font-semibold leading-5 text-white shadow-[0_1px_4px_rgba(249,103,6,0.3)] transition-all duration-200 ease-out hover:to-[#3089a6] hover:shadow-md hover:shadow-[#f96706]/25"
      >
        Login
      </Link>
    );
  }

  async function handleLogout() {
    onNavigate?.();
    await signOut();
  }

  // Phone / tablet menu: stacked, full-width rows (no dropdown inside a drawer).
  if (mobile) {
    return (
      <div className="flex w-full flex-col gap-2">
        <div className="flex items-center gap-3 rounded-xl border border-[#e3e6ee] bg-white px-3 py-2.5">
          <Avatar email={user.email} className="h-10 w-10 text-base" />
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold leading-tight text-[#101a3a]">Signed in</span>
            <span className="block truncate text-[14px] leading-tight text-[#4a5668]">{user.email}</span>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {isAdmin ? (
            <Link
              href="/admin"
              onClick={onNavigate}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f96706] to-[#f7941e] px-3 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(249,103,6,0.25)]"
            >
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              Admin
            </Link>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#e3e6ee] bg-white px-3 text-[15px] font-semibold text-[#173a52]"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Logout
          </button>
        </div>
      </div>
    );
  }

  // Desktop strip: inline, no dropdown. Three clearly separated parts.
  return (
    <div className="flex items-center gap-3 normal-case">
      {isAdmin && (
        <Link
          href="/admin"
          onClick={onNavigate}
          className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#f96706] to-[#f7941e] py-1 pl-2.5 pr-3.5 text-[13px] font-semibold leading-5 text-white shadow-[0_3px_10px_-3px_rgba(249,103,6,0.6)] transition-all duration-200 hover:shadow-[0_6px_16px_-4px_rgba(249,103,6,0.7)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f96706]/50"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          Admin
        </Link>
      )}

      <span aria-hidden="true" className="h-5 w-px bg-[#dfe3ec]" />

      <span
        title={user.email}
        className="inline-flex items-center gap-2 text-[13px] font-medium leading-5 text-[#173a52]"
      >
        <Avatar email={user.email} className="h-6 w-6 text-[11px] ring-2 ring-white shadow-[0_1px_3px_rgba(16,26,58,0.25)]" />
        <span className="max-w-[16rem] truncate">{user.email}</span>
      </span>

      <span aria-hidden="true" className="h-5 w-px bg-[#dfe3ec]" />

      <button
        type="button"
        onClick={handleLogout}
        className="group inline-flex items-center gap-1.5 rounded-full border border-[#dfe3ec] bg-white px-3 py-1 text-[13px] font-semibold leading-5 text-[#173a52] shadow-[0_1px_2px_rgba(16,26,58,0.06)] transition-all duration-200 hover:border-[#f96706]/50 hover:text-[#c24f05] hover:shadow-[0_4px_12px_-6px_rgba(249,103,6,0.5)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f96706]/40"
      >
        <LogOut className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
        Logout
      </button>
    </div>
  );
}
