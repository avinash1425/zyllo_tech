// Module 13 — Announcements & Policies (/hr/announcements).
//   Overview          — live / scheduled / draft counts, pending acknowledgements
//   Announcements     — company announcements and HR notices (108 + 191)
//   Policies          — versioned company policies (129), handbook excluded
//   Employee handbook — the handbook as a versioned, acknowledgeable policy
//   Acknowledgements  — mandatory acknowledgements: announcements + policies/documents
// Tabs follow permissions: announcements.manage / view_all for announcements,
// documents.manage / view for policies (same rules as the Documents module).
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, CalendarClock, CheckCircle2, FilePenLine, Megaphone, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDateTime, useHrQuery } from "@/lib/hr/client";
import { announcementProgress, isLive, listAnnouncements, processScheduledAnnouncements } from "@/lib/hr/announcements";
import { acknowledgementTracker } from "@/lib/hr/documentCenter";
import { useEmployeeOptions } from "@/lib/hr/org";
import { Badge, Button, Card, DataTable, EmptyState, KpiCard, PageHeader, Tabs } from "@/hr/ui";
import AnnouncementsTab, { CategoryBadge, ProgressCell, TrackingModal } from "./announcements/AnnouncementsTab";
import PoliciesTab from "./documents/PoliciesTab";
import AcknowledgementsTab from "./documents/AcknowledgementsTab";

const pendingAcks = (a, p) => (a.requires_acknowledgement && isLive(a) && p ? Math.max(0, Number(p.audience) - Number(p.acknowledged)) : 0);

export default function AnnouncementsPoliciesPage() {
  const { hasPermission } = useAuth();
  const canManageAnn = hasPermission("announcements.manage");
  const canAnn = canManageAnn || hasPermission("announcements.view_all");
  const canManagePol = hasPermission("documents.manage");
  const canPol = canManagePol || hasPermission("documents.view");

  const tabs = [
    { value: "overview", label: "Overview" },
    canAnn && { value: "announcements", label: "Announcements" },
    canPol && { value: "policies", label: "Policies" },
    canPol && { value: "handbook", label: "Employee handbook" },
    { value: "acknowledgements", label: "Acknowledgements" },
  ].filter(Boolean);
  const [params, setParams] = useSearchParams();
  const [tab, setTabState] = useState(() => (tabs.some((t) => t.value === params.get("tab")) ? params.get("tab") : "overview"));
  const setTab = (t) => { setTabState(t); setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; }, { replace: true }); };

  const list = useHrQuery(() => (canAnn ? listAnnouncements() : Promise.resolve({ data: [] })), [canAnn]);
  const progress = useHrQuery(() => (canAnn ? announcementProgress() : Promise.resolve({ data: {} })), [canAnn]);
  const polAcks = useHrQuery(() => (canPol ? acknowledgementTracker({}) : Promise.resolve({ data: null })), [canPol]);
  const employees = useEmployeeOptions({ includeInactive: false });
  const reload = () => { list.reload(); progress.reload(); };

  // Publish anything whose scheduled time has passed (pg_cron does this too when installed).
  useEffect(() => {
    if (!canManageAnn) return;
    processScheduledAnnouncements().then((res) => { if (res.data?.published) reload(); });
  }, [canManageAnn]);   // eslint-disable-line react-hooks/exhaustive-deps

  const shared = { canManage: canManageAnn, employees: employees.data, list, progress, onChanged: reload };

  return (
    <>
      <PageHeader title="Announcements & Policies" description="Company announcements, HR notices, policies, the employee handbook and mandatory acknowledgements." />
      <Tabs value={tab} onChange={setTab} tabs={tabs} label="Announcements and policies sections" />
      {tab === "overview" && <Overview canAnn={canAnn} canPol={canPol} list={list} progress={progress} polAcks={polAcks} onNavigate={setTab} canManage={canManageAnn} onChanged={reload} />}
      {tab === "announcements" && <AnnouncementsTab {...shared} />}
      {tab === "policies" && (
        <>
          <p className="mb-3 text-sm text-slate-600">Company policies are versioned. Editing a published policy creates a new draft version; publishing it notifies the audience and asks for a fresh acknowledgement.</p>
          <PoliciesTab key="policies" scope="policies" canManage={canManagePol} employees={employees.data} onNavigate={setTab} />
        </>
      )}
      {tab === "handbook" && (
        <>
          <p className="mb-3 text-sm text-slate-600">The employee handbook works like a policy: every published version is kept, and employees acknowledge each new version in the Employee Portal.</p>
          <PoliciesTab key="handbook" scope="handbook" canManage={canManagePol} employees={employees.data} onNavigate={setTab} />
        </>
      )}
      {tab === "acknowledgements" && (
        <div className="flex flex-col gap-6">
          {canAnn && <AnnouncementAcks list={list} progress={progress} canManage={canManageAnn} onChanged={reload} />}
          {canPol && (
            <section aria-labelledby="pol-acks">
              <h2 id="pol-acks" className="mb-2 text-base font-bold text-[#101a3a]">Policies, handbook & documents</h2>
              <AcknowledgementsTab employees={employees.data} canManage={canManagePol} />
            </section>
          )}
        </div>
      )}
    </>
  );
}

