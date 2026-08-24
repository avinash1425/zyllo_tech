import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, LogOut, Inbox, FileText, Newspaper, Briefcase } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import ResourceManager from "@/components/admin/ResourceManager";
import SubmissionsPanel from "@/components/admin/SubmissionsPanel";

const TABS = ["Overview", "Blog", "Portfolio", "Jobs", "Submissions"] as const;
type Tab = (typeof TABS)[number];

const blogFields = [
  { name: "title", label: "Title", placeholder: "How we ship AI features" },
  { name: "slug", label: "Slug", placeholder: "how-we-ship-ai-features" },
  { name: "category", label: "Category", defaultValue: "Engineering" },
  { name: "author", label: "Author", defaultValue: "Zyllo Engineering Team" },
  { name: "featured_image_url", label: "Featured image URL", nullable: true },
  {
    name: "status",
    label: "Status",
    type: "select" as const,
    options: ["draft", "published"],
    defaultValue: "draft",
  },
  { name: "excerpt", label: "Excerpt", type: "textarea" as const, rows: 2 },
  { name: "content", label: "Content (markdown)", type: "textarea" as const, rows: 10 },
];

const portfolioFields = [
  { name: "title", label: "Project title" },
  { name: "tag", label: "Tag", defaultValue: "Web" },
  { name: "image_url", label: "Image URL", nullable: true },
  {
    name: "status",
    label: "Status",
    type: "select" as const,
    options: ["draft", "published"],
    defaultValue: "draft",
  },
  { name: "description", label: "Description", type: "textarea" as const, rows: 3 },
  { name: "challenge", label: "Challenge", type: "textarea" as const, rows: 3, nullable: true },
  { name: "solution", label: "Solution", type: "textarea" as const, rows: 3, nullable: true },
  { name: "result", label: "Result", type: "textarea" as const, rows: 3, nullable: true },
];

const jobFields = [
  { name: "title", label: "Role title" },
  { name: "department", label: "Department", defaultValue: "Engineering" },
  { name: "location", label: "Location", defaultValue: "Remote / India" },
  { name: "employment_type", label: "Employment type", defaultValue: "Full-time" },
  { name: "total_openings", label: "Total openings", type: "number" as const, defaultValue: 1 },
  {
    name: "status",
    label: "Status",
    type: "select" as const,
    options: ["open", "closed"],
    defaultValue: "open",
  },
  { name: "description", label: "Description", type: "textarea" as const, rows: 8 },
];

const AdminDashboard = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("Overview");
  const [stats, setStats] = useState({ contacts: 0, applications: 0, subscribers: 0, jobs: 0 });

  useEffect(() => {
    const fetchStats = async () => {
      const [contacts, applications, subscribers, jobs] = await Promise.all([
        supabase.from("contact_submissions").select("id", { count: "exact", head: true }),
        supabase.from("job_applications").select("id", { count: "exact", head: true }),
        supabase.from("newsletter_subscribers").select("id", { count: "exact", head: true }),
        supabase.from("job_postings").select("id", { count: "exact", head: true }),
      ]);
      setStats({
        contacts: contacts.count || 0,
        applications: applications.count || 0,
        subscribers: subscribers.count || 0,
        jobs: jobs.count || 0,
      });
    };
    fetchStats();
  }, []);

  const handleLogout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="py-10 md:py-14">
        <div className="container mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto max-w-5xl space-y-6"
          >
            <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Admin panel
                  </p>
                  <h1 className="mt-1 font-display text-3xl font-bold text-foreground">
                    Welcome, {user?.name}
                  </h1>
                  <p className="mt-2 inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <ShieldCheck size={15} className="text-primary" />
                    {user?.email} · {user?.role}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => navigate("/")}
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    View site
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <LogOut size={16} /> Logout
                  </button>
                </div>
              </div>
            </section>

            <nav className="flex flex-wrap gap-2">
              {TABS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTab(item)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    tab === item
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-foreground hover:bg-muted"
                  }`}
                >
                  {item}
                </button>
              ))}
            </nav>

            {tab === "Overview" && (
              <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "Contact enquiries", value: stats.contacts, icon: Inbox },
                  { label: "Job applications", value: stats.applications, icon: FileText },
                  { label: "Newsletter subscribers", value: stats.subscribers, icon: Newspaper },
                  { label: "Job postings", value: stats.jobs, icon: Briefcase },
                ].map(({ label, value, icon: Icon }) => (
                  <article key={label} className="rounded-xl border border-border bg-card p-5">
                    <div className="mb-3 inline-flex rounded-lg bg-primary/10 p-2 text-primary">
                      <Icon size={18} />
                    </div>
                    <h2 className="text-sm font-semibold text-foreground">{label}</h2>
                    <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
                  </article>
                ))}
              </section>
            )}

            {tab === "Blog" && (
              <ResourceManager
                table="blog_posts"
                title="Blog posts"
                description="Published posts appear on the blog immediately. Drafts stay hidden."
                listLabel="posts"
                fields={blogFields}
              />
            )}

            {tab === "Portfolio" && (
              <ResourceManager
                table="portfolio_projects"
                title="Portfolio projects"
                description="Published projects show on the portfolio and case study sections."
                listLabel="projects"
                fields={portfolioFields}
              />
            )}

            {tab === "Jobs" && (
              <ResourceManager
                table="job_postings"
                title="Job postings"
                description="Open roles are listed on the careers page and accept applications."
                listLabel="roles"
                fields={jobFields}
              />
            )}

            {tab === "Submissions" && <SubmissionsPanel />}
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;
