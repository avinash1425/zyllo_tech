// Recruitment & Hiring (HR module 3) — extends the original Module 7
// "Recruitment & Interns": overview dashboard, job openings (status machine
// Draft → Open → On hold → Closed with permission-gated reopen, confidential
// salary range, publish to the careers site, import careers applications),
// applications / pipeline (screening, hold, assigned recruiter, notes and
// attachments), interviews (schedule, reschedule with history, cancel,
// structured evaluations, final decision), offers (approved letter templates,
// versioned letters, PDF, issue, email via the outbox, response), hiring
// (candidate → employee conversion), candidates, "my interviews" for panel
// members, and internships with evaluations and intern conversion.
// RLS + SECURITY DEFINER RPCs (migrations 104 and 120) enforce every rule;
// buttons are shown only when the caller holds the matching permission.
import { useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarPlus, CheckCircle2, Download, FileText, Plus, Send, Upload, UserCheck } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { exportCsv, formatDate, formatDateTime, formatMoney, fullName, useHrQuery } from "@/lib/hr/client";
import { toOptions, useEmployeeOptions, useOrg } from "@/lib/hr/org";
import {
  BOARD_STAGES, CANDIDATE_SOURCES, EVAL_CRITERIA, EVAL_RECOMMENDATIONS, INTERNSHIP_EDIT_STATUSES, INTERNSHIP_STATUSES, INTERVIEW_MODES,
  INTERVIEW_TYPES, NEXT_STAGES, STAGES, TERMINAL_STAGES,
  convertCandidate, convertIntern, createEvaluation, createInternship, createOffer, deleteEvaluation,
  getApplication, importCareersApplications, label as lbl, listAllInterviews, listApplications, listCandidates, listCareersPostings,
  listEvaluations, listInternEmployees, listInternships, listInterviews, listMyInterviews, listOffers, listOpenings, listStageEvents,
  moveStage, opts, publishOpening, resumeUrl, scheduleInterview, updateCandidate, updateEvaluation, updateInternship,
} from "@/lib/hr/recruitment";
import {
  ATTACHMENT_ACCEPT, OPENING_NEXT_STATUSES, OPENING_STATUS_LABELS, addApplication, checkAttachmentFile, loadOpeningCompensation, uploadAttachment, listOpeningStatusEvents, modeLabel,
  openingStatusLabel, saveOpening, setOpeningStatus, sourceLabel, stageLabel,
} from "@/lib/hr/recruitmentHiring";
import {
  ApplicationFactsCard, AttachmentsPanel, DecisionPanel, EvaluationList, EvaluationModal as InterviewEvaluationModal, InterviewActions, NotesPanel, OfferCard, ScreeningPanel,
} from "@/hr/pages/recruitment/ApplicationPanels";
import OverviewTab from "@/hr/pages/recruitment/OverviewTab";
import OffersTab from "@/hr/pages/recruitment/OffersTab";
import {
  Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, DescriptionList, EmptyState, ErrorState, Field, InlineError, Input, Loading,
  Modal, PageHeader, SearchInput, Select, StatusBadge, Tabs, Textarea, Toolbar, useToast,
} from "@/hr/ui";

const BASE = "/hr/recruitment";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const fromLocalInput = (s) => (s ? new Date(s).toISOString() : null);
const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
const numIn = (v, min, max) => !isBlank(v) && Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max;

function usePerms() {
  const { hasPermission, hr } = useAuth();
  return {
    me: hr?.employee?.id ?? null,
    recView: hasPermission("recruitment.view") || hasPermission("recruitment.manage"),
    manage: hasPermission("recruitment.manage"),
    convert: hasPermission("recruitment.convert"),
    reopen: hasPermission("recruitment.reopen"),
    exportable: hasPermission("recruitment.export"),
    interns: hasPermission("interns.view") || hasPermission("interns.view_team") || hasPermission("interns.manage"),
    internsTeam: hasPermission("interns.view_team"),
    internsManage: hasPermission("interns.manage"),
  };
}

export default function RecruitmentPage() {
  return (
    <Routes>
      <Route index element={<RecruitmentHome />} />
      <Route path="applications/:id" element={<ApplicationDetail />} />
      <Route path=":tab" element={<RecruitmentHome />} />
    </Routes>
  );
}

// =====================================================================
// Home with tabs (/hr/recruitment/<tab>)
// =====================================================================
function RecruitmentHome() {
  const { tab: tabParam } = useParams();
  const navigate = useNavigate();
  const p = usePerms();
  const org = useOrg();
  const employees = useEmployeeOptions();
  const [pipelineOpening, setPipelineOpening] = useState("");

  const tabs = [
    ...(p.recView || p.me ? [{ value: "overview", label: "Overview" }, { value: "openings", label: "Job openings" }, { value: "pipeline", label: "Applications" }] : []),
    ...(p.recView ? [{ value: "candidates", label: "Candidates" }] : []),
    ...(p.recView || p.me ? [{ value: "interviews", label: "Interviews" }] : []),
    ...(p.manage ? [{ value: "offers", label: "Offers" }] : []),
    ...(p.interns ? [{ value: "interns", label: "Interns" }] : []),
  ];
  if (!tabs.length) return <ErrorState message="You do not have access to recruitment or intern records." />;
  // "applications" is a friendly alias of the pipeline tab.
  const wanted = tabParam === "applications" ? "pipeline" : tabParam;
  const tab = tabs.some((t) => t.value === wanted) ? wanted : null;
  if (!tab) return <Navigate to={`${BASE}/${tabs[0].value}`} replace />;

  return (
    <>
      <PageHeader title="Recruitment & Hiring" description="Job openings, applications, screening, interviews, evaluations, offer letters, hiring and internship programmes." />
      <Tabs value={tab} onChange={(t) => navigate(`${BASE}/${t}`)} tabs={tabs} label="Recruitment sections" />
      {tab === "overview" && <OverviewTab org={org.data} employees={employees.data} base={BASE} />}
      {tab === "openings" && <OpeningsTab org={org} employees={employees} onViewPipeline={(id) => { setPipelineOpening(id); navigate(`${BASE}/pipeline`); }} />}
      {tab === "pipeline" && <PipelineTab key={pipelineOpening} initialOpening={pipelineOpening} employees={employees.data} />}
      {tab === "candidates" && <CandidatesTab />}
      {tab === "interviews" && <InterviewsTab />}
      {tab === "offers" && <OffersTab base={BASE} />}
      {tab === "interns" && <InternsTab org={org} employees={employees} />}
    </>
  );
}

// =====================================================================
// Shared bits
// =====================================================================
function ResumeButton({ path, size = "sm" }) {
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  if (!path) return null;
  async function open() {
    const w = window.open("about:blank", "_blank");
    setBusy(true);
    const res = await resumeUrl(path);
    setBusy(false);
    if (res.error || !res.data) { w?.close(); notify(res.error ?? "Could not open the resume.", "error"); return; }
    if (w) { w.opener = null; w.location.href = res.data; } else window.location.assign(res.data);
  }
  return <Button variant="secondary" size={size} loading={busy} onClick={open}><FileText className="h-4 w-4" aria-hidden="true" />Resume</Button>;
}

/** Searchable multi-select of checkboxes (accessible fieldset). */
function MultiPick({ legend, options, value, onChange, error, searchable = true, height = "max-h-48" }) {
  const [q, setQ] = useState("");
  const list = (options ?? []).filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  const set = new Set(value ?? []);
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-semibold text-[#173a52]">{legend}</legend>
      {searchable && <Input type="search" placeholder="Filter…" aria-label={`Filter ${legend}`} value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className={`${height} overflow-y-auto rounded-xl border ${error ? "border-red-400" : "border-slate-200"} p-2`}>
        {list.length ? list.map((o) => (
          <div key={o.value} className="py-0.5">
            <Checkbox label={o.label} checked={set.has(o.value)} onChange={(e) => onChange(e.target.checked ? [...set, o.value] : [...set].filter((x) => x !== o.value))} />
          </div>
        )) : <p className="px-1 py-2 text-xs text-slate-500">No matches.</p>}
      </div>
      <p className="text-xs text-slate-500">{set.size} selected</p>
      {error && <p className="text-xs font-medium text-red-600" role="alert">{error}</p>}
    </fieldset>
  );
}

const stageTone = (s) => ({ applied: "slate", screening: "blue", shortlisted: "violet", interview: "violet", selected: "orange", offered: "amber", joined: "green", rejected: "red", withdrawn: "slate" }[s] ?? "slate");
const StageBadge = ({ stage }) => <Badge tone={stageTone(stage)}>{stageLabel(stage)}</Badge>;

// =====================================================================
// Openings
// =====================================================================
function OpeningsTab({ org, employees, onViewPipeline }) {
  const p = usePerms();
  const { notify } = useToast();
  const [f, setF] = useState({ status: "active", department: "", search: "", recruiter: "", hiringManager: "" });
  const q = useHrQuery(() => listOpenings(f), [f.status, f.department, f.search, f.recruiter, f.hiringManager]);
  const comp = useHrQuery(() => (p.manage ? loadOpeningCompensation() : Promise.resolve({ data: new Map(), error: null })), [p.manage]);
  const [editing, setEditing] = useState(null);   // {} new | row
  const [publishing, setPublishing] = useState(null);
  const [statusFor, setStatusFor] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [importing, setImporting] = useState(false);
  const setFilter = (k) => (e) => setF((s) => ({ ...s, [k]: typeof e === "string" ? e : e.target.value }));
  const salaryOf = (id) => comp.data?.get?.(id);

  const columns = [
    { key: "title", header: "Opening", sortable: true, sortValue: (r) => r.title.toLowerCase(), render: (r) => (
      <div className="min-w-[12rem]">
        <p className="font-semibold text-[#101a3a]">{r.title}</p>
        <p className="text-xs text-slate-500">{[r.designation?.name, r.location, r.experience_min != null || r.experience_max != null ? `${r.experience_min ?? 0}–${r.experience_max ?? "+"} yrs` : null].filter(Boolean).join(" · ") || "—"}</p>
        {r.required_skills?.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{r.required_skills.slice(0, 5).map((s) => <Badge key={s} tone="blue">{s}</Badge>)}</p>}
      </div>) },
    { key: "department", header: "Department", render: (r) => r.department?.name ?? "—" },
    { key: "employment_type", header: "Type", render: (r) => lbl(r.employment_type) },
    { key: "openings", header: "Vacancies", sortable: true },
    { key: "people", header: "Hiring manager / recruiter", render: (r) => (
      <span className="text-xs"><span className="block">{r.hiring_manager ? fullName(r.hiring_manager) : "—"}</span><span className="block text-slate-500">{r.recruiter ? fullName(r.recruiter) : "no recruiter"}</span></span>) },
    ...(p.manage ? [{ key: "salary", header: "Salary range", render: (r) => {
      const s = salaryOf(r.id);
      if (!s || (s.salary_min == null && s.salary_max == null)) return "—";
      return <span className="whitespace-nowrap text-xs">{s.salary_min != null ? formatMoney(s.salary_min, s.currency) : "…"} – {s.salary_max != null ? formatMoney(s.salary_max, s.currency) : "…"}<br /><span className="text-slate-500">{s.period}</span></span>;
    } }] : []),
    { key: "dates", header: "Opens / closes", render: (r) => <span className="whitespace-nowrap">{formatDate(r.posting_date)}<br /><span className="text-xs text-slate-500">closes {formatDate(r.closing_date)}</span></span> },
    { key: "status", header: "Status", render: (r) => <span className="flex flex-col items-start gap-1"><StatusBadge status={r.status} />{r.job_id && <Badge tone="orange">careers page</Badge>}</span> },
    { key: "_actions", header: <span className="sr-only">Actions</span>, render: (r) => (
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="secondary" onClick={() => onViewPipeline(r.id)}>Applications</Button>
        {p.manage && !["closed", "filled"].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>}
        {p.manage && (OPENING_NEXT_STATUSES[r.status] ?? []).length > 0 && (!["closed", "filled"].includes(r.status) || p.reopen) && (
          <Button size="sm" variant="ghost" onClick={() => setStatusFor(r)}>{["closed", "filled"].includes(r.status) ? "Reopen" : "Status"}</Button>)}
        {p.manage && ["draft", "open", "on_hold"].includes(r.status) && !r.job_id && <Button size="sm" variant="ghost" onClick={() => setPublishing(r)}><Send className="h-4 w-4" aria-hidden="true" />Publish</Button>}
        <Button size="sm" variant="ghost" onClick={() => setHistoryFor(r)}>History</Button>
      </div>) },
  ];

  return (
    <>
      <Toolbar>
        <SearchInput value={f.search} onChange={setFilter("search")} placeholder="Search job title…" label="Search openings" />
        <Select aria-label="Status" className="sm:w-44" value={f.status} onChange={setFilter("status")} options={[{ value: "active", label: "Draft, open & on hold" }, { value: "", label: "All statuses" }, ...Object.entries(OPENING_STATUS_LABELS).map(([value, label]) => ({ value, label }))]} />
        <Select aria-label="Department" className="sm:w-48" placeholder="All departments" value={f.department} onChange={setFilter("department")} options={toOptions(org.data?.departments, "name", "id", { activeOnly: false })} />
        <Select aria-label="Recruiter" className="sm:w-44" placeholder="Any recruiter" value={f.recruiter} onChange={setFilter("recruiter")} options={employees.data ?? []} />
        <Select aria-label="Hiring manager" className="sm:w-44" placeholder="Any hiring manager" value={f.hiringManager} onChange={setFilter("hiringManager")} options={employees.data ?? []} />
        {p.manage && <Button variant="secondary" onClick={() => setImporting(true)}><Upload className="h-4 w-4" aria-hidden="true" />Import careers applications</Button>}
        {p.manage && <Button onClick={() => setEditing({})}><Plus className="h-4 w-4" aria-hidden="true" />New opening</Button>}
      </Toolbar>
      <DataTable caption="Job openings" columns={columns} rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload}
        emptyTitle="No openings" emptyDescription={p.recView ? "Adjust the filters or create a new opening." : "Only openings you are the hiring manager, recruiter or an interviewer for are shown."} />
      {editing && <OpeningModal opening={editing} salary={salaryOf(editing.id)} canSalary={p.manage} org={org.data} employees={employees.data} onClose={() => setEditing(null)}
        onSaved={(msg) => { setEditing(null); q.reload(); comp.reload(); notify(msg); }} />}
      {statusFor && <OpeningStatusModal opening={statusFor} onClose={() => setStatusFor(null)} onDone={(s) => { setStatusFor(null); q.reload(); notify(`Opening is now ${openingStatusLabel(s)}.`); }} />}
      {historyFor && <OpeningHistoryModal opening={historyFor} onClose={() => setHistoryFor(null)} />}
      <ConfirmDialog open={Boolean(publishing)} onClose={() => setPublishing(null)} title="Publish to the careers page"
        message={publishing ? `"${publishing.title}" becomes Open and a careers posting is created for it. Closing or holding the opening later closes the posting. (In this HRMS build the careers posting is written to the connected database only; the main website is not changed.)` : ""}
        confirmLabel="Publish" onConfirm={async () => {
          const res = await publishOpening(publishing.id);
          if (!res.error) { notify("Opening published to the careers page."); q.reload(); }
          return res;
        }} />
      <ImportCareersModal open={importing} onClose={() => setImporting(false)} onDone={() => q.reload()} />
    </>
  );
}

