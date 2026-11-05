// Module 10 — Announcements: drafts, audience targeting, scheduling,
// publishing (portal notifications + optional QUEUED email), archiving and
// read/acknowledgement statistics. Published content is immutable.
// announcements.manage writes; announcements.view_all reads everything.
import { useMemo, useState } from "react";
import { Archive, BarChart3, Clock, Pencil, Plus, Send, Trash2, Undo2 } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDateTime, useHrQuery } from "@/lib/hr/client";
import { toOptions, useEmployeeOptions, useOrg } from "@/lib/hr/org";
import {
  ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_STATUSES, AUDIENCE_TYPES, CATEGORY_TONE, announcementStats, archiveAnnouncement, createAnnouncement,
  deleteAnnouncement, label as lbl, listAnnouncements, processScheduledAnnouncements, publishAnnouncement, unscheduleAnnouncement, updateAnnouncement,
} from "@/lib/hr/announcements";
import {
  Badge, Button, Checkbox, ConfirmDialog, DataTable, DescriptionList, ErrorState, Field, InlineError, Input, KpiCard, Loading, Modal,
  PageHeader, SearchInput, Select, StatusBadge, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";

const pad = (n) => String(n).padStart(2, "0");
/** ISO timestamp -> value for <input type="datetime-local"> in the browser's local time. */
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (s) => (s ? new Date(s).toISOString() : null);
const isFuture = (iso) => Boolean(iso) && new Date(iso).getTime() > Date.now();

function useAudienceText(org, employees) {
  return (a) => {
    const ids = a.audience_ids ?? [];
    const names = (rows, key = "id") => ids.map((id) => rows?.find((r) => r[key] === id)?.name ?? "unknown");
    switch (a.audience_type) {
      case "all": return "Everyone";
      case "departments": return `Departments: ${names(org.data?.departments).join(", ") || "none"}`;
      case "locations": return `Locations: ${names(org.data?.locations).join(", ") || "none"}`;
      case "employment_types": return `Types: ${(a.audience_codes ?? []).map((c) => org.data?.employmentTypes.find((t) => t.code === c)?.name ?? c).join(", ") || "none"}`;
      case "employees": {
        const list = ids.map((id) => employees.data?.find((e) => e.value === id)?.label ?? "employee");
        return `${ids.length} employee(s)${list.length ? `: ${list.slice(0, 3).join(", ")}${list.length > 3 ? "…" : ""}` : ""}`;
      }
      default: return "—";
    }
  };
}

export default function AnnouncementsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("announcements.manage");
  const { notify } = useToast();
  const org = useOrg();
  const employees = useEmployeeOptions();
  const audienceText = useAudienceText(org, employees);
  const q = useHrQuery(() => listAnnouncements(), []);
  const [status, setStatus] = useState("published");
  const [search, setSearch] = useState("");
  const [composing, setComposing] = useState(null);   // {} new | row
  const [openId, setOpenId] = useState(null);
  const [processing, setProcessing] = useState(false);

  const counts = useMemo(() => Object.fromEntries(ANNOUNCEMENT_STATUSES.map((s) => [s, (q.data ?? []).filter((a) => a.status === s).length])), [q.data]);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((a) => (!status || a.status === status) && (!s || a.title.toLowerCase().includes(s)));
  }, [q.data, status, search]);
  const dueScheduled = (q.data ?? []).filter((a) => a.status === "scheduled" && !isFuture(a.publish_at)).length;
  const selected = (q.data ?? []).find((a) => a.id === openId);

  const columns = [
    { key: "title", header: "Announcement", sortable: true, sortValue: (r) => r.title.toLowerCase(), render: (r) => (
      <div className="min-w-[12rem]"><p className="font-semibold text-[#101a3a]">{r.title}</p><Badge tone={CATEGORY_TONE[r.category]}>{lbl(r.category)}</Badge></div>) },
    { key: "audience", header: "Audience", render: (r) => <span className="line-clamp-2 max-w-xs text-xs">{audienceText(r)}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "when", header: "Publish", sortable: true, sortValue: (r) => r.published_at ?? r.publish_at ?? r.created_at, render: (r) => (
      <span className="whitespace-nowrap text-xs">{r.published_at ? `Published ${formatDateTime(r.published_at)}` : r.publish_at ? `At ${formatDateTime(r.publish_at)}` : "On publish"}</span>) },
    { key: "expires_at", header: "Expires", render: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.expires_at)}</span> },
    { key: "flags", header: "Options", render: (r) => (
      <span className="flex flex-wrap gap-1">{r.requires_acknowledgement && <Badge tone="orange">ack required</Badge>}{r.send_email && <Badge tone="blue">email</Badge>}{!r.requires_acknowledgement && !r.send_email && "—"}</span>) },
  ];

  async function processDue() {
    setProcessing(true);
    const res = await processScheduledAnnouncements();
    setProcessing(false);
    if (res.error) { notify(res.error, "error"); return; }
    notify(`Published ${res.data?.published ?? 0} scheduled announcement(s); ${res.data?.notified ?? 0} portal notification(s), ${res.data?.emails_queued ?? 0} email(s) queued.`);
    q.reload();
  }

  return (
    <>
      <PageHeader title="Announcements" description="Company announcements in the employee portal, with optional acknowledgement and email."
        actions={canManage && <Button onClick={() => setComposing({})}><Plus className="h-4 w-4" aria-hidden="true" />New announcement</Button>} />
      <Tabs value={status} onChange={setStatus} label="Announcement status"
        tabs={[...ANNOUNCEMENT_STATUSES.map((s) => ({ value: s, label: lbl(s), count: counts[s] })), { value: "", label: "All", count: q.data?.length }]} />
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search title…" label="Search announcements" />
        {canManage && status === "scheduled" && (
          <Button variant="secondary" loading={processing} disabled={!dueScheduled} onClick={processDue} title={dueScheduled ? undefined : "No scheduled announcement is due yet"}>
            <Clock className="h-4 w-4" aria-hidden="true" />Publish due now ({dueScheduled})
          </Button>
        )}
      </Toolbar>
      {status === "scheduled" && <p className="mb-3 text-xs text-slate-500">Scheduled announcements are published automatically by the scheduler at their publish time. If one is overdue, use “Publish due now”.</p>}
      <DataTable caption="Announcements" columns={columns} rows={rows} loading={q.loading} error={q.error} onRetry={q.reload} onRowClick={(r) => setOpenId(r.id)}
        emptyTitle={`No ${status ? lbl(status) : ""} announcements`} />
      {selected && <AnnouncementDetail announcement={selected} canManage={canManage} audienceText={audienceText}
        onClose={() => setOpenId(null)} onEdit={() => { setComposing(selected); setOpenId(null); }}
        onChanged={(msg, close) => { q.reload(); if (msg) notify(msg); if (close) setOpenId(null); }} />}
      {composing && <Composer announcement={composing} org={org} employees={employees} onClose={() => setComposing(null)}
        onSaved={(id, isNew) => { setComposing(null); q.reload(); notify(isNew ? "Draft saved." : "Changes saved."); setStatus(isNew ? "draft" : status); setOpenId(id); }} />}
    </>
  );
}

