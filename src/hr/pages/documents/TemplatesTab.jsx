// Letter templates: draft -> approved snapshot -> archived. Plain text with
// {{placeholders}} from a fixed allow-list (validated on the server; no
// template code runs). Editing an approved template opens a new draft
// revision while the last approved version stays in use.
import { useRef, useState } from "react";
import { Archive, CheckCircle2, Eye, History, Plus } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDateTime, useHrQuery } from "@/lib/hr/client";
import {
  COMPENSATION_KEYS, PLACEHOLDERS, TEMPLATE_TYPES, listOfferTemplates, listTemplateVersions, listTemplates, previewLetter, saveTemplate,
  setTemplateStatus,
} from "@/lib/hr/documentCenter";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal, Select, StatusBadge, Textarea, useToast,
} from "@/hr/ui";
import { LetterText } from "@/hr/pages/DocumentsPage";

const typeLabel = (t) => TEMPLATE_TYPES.find((x) => x.value === t)?.label ?? t;

function TemplateEditor({ template, categories, employees, onClose, onSaved }) {
  const { notify } = useToast();
  const { hasPermission } = useAuth();
  const canComp = hasPermission("documents.compensation");
  const [v, setV] = useState({
    name: template?.name ?? "", template_type: template?.template_type ?? "other_letter", category_code: template?.category_code ?? "hr_letter",
    title: template?.title ?? "", body: template?.body ?? "", requires_acknowledgement: Boolean(template?.requires_acknowledgement),
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewFor, setPreviewFor] = useState("");
  const bodyRef = useRef(null);
  const set = (k) => (e) => { setPreview(null); setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value })); };
  const cats = (categories ?? []).filter((c) => c.active && !c.is_confidential && c.doc_group !== "offer_letter");

  function insert(key) {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) { setV((s) => ({ ...s, body: s.body + token })); return; }
    const start = el.selectionStart ?? v.body.length;
    const end = el.selectionEnd ?? start;
    const next = v.body.slice(0, start) + token + v.body.slice(end);
    setV((s) => ({ ...s, body: next }));
    setPreview(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  }
  async function save() {
    setBusy(true); setError(null);
    const res = await saveTemplate(template?.id, v);
    setBusy(false);
    if (res.error) { setError(res.error); return null; }
    notify(template?.status === "approved" ? "Saved as a new draft revision. The approved version stays in use until this one is approved." : "Template saved as draft.");
    onSaved(res.data);
    return res.data;
  }
  async function doPreview() {
    setError(null);
    const id = await save();
    if (!id) return;
    const res = await previewLetter(id, previewFor || null, {}, true);
    if (res.error) setError(res.error); else setPreview(res.data);
  }
  return (
    <Modal open onClose={onClose} title={template ? `Edit template · ${template.name}` : "New template"} size="xl"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button><Button loading={busy} onClick={async () => { if (await save()) onClose(); }}>Save draft</Button></>}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-3 lg:col-span-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" required><Input value={v.name} maxLength={120} onChange={set("name")} /></Field>
            <Field label="Type" required><Select value={v.template_type} onChange={set("template_type")} options={TEMPLATE_TYPES} /></Field>
            <Field label="Stored in category" required hint="Where issued letters are filed."><Select value={v.category_code} onChange={set("category_code")} options={cats.map((c) => ({ value: c.code, label: c.name }))} /></Field>
            <Field label="Document title" required hint="May use placeholders, e.g. Appointment letter — {{employee_name}}"><Input value={v.title} maxLength={200} onChange={set("title")} /></Field>
          </div>
          <Field label="Letter text" required hint="Plain text. Use {{placeholder}} for merge fields; nothing else is interpreted.">
            <Textarea ref={bodyRef} rows={16} className="font-mono text-xs" maxLength={20000} value={v.body} onChange={set("body")} />
          </Field>
          <Checkbox label="Employees must acknowledge receipt of letters from this template" checked={v.requires_acknowledgement} onChange={set("requires_acknowledgement")} />
          <InlineError message={error} />
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Preview for" className="sm:w-72"><Select placeholder="Sample data" value={previewFor} onChange={(e) => setPreviewFor(e.target.value)} options={employees ?? []} /></Field>
            <Button variant="secondary" loading={busy} onClick={doPreview}><Eye className="h-4 w-4" aria-hidden="true" />Save & preview draft</Button>
          </div>
          {preview && (
            <div className="flex flex-col gap-2">
              {preview.missing?.length > 0 && <p className="text-xs text-amber-800">Not filled for this preview: {preview.missing.join(", ")} (supplied when issuing).</p>}
              <LetterText letter={{ ...preview, template_name: v.name, template_version: preview.template_version }} />
            </div>
          )}
        </div>
        <div>
          <p className="mb-2 text-sm font-bold text-[#101a3a]">Placeholders</p>
          <p className="mb-2 text-xs text-slate-500">Click to insert at the cursor.</p>
          <div className="flex flex-wrap gap-1.5">
            {PLACEHOLDERS.filter(([k]) => canComp || !COMPENSATION_KEYS.includes(k)).map(([k, l]) => (
              <button key={k} type="button" onClick={() => insert(k)} title={`{{${k}}}`}
                className={`rounded-lg border px-2 py-1 text-xs font-semibold ${COMPENSATION_KEYS.includes(k) ? "border-violet-200 bg-violet-50 text-violet-800" : "border-slate-200 bg-white text-[#173a52] hover:bg-slate-50"}`}>
                {l}
              </button>
            ))}
          </div>
          {!canComp && <p className="mt-3 text-xs text-slate-500">Compensation placeholders are available only to authorised HR users.</p>}
        </div>
      </div>
    </Modal>
  );
}

