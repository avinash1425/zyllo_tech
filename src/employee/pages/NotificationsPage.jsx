import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  BellRing,
  CalendarCheck,
  CheckCheck,
  ClipboardList,
  Clock,
  FolderKanban,
  Inbox,
  Loader2,
  Mail,
  PenSquare,
  Send,
} from "lucide-react";
import { KINDS, getMyNotifications, getSentMessages, markRead, timeAgo } from "@/lib/api/employee/notifications";
import { Alert, Badge, Chips, Empty, Panel, Tabs } from "@/components/portal/PortalUI";
import { BTN_SECONDARY } from "@/components/portal/portalStyles";
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

/** Badge tone + icon per notification kind. */
const KIND_LOOK = {
  project: { tone: "sky", icon: FolderKanban },
  leave: { tone: "violet", icon: CalendarCheck },
  attendance: { tone: "green", icon: Clock },
  report: { tone: "amber", icon: ClipboardList },
  message: { tone: "blue", icon: Mail },
};
const ICON_TILE = {
  sky: "bg-sky-50 text-sky-600 ring-sky-600/15",
  violet: "bg-violet-50 text-violet-600 ring-violet-600/15",
  green: "bg-emerald-50 text-emerald-600 ring-emerald-600/15",
  amber: "bg-amber-50 text-amber-600 ring-amber-600/20",
  blue: "bg-[#eef2fb] text-[#1f4693] ring-[#1f4693]/15",
  red: "bg-red-50 text-red-600 ring-red-600/15",
};

function KindChip({ kind }) {
  const k = KINDS[kind];
  if (!k) return null;
  const look = KIND_LOOK[kind];
  if (!look) return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${k.chip}`}>{k.label}</span>;
  return <Badge tone={look.tone}>{k.label}</Badge>;
}

function Loading() {
  return (
    <p className="flex items-center justify-center gap-2 py-8 text-sm text-[#676b7a]">
      <Loader2 className="h-4 w-4 animate-spin text-[#1f4693]" aria-hidden="true" />
      Loading…
    </p>
  );
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
    <Panel
      icon={Bell}
      title="Inbox"
      subtitle={data ? (data.unread ? `${data.unread} unread` : "No unread notifications") : undefined}
      action={
        <button type="button" onClick={markAll} disabled={!data?.unread} className={`${BTN_SECONDARY} !px-3 !py-1.5 !text-xs`}>
          <CheckCheck size={14} aria-hidden="true" /> Mark all as read
        </button>
      }
      flush
    >
      <div className="border-b border-[#eef1f7] px-5 py-3">
        <Chips
          label="Show"
          items={FILTERS.map((f) => ({ ...f, count: f.key === "unread" && data?.unread ? data.unread : undefined }))}
          value={filter}
          onChange={setFilter}
        />
      </div>

      <div className="p-3 sm:p-4">
        <Alert kind="err" className="m-1">
          {error}
        </Alert>
        {!data && !error && <Loading />}
        {data && data.items.length === 0 && (
          <Empty icon={Bell} title={filter === "unread" ? "You're all caught up." : "No notifications yet."} />
        )}
        {data && data.items.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {data.items.map((n) => {
              const unread = !n.read_at;
              const urgent = n.priority === "urgent";
              const look = KIND_LOOK[n.kind];
              const Icon = urgent ? BellRing : look?.icon ?? Bell;
              const tile = ICON_TILE[urgent ? "red" : look?.tone ?? "blue"];
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className={`group relative flex w-full gap-3 rounded-xl border px-3 py-3 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1f4693] ${
                      unread
                        ? urgent
                          ? "border-red-200 bg-red-50/50 hover:bg-red-50"
                          : "border-[#dce6f7] bg-[#f7f9ff] hover:bg-[#eef4ff]"
                        : "border-transparent hover:border-[#eef1f7] hover:bg-[#f8fafd]"
                    }`}
                  >
                    {unread && (
                      <span
                        className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full ${urgent ? "bg-red-500" : "bg-[#1f4693]"}`}
                        aria-hidden="true"
                      />
                    )}
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${tile}`}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <KindChip kind={n.kind} />
                        {urgent && <Badge tone="red">Urgent</Badge>}
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
      </div>
    </Panel>
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
  if (error) return <Alert kind="err">{error}</Alert>;
  if (!items) return <Loading />;
  if (items.length === 0) return <Empty icon={Send} message="You have not sent any messages in the last 90 days." />;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((s) => {
        const allRead = s.recipients > 0 && s.read >= s.recipients;
        return (
          <li
            key={s.message_id}
            className="flex gap-3 rounded-xl border border-[#eef1f7] bg-[#fbfcfe] px-4 py-3 transition-colors hover:border-[#dce6f7] hover:bg-[#f8faff]"
          >
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${
                s.priority === "urgent" ? ICON_TILE.red : ICON_TILE.blue
              }`}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {s.priority === "urgent" && <Badge tone="red">Urgent</Badge>}
                <span className="text-sm font-bold text-[#101a3a]">{s.title}</span>
                <span className="ml-auto text-[11px] text-[#9aa0ad]">{timeAgo(s.created_at)}</span>
              </div>
              {s.body && <p className="mt-0.5 whitespace-pre-line break-words text-sm text-[#676b7a]">{s.body}</p>}
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#9aa0ad]">
                <span>
                  To {s.to.join(", ")}
                  {s.recipients > s.to.length ? ` and ${s.recipients - s.to.length} more` : ""}
                </span>
                <Badge tone={allRead ? "green" : "slate"}>
                  <CheckCheck className="h-3 w-3" aria-hidden="true" />
                  Read by {s.read} of {s.recipients}
                </Badge>
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function NotificationsPage({ onChanged }) {
  const [tab, setTab] = useState("inbox");
  const [sentKey, setSentKey] = useState(0);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <Tabs items={TABS} value={tab} onChange={setTab} label="Notifications" />
      {tab === "inbox" && <InboxList onChanged={onChanged} />}
      {tab === "compose" && (
        <Panel icon={PenSquare} title="Send a message" subtitle="Notify colleagues in the portal">
          <MessageComposer onSent={() => setSentKey((k) => k + 1)} />
        </Panel>
      )}
      {tab === "sent" && (
        <Panel icon={Send} title="Messages you sent" subtitle="Last 90 days">
          <SentList key={sentKey} />
        </Panel>
      )}
    </div>
  );
}
