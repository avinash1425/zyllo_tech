// Offers: every offer (recruitment.manage) with status filter, expiry of
// overdue offers, and offer letter templates (create / edit -> draft,
// approve or archive by an HR administrator). Letters are generated per
// offer on the application page.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, TimerReset } from "lucide-react";
import { formatDate, formatDateTime, formatMoney, useHrQuery } from "@/lib/hr/client";
import {
  OFFER_PLACEHOLDERS, OFFER_STATUS_LABELS, expireOverdueOffers, listAllOffers, listOfferTemplates, offerStatusLabel, saveOfferTemplate,
  setOfferTemplateStatus,
} from "@/lib/hr/recruitmentHiring";
import { Badge, Button, Checkbox, ConfirmDialog, DataTable, Field, InlineError, Input, Modal, SearchInput, Select, Tabs, Textarea, Toolbar, useToast } from "@/hr/ui";
import { useRecruitmentPerms } from "./ApplicationPanels";

const offerTone = (s) => ({ draft: "slate", sent: "blue", accepted: "green", declined: "red", expired: "red", withdrawn: "slate" }[s] ?? "slate");

export default function OffersTab({ base }) {
  const p = useRecruitmentPerms();
  const [view, setView] = useState("offers");
  if (!p.manage) return <p className="text-sm text-slate-600">Offers and compensation are visible to recruitment managers only.</p>;
  return (
    <>
      <Tabs value={view} onChange={setView} label="Offer sections" tabs={[{ value: "offers", label: "Offers" }, { value: "templates", label: "Letter templates" }]} />
      {view === "offers" ? <OfferList base={base} /> : <TemplateList canApprove={p.approveTemplates} />}
    </>
  );
}

function OfferList({ base }) {
  const navigate = useNavigate();
  const { notify } = useToast();
  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [expiring, setExpiring] = useState(false);
  const q = useHrQuery(() => listAllOffers({ status }), [status]);
  const s = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter((o) => !s || `${o.application?.candidate?.full_name ?? ""} ${o.application?.opening?.title ?? ""}`.toLowerCase().includes(s));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const columns = [
    { key: "candidate", header: "Candidate", sortable: true, sortValue: (r) => r.application?.candidate?.full_name?.toLowerCase(), render: (r) => (
      <div className="min-w-[10rem]"><p className="font-semibold text-[#101a3a]">{r.application?.candidate?.full_name}</p><p className="text-xs text-slate-500">{r.application?.opening?.title}</p></div>) },
    { key: "designation", header: "Designation", render: (r) => r.designation?.name ?? "—" },
    { key: "annual_ctc", header: "Annual CTC", sortable: true, render: (r) => formatMoney(r.annual_ctc, r.currency || "INR") },
    { key: "proposed_joining_date", header: "Joining", sortable: true, render: (r) => formatDate(r.proposed_joining_date) },
    { key: "expires_on", header: "Valid until", sortable: true, render: (r) => (
      <span className={r.status === "sent" && r.expires_on && r.expires_on < today ? "font-semibold text-red-600" : ""}>{formatDate(r.expires_on)}</span>) },
    { key: "letter", header: "Letter", render: (r) => (r.current_version ? `v${r.current_version}${r.letter_stale ? " (out of date)" : ""}` : "—") },
    { key: "status", header: "Status", render: (r) => <Badge tone={offerTone(r.status)}>{offerStatusLabel(r.status)}</Badge> },
    { key: "created_at", header: "Created", sortable: true, render: (r) => formatDate(r.created_at) },
  ];
  return (
    <>
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search candidate or job…" label="Search offers" />
        <Select aria-label="Offer status" className="sm:w-48" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: "pending", label: "Pending (draft or issued)" }, { value: "", label: "All offers" }, ...Object.entries(OFFER_STATUS_LABELS).map(([value, label]) => ({ value, label }))]} />
        <Button variant="secondary" onClick={() => setExpiring(true)}><TimerReset className="h-4 w-4" aria-hidden="true" />Expire overdue offers</Button>
      </Toolbar>
      <DataTable caption="Offers" columns={columns} rows={rows} loading={q.loading} error={q.error} onRetry={q.reload}
        onRowClick={(r) => navigate(`${base}/applications/${r.application_id}`)} emptyTitle="No offers" emptyDescription="Offers are created from a selected candidate's page." />
      <ConfirmDialog open={expiring} onClose={() => setExpiring(false)} title="Expire overdue offers"
        message="Every issued offer whose validity date has passed is marked Expired. Each change is recorded in the candidate's history."
        confirmLabel="Expire offers" onConfirm={async () => { const res = await expireOverdueOffers(); if (!res.error) { notify(`${res.data ?? 0} offer(s) expired.`); q.reload(); } return res; }} />
    </>
  );
}