function VersionsModal({ template, onClose }) {
  const q = useHrQuery(() => listTemplateVersions(template.id), [template.id]);
  const [open, setOpen] = useState(null);
  return (
    <Modal open onClose={onClose} title={`Approved versions · ${template.name}`} size="lg" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {q.loading ? <Loading /> : q.error ? <ErrorState message={q.error} /> : !q.data?.length ? <EmptyState title="Never approved" /> : (
        <ul className="flex flex-col gap-2">
          {q.data.map((x) => (
            <li key={x.id} className="rounded-xl border border-slate-100 p-3">
              <button type="button" className="flex w-full items-center justify-between text-left text-sm" onClick={() => setOpen(open === x.id ? null : x.id)}>
                <span><span className="font-semibold">v{x.version}</span> · approved {formatDateTime(x.approved_at)}{x.version === template.approved_version && <Badge tone="green" className="ml-2">in use</Badge>}</span>
                <span className="text-xs text-slate-500">{open === x.id ? "Hide" : "Show text"}</span>
              </button>
              {open === x.id && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs">{x.title}{"\n\n"}{x.body}</pre>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export default function TemplatesTab({ categories, employees }) {
  const { notify } = useToast();
  const { hasPermission } = useAuth();
  const canApprove = hasPermission("settings.manage");
  const [archived, setArchived] = useState(false);
  const q = useHrQuery(() => listTemplates({ includeArchived: archived }), [archived]);
  const offers = useHrQuery(() => (hasPermission("recruitment.manage") ? listOfferTemplates() : Promise.resolve({ data: null })), []);
  const [editing, setEditing] = useState(null);   // template | {} for new
  const [versions, setVersions] = useState(null);
  const [confirm, setConfirm] = useState(null);   // { t, status }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-600">Only <strong>approved</strong> versions can be issued. {canApprove ? "You can approve templates." : "An HR administrator approves templates."}</p>
        <Checkbox label="Show archived" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
        <Button className="sm:ml-auto" onClick={() => setEditing({})}><Plus className="h-4 w-4" aria-hidden="true" />New template</Button>
      </div>
      <DataTable caption="Letter templates" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} emptyTitle="No templates"
        columns={[
          { key: "name", header: "Template", render: (t) => <div className="min-w-[12rem]"><p className="font-semibold text-[#101a3a]">{t.name}</p><p className="text-xs text-slate-500">{typeLabel(t.template_type)} · files to {(categories ?? []).find((c) => c.code === t.category_code)?.name ?? t.category_code}</p></div> },
          { key: "status", header: "Status", render: (t) => (
            <div className="flex flex-col items-start gap-1">
              <StatusBadge status={t.status} />
              {t.status === "draft" && t.approved_version && <span className="text-xs text-slate-500">draft v{t.current_version}; v{t.approved_version} in use</span>}
            </div>) },
          { key: "approved_version", header: "In use", render: (t) => (t.approved_version ? `v${t.approved_version}` : "—") },
          { key: "flags", header: "Flags", render: (t) => <span className="flex flex-wrap gap-1">{t.includes_compensation && <Badge tone="violet">compensation</Badge>}{t.requires_acknowledgement && <Badge>ack required</Badge>}</span> },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (t) => (
            <span className="flex flex-wrap gap-1">
              {t.status !== "archived" && <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>Edit</Button>}
              {canApprove && t.status === "draft" && <Button size="sm" variant="success" onClick={() => setConfirm({ t, status: "approved" })}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Approve</Button>}
              <Button size="sm" variant="ghost" onClick={() => setVersions(t)}><History className="h-4 w-4" aria-hidden="true" />Versions</Button>
              {t.status !== "archived" && <Button size="sm" variant="ghost" onClick={() => setConfirm({ t, status: "archived" })} aria-label={`Archive ${t.name}`}><Archive className="h-4 w-4" aria-hidden="true" /></Button>}
            </span>) },
        ]} />
      {offers.data && (
        <Card title="Offer letter templates (owned by Recruitment)">
          <p className="mb-2 text-sm text-slate-600">Offer letters are drafted, approved and issued in Recruitment & Hiring. They are listed here for reference only.</p>
          {!offers.data.length ? <EmptyState title="No offer templates" /> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {offers.data.map((o) => <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="font-semibold">{o.name}{o.is_default && <Badge tone="blue" className="ml-2">default</Badge>}</span><StatusBadge status={o.status} /></li>)}
            </ul>
          )}
        </Card>
      )}
      {editing && <TemplateEditor template={editing.id ? editing : null} categories={categories} employees={employees} onClose={() => setEditing(null)} onSaved={() => q.reload()} />}
      {versions && <VersionsModal template={versions} onClose={() => setVersions(null)} />}
      <ConfirmDialog open={Boolean(confirm)} onClose={() => setConfirm(null)} tone={confirm?.status === "archived" ? "danger" : "success"}
        title={confirm?.status === "archived" ? "Archive template" : "Approve template"} confirmLabel={confirm?.status === "archived" ? "Archive" : "Approve"}
        message={confirm?.status === "archived" ? "Archived templates cannot be used to issue letters. Letters already issued are unaffected." : `Approve version ${confirm?.t.current_version} of "${confirm?.t.name}"? New letters will use this text.`}
        onConfirm={async () => { const res = await setTemplateStatus(confirm.t.id, confirm.status); if (!res.error) { notify(confirm.status === "archived" ? "Template archived." : "Template approved."); q.reload(); } return res; }} />
    </div>
  );
}
