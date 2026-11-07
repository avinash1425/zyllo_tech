// Training assignment actions (HR / reporting-line manager): assign a course
// or a program, record completion, verify / return a self-reported
// completion, record a certificate, renew, cancel. Every action is an RPC;
// the server re-checks scope (HR anyone, manager reporting line, never self).
import { useState } from "react";
import { formatDate, useHrQuery } from "@/lib/hr/client";
import {
  RESULTS, assignProgram, assignTraining, cancelTraining, completeTraining, listCertificateDocuments, recordCertificate, renewTraining, reviewCompletion,
} from "@/lib/hr/training";
import { certificateExpiry } from "@/lib/hr/trainingRules";
import { Button, Checkbox, ConfirmDialog, DescriptionList, Field, InlineError, Input, Modal, Select, Textarea, useToast } from "@/hr/ui";
import { ActionModal, DocButton, EmployeePicker, FileField, courseText, empText, opts, today, uploadTrainingFile } from "./shared";

export function AssignModal({ courses, programs, employees, myEmployeeId, initial = {}, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ mode: initial.program ? "program" : "course", course: initial.course ?? "", program: initial.program ?? "", employees: initial.employees ?? [], due: "", notes: "" });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const activeCourses = (courses ?? []).filter((c) => c.active);
  const activePrograms = (programs ?? []).filter((p) => p.active);
  return (
    <ActionModal title="Assign training" submitLabel="Assign" size="lg" onClose={onClose}
      onSubmit={async () => {
        if (v.mode === "course" && !v.course) return { error: "Choose a course." };
        if (v.mode === "program" && !v.program) return { error: "Choose a program." };
        if (!v.employees.length) return { error: "Choose at least one employee." };
        if (v.due && v.due < today()) return { error: "The due date is in the past." };
        const res = v.mode === "course" ? await assignTraining(v.course, v.employees, v.due, v.notes) : await assignProgram(v.program, v.employees, v.due, v.notes);
        if (res.error) return res;
        notify(res.data ? `${res.data} assignment(s) created. Employees already holding an open assignment were skipped.` : "Nothing new: every selected employee already has an open assignment.");
        onDone(); return {};
      }}>
      {activePrograms.length > 0 && (
        <Field label="Assign">
          <Select value={v.mode} onChange={set("mode")} options={[{ value: "course", label: "A single course" }, { value: "program", label: "A program (all of its courses)" }]} />
        </Field>
      )}
      {v.mode === "course"
        ? <Field label="Course" required><Select placeholder="Choose a course" value={v.course} onChange={set("course")} options={activeCourses.map((c) => ({ value: c.id, label: `${courseText(c)}${c.is_mandatory ? " (mandatory)" : ""}` }))} /></Field>
        : <Field label="Program" required><Select placeholder="Choose a program" value={v.program} onChange={set("program")} options={activePrograms.map((p) => ({ value: p.id, label: `${p.code} · ${p.title} (${p.courses?.length ?? 0} courses)` }))} /></Field>}
      <Field label="Employees" required hint="Managers can assign only to their reporting line; nobody assigns training to themselves.">
        {() => <EmployeePicker options={employees} value={v.employees} onChange={(list) => setV((s) => ({ ...s, employees: list }))} exclude={myEmployeeId ? [myEmployeeId] : []} />}
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Due date" hint="Optional"><Input type="date" min={today()} value={v.due} onChange={set("due")} /></Field>
      </div>
      <Field label="Notes"><Textarea value={v.notes} onChange={set("notes")} maxLength={2000} /></Field>
    </ActionModal>
  );
}

function CertificatePicker({ employeeId, value, onChange, file, onFile, canUpload }) {
  const docs = useHrQuery(() => listCertificateDocuments(employeeId), [employeeId]);
  return (
    <>
      <Field label="Existing certificate document" hint={docs.error ? docs.error : "Training certificates already in the employee's documents."}>
        <Select placeholder={docs.loading ? "Loading…" : "— None —"} value={value} onChange={(e) => onChange(e.target.value)}
          options={(docs.data ?? []).map((d) => ({ value: d.id, label: `${d.title} (${formatDate(d.created_at)})` }))} />
      </Field>
      {canUpload && !value && <FileField label="…or upload the certificate" onChange={onFile} />}
      {file && <p className="text-xs text-slate-500">Will upload: {file.name}</p>}
    </>
  );
}

