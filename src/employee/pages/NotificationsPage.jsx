// Notifications (database-backed, recipient-only via RLS).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCheck } from "lucide-react";
import { formatDateTime, from, run, useHrQuery } from "@/lib/hr/client";
import { Badge, Button, EmptyState, ErrorState, Loading, PageHeader, Tabs, useToast } from "@/hr/ui";

export default function NotificationsPage() {
  const [tab, setTab] = useState("unread");
  const navigate = useNavigate();
  const { notify } = useToast();
  const q = useHrQuery(() => {
    let x = from("hr_notifications").select("id, type, title, body, link, created_at, read_at").order("created_at", { ascending: false }).limit(200);
    if (tab === "unread") x = x.is("read_at", null);
    return run(x);
  }, [tab]);

  async function markRead(ids) {
    if (!ids.length) return;
    const res = await run(from("hr_notifications").update({ read_at: new Date().toISOString() }).in("id", ids).is("read_at", null));
    if (res.error) notify(res.error, "error"); else q.reload();
  }
  async function open(n) {
    if (!n.read_at) await markRead([n.id]);
    if (n.link) navigate(n.link);
  }

  return (
    <>
      <PageHeader title="Notifications" actions={<Button variant="secondary" onClick={() => markRead((q.data ?? []).filter((n) => !n.read_at).map((n) => n.id))} disabled={!(q.data ?? []).some((n) => !n.read_at)}><CheckCheck className="h-4 w-4" aria-hidden="true" />Mark all read</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "unread", label: "Unread" }, { value: "all", label: "All" }]} />
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !q.data?.length ? (
        <EmptyState title={tab === "unread" ? "You're all caught up" : "No notifications yet"} />
      ) : (
        <ul className="flex flex-col gap-2">
          {q.data.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => open(n)} className={`flex w-full flex-col gap-1 rounded-2xl border px-4 py-3 text-left transition hover:shadow-sm ${n.read_at ? "border-slate-200 bg-white" : "border-orange-200 bg-orange-50/50"}`}>
                <span className="flex flex-wrap items-center gap-2"><span className="font-bold text-[#101a3a]">{n.title}</span>{!n.read_at && <Badge tone="orange">new</Badge>}<span className="ml-auto text-xs text-slate-500">{formatDateTime(n.created_at)}</span></span>
                {n.body && <span className="text-sm text-slate-600">{n.body}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
