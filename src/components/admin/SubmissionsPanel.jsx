import { useEffect, useState } from "react";
import { FileDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function SubmissionsPanel() {
  const [contacts, setContacts] = useState([]);
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [contactRes, applicationRes] = await Promise.all([
        supabase
          .from("contact_submissions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(25),
        supabase
          .from("job_applications")
          .select("*, job_postings(title)")
          .order("created_at", { ascending: false })
          .limit(25),
      ]);
      if (contactRes.error) toast.error(contactRes.error.message);
      if (applicationRes.error) toast.error(applicationRes.error.message);
      setContacts(contactRes.data ?? []);
      setApplications(applicationRes.data ?? []);
      setLoading(false);
    };
    load();
  }, []);

  const openResume = async (path) => {
    const { data, error } = await supabase.storage.from("resumes").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      toast.error("Could not open resume.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading submissions…</p>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-display text-xl font-bold text-foreground">Contact enquiries</h2>
        <div className="mt-4 space-y-3">
          {contacts.length === 0 && (
            <p className="text-sm text-muted-foreground">No enquiries yet.</p>
          )}
          {contacts.map((row) => (
            <article key={row.id} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">
                  {row.full_name || row.name || "Unknown"}
                  {row.company ? ` · ${row.company}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(row.created_at).toLocaleString()}
                </p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {row.email}
                {row.phone ? ` · ${row.phone}` : ""}
                {row.service ? ` · ${row.service}` : ""}
              </p>
              <p className="mt-2 whitespace-pre-line text-sm text-foreground/90">{row.message}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-display text-xl font-bold text-foreground">Job applications</h2>
        <div className="mt-4 space-y-3">
          {applications.length === 0 && (
            <p className="text-sm text-muted-foreground">No applications yet.</p>
          )}
          {applications.map((row) => (
            <article key={row.id} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">
                  {row.full_name} · {row.job_postings?.title || "Role removed"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(row.created_at).toLocaleString()}
                </p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {row.email}
                {row.phone ? ` · ${row.phone}` : ""}
                {row.experience_years != null ? ` · ${row.experience_years} yrs` : ""}
                {` · ${row.status}`}
              </p>
              {row.cover_note && (
                <p className="mt-2 whitespace-pre-line text-sm text-foreground/90">{row.cover_note}</p>
              )}
              {row.resume_url && (
                <button
                  type="button"
                  onClick={() => openResume(row.resume_url)}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  <FileDown size={14} /> Open resume
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
