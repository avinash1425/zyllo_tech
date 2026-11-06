// Company policies: Draft -> Published -> Archived. Published versions are
// immutable; editing a published policy opens a new draft version, and a
// newly published version needs a change summary and fresh acknowledgements.
import { useState } from "react";
import { Archive, Eye, FileUp, History, Plus, Send, Trash2 } from "lucide-react";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import {
  AUDIENCE_TYPES, POLICY_CATEGORIES, archivePolicy, discardPolicyDraft, getPolicyFileUrl, letterPdf, listPolicies, listPolicyVersions,
  publishPolicy, savePolicy, uploadPolicyFile,
} from "@/lib/hr/documentCenter";
import { downloadPdf } from "@/lib/hr/pdf";
import { toOptions, useOrg } from "@/lib/hr/org";
import {
  Badge, Button, Checkbox, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal, Select, StatusBadge, Textarea, Toolbar, useToast,
} from "@/hr/ui";

const catLabel = (c) => POLICY_CATEGORIES.find((x) => x.value === c)?.label ?? c;

export async function openPolicyPdf(version, notify, download = false) {
  const w = download ? null : window.open("", "_blank");
  if (w) { try { w.opener = null; } catch { /* ignore */ } }
  const res = await getPolicyFileUrl(version.storage_path, download, version.file_name);
  if (res.error) { w?.close(); notify(res.error, "error"); return; }
  if (w) w.location.href = res.data; else window.location.assign(res.data);
}

export function downloadPolicyText(policy, version) {
  downloadPdf(letterPdf({ title: `${policy.title} (version ${version.version})`, body: version.content ?? "", reference: `POLICY v${version.version} · effective ${version.effective_date ?? "—"}`, date: version.effective_date }),
    `${policy.title.replace(/[^A-Za-z0-9]+/g, "_")}_v${version.version}`);
}

export function MultiPick({ options, value, onChange, label }) {
  return (
    <fieldset className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 p-2">
      <legend className="px-1 text-xs font-semibold text-slate-600">{label}</legend>
      {options.map((o) => (
        <div key={o.value}><Checkbox label={o.label} checked={value.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((x) => x !== o.value))} /></div>
      ))}
      {!options.length && <p className="text-xs text-slate-500">Nothing to choose.</p>}
    </fieldset>
  );
}

