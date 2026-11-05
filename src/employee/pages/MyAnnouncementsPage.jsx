// Employee: live announcements addressed to me, unread highlighted. Opening an
// announcement marks it read (hr_mark_announcement_read); announcements that
// require it can be acknowledged (hr_acknowledge_announcement). Deep links
// from notifications use ?id=<announcement id>.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Megaphone } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDateTime, useHrQuery } from "@/lib/hr/client";
import { CATEGORY_TONE, acknowledgeAnnouncement, label as lbl, listMyAnnouncements, markAnnouncementRead } from "@/lib/hr/announcements";
import { Badge, Button, EmptyState, ErrorState, InlineError, Loading, Modal, PageHeader, Tabs, useToast } from "@/hr/ui";

export default function MyAnnouncementsPage() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const q = useHrQuery(() => listMyAnnouncements(me), [me]);
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState(null);
  const deepLinked = useRef(false);

  // Open the announcement referenced by ?id= once the list has loaded.
  const linkId = params.get("id");
  useEffect(() => {
    if (!linkId || deepLinked.current || !q.data) return;
    deepLinked.current = true;
    if (q.data.some((a) => a.id === linkId)) setOpenId(linkId);
  }, [linkId, q.data]);

  const counts = useMemo(() => ({
    unread: (q.data ?? []).filter((a) => !a.read_at).length,
    ack: (q.data ?? []).filter((a) => a.requires_acknowledgement && !a.acknowledged_at).length,
  }), [q.data]);
  const rows = (q.data ?? []).filter((a) => filter === "all" || (filter === "unread" ? !a.read_at : a.requires_acknowledgement && !a.acknowledged_at));
  const selected = (q.data ?? []).find((a) => a.id === openId);
  const patch = (id, fields) => q.setData((list) => (list ?? []).map((a) => (a.id === id ? { ...a, ...fields } : a)));
  function close() {
    setOpenId(null);
    if (params.has("id")) { params.delete("id"); setParams(params, { replace: true }); }
  }

  return (
    <>
      <PageHeader title="Announcements" description="Company news and policies addressed to you." />
      <Tabs value={filter} onChange={setFilter} label="Filter announcements" tabs={[
        { value: "all", label: "All", count: q.data?.length },
        { value: "unread", label: "Unread", count: counts.unread },
        { value: "ack", label: "Needs acknowledgement", count: counts.ack },
      ]} />
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !rows.length ? (
        <EmptyState icon={Megaphone} title={filter === "all" ? "No announcements" : filter === "unread" ? "You're all caught up" : "Nothing to acknowledge"} />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((a) => {
            const unread = !a.read_at;
            const needsAck = a.requires_acknowledgement && !a.acknowledged_at;
            return (
              <li key={a.id}>
                <button type="button" onClick={() => setOpenId(a.id)}
                  className={`w-full rounded-2xl border bg-white p-4 text-left shadow-[0_1px_2px_rgba(16,26,58,0.04)] transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693] ${unread ? "border-[#f96706]/50 bg-orange-50/40" : "border-slate-200"}`}>
                  <span className="flex flex-wrap items-center gap-2">
                    {unread && <span className="inline-flex items-center gap-1 text-xs font-bold text-[#f96706]"><span className="h-2 w-2 rounded-full bg-[#f96706]" aria-hidden="true" />New</span>}
                    <Badge tone={CATEGORY_TONE[a.category]}>{lbl(a.category)}</Badge>
                    {needsAck && <Badge tone="orange">acknowledgement required</Badge>}
                    {a.acknowledged_at && <Badge tone="green">acknowledged</Badge>}
                    <span className="ml-auto text-xs text-slate-500">{formatDateTime(a.published_at ?? a.publish_at)}</span>
                  </span>
                  <span className={`mt-2 block text-base ${unread ? "font-extrabold" : "font-semibold"} text-[#101a3a]`}>{a.title}</span>
                  <span className="mt-1 line-clamp-2 block text-sm text-slate-600">{a.body}</span>
                  <span className="sr-only">{unread ? "Unread." : "Read."}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {selected && <AnnouncementModal announcement={selected} onClose={close} onPatch={(fields) => patch(selected.id, fields)} />}
    </>
  );
}

function AnnouncementModal({ announcement: a, onClose, onPatch }) {
  const { notify } = useToast();
  const [readError, setReadError] = useState(null);
  const [ackError, setAckError] = useState(null);
  const [acking, setAcking] = useState(false);
  const marked = useRef(false);

  useEffect(() => {
    if (a.read_at || marked.current) return;
    marked.current = true;
    markAnnouncementRead(a.id).then((res) => {
      if (res.error) setReadError(`Could not mark as read: ${res.error}`);
      else onPatch({ read_at: new Date().toISOString() });   // display only; the server stored its own timestamp
    });
  }, [a.id, a.read_at, onPatch]);

  async function acknowledge() {
    setAcking(true); setAckError(null);
    const res = await acknowledgeAnnouncement(a.id);
    setAcking(false);
    if (res.error) { setAckError(res.error); return; }
    onPatch({ acknowledged_at: res.data, read_at: a.read_at ?? res.data });
    notify("Announcement acknowledged.");
  }

  const needsAck = a.requires_acknowledgement && !a.acknowledged_at;
  return (
    <Modal open onClose={onClose} title={a.title} size="lg"
      footer={<>
        {needsAck && <Button loading={acking} onClick={acknowledge}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />I have read and acknowledge this</Button>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </>}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge tone={CATEGORY_TONE[a.category]}>{lbl(a.category)}</Badge>
        <span>Published {formatDateTime(a.published_at ?? a.publish_at)}</span>
        {a.expires_at && <span>· visible until {formatDateTime(a.expires_at)}</span>}
      </div>
      <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{a.body}</div>
      {a.acknowledged_at && <p className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />You acknowledged this on {formatDateTime(a.acknowledged_at)}.</p>}
      {needsAck && <p className="mt-4 text-sm font-medium text-amber-800">HR has asked everyone in the audience to acknowledge this announcement.</p>}
      <div className="mt-3 flex flex-col gap-2"><InlineError message={readError} /><InlineError message={ackError} /></div>
    </Modal>
  );
}