export function CompleteModal({ row, canUpload, onClose, onDone }) {
  const { notify } = useToast();
  const c = row.course ?? {};
  const [v, setV] = useState({ completion_date: today(), result: "passed", score: "", certificate_document_id: "", notes: "" });
  const [file, setFile] = useState(null);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const exp = certificateExpiry(v.completion_date, c.validity_months, v.result);
  return (
    <ActionModal title={`Record completion — ${c.title ?? "training"}`} submitLabel="Record completion" onClose={onClose} size="md"
      onSubmit={async () => {
        if (!v.completion_date || v.completion_date > today()) return { error: "Enter a completion date that is not in the future." };
        if (v.score !== "" && !(Number(v.score) >= 0 && Number(v.score) <= 100)) return { error: "The score must be between 0 and 100." };
        if (c.pass_score != null && v.result === "passed" && v.score !== "" && Number(v.score) < Number(c.pass_score)) return { error: `The score is below the pass mark of ${c.pass_score}.` };
        let certId = v.certificate_document_id;
        if (!certId && file) {
          const up = await uploadTrainingFile(row.employee_id, file, `${c.title} certificate`);
          if (up.error && !up.id) return { error: up.error };
          certId = up.id;
        }
        if (c.certificate_required && v.result === "passed" && !certId) return { error: "This course requires a certificate: choose or upload it." };
        const res = await completeTraining(row.id, { ...v, certificate_document_id: certId });
        if (res.error) return res;
        notify("Completion recorded and verified."); onDone(); return {};
      }}>
      <p className="text-sm text-slate-600">{empText(row.employee)} · {courseText(c)}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Completed on" required><Input type="date" max={today()} value={v.completion_date} onChange={set("completion_date")} /></Field>
        <Field label="Result" required><Select value={v.result} onChange={set("result")} options={opts(RESULTS)} /></Field>
        <Field label="Score (%)" hint={c.pass_score != null ? `Pass mark ${c.pass_score}` : "Optional"}><Input type="number" min={0} max={100} step="0.01" value={v.score} onChange={set("score")} /></Field>
      </div>
      <CertificatePicker employeeId={row.employee_id} value={v.certificate_document_id} onChange={(id) => setV((s) => ({ ...s, certificate_document_id: id }))} file={file} onFile={setFile} canUpload={canUpload} />
      <p className="text-xs text-slate-500">{exp ? `Certificate / recertification expiry: ${formatDate(exp)} (${c.validity_months} months).` : "No expiry for this result / course."}</p>
      <Field label="Notes"><Textarea value={v.notes} onChange={set("notes")} maxLength={2000} /></Field>
    </ActionModal>
  );
}

