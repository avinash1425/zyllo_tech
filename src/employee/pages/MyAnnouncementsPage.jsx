// Employee Portal — Announcements & Policies (Module 13).
//   Announcements      — live announcements addressed to me; opening one marks
//                        it read; some need an acknowledgement.
//   Policies & handbook — published policies for my audience, handbook first.
//   Acknowledgements   — everything waiting for me: announcements, policies,
//                        the handbook and HR documents, plus my history.
// Notification links use /employee/announcements?id=<announcement>.
// RLS limits every query to what is addressed to me; nothing here grants access.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BellDot, BookOpen, CheckCircle2, Eye, Megaphone } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDateTime, useHrQuery } from "@/lib/hr/client";
import { acknowledgeAnnouncement, listMyAnnouncements, markAnnouncementRead } from "@/lib/hr/announcements";
import { listMyPolicies, myPendingAcknowledgements } from "@/lib/hr/documentCenter";
import { CategoryBadge } from "@/hr/pages/announcements/AnnouncementsTab";
import { AcknowledgementsSection, PoliciesSection } from "./MyDocumentsPage";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, KpiCard, Loading, Modal, PageHeader, Tabs, useToast } from "@/hr/ui";

const TAB_KEYS = ["announcements", "policies", "acknowledgements"];
const snippet = (s, n = 220) => (s && s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

export default function MyAnnouncementsPage() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const [params, setParams] = useSearchParams();
  const [tab, setTabState] = useState(() => (TAB_KEYS.includes(params.get("tab")) ? params.get("tab") : "announcements"));
  const setTab = (t) => { setTabState(t); setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); n.delete("id"); return n; }, { replace: true }); };

  const ann = useHrQuery(() => listMyAnnouncements(me), [me]);
  const pending = useHrQuery(() => (me ? myPendingAcknowledgements() : Promise.resolve({ data: [] })), [me]);
  const policies = useHrQuery(() => listMyPolicies(), []);

  if (!me) return <ErrorState message="Your account is not linked to an employee record." />;

  const list = ann.data ?? [];
  const unread = list.filter((a) => !a.read_at).length;
  const annToAck = list.filter((a) => a.requires_acknowledgement && !a.acknowledged_at);
  const toAck = annToAck.length + (pending.data?.length ?? 0);
  const handbook = (policies.data ?? []).find((p) => p.category === "handbook");

  return (
    <>
      <PageHeader title="Announcements & Policies" description="Company announcements, HR notices, policies and the employee handbook." />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Unread announcements" value={unread} icon={BellDot} tone={unread ? "orange" : "green"} loading={ann.loading && !ann.data} onClick={() => setTab("announcements")} />
        <KpiCard label="To acknowledge" value={toAck} hint={toAck ? "Read and acknowledge" : "All caught up"} icon={CheckCircle2} tone={toAck ? "red" : "green"} loading={(ann.loading && !ann.data) || (pending.loading && !pending.data)} onClick={() => setTab("acknowledgements")} />
        <KpiCard label="Policies" value={policies.data?.length} hint={handbook ? `Handbook v${handbook.current_version}` : "Company policies for you"} icon={BookOpen} tone="navy" loading={policies.loading && !policies.data} onClick={() => setTab("policies")} />
      </div>
      <Tabs value={tab} onChange={setTab} label="Announcements and policies sections" tabs={[
        { value: "announcements", label: "Announcements", count: unread || undefined },
        { value: "policies", label: "Policies & handbook" },
        { value: "acknowledgements", label: "Acknowledgements", count: toAck || undefined },
      ]} />
      {tab === "announcements" && <AnnouncementFeed query={ann} openId={params.get("id")} />}
      {tab === "policies" && <PoliciesSection pending={pending} />}
      {tab === "acknowledgements" && (
        <div className="flex flex-col gap-4">
          <AnnouncementAckCard items={annToAck} onChanged={ann.reload} />
          <AcknowledgementsSection pending={pending} onChanged={() => { pending.reload(); policies.reload(); }} goPolicies={() => setTab("policies")} />
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------- feed
function AnnouncementFeed({ query, openId }) {
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("all");
  const handled = useRef(null);
  const list = query.data ?? [];

  // Open the announcement a notification link points at, once per link
  // (reloads after marking it read must not reopen it).
  useEffect(() => {
    if (!openId || !query.data || handled.current === openId) return;
    handled.current = openId;
    const hit = query.data.find((a) => a.id === openId);
    if (hit) setOpen(hit);
  }, [openId, query.data]);

  const rows = useMemo(() => list.filter((a) => filter === "all" || (filter === "unread" && !a.read_at) || (filter === "ack" && a.requires_acknowledgement && !a.acknowledged_at)), [list, filter]);

  if (query.loading && !query.data) return <Loading />;
  if (query.error) return <ErrorState message={query.error} onRetry={query.reload} />;
  if (!list.length) return <Card><EmptyState icon={Megaphone} title="No announcements" description="Company news and HR notices for you will appear here." /></Card>;
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter announcements">
        {[["all", "All"], ["unread", "Unread"], ["ack", "Needs acknowledgement"]].map(([v, l]) => (
          <button key={v} type="button" onClick={() => setFilter(v)} aria-pressed={filter === v}
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${filter === v ? "bg-[#101a3a] text-white ring-[#101a3a]" : "bg-white text-[#173a52] ring-slate-200 hover:bg-slate-50"}`}>{l}</button>
        ))}
      </div>
      {!rows.length ? <Card><EmptyState icon={CheckCircle2} title="Nothing here" description="No announcements match this filter." /></Card> : (
        <ul className="flex flex-col gap-3">
          {rows.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => setOpen(a)}
                className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-[#f7941e]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693] ${a.category === "urgent" ? "border-rose-200" : "border-slate-100"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {!a.read_at && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#f96706]" aria-label="Unread" />}
                    <span className={`truncate text-[#101a3a] ${a.read_at ? "font-semibold" : "font-extrabold"}`}>{a.title}</span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    <CategoryBadge category={a.category} />
                    {a.requires_acknowledgement && (a.acknowledged_at ? <Badge tone="green">acknowledged</Badge> : <Badge tone="amber">acknowledgement needed</Badge>)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{formatDateTime(a.published_at)}{a.expires_at ? ` · until ${formatDateTime(a.expires_at)}` : ""}</p>
                <p className="mt-2 whitespace-pre-line break-words text-sm text-slate-700">{snippet(a.body)}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <AnnouncementModal announcement={open} onClose={() => setOpen(null)} onChanged={query.reload} />}
    </>
  );
}

function AnnouncementModal({ announcement, onClose, onChanged }) {
  const { notify } = useToast();
  const a = announcement;
  const [busy, setBusy] = useState(false);
  const [acked, setAcked] = useState(Boolean(a.acknowledged_at));

  // Opening an announcement records that I read it.
  useEffect(() => {
    if (a.read_at) return;
    markAnnouncementRead(a.id).then((res) => { if (!res.error) onChanged(); });
  }, [a.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function ack() {
    setBusy(true);
    const res = await acknowledgeAnnouncement(a.id);
    setBusy(false);
    if (res.error) { notify(res.error, "error"); return; }
    setAcked(true);
    notify("Acknowledged. Thank you.");
    onChanged();
  }
  return (
    <Modal open onClose={onClose} title={a.title} size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {a.requires_acknowledgement && !acked && <Button variant="success" loading={busy} onClick={ack}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />I have read and acknowledge this</Button>}
      </>}>
      <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500"><CategoryBadge category={a.category} />{formatDateTime(a.published_at)}{a.requires_acknowledgement && acked && <Badge tone="green">acknowledged</Badge>}</p>
      <div className="whitespace-pre-wrap break-words text-sm text-slate-800">{a.body}</div>
      {a.requires_acknowledgement && !acked && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">HR has asked everyone to acknowledge this announcement. Acknowledging records that you received and read it; it is not a signature.</p>}
    </Modal>
  );
}

function AnnouncementAckCard({ items, onChanged }) {
  const { notify } = useToast();
  const [open, setOpen] = useState(null);
  const [confirm, setConfirm] = useState(null);
  return (
    <Card title="Announcements to acknowledge" actions={items.length > 0 && <Badge tone="amber">{items.length}</Badge>}>
      {!items.length ? <EmptyState icon={CheckCircle2} title="All caught up" description="No announcement is waiting for your acknowledgement." /> : (
        <ul className="flex flex-col gap-2">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
              <span className="min-w-0"><span className="font-semibold text-[#101a3a]">{a.title}</span> <CategoryBadge category={a.category} /><span className="block text-xs text-slate-500">Published {formatDateTime(a.published_at)}</span></span>
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setOpen(a)}><Eye className="h-4 w-4" aria-hidden="true" />Read</Button>
                <Button size="sm" onClick={() => setConfirm(a)}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Acknowledge</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && <AnnouncementModal announcement={open} onClose={() => setOpen(null)} onChanged={onChanged} />}
      <ConfirmDialog open={Boolean(confirm)} onClose={() => setConfirm(null)} title="Acknowledge announcement" confirmLabel="I acknowledge" tone="success"
        message={confirm ? `I confirm that I have received and read "${confirm.title}". This records receipt; it is not a digital signature.` : ""}
        onConfirm={async () => { const res = await acknowledgeAnnouncement(confirm.id); if (!res.error) { notify("Acknowledged. Thank you."); onChanged(); } return res; }} />
    </Card>
  );
}