function OpeningStatusModal({ opening, onClose, onDone }) {
  const choices = OPENING_NEXT_STATUSES[opening.status] ?? [];
  const reopening = ["closed", "filled"].includes(opening.status);
  const [to, setTo] = useState(reopening ? "open" : "");
  const [reason, setReason] = useState("");
  const [closing, setClosing] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const needsReason = to === "on_hold" || reopening;
  async function go() {
    if (!to) { setError("Choose the new status."); return; }
    if (needsReason && !reason.trim()) { setError("Give a reason."); return; }
    if (closing && closing < todayStr()) { setError("The closing date cannot be in the past."); return; }
    setBusy(true); setError(null);
    const res = await setOpeningStatus(opening.id, to, reason, closing);
    setBusy(false);
    if (res.error) setError(res.error); else onDone(to);
  }
  return (
    <Modal open onClose={onClose} title={reopening ? `Reopen ${opening.title}` : `Change status: ${opening.title}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={to === "closed" ? "danger" : "primary"} loading={busy} onClick={go}>{to ? `Set ${openingStatusLabel(to)}` : "Save"}</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">Current status: <StatusBadge status={opening.status} /></p>
        <Field label="New status" required><Select placeholder="Choose" value={to} onChange={(e) => setTo(e.target.value)} options={choices.map((s) => ({ value: s, label: openingStatusLabel(s) }))} /></Field>
        {to === "open" && <Field label="New closing date" hint={opening.closing_date ? `Currently ${formatDate(opening.closing_date)}. Leave blank to keep it.` : "Optional."}><Input type="date" value={closing} min={todayStr()} onChange={(e) => setClosing(e.target.value)} /></Field>}
        <Field label={needsReason ? "Reason" : "Reason (optional)"} required={needsReason}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {to === "open" && !opening.job_id && <p className="text-xs text-slate-500">Opening a job does not list it on the careers page. Use Publish for that.</p>}
        {["closed", "on_hold", "filled"].includes(to) && opening.job_id && <p className="text-xs text-slate-500">The careers posting is closed as well.</p>}
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function OpeningHistoryModal({ opening, onClose }) {
  const q = useHrQuery(() => listOpeningStatusEvents(opening.id), [opening.id]);
  return (
    <Modal open onClose={onClose} title={`Status history: ${opening.title}`} size="md" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : !q.data?.length ? <EmptyState title="No history" /> : (
        <ol className="flex flex-col gap-3">
          {q.data.map((e) => (
            <li key={e.id} className="border-l-2 border-[#f96706]/40 pl-3">
              <p className="text-sm font-semibold text-[#101a3a]">{e.from_status ? `${openingStatusLabel(e.from_status)} → ` : ""}{openingStatusLabel(e.to_status)}</p>
              {e.reason && <p className="text-xs text-slate-600">{e.reason}</p>}
              <p className="text-[11px] text-slate-400">{formatDateTime(e.changed_at)}</p>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

function OpeningModal({ opening, salary, canSalary, org, employees, onClose, onSaved }) {
  const isNew = !opening.id;
  const [v, setV] = useState({
    title: opening.title ?? "", department_id: opening.department_id ?? "", designation_id: opening.designation_id ?? "", employment_type: opening.employment_type ?? "full_time",
    openings: opening.openings ?? 1, skills: (opening.required_skills ?? []).join(", "), experience_min: opening.experience_min ?? "",
    experience_max: opening.experience_max ?? "", location: opening.location ?? "", description: opening.description ?? "", qualifications: opening.qualifications ?? "",
    posting_date: opening.posting_date ?? "", closing_date: opening.closing_date ?? "", hiring_manager_id: opening.hiring_manager_id ?? "", recruiter_id: opening.recruiter_id ?? "",
    screening_questions: (opening.screening_questions ?? []).join("\n"), eligibility_criteria: (opening.eligibility_criteria ?? []).join("\n"),
    salary_min: salary?.salary_min ?? "", salary_max: salary?.salary_max ?? "", salary_currency: salary?.currency ?? "INR", salary_period: salary?.period ?? "annual",
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  async function save() {
    const errs = {};
    if (v.title.trim().length < 2 || v.title.trim().length > 200) errs.title = "Enter a title of 2–200 characters.";
    if (!v.employment_type) errs.employment_type = "Choose an employment type.";
    if (!Number.isInteger(Number(v.openings)) || !numIn(v.openings, 1, 500)) errs.openings = "Vacancies must be a whole number from 1 to 500.";
    if (!isBlank(v.experience_min) && !numIn(v.experience_min, 0, 60)) errs.experience_min = "0–60 years.";
    if (!isBlank(v.experience_max) && !numIn(v.experience_max, 0, 60)) errs.experience_max = "0–60 years.";
    if (!errs.experience_min && !errs.experience_max && !isBlank(v.experience_min) && !isBlank(v.experience_max) && Number(v.experience_max) < Number(v.experience_min)) errs.experience_max = "Must be at least the minimum.";
    if (v.closing_date && v.closing_date < todayStr() && (isNew || v.closing_date !== opening.closing_date)) errs.closing_date = "Closing date cannot be in the past.";
    if (v.closing_date && v.posting_date && v.closing_date < v.posting_date) errs.closing_date = "Must be on or after the opening date.";
    const skills = [...new Set(v.skills.split(",").map((s) => s.trim()).filter(Boolean))];
    if (skills.length > 30) errs.skills = "List at most 30 skills.";
    if (v.screening_questions.split("\n").filter((s) => s.trim()).length > 20) errs.screening_questions = "At most 20 questions.";
    if (v.eligibility_criteria.split("\n").filter((s) => s.trim()).length > 20) errs.eligibility_criteria = "At most 20 criteria.";
    if (canSalary) {
      if (!isBlank(v.salary_min) && !(Number(v.salary_min) >= 0)) errs.salary_min = "Non-negative amount.";
      if (!isBlank(v.salary_max) && !(Number(v.salary_max) >= 0)) errs.salary_max = "Non-negative amount.";
      if (!errs.salary_min && !errs.salary_max && !isBlank(v.salary_min) && !isBlank(v.salary_max) && Number(v.salary_max) < Number(v.salary_min)) errs.salary_max = "Must be at least the minimum.";
    }
    const des = org?.designations.find((d) => d.id === v.designation_id);
    if (des?.department_id && v.department_id && des.department_id !== v.department_id) errs.designation_id = "This designation belongs to another department.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await saveOpening(isNew ? null : opening.id, { ...v, title: v.title.trim(), skills: skills.join(",") }, { includeSalary: canSalary });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onSaved(isNew ? "Opening created as a draft. Open or publish it when it is ready." : "Opening updated.");
  }

  const designations = (org?.designations ?? []).filter((d) => d.active !== false && (!v.department_id || !d.department_id || d.department_id === v.department_id));
  return (
    <Modal open onClose={onClose} title={isNew ? "New job opening" : `Edit ${opening.title}`} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{isNew ? "Create draft" : "Save"}</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Job title" required error={errors.title} className="sm:col-span-2"><Input value={v.title} onChange={set("title")} maxLength={200} /></Field>
        <Field label="Department"><Select placeholder="— None —" value={v.department_id} onChange={set("department_id")} options={toOptions(org?.departments)} /></Field>
        <Field label="Designation" error={errors.designation_id}><Select placeholder="— None —" value={v.designation_id} onChange={set("designation_id")} options={toOptions(designations)} /></Field>
        <Field label="Employment type" required error={errors.employment_type}><Select value={v.employment_type} onChange={set("employment_type")} options={toOptions(org?.employmentTypes, "name", "code")} /></Field>
        <Field label="Number of vacancies" required error={errors.openings}><Input type="number" min={1} max={500} value={v.openings} onChange={set("openings")} /></Field>
        <Field label="Work location" hint="e.g. Guntur / Hybrid." className="sm:col-span-2"><Input value={v.location} onChange={set("location")} /></Field>
        <Field label="Experience from (years)" error={errors.experience_min}><Input type="number" min={0} max={60} step="0.5" value={v.experience_min} onChange={set("experience_min")} /></Field>
        <Field label="Experience to (years)" error={errors.experience_max}><Input type="number" min={0} max={60} step="0.5" value={v.experience_max} onChange={set("experience_max")} /></Field>
        <Field label="Required skills" hint="Comma separated." error={errors.skills} className="sm:col-span-2"><Input value={v.skills} onChange={set("skills")} placeholder="e.g. React, SQL" /></Field>
        <Field label="Required qualifications" className="sm:col-span-2"><Textarea rows={2} value={v.qualifications} onChange={set("qualifications")} /></Field>
        <Field label="Job description" className="sm:col-span-2"><Textarea rows={5} value={v.description} onChange={set("description")} /></Field>
        <Field label="Hiring manager"><Select placeholder="— None —" value={v.hiring_manager_id} onChange={set("hiring_manager_id")} options={employees ?? []} /></Field>
        <Field label="Recruiter" hint="Sees and screens this opening's candidates."><Select placeholder="— None —" value={v.recruiter_id} onChange={set("recruiter_id")} options={employees ?? []} /></Field>
        <Field label="Opening date" hint="Blank = set when the job opens."><Input type="date" value={v.posting_date} onChange={set("posting_date")} /></Field>
        <Field label="Closing date" error={errors.closing_date}><Input type="date" value={v.closing_date} onChange={set("closing_date")} /></Field>
        <Field label="Eligibility checklist" hint="One criterion per line; used during screening." error={errors.eligibility_criteria}><Textarea rows={3} value={v.eligibility_criteria} onChange={set("eligibility_criteria")} /></Field>
        <Field label="Screening questions" hint="One question per line." error={errors.screening_questions}><Textarea rows={3} value={v.screening_questions} onChange={set("screening_questions")} /></Field>
        {canSalary && (
          <fieldset className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 p-3 sm:col-span-2 sm:grid-cols-4">
            <legend className="px-1 text-sm font-semibold text-[#173a52]">Salary range (confidential)</legend>
            <Field label="Minimum" error={errors.salary_min}><Input type="number" min={0} step="1000" value={v.salary_min} onChange={set("salary_min")} /></Field>
            <Field label="Maximum" error={errors.salary_max}><Input type="number" min={0} step="1000" value={v.salary_max} onChange={set("salary_max")} /></Field>
            <Field label="Currency"><Input value={v.salary_currency} maxLength={3} onChange={(e) => setV((s) => ({ ...s, salary_currency: e.target.value.toUpperCase() }))} /></Field>
            <Field label="Per"><Select value={v.salary_period} onChange={set("salary_period")} options={[{ value: "annual", label: "Year" }, { value: "monthly", label: "Month" }]} /></Field>
            <p className="text-xs text-slate-500 sm:col-span-4">Visible to recruitment managers only. Never shown to hiring managers, interviewers or on the careers page.</p>
          </fieldset>
        )}
      </div>
      {!isNew && <p className="mt-2 text-xs text-slate-500">Use Status to open, hold or close the job, and Publish to list it on the careers page.</p>}
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function ImportCareersModal({ open, onClose, onDone }) {
  const { notify } = useToast();
  const postings = useHrQuery(() => (open ? listCareersPostings() : Promise.resolve({ data: [], error: null })), [open]);
  const [posting, setPosting] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  function close() { setPosting(""); setResult(null); setError(null); onClose(); }
  async function go() {
    if (!posting) { setError("Choose a careers posting."); return; }
    setBusy(true); setError(null);
    const res = await importCareersApplications(posting);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setResult(res.data);
    notify(`Imported ${res.data?.imported ?? 0} application(s); ${res.data?.skipped ?? 0} skipped.`);
    onDone();
  }
  return (
    <Modal open={open} onClose={close} title="Import careers applications" size="md"
      footer={<><Button variant="secondary" onClick={close}>Close</Button>{!result && <Button loading={busy} onClick={go}>Import</Button>}</>}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-slate-600">Applications submitted on the careers site are copied into the HR pipeline. Candidates are matched by email; applications already imported are skipped, so running this again is safe.</p>
        {postings.loading ? <Loading /> : postings.error ? <ErrorState message={postings.error} onRetry={postings.reload} /> : (
          <Field label="Careers posting" required>
            <Select placeholder="Choose a posting" value={posting} disabled={Boolean(result)} onChange={(e) => setPosting(e.target.value)}
              options={(postings.data ?? []).map((j) => ({ value: j.id, label: `${j.title} · ${j.department} (${j.status})` }))} />
          </Field>
        )}
        {result && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-semibold text-emerald-800">Imported {result.imported}, skipped {result.skipped}.</p>}
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

// =====================================================================
// Pipeline
// =====================================================================
function PipelineTab({ initialOpening, employees }) {
  const p = usePerms();
  const navigate = useNavigate();
  const { notify } = useToast();
  const [opening, setOpening] = useState(initialOpening ?? "");
  const [stage, setStage] = useState("");
  const [search, setSearch] = useState("");
  const [recruiter, setRecruiter] = useState("");
  const [dates, setDates] = useState({ from: "", to: "" });
  const [view, setView] = useState("board");
  const [adding, setAdding] = useState(false);
  const openings = useHrQuery(() => listOpenings({}), []);
  const apps = useHrQuery(() => listApplications({ opening, from: dates.from, to: dates.to }), [opening, dates.from, dates.to]);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (apps.data ?? []).filter((a) => (!stage || (stage === "active" ? !TERMINAL_STAGES.includes(a.stage) : stage === "on_hold" ? a.on_hold : a.stage === stage))
      && (!recruiter || (a.recruiter_id ?? a.opening?.recruiter_id) === recruiter)
      && (!s || `${a.candidate?.full_name ?? ""} ${a.candidate?.email ?? ""} ${a.candidate?.phone ?? ""} ${(a.candidate?.skills ?? []).join(" ")}`.toLowerCase().includes(s)));
  }, [apps.data, stage, search, recruiter]);
  const open = (a) => navigate(`${BASE}/applications/${a.id}`);

  function doExport() {
    exportCsv(`recruitment-applications-${todayStr()}`, rows, [
      { label: "Candidate", value: (r) => r.candidate?.full_name }, { label: "Email", value: (r) => r.candidate?.email },
      { label: "Mobile", value: (r) => r.candidate?.phone }, { label: "Source", value: (r) => sourceLabel(r.source ?? r.candidate?.source) },
      { label: "Opening", value: (r) => r.opening?.title }, { label: "Stage", value: (r) => stageLabel(r.stage) },
      { label: "On hold", value: (r) => (r.on_hold ? "yes" : "") }, { label: "Recruiter", value: (r) => fullName(r.recruiter) },
      { label: "Experience (years)", value: (r) => r.candidate?.experience_years }, { label: "Notice period (days)", value: (r) => r.candidate?.notice_period_days },
      { label: "Location", value: (r) => r.candidate?.current_location }, { label: "Skills", value: (r) => (r.candidate?.skills ?? []).join("; ") },
      { label: "Stage changed", value: (r) => r.stage_changed_at }, { label: "Rejection reason", key: "rejected_reason" },
      { label: "Application date", value: (r) => r.applied_on ?? r.created_at },
    ]);
    notify(`Exported ${rows.length} applications.`);
  }

  const columns = [
    { key: "candidate", header: "Candidate", sortable: true, sortValue: (r) => r.candidate?.full_name?.toLowerCase(), render: (r) => (
      <div className="min-w-[11rem]"><p className="font-semibold text-[#101a3a]">{r.candidate?.full_name}</p><p className="text-xs text-slate-500">{r.candidate?.email}</p></div>) },
    { key: "opening", header: "Opening", render: (r) => r.opening?.title ?? "—" },
    { key: "stage", header: "Stage", sortable: true, sortValue: (r) => STAGES.indexOf(r.stage), render: (r) => (
      <span className="flex flex-col items-start gap-1"><StageBadge stage={r.stage} />{r.on_hold && <Badge tone="amber">on hold</Badge>}</span>) },
    { key: "applied_on", header: "Applied", sortable: true, render: (r) => formatDate(r.applied_on ?? r.created_at) },
    { key: "stage_changed_at", header: "Since", sortable: true, render: (r) => formatDate(r.stage_changed_at) },
    { key: "source", header: "Source", render: (r) => sourceLabel(r.source ?? r.candidate?.source) },
    { key: "recruiter", header: "Recruiter", render: (r) => (r.recruiter ? fullName(r.recruiter) : "—") },
    { key: "experience", header: "Experience", sortable: true, sortValue: (r) => r.candidate?.experience_years ?? -1, render: (r) => (r.candidate?.experience_years != null ? `${r.candidate.experience_years} yrs` : "—") },
  ];

  const byStage = (s) => rows.filter((a) => a.stage === s);
  const setDate = (k) => (e) => {
    const next = { ...dates, [k]: e.target.value };
    if (next.from && next.to && next.to < next.from) { notify("The end date is before the start date.", "error"); return; }
    setDates(next);
  };
  return (
    <>
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, email, mobile or skill…" label="Search applications" />
        <Select aria-label="Opening" className="sm:w-56" placeholder="All openings" value={opening} onChange={(e) => setOpening(e.target.value)}
          options={(openings.data ?? []).map((o) => ({ value: o.id, label: `${o.title} (${openingStatusLabel(o.status)})` }))} />
        <Select aria-label="Recruiter" className="sm:w-44" placeholder="Any recruiter" value={recruiter} onChange={(e) => setRecruiter(e.target.value)} options={employees ?? []} />
        {view === "table" && <Select aria-label="Stage" className="sm:w-44" placeholder="All stages" value={stage} onChange={(e) => setStage(e.target.value)}
          options={[{ value: "active", label: "In progress" }, { value: "on_hold", label: "On hold" }, ...STAGES.map((s) => ({ value: s, label: stageLabel(s) }))]} />}
        <Field label="Applied from" className="sm:w-40"><Input type="date" value={dates.from} onChange={setDate("from")} /></Field>
        <Field label="Applied to" className="sm:w-40"><Input type="date" value={dates.to} onChange={setDate("to")} /></Field>
        <Select aria-label="View" className="sm:w-36" value={view} onChange={(e) => { setView(e.target.value); setStage(""); }} options={[{ value: "board", label: "Board" }, { value: "table", label: "Table" }]} />
        {p.exportable && <Button variant="secondary" onClick={doExport} disabled={!rows.length}><Download className="h-4 w-4" aria-hidden="true" />Export CSV</Button>}
        {p.manage && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" />Add application</Button>}
      </Toolbar>

      {view === "table" ? (
        <DataTable caption="Applications" columns={columns} rows={rows} loading={apps.loading} error={apps.error} onRetry={apps.reload} onRowClick={open}
          emptyTitle="No applications" emptyDescription="Add an application or import careers applications." />
      ) : apps.loading && !apps.data ? <Loading /> : apps.error ? <ErrorState message={apps.error} onRetry={apps.reload} /> : (
        <>
          <div className="relative -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3" role="list" aria-label="Pipeline stages">
            {BOARD_STAGES.map((s) => {
              const items = byStage(s);
              return (
                <section key={s} role="listitem" aria-label={`${stageLabel(s)}: ${items.length}`} className="flex w-[78vw] max-w-[17rem] shrink-0 snap-start flex-col rounded-2xl border border-slate-200 bg-slate-50/70">
                  <h3 className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-600">
                    <span>{stageLabel(s)}</span><span className="rounded-full bg-white px-2 py-0.5 text-[#101a3a] ring-1 ring-slate-200">{items.length}</span>
                  </h3>
                  <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto p-2">
                    {items.length ? items.map((a) => (
                      <button key={a.id} type="button" onClick={() => open(a)}
                        className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-[#f96706]/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693]">
                        <span className="block font-semibold text-[#101a3a]">{a.candidate?.full_name}</span>
                        <span className="block truncate text-xs text-slate-500">{a.opening?.title}</span>
                        <span className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">since {formatDate(a.stage_changed_at)}{a.on_hold && <Badge tone="amber">on hold</Badge>}</span>
                      </button>
                    )) : <p className="px-1 py-3 text-center text-xs text-slate-400">No candidates</p>}
                  </div>
                </section>
              );
            })}
          </div>
          <p className="text-xs text-slate-500">Rejected: {byStage("rejected").length} · Withdrawn: {byStage("withdrawn").length}. Switch to the table view to list them. Swipe sideways to see every stage.</p>
        </>
      )}
      {adding && <AddCandidateModal openings={openings.data} employees={employees} canSalary={p.manage} defaultOpening={opening} onClose={() => setAdding(false)}
        onSaved={(appId, warning) => { setAdding(false); apps.reload(); notify(warning ?? "Application added.", warning ? "error" : undefined); if (appId) navigate(`${BASE}/applications/${appId}`); }} />}
    </>
  );
}

function AddCandidateModal({ openings, employees, canSalary, defaultOpening, onClose, onSaved }) {
  const [v, setV] = useState({
    opening_id: defaultOpening ?? "", full_name: "", email: "", phone: "", source: "other", current_company: "", experience_years: "", notes: "",
    skills: "", qualifications: "", current_location: "", notice_period_days: "", applied_on: todayStr(), recruiter_id: "", expected_salary: "", current_salary: "",
  });
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const choices = (openings ?? []).filter((o) => ["draft", "open", "on_hold"].includes(o.status));
  async function save() {
    const errs = {};
    if (!v.opening_id) errs.opening_id = "Choose an opening.";
    if (!v.full_name.trim()) errs.full_name = "Enter the candidate's name.";
    if (!EMAIL.test(v.email.trim())) errs.email = "Enter a valid email.";
    if (v.phone && !/^[+0-9 ()-]{7,20}$/.test(v.phone)) errs.phone = "Use digits, spaces, + ( ) - only.";
    if (!isBlank(v.experience_years) && !numIn(v.experience_years, 0, 60)) errs.experience_years = "0–60 years.";
    if (!isBlank(v.notice_period_days) && !(Number.isInteger(Number(v.notice_period_days)) && numIn(v.notice_period_days, 0, 365))) errs.notice_period_days = "0–365 days.";
    if (v.applied_on && v.applied_on > todayStr()) errs.applied_on = "Cannot be in the future.";
    for (const k of ["expected_salary", "current_salary"]) if (!isBlank(v[k]) && !(Number(v[k]) >= 0)) errs[k] = "Enter a non-negative amount.";
    if (file) { const chk = checkAttachmentFile(file); if (chk.error) errs.file = chk.error; }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await addApplication(v.opening_id, v, { includeSalary: canSalary });
    if (res.error) { setBusy(false); setError(res.error); return; }
    if (file) {
      const app = await getApplication(res.data);
      const up = app.data ? await uploadAttachment({ candidateId: app.data.candidate_id, applicationId: res.data, kind: "resume", file }) : app;
      setBusy(false);
      if (up.error) { onSaved(res.data, `The application was saved, but the resume upload failed: ${up.error} Upload it again from the application page.`); return; }
    } else setBusy(false);
    onSaved(res.data);
  }
  return (
    <Modal open onClose={onClose} title="Add application" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Add application</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Applied job" required error={errors.opening_id} className="sm:col-span-2">
          <Select placeholder="Choose an opening" value={v.opening_id} onChange={set("opening_id")} options={choices.map((o) => ({ value: o.id, label: `${o.title} (${openingStatusLabel(o.status)})` }))} />
        </Field>
        <Field label="Full name" required error={errors.full_name}><Input value={v.full_name} onChange={set("full_name")} /></Field>
        <Field label="Email" required error={errors.email} hint="An existing candidate with this email is reused; one application per job."><Input type="email" value={v.email} onChange={set("email")} /></Field>
        <Field label="Mobile" error={errors.phone}><Input type="tel" value={v.phone} onChange={set("phone")} /></Field>
        <Field label="Application source"><Select value={v.source} onChange={set("source")} options={CANDIDATE_SOURCES.map((s) => ({ value: s, label: sourceLabel(s) }))} /></Field>
        <Field label="Application date" error={errors.applied_on}><Input type="date" max={todayStr()} value={v.applied_on} onChange={set("applied_on")} /></Field>
        <Field label="Assigned recruiter" hint="Blank = the opening's recruiter."><Select placeholder="— Opening recruiter —" value={v.recruiter_id} onChange={set("recruiter_id")} options={employees ?? []} /></Field>
        <Field label="Current company"><Input value={v.current_company} onChange={set("current_company")} /></Field>
        <Field label="Experience (years)" error={errors.experience_years}><Input type="number" min={0} max={60} step="0.5" value={v.experience_years} onChange={set("experience_years")} /></Field>
        <Field label="Current location"><Input value={v.current_location} onChange={set("current_location")} /></Field>
        <Field label="Notice period (days)" error={errors.notice_period_days}><Input type="number" min={0} max={365} value={v.notice_period_days} onChange={set("notice_period_days")} /></Field>
        <Field label="Skills" hint="Comma separated." className="sm:col-span-2"><Input value={v.skills} onChange={set("skills")} /></Field>
        <Field label="Qualifications" className="sm:col-span-2"><Textarea rows={2} value={v.qualifications} onChange={set("qualifications")} /></Field>
        {canSalary && <>
          <Field label="Expected salary (annual)" error={errors.expected_salary} hint="Confidential."><Input type="number" min={0} step="1000" value={v.expected_salary} onChange={set("expected_salary")} /></Field>
          <Field label="Current salary (annual)" error={errors.current_salary}><Input type="number" min={0} step="1000" value={v.current_salary} onChange={set("current_salary")} /></Field>
        </>}
        <Field label="Resume / CV" error={errors.file} hint="PDF, Word or image, up to 10 MB." className="sm:col-span-2">
          <input type="file" accept={ATTACHMENT_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold" />
        </Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={v.notes} onChange={set("notes")} /></Field>
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

// =====================================================================
// Application detail (/hr/recruitment/applications/:id)
// =====================================================================
function ApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const p = usePerms();
  const { notify } = useToast();
  const org = useOrg();
  const employees = useEmployeeOptions();
  const app = useHrQuery(() => getApplication(id), [id]);
  const events = useHrQuery(() => listStageEvents(id), [id]);
  const interviews = useHrQuery(() => listInterviews(id), [id]);
  const offers = useHrQuery(() => listOffers(id), [id]);
  const [modal, setModal] = useState(null);   // move | schedule | offer | convert
  const [converted, setConverted] = useState(null);

  if (app.loading && !app.data) return <Loading />;
  if (app.error) return <ErrorState message={app.error} onRetry={app.reload} />;
  if (!app.data) return <EmptyState title="Application not found" description="It does not exist or you are not allowed to view it." action={<Button variant="secondary" onClick={() => navigate(`${BASE}/pipeline`)}>Back to applications</Button>} />;

  const a = app.data;
  const c = a.candidate ?? {};
  const offerList = offers.data ?? [];
  const activeOffer = offerList.find((o) => ["draft", "sent", "accepted"].includes(o.status));
  const acceptedOffer = offerList.find((o) => o.status === "accepted");
  const refresh = () => { app.reload(); events.reload(); interviews.reload(); offers.reload(); };
  const assignedRecruiter = Boolean(p.me) && (a.recruiter_id === p.me || a.opening?.recruiter_id === p.me);
  const canMove = p.manage && NEXT_STAGES[a.stage]?.length;
  const canSchedule = p.manage && ["shortlisted", "interview"].includes(a.stage);
  const canOffer = p.manage && ["selected", "offered"].includes(a.stage) && !activeOffer && !offers.loading;
  const canConvert = p.convert && a.stage === "offered" && Boolean(acceptedOffer);

  return (
    <>
      <button type="button" onClick={() => navigate(`${BASE}/pipeline`)} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Applications
      </button>
      <PageHeader title={c.full_name ?? "Candidate"}
        description={<span className="flex flex-wrap items-center gap-2"><span>{a.opening?.title}</span><StageBadge stage={a.stage} />{a.on_hold && <Badge tone="amber">on hold</Badge>}<span className="text-xs">since {formatDateTime(a.stage_changed_at)}</span></span>}
        actions={<>
          <ResumeButton path={c.resume_path} size="md" />
          {canMove && <Button variant="secondary" onClick={() => setModal("move")}>Move stage</Button>}
          {canConvert && <Button variant="success" onClick={() => setModal("convert")}><UserCheck className="h-4 w-4" aria-hidden="true" />Hire: create employee</Button>}
        </>} />

      {(converted || a.employee_id) && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          <span className="font-semibold">Hired: employee record{a.employee ? ` ${fullName(a.employee)} (${a.employee.employee_code})` : ""} created in Onboarding.</span>
          <Link to={`/hr/employees/${converted ?? a.employee_id}`} className="font-semibold text-[#1f4693] underline">Open employee record</Link>
        </div>
      )}
      {a.stage === "offered" && acceptedOffer && !p.convert && p.manage && (
        <p className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">The offer was accepted. An HR administrator with hiring permission can now create the employee record.</p>
      )}
      {a.stage === "rejected" && a.rejected_reason && <div className="mb-4"><InlineError message={`Rejected: ${a.rejected_reason}`} /></div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Candidate" className="lg:col-span-2">
          <DescriptionList items={[
            { label: "Email", value: c.email }, { label: "Mobile", value: c.phone },
            { label: "Current company", value: c.current_company },
            { label: "Experience", value: c.experience_years != null ? `${c.experience_years} years` : null },
            c.notes ? { label: "Notes", value: <span className="whitespace-pre-wrap">{c.notes}</span> } : null,
          ]} />
        </Card>
        <Card title="Stage history">
          {events.loading && !events.data ? <Loading /> : events.error ? <ErrorState message={events.error} onRetry={events.reload} /> : (
            <ol className="flex max-h-96 flex-col gap-3 overflow-y-auto">
              {(events.data ?? []).map((e) => (
                <li key={e.id} className="border-l-2 border-[#f96706]/40 pl-3">
                  <p className="text-sm font-semibold text-[#101a3a]">{e.from_stage && e.from_stage !== e.to_stage ? `${stageLabel(e.from_stage)} → ` : ""}{stageLabel(e.to_stage)}</p>
                  {e.note && <p className="text-xs text-slate-600">{e.note}</p>}
                  <p className="text-[11px] text-slate-400">{formatDateTime(e.changed_at)}</p>
                </li>
              ))}
              {!events.data?.length && <li className="text-sm text-slate-500">No history yet.</li>}
            </ol>
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ApplicationFactsCard application={a} employees={employees.data} onChanged={refresh} />
        <ScreeningPanel application={a} onChanged={refresh} />
        <AttachmentsPanel application={a} />
        <NotesPanel application={a} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Interviews" actions={canSchedule && <Button size="sm" onClick={() => setModal("schedule")}><CalendarPlus className="h-4 w-4" aria-hidden="true" />Schedule</Button>}>
          <InterviewList q={interviews} canManage={p.manage || assignedRecruiter} canReopen={p.manage} employees={employees.data} onChanged={() => { interviews.reload(); events.reload(); }} />
          {!canSchedule && p.manage && !TERMINAL_STAGES.includes(a.stage) && <p className="mt-3 text-xs text-slate-500">Interviews can be scheduled once the candidate is shortlisted.</p>}
        </Card>
        <div className="flex flex-col gap-4">
          <DecisionPanel application={a} onChanged={refresh} />
          <Card title="Offers" actions={canOffer && <Button size="sm" onClick={() => setModal("offer")}><Plus className="h-4 w-4" aria-hidden="true" />Create offer</Button>}>
            {offers.loading && !offers.data ? <Loading /> : offers.error ? <ErrorState message={offers.error} onRetry={offers.reload} /> : !offerList.length ? (
              <EmptyState title="No offers yet" description={p.manage ? "Offers can be created once the candidate is selected." : undefined} />
            ) : (
              <ul className="flex flex-col gap-3">
                {offerList.slice().reverse().map((o) => (
                  <OfferCard key={o.id} offer={o} application={a} org={org.data} employees={employees.data} canManage={p.manage} onChanged={refresh} />
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {modal === "move" && <MoveStageModal application={a} onClose={() => setModal(null)} onDone={(to) => { setModal(null); refresh(); notify(`Candidate moved to ${stageLabel(to)}.`); }} />}
      {modal === "schedule" && <ScheduleInterviewModal application={a} employees={employees.data} existing={interviews.data} onClose={() => setModal(null)}
        onDone={() => { setModal(null); refresh(); notify("Interview scheduled; the panel has been notified in the portal."); }} />}
      {modal === "offer" && <OfferModal application={a} org={org.data} onClose={() => setModal(null)} onDone={() => { setModal(null); offers.reload(); notify("Draft offer created. Complete it, generate the letter, then issue it."); }} />}
      {modal === "convert" && <ConvertCandidateModal application={a} offer={acceptedOffer} org={org.data} employees={employees.data} onClose={() => setModal(null)}
        onDone={(empId) => { setModal(null); setConverted(empId); refresh(); notify("Candidate hired: employee record created."); }} />}
    </>
  );
}

function InterviewList({ q, canManage, canReopen, employees, onChanged }) {
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data?.length) return <EmptyState title="No interviews scheduled" />;
  return (
    <ul className="flex flex-col gap-3">
      {q.data.map((i) => {
        const fb = (i.feedback ?? []).filter((f) => f.status !== "draft");
        const avg = fb.length ? (fb.reduce((s, f) => s + f.rating, 0) / fb.length).toFixed(1) : null;
        return (
          <li key={i.id} className="rounded-xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-[#101a3a]">Round {i.round} · {lbl(i.interview_type)}</span>
              <StatusBadge status={i.status} />
            </div>
            <p className="mt-1 text-sm text-slate-600">{formatDateTime(i.scheduled_at)} · {i.duration_minutes} min · {modeLabel(i.mode)}</p>
            {i.location_or_link && <p className="break-all text-xs text-slate-500">{i.location_or_link}</p>}
            <p className="mt-1 text-xs text-slate-600">Panel: {(i.panel ?? []).map((m) => fullName(m.employee) || "—").join(", ") || "—"}</p>
            <p className="mt-1 text-xs text-slate-600">Evaluations: {fb.length}/{(i.panel ?? []).length} submitted{avg ? ` · average rating ${avg}/5` : ""}</p>
            <EvaluationList interview={i} canReopen={canReopen} onChanged={onChanged} />
            <InterviewActions interview={i} canManage={canManage} employees={employees} onChanged={onChanged} />
          </li>
        );
      })}
    </ul>
  );
}

function MoveStageModal({ application, onClose, onDone }) {
  const choices = NEXT_STAGES[application.stage] ?? [];
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!to) { setError("Choose the new stage."); return; }
    if (to === "rejected" && !note.trim()) { setError("Give a reason for rejecting the candidate."); return; }
    setBusy(true); setError(null);
    const res = await moveStage(application.id, to, note);
    setBusy(false);
    if (res.error) setError(res.error); else onDone(to);
  }
  return (
    <Modal open onClose={onClose} title="Move candidate" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={["rejected", "withdrawn"].includes(to) ? "danger" : "primary"} loading={busy} onClick={go}>{to ? `Move to ${lbl(to)}` : "Move"}</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">Current stage: <StageBadge stage={application.stage} /></p>
        <Field label="New stage" required><Select placeholder="Choose a stage" value={to} onChange={(e) => setTo(e.target.value)} options={choices.map((s) => ({ value: s, label: stageLabel(s) }))} /></Field>
        {to === "offered" && <p className="text-xs text-slate-500">Requires a sent or accepted offer. Marking an offer as sent moves the candidate automatically.</p>}
        {["rejected", "withdrawn"].includes(to) && <p className="text-xs font-medium text-amber-700">Scheduled interviews are cancelled and open offers are withdrawn. This cannot be undone.</p>}
        <Field label={to === "rejected" ? "Reason" : "Note (optional)"} required={to === "rejected"}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function ScheduleInterviewModal({ application, employees, existing, onClose, onDone }) {
  const nextRound = Math.min(20, Math.max(0, ...(existing ?? []).map((i) => i.round)) + 1);
  const [v, setV] = useState({ scheduled_at: "", round: nextRound, interview_type: "technical", duration_minutes: 60, mode: "video", location_or_link: "", interviewers: [] });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function go() {
    const errs = {};
    if (!v.scheduled_at || Number.isNaN(new Date(v.scheduled_at).getTime())) errs.scheduled_at = "Choose the date and time.";
    if (!Number.isInteger(Number(v.round)) || !numIn(v.round, 1, 20)) errs.round = "Round 1–20.";
    if (!Number.isInteger(Number(v.duration_minutes)) || !numIn(v.duration_minutes, 5, 480)) errs.duration_minutes = "5–480 minutes.";
    if (!v.interviewers.length) errs.interviewers = "Add at least one interviewer.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await scheduleInterview({ ...v, application_id: application.id, scheduled_at: fromLocalInput(v.scheduled_at) });
    setBusy(false);
    if (res.error) setError(res.error); else onDone();
  }
  return (
    <Modal open onClose={onClose} title="Schedule interview" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Schedule</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date and time" required error={errors.scheduled_at} hint="Your local time."><Input type="datetime-local" value={v.scheduled_at} onChange={set("scheduled_at")} /></Field>
        <Field label="Duration (minutes)" required error={errors.duration_minutes}><Input type="number" min={5} max={480} value={v.duration_minutes} onChange={set("duration_minutes")} /></Field>
        <Field label="Round" required error={errors.round}><Input type="number" min={1} max={20} value={v.round} onChange={set("round")} /></Field>
        <Field label="Type"><Select value={v.interview_type} onChange={set("interview_type")} options={opts(INTERVIEW_TYPES)} /></Field>
        <Field label="Mode"><Select value={v.mode} onChange={set("mode")} options={opts(INTERVIEW_MODES)} /></Field>
        <Field label={v.mode === "in_person" ? "Location" : "Meeting link / dial-in"}><Input value={v.location_or_link} onChange={set("location_or_link")} maxLength={1000} /></Field>
        <div className="sm:col-span-2">
          <MultiPick legend="Interview panel" options={employees ?? []} value={v.interviewers} onChange={(ids) => setV((s) => ({ ...s, interviewers: ids }))} error={errors.interviewers} />
        </div>
      </div>
      {application.stage === "shortlisted" && <p className="mt-2 text-xs text-slate-500">The candidate moves to the Interview stage.</p>}
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function OfferModal({ application, org, onClose, onDone }) {
  const [v, setV] = useState({ designation_id: "", department_id: application.opening?.department_id ?? "", employment_type: application.opening?.employment_type ?? "full_time", joining_date: "", annual_ctc: "", expires_on: "", notes: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function go() {
    const errs = {};
    if (!isBlank(v.annual_ctc) && !(Number(v.annual_ctc) >= 0)) errs.annual_ctc = "Enter a non-negative amount.";
    if (v.expires_on && v.expires_on < todayStr()) errs.expires_on = "Expiry cannot be in the past.";
    if (v.joining_date && v.joining_date < todayStr()) errs.joining_date = "Joining date cannot be in the past.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await createOffer({ ...v, application_id: application.id });
    setBusy(false);
    if (res.error) setError(res.error); else onDone();
  }
  const designations = (org?.designations ?? []).filter((d) => !v.department_id || !d.department_id || d.department_id === v.department_id);
  return (
    <Modal open onClose={onClose} title="Create offer (draft)" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Create draft</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Department"><Select placeholder="— Opening's department —" value={v.department_id} onChange={set("department_id")} options={toOptions(org?.departments)} /></Field>
        <Field label="Designation"><Select placeholder="— None —" value={v.designation_id} onChange={set("designation_id")} options={toOptions(designations)} /></Field>
        <Field label="Employment type"><Select value={v.employment_type} onChange={set("employment_type")} options={toOptions(org?.employmentTypes, "name", "code")} /></Field>
        <Field label="Proposed joining date" error={errors.joining_date}><Input type="date" value={v.joining_date} onChange={set("joining_date")} /></Field>
        <Field label="Annual CTC (INR)" error={errors.annual_ctc} hint="Visible only to users with recruitment.manage."><Input type="number" min={0} step="1000" value={v.annual_ctc} onChange={set("annual_ctc")} /></Field>
        <Field label="Offer expires on" error={errors.expires_on} hint="Blank = the default validity from recruitment settings."><Input type="date" value={v.expires_on} onChange={set("expires_on")} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={v.notes} onChange={set("notes")} /></Field>
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function ConvertCandidateModal({ application, offer, org, employees, onClose, onDone }) {
  const [v, setV] = useState({
    company_email: "", joining_date: offer?.proposed_joining_date ?? "", department_id: offer?.department_id ?? "",
    designation_id: offer?.offered_designation_id ?? "", manager_id: "", employment_type: offer?.employment_type ?? "",
  });
  const [errors, setErrors] = useState({});
  const [confirming, setConfirming] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  function review() {
    const errs = {};
    if (!EMAIL.test(v.company_email.trim())) errs.company_email = "Enter a valid company email.";
    if (!v.joining_date) errs.joining_date = "Enter the joining date.";
    if (!v.employment_type) errs.employment_type = "Choose an employment type.";
    setErrors(errs);
    if (!Object.keys(errs).length) setConfirming(true);
  }
  const typeName = org?.employmentTypes.find((t) => t.code === v.employment_type)?.name ?? v.employment_type;
  return (
    <>
      <Modal open={!confirming} onClose={onClose} title="Hire candidate: create employee record" size="lg"
        footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={review}>Review conversion</Button></>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Company email" required error={errors.company_email} className="sm:col-span-2"><Input type="email" value={v.company_email} onChange={set("company_email")} /></Field>
          <Field label="Joining date" required error={errors.joining_date}><Input type="date" value={v.joining_date} onChange={set("joining_date")} /></Field>
          <Field label="Employment type" required error={errors.employment_type}><Select placeholder="Choose" value={v.employment_type} onChange={set("employment_type")} options={toOptions(org?.employmentTypes, "name", "code")} /></Field>
          <Field label="Department"><Select placeholder="— None —" value={v.department_id} onChange={set("department_id")} options={toOptions(org?.departments)} /></Field>
          <Field label="Designation"><Select placeholder="— None —" value={v.designation_id} onChange={set("designation_id")} options={toOptions(org?.designations)} /></Field>
          <Field label="Reporting manager" hint="For intern hires this person also becomes the internship mentor." className="sm:col-span-2"><Select placeholder="— None —" value={v.manager_id} onChange={set("manager_id")} options={employees ?? []} /></Field>
        </div>
        <p className="mt-3 text-xs text-slate-500">One employee record is created in Employee Management, linked to this application and job opening; the candidate and recruitment history are kept. The record starts in Onboarding, which starts the onboarding workflow. Portal access is granted separately by sending an invitation from the employee record.</p>
      </Modal>
      <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} tone="success" title="Create employee record"
        message={`Create an employee record for ${application.candidate?.full_name} (${typeName}, joining ${formatDate(v.joining_date)}, ${v.company_email.trim()})? The candidate is marked Hired. This cannot be undone.`}
        confirmLabel="Convert" onConfirm={async () => {
          const res = await convertCandidate({ ...v, application_id: application.id });
          if (!res.error) onDone(res.data);
          return res;
        }} />
    </>
  );
}

// =====================================================================
// Candidates
// =====================================================================
function CandidatesTab() {
  const p = usePerms();
  const navigate = useNavigate();
  const { notify } = useToast();
  const [search, setSearch] = useState("");
  const q = useHrQuery(() => listCandidates({ search }), [search]);
  const openings = useHrQuery(() => listOpenings({ status: "active" }), []);
  const [detail, setDetail] = useState(null);
  const [adding, setAdding] = useState(false);
  const columns = [
    { key: "full_name", header: "Candidate", sortable: true, sortValue: (r) => r.full_name.toLowerCase(), render: (r) => (
      <div className="min-w-[11rem]"><p className="font-semibold text-[#101a3a]">{r.full_name}</p><p className="text-xs text-slate-500">{r.email}</p></div>) },
    { key: "current_company", header: "Company", render: (r) => r.current_company ?? "—" },
    { key: "experience_years", header: "Experience", sortable: true, render: (r) => (r.experience_years != null ? `${r.experience_years} yrs` : "—") },
    { key: "source", header: "Source", render: (r) => lbl(r.source) },
    { key: "applications", header: "Applications", render: (r) => (
      <div className="flex flex-col gap-1">{(r.applications ?? []).map((a) => <span key={a.id} className="text-xs">{a.opening?.title ?? "—"} <StageBadge stage={a.stage} /></span>)}{!r.applications?.length && "—"}</div>) },
    { key: "created_at", header: "Added", sortable: true, render: (r) => formatDate(r.created_at) },
  ];
  return (
    <>
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, email or company…" label="Search candidates" />
        {p.manage && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" />Add candidate</Button>}
      </Toolbar>
      <DataTable caption="Candidates" columns={columns} rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} onRowClick={setDetail} emptyTitle="No candidates found" />
      {detail && <CandidateModal candidate={detail} canEdit={p.manage} onClose={() => setDetail(null)} onOpenApplication={(id) => navigate(`${BASE}/applications/${id}`)}
        onSaved={() => { setDetail(null); q.reload(); notify("Candidate updated."); }} />}
      {adding && <AddCandidateModal openings={openings.data} canSalary={p.manage} onClose={() => setAdding(false)}
        onSaved={(appId, warning) => { setAdding(false); q.reload(); notify(warning ?? "Application added.", warning ? "error" : undefined); if (appId) navigate(`${BASE}/applications/${appId}`); }} />}
    </>
  );
}

function CandidateModal({ candidate, canEdit, onClose, onOpenApplication, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({ full_name: candidate.full_name, phone: candidate.phone ?? "", source: candidate.source, current_company: candidate.current_company ?? "", experience_years: candidate.experience_years ?? "", notes: candidate.notes ?? "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    const errs = {};
    if (!v.full_name.trim()) errs.full_name = "Name is required.";
    if (v.phone && !/^[+0-9 ()-]{7,20}$/.test(v.phone)) errs.phone = "Use digits, spaces, + ( ) - only.";
    if (!isBlank(v.experience_years) && !numIn(v.experience_years, 0, 60)) errs.experience_years = "0–60 years.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await updateCandidate(candidate.id, { ...v, full_name: v.full_name.trim() });
    setBusy(false);
    if (res.error) setError(res.error); else onSaved();
  }
  return (
    <Modal open onClose={onClose} title={candidate.full_name} size="lg"
      footer={editing ? <><Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>
        : <><ResumeButton path={candidate.resume_path} size="md" />{canEdit && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}<Button variant="secondary" onClick={onClose}>Close</Button></>}>
      {editing ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Full name" required error={errors.full_name}><Input value={v.full_name} onChange={set("full_name")} /></Field>
          <Field label="Email" hint="The email identifies the candidate and cannot be changed."><Input value={candidate.email} disabled /></Field>
          <Field label="Phone" error={errors.phone}><Input type="tel" value={v.phone} onChange={set("phone")} /></Field>
          <Field label="Source"><Select value={v.source} onChange={set("source")} options={CANDIDATE_SOURCES.map((s) => ({ value: s, label: sourceLabel(s) }))} /></Field>
          <Field label="Current company"><Input value={v.current_company} onChange={set("current_company")} /></Field>
          <Field label="Experience (years)" error={errors.experience_years}><Input type="number" min={0} max={60} step="0.5" value={v.experience_years} onChange={set("experience_years")} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={v.notes} onChange={set("notes")} /></Field>
          <div className="sm:col-span-2"><InlineError message={error} /></div>
        </div>
      ) : (
        <>
          <DescriptionList items={[
            { label: "Email", value: candidate.email }, { label: "Phone", value: candidate.phone },
            { label: "Source", value: sourceLabel(candidate.source) }, { label: "Current company", value: candidate.current_company },
            { label: "Experience", value: candidate.experience_years != null ? `${candidate.experience_years} years` : null },
            { label: "Current location", value: candidate.current_location },
            { label: "Notice period", value: candidate.notice_period_days != null ? `${candidate.notice_period_days} days` : null },
            { label: "Skills", value: candidate.skills?.length ? candidate.skills.join(", ") : null },
            candidate.qualifications ? { label: "Qualifications", value: <span className="whitespace-pre-wrap">{candidate.qualifications}</span> } : null,
            { label: "Careers resume", value: candidate.resume_path ? "On file" : "Not on file (see uploaded files on each application)" },
            candidate.notes ? { label: "Notes", value: <span className="whitespace-pre-wrap">{candidate.notes}</span> } : null,
          ]} />
          <h3 className="mt-5 text-sm font-bold text-[#101a3a]">Applications</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {(candidate.applications ?? []).map((a) => (
              <li key={a.id}><button type="button" onClick={() => onOpenApplication(a.id)} className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50">
                <span className="font-semibold text-[#101a3a]">{a.opening?.title ?? "Opening"}</span><StageBadge stage={a.stage} />
              </button></li>
            ))}
            {!candidate.applications?.length && <li className="text-sm text-slate-500">No applications.</li>}
          </ul>
        </>
      )}
    </Modal>
  );
}

// =====================================================================
// Interviews ("My interviews" for panel members; upcoming for recruiters)
// =====================================================================
// Exported for the Employee Portal ("My Interviews"): panel members who hold no
// HR permission use it there with openApplications={false}.
export function InterviewsTab({ openApplications = true }) {
  const p = usePerms();
  const navigate = useNavigate();
  const { notify } = useToast();
  const [view, setView] = useState(p.me ? "mine" : "calendar");
  const [status, setStatus] = useState("scheduled");
  const [weekStart, setWeekStart] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; });
  const weekEnd = useMemo(() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); return d; }, [weekStart]);
  const mine = useHrQuery(() => (view === "mine" ? listMyInterviews(p.me) : Promise.resolve({ data: null, error: null })), [view, p.me]);
  const all = useHrQuery(() => (view === "list" ? listAllInterviews({ status }) : view === "calendar"
    ? listAllInterviews({ status: "", from: weekStart.toISOString(), to: weekEnd.toISOString() }) : Promise.resolve({ data: null, error: null })),
  [view, status, weekStart.getTime()]);
  const [evalFor, setEvalFor] = useState(null);
  const now = Date.now();

  const mineColumns = [
    { key: "candidate", header: "Candidate", render: (r) => (
      <div className="min-w-[10rem]"><p className="font-semibold text-[#101a3a]">{r.application?.candidate?.full_name ?? "—"}</p><p className="text-xs text-slate-500">{r.application?.opening?.title}</p></div>) },
    { key: "round", header: "Round", render: (r) => `${r.round} · ${lbl(r.interview_type)}` },
    { key: "scheduled_at", header: "When", sortable: true, render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.scheduled_at)}<br /><span className="text-xs text-slate-500">{r.duration_minutes} min · {modeLabel(r.mode)}</span></span> },
    { key: "where", header: "Where", render: (r) => <span className="break-all text-xs">{r.location_or_link ?? "—"}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "feedback", header: "My evaluation", render: (r) => {
      const f = r.my_feedback;
      if (f?.status === "submitted") return <Badge tone="green">submitted · {f.rating}/5</Badge>;
      if (["cancelled", "no_show"].includes(r.status)) return <span className="text-xs text-slate-500">not applicable</span>;
      return (
        <span className="flex flex-col items-start gap-1">
          {f?.status === "draft" && <Badge tone="amber">{f.reopen_reason ? "re-opened by HR" : "draft"}</Badge>}
          <Button size="sm" variant={f ? "secondary" : "primary"} onClick={(e) => { e.stopPropagation(); setEvalFor(r); }}>{f ? "Continue" : "Write evaluation"}</Button>
          {new Date(r.scheduled_at).getTime() > now && <span className="text-[11px] text-slate-500">submit opens at start time</span>}
        </span>
      );
    } },
    { key: "_open", header: <span className="sr-only">Open</span>, render: (r) => (
      <span className="flex flex-wrap gap-1">
        <ResumeButton path={r.application?.candidate?.resume_path} />
        {openApplications && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(`${BASE}/applications/${r.application_id}`); }}>Open</Button>}
      </span>) },
  ];
  const allColumns = [
    { key: "candidate", header: "Candidate", render: (r) => (
      <div className="min-w-[10rem]"><p className="font-semibold text-[#101a3a]">{r.application?.candidate?.full_name ?? "—"}</p><p className="text-xs text-slate-500">{r.application?.opening?.title}</p></div>) },
    { key: "round", header: "Round", render: (r) => `${r.round} · ${lbl(r.interview_type)}` },
    { key: "scheduled_at", header: "When", sortable: true, render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.scheduled_at)}{r.reschedule_count > 0 && <Badge tone="amber" className="ml-1">rescheduled</Badge>}</span> },
    { key: "mode", header: "Mode", render: (r) => modeLabel(r.mode) },
    { key: "panel", header: "Interviewers", render: (r) => (r.panel ?? []).map((m) => fullName(m.employee)).join(", ") || "—" },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "feedback", header: "Evaluations", render: (r) => `${(r.feedback ?? []).filter((f) => f.status !== "draft").length}/${(r.panel ?? []).length}` },
  ];

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; }), [weekStart]);
  const sameDay = (iso, d) => { const x = new Date(iso); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate(); };
  const shiftWeek = (n) => setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() + 7 * n); return d; });

  return (
    <>
      <Toolbar>
        <Select aria-label="Interviews to show" className="sm:w-64" value={view} onChange={(e) => setView(e.target.value)}
          options={[...(p.me ? [{ value: "mine", label: "My interviews (panel member)" }] : []),
            ...(p.recView ? [{ value: "calendar", label: "Interview calendar (week)" }, { value: "list", label: "All interviews (list)" }] : [])]} />
        {view === "list" && <Select aria-label="Status" className="sm:w-44" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: "scheduled", label: "Scheduled" }, { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" }, { value: "no_show", label: "No show" }, { value: "", label: "All statuses" }]} />}
        {view === "calendar" && (
          <span className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => shiftWeek(-1)} aria-label="Previous week">‹</Button>
            <span className="text-sm font-semibold text-[#101a3a]">{formatDate(days[0])} – {formatDate(days[6])}</span>
            <Button size="sm" variant="secondary" onClick={() => shiftWeek(1)} aria-label="Next week">›</Button>
          </span>
        )}
      </Toolbar>
      {view === "mine" ? (
        <DataTable caption="My interviews" columns={mineColumns} rows={mine.data} loading={mine.loading} error={mine.error} onRetry={mine.reload}
          emptyTitle="No interviews" emptyDescription="Interviews where you sit on the panel appear here." />
      ) : view === "list" ? (
        <DataTable caption="Interviews" columns={allColumns} rows={all.data} loading={all.loading} error={all.error} onRetry={all.reload}
          onRowClick={(r) => navigate(`${BASE}/applications/${r.application_id}`)} emptyTitle="No interviews" />
      ) : all.loading && !all.data ? <Loading /> : all.error ? <ErrorState message={all.error} onRetry={all.reload} /> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7" role="list" aria-label="Interview calendar">
          {days.map((d) => {
            const items = (all.data ?? []).filter((i) => sameDay(i.scheduled_at, d)).sort((x, y) => new Date(x.scheduled_at) - new Date(y.scheduled_at));
            const isToday = sameDay(new Date().toISOString(), d);
            return (
              <section key={d.toISOString()} role="listitem" aria-label={`${d.toDateString()}: ${items.length} interviews`}
                className={`flex min-h-[6rem] flex-col rounded-2xl border ${isToday ? "border-[#f96706]" : "border-slate-200"} bg-slate-50/70`}>
                <h3 className="border-b border-slate-200 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-600">
                  {d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" })}
                </h3>
                <div className="flex flex-col gap-2 p-2">
                  {items.length ? items.map((i) => (
                    <button key={i.id} type="button" onClick={() => navigate(`${BASE}/applications/${i.application_id}`)}
                      className={`rounded-xl border bg-white p-2 text-left text-xs shadow-sm hover:border-[#f96706]/50 ${i.status === "cancelled" ? "opacity-60 line-through" : ""} border-slate-200`}>
                      <span className="block font-semibold text-[#101a3a]">{new Date(i.scheduled_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · {i.application?.candidate?.full_name}</span>
                      <span className="block truncate text-slate-500">{i.application?.opening?.title} · R{i.round} · {modeLabel(i.mode)}</span>
                      <span className="block truncate text-slate-500">{(i.panel ?? []).map((m) => fullName(m.employee)).join(", ")}</span>
                      {i.status !== "scheduled" && <span className="mt-1 block"><StatusBadge status={i.status} /></span>}
                    </button>
                  )) : <p className="px-1 py-2 text-center text-[11px] text-slate-400">—</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {evalFor && <InterviewEvaluationModal interview={evalFor} existing={evalFor.my_feedback} onClose={() => setEvalFor(null)}
        onDone={(submitted) => { setEvalFor(null); mine.reload(); notify(submitted ? "Evaluation submitted." : "Draft saved."); }} />}
    </>
  );
}

// =====================================================================
// Interns
// =====================================================================
function InternsTab({ org, employees }) {
  const p = usePerms();
  const { notify } = useToast();
  const [status, setStatus] = useState("active");
  const q = useHrQuery(() => listInternships({ status }), [status]);
  const [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(false);
  const columns = [
    { key: "intern", header: "Intern", sortable: true, sortValue: (r) => fullName(r.employee).toLowerCase(), render: (r) => (
      <div className="min-w-[10rem]"><p className="font-semibold text-[#101a3a]">{fullName(r.employee) || "—"}</p><p className="font-mono text-xs text-[#1f4693]">{r.employee?.employee_code}</p></div>) },
    { key: "mentor", header: "Mentor", render: (r) => (r.mentor ? fullName(r.mentor) : "—") },
    { key: "department", header: "Department", render: (r) => r.department?.name ?? "—" },
    { key: "period", header: "Period", sortable: true, sortValue: (r) => r.start_date, render: (r) => <span className="whitespace-nowrap">{formatDate(r.start_date)} – {formatDate(r.end_date)}</span> },
    { key: "project", header: "Project", render: (r) => <span className="line-clamp-2">{r.project ?? "—"}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "certificate", header: "Certificate", render: (r) => (r.certificate_issued_at ? <Badge tone="green">issued</Badge> : r.certificate_eligible ? <Badge tone="blue">eligible</Badge> : "—") },
  ];
  return (
    <>
      <Toolbar>
        <Select aria-label="Internship status" className="sm:w-44" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: "", label: "All statuses" }, ...opts(INTERNSHIP_STATUSES)]} />
        {p.internsManage && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden="true" />New internship</Button>}
      </Toolbar>
      <DataTable caption="Internships" columns={columns} rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} onRowClick={setDetail}
        emptyTitle="No internships" emptyDescription={p.internsManage ? "Create an internship for an intern-type employee." : "Internships you can see (your team or mentees) appear here."} />
      {creating && <InternshipFormModal org={org.data} employees={employees.data} onClose={() => setCreating(false)}
        onSaved={() => { setCreating(false); q.reload(); notify("Internship created."); }} />}
      {detail && <InternshipDetailModal internship={detail} org={org.data} employees={employees.data} onClose={() => setDetail(null)}
        onChanged={(msg, close) => { q.reload(); if (msg) notify(msg); if (close) setDetail(null); }} />}
    </>
  );
}