function PolicyEditor({ policy, draft, employees, onClose, onSaved, defaultCategory = "general", noun = "policy" }) {
  const { notify } = useToast();
  const org = useOrg();
  const [v, setV] = useState({
    title: policy?.title ?? "", category: policy?.category ?? defaultCategory, requires_acknowledgement: policy?.requires_acknowledgement ?? true,
    employee_visible: policy?.employee_visible ?? true, audience_type: policy?.audience_type ?? "all",
    audience_ids: policy?.audience_ids ?? [], audience_codes: policy?.audience_codes ?? [],
    content: draft?.content ?? "", effective_date: draft?.effective_date ?? "", change_summary: draft?.change_summary ?? "",
  });
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const audienceOptions = v.audience_type === "departments" ? toOptions(org.data?.departments)
    : v.audience_type === "locations" ? toOptions(org.data?.locations)
    : v.audience_type === "employment_types" ? toOptions(org.data?.employmentTypes, "name", "code")
    : v.audience_type === "employees" ? (employees ?? []) : [];
  const published = (policy?.current_version ?? 0) > 0;

  async function save() {
    if (file && !/\.pdf$/i.test(file.name)) { setError("Policy files must be PDF."); return; }
    setBusy(true); setError(null);
    const values = {
      title: v.title, category: v.category, requires_acknowledgement: v.requires_acknowledgement, employee_visible: v.employee_visible,
      audience_type: v.audience_type, audience_ids: v.audience_type === "employment_types" ? [] : v.audience_ids, audience_codes: v.audience_type === "employment_types" ? v.audience_codes : [],
      content: v.content, effective_date: v.effective_date || null, change_summary: v.change_summary || null,
    };
    const res = await savePolicy(policy?.id, values);
    if (res.error) { setBusy(false); setError(res.error); return; }
    if (file) {
      const up = await uploadPolicyFile(res.data.policy_id, file);
      if (up.error) { setBusy(false); setError(`Saved, but the PDF was not stored: ${up.error}`); onSaved(); return; }
    }
    setBusy(false);
    notify(published ? `Saved as draft version ${res.data.draft_version}. Publish it to replace the current version.` : "Policy saved as draft.");
    onSaved();
    onClose();
  }
  return (
    <Modal open onClose={onClose} title={policy ? `Edit ${noun} · ${policy.title}` : `New ${noun}`} size="xl"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={save}>Save draft</Button></>}>
      <div className="flex flex-col gap-3">
        {published && <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">Version {policy.current_version} is published and cannot be changed. Your edits go into a new draft version; employees keep seeing version {policy.current_version} until you publish.</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Title" required><Input value={v.title} maxLength={200} onChange={set("title")} /></Field>
          <Field label="Category"><Select value={v.category} onChange={set("category")} options={POLICY_CATEGORIES} /></Field>
          <Field label="Effective date"><Input type="date" value={v.effective_date} onChange={set("effective_date")} /></Field>
          <Field label="Target audience"><Select value={v.audience_type} onChange={(e) => setV((s) => ({ ...s, audience_type: e.target.value, audience_ids: [], audience_codes: [] }))} options={AUDIENCE_TYPES} /></Field>
        </div>
        {v.audience_type !== "all" && (
          org.loading ? <Loading /> : (
            <MultiPick label="Applies to" options={audienceOptions}
              value={v.audience_type === "employment_types" ? v.audience_codes : v.audience_ids}
              onChange={(next) => setV((s) => (s.audience_type === "employment_types" ? { ...s, audience_codes: next } : { ...s, audience_ids: next }))} />
          )
        )}
        <div className="flex flex-wrap gap-4">
          <Checkbox label="Employees must acknowledge" checked={v.requires_acknowledgement} onChange={set("requires_acknowledgement")} />
          <Checkbox label="Visible in the Employee Portal" checked={v.employee_visible} onChange={set("employee_visible")} />
        </div>
        <Field label="Policy text" hint="Plain text shown in the Employee Portal. Attach a PDF as well if needed."><Textarea rows={12} maxLength={100000} value={v.content} onChange={set("content")} /></Field>
        {published && <Field label="What changed in this version" required><Textarea rows={2} maxLength={1000} value={v.change_summary} onChange={set("change_summary")} /></Field>}
        <Field label={draft?.storage_path ? `Replace PDF (draft has ${draft.file_name})` : "Attach PDF (optional)"} hint="PDF only · max 10 MB">
          <Input type="file" accept=".pdf,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function VersionsModal({ policy, onClose }) {
  const { notify } = useToast();
  const q = useHrQuery(() => listPolicyVersions(policy.id), [policy.id]);
  const [open, setOpen] = useState(null);
  return (
    <Modal open onClose={onClose} title={`Policy history · ${policy.title}`} size="lg" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {q.loading ? <Loading /> : q.error ? <ErrorState message={q.error} /> : !q.data?.length ? <EmptyState title="No versions" /> : (
        <ul className="flex flex-col gap-2">
          {q.data.map((x) => (
            <li key={x.id} className="rounded-xl border border-slate-100 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><span className="font-semibold">v{x.version}</span> <StatusBadge status={x.status} /> <span className="text-xs text-slate-500">{x.published_at ? `published ${formatDateTime(x.published_at)}` : `created ${formatDateTime(x.created_at)}`}{x.effective_date ? ` · effective ${formatDate(x.effective_date)}` : ""}</span></span>
                <span className="flex gap-1">
                  {x.content && <Button size="sm" variant="ghost" onClick={() => setOpen(open === x.id ? null : x.id)}><Eye className="h-4 w-4" aria-hidden="true" />{open === x.id ? "Hide" : "Text"}</Button>}
                  {x.storage_path && <Button size="sm" variant="ghost" onClick={() => openPolicyPdf(x, notify)}><FileUp className="h-4 w-4" aria-hidden="true" />PDF</Button>}
                </span>
              </div>
              {x.change_summary && <p className="mt-1 text-xs text-slate-600">Changes: {x.change_summary}</p>}
              {open === x.id && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs">{x.content}</pre>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// scope: undefined = every policy (Documents module); "policies" = all but the
// handbook; "handbook" = only the employee handbook (Announcements & Policies).
const inScope = (scope) => (p) => (scope === "handbook" ? p.category === "handbook" : scope === "policies" ? p.category !== "handbook" : true);

export default function PoliciesTab({ canManage, employees, onNavigate, scope }) {
  const { notify } = useToast();
  const [status, setStatus] = useState("");
  const handbook = scope === "handbook";
  const noun = handbook ? "handbook" : "policy";
  const q = useHrQuery(async () => {
    const res = await listPolicies({ status });
    return res.error ? res : { ...res, data: res.data.filter(inScope(scope)) };
  }, [status, scope]);
  const [editing, setEditing] = useState(null);
  const [history, setHistory] = useState(null);
  const [publishing, setPublishing] = useState(null);
  const [confirm, setConfirm] = useState(null);   // { p, action: archive | discard }

  async function edit(p) {
    if (!p) { setEditing({ policy: null, draft: null }); return; }
    const res = await listPolicyVersions(p.id);
    if (res.error) { notify(res.error, "error"); return; }
    setEditing({ policy: p, draft: res.data.find((x) => x.status === "draft") ?? res.data.find((x) => x.status === "published") ?? null });
  }
  async function openPublish(p) {
    const res = await listPolicyVersions(p.id);
    if (res.error) { notify(res.error, "error"); return; }
    const draft = res.data.find((x) => x.status === "draft");
    if (!draft) { notify("There is no draft version to publish. Edit the policy first.", "error"); return; }
    setPublishing({ p, draft, summary: draft.change_summary ?? "" });
  }

  return (
    <>
      <Toolbar>
        <Select aria-label="Status" className="sm:w-48" placeholder="Any status" value={status} onChange={(e) => setStatus(e.target.value)} options={["draft", "published", "archived"].map((s) => ({ value: s, label: s }))} />
        <Button variant="ghost" onClick={() => onNavigate?.("acknowledgements")}>Acknowledgement tracking</Button>
        {canManage && <Button className="sm:ml-auto" onClick={() => edit(null)}><Plus className="h-4 w-4" aria-hidden="true" />{handbook ? "New handbook" : "New policy"}</Button>}
      </Toolbar>
      <DataTable caption={handbook ? "Employee handbook" : "Company policies"} rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload}
        emptyTitle={handbook ? "No handbook yet" : "No policies yet"}
        emptyDescription={handbook ? "Publish the employee handbook here. Each edit becomes a new version that employees acknowledge again." : undefined}
        columns={[
          { key: "title", header: "Policy", render: (p) => <div className="min-w-[12rem]"><p className="font-semibold text-[#101a3a]">{p.title}</p><p className="text-xs text-slate-500">{catLabel(p.category)} · {AUDIENCE_TYPES.find((a) => a.value === p.audience_type)?.label}{p.audience_type !== "all" ? ` (${(p.audience_type === "employment_types" ? p.audience_codes : p.audience_ids).length})` : ""}</p></div> },
          { key: "status", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
          { key: "current_version", header: "Published", render: (p) => (p.current_version ? `v${p.current_version} · ${formatDate(p.published_at)}` : "—") },
          { key: "flags", header: "Flags", render: (p) => <span className="flex flex-wrap gap-1">{p.requires_acknowledgement && <Badge>ack required</Badge>}{!p.employee_visible && <Badge tone="slate">hidden</Badge>}</span> },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (p) => (
            <span className="flex flex-wrap gap-1">
              {canManage && p.status !== "archived" && <Button size="sm" variant="secondary" onClick={() => edit(p)}>Edit</Button>}
              {canManage && p.status !== "archived" && <Button size="sm" variant="success" onClick={() => openPublish(p)}><Send className="h-4 w-4" aria-hidden="true" />Publish</Button>}
              <Button size="sm" variant="ghost" onClick={() => setHistory(p)}><History className="h-4 w-4" aria-hidden="true" />History</Button>
              {canManage && p.status === "published" && <Button size="sm" variant="ghost" onClick={() => setConfirm({ p, action: "discard" })} aria-label={`Discard draft of ${p.title}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>}
              {canManage && p.status !== "archived" && <Button size="sm" variant="ghost" onClick={() => setConfirm({ p, action: "archive" })} aria-label={`Archive ${p.title}`}><Archive className="h-4 w-4" aria-hidden="true" /></Button>}
            </span>) },
        ]} />
      {editing && <PolicyEditor policy={editing.policy} draft={editing.draft} employees={employees} onClose={() => setEditing(null)} onSaved={q.reload}
        defaultCategory={handbook ? "handbook" : "general"} noun={noun} />}
      {history && <VersionsModal policy={history} onClose={() => setHistory(null)} />}
      {publishing && (
        <ConfirmDialog open onClose={() => setPublishing(null)} title={`Publish version ${publishing.draft.version}`} confirmLabel="Publish" tone="success"
          requireReason={publishing.draft.version > 1 && !publishing.summary ? true : undefined} reasonLabel="What changed in this version"
          message={`"${publishing.p.title}" v${publishing.draft.version} becomes the current version${publishing.draft.version > 1 ? `; v${publishing.draft.version - 1} is kept in the history` : ""}. ${publishing.p.employee_visible ? "Everyone in the audience is notified" : "It is not visible to employees"}${publishing.p.requires_acknowledgement ? " and asked to acknowledge it" : ""}.`}
          onConfirm={async (reason) => {
            const res = await publishPolicy(publishing.p.id, reason || publishing.summary);
            if (!res.error) { notify(`Published. ${res.data} employee(s) notified.`); q.reload(); }
            return res;
          }} />
      )}
      <ConfirmDialog open={Boolean(confirm)} onClose={() => setConfirm(null)} tone="danger"
        title={confirm?.action === "archive" ? "Archive policy" : "Discard draft"} confirmLabel={confirm?.action === "archive" ? "Archive" : "Discard"}
        message={confirm?.action === "archive" ? "Employees will no longer see this policy. Its versions and acknowledgements are kept." : "Delete the unpublished draft version? The published version is unchanged."}
        onConfirm={async () => { const res = await (confirm.action === "archive" ? archivePolicy(confirm.p.id) : discardPolicyDraft(confirm.p.id)); if (!res.error) { notify(confirm.action === "archive" ? "Policy archived." : "Draft discarded."); q.reload(); } return res; }} />
    </>
  );
}
