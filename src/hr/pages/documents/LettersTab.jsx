// Letter generation (appointment / contract / experience / confirmation /
// internship / relieving) from APPROVED templates, with preview and PDF,
// plus filing of accepted Recruitment offer letters. The server renders
// the text from an allow-list of placeholders; compensation fields are
// shown and accepted only for documents.compensation holders.
import { useMemo, useState } from "react";
import { Download, Eye, FileCheck2, FileSignature, Send } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, useHrQuery } from "@/lib/hr/client";
import {
  CONTRACT_TYPES, LETTER_INPUTS, TEMPLATE_TYPES, fileOfferLetter, issueLetter, letterPdf, listTemplates, offerLettersForDocuments,
  previewLetter, searchDocuments,
} from "@/lib/hr/documentCenter";
import { downloadPdf } from "@/lib/hr/pdf";
import { from, run } from "@/lib/hr/client";
import {
  Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal, Select, StatusBadge, Textarea, useToast,
} from "@/hr/ui";
import { LetterText } from "@/hr/pages/DocumentsPage";
import DirectoryTab from "./DirectoryTab";

const typeLabel = (t) => TEMPLATE_TYPES.find((x) => x.value === t)?.label ?? t;

function GenerateLetter({ employees, onIssued }) {
  const { notify } = useToast();
  const { hasPermission } = useAuth();
  const canComp = hasPermission("documents.compensation");
  const templates = useHrQuery(() => listTemplates(), []);
  const usable = (templates.data ?? []).filter((t) => t.approved_version && t.status !== "archived" && (canComp || !t.includes_compensation));
  const [templateId, setTemplateId] = useState("");
  const [employee, setEmployee] = useState("");
  const [values, setValues] = useState({});
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const tpl = usable.find((t) => t.id === templateId);
  const isContract = tpl?.template_type === "employment_contract";
  const contracts = useHrQuery(() => (employee && isContract ? searchDocuments({ employee, group: "contract" }, 1, 50) : Promise.resolve({ data: [] })), [employee, isContract]);
  const usedKeys = useMemo(() => new Set(Array.from(`${tpl?.title ?? ""}\n${tpl?.body ?? ""}`.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g), (m) => m[1])), [tpl]);
  const inputs = LETTER_INPUTS.filter((i) => usedKeys.has(i.key) || i.key === "issue_date").filter((i) => !i.comp || canComp);
  const set = (k) => (e) => { setPreview(null); setValues((s) => ({ ...s, [k]: e.target.value })); };
  const reset = () => { setPreview(null); setError(null); };

  async function doPreview() {
    if (!tpl || !employee) { setError("Choose a template and an employee."); return; }
    setBusy("preview"); setError(null);
    const res = await previewLetter(tpl.id, employee, values);
    setBusy(null);
    if (res.error) { setError(res.error); setPreview(null); return; }
    setPreview(res.data);
  }
  async function doIssue() {
    setBusy("issue"); setError(null);
    const res = await issueLetter(tpl.id, employee, values);
    setBusy(null);
    if (res.error) {
      setError(res.error + (res.pendingDocument ? " Open the document in the directory and choose “Store PDF” to finish." : ""));
      return { error: res.error };
    }
    notify(`${tpl.name} issued (v${res.data.version}). The employee is notified.`);
    setPreview(null); setValues({});
    onIssued?.();
    return {};
  }

  return (
    <Card title="Generate a letter" actions={<span className="text-xs text-slate-500">Uses the latest approved template version</span>}>
      {templates.loading && !templates.data ? <Loading /> : templates.error ? <ErrorState message={templates.error} onRetry={templates.reload} /> : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <Field label="Template" required>
              <Select placeholder="Choose a template" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setValues({}); reset(); }}
                options={usable.map((t) => ({ value: t.id, label: `${t.name} · ${typeLabel(t.template_type)} (v${t.approved_version})${t.includes_compensation ? " · compensation" : ""}` }))} />
            </Field>
            <Field label="Employee" required>
              <Select placeholder="Choose an employee" value={employee} onChange={(e) => { setEmployee(e.target.value); reset(); }} options={employees ?? []} />
            </Field>
            {tpl && <p className="text-xs text-slate-500">Name, ID, department, designation, joining date, employment type, manager and dates come from the employee record (Employee Management). Fill in only what the letter needs below.</p>}
            {isContract && (
              <Field label="Renews contract" hint="Optional — the selected contract is kept and marked replaced.">
                <Select placeholder="New contract (no renewal)" value={values.renews_document_id ?? ""} onChange={set("renews_document_id")}
                  options={(contracts.data ?? []).filter((c) => c.verification_status !== "replaced").map((c) => ({ value: c.id, label: `${c.title} (v${c.current_version})` }))} />
              </Field>
            )}
            {tpl && inputs.map((i) => (
              <Field key={i.key} label={i.label} hint={i.comp ? "Restricted: visible only to authorised HR and the employee." : undefined}>
                {i.type === "textarea" ? <Textarea rows={4} maxLength={6000} value={values[i.key] ?? ""} onChange={set(i.key)} />
                  : i.type === "date" ? <Input type="date" value={values[i.key] ?? ""} onChange={set(i.key)} />
                  : i.type === "contract_type" ? <Select placeholder="From employee record" value={values[i.key] ?? ""} onChange={set(i.key)} options={CONTRACT_TYPES.map((x) => ({ value: x, label: x.replace(/_/g, " ") }))} />
                  : <Input value={values[i.key] ?? ""} maxLength={200} onChange={set(i.key)} />}
              </Field>
            ))}
            <InlineError message={error} />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" loading={busy === "preview"} disabled={!tpl || !employee} onClick={doPreview}><Eye className="h-4 w-4" aria-hidden="true" />Preview</Button>
              <Button disabled={!preview || preview.missing?.length > 0} onClick={() => setConfirm(true)}><FileSignature className="h-4 w-4" aria-hidden="true" />Issue letter</Button>
            </div>
          </div>
          <div>
            {!preview ? <EmptyState icon={Eye} title="Preview" description="Choose a template and an employee, then preview the exact text that will be issued." /> : (
              <div className="flex flex-col gap-2">
                {preview.missing?.length > 0 && <InlineError message={`Missing: ${preview.missing.map((m) => m.replace(/_/g, " ")).join(", ")}. Fill these in (or complete the employee record) before issuing.`} />}
                {preview.reissue_of && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">This employee already has this letter; issuing creates version {preview.reissue_version}. Earlier versions are kept.</p>}
                {preview.includes_compensation && <Badge tone="violet">contains compensation — restricted</Badge>}
                <LetterText letter={{ ...preview, template_name: tpl?.name, template_version: preview.template_version }} />
                <Button variant="secondary" size="sm" className="self-start" onClick={() => downloadPdf(letterPdf({ ...preview, date: values.issue_date }), `PREVIEW-${(preview.title || "letter").replace(/[^A-Za-z0-9]+/g, "_")}`)}>
                  <Download className="h-4 w-4" aria-hidden="true" />Preview PDF
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Issue letter" confirmLabel="Issue"
        message={`Issue "${preview?.title}"? The text is stored permanently, the PDF is saved to the employee's documents${tpl?.requires_acknowledgement ? " and the employee is asked to acknowledge receipt" : ""}.`}
        onConfirm={doIssue} />
    </Card>
  );
}

function OfferLetters({ canManage }) {
  const { notify } = useToast();
  const { hasPermission } = useAuth();
  const canFile = canManage && hasPermission("documents.compensation");
  const canRead = hasPermission("recruitment.manage");
  const q = useHrQuery(() => offerLettersForDocuments(), []);
  const [view, setView] = useState(null);
  const [filing, setFiling] = useState(null);
  const letter = useHrQuery(() => (view && canRead ? run(from("hr_offer_letter_versions").select("version, subject, body, template_name, generated_at").eq("offer_id", view.offer_id).eq("version", view.current_version).maybeSingle()) : Promise.resolve({ data: null })), [view?.offer_id, view?.current_version]);
  if (q.error) return <Card title="Offer letters (Recruitment)"><ErrorState message={q.error} onRetry={q.reload} /></Card>;
  if (q.data && !q.data.available) return null;
  return (
    <Card title="Offer letters (Recruitment)" actions={<span className="text-xs text-slate-500">Status and acceptance are recorded in Recruitment</span>}>
      <p className="mb-3 text-sm text-slate-600">Offers, their templates, issue and acceptance stay in Recruitment & Hiring. Once a candidate has <strong>accepted</strong> and been converted to an employee, file the letter to the employee's documents — once per letter version, as a compensation-restricted record.</p>
      <DataTable caption="Offer letters" rowKey="offer_id" rows={q.data?.rows} loading={q.loading} emptyTitle="No offer letters yet" emptyDescription="Offer letters generated in Recruitment appear here."
        columns={[
          { key: "candidate_name", header: "Candidate", render: (r) => <div><p className="font-semibold text-[#101a3a]">{r.candidate_name}</p><p className="text-xs text-slate-500">{r.job_title}</p></div> },
          { key: "status", header: "Offer status", render: (r) => <StatusBadge status={r.status === "sent" ? "issued" : r.status === "declined" ? "rejected" : r.status} /> },
          { key: "current_version", header: "Letter", render: (r) => `v${r.current_version}${r.issued_on ? ` · issued ${formatDate(r.issued_on)}` : ""}${r.expires_on ? ` · valid until ${formatDate(r.expires_on)}` : ""}` },
          { key: "employee_code", header: "Employee", render: (r) => r.employee_code ?? <span className="text-xs text-slate-500">not hired yet</span> },
          { key: "document_id", header: "Filed", render: (r) => (r.document_id ? <Badge tone="green">filed v{r.document_version}</Badge> : "—") },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => (
            <span className="flex flex-wrap gap-1">
              {canRead && <Button size="sm" variant="ghost" onClick={() => setView(r)}><Eye className="h-4 w-4" aria-hidden="true" />Preview</Button>}
              {canFile && r.status === "accepted" && r.employee_id && <Button size="sm" variant="secondary" onClick={() => setFiling(r)}><FileCheck2 className="h-4 w-4" aria-hidden="true" />File to employee</Button>}
            </span>) },
        ]} />
      {view && (
        <Modal open onClose={() => setView(null)} title={`Offer letter · ${view.candidate_name}`} size="lg"
          footer={<>
            <Button variant="secondary" onClick={() => setView(null)}>Close</Button>
            {letter.data && <Button variant="secondary" onClick={() => downloadPdf(letterPdf({ title: letter.data.subject, body: letter.data.body, reference: `OFFER v${letter.data.version}` }), `Offer_${view.candidate_name}`)}><Download className="h-4 w-4" aria-hidden="true" />Download PDF</Button>}
          </>}>
          {letter.loading ? <Loading /> : letter.error ? <ErrorState message={letter.error} /> : letter.data
            ? <LetterText letter={{ title: letter.data.subject, body: letter.data.body, reference: `Offer v${letter.data.version}`, template_name: letter.data.template_name }} />
            : <EmptyState title="Letter text not available" />}
        </Modal>
      )}
      <ConfirmDialog open={Boolean(filing)} onClose={() => setFiling(null)} title="File offer letter" confirmLabel="File"
        message={filing ? `File offer letter v${filing.current_version} for ${filing.candidate_name} (${filing.employee_code}) to their employee documents? The offer itself is not changed.` : ""}
        onConfirm={async () => {
          const res = await fileOfferLetter(filing.offer_id);
          if (!res.error) { notify("Offer letter filed to the employee's documents."); q.reload(); }
          return res;
        }} />
    </Card>
  );
}

export default function LettersTab({ employees, categories, canManage, myEmployeeId }) {
  const { hasPermission } = useAuth();
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-col gap-4">
      <GenerateLetter employees={employees} onIssued={() => setKey((k) => k + 1)} />
      {(hasPermission("recruitment.manage") || hasPermission("documents.compensation")) && <OfferLetters canManage={canManage} />}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-[#101a3a]"><Send className="h-4 w-4" aria-hidden="true" />Issued letters</h3>
        <DirectoryTab key={key} employees={employees} categories={categories} canManage={canManage} myEmployeeId={myEmployeeId} preset={{ source: "generated" }} mode="letters" />
      </div>
    </div>
  );
}