export function ReviewModal({ row, onClose, onDone }) {
  const { notify } = useToast();
  const c = row.course ?? {};
  const [v, setV] = useState({ result: row.result ?? "passed", score: row.score ?? "", note: "" });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function go(approve) {
    if (!approve && v.note.trim().length < 3) { setError("Tell the employee why the completion is returned."); return; }
    setBusy(approve ? "verify" : "return"); setError(null);
    const res = await reviewCompletion(row.id, approve, approve ? { note: v.note, result: v.result, score: v.score } : { note: v.note });
    setBusy(null);
    if (res.error) { setError(res.error); return; }
    notify(approve ? "Completion verified." : "Completion returned to the employee."); onDone();
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title="Verify training completion" size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={Boolean(busy)}>Cancel</Button>
        <Button variant="danger" loading={busy === "return"} disabled={Boolean(busy)} onClick={() => go(false)}>Return</Button>
        <Button variant="success" loading={busy === "verify"} disabled={Boolean(busy)} onClick={() => go(true)}>Verify</Button>
      </>}>
      <div className="flex flex-col gap-3">
        <DescriptionList items={[
          { label: "Employee", value: empText(row.employee) },
          { label: "Course", value: courseText(c) },
          { label: "Completed on", value: formatDate(row.completion_date) },
          { label: "Submitted", value: formatDate(row.submitted_at) },
          { label: "Claimed result", value: `${row.result ?? "—"}${row.score != null ? ` · ${row.score}%` : ""}` },
          { label: "Pass mark", value: c.pass_score ?? "—" },
          { label: "Evidence note", value: row.evidence_note ?? "—" },
          { label: "Certificate no.", value: row.certificate_number ?? "—" },
        ]} />
        <div className="flex flex-wrap gap-2">
          {row.evidence && <DocButton doc={row.evidence}>Evidence: {row.evidence.title}</DocButton>}
          {row.certificate && <DocButton doc={row.certificate}>Certificate: {row.certificate.title}</DocButton>}
          {!row.evidence && !row.certificate && row.evidence_document_id && <p className="text-xs text-slate-500">An evidence file is attached but you cannot open it (documents access).</p>}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Result (correct if needed)"><Select value={v.result} onChange={set("result")} options={opts(RESULTS)} /></Field>
          <Field label="Score (%)"><Input type="number" min={0} max={100} step="0.01" value={v.score ?? ""} onChange={set("score")} /></Field>
        </div>
        <Field label="Note" hint="Required when returning; shown to the employee."><Textarea value={v.note} onChange={set("note")} maxLength={1000} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

export function CertificateModal({ row, canUpload, onClose, onDone }) {
  const { notify } = useToast();
  const c = row.course ?? {};
  const [v, setV] = useState({ document_id: "", number: row.certificate_number ?? "", issued_on: row.certificate_issued_on ?? row.completion_date ?? today(), expiry: "", override: false });
  const [file, setFile] = useState(null);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const auto = certificateExpiry(v.issued_on, c.validity_months, "passed");
  return (
    <ActionModal title="Certificate details" submitLabel="Save certificate" onClose={onClose} size="md"
      onSubmit={async () => {
        if (v.issued_on > today()) return { error: "The issue date cannot be in the future." };
        if (v.override && v.expiry && v.expiry <= v.issued_on) return { error: "The expiry date must be after the issue date." };
        let doc = v.document_id;
        if (!doc && file) {
          const up = await uploadTrainingFile(row.employee_id, file, `${c.title} certificate`);
          if (up.error && !up.id) return { error: up.error };
          doc = up.id;
        }
        if (!doc && !v.number.trim() && !row.certificate_document_id && !row.certificate_number) return { error: "Attach the certificate file or enter its number." };
        const res = await recordCertificate(row.id, { document_id: doc, number: v.number, issued_on: v.issued_on, expiry: v.override ? v.expiry : null });
        if (res.error) return res;
        notify("Certificate recorded."); onDone(); return {};
      }}>
      <p className="text-sm text-slate-600">{empText(row.employee)} · {courseText(c)}</p>
      {row.certificate && <p className="text-sm">Current file: <DocButton doc={row.certificate} /></p>}
      <CertificatePicker employeeId={row.employee_id} value={v.document_id} onChange={(id) => setV((s) => ({ ...s, document_id: id }))} file={file} onFile={setFile} canUpload={canUpload} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Certificate number"><Input value={v.number} maxLength={80} onChange={set("number")} /></Field>
        <Field label="Issued on"><Input type="date" max={today()} value={v.issued_on} onChange={set("issued_on")} /></Field>
      </div>
      <Checkbox label="Set the expiry date by hand" checked={v.override} onChange={(e) => setV((s) => ({ ...s, override: e.target.checked }))} />
      {v.override
        ? <Field label="Expiry date"><Input type="date" min={v.issued_on} value={v.expiry} onChange={set("expiry")} /></Field>
        : <p className="text-xs text-slate-500">{auto ? `Expiry from the course validity (${c.validity_months} months): ${formatDate(auto)}.` : "The course has no validity period: no expiry."}</p>}
    </ActionModal>
  );
}

export function RenewModal({ row, onClose, onDone }) {
  const { notify } = useToast();
  const [due, setDue] = useState(row.certificate_expiry && row.certificate_expiry > today() ? row.certificate_expiry : today());
  return (
    <ActionModal title="Assign recertification" submitLabel="Assign renewal" onClose={onClose}
      onSubmit={async () => {
        if (!due || due < today()) return { error: "Choose a due date from today on." };
        const res = await renewTraining(row.id, due);
        if (res.error) return res;
        notify("Renewal assigned (or the open renewal kept)."); onDone(); return {};
      }}>
      <p className="text-sm text-slate-600">{empText(row.employee)} · {courseText(row.course)} · certificate expires {formatDate(row.certificate_expiry)}</p>
      <Field label="Due date" required><Input type="date" min={today()} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      <p className="text-xs text-slate-500">A new assignment linked to this completion is created. If one is already open, it is kept.</p>
    </ActionModal>
  );
}

export function CancelDialog({ row, onClose, onDone }) {
  const { notify } = useToast();
  return (
    <ConfirmDialog open onClose={onClose} tone="danger" title="Cancel training assignment" confirmLabel="Cancel assignment" requireReason reasonLabel="Reason"
      message={`${empText(row.employee)} · ${courseText(row.course)}. The employee keeps the history; you can assign it again later.`}
      onConfirm={async (reason) => { const res = await cancelTraining(row.id, reason); if (!res.error) { notify("Assignment cancelled."); onDone(); } return res; }} />
  );
}