function Overview({ canAnn, canPol, list, progress, polAcks, onNavigate, canManage, onChanged }) {
  const [tracking, setTracking] = useState(null);
  const all = list.data ?? [];
  const p = progress.data ?? {};
  const live = all.filter((a) => isLive(a));
  const scheduled = all.filter((a) => a.status === "scheduled");
  const drafts = all.filter((a) => a.status === "draft");
  const attention = useMemo(() => live.map((a) => ({ ...a, pending: pendingAcks(a, p[a.id]) })).filter((a) => a.pending > 0).sort((x, y) => y.pending - x.pending), [live, p]);
  const annPending = attention.reduce((n, a) => n + a.pending, 0);
  const loading = list.loading && !list.data;
  const recent = [...live].sort((a, b) => String(b.published_at).localeCompare(String(a.published_at))).slice(0, 5);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {canAnn && <KpiCard label="Live announcements" value={live.length} icon={Megaphone} tone="orange" loading={loading} onClick={() => onNavigate("announcements")} />}
        {canAnn && <KpiCard label="Scheduled" value={scheduled.length} hint={scheduled[0] ? `next ${formatDateTime(scheduled.map((a) => a.publish_at).sort()[0])}` : "nothing scheduled"} icon={CalendarClock} tone="navy" loading={loading} onClick={() => onNavigate("announcements")} />}
        {canAnn && <KpiCard label="Drafts" value={drafts.length} icon={FilePenLine} tone="slate" loading={loading} onClick={() => onNavigate("announcements")} />}
        {canAnn && <KpiCard label="Announcement acks pending" value={annPending} icon={Users} tone={annPending ? "red" : "green"} loading={loading || (progress.loading && !progress.data)} onClick={() => onNavigate("acknowledgements")} />}
        {canPol && <KpiCard label="Policy & document acks pending" value={polAcks.data?.totals?.pending} icon={ShieldCheck} tone={polAcks.data?.totals?.pending ? "red" : "green"} loading={polAcks.loading && !polAcks.data} onClick={() => onNavigate("acknowledgements")} />}
      </div>
      {canAnn && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Waiting for acknowledgement">
            {!attention.length ? <EmptyState icon={CheckCircle2} title="All caught up" description="No live announcement is waiting for acknowledgements." /> : (
              <ul className="flex flex-col gap-2">
                {attention.slice(0, 6).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
                    <span className="min-w-0"><span className="block truncate font-semibold text-[#101a3a]">{a.title}</span><ProgressCell a={a} p={p[a.id]} /></span>
                    <span className="flex items-center gap-2"><Badge tone="amber">{a.pending} pending</Badge><Button size="sm" variant="secondary" onClick={() => setTracking(a)}>Track</Button></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Recently published" actions={<Button size="sm" variant="ghost" onClick={() => onNavigate("announcements")}>All announcements</Button>}>
            {!recent.length ? <EmptyState icon={Megaphone} title="Nothing live" description="Published announcements appear here." /> : (
              <ul className="flex flex-col gap-2">
                {recent.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
                    <span className="min-w-0"><span className="block truncate font-semibold text-[#101a3a]">{a.title}</span><span className="text-xs text-slate-500">{formatDateTime(a.published_at)}</span></span>
                    <CategoryBadge category={a.category} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      {canPol && (
        <Card title="Policies & handbook" actions={<Button size="sm" variant="ghost" onClick={() => onNavigate("handbook")}><BookOpen className="h-4 w-4" aria-hidden="true" />Employee handbook</Button>}>
          <p className="text-sm text-slate-600">Policies and the handbook are versioned; each published version is acknowledged separately. Track who is pending under <button type="button" className="font-semibold text-[#1f4693] underline" onClick={() => onNavigate("acknowledgements")}>Acknowledgements</button>.</p>
        </Card>
      )}
      {tracking && <TrackingModal announcement={tracking} canManage={canManage} onClose={() => setTracking(null)} onChanged={onChanged} />}
    </div>
  );
}

function AnnouncementAcks({ list, progress, canManage, onChanged }) {
  const [tracking, setTracking] = useState(null);
  const p = progress.data ?? {};
  const rows = (list.data ?? []).filter((a) => a.requires_acknowledgement && a.status !== "draft" && a.status !== "scheduled")
    .map((a) => ({ ...a, pending: pendingAcks(a, p[a.id]) }));
  return (
    <section aria-labelledby="ann-acks">
      <h2 id="ann-acks" className="mb-2 text-base font-bold text-[#101a3a]">Announcements</h2>
      <p className="mb-3 text-sm text-slate-600">Announcements marked “employees must acknowledge”. Employees acknowledge in the Employee Portal under Announcements & Policies.</p>
      <DataTable caption="Announcement acknowledgements" rows={rows} loading={list.loading || (progress.loading && !progress.data)} error={list.error || progress.error} onRetry={() => { list.reload(); progress.reload(); }}
        emptyTitle="No announcement requires acknowledgement" pageSize={10}
        columns={[
          { key: "title", header: "Announcement", render: (a) => <div><p className="font-semibold text-[#101a3a]">{a.title}</p><p className="text-xs text-slate-500">published {formatDateTime(a.published_at)}{a.status === "archived" ? " · archived" : !isLive(a) ? " · expired" : ""}</p></div> },
          { key: "progress", header: "Progress", render: (a) => <ProgressCell a={a} p={p[a.id]} /> },
          { key: "pending", header: "Pending", sortable: true, render: (a) => (isLive(a) ? (a.pending ? <Badge tone="amber">{a.pending}</Badge> : <Badge tone="green">0</Badge>) : "—") },
          { key: "last", header: "Last reminder", render: (a) => (p[a.id]?.last_reminded_at ? formatDateTime(p[a.id].last_reminded_at) : "—") },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (a) => <Button size="sm" variant="secondary" onClick={() => setTracking(a)}><Users className="h-4 w-4" aria-hidden="true" />Track</Button> },
        ]} />
      {tracking && <TrackingModal announcement={tracking} canManage={canManage} onClose={() => setTracking(null)} onChanged={onChanged} />}
    </section>
  );
}
