import { motion } from "framer-motion";
import { ShieldCheck, UserCircle2, Mail, LogOut, CalendarClock } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

const AdminDashboard = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-28 md:pt-32 pb-16">
        <div className="container mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto max-w-5xl space-y-6"
          >
            <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wider text-primary font-semibold">Admin Panel</p>
                  <h1 className="mt-1 font-display text-3xl font-bold text-foreground">Welcome, {user?.name}</h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    You are signed in as an administrator. Use this panel for secure back-office access.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  <LogOut size={16} />
                  Logout
                </button>
              </div>
            </section>

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <article className="rounded-xl border border-border bg-card p-5">
                <div className="mb-3 inline-flex rounded-lg bg-primary/10 p-2 text-primary">
                  <ShieldCheck size={18} />
                </div>
                <h2 className="text-sm font-semibold text-foreground">Access Role</h2>
                <p className="mt-1 text-sm text-muted-foreground capitalize">{user?.role}</p>
              </article>

              <article className="rounded-xl border border-border bg-card p-5">
                <div className="mb-3 inline-flex rounded-lg bg-primary/10 p-2 text-primary">
                  <UserCircle2 size={18} />
                </div>
                <h2 className="text-sm font-semibold text-foreground">Account Name</h2>
                <p className="mt-1 text-sm text-muted-foreground">{user?.name}</p>
              </article>

              <article className="rounded-xl border border-border bg-card p-5">
                <div className="mb-3 inline-flex rounded-lg bg-primary/10 p-2 text-primary">
                  <Mail size={18} />
                </div>
                <h2 className="text-sm font-semibold text-foreground">Email</h2>
                <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
              </article>

              <article className="rounded-xl border border-border bg-card p-5 sm:col-span-2 lg:col-span-3">
                <div className="mb-3 inline-flex rounded-lg bg-primary/10 p-2 text-primary">
                  <CalendarClock size={18} />
                </div>
                <h2 className="text-sm font-semibold text-foreground">Created On</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {user?.createdAt ? new Date(user.createdAt).toLocaleString() : "-"}
                </p>
              </article>
            </section>
          </motion.div>
        </div>
      </main>
      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default AdminDashboard;
