// Announcements (Module 13): draft -> (scheduled) -> published -> archived.
// Drafts and scheduled items are edited in place; published content is
// immutable (archive it and publish a new one). Publishing notifies the
// audience in-app and, optionally, queues an email (hr_email_outbox).
import { useState } from "react";
import { Archive, BellRing, Download, Eye, Pencil, Plus, Send, Trash2, Undo2, Users } from "lucide-react";
import { exportCsv, formatDateTime, useHrQuery } from "@/lib/hr/client";
import {
  ANNOUNCEMENT_CATEGORIES, announcementCategory, announcementRecipients, announcementStats, archiveAnnouncement, deleteAnnouncementDraft,
  displayStatus, isLive, publishAnnouncement, remindAnnouncement, saveAnnouncement, unscheduleAnnouncement,
} from "@/lib/hr/announcements";
import { AUDIENCE_TYPES } from "@/lib/hr/documentCenter";
import { toOptions, useOrg } from "@/lib/hr/org";
import { MultiPick } from "@/hr/pages/documents/PoliciesTab";
import {
  Badge, Button, Checkbox, ConfirmDialog, DataTable, Field, InlineError, Input, KpiCard, Loading, Modal, Select, StatusBadge, Textarea, Toolbar, useToast,
} from "@/hr/ui";

/** ISO -> value for <input type="datetime-local"> (browser local time). */
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

export function audienceSummary(a) {
  const label = AUDIENCE_TYPES.find((x) => x.value === a.audience_type)?.label ?? a.audience_type;
  if (a.audience_type === "all") return label;
  const n = (a.audience_type === "employment_types" ? a.audience_codes : a.audience_ids)?.length ?? 0;
  return `${label} (${n})`;
}

export function CategoryBadge({ category }) {
  const c = announcementCategory(category);
  return <Badge tone={c.tone}>{c.label}</Badge>;
}

export function ProgressCell({ a, p }) {
  if (!p) return "—";
  if (a.status === "draft" || a.status === "scheduled") return <span className="text-xs text-slate-500">reaches {p.audience}</span>;
  const pct = (n) => (p.audience ? Math.round((Number(n) / Number(p.audience)) * 100) : 0);
  return (
    <div className="flex min-w-[8rem] flex-col gap-0.5 text-xs">
      <span>Read {p.read}/{p.audience} <span className="text-slate-500">({pct(p.read)}%)</span></span>
      {a.requires_acknowledgement && <span>Acknowledged {p.acknowledged}/{p.audience} <span className="text-slate-500">({pct(p.acknowledged)}%)</span></span>}
    </div>
  );
}

