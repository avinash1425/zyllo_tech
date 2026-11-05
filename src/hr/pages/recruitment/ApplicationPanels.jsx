// Recruitment & Hiring panels for the application detail page and the
// interview lists: application facts, screening, notes, attachments, final
// decision, interview reschedule/cancel, structured evaluations, and offer
// letters (edit draft, generate from an approved template, versions, PDF,
// issue, email through the outbox, candidate response). Server RPCs from
// migration 120 enforce every rule; buttons only mirror the permissions.
import { useMemo, useState } from "react";
import { CalendarClock, Download, FileText, Mail, Paperclip, Plus, Send, Trash2, Upload } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, formatMoney, fullName, useHrQuery, from, run } from "@/lib/hr/client";
import { toOptions } from "@/lib/hr/org";
import { CANDIDATE_SOURCES, INTERVIEW_MODES, label as lbl, recordOfferResponse, resumeUrl, updateCandidate, withdrawOffer } from "@/lib/hr/recruitment";
import {
  ATTACHMENT_ACCEPT, ATTACHMENT_KINDS, EVAL_SCORES, OFFER_RESPONSE_OPTIONS, RECOMMENDATION_LABELS, addCandidateNote, archiveAttachment,
  attachmentUrl, emailState, generateOfferLetter, getApplicationCompensation, issueOffer, listAttachments, listCandidateNotes,
  listHiringDecisions, listOfferTemplates, listOfferVersions, listScreenings, logOfferLetterDownload, modeLabel, numOrNull, offerStatusLabel,
  queueOfferEmail, recommendationLabel, recordHiringDecision, recordScreening, reopenEvaluation, rescheduleInterview, saveEvaluation,
  sourceLabel, toList, updateApplication, updateInterviewStatus, updateOffer, uploadAttachment,
} from "@/lib/hr/recruitmentHiring";
import { downloadOfferLetterPdf } from "@/lib/hr/offerPdf";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, DescriptionList, EmptyState, ErrorState, Field, InlineError, Input, Loading, Modal,
  Select, StatusBadge, Textarea, useToast,
} from "@/hr/ui";

const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const opts = (list, labeler = lbl) => list.map((v) => ({ value: v, label: labeler(v) }));

/** Permission flags for recruitment screens (UI gating only). */
export function useRecruitmentPerms() {
  const { hasPermission, hr } = useAuth();
  return {
    me: hr?.employee?.id ?? null,
    recView: hasPermission("recruitment.view") || hasPermission("recruitment.manage"),
    manage: hasPermission("recruitment.manage"),
    convert: hasPermission("recruitment.convert"),
    reopen: hasPermission("recruitment.reopen"),
    approveTemplates: hasPermission("recruitment.manage") && hasPermission("settings.manage"),
    exportable: hasPermission("recruitment.export"),
  };
}

/** Assignment flags for one application (mirrors the server helpers). */
export function useAssignment(application) {
  const p = useRecruitmentPerms();
  const o = application?.opening ?? {};
  const assignedRecruiter = Boolean(p.me) && (application?.recruiter_id === p.me || o.recruiter_id === p.me);
  const hiringManager = Boolean(p.me) && o.hiring_manager_id === p.me;
  return { ...p, assignedRecruiter, hiringManager, canScreen: p.manage || assignedRecruiter, canDecide: p.manage || hiringManager, internal: p.recView || assignedRecruiter || hiringManager };
}

const stageBadgeTone = (s) => ({ applied: "slate", screening: "blue", shortlisted: "violet", interview: "violet", selected: "orange", offered: "amber", joined: "green", rejected: "red", withdrawn: "slate" }[s] ?? "slate");

// =====================================================================
// Application facts (+ edit)
// =====================================================================
export function ApplicationFactsCard({ application, employees, onChanged }) {
  const a = application;
  const c = a.candidate ?? {};
  const x = useAssignment(a);
  const comp = useHrQuery(() => (x.manage ? getApplicationCompensation(a.id) : Promise.resolve({ data: null, error: null })), [a.id, x.manage]);
  const [editing, setEditing] = useState(false);
  const { notify } = useToast();
  const salary = comp.data;
  return (
    <Card title="Application" actions={x.manage && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}>
      {a.on_hold && <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">On hold: {a.hold_reason}</p>}
      <DescriptionList items={[
        { label: "Application date", value: formatDate(a.applied_on ?? a.created_at) },
        { label: "Source", value: sourceLabel(a.source ?? c.source) },
        { label: "Recruiter", value: a.recruiter ? fullName(a.recruiter) : "Opening recruiter" },
        { label: "Mobile", value: c.phone },
        { label: "Current location", value: c.current_location },
        { label: "Notice period", value: c.notice_period_days != null ? `${c.notice_period_days} days` : null },
        { label: "Qualifications", value: c.qualifications ? <span className="whitespace-pre-wrap">{c.qualifications}</span> : null },
        { label: "Skills", value: c.skills?.length ? <span className="flex flex-wrap gap-1">{c.skills.map((s) => <Badge key={s} tone="blue">{s}</Badge>)}</span> : null },
        ...(x.manage ? [
          { label: "Expected salary", value: salary?.expected_salary != null ? formatMoney(salary.expected_salary, salary.currency) : null },
          { label: "Current salary", value: salary?.current_salary != null ? formatMoney(salary.current_salary, salary.currency) : null },
        ] : []),
      ]} />
      {comp.error && <div className="mt-2"><InlineError message={comp.error} /></div>}
      {editing && <ApplicationEditModal application={a} salary={salary} employees={employees} onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); comp.reload(); onChanged?.(); notify("Application updated."); }} />}
    </Card>
  );
}

