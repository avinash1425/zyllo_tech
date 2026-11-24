import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CalendarCheck, CheckCheck, ChevronRight, ClipboardList, Clock, FolderKanban, KeyRound, Loader2, UserRound } from "lucide-react";
import PageHeader from "../PageHeader";
import { ADMIN_KINDS, announceInboxChanged, getAdminInbox, markAdminInboxRead } from "@/lib/api/admin/inbox";
import { timeAgo } from "@/lib/api/employee/notifications";
import { Alert, Badge, Chips, Empty, Panel } from "@/components/portal/PortalUI";
import { BTN_SECONDARY } from "@/components/portal/portalStyles";

/** Badge tone + icon per kind. */
const KIND_LOOK = {
  leave: { tone: "violet", icon: CalendarCheck },
  attendance: { tone: "green", icon: Clock },
  report: { tone: "amber", icon: ClipboardList },
  project: { tone: "sky", icon: FolderKanban },
  profile: { tone: "blue", icon: UserRound },
  account: { tone: "teal", icon: KeyRound },
};
const ICON_TILE = {
  violet: "bg-violet-50 text-violet-600 ring-violet-600/15",
  green: "bg-emerald-50 text-emerald-600 ring-emerald-600/15",
  amber: "bg-amber-50 text-amber-600 ring-amber-600/20",
  sky: "bg-sky-50 text-sky-600 ring-sky-600/15",
  blue: "bg-[#eef2fb] text-[#1f4693] ring-[#1f4693]/15",
  teal: "bg-teal-50 text-teal-600 ring-teal-600/15",
};

/**
 * Admin notifications inbox (migration 256): what employees did in the Employee Portal —
 * leave, attendance, daily reports, projects, profile & documents, first sign-ins.
 * Clicking a notification marks it read and opens the related admin page.
 */
export default function AdminNotificationsPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () =>
      getAdminInbox(filter)
        .then((d) => {
          if (!active) return;
          setData(d);
          setError("");
        })
        .catch(() => active && setError("Could not load notifications. Please refresh the page."));
    load();
    const t = setInterval(load, 60_000); // new events show up without a refresh
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [filter, reload]);

  const counts = data?.counts ?? {};
  const filters = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread", count: data?.unread || undefined },
    ...Object.entries(ADMIN_KINDS).map(([key, k]) => ({ key, label: k.label, count: counts[key] || undefined })),
  ];

  async function open(n) {
    if (!n.read) {
      try {
        await markAdminInboxRead([n.id]);
        announceInboxChanged();
      } catch {
        /* opening still works */
      }
    }
    if (n.link) navigate(n.link);
    else setReload((x) => x + 1);
  }

  async function markAll() {
    setBusy(true);
    try {
      await markAdminInboxRead(null);
      announceInboxChanged();
      setReload((x) => x + 1);
    } catch {
      setError("Could not mark the notifications as read. Please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Notifications"
        icon={Bell}
        subtitle="Everything employees do in the Employee Portal: leave, attendance, daily reports, projects, profile changes, documents and first sign-ins."
        actions={
          <button type="button" disabled={busy || !data?.unread} onClick={markAll} className={BTN_SECONDARY}>
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            {busy ? "Saving…" : "Mark all as read"}
          </button>
        }
      />
      <Panel
        flush
        icon={Bell}
        title={data ? (data.unread ? `${data.unread} unread` : "All caught up") : "Notifications"}
        subtitle="Click a notification to open it. New ones appear automatically."
      >
        <div className="border-b border-[#eef1f7] bg-[#fafbff] px-5 py-3">
          <Chips
            items={filters}
            value={filter}
            onChange={(k) => {
              setData(null);
              setFilter(k);
            }}
            label="Filter notifications"
          />
        </div>
        {error ? (
          <div className="p-5">
            <Alert kind="err">{error}</Alert>
          </div>
        ) : !data ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-[#676b7a]" role="status">
            <Loader2 className="h-4 w-4 animate-spin text-[#1f4693]" aria-hidden="true" />
            Loading…
          </p>
        ) : data.items.length === 0 ? (
          <Empty
            icon={Bell}
            title={filter === "unread" ? "No unread notifications" : "No notifications yet"}
            message="When employees apply for leave, submit reports, update their profile or sign in for the first time, it shows up here."
          />
        ) : (
          <ul className="divide-y divide-[#eef1f7]">
            {data.items.map((n) => {
              const look = KIND_LOOK[n.kind] ?? KIND_LOOK.profile;
              const Icon = look.icon;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className={`group flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-[#f5f8ff] ${
                      n.read ? "" : "bg-[#fffaf3]"
                    }`}
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${ICON_TILE[look.tone]}`}>
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-[#f96706]" aria-label="Unread" />}
                        <span className={`text-sm ${n.read ? "font-medium text-[#2b303b]" : "font-bold text-[#101a3a]"}`}>{n.title}</span>
                        <Badge tone={look.tone}>{ADMIN_KINDS[n.kind]?.label ?? n.kind}</Badge>
                        {n.priority === "urgent" && <Badge tone="red">Urgent</Badge>}
                      </span>
                      {n.body && <span className="mt-1 block break-words text-xs leading-relaxed text-[#676b7a]">{n.body}</span>}
                      <span className="mt-1 block text-[11px] text-[#9aa0ad]">
                        {timeAgo(n.created_at)}
                        {n.employee && ` · ${n.employee.full_name} (${n.employee.employee_code})`}
                      </span>
                    </span>
                    {n.link && (
                      <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-[#c4cad6] transition-colors group-hover:text-[#1f4693]" aria-hidden="true" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