// ------------------------------------------------------------------ editor
function AnnouncementEditor({ announcement, employees, canPublish, onClose, onSaved }) {
  const { notify } = useToast();
  const org = useOrg();
  const a = announcement;
  const [v, setV] = useState({
    title: a?.title ?? "", body: a?.body ?? "", category: a?.category ?? "general", audience_type: a?.audience_type ?? "all",
    audience_ids: a?.audience_ids ?? [], audience_codes: a?.audience_codes ?? [],
    publish_at: toLocalInput(a?.publish_at), expires_at: toLocalInput(a?.expires_at),
    requires_acknowledgement: a?.requires_acknowledgement ?? false, send_email: a?.send_email ?? false,
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);   // "save" | "publish"
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const audienceOptions = v.audience_type === "departments" ? toOptions(org.data?.departments)
    : v.audience_type === "locations" ? toOptions(org.data?.locations)
    : v.audience_type === "employment_types" ? toOptions(org.data?.employmentTypes, "name", "code")
    : v.audience_type === "employees" ? (employees ?? []) : [];
  const future = v.publish_at && new Date(v.publish_at).getTime() > Date.now();

  function validate() {
    if (v.title.trim().length < 2) return "Give the announcement a title.";
    if (!v.body.trim()) return "Write the announcement.";
    if (v.audience_type !== "all" && !(v.audience_type === "employment_types" ? v.audience_codes : v.audience_ids).length) return "Choose who should receive this announcement.";
    if (v.expires_at && new Date(v.expires_at).getTime() <= Math.max(Date.now(), v.publish_at ? new Date(v.publish_at).getTime() : 0)) return "The expiry time must be after the publish time.";
    return null;
  }
  async function save(publish) {
    const msg = validate();
    if (msg) { setError(msg); return; }
    setBusy(publish ? "publish" : "save"); setError(null);
    const res = await saveAnnouncement(a?.id, { ...v, publish_at: fromLocalInput(v.publish_at), expires_at: fromLocalInput(v.expires_at) });
    if (res.error) { setBusy(null); setError(res.error); return; }
    if (publish) {
      const pub = await publishAnnouncement(res.data.id);
      setBusy(null);
      if (pub.error) { setError(`Saved as draft, but not published: ${pub.error}`); onSaved(); return; }
      notify(pub.data?.status === "scheduled"
        ? `Scheduled for ${formatDateTime(pub.data.publish_at)}.`
        : `Published. ${pub.data?.notified ?? 0} employee(s) notified${pub.data?.emails_queued ? `, ${pub.data.emails_queued} email(s) queued` : ""}.`);
    } else {
      setBusy(null);
      notify(a?.status === "scheduled" ? "Scheduled announcement updated." : "Draft saved.");
    }
    onSaved();
    onClose();
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title={a ? `Edit announcement · ${a.title}` : "New announcement"} size="xl"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={Boolean(busy)}>Cancel</Button>
        <Button variant="secondary" loading={busy === "save"} disabled={Boolean(busy)} onClick={() => save(false)}>{a?.status === "scheduled" ? "Save changes" : "Save draft"}</Button>
        {canPublish && a?.status !== "scheduled" && <Button variant="success" loading={busy === "publish"} disabled={Boolean(busy)} onClick={() => save(true)}><Send className="h-4 w-4" aria-hidden="true" />{future ? "Schedule" : "Publish now"}</Button>}
      </>}>
      <div className="flex flex-col gap-3">
        {a?.status === "scheduled" && <p className="rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">Scheduled for {formatDateTime(a.publish_at)}. It publishes automatically at that time; edits here keep it scheduled.</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Title" required className="sm:col-span-2"><Input value={v.title} maxLength={200} onChange={set("title")} /></Field>
          <Field label="Type"><Select value={v.category} onChange={set("category")} options={ANNOUNCEMENT_CATEGORIES} /></Field>
          <Field label="Audience"><Select value={v.audience_type} onChange={(e) => setV((s) => ({ ...s, audience_type: e.target.value, audience_ids: [], audience_codes: [] }))} options={AUDIENCE_TYPES} /></Field>
        </div>
        {v.audience_type !== "all" && (org.loading ? <Loading /> : (
          <MultiPick label="Send to" options={audienceOptions}
            value={v.audience_type === "employment_types" ? v.audience_codes : v.audience_ids}
            onChange={(next) => setV((s) => (s.audience_type === "employment_types" ? { ...s, audience_codes: next } : { ...s, audience_ids: next }))} />
        ))}
        <Field label="Message" required hint="Plain text. Shown in the Employee Portal and, if selected, sent by email."><Textarea rows={10} maxLength={20000} value={v.body} onChange={set("body")} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Publish at" hint="Leave empty to publish immediately."><Input type="datetime-local" value={v.publish_at} onChange={set("publish_at")} /></Field>
          <Field label="Expires at" hint="Hidden from employees after this time."><Input type="datetime-local" value={v.expires_at} onChange={set("expires_at")} /></Field>
        </div>
        <div className="flex flex-wrap gap-4">
          <Checkbox label="Employees must acknowledge" checked={v.requires_acknowledgement} onChange={set("requires_acknowledgement")} />
          <Checkbox label="Also send by email" checked={v.send_email} onChange={set("send_email")} />
        </div>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- tracking
export function TrackingModal({ announcement, canManage, onClose, onChanged }) {
  const { notify } = useToast();
  const a = announcement;
  const stats = useHrQuery(() => announcementStats(a.id), [a.id]);
  const rec = useHrQuery(() => announcementRecipients(a.id), [a.id]);
  const [filter, setFilter] = useState("");
  const [remind, setRemind] = useState(null);   // { employee?, label }
  const s = stats.data;
  const canRemind = canManage && a.requires_acknowledgement && isLive(a);
  const rows = (rec.data ?? []).filter((r) => !filter
    || (filter === "unread" && !r.read_at)
    || (filter === "pending" && !r.acknowledged_at)
    || (filter === "acknowledged" && r.acknowledged_at));
  const reload = () => { stats.reload(); rec.reload(); onChanged?.(); };
  return (
    <Modal open onClose={onClose} title={`Tracking · ${a.title}`} size="xl" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Audience" value={s?.audience} tone="navy" loading={stats.loading && !s} />
          <KpiCard label="Read" value={s?.read} tone="teal" loading={stats.loading && !s} />
          <KpiCard label="Acknowledged" value={a.requires_acknowledgement ? s?.acknowledged : "n/a"} tone="green" loading={stats.loading && !s} />
          <KpiCard label="Emails" value={s ? `${s.emails_sent}/${s.emails_queued}` : undefined} hint={s?.emails_failed ? `${s.emails_failed} failed` : "sent / queued"} tone={s?.emails_failed ? "red" : "slate"} loading={stats.loading && !s} />
        </div>
        <Toolbar>
          <Select aria-label="Filter recipients" className="sm:w-48" placeholder="Everyone" value={filter} onChange={(e) => setFilter(e.target.value)}
            options={[{ value: "unread", label: "Not read" }, ...(a.requires_acknowledgement ? [{ value: "pending", label: "Not acknowledged" }, { value: "acknowledged", label: "Acknowledged" }] : [])]} />
          <Button variant="ghost" disabled={!rec.data?.length} onClick={() => exportCsv(`announcement-${a.title.replace(/[^A-Za-z0-9]+/g, "_")}`, rec.data, [
            { key: "employee_code", label: "Employee code" }, { key: "employee_name", label: "Employee" }, { key: "department_name", label: "Department" },
            { key: "read_at", label: "Read at" }, { key: "acknowledged_at", label: "Acknowledged at" }, { key: "reminder_count", label: "Reminders" },
          ])}><Download className="h-4 w-4" aria-hidden="true" />Export CSV</Button>
          {canRemind && <Button className="sm:ml-auto" variant="secondary" onClick={() => setRemind({ label: "everyone who has not acknowledged yet" })}><BellRing className="h-4 w-4" aria-hidden="true" />Remind pending</Button>}
        </Toolbar>
        <DataTable caption="Recipients" rowKey="employee_id" rows={rows} loading={rec.loading} error={rec.error} onRetry={rec.reload} pageSize={10}
          emptyTitle="No recipients" columns={[
            { key: "employee_name", header: "Employee", render: (r) => <div><p className="font-semibold text-[#101a3a]">{r.employee_name}</p><p className="font-mono text-xs text-slate-500">{r.employee_code}{r.department_name ? ` · ${r.department_name}` : ""}{!r.portal_access ? " · no portal access" : ""}</p></div> },
            { key: "read_at", header: "Read", render: (r) => (r.read_at ? formatDateTime(r.read_at) : <Badge tone="amber">not read</Badge>) },
            ...(a.requires_acknowledgement ? [{ key: "acknowledged_at", header: "Acknowledged", render: (r) => (r.acknowledged_at ? formatDateTime(r.acknowledged_at) : <Badge tone="amber">pending</Badge>) }] : []),
            { key: "reminder_count", header: "Reminders", render: (r) => (Number(r.reminder_count) ? `${r.reminder_count} · last ${formatDateTime(r.last_reminded_at)}` : "—") },
            { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => canRemind && !r.acknowledged_at && r.portal_access && (
              <Button size="sm" variant="ghost" onClick={() => setRemind({ employee: r.employee_id, label: r.employee_name })}><BellRing className="h-4 w-4" aria-hidden="true" />Remind</Button>) },
          ]} />
      </div>
      <ConfirmDialog open={Boolean(remind)} onClose={() => setRemind(null)} title="Send acknowledgement reminder" confirmLabel="Send"
        message={remind ? `Send an in-app reminder to ${remind.label}? Anyone reminded recently is skipped.` : ""}
        onConfirm={async () => {
          const res = await remindAnnouncement(a.id, remind.employee ?? null);
          if (!res.error) { notify(res.data ? `${res.data} reminder(s) sent.` : "Everyone pending was reminded recently; nothing sent."); reload(); }
          return res;
        }} />
    </Modal>
  );
}

// -------------------------------------------------------------------- list
export default function AnnouncementsTab({ canManage, employees, list, progress, onChanged }) {
  const { notify } = useToast();
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState(null);   // { announcement } (null announcement = new)
  const [reading, setReading] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [confirm, setConfirm] = useState(null);   // { a, action: publish | archive | delete | unschedule }
  const rows = (list.data ?? []).filter((a) => !status || displayStatus(a) === status);
  const p = progress.data ?? {};

  const ACTIONS = {
    publish: { title: "Publish announcement", label: "Publish", tone: "success", run: publishAnnouncement,
      message: (a) => (a.publish_at && new Date(a.publish_at).getTime() > Date.now()
        ? `"${a.title}" will be scheduled for ${formatDateTime(a.publish_at)} and published automatically.`
        : `"${a.title}" is published now and ${p[a.id]?.audience ?? "every"} employee(s) in the audience are notified${a.send_email ? " and emailed" : ""}. Published announcements cannot be edited.`),
      done: (res) => (res.data?.status === "scheduled" ? "Scheduled." : `Published. ${res.data?.notified ?? 0} employee(s) notified.`) },
    archive: { title: "Archive announcement", label: "Archive", tone: "danger", run: archiveAnnouncement,
      message: (a) => `Employees will no longer see "${a.title}". Read and acknowledgement records are kept.`, done: () => "Announcement archived." },
    delete: { title: "Delete draft", label: "Delete", tone: "danger", run: deleteAnnouncementDraft,
      message: (a) => `Delete the draft "${a.title}"? This cannot be undone.`, done: () => "Draft deleted." },
    unschedule: { title: "Unschedule", label: "Move to drafts", tone: "primary", run: unscheduleAnnouncement,
      message: (a) => `"${a.title}" goes back to drafts and will not publish on ${formatDateTime(a.publish_at)}.`, done: () => "Moved back to drafts." },
  };
  const act = confirm && ACTIONS[confirm.action];

  return (
    <>
      <Toolbar>
        <Select aria-label="Status" className="sm:w-48" placeholder="Any status" value={status} onChange={(e) => setStatus(e.target.value)}
          options={["draft", "scheduled", "published", "expired", "archived"].map((s) => ({ value: s, label: s === "published" ? "live" : s }))} />
        {canManage && <Button className="sm:ml-auto" onClick={() => setEditing({ announcement: null })}><Plus className="h-4 w-4" aria-hidden="true" />New announcement</Button>}
      </Toolbar>
      <DataTable caption="Announcements" rows={rows} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle="No announcements" emptyDescription={canManage ? "Create an announcement to share company news, HR notices, holidays or events." : undefined}
        columns={[
          { key: "title", header: "Announcement", render: (a) => (
            <div className="min-w-[14rem]">
              <p className="font-semibold text-[#101a3a]">{a.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500"><CategoryBadge category={a.category} />{audienceSummary(a)}{a.requires_acknowledgement && <Badge tone="orange">ack required</Badge>}{a.send_email && <Badge>email</Badge>}</p>
            </div>) },
          { key: "status", header: "Status", render: (a) => { const s = displayStatus(a); return s === "published" ? <Badge tone="green">live</Badge> : <StatusBadge status={s} />; } },
          { key: "published_at", header: "Dates", sortable: true, sortValue: (a) => a.published_at ?? a.publish_at ?? a.updated_at, render: (a) => (
            <div className="text-xs">
              {a.status === "draft" ? <span className="text-slate-500">edited {formatDateTime(a.updated_at)}</span>
                : <span>{a.status === "scheduled" ? "publishes" : "published"} {formatDateTime(a.published_at ?? a.publish_at)}</span>}
              {a.expires_at && <span className="block text-slate-500">expires {formatDateTime(a.expires_at)}</span>}
            </div>) },
          { key: "progress", header: "Progress", render: (a) => (progress.loading && !progress.data ? "…" : <ProgressCell a={a} p={p[a.id]} />) },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (a) => (
            <span className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" onClick={() => setReading(a)} aria-label={`Read ${a.title}`}><Eye className="h-4 w-4" aria-hidden="true" /></Button>
              {canManage && (a.status === "draft" || a.status === "scheduled") && <Button size="sm" variant="secondary" onClick={() => setEditing({ announcement: a })}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button>}
              {canManage && a.status === "draft" && <Button size="sm" variant="success" onClick={() => setConfirm({ a, action: "publish" })}><Send className="h-4 w-4" aria-hidden="true" />Publish</Button>}
              {canManage && a.status === "scheduled" && <Button size="sm" variant="ghost" onClick={() => setConfirm({ a, action: "unschedule" })}><Undo2 className="h-4 w-4" aria-hidden="true" />Unschedule</Button>}
              {(a.status === "published" || a.status === "archived") && <Button size="sm" variant="secondary" onClick={() => setTracking(a)}><Users className="h-4 w-4" aria-hidden="true" />Track</Button>}
              {canManage && a.status === "draft" && <Button size="sm" variant="ghost" onClick={() => setConfirm({ a, action: "delete" })} aria-label={`Delete draft ${a.title}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>}
              {canManage && (a.status === "published" || a.status === "scheduled") && <Button size="sm" variant="ghost" onClick={() => setConfirm({ a, action: "archive" })} aria-label={`Archive ${a.title}`}><Archive className="h-4 w-4" aria-hidden="true" /></Button>}
            </span>) },
        ]} />

      {editing && <AnnouncementEditor announcement={editing.announcement} employees={employees} canPublish={canManage} onClose={() => setEditing(null)} onSaved={onChanged} />}
      {tracking && <TrackingModal announcement={tracking} canManage={canManage} onClose={() => setTracking(null)} onChanged={progress.reload} />}
      {reading && (
        <Modal open onClose={() => setReading(null)} title={reading.title} size="lg" footer={<Button variant="secondary" onClick={() => setReading(null)}>Close</Button>}>
          <p className="mb-3 flex flex-wrap items-center gap-1 text-xs text-slate-500"><CategoryBadge category={reading.category} />{audienceSummary(reading)}</p>
          <div className="whitespace-pre-wrap break-words text-sm text-slate-800">{reading.body}</div>
        </Modal>
      )}
      <ConfirmDialog open={Boolean(confirm)} onClose={() => setConfirm(null)} title={act?.title} confirmLabel={act?.label} tone={act?.tone}
        message={confirm ? act.message(confirm.a) : ""}
        onConfirm={async () => {
          const res = await act.run(confirm.a.id);
          if (!res.error) { notify(act.done(res)); onChanged(); }
          return res;
        }} />
    </>
  );
}
