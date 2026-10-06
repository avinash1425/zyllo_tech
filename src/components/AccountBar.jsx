// Signed-in state for the public header: "Admin" (admins only) + email + Logout.
// Signed out: the original "Login" pill. The session lives in supabase-js
// (localStorage), so navigating between /admin and the public site keeps you
// signed in; only the Logout button ends the session.
import { useEffect, useState } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
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

const itemClass =
  "inline-flex items-center gap-1.5 transition-colors duration-200 ease-out hover:text-[#f96706]";

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

  const initial = (user.email?.[0] ?? "U").toUpperCase();

  return (
    <div className={mobile ? "flex flex-wrap items-center gap-2 [&>*]:min-h-11" : "flex items-center gap-2"}>
      {isAdmin && (
        <Link
          href="/admin"
          onClick={onNavigate}
          className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#f96706] to-[#f7941e] px-3 py-[3px] text-[12px] font-semibold leading-5 text-white shadow-[0_1px_4px_rgba(249,103,6,0.35)] transition-all duration-200 hover:to-[#3089a6] hover:shadow-md hover:shadow-[#f96706]/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f96706]/50 max-sm:justify-center max-sm:px-4"
        >
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Admin
        </Link>
      )}
      <span
        title={user.email}
        className="inline-flex items-center gap-2 rounded-full border border-[#dfe3ec] bg-white py-[2px] pl-[3px] pr-3 text-[12px] font-medium normal-case leading-5 text-[#173a52] shadow-[0_1px_2px_rgba(16,26,58,0.06)]"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-[#f7941e] to-[#1f4693] text-[10px] font-bold text-white">
          {initial}
        </span>
        <span className="max-w-[14rem] truncate sm:max-w-[16rem]">{user.email}</span>
      </span>
      <button
        type="button"
        onClick={handleLogout}
        className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-[3px] text-[12px] font-semibold leading-5 text-[#4a5668] transition-colors duration-200 hover:border-[#f96706]/30 hover:bg-white hover:text-[#c24f05] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f96706]/40"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        Logout
      </button>
    </div>
  );
}