function InternshipFormModal({ internship, org, employees, onClose, onSaved }) {
  const isNew = !internship;
  const internCodes = (org?.employmentTypes ?? []).filter((t) => t.is_intern).map((t) => t.code);
  const interns = useHrQuery(() => (isNew ? listInternEmployees(internCodes) : Promise.resolve({ data: [], error: null })), [isNew, internCodes.join(",")]);
  const [v, setV] = useState({
    employee_id: internship?.employee_id ?? "", mentor_id: internship?.mentor_id ?? "", department_id: internship?.department_id ?? "",
    start_date: internship?.start_date ?? "", end_date: internship?.end_date ?? "", project: internship?.project ?? "", learning_goals: internship?.learning_goals ?? "",
    status: internship?.status ?? "active", completion_date: internship?.completion_date ?? "", certificate_eligible: Boolean(internship?.certificate_eligible),
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmTerminate, setConfirmTerminate] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  function validate() {
    const errs = {};
    if (isNew && !v.employee_id) errs.employee_id = "Choose the intern.";
    if (v.mentor_id && v.mentor_id === (internship?.employee_id ?? v.employee_id)) errs.mentor_id = "An intern cannot mentor themselves.";
    if (!v.start_date) errs.start_date = "Enter the start date.";
    if (v.end_date && v.start_date && v.end_date < v.start_date) errs.end_date = "End date must be on or after the start date.";
    if (v.certificate_eligible === false && internship?.certificate_issued_at) errs.certificate_eligible = "A certificate was already issued.";
    setErrors(errs);
    return !Object.keys(errs).length;
  }
  async function persist() {
    setBusy(true); setError(null);
    const values = { ...v };
    if (isNew) { delete values.status; delete values.completion_date; }
    const res = isNew ? await createInternship(values) : await updateInternship(internship.id, values);
    setBusy(false);
    if (res.error) { setError(res.error); return res; }
    onSaved();
    return {};
  }
  function save() {
    if (!validate()) return;
    if (!isNew && v.status === "terminated" && internship.status !== "terminated") { setConfirmTerminate(true); return; }
    persist();
  }
  const statusOptions = opts(INTERNSHIP_EDIT_STATUSES);
  return (
    <>
      <Modal open={!confirmTerminate} onClose={onClose} title={isNew ? "New internship" : `Edit internship: ${fullName(internship.employee)}`} size="lg"
        footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{isNew ? "Create internship" : "Save"}</Button></>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {isNew ? (
            <Field label="Intern" required error={errors.employee_id} className="sm:col-span-2" hint="Only employees on an intern employment type are listed.">
              {interns.loading ? <Loading /> : interns.error ? <ErrorState message={interns.error} onRetry={interns.reload} /> : (
                <Select placeholder="Choose the intern" value={v.employee_id} onChange={set("employee_id")}
                  options={(interns.data ?? []).map((e) => ({ value: e.id, label: `${fullName(e)} (${e.employee_code})` }))} />
              )}
            </Field>
          ) : null}
          <Field label="Mentor" error={errors.mentor_id}><Select placeholder="— None —" value={v.mentor_id} onChange={set("mentor_id")} options={(employees ?? []).filter((e) => e.value !== (internship?.employee_id ?? v.employee_id))} /></Field>
          <Field label="Department" hint={isNew ? "Blank = the intern's department." : undefined}><Select placeholder="— None —" value={v.department_id} onChange={set("department_id")} options={toOptions(org?.departments)} /></Field>
          <Field label="Start date" required error={errors.start_date}><Input type="date" value={v.start_date} onChange={set("start_date")} /></Field>
          <Field label="End date" error={errors.end_date}><Input type="date" value={v.end_date} onChange={set("end_date")} /></Field>
          <Field label="Project" className="sm:col-span-2"><Input value={v.project} onChange={set("project")} /></Field>
          <Field label="Learning goals" className="sm:col-span-2"><Textarea value={v.learning_goals} onChange={set("learning_goals")} /></Field>
          {!isNew && (
            <>
              <Field label="Status" hint="Conversion to employee uses the Convert action."><Select value={v.status} onChange={set("status")} options={statusOptions} /></Field>
              <Field label="Completion date" hint="Set automatically when completed or terminated if left blank."><Input type="date" value={v.completion_date ?? ""} onChange={set("completion_date")} /></Field>
            </>
          )}
          <div className="sm:col-span-2">
            <Checkbox label="Eligible for an internship certificate" checked={v.certificate_eligible} onChange={set("certificate_eligible")} />
            {errors.certificate_eligible && <p className="text-xs font-medium text-red-600" role="alert">{errors.certificate_eligible}</p>}
          </div>
        </div>
        <div className="mt-3"><InlineError message={error} /></div>
      </Modal>
      <ConfirmDialog open={confirmTerminate} onClose={() => setConfirmTerminate(false)} tone="danger" title="Terminate internship"
        message="Ending the internship as Terminated is recorded in the audit log. Continue?" confirmLabel="Terminate"
        onConfirm={persist} />
    </>
  );
}

function InternshipDetailModal({ internship, org, employees, onClose, onChanged }) {
  const p = usePerms();
  const { notify } = useToast();
  const evals = useHrQuery(() => listEvaluations(internship.id), [internship.id]);
  const [mode, setMode] = useState(null);   // edit | convert | eval
  const [evalRow, setEvalRow] = useState(null);
  const [finalizing, setFinalizing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const i = internship;
  const canEvaluate = i.status === "active" && p.me && p.me !== i.employee_id && (i.mentor_id === p.me || p.internsManage || p.internsTeam);
  const canConvert = (p.internsManage || p.convert) && ["active", "completed"].includes(i.status);
  const canEditEval = (e) => e.status === "draft" && (e.evaluator_id === p.me || p.internsManage);

  if (mode === "edit") return <InternshipFormModal internship={i} org={org} employees={employees} onClose={() => setMode(null)} onSaved={() => onChanged("Internship updated.", true)} />;
  if (mode === "convert") return <ConvertInternModal internship={i} org={org} employees={employees} onClose={() => setMode(null)} onDone={() => onChanged(null, false)} onFinish={() => onChanged(null, true)} />;
  if (mode === "eval") return <EvaluationModal internship={i} evaluation={evalRow} onClose={() => { setMode(null); setEvalRow(null); }}
    onSaved={() => { setMode(null); setEvalRow(null); evals.reload(); notify("Evaluation saved as draft."); }} />;

  return (
    <>
    <Modal open={!finalizing && !deleting} onClose={onClose} title={`Internship: ${fullName(i.employee)}`} size="lg"
      footer={<>
        {p.internsManage && i.status !== "converted" && <Button variant="secondary" onClick={() => setMode("edit")}>Edit</Button>}
        {canConvert && <Button variant="success" onClick={() => setMode("convert")}><UserCheck className="h-4 w-4" aria-hidden="true" />Convert to employee</Button>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </>}>
      <DescriptionList items={[
        { label: "Intern", value: `${fullName(i.employee)} (${i.employee?.employee_code ?? "—"})` },
        { label: "Status", value: <StatusBadge status={i.status} /> },
        { label: "Mentor", value: i.mentor ? fullName(i.mentor) : null },
        { label: "Department", value: i.department?.name },
        { label: "Period", value: `${formatDate(i.start_date)} – ${formatDate(i.end_date)}` },
        { label: "Completion date", value: formatDate(i.completion_date) },
        { label: "Certificate", value: i.certificate_issued_at ? `Issued ${formatDate(i.certificate_issued_at)}` : i.certificate_eligible ? "Eligible" : "Not eligible" },
        i.converted_at ? { label: "Converted", value: `${formatDate(i.converted_at)} → ${lbl(i.converted_employment_type)}` } : null,
        { label: "Project", value: i.project },
        { label: "Learning goals", value: i.learning_goals ? <span className="whitespace-pre-wrap">{i.learning_goals}</span> : null },
      ]} />
      {i.status === "converted" && <p className="mt-3 text-sm"><Link to={`/hr/employees/${i.employee_id}`} className="font-semibold text-[#1f4693] underline">Open employee record</Link></p>}

      <div className="mt-5 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-[#101a3a]">Evaluations</h3>
        {canEvaluate && <Button size="sm" onClick={() => { setEvalRow(null); setMode("eval"); }}><Plus className="h-4 w-4" aria-hidden="true" />New evaluation</Button>}
      </div>
      {evals.loading && !evals.data ? <Loading /> : evals.error ? <ErrorState message={evals.error} onRetry={evals.reload} /> : !evals.data?.length ? (
        <EmptyState title="No evaluations yet" />
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {evals.data.map((e) => (
            <li key={e.id} className="rounded-xl border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-[#101a3a]">{e.period}{e.period_start ? ` (${formatDate(e.period_start)} – ${formatDate(e.period_end)})` : ""}</span>
                <StatusBadge status={e.status} />
              </div>
              <p className="mt-1 text-xs text-slate-600">By {fullName(e.evaluator) || "—"} · overall {e.overall_rating ?? "—"}/5 · recommendation {lbl(e.recommendation)}</p>
              {Object.keys(e.ratings ?? {}).length > 0 && (
                <p className="mt-1 flex flex-wrap gap-1">{Object.entries(e.ratings).map(([k, val]) => <Badge key={k} tone="blue">{EVAL_CRITERIA.find((c) => c.key === k)?.label ?? lbl(k)}: {val}</Badge>)}</p>
              )}
              {e.comments && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">{e.comments}</p>}
              {canEditEval(e) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => { setEvalRow(e); setMode("eval"); }}>Edit</Button>
                  <Button size="sm" onClick={() => setFinalizing(e)} disabled={e.overall_rating == null || !e.recommendation}
                    title={e.overall_rating == null || !e.recommendation ? "Add an overall rating and recommendation first" : undefined}>Finalize</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(e)}>Delete draft</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
      <ConfirmDialog open={Boolean(finalizing)} onClose={() => setFinalizing(null)} title="Finalize evaluation"
        message="A finalized evaluation can no longer be changed and becomes visible to the intern, who is notified."
        confirmLabel="Finalize" onConfirm={async () => { const res = await updateEvaluation(finalizing.id, { status: "finalized" }); if (!res.error) { evals.reload(); notify("Evaluation finalized."); } return res; }} />
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} tone="danger" title="Delete draft evaluation"
        message="Delete this draft evaluation? This cannot be undone." confirmLabel="Delete"
        onConfirm={async () => { const res = await deleteEvaluation(deleting.id); if (!res.error) { evals.reload(); notify("Draft evaluation deleted."); } return res; }} />
    </>
  );
}

function EvaluationModal({ internship, evaluation, onClose, onSaved }) {
  const p = usePerms();
  const isNew = !evaluation;
  const [v, setV] = useState({
    period: evaluation?.period ?? "", period_start: evaluation?.period_start ?? "", period_end: evaluation?.period_end ?? "",
    ratings: Object.fromEntries(Object.entries(evaluation?.ratings ?? {}).map(([k, val]) => [k, String(val)])),
    overall_rating: evaluation?.overall_rating ?? "", recommendation: evaluation?.recommendation ?? "", comments: evaluation?.comments ?? "",
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function save() {
    const errs = {};
    if (!v.period.trim() || v.period.trim().length > 60) errs.period = "Enter a period label of up to 60 characters, e.g. Month 1.";
    if (v.period_start && v.period_end && v.period_end < v.period_start) errs.period_end = "End must be on or after the start.";
    if (!isBlank(v.overall_rating) && !numIn(v.overall_rating, 1, 5)) errs.overall_rating = "Between 1 and 5.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const ratings = Object.fromEntries(Object.entries(v.ratings).filter(([, val]) => val !== "").map(([k, val]) => [k, Number(val)]));
    const values = { period: v.period.trim(), period_start: v.period_start, period_end: v.period_end, ratings,
      overall_rating: isBlank(v.overall_rating) ? null : Math.round(Number(v.overall_rating) * 10) / 10, recommendation: v.recommendation, comments: v.comments.trim() };
    setBusy(true); setError(null);
    const res = isNew ? await createEvaluation(internship.id, p.me, values) : await updateEvaluation(evaluation.id, values);
    setBusy(false);
    if (res.error) setError(res.error); else onSaved();
  }
  return (
    <Modal open onClose={onClose} title={`${isNew ? "New" : "Edit"} evaluation: ${fullName(internship.employee)}`} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save draft</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Period" required error={errors.period}><Input value={v.period} onChange={set("period")} placeholder="e.g. Month 1" maxLength={60} /></Field>
        <Field label="From"><Input type="date" value={v.period_start ?? ""} onChange={set("period_start")} /></Field>
        <Field label="To" error={errors.period_end}><Input type="date" value={v.period_end ?? ""} onChange={set("period_end")} /></Field>
      </div>
      <fieldset className="mt-4">
        <legend className="text-sm font-semibold text-[#173a52]">Ratings (1–5)</legend>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {EVAL_CRITERIA.map((c) => (
            <Field key={c.key} label={c.label}>
              <Select placeholder="— Not rated —" value={v.ratings[c.key] ?? ""} onChange={(e) => setV((s) => ({ ...s, ratings: { ...s.ratings, [c.key]: e.target.value } }))}
                options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))} />
            </Field>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Overall rating" error={errors.overall_rating} hint="Required to finalize."><Input type="number" min={1} max={5} step="0.1" value={v.overall_rating} onChange={set("overall_rating")} /></Field>
        <Field label="Recommendation" hint="Required to finalize."><Select placeholder="— None —" value={v.recommendation} onChange={set("recommendation")} options={opts(EVAL_RECOMMENDATIONS)} /></Field>
        <Field label="Comments" className="sm:col-span-2"><Textarea rows={4} value={v.comments} onChange={set("comments")} /></Field>
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}

function ConvertInternModal({ internship, org, employees, onClose, onDone, onFinish }) {
  const { notify } = useToast();
  const types = (org?.employmentTypes ?? []).filter((t) => !t.is_intern && t.active !== false);
  const [v, setV] = useState({ employment_type: types.find((t) => t.code === "full_time")?.code ?? types[0]?.code ?? "", effective_date: todayStr(), designation_id: "", manager_id: "" });
  const [errors, setErrors] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  function review() {
    const errs = {};
    if (!v.employment_type) errs.employment_type = "Choose the new employment type.";
    if (!v.effective_date) errs.effective_date = "Enter the effective date.";
    setErrors(errs);
    if (!Object.keys(errs).length) setConfirming(true);
  }
  if (done) {
    return (
      <Modal open onClose={onFinish} title="Intern converted" size="sm" footer={<Button onClick={onFinish}>Done</Button>}>
        <p className="text-sm text-slate-700">{fullName(internship.employee)} is now on the {types.find((t) => t.code === v.employment_type)?.name ?? v.employment_type} employment type. The employee keeps the same record and ID.</p>
        <p className="mt-3"><Link to={`/hr/employees/${done}`} className="font-semibold text-[#1f4693] underline">Open employee record</Link></p>
      </Modal>
    );
  }
  return (
    <>
      <Modal open={!confirming} onClose={onClose} title={`Convert ${fullName(internship.employee)} to employee`} size="md"
        footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={review}>Review conversion</Button></>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="New employment type" required error={errors.employment_type}><Select placeholder="Choose" value={v.employment_type} onChange={set("employment_type")} options={toOptions(types, "name", "code")} /></Field>
          <Field label="Effective date" required error={errors.effective_date}><Input type="date" value={v.effective_date} onChange={set("effective_date")} /></Field>
          <Field label="Designation" hint="Blank = keep current."><Select placeholder="— Keep current —" value={v.designation_id} onChange={set("designation_id")} options={toOptions(org?.designations)} /></Field>
          <Field label="Reporting manager" hint="Blank = keep current."><Select placeholder="— Keep current —" value={v.manager_id} onChange={set("manager_id")} options={(employees ?? []).filter((e) => e.value !== internship.employee_id)} /></Field>
        </div>
        <p className="mt-3 text-xs text-slate-500">The internship is marked Converted, probation is set from the employment type, and the portal role changes from intern to employee.</p>
      </Modal>
      <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} tone="success" title="Confirm conversion"
        message={`Convert ${fullName(internship.employee)} effective ${formatDate(v.effective_date)}? This cannot be undone.`} confirmLabel="Convert"
        onConfirm={async () => {
          const res = await convertIntern({ ...v, internship_id: internship.id });
          if (!res.error) { setDone(res.data); notify("Intern converted to employee."); onDone(); }
          return res;
        }} />
    </>
  );
}
