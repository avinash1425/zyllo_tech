import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, Inbox, PenSquare, Send } from "lucide-react";
import { KINDS, getMyNotifications, getSentMessages, markRead, timeAgo } from "@/lib/api/employee/notifications";
import { CARD } from "../projectsUi";
import MessageComposer from "../MessageComposer";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  ...Object.entries(KINDS).map(([key, k]) => ({ key, label: k.label })),
];

const TABS = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "compose", label: "Send message", icon: PenSquare },
  { key: "sent", label: "Sent", icon: Send },
];

function KindChip({ kind }) {
  const k = KINDS[kind];
  if (!k) return null;
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${k.chip}`}>{k.label}</span>;
}

function InboxList({ onChanged }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    getMyNotifications(filter)
      .then((d) => {
        if (!active) return;
        setData(d);
        setError("");
      })
      .catch(() => active && setError("Could not load notifications. Please refresh the page."));
    return () => {
      active = false;
    };
  }, [filter, reload]);

  async function open(n) {
    if (!n.read_at) {
      await markRead([n.id]).catch(() => {});
      onChanged?.();
    }
    if (n.link) navigate(n.link);
    else setReload((r) => r + 1);
  }

  async function markAll() {
    await markRead(null).catch(() => {});
    onChanged?.();
    setReload((r) => r + 1);
  }

  return (
    <section className={CARD}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-1 flex-wrap gap-1.5" role="radiogroup" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                filter === f.key ? "border-[#1f4693] bg-[#1f4693] text-white" : "border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]"
              }`}
            >
              {f.label}
              {f.key === "unread" && data?.unread ? ` (${data.unread})` : ""}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={markAll}
          disabled={!data?.unread}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#dce1ec] bg-white px-3 py-1.5 text-xs font-semibold text-[#2b303b] hover:bg-[#f6f7fb] disabled:opacity-50"
        >
          <CheckCheck size={14} aria-hidden="true" /> Mark all as read
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="py-6 text-center text-sm text-[#676b7a]">Loading…</p>}
      {data && data.items.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-[#676b7a]">
          <Bell className="h-8 w-8 text-[#c5cbd8]" aria-hidden="true" />
          {filter === "unread" ? "You're all caught up." : "No notifications yet."}
        </div>
      )}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-[#f0f2f6]">
          {data.items.map((n) => {
            const unread = !n.read_at;
            const urgent = n.priority === "urgent";
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className={`flex w-full gap-3 rounded-lg px-2 py-3 text-left hover:bg-[#f6f7fb] ${unread ? "bg-[#f7f9ff]" : ""}`}
                >
                  <span
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${unread ? (urgent ? "bg-red-500" : "bg-[#1f4693]") : "bg-transparent"}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <KindChip kind={n.kind} />
                      {urgent && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">Urgent</span>}
                      {unread && <span className="sr-only">Unread.</span>}
                      <span className="ml-auto text-[11px] text-[#9aa0ad]">{timeAgo(n.created_at)}</span>
                    </span>
                    <span className={`mt-1 block text-sm ${unread ? "font-bold text-[#101a3a]" : "font-medium text-[#2b303b]"}`}>{n.title}</span>
                    {n.body && <span className="mt-0.5 block whitespace-pre-line break-words text-sm text-[#676b7a]">{n.body}</span>}
                    {n.sender_label && <span className="mt-1 block text-xs text-[#9aa0ad]">From {n.sender_label}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function SentList() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    getSentMessages()
      .then(setItems)
      .catch(() => setError("Could not load sent messages."));
  }, []);
  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!items) return <p className="text-sm text-[#676b7a]">Loading…</p>;
  if (items.length === 0) return <p className="py-6 text-center text-sm text-[#676b7a]">You have not sent any messages in the last 90 days.</p>;
  return (
    <ul className="divide-y divide-[#f0f2f6]">
      {items.map((s) => (
        <li key={s.message_id} className="py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {s.priority === "urgent" && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">Urgent</span>}
            <span className="text-sm font-bold text-[#101a3a]">{s.title}</span>
            <span className="ml-auto text-[11px] text-[#9aa0ad]">{timeAgo(s.created_at)}</span>
          </div>
          {s.body && <p className="mt-0.5 whitespace-pre-line break-words text-sm text-[#676b7a]">{s.body}</p>}
          <p className="mt-1 text-xs text-[#9aa0ad]">
            To {s.to.join(", ")}
            {s.recipients > s.to.length ? ` and ${s.recipients - s.to.length} more` : ""} · Read by {s.read} of {s.recipients}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function NotificationsPage({ onChanged }) {
  const [tab, setTab] = useState("inbox");
  const [sentKey, setSentKey] = useState(0);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold ${
              tab === t.key ? "bg-[#1f4693] text-white" : "border border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]"
            }`}
          >
            <t.icon size={16} aria-hidden="true" /> {t.label}
          </button>
        ))}
      </div>
      {tab === "inbox" && <InboxList onChanged={onChanged} />}
      {tab === "compose" && (
        <section className={CARD}>
          <h2 className="mb-4 text-base font-bold text-[#101a3a]">Send a message</h2>
          <MessageComposer onSent={() => setSentKey((k) => k + 1)} />
        </section>
      )}
      {tab === "sent" && (
        <section className={CARD}>
          <h2 className="mb-2 text-base font-bold text-[#101a3a]">Messages you sent</h2>
          <SentList key={sentKey} />
        </section>
      )}
    </div>
  );
}