function ApplicationEditModal({ application, salary, employees, onClose, onSaved }) {
  const a = application;
  const c = a.candidate ?? {};
  const [v, setV] = useState({
    full_name: c.full_name ?? "", phone: c.phone ?? "", current_company: c.current_company ?? "", experience_years: c.experience_years ?? "",
    skills: (c.skills ?? []).join(", "), qualifications: c.qualifications ?? "", current_location: c.current_location ?? "",
    notice_period_days: c.notice_period_days ?? "", recruiter_id: a.recruiter_id ?? "", source: a.source ?? c.source ?? "other",
    applied_on: a.applied_on ?? "", expected_salary: salary?.expected_salary ?? "", current_salary: salary?.current_salary ?? "", salary_currency: salary?.currency ?? "INR",
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    const errs = {};
    if (!v.full_name.trim()) errs.full_name = "Name is required.";
    if (v.phone && !/^[+0-9 ()-]{7,20}$/.test(v.phone)) errs.phone = "Use digits, spaces, + ( ) - only.";
    if (!isBlank(v.experience_years) && !(Number(v.experience_years) >= 0 && Number(v.experience_years) <= 60)) errs.experience_years = "0–60 years.";
    if (!isBlank(v.notice_period_days) && !(Number.isInteger(Number(v.notice_period_days)) && Number(v.notice_period_days) >= 0 && Number(v.notice_period_days) <= 365)) errs.notice_period_days = "0–365 days.";
    if (v.applied_on && v.applied_on > todayStr()) errs.applied_on = "Cannot be in the future.";
    for (const k of ["expected_salary", "current_salary"]) if (!isBlank(v[k]) && !(Number(v[k]) >= 0)) errs[k] = "Enter a non-negative amount.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const r1 = await updateCandidate(a.candidate_id, {
      full_name: v.full_name.trim(), phone: v.phone, current_company: v.current_company, experience_years: v.experience_years,
      skills: toList(v.skills, ","), qualifications: v.qualifications, current_location: v.current_location, notice_period_days: v.notice_period_days,
    });
    const r2 = r1.error ? r1 : await updateApplication(a.id, v, { includeSalary: true });
    setBusy(false);
    if (r2.error) setError(r2.error); else onSaved();
  }
  return (
    <Modal open onClose={onClose} title="Edit application" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Full name" required error={errors.full_name}><Input value={v.full_name} onChange={set("full_name")} /></Field>
        <Field label="Mobile" error={errors.phone}><Input type="tel" value={v.phone} onChange={set("phone")} /></Field>
        <Field label="Current company"><Input value={v.current_company} onChange={set("current_company")} /></Field>
        <Field label="Experience (years)" error={errors.experience_years}><Input type="number" min={0} max={60} step="0.5" value={v.experience_years} onChange={set("experience_years")} /></Field>
        <Field label="Current location"><Input value={v.current_location} onChange={set("current_location")} /></Field>
        <Field label="Notice period (days)" error={errors.notice_period_days}><Input type="number" min={0} max={365} value={v.notice_period_days} onChange={set("notice_period_days")} /></Field>
        <Field label="Skills" hint="Comma separated." className="sm:col-span-2"><Input value={v.skills} onChange={set("skills")} /></Field>
        <Field label="Qualifications" className="sm:col-span-2"><Textarea rows={2} value={v.qualifications} onChange={set("qualifications")} /></Field>
        <Field label="Application source"><Select value={v.source} onChange={set("source")} options={opts(CANDIDATE_SOURCES, sourceLabel)} /></Field>
        <Field label="Application date" error={errors.applied_on}><Input type="date" value={v.applied_on} max={todayStr()} onChange={set("applied_on")} /></Field>
        <Field label="Assigned recruiter" hint="Blank = the opening's recruiter." className="sm:col-span-2"><Select placeholder="— Opening recruiter —" value={v.recruiter_id} onChange={set("recruiter_id")} options={employees ?? []} /></Field>
        <Field label="Expected salary (annual)" error={errors.expected_salary} hint="Confidential: recruitment managers only."><Input type="number" min={0} step="1000" value={v.expected_salary} onChange={set("expected_salary")} /></Field>
        <Field label="Current salary (annual)" error={errors.current_salary}><Input type="number" min={0} step="1000" value={v.current_salary} onChange={set("current_salary")} /></Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">Email identifies the candidate and cannot be changed.</p>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

// =====================================================================
// Screening
// =====================================================================
export function ScreeningPanel({ application, onChanged }) {
  const a = application;
  const x = useAssignment(a);
  const q = useHrQuery(() => (x.internal ? listScreenings(a.id) : Promise.resolve({ data: [], error: null })), [a.id, x.internal]);
  const [open, setOpen] = useState(false);
  const { notify } = useToast();
  if (!x.internal) return null;
  const canScreen = x.canScreen && ["applied", "screening"].includes(a.stage);
  return (
    <Card title="Screening" actions={canScreen && <Button size="sm" onClick={() => setOpen(true)}>Screen candidate</Button>}>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !q.data?.length ? (
        <EmptyState title="Not screened yet" description={canScreen ? "Review the resume and record shortlist, hold or reject." : undefined} />
      ) : (
        <ol className="flex flex-col gap-3">
          {q.data.map((s) => (
            <li key={s.id} className="rounded-xl border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge tone={s.decision === "shortlist" ? "green" : s.decision === "reject" ? "red" : "amber"}>{lbl(s.decision)}</Badge>
                <span className="text-xs text-slate-500">{formatDateTime(s.decided_at)} · {fullName(s.reviewer) || "HR"}</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">Score {s.score ?? "—"}{s.score != null ? "/100" : ""} · Resume {s.resume_reviewed ? "reviewed" : "not reviewed"}</p>
              {s.reason && <p className="mt-1 text-xs"><span className="font-semibold">Reason:</span> {s.reason}</p>}
              {s.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">{s.notes}</p>}
              {(s.checklist?.length > 0 || s.answers?.length > 0) && (
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer font-semibold text-[#1f4693]">Checklist and answers</summary>
                  <ul className="mt-1 list-disc pl-5">
                    {(s.checklist ?? []).map((c, i) => <li key={`c${i}`}>{c.item}: <strong>{c.met ? "met" : "not met"}</strong></li>)}
                    {(s.answers ?? []).map((c, i) => <li key={`a${i}`}>{c.question} — {c.answer || "—"}</li>)}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
      {open && <ScreeningModal application={a} onClose={() => setOpen(false)} onDone={(d) => { setOpen(false); q.reload(); onChanged?.(); notify(`Screening recorded: ${lbl(d)}.`); }} />}
    </Card>
  );
}

function ScreeningModal({ application, onClose, onDone }) {
  const o = application.opening ?? {};
  const criteria = o.eligibility_criteria ?? [];
  const questions = o.screening_questions ?? [];
  const [v, setV] = useState({ resume_reviewed: false, score: "", notes: "", decision: "", reason: "", met: criteria.map(() => false), answers: questions.map(() => "") });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!v.decision) { setError("Choose shortlist, hold or reject."); return; }
    if (v.decision !== "shortlist" && !v.reason.trim()) { setError("Give a reason for this decision."); return; }
    if (!isBlank(v.score) && !(Number(v.score) >= 0 && Number(v.score) <= 100)) { setError("Score must be 0–100."); return; }
    setBusy(true); setError(null);
    const res = await recordScreening(application.id, {
      ...v, checklist: criteria.map((item, i) => ({ item, met: v.met[i] })), answers: questions.map((question, i) => ({ question, answer: v.answers[i].trim() })),
    });
    setBusy(false);
    if (res.error) setError(res.error); else onDone(v.decision);
  }
  return (
    <Modal open onClose={onClose} title={`Screen ${application.candidate?.full_name ?? "candidate"}`} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={v.decision === "reject" ? "danger" : "primary"} loading={busy} onClick={go}>Record decision</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox label="Resume reviewed" checked={v.resume_reviewed} onChange={(e) => setV((s) => ({ ...s, resume_reviewed: e.target.checked }))} />
          <ResumeLinks candidateId={application.candidate_id} legacyPath={application.candidate?.resume_path} />
        </div>
        <fieldset>
          <legend className="text-sm font-semibold text-[#173a52]">Eligibility checklist</legend>
          {criteria.length ? criteria.map((c, i) => (
            <div key={c} className="py-0.5"><Checkbox label={c} checked={v.met[i]} onChange={(e) => setV((s) => ({ ...s, met: s.met.map((m, j) => (j === i ? e.target.checked : m)) }))} /></div>
          )) : <p className="text-xs text-slate-500">No eligibility criteria on this opening. Add them when editing the opening.</p>}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold text-[#173a52]">Screening questions</legend>
          {questions.length ? questions.map((q, i) => (
            <Field key={q} label={q}><Input value={v.answers[i]} onChange={(e) => setV((s) => ({ ...s, answers: s.answers.map((x, j) => (j === i ? e.target.value : x)) }))} /></Field>
          )) : <p className="text-xs text-slate-500">No screening questions on this opening.</p>}
        </fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Screening score (0–100)"><Input type="number" min={0} max={100} value={v.score} onChange={(e) => setV((s) => ({ ...s, score: e.target.value }))} /></Field>
          <Field label="Decision" required><Select placeholder="Choose" value={v.decision} onChange={(e) => setV((s) => ({ ...s, decision: e.target.value }))}
            options={[{ value: "shortlist", label: "Shortlist" }, { value: "hold", label: "Hold" }, { value: "reject", label: "Reject" }]} /></Field>
          <Field label="Screening notes" className="sm:col-span-2"><Textarea rows={3} value={v.notes} onChange={(e) => setV((s) => ({ ...s, notes: e.target.value }))} /></Field>
          <Field label="Reason" required={v.decision && v.decision !== "shortlist"} className="sm:col-span-2"><Textarea rows={2} value={v.reason} onChange={(e) => setV((s) => ({ ...s, reason: e.target.value }))} /></Field>
        </div>
        {v.decision === "reject" && <p className="text-xs font-medium text-amber-700">Rejecting cancels scheduled interviews and withdraws open offers. This cannot be undone.</p>}
        <p className="text-xs text-slate-500">The decision is recorded with your name, the date and the reason, and cannot be edited later.</p>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

// =====================================================================
// Resume links (careers resume + uploaded resumes)
// =====================================================================
async function openSigned(getUrl, notify) {
  const w = window.open("about:blank", "_blank");
  const res = await getUrl();
  if (res.error || !res.data) { w?.close(); notify(res.error ?? "Could not open the file.", "error"); return; }
  if (w) { w.opener = null; w.location.href = res.data; } else window.location.assign(res.data);
}

function ResumeLinks({ candidateId, legacyPath }) {
  const { notify } = useToast();
  const files = useHrQuery(() => listAttachments(candidateId), [candidateId]);
  const resumes = (files.data ?? []).filter((f) => f.kind === "resume" && f.confirmed_at);
  return (
    <span className="flex flex-wrap gap-1">
      {legacyPath && <Button size="sm" variant="secondary" onClick={() => openSigned(() => resumeUrl(legacyPath), notify)}><FileText className="h-4 w-4" aria-hidden="true" />Careers resume</Button>}
      {resumes.map((f) => <Button key={f.id} size="sm" variant="secondary" onClick={() => openSigned(() => attachmentUrl(f.storage_path), notify)}><FileText className="h-4 w-4" aria-hidden="true" />{f.file_name}</Button>)}
      {!legacyPath && !resumes.length && !files.loading && <span className="text-xs text-slate-500">No resume on file.</span>}
    </span>
  );
}

// =====================================================================
// Attachments
// =====================================================================
export function AttachmentsPanel({ application }) {
  const a = application;
  const x = useAssignment(a);
  const { notify } = useToast();
  const q = useHrQuery(() => listAttachments(a.candidate_id), [a.candidate_id]);
  const [kind, setKind] = useState("resume");
  const [file, setFile] = useState(null);
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [removing, setRemoving] = useState(null);
  const canUpload = x.manage || x.assignedRecruiter;
  async function upload() {
    setBusy(true); setError(null);
    const res = await uploadAttachment({ candidateId: a.candidate_id, applicationId: a.id, kind, file });
    setBusy(false);
    if (res.error) { setError(res.error); q.reload(); return; }
    setFile(null); setInputKey((k) => k + 1); q.reload(); notify("File uploaded.");
  }
  return (
    <Card title="Resume & attachments">
      {a.candidate?.resume_path && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="orange">careers page</Badge>
          <Button size="sm" variant="secondary" onClick={() => openSigned(() => resumeUrl(a.candidate.resume_path), notify)}><FileText className="h-4 w-4" aria-hidden="true" />Open resume</Button>
        </p>
      )}
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !q.data?.length ? (
        <p className="text-sm text-slate-500">No uploaded files.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {q.data.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <span className="min-w-0"><span className="block truncate font-semibold text-[#101a3a]">{f.file_name}</span>
                <span className="text-xs text-slate-500">{lbl(f.kind)} · {(f.size_bytes / 1024).toFixed(0)} KB · {formatDate(f.uploaded_at)}{!f.confirmed_at && " · upload incomplete"}</span></span>
              <span className="flex gap-1">
                {f.confirmed_at && <Button size="sm" variant="secondary" onClick={() => openSigned(() => attachmentUrl(f.storage_path), notify)}>Open</Button>}
                {canUpload && <Button size="sm" variant="ghost" aria-label={`Remove ${f.file_name}`} onClick={() => setRemoving(f)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-dashed border-slate-300 p-3 sm:flex-row sm:items-end">
          <Field label="Type" className="sm:w-40"><Select value={kind} onChange={(e) => setKind(e.target.value)} options={opts(ATTACHMENT_KINDS)} /></Field>
          <Field label="File" hint="PDF, Word, PNG, JPEG or WEBP, up to 10 MB." className="flex-1">
            <input key={inputKey} type="file" accept={ATTACHMENT_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold" />
          </Field>
          <Button onClick={upload} loading={busy} disabled={!file}><Upload className="h-4 w-4" aria-hidden="true" />Upload</Button>
        </div>
      )}
      <div className="mt-2"><InlineError message={error} /></div>
      <p className="mt-2 text-xs text-slate-500"><Paperclip className="mr-1 inline h-3 w-3" aria-hidden="true" />Interviewers can open resumes, cover letters and portfolios only. Other files are visible to HR, the recruiter and the hiring manager.</p>
      <ConfirmDialog open={Boolean(removing)} onClose={() => setRemoving(null)} tone="danger" title="Remove file" requireReason
        message={removing ? `Remove ${removing.file_name}? It is archived, not deleted, and the action is audited.` : ""} confirmLabel="Remove"
        onConfirm={async (reason) => { const res = await archiveAttachment(removing.id, reason); if (!res.error) { q.reload(); notify("File removed."); } return res; }} />
    </Card>
  );
}

// =====================================================================
// Notes
// =====================================================================
export function NotesPanel({ application }) {
  const a = application;
  const x = useAssignment(a);
  const { notify } = useToast();
  const q = useHrQuery(() => (x.internal ? listCandidateNotes(a.candidate_id) : Promise.resolve({ data: [], error: null })), [a.candidate_id, x.internal]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!x.internal) return null;
  const canAdd = x.manage || x.assignedRecruiter || x.hiringManager;
  async function add() {
    if (!body.trim()) { setError("Write a note first."); return; }
    setBusy(true); setError(null);
    const res = await addCandidateNote(a.candidate_id, body, a.id);
    setBusy(false);
    if (res.error) setError(res.error); else { setBody(""); q.reload(); notify("Note added."); }
  }
  return (
    <Card title="Candidate notes">
      {canAdd && (
        <div className="mb-3 flex flex-col gap-2">
          <Textarea rows={2} aria-label="New note" placeholder="Add an internal note (not visible to interviewers)…" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
          <div className="flex justify-end"><Button size="sm" onClick={add} loading={busy}><Plus className="h-4 w-4" aria-hidden="true" />Add note</Button></div>
          <InlineError message={error} />
        </div>
      )}
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !q.data?.length ? (
        <p className="text-sm text-slate-500">No notes yet.</p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {q.data.map((n) => (
            <li key={n.id} className="rounded-lg bg-slate-50 p-2 text-sm">
              <p className="whitespace-pre-wrap text-[#101a3a]">{n.body}</p>
              <p className="mt-1 text-[11px] text-slate-500">{fullName(n.author) || "HR"} · {formatDateTime(n.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// =====================================================================
// Final decision
// =====================================================================
export function DecisionPanel({ application, onChanged }) {
  const a = application;
  const x = useAssignment(a);
  const { notify } = useToast();
  const q = useHrQuery(() => (x.internal ? listHiringDecisions(a.id) : Promise.resolve({ data: [], error: null })), [a.id, x.internal]);
  const [deciding, setDeciding] = useState(false);
  if (!x.internal) return null;
  const canDecide = x.canDecide && a.stage === "interview";
  return (
    <Card title="Final decision" actions={canDecide && <Button size="sm" onClick={() => setDeciding(true)}>Record decision</Button>}>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !q.data?.length ? (
        <p className="text-sm text-slate-500">{a.stage === "interview" ? "Pending. HR or the hiring manager decides once evaluations are in." : "No decision recorded."}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {q.data.map((d) => (
            <li key={d.id} className="text-sm">
              <Badge tone={d.decision === "hire" ? "green" : d.decision === "reject" ? "red" : "amber"}>{lbl(d.decision)}</Badge>
              <span className="ml-2 text-xs text-slate-500">{fullName(d.decider) || "HR"} · {formatDateTime(d.decided_at)}</span>
              {d.reason && <p className="mt-1 text-xs text-slate-700">{d.reason}</p>}
            </li>
          ))}
        </ul>
      )}
      {deciding && <DecisionModal application={a} onClose={() => setDeciding(false)} onDone={(d) => { setDeciding(false); q.reload(); onChanged?.(); notify(`Decision recorded: ${lbl(d)}.`); }} />}
    </Card>
  );
}

function DecisionModal({ application, onClose, onDone }) {
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!decision) { setError("Choose hire, hold or reject."); return; }
    if (decision !== "hire" && !reason.trim()) { setError("Give a reason for this decision."); return; }
    setBusy(true); setError(null);
    const res = await recordHiringDecision(application.id, decision, reason);
    setBusy(false);
    if (res.error) setError(res.error); else onDone(decision);
  }
  return (
    <Modal open onClose={onClose} title="Final hiring decision" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={decision === "reject" ? "danger" : "primary"} loading={busy} onClick={go}>Save decision</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Decision" required><Select placeholder="Choose" value={decision} onChange={(e) => setDecision(e.target.value)}
          options={[{ value: "hire", label: "Hire (move to Selected)" }, { value: "hold", label: "Hold" }, { value: "reject", label: "Reject" }]} /></Field>
        <Field label="Reason" required={decision && decision !== "hire"}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <p className="text-xs text-slate-500">Hiring needs at least one submitted evaluation. The decision is recorded with your name and cannot be edited.</p>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

// =====================================================================
// Interviews: reschedule / cancel / history
// =====================================================================
export function InterviewActions({ interview, canManage, employees, onChanged }) {
  const { notify } = useToast();
  const [mode, setMode] = useState(null);   // reschedule | cancel | no_show | completed
  const i = interview;
  return (
    <>
      {i.reschedules?.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-semibold text-[#1f4693]">Rescheduled {i.reschedules.length}×</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {[...i.reschedules].sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at)).map((r) => (
              <li key={r.id} className="rounded bg-slate-50 p-1.5">{formatDateTime(r.old_scheduled_at)} → <strong>{formatDateTime(r.new_scheduled_at)}</strong>
                {r.old_mode !== r.new_mode ? ` · ${modeLabel(r.old_mode)} → ${modeLabel(r.new_mode)}` : ""} — {r.reason}</li>
            ))}
          </ul>
        </details>
      )}
      {i.status === "cancelled" && i.cancel_reason && <p className="mt-1 text-xs text-slate-600">Cancelled: {i.cancel_reason}</p>}
      {canManage && i.status === "scheduled" && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setMode("reschedule")}><CalendarClock className="h-4 w-4" aria-hidden="true" />Reschedule</Button>
          {new Date(i.scheduled_at) <= new Date() && <Button size="sm" variant="ghost" onClick={() => setMode("completed")}>Mark completed</Button>}
          {new Date(i.scheduled_at) <= new Date() && <Button size="sm" variant="ghost" onClick={() => setMode("no_show")}>Mark no-show</Button>}
          <Button size="sm" variant="ghost" onClick={() => setMode("cancel")}>Cancel</Button>
        </div>
      )}
      {mode === "reschedule" && <RescheduleModal interview={i} employees={employees} onClose={() => setMode(null)} onDone={() => { setMode(null); onChanged(); notify("Interview rescheduled; the panel was notified in the portal."); }} />}
      <ConfirmDialog open={mode === "cancel"} onClose={() => setMode(null)} tone="danger" title="Cancel interview" requireReason
        message="The panel is notified in the portal. No email or calendar invitation is sent." confirmLabel="Cancel interview"
        onConfirm={async (reason) => { const res = await updateInterviewStatus(i.id, "cancelled", reason); if (!res.error) { notify("Interview cancelled."); onChanged(); } return res; }} />
      <ConfirmDialog open={mode === "no_show" || mode === "completed"} onClose={() => setMode(null)} tone={mode === "no_show" ? "danger" : "primary"}
        title={mode === "no_show" ? "Mark as no-show" : "Mark as completed"} requireReason={false} reasonLabel="Note (optional)"
        message={mode === "no_show" ? "Record that the candidate did not attend. Evaluations can no longer be written." : "Record that the interview took place. Interviewers can still submit evaluations."}
        confirmLabel="Save" onConfirm={async (note) => { const res = await updateInterviewStatus(i.id, mode, note); if (!res.error) { notify("Interview updated."); onChanged(); } return res; }} />
    </>
  );
}

function RescheduleModal({ interview, employees, onClose, onDone }) {
  const [v, setV] = useState({ scheduled_at: toLocalInput(interview.scheduled_at), mode: interview.mode, location_or_link: interview.location_or_link ?? "",
    duration_minutes: interview.duration_minutes, interviewers: (interview.panel ?? []).map((m) => m.employee_id), reason: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function go() {
    if (!v.scheduled_at) { setError("Choose the new date and time."); return; }
    if (!v.reason.trim()) { setError("Give a reason for rescheduling."); return; }
    if (!v.interviewers.length) { setError("Keep at least one interviewer."); return; }
    setBusy(true); setError(null);
    const res = await rescheduleInterview(interview.id, { ...v, scheduled_at: new Date(v.scheduled_at).toISOString() });
    setBusy(false);
    if (res.error) setError(res.error); else onDone();
  }
  const panelSet = new Set(v.interviewers);
  return (
    <Modal open onClose={onClose} title="Reschedule interview" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Reschedule</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="New date and time" required hint="Your local time."><Input type="datetime-local" value={v.scheduled_at} onChange={set("scheduled_at")} /></Field>
        <Field label="Duration (minutes)"><Input type="number" min={5} max={480} value={v.duration_minutes} onChange={set("duration_minutes")} /></Field>
        <Field label="Mode"><Select value={v.mode} onChange={set("mode")} options={opts(INTERVIEW_MODES, modeLabel)} /></Field>
        <Field label={v.mode === "in_person" ? "Location" : "Meeting link / dial-in"}><Input value={v.location_or_link} onChange={set("location_or_link")} maxLength={1000} /></Field>
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-semibold text-[#173a52]">Panel</legend>
          <div className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-slate-200 p-2">
            {(employees ?? []).map((e) => (
              <div key={e.value} className="py-0.5"><Checkbox label={e.label} checked={panelSet.has(e.value)}
                onChange={(ev) => setV((s) => ({ ...s, interviewers: ev.target.checked ? [...s.interviewers, e.value] : s.interviewers.filter((x) => x !== e.value) }))} /></div>
            ))}
          </div>
        </fieldset>
        <Field label="Reason" required className="sm:col-span-2"><Textarea rows={2} value={v.reason} onChange={set("reason")} /></Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">The previous time and place are kept in the interview history. No email or calendar invite is sent; the panel is notified in the portal.</p>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

// =====================================================================
// Evaluations
// =====================================================================
/** Evaluation list inside an interview card (submitted ones; HR may re-open). */
export function EvaluationList({ interview, canReopen, onChanged }) {
  const { notify } = useToast();
  const [reopening, setReopening] = useState(null);
  const fb = (interview.feedback ?? []).filter((f) => f.status !== "draft");
  if (!fb.length) return null;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer font-semibold text-[#1f4693]">Evaluations ({fb.length})</summary>
      <ul className="mt-2 flex flex-col gap-2">
        {fb.map((f) => (
          <li key={f.id} className="rounded-lg bg-slate-50 p-2">
            <p className="font-semibold text-[#101a3a]">{fullName(f.interviewer) || "Interviewer"} · {f.rating}/5 ·{" "}
              <Badge tone={["no_hire", "strong_no_hire"].includes(f.recommendation) ? "red" : f.recommendation === "hold" ? "amber" : "green"}>{recommendationLabel(f.recommendation)}</Badge></p>
            <p className="mt-1 flex flex-wrap gap-1">{EVAL_SCORES.filter((s) => f[s.key] != null).map((s) => <Badge key={s.key} tone="blue">{s.label}: {f[s.key]}</Badge>)}</p>
            {f.strengths && <p className="mt-1"><span className="font-semibold">Strengths:</span> {f.strengths}</p>}
            {f.concerns && <p className="mt-1"><span className="font-semibold">Concerns:</span> {f.concerns}</p>}
            {f.comments && <p className="mt-1 whitespace-pre-wrap"><span className="font-semibold">Comments:</span> {f.comments}</p>}
            <p className="mt-1 text-[11px] text-slate-500">Submitted {formatDateTime(f.submitted_at)}{f.reopen_reason ? ` · re-opened once: ${f.reopen_reason}` : ""}</p>
            {canReopen && <Button size="sm" variant="ghost" className="mt-1" onClick={() => setReopening(f)}>Re-open for correction</Button>}
          </li>
        ))}
      </ul>
      <ConfirmDialog open={Boolean(reopening)} onClose={() => setReopening(null)} title="Re-open evaluation" requireReason
        message="The evaluation goes back to its author as a draft. Only the author can change it; they are notified." confirmLabel="Re-open"
        onConfirm={async (reason) => { const res = await reopenEvaluation(reopening.id, reason); if (!res.error) { notify("Evaluation re-opened."); onChanged(); } return res; }} />
    </details>
  );
}

/** The interviewer's own evaluation form (draft or submit). */
export function EvaluationModal({ interview, existing, onClose, onDone }) {
  const e = existing ?? {};
  const [v, setV] = useState({
    rating: e.rating != null ? String(e.rating) : "", recommendation: e.recommendation ?? "", strengths: e.strengths ?? "", concerns: e.concerns ?? "", comments: e.comments ?? "",
    ...Object.fromEntries(EVAL_SCORES.map((s) => [s.key, e[s.key] != null ? String(e[s.key]) : ""])),
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const set = (k) => (ev) => setV((s) => ({ ...s, [k]: ev.target.value }));
  const started = new Date(interview.scheduled_at).getTime() <= Date.now();
  async function save(submit) {
    if (submit) {
      if (!v.rating || !v.recommendation) { setError("Give an overall rating and a recommendation before submitting."); return; }
      if (!v.strengths.trim() && !v.concerns.trim() && !v.comments.trim()) { setError("Add comments, strengths or concerns before submitting."); return; }
    }
    setBusy(submit ? "submit" : "draft"); setError(null);
    const res = await saveEvaluation(interview.id, v, submit);
    setBusy(null);
    if (res.error) setError(res.error); else onDone(submit);
  }
  const score = (key, lab) => (
    <Field key={key} label={lab}><Select placeholder="— Not rated —" value={v[key]} onChange={set(key)} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} / 5` }))} /></Field>
  );
  return (
    <Modal open onClose={onClose} title={`Evaluation: ${interview.application?.candidate?.full_name ?? "candidate"}`} size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="secondary" loading={busy === "draft"} disabled={Boolean(busy)} onClick={() => save(false)}>Save draft</Button>
        <Button loading={busy === "submit"} disabled={Boolean(busy) || !started} title={!started ? "Opens at the interview start time" : undefined} onClick={() => save(true)}>Submit evaluation</Button>
      </>}>
      {e.reopen_reason && <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Re-opened by HR: {e.reopen_reason}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {EVAL_SCORES.map((s) => score(s.key, s.label))}
        {score("rating", "Overall rating *")}
        <Field label="Recommendation" required><Select placeholder="Choose" value={v.recommendation} onChange={set("recommendation")}
          options={Object.entries(RECOMMENDATION_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Strengths" className="sm:col-span-2"><Textarea rows={3} value={v.strengths} onChange={set("strengths")} /></Field>
        <Field label="Concerns" className="sm:col-span-2"><Textarea rows={3} value={v.concerns} onChange={set("concerns")} /></Field>
        <Field label="Comments" className="sm:col-span-2"><Textarea rows={3} value={v.comments} onChange={set("comments")} /></Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">Drafts are visible only to you. Once submitted, the evaluation is locked; other panel members never see it. {!started && "Submitting opens at the interview start time."}</p>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

// =====================================================================
// Offers & offer letters
// =====================================================================
function useCompany() {
  return useHrQuery(async () => {
    const res = await run(from("hr_settings").select("value").eq("key", "company").maybeSingle());
    return { data: res.data?.value ?? { name: "Zyllo Tech" }, error: null };
  }, []);
}

export function OfferCard({ offer, application, org, employees, canManage, onChanged }) {
  const o = offer;
  const { notify } = useToast();
  const [mode, setMode] = useState(null);   // edit | generate | letters | issue | email | respond | withdraw
  const designation = org?.designations.find((d) => d.id === o.offered_designation_id)?.name;
  const department = org?.departments.find((d) => d.id === o.department_id)?.name;
  const mail = emailState(o);
  const isDraft = o.status === "draft";
  const done = (msg) => { setMode(null); onChanged(); if (msg) notify(msg); };
  return (
    <li className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-[#101a3a]">{designation ?? "Offer"} · {lbl(o.employment_type)}</span>
        <span className="flex flex-wrap gap-1"><StatusBadge status={o.status === "sent" ? "issued" : o.status === "declined" ? "rejected" : o.status} />
          {canManage && o.status !== "draft" && <Badge tone={mail.tone}>{mail.text}</Badge>}</span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
        <dt>Department</dt><dd className="text-[#101a3a]">{department ?? "—"}</dd>
        <dt>Work location</dt><dd className="text-[#101a3a]">{o.work_location ?? application.opening?.location ?? "—"}</dd>
        <dt>Joining date</dt><dd className="text-[#101a3a]">{formatDate(o.proposed_joining_date)}</dd>
        {canManage && <><dt>Annual CTC</dt><dd className="text-[#101a3a]">{formatMoney(o.annual_ctc, o.currency || "INR")}</dd></>}
        <dt>Valid until</dt><dd className="text-[#101a3a]">{formatDate(o.expires_on)}</dd>
        <dt>Issued on</dt><dd className="text-[#101a3a]">{formatDate(o.issued_on ?? o.sent_at)}</dd>
        <dt>Signatory</dt><dd className="text-[#101a3a]">{o.signatory_name || (o.signatory_employee_id ? employees?.find((e) => e.value === o.signatory_employee_id)?.label : null) || "—"}</dd>
        <dt>Letter</dt><dd className="text-[#101a3a]">{o.current_version ? `version ${o.current_version}${o.letter_stale ? " (out of date)" : ""}` : "not generated"}</dd>
        <dt>Response</dt><dd className="text-[#101a3a]">{o.responded_at ? `${offerStatusLabel(o.status)} ${formatDate(o.responded_at)}` : "—"}</dd>
      </dl>
      {canManage && application.stage !== "joined" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {isDraft && <Button size="sm" variant="secondary" onClick={() => setMode("edit")}>Edit offer</Button>}
          {isDraft && <Button size="sm" variant="secondary" onClick={() => setMode("generate")}><FileText className="h-4 w-4" aria-hidden="true" />{o.current_version ? "Regenerate letter" : "Generate letter"}</Button>}
          {o.current_version > 0 && <Button size="sm" variant="secondary" onClick={() => setMode("letters")}><Download className="h-4 w-4" aria-hidden="true" />Letter & PDF</Button>}
          {isDraft && <Button size="sm" onClick={() => setMode("issue")} disabled={!o.current_version || o.letter_stale}
            title={!o.current_version ? "Generate the letter first" : o.letter_stale ? "Regenerate the letter first" : undefined}><Send className="h-4 w-4" aria-hidden="true" />Issue offer</Button>}
          {o.status === "sent" && o.current_version > 0 && !["queued", "sending", "sent"].includes(o.email_status) && (
            <Button size="sm" variant="secondary" onClick={() => setMode("email")}><Mail className="h-4 w-4" aria-hidden="true" />{o.email_status === "failed" ? "Retry email" : "Email letter"}</Button>)}
          {o.status === "sent" && <Button size="sm" variant="secondary" onClick={() => setMode("respond")}>Record response</Button>}
          {["draft", "sent", "accepted"].includes(o.status) && <Button size="sm" variant="ghost" onClick={() => setMode("withdraw")}>Withdraw</Button>}
        </div>
      )}
      {mode === "edit" && <OfferEditModal offer={o} org={org} employees={employees} onClose={() => setMode(null)} onDone={() => done("Offer updated.")} />}
      {mode === "generate" && <GenerateLetterModal offer={o} onClose={() => setMode(null)} onDone={(v) => done(`Offer letter version ${v} generated.`)} />}
      {mode === "letters" && <LetterVersionsModal offer={o} candidateName={application.candidate?.full_name} onClose={() => setMode(null)} />}
      {mode === "respond" && <OfferResponseModal offer={o} onClose={() => setMode(null)} onDone={(r) => done(`Response recorded: ${offerStatusLabel(r)}.`)} />}
      <ConfirmDialog open={mode === "issue"} onClose={() => setMode(null)} title="Issue offer"
        message="Issuing freezes the offer terms and letter version, and moves the candidate to Offered. It does NOT email the candidate: download the PDF or use Email letter afterwards."
        confirmLabel="Issue offer" onConfirm={async () => { const res = await issueOffer(o.id); if (!res.error) done("Offer issued."); return res; }} />
      <ConfirmDialog open={mode === "email"} onClose={() => setMode(null)} title="Email offer letter"
        message={`Queue the letter text to ${application.candidate?.email}. The offer shows as emailed only after the mail service confirms delivery.`}
        confirmLabel="Queue email" onConfirm={async () => { const res = await queueOfferEmail(o.id); if (!res.error) done("Email queued. Delivery status updates when the mail service sends it."); return res; }} />
      <ConfirmDialog open={mode === "withdraw"} onClose={() => setMode(null)} tone="danger" title="Withdraw offer" requireReason={false} reasonLabel="Note (optional)"
        message="The offer is withdrawn and can no longer be accepted. The candidate's stage does not change."
        confirmLabel="Withdraw offer" onConfirm={async (note) => { const res = await withdrawOffer(o.id, note); if (!res.error) done("Offer withdrawn."); return res; }} />
    </li>
  );
}

function OfferEditModal({ offer, org, employees, onClose, onDone }) {
  const o = offer;
  const [v, setV] = useState({
    department_id: o.department_id ?? "", designation_id: o.offered_designation_id ?? "", employment_type: o.employment_type ?? "full_time",
    joining_date: o.proposed_joining_date ?? "", annual_ctc: o.annual_ctc ?? "", currency: o.currency ?? "INR", expires_on: o.expires_on ?? "",
    work_location: o.work_location ?? "", signatory_employee_id: o.signatory_employee_id ?? "", signatory_name: o.signatory_name ?? "", signatory_title: o.signatory_title ?? "",
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    const errs = {};
    if (!isBlank(v.annual_ctc) && !(Number(v.annual_ctc) >= 0)) errs.annual_ctc = "Enter a non-negative amount.";
    if (v.expires_on && v.expires_on < todayStr()) errs.expires_on = "Cannot be in the past.";
    if (!/^[A-Z]{3}$/.test(v.currency)) errs.currency = "3-letter code, e.g. INR.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await updateOffer(o.id, v);
    setBusy(false);
    if (res.error) setError(res.error); else onDone();
  }
  const designations = (org?.designations ?? []).filter((d) => !v.department_id || !d.department_id || d.department_id === v.department_id);
  return (
    <Modal open onClose={onClose} title="Edit draft offer" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Department"><Select placeholder="— None —" value={v.department_id} onChange={set("department_id")} options={toOptions(org?.departments)} /></Field>
        <Field label="Designation"><Select placeholder="— None —" value={v.designation_id} onChange={set("designation_id")} options={toOptions(designations)} /></Field>
        <Field label="Employment type"><Select value={v.employment_type} onChange={set("employment_type")} options={toOptions(org?.employmentTypes, "name", "code")} /></Field>
        <Field label="Work location"><Input value={v.work_location} onChange={set("work_location")} placeholder="Blank = the opening's location" /></Field>
        <Field label="Joining date"><Input type="date" value={v.joining_date} onChange={set("joining_date")} /></Field>
        <Field label="Offer valid until" error={errors.expires_on}><Input type="date" value={v.expires_on} onChange={set("expires_on")} /></Field>
        <Field label="Annual CTC" error={errors.annual_ctc} hint="Confidential: recruitment managers only."><Input type="number" min={0} step="1000" value={v.annual_ctc} onChange={set("annual_ctc")} /></Field>
        <Field label="Currency" error={errors.currency}><Input value={v.currency} maxLength={3} onChange={(e) => setV((s) => ({ ...s, currency: e.target.value.toUpperCase() }))} /></Field>
        <Field label="Authorised signatory" className="sm:col-span-2"><Select placeholder="— Choose an employee —" value={v.signatory_employee_id} onChange={set("signatory_employee_id")} options={employees ?? []} /></Field>
        <Field label="Signatory name override" hint="Blank = the employee's name."><Input value={v.signatory_name} onChange={set("signatory_name")} /></Field>
        <Field label="Signatory title" hint="Blank = the employee's designation."><Input value={v.signatory_title} onChange={set("signatory_title")} /></Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">Changing a draft after its letter was generated marks the letter out of date; regenerate it before issuing.</p>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function GenerateLetterModal({ offer, onClose, onDone }) {
  const templates = useHrQuery(listOfferTemplates, []);
  const approved = (templates.data ?? []).filter((t) => t.status === "approved");
  const [tpl, setTpl] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setError(null);
    const res = await generateOfferLetter(offer.id, tpl || approved.find((t) => t.is_default)?.id || approved[0]?.id);
    setBusy(false);
    if (res.error) setError(res.error); else onDone(res.data);
  }
  return (
    <Modal open onClose={onClose} title={offer.current_version ? "Regenerate offer letter" : "Generate offer letter"} size="md"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!approved.length} onClick={go}>Generate</Button></>}>
      {templates.loading ? <Loading /> : templates.error ? <ErrorState message={templates.error} onRetry={templates.reload} /> : !approved.length ? (
        <EmptyState title="No approved template" description="An HR administrator must approve an offer letter template (Offers tab → Templates)." />
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Approved template"><Select value={tpl} onChange={(e) => setTpl(e.target.value)}
            options={approved.map((t) => ({ value: t.id, label: `${t.name}${t.is_default ? " (default)" : ""}` }))} placeholder="Default template" /></Field>
          <p className="text-xs text-slate-500">The letter is filled in from the offer, the candidate and the opening. Each generation creates a new numbered version; earlier versions are kept.</p>
        </div>
      )}
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function LetterVersionsModal({ offer, candidateName, onClose }) {
  const { notify } = useToast();
  const versions = useHrQuery(() => listOfferVersions(offer.id), [offer.id]);
  const company = useCompany();
  const [sel, setSel] = useState(null);
  const shown = useMemo(() => (versions.data ?? []).find((x) => x.id === sel) ?? versions.data?.[0], [versions.data, sel]);
  async function download(ver) {
    const c = company.data ?? {};
    downloadOfferLetterPdf(`offer-letter-${candidateName ?? "candidate"}-v${ver.version}.pdf`, {
      companyName: c.name ?? "Zyllo Tech", companyLine: c.legal_name ?? "", subject: ver.subject, body: ver.body,
      footer: `${ver.template_name} - version ${ver.version} - generated ${formatDate(ver.generated_at)}`, title: `Offer letter - ${candidateName ?? ""}`,
    });
    const res = await logOfferLetterDownload(ver.id);
    if (res.error) notify(`Downloaded, but the download could not be logged: ${res.error}`, "error");
  }
  return (
    <Modal open onClose={onClose} title="Offer letter" size="xl" footer={<><Button variant="secondary" onClick={onClose}>Close</Button>{shown && <Button onClick={() => download(shown)}><Download className="h-4 w-4" aria-hidden="true" />Download PDF (v{shown.version})</Button>}</>}>
      {versions.loading && !versions.data ? <Loading /> : versions.error ? <ErrorState message={versions.error} onRetry={versions.reload} /> : !versions.data?.length ? (
        <EmptyState title="No letter generated yet" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[12rem_1fr]">
          <ul className="flex gap-2 overflow-x-auto md:flex-col" aria-label="Letter versions">
            {versions.data.map((x) => (
              <li key={x.id}><button type="button" onClick={() => setSel(x.id)}
                className={`w-full whitespace-nowrap rounded-lg border px-3 py-2 text-left text-sm ${shown?.id === x.id ? "border-[#f96706] bg-orange-50" : "border-slate-200 hover:bg-slate-50"}`}>
                <span className="block font-semibold">Version {x.version}{x.version === offer.current_version ? " · current" : ""}</span>
                <span className="block text-xs text-slate-500">{formatDateTime(x.generated_at)}</span>
              </button></li>
            ))}
          </ul>
          {shown && (
            <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
              <p className="text-xs text-slate-500">{shown.template_name}</p>
              <h3 className="mt-1 font-bold text-[#101a3a]">{shown.subject}</h3>
              <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-800">{shown.body}</pre>
            </article>
          )}
        </div>
      )}
    </Modal>
  );
}

function OfferResponseModal({ offer, onClose, onDone }) {
  const [response, setResponse] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!response) { setError("Choose the candidate's response."); return; }
    setBusy(true); setError(null);
    const res = await recordOfferResponse(offer.id, response, note);
    setBusy(false);
    if (res.error) setError(res.error); else onDone(response);
  }
  return (
    <Modal open onClose={onClose} title="Record candidate response" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Save response</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Response" required><Select placeholder="Choose" value={response} onChange={(e) => setResponse(e.target.value)} options={OFFER_RESPONSE_OPTIONS} /></Field>
        <Field label="Note (optional)" hint="e.g. signed copy received on…"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <p className="text-xs text-slate-500">The response is final for this offer. An accepted offer allows HR to hire the candidate.</p>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

export { stageBadgeTone, numOrNull };
