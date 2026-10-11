import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { LogOut, Briefcase, MessageSquare, LayoutDashboard, ShieldCheck } from "lucide-react";
import Link from "@/lib/nx/link";
import Seo from "@/components/Seo";
import PageLoader from "@/components/PageLoader";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase/client";

// Signed-in visitor's account page. Admins get a shortcut to /admin.
export default function Dashboard() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.rpc("is_admin").then(({ data }) => setIsAdmin(data === true));
  }, [user]);

  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login?next=/dashboard" replace />;

  const name = user.user_metadata?.full_name || user.email;
  const cards = [
    { href: "/careers", icon: Briefcase, title: "Open positions", text: "Browse roles and apply with your resume." },
    { href: "/contact", icon: MessageSquare, title: "Start a project", text: "Tell us what you want to build." },
    { href: "/services", icon: LayoutDashboard, title: "Our services", text: "Explore what Zyllo Tech delivers." },
  ];

  return (
    <>
      <Seo title="My dashboard" path="/dashboard" noindex />
      <section className="bg-[#f6f7fb] px-6 pb-20 pt-32">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.15em] text-[#f7941e]">Dashboard</p>
              <h1 className="mt-1 text-3xl font-bold text-[#2b303b]">Welcome, {name}</h1>
              <p className="mt-1 text-sm text-[#676b7a]">Signed in as {user.email}</p>
            </div>
            <div className="flex gap-2">
              {isAdmin && (
                <Link href="/admin" className="inline-flex items-center gap-2 rounded-lg bg-[#1f4693] px-4 py-2 text-sm font-semibold text-white">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Admin panel
                </Link>
              )}
              <button
                type="button"
                onClick={async () => { await signOut(); navigate("/", { replace: true }); }}
                className="inline-flex items-center gap-2 rounded-lg border border-[#e7e9ee] bg-white px-4 py-2 text-sm font-semibold text-[#2b303b]"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
              </button>
            </div>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            {cards.map(({ href, icon: Icon, title, text }) => (
              <Link key={href} href={href} className="rounded-2xl border border-[#e7e9ee] bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-lg">
                <Icon className="h-6 w-6 text-[#f7941e]" aria-hidden="true" />
                <h2 className="mt-3 text-lg font-semibold text-[#2b303b]">{title}</h2>
                <p className="mt-1 text-sm text-[#676b7a]">{text}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
