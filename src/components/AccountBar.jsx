// Account area of the public header.
// Signed out: a small "Login" pill. Signed in: one account button (avatar + name)
// that opens a clean dropdown with the email, an "Admin dashboard" link (admins
// only) and Logout. The session lives in supabase-js (localStorage), so moving
// between /admin and the public site keeps you signed in; only Logout ends it.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LayoutDashboard, LogOut, ShieldCheck } from "lucide-react";
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

function displayName(email) {
  const local = (email || "").split("@")[0] || "Account";
  return local.charAt(0).toUpperCase() + local.slice(1);
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
    setOpen(false);
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.email}`}
        className="inline-flex items-center gap-2 rounded-full border border-[#dfe3ec] bg-white py-[3px] pl-[3px] pr-2.5 text-[12.5px] font-semibold normal-case leading-5 text-[#173a52] shadow-[0_1px_2px_rgba(16,26,58,0.06)] transition-all duration-200 hover:border-[#f96706]/40 hover:shadow-[0_4px_12px_-6px_rgba(16,26,58,0.35)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f96706]/40"
      >
        <Avatar email={user.email} className="h-6 w-6 text-[11px]" />
        <span className="max-w-[9rem] truncate">{isAdmin ? "Admin" : displayName(user.email)}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-[#6b7280] transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-[70] mt-2 w-72 overflow-hidden rounded-2xl border border-[#e3e6ee] bg-white text-left normal-case shadow-[0_18px_44px_-14px_rgba(16,26,58,0.35)]"
        >
          <div className="flex items-center gap-3 border-b border-[#eef0f5] bg-gradient-to-br from-[#f6f8fc] to-white px-4 py-3.5">
            <Avatar email={user.email} className="h-11 w-11 text-lg" />
            <div className="min-w-0">
              <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#6b7280]">
                {isAdmin ? "Administrator" : "Signed in"}
              </p>
              <p className="truncate text-[14.5px] font-semibold text-[#101a3a]">{user.email}</p>
            </div>
          </div>
          <div className="p-1.5">
            {isAdmin && (
              <Link
                href="/admin"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onNavigate?.();
                }}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] font-medium text-[#1b2030] transition-colors hover:bg-[#fff4e8] hover:text-[#c24f05]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#f7941e] to-[#f96706] text-white">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                </span>
                <span>
                  Admin dashboard
                  <span className="block text-[12.5px] font-normal text-[#6b7280]">Manage site content</span>
                </span>
              </Link>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14.5px] font-medium text-[#1b2030] transition-colors hover:bg-[#f3f4f7]"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#eef0f5] text-[#173a52]">
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </span>
              Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