// =====================================================================
// Detail + actions + stats
// =====================================================================
function AnnouncementDetail({ announcement: a, canManage, audienceText, onClose, onEdit, onChanged }) {
  const [confirm, setConfirm] = useState(null);   // publish | unschedule | archive | delete
  const showStats = canManage && ["published", "archived"].includes(a.status);
  const willSchedule = isFuture(a.publish_at);

  const confirms = {
    publish: {
      title: willSchedule ? "Schedule announcement" : "Publish announcement",
      label: willSchedule ? "Schedule" : "Publish now",
      tone: "primary",
      message: `${willSchedule ? `It will be published automatically at ${formatDateTime(a.publish_at)}.` : "It is published immediately."} Everyone in the audience (${audienceText(a)}) with portal access gets a portal notification.${a.send_email ? " Emails are queued for delivery to company email addresses; their delivery status appears in the statistics." : ""} Published announcements cannot be edited.`,
      run: async () => {
        const res = await publishAnnouncement(a.id);
        if (res.error) return res;
        const d = res.data ?? {};
        const msg = d.already_published ? "This announcement was already published."
          : d.status === "scheduled" ? `Scheduled for ${formatDateTime(d.publish_at ?? a.publish_at)}.`
            : `Published: ${d.notified ?? 0} portal notification(s)${a.send_email ? `, ${d.emails_queued ?? 0} email(s) queued for delivery` : ""}.`;
        onChanged(msg, false);
        return res;
      },
    },
    unschedule: { title: "Unschedule", label: "Move to draft", tone: "primary", message: "The announcement returns to draft and will not be published until you publish it again.",
      run: async () => { const res = await unscheduleAnnouncement(a.id); if (!res.error) onChanged("Moved back to draft.", false); return res; } },
    archive: { title: "Archive announcement", label: "Archive", tone: "danger", message: "Archived announcements disappear from the employee portal. This cannot be undone; publish a new announcement if needed.",
      run: async () => { const res = await archiveAnnouncement(a.id); if (!res.error) onChanged("Announcement archived.", false); return res; } },
    delete: { title: "Delete draft", label: "Delete", tone: "danger", message: "Delete this draft permanently?",
      run: async () => { const res = await deleteAnnouncement(a.id); if (!res.error) onChanged("Draft deleted.", true); return res; } },
  };
  const c = confirm && confirms[confirm];

  return (
    <>
    <Modal open={!confirm} onClose={onClose} title={a.title} size="lg"
      footer={<>
        {canManage && ["draft", "scheduled"].includes(a.status) && <Button variant="secondary" onClick={onEdit}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>}
        {canManage && a.status === "draft" && <Button variant="ghost" onClick={() => setConfirm("delete")}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete</Button>}
        {canManage && a.status === "scheduled" && <Button variant="secondary" onClick={() => setConfirm("unschedule")}><Undo2 className="h-4 w-4" aria-hidden="true" />Unschedule</Button>}
        {canManage && ["scheduled", "published"].includes(a.status) && <Button variant="danger" onClick={() => setConfirm("archive")}><Archive className="h-4 w-4" aria-hidden="true" />Archive</Button>}
        {canManage && a.status === "draft" && <Button onClick={() => setConfirm("publish")}><Send className="h-4 w-4" aria-hidden="true" />{willSchedule ? "Schedule" : "Publish"}</Button>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </>}>
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={a.status} /><Badge tone={CATEGORY_TONE[a.category]}>{lbl(a.category)}</Badge>
        {a.requires_acknowledgement && <Badge tone="orange">acknowledgement required</Badge>}{a.send_email && <Badge tone="blue">email</Badge>}</div>
      <div className="mt-4 whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50/60 p-4 text-sm text-slate-800">{a.body}</div>
      <div className="mt-4">
        <DescriptionList items={[
          { label: "Audience", value: audienceText(a) },
          { label: "Publish time", value: a.publish_at ? formatDateTime(a.publish_at) : "When published" },
          { label: "Published", value: formatDateTime(a.published_at) },
          { label: "Expires", value: a.expires_at ? formatDateTime(a.expires_at) : "Never" },
          a.archived_at ? { label: "Archived", value: formatDateTime(a.archived_at) } : null,
          { label: "Created", value: formatDateTime(a.created_at) },
        ]} />
      </div>
      {a.status === "published" && a.expires_at && !isFuture(a.expires_at) && <p className="mt-3 text-xs font-medium text-amber-700">This announcement has expired and is no longer shown in the portal.</p>}
      {showStats && <StatsPanel id={a.id} />}
    </Modal>
    {c && <ConfirmDialog open onClose={() => setConfirm(null)} title={c.title} tone={c.tone} message={c.message} confirmLabel={c.label} onConfirm={c.run} />}
    </>
  );
}

function StatsPanel({ id }) {
  const s = useHrQuery(() => announcementStats(id), [id]);
  if (s.loading && !s.data) return <Loading label="Loading statistics…" />;
  if (s.error) return <div className="mt-4"><ErrorState message={s.error} onRetry={s.reload} /></div>;
  const d = s.data ?? {};
  const pending = Math.max(0, (d.emails_queued ?? 0) - (d.emails_sent ?? 0) - (d.emails_failed ?? 0));
  return (
    <section className="mt-5" aria-label="Statistics">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-[#101a3a]"><BarChart3 className="h-4 w-4" aria-hidden="true" />Statistics</h3>
        <Button size="sm" variant="ghost" onClick={s.reload}>Refresh</Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <KpiCard label="Audience now" value={d.audience} hint="current employees in scope" tone="navy" />
        <KpiCard label="Read" value={d.read} hint={d.audience ? `${Math.round(((d.read ?? 0) / d.audience) * 100)}% of audience` : undefined} tone="teal" />
        {d.requires_acknowledgement && <KpiCard label="Acknowledged" value={d.acknowledged} hint={d.audience ? `${Math.round(((d.acknowledged ?? 0) / d.audience) * 100)}% of audience` : undefined} tone="green" />}
        <KpiCard label="Portal notifications" value={d.notified} hint="sent at publish time" tone="slate" />
        <KpiCard label="Emails queued" value={d.emails_queued} tone="orange" />
        <KpiCard label="Emails delivered" value={d.emails_sent} hint={`${pending} pending · ${d.emails_failed ?? 0} failed`} tone={d.emails_failed ? "red" : "green"} />
      </div>
      <p className="mt-2 text-xs text-slate-500">Emails are queued at publish time and delivered by the email dispatcher; “delivered” counts only messages the outbox marked as sent.</p>
    </section>
  );
}

// =====================================================================
// Composer
// =====================================================================
function MultiPick({ legend, options, value, onChange, error, searchable = true }) {
  const [q, setQ] = useState("");
  const list = (options ?? []).filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  const set = new Set(value ?? []);
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-semibold text-[#173a52]">{legend}</legend>
      {searchable && <Input type="search" placeholder="Filter…" aria-label={`Filter ${legend}`} value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className={`max-h-52 overflow-y-auto rounded-xl border p-2 ${error ? "border-red-400" : "border-slate-200"}`}>
        {list.length ? list.map((o) => (
          <div key={o.value} className="py-0.5"><Checkbox label={o.label} checked={set.has(o.value)} onChange={(e) => onChange(e.target.checked ? [...set, o.value] : [...set].filter((x) => x !== o.value))} /></div>
        )) : <p className="px-1 py-2 text-xs text-slate-500">No matches.</p>}
      </div>
      <p className="text-xs text-slate-500">{set.size} selected</p>
      {error && <p className="text-xs font-medium text-red-600" role="alert">{error}</p>}
    </fieldset>
  );
}

function Composer({ announcement, org, employees, onClose, onSaved }) {
  const isNew = !announcement.id;
  const [v, setV] = useState({
    title: announcement.title ?? "", body: announcement.body ?? "", category: announcement.category ?? "general",
    audience_type: announcement.audience_type ?? "all", audience_ids: announcement.audience_ids ?? [], audience_codes: announcement.audience_codes ?? [],
    publish_at: toLocalInput(announcement.publish_at), expires_at: toLocalInput(announcement.expires_at),
    requires_acknowledgement: Boolean(announcement.requires_acknowledgement), send_email: Boolean(announcement.send_email),
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const setType = (e) => setV((s) => ({ ...s, audience_type: e.target.value, audience_ids: [], audience_codes: [] }));

  async function save() {
    const errs = {};
    const title = v.title.trim();
    if (title.length < 2 || title.length > 200) errs.title = "Enter a title of 2–200 characters.";
    if (!v.body.trim()) errs.body = "Write the announcement.";
    else if (v.body.length > 20000) errs.body = "Keep it under 20,000 characters.";
    if (["departments", "locations", "employees"].includes(v.audience_type) && !v.audience_ids.length) errs.audience = "Choose at least one recipient group.";
    if (v.audience_type === "employment_types" && !v.audience_codes.length) errs.audience = "Choose at least one employment type.";
    const pub = v.publish_at ? new Date(v.publish_at) : null;
    const exp = v.expires_at ? new Date(v.expires_at) : null;
    if (pub && Number.isNaN(pub.getTime())) errs.publish_at = "Enter a valid date and time.";
    if (exp && Number.isNaN(exp.getTime())) errs.expires_at = "Enter a valid date and time.";
    if (!errs.expires_at && exp && exp.getTime() <= Math.max(Date.now(), pub?.getTime() ?? 0)) errs.expires_at = "Expiry must be in the future and after the publish time.";
    if (announcement.status === "scheduled" && !pub) errs.publish_at = "A scheduled announcement needs a publish time (or unschedule it first).";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const values = { ...v, title, publish_at: fromLocalInput(v.publish_at), expires_at: fromLocalInput(v.expires_at) };
    setBusy(true); setError(null);
    const res = isNew ? await createAnnouncement(values) : await updateAnnouncement(announcement.id, values);
    setBusy(false);
    if (res.error) setError(res.error); else onSaved(res.data?.id ?? announcement.id, isNew);
  }

  let picker = null;
  if (v.audience_type === "departments") picker = <MultiPick legend="Departments" options={toOptions(org.data?.departments)} value={v.audience_ids} onChange={(ids) => setV((s) => ({ ...s, audience_ids: ids }))} error={errors.audience} />;
  if (v.audience_type === "locations") picker = <MultiPick legend="Office locations" options={toOptions(org.data?.locations)} value={v.audience_ids} onChange={(ids) => setV((s) => ({ ...s, audience_ids: ids }))} error={errors.audience} />;
  if (v.audience_type === "employment_types") picker = <MultiPick legend="Employment types" searchable={false} options={toOptions(org.data?.employmentTypes, "name", "code")} value={v.audience_codes} onChange={(codes) => setV((s) => ({ ...s, audience_codes: codes }))} error={errors.audience} />;
  if (v.audience_type === "employees") picker = employees.loading && !employees.data ? <Loading /> : <MultiPick legend="Employees" options={employees.data ?? []} value={v.audience_ids} onChange={(ids) => setV((s) => ({ ...s, audience_ids: ids }))} error={errors.audience} />;

  return (
    <Modal open onClose={onClose} title={isNew ? "New announcement" : `Edit: ${announcement.title}`} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{isNew ? "Save draft" : "Save changes"}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Title" required error={errors.title} className="sm:col-span-2"><Input value={v.title} onChange={set("title")} maxLength={200} /></Field>
        <Field label="Category"><Select value={v.category} onChange={set("category")} options={ANNOUNCEMENT_CATEGORIES.map((c) => ({ value: c, label: lbl(c) }))} /></Field>
        <Field label="Audience"><Select value={v.audience_type} onChange={setType} options={AUDIENCE_TYPES} /></Field>
        {picker && <div className="sm:col-span-2">{org.loading && !org.data ? <Loading /> : picker}</div>}
        <Field label="Message" required error={errors.body} className="sm:col-span-2" hint="Plain text; line breaks are kept."><Textarea rows={8} value={v.body} onChange={set("body")} /></Field>
        <Field label="Publish at" error={errors.publish_at} hint="Optional. Blank = publish as soon as you press Publish; a future time schedules it."><Input type="datetime-local" value={v.publish_at} onChange={set("publish_at")} /></Field>
        <Field label="Expires at" error={errors.expires_at} hint="Optional. Hidden from the portal after this time."><Input type="datetime-local" value={v.expires_at} onChange={set("expires_at")} /></Field>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Checkbox label="Employees must acknowledge this announcement" checked={v.requires_acknowledgement} onChange={set("requires_acknowledgement")} />
          <Checkbox label="Also email it to company email addresses" checked={v.send_email} onChange={set("send_email")} />
          {v.send_email && <p className="text-xs text-slate-500">Emails are queued when the announcement is published and delivered by the email dispatcher. Delivery (sent / failed) is shown in the statistics; queueing does not guarantee delivery.</p>}
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">Saving keeps it as a {announcement.status === "scheduled" ? "scheduled item" : "draft"}. Nothing is sent until you publish.</p>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}