function TemplateList({ canApprove }) {
  const { notify } = useToast();
  const q = useHrQuery(listOfferTemplates, []);
  const [editing, setEditing] = useState(null);
  const [acting, setActing] = useState(null);   // { t, status }
  const [makeDefault, setMakeDefault] = useState(false);
  const columns = [
    { key: "name", header: "Template", sortable: true, render: (r) => <span className="font-semibold text-[#101a3a]">{r.name}{r.is_default && <Badge tone="orange" className="ml-2">default</Badge>}</span> },
    { key: "status", header: "Status", render: (r) => <Badge tone={r.status === "approved" ? "green" : r.status === "archived" ? "slate" : "amber"}>{r.status}</Badge> },
    { key: "approved_at", header: "Approved", render: (r) => formatDateTime(r.approved_at) },
    { key: "updated_at", header: "Updated", sortable: true, render: (r) => formatDateTime(r.updated_at) },
    { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (
      <span className="flex flex-wrap gap-1">
        {r.status !== "archived" && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(r); }}>Edit</Button>}
        {canApprove && r.status === "draft" && <Button size="sm" onClick={(e) => { e.stopPropagation(); setMakeDefault(false); setActing({ t: r, status: "approved" }); }}>Approve</Button>}
        {canApprove && r.status !== "archived" && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setActing({ t: r, status: "archived" }); }}>Archive</Button>}
      </span>) },
  ];
  return (
    <>
      <Toolbar><Button onClick={() => setEditing({})}><Plus className="h-4 w-4" aria-hidden="true" />New template</Button></Toolbar>
      <DataTable caption="Offer letter templates" columns={columns} rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} emptyTitle="No templates" />
      <p className="mt-2 text-xs text-slate-500">Only approved templates can generate offer letters. Editing a template sends it back to draft until an HR administrator approves it again.{!canApprove && " You can draft templates; approval needs HR settings access."}</p>
      {editing && <TemplateModal template={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); q.reload(); notify("Template saved as draft."); }} />}
      <ConfirmDialog open={Boolean(acting)} onClose={() => setActing(null)} tone={acting?.status === "archived" ? "danger" : "success"}
        title={acting?.status === "archived" ? "Archive template" : "Approve template"}
        message={acting ? (acting.status === "archived" ? `Archive "${acting.t.name}"? It can no longer be used for new letters. Existing letters are unchanged.` : (
          <span className="flex flex-col gap-2"><span>Approve "{acting.t.name}" for generating offer letters?</span>
            <Checkbox label="Make it the default template" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} /></span>)) : ""}
        confirmLabel={acting?.status === "archived" ? "Archive" : "Approve"}
        onConfirm={async () => { const res = await setOfferTemplateStatus(acting.t.id, acting.status, makeDefault); if (!res.error) { q.reload(); notify(acting.status === "archived" ? "Template archived." : "Template approved."); } return res; }} />
    </>
  );
}

function TemplateModal({ template, onClose, onSaved }) {
  const isNew = !template.id;
  const [v, setV] = useState({ name: template.name ?? "", subject: template.subject ?? "", body: template.body ?? "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    const unknown = [...`${v.subject} ${v.body}`.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]).filter((k) => !OFFER_PLACEHOLDERS.includes(k));
    if (!v.name.trim() || !v.subject.trim() || v.body.length < 20) { setError("Enter a name, a subject and a body of at least 20 characters."); return; }
    if (unknown.length) { setError(`Unknown placeholder(s): ${[...new Set(unknown)].join(", ")}.`); return; }
    setBusy(true); setError(null);
    const res = await saveOfferTemplate(template.id, v);
    setBusy(false);
    if (res.error) setError(res.error); else onSaved();
  }
  return (
    <Modal open onClose={onClose} title={isNew ? "New offer letter template" : `Edit ${template.name}`} size="xl"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save as draft</Button></>}>
      <div className="grid grid-cols-1 gap-3">
        <Field label="Name" required><Input value={v.name} onChange={set("name")} maxLength={120} /></Field>
        <Field label="Subject" required><Input value={v.subject} onChange={set("subject")} maxLength={200} /></Field>
        <Field label="Letter body" required><Textarea rows={16} value={v.body} onChange={set("body")} className="font-mono text-xs" /></Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">Placeholders: {OFFER_PLACEHOLDERS.map((k) => `{{${k}}}`).join(" ")}</p>
      {!isNew && template.status === "approved" && <p className="mt-1 text-xs font-medium text-amber-700">Saving changes sends this approved template back to draft.</p>}
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}
