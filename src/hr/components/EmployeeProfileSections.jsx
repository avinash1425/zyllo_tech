// Employee Management — profile sections used by the HR employee profile
// (EmployeeDetail) and, for the timeline, the Employee Portal:
//   LifecycleCard          onboarding → probation → confirmed → notice → exit
//   ChangeAssignmentModal  promotion / transfer / manager / lifecycle change
//                          with effective date + reason (hr_change_employee_assignment)
//   EmploymentTimeline     events + field-level history with actor (hr_employee_timeline)
//   ReportingSection       manager details + direct reports
//   EmployeeDocumentsSection  documents, checklist, upload/verify, access history
// Every action is re-checked on the server (RLS, SECURITY DEFINER checks).
import { useMemo, useState } from "react";
import {
  ArrowRight, BadgeCheck, CheckCircle2, Circle, Download, Eye, FileClock, History, LogOut, RotateCcw, Upload, UserCheck, Users,
} from "lucide-react";
import Link from "@/hr/platform/link";
import { formatDate, formatDateTime, fullName, useHrQuery } from "@/lib/hr/client";
import {
  CHANGE_CATEGORIES, changeAssignment, changeCategoryLabel, getEmployeeTimeline, getManagerCard, listDirectReports, listDocumentAccess,
} from "@/lib/hr/employees";
import { documentChecklist, latestVersion, listDocumentCategories, listEmployeeDocuments } from "@/lib/hr/documents";
import { toOptions } from "@/lib/hr/org";
import { Badge, Button, Card, DataTable, DescriptionList, EmptyState, ErrorState, Field, InlineError, Loading, Modal, Select, StatusBadge, Textarea, Input, useToast } from "@/hr/ui";
import { DocumentDetailModal, ExpiryText, UploadDocumentModal, openLatestOf, openVersion } from "@/hr/pages/DocumentsPage";

const businessToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const human = (v) => String(v ?? "").replace(/_/g, " ");

// ---------------------------------------------------------------- lifecycle
const STAGES = [
  { key: "onboarding", label: "Onboarding" },
  { key: "probation", label: "Probation" },
  { key: "active", label: "Confirmed / active" },
  { key: "notice_period", label: "Resignation / notice" },
  { key: "exited", label: "Exit" },
];
const stageIndex = (status) => ({ onboarding: 0, probation: 1, active: 2, suspended: 2, notice_period: 3, exited: 4, archived: 4 }[status] ?? 0);

/**
 * Lifecycle stepper + the next permitted step. Status changes reuse the
 * reasoned change RPC; resignation and exit open the existing Exit Management
 * workflow; onboarding reuses the invitation and document checklist.
 */
export function LifecycleCard({ employee: e, canEdit, isSelf, canExit, onAction, onOpenTab }) {
  const idx = stageIndex(e.status);
  const actions = [];
  if (canEdit && !isSelf) {
    if (e.status === "onboarding") {
      actions.push({ key: "probation_start", label: "Start probation", icon: ArrowRight, preset: { category: "probation_start", status: "probation" } });
      actions.push({ key: "confirm_direct", label: "Confirm (no probation)", icon: BadgeCheck, variant: "secondary", preset: { category: "confirmation", status: "active" } });
    }
    if (e.status === "probation") actions.push({ key: "confirmation", label: "Confirm employment", icon: BadgeCheck, preset: { category: "confirmation", status: "active" } });
    if (["onboarding", "probation", "active"].includes(e.status)) actions.push({ key: "suspend", label: "Suspend / archive", icon: Circle, variant: "secondary", preset: { category: "status_change", status: "suspended" } });
    if (["suspended", "archived"].includes(e.status)) actions.push({ key: "reactivation", label: "Reactivate", icon: RotateCcw, preset: { category: "reactivation", status: "active" } });
  }
  return (
    <Card title="Employee lifecycle">
      <ol className="flex flex-col gap-2" aria-label="Lifecycle stages">
        {STAGES.map((s, i) => {
          const done = i < idx || (i === idx && ["exited", "archived"].includes(e.status));
          const current = i === idx && !done;
          return (
            <li key={s.key} className="flex items-center gap-2.5 text-sm" aria-current={current ? "step" : undefined}>
              {done ? <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-emerald-600" aria-hidden="true" />
                : current ? <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[#f96706] ring-4 ring-[#f96706]/20" aria-hidden="true" />
                  : <Circle className="h-4.5 w-4.5 shrink-0 text-slate-300" aria-hidden="true" />}
              <span className={current ? "font-bold text-[#101a3a]" : done ? "text-slate-700" : "text-slate-400"}>{s.label}</span>
              {current && e.status === "suspended" && <Badge tone="red">suspended</Badge>}
              {s.key === "probation" && e.probation_end_date && <span className="ml-auto text-xs text-slate-500">ends {formatDate(e.probation_end_date)}</span>}
              {s.key === "active" && e.confirmation_date && <span className="ml-auto text-xs text-slate-500">confirmed {formatDate(e.confirmation_date)}</span>}
              {s.key === "notice_period" && e.resignation_date && <span className="ml-auto text-xs text-slate-500">resigned {formatDate(e.resignation_date)}</span>}
              {s.key === "exited" && e.last_working_date && <span className="ml-auto text-xs text-slate-500">LWD {formatDate(e.last_working_date)}</span>}
            </li>
          );
        })}
      </ol>
      {e.status === "onboarding" && (
        <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Onboarding checklist: {e.user_id ? (e.activated_at ? "portal account active" : "invitation sent, awaiting activation") : "portal invitation not sent"} ·{" "}
          <button type="button" className="font-semibold text-[#1f4693] hover:underline" onClick={() => onOpenTab("documents")}>required documents</button>
          {" · "}<button type="button" className="font-semibold text-[#1f4693] hover:underline" onClick={() => onOpenTab("access")}>portal access</button>
        </div>
      )}
      {(actions.length > 0 || canExit) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {actions.map((a) => { const Icon = a.icon; return <Button key={a.key} size="sm" variant={a.variant ?? "primary"} onClick={() => onAction(a.preset)}><Icon className="h-4 w-4" aria-hidden="true" />{a.label}</Button>; })}
          {canExit && ["probation", "active", "notice_period"].includes(e.status) && (
            <Link href="/hr/exits" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-semibold text-[#173a52] hover:bg-slate-50">
              <LogOut className="h-4 w-4" aria-hidden="true" />{e.status === "notice_period" ? "Open exit case" : "Resignation / exit"}
            </Link>
          )}
        </div>
      )}
      {isSelf && canEdit && <p className="mt-3 text-xs text-slate-500">This is your own record; another HR administrator must record changes to it.</p>}
    </Card>
  );
}

// ---------------------------------------------------------------- change assignment
const FIELD_LABELS = { legal_entity_id: "Company / legal entity", department_id: "Department", designation_id: "Designation", grade_id: "Grade / band", manager_id: "Reporting manager", status: "Employment status" };

export function ChangeAssignmentModal({ employee: e, org, managers, preset, canArchive, onClose, onDone }) {
  const [category, setCategory] = useState(preset?.category ?? "promotion");
  const [v, setV] = useState(() => ({
    legal_entity_id: e.legal_entity_id ?? "", department_id: e.department_id ?? "", designation_id: e.designation_id ?? "",
    grade_id: e.grade_id ?? "", manager_id: e.manager_id ?? "", status: preset?.status ?? e.status,
  }));
  const [effective, setEffective] = useState(businessToday());
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const cat = CHANGE_CATEGORIES.find((c) => c.value === category);
  const fields = cat?.fields ?? [];
  const set = (k) => (ev) => {
    const val = ev.target.value;
    setV((s) => {
      const next = { ...s, [k]: val };
      // Keep the designation consistent with the department (validated on the server too).
      if (k === "department_id") {
        const des = (org?.designations ?? []).find((d) => d.id === s.designation_id);
        if (des?.department_id && des.department_id !== val) next.designation_id = "";
      }
      return next;
    });
  };
  const designations = useMemo(() => (org?.designations ?? []).filter((d) => d.active && (!v.department_id || !d.department_id || d.department_id === v.department_id)), [org, v.department_id]);
  const statusOptions = useMemo(() => {
    if (category === "probation_start") return [{ value: "probation", label: "Probation" }];
    if (category === "confirmation") return [{ value: "active", label: "Active (confirmed)" }];
    if (category === "reactivation") return ["onboarding", "probation", "active"].map((s) => ({ value: s, label: human(s) }));
    return ["onboarding", "probation", "active", "suspended", ...(canArchive ? ["archived"] : [])].filter((s) => s !== e.status).map((s) => ({ value: s, label: human(s) }));
  }, [category, canArchive, e.status]);
  const allowedCategories = CHANGE_CATEGORIES.filter((c) => {
    if (["suspended", "archived"].includes(e.status)) return c.value === "reactivation";
    if (c.value === "reactivation") return false;
    if (c.value === "probation_start") return e.status === "onboarding";
    if (c.value === "confirmation") return ["onboarding", "probation"].includes(e.status);
    return true;
  });

  function changedValues() {
    const out = {};
    for (const k of fields) if ((v[k] ?? "") !== ((k === "status" ? e.status : e[k]) ?? "")) out[k] = v[k];
    return out;
  }

  async function submit() {
    const errs = {};
    const diff = changedValues();
    if (!Object.keys(diff).length) errs.form = "Change at least one value — the new values match the current record.";
    if (!effective) errs.effective = "Choose the effective date.";
    else if (effective > businessToday()) errs.effective = "Future-dated changes are not supported; record the change on or after its effective date.";
    else if (e.joining_date && effective < e.joining_date) errs.effective = "The effective date cannot be before the joining date.";
    if (reason.trim().length < 3) errs.reason = "Give a reason (at least 3 characters). It is kept in the employment history.";
    if (fields.includes("manager_id") && v.manager_id && v.manager_id === e.id) errs.manager_id = "An employee cannot report to themselves.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await changeAssignment(e.id, {
      category, effectiveDate: effective, reason, ...diff,
      clearManager: "manager_id" in diff && !diff.manager_id,
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onDone(changeCategoryLabel(category));
  }

  return (
    <Modal open onClose={onClose} title={`Change assignment · ${fullName(e)}`} size="lg"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={submit}>Record change</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Type of change" required>
          <Select value={category} onChange={(ev) => { setCategory(ev.target.value); setErrors({}); setError(null);
            const c = ev.target.value; setV((s) => ({ ...s, status: c === "probation_start" ? "probation" : c === "confirmation" || c === "reactivation" ? "active" : c === "status_change" ? (e.status === "suspended" ? "active" : "suspended") : e.status })); }}
            options={allowedCategories.map((c) => ({ value: c.value, label: c.label }))} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.includes("legal_entity_id") && <Field label={FIELD_LABELS.legal_entity_id}><Select placeholder="— None —" value={v.legal_entity_id} onChange={set("legal_entity_id")} options={toOptions(org?.legalEntities)} /></Field>}
          {fields.includes("department_id") && <Field label={FIELD_LABELS.department_id}><Select placeholder="— None —" value={v.department_id} onChange={set("department_id")} options={toOptions(org?.departments)} /></Field>}
          {fields.includes("designation_id") && <Field label={FIELD_LABELS.designation_id} hint="Designations of the selected department, or company-wide."><Select placeholder="— None —" value={v.designation_id} onChange={set("designation_id")} options={toOptions(designations)} /></Field>}
          {fields.includes("grade_id") && <Field label={FIELD_LABELS.grade_id}><Select placeholder="— None —" value={v.grade_id} onChange={set("grade_id")} options={toOptions(org?.grades)} /></Field>}
          {fields.includes("manager_id") && <Field label={FIELD_LABELS.manager_id} error={errors.manager_id} hint="Self-reporting and circular lines are rejected."><Select placeholder="— No manager —" value={v.manager_id} onChange={set("manager_id")} options={(managers ?? []).filter((m) => m.value !== e.id)} /></Field>}
          {fields.includes("status") && <Field label={FIELD_LABELS.status} hint="Notice period and exit are recorded in Exit Management."><Select value={v.status} onChange={set("status")} options={statusOptions} /></Field>}
          <Field label="Effective date" required error={errors.effective}><Input type="date" max={businessToday()} min={e.joining_date ?? undefined} value={effective} onChange={(ev) => setEffective(ev.target.value)} /></Field>
        </div>
        <Field label="Reason" required error={errors.reason} hint="Kept permanently in the employment history; visible to the employee.">
          <Textarea rows={3} maxLength={1000} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Promoted after the annual performance review" />
        </Field>
        {errors.form && <InlineError message={errors.form} />}
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- timeline
const HISTORY_LABELS = {
  created: "Record created", status: "Status", department: "Department", designation: "Designation", manager: "Reporting manager", employment_type: "Employment type",
  location: "Work location", shift: "Shift", portal_access: "Portal access", role: "Role", conversion: "Conversion", note: "Note", legal_entity: "Company",
  grade: "Grade", work_arrangement: "Work arrangement", deployment: "Deployment", contract: "Contract",
};
const EVENT_TONES = { promotion: "green", demotion: "amber", transfer: "blue", designation_change: "blue", manager_change: "violet", probation_start: "teal", confirmation: "green", status_change: "amber", reactivation: "green", correction: "slate" };

export function EmploymentTimeline({ employeeId, refreshKey }) {
  const q = useHrQuery(() => getEmployeeTimeline(employeeId), [employeeId, refreshKey]);
  const [filter, setFilter] = useState("all");
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  const items = (q.data ?? []).filter((i) => filter === "all" || (filter === "events" ? i.kind === "event" : i.kind === "history"));
  return (
    <Card title="Employment timeline" actions={
      <Select aria-label="Show" className="w-44" value={filter} onChange={(ev) => setFilter(ev.target.value)}
        options={[{ value: "all", label: "All changes" }, { value: "events", label: "Recorded changes only" }, { value: "history", label: "Field changes only" }]} />}>
      {!items.length ? <EmptyState title="No history yet" icon={History} /> : (
        <ol className="relative flex flex-col gap-4 border-l-2 border-slate-100 pl-5">
          {items.map((i) => (
            <li key={`${i.kind}-${i.id}`} className="relative">
              <span className={`absolute -left-[1.72rem] top-1 h-3 w-3 rounded-full ring-4 ring-white ${i.kind === "event" ? "bg-[#f96706]" : "bg-slate-300"}`} aria-hidden="true" />
              <div className="flex flex-wrap items-center gap-2">
                {i.kind === "event"
                  ? <Badge tone={EVENT_TONES[i.type] ?? "slate"}>{changeCategoryLabel(i.type)}</Badge>
                  : <span className="text-sm font-semibold text-[#101a3a]">{HISTORY_LABELS[i.type] ?? human(i.type)}</span>}
                <span className="text-xs text-slate-500">effective {formatDate(i.effective_date)}</span>
              </div>
              {i.kind === "event" ? (
                <ul className="mt-1 text-sm text-slate-700">
                  {Object.entries(i.changes ?? {}).map(([k, c]) => (
                    <li key={k}><span className="text-slate-500">{HISTORY_LABELS[k] ?? human(k)}:</span> {human(c?.from) || "—"} <ArrowRight className="inline h-3.5 w-3.5 text-slate-400" aria-label="to" /> <strong>{human(c?.to) || "—"}</strong></li>
                  ))}
                </ul>
              ) : (i.type !== "created" && (i.old_value || i.new_value)) ? (
                <p className="mt-1 text-sm text-slate-700">{human(i.old_value) || "—"} <ArrowRight className="inline h-3.5 w-3.5 text-slate-400" aria-label="to" /> <strong>{human(i.new_value) || "—"}</strong></p>
              ) : i.type === "created" ? <p className="mt-1 text-sm text-slate-700">Initial status: {human(i.new_value)}</p> : null}
              {i.reason && <p className="mt-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700"><span className="font-semibold">Reason:</span> {i.reason}</p>}
              <p className="mt-1 text-xs text-slate-500">Recorded {formatDateTime(i.recorded_at)} by {i.actor}</p>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-xs text-slate-500">History is append-only: changes are added, never overwritten.</p>
    </Card>
  );
}

// ---------------------------------------------------------------- reporting
export function ReportingSection({ employee: e, canEdit, isSelf, onChangeManager }) {
  const mgr = useHrQuery(() => getManagerCard(e.manager_id), [e.manager_id]);
  const reports = useHrQuery(() => listDirectReports(e.id), [e.id]);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Reporting manager" actions={canEdit && !isSelf && !["exited", "archived"].includes(e.status) && <Button size="sm" variant="secondary" onClick={onChangeManager}>Change manager</Button>}>
        {!e.manager_id ? <EmptyState title="No reporting manager" description="Assign one with Change manager." icon={UserCheck} />
          : mgr.loading && !mgr.data ? <Loading /> : mgr.error ? <ErrorState message={mgr.error} onRetry={mgr.reload} /> : !mgr.data ? <p className="text-sm text-slate-600">The manager's record is not visible to you.</p> : (
            <DescriptionList items={[
              { label: "Name", value: <Link href={`/hr/employees/${mgr.data.id}`} className="font-semibold text-[#1f4693] hover:underline">{fullName(mgr.data)}</Link> },
              { label: "Employee ID", value: <span className="font-mono">{mgr.data.employee_code}</span> },
              { label: "Designation", value: mgr.data.designation?.name },
              { label: "Department", value: mgr.data.department?.name },
              { label: "Work email", value: mgr.data.company_email },
              { label: "Status", value: <StatusBadge status={mgr.data.status} /> },
            ]} />
          )}
      </Card>
      <Card title={`Direct reports${reports.data ? ` (${reports.data.length})` : ""}`} actions={<Link href="/hr/org-structure" className="text-sm font-semibold text-[#1f4693] hover:underline">Org Structure</Link>}>
        {reports.loading && !reports.data ? <Loading /> : reports.error ? <ErrorState message={reports.error} onRetry={reports.reload} /> : !reports.data?.length ? (
          <EmptyState title="No direct reports" icon={Users} />
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {reports.data.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <Link href={`/hr/employees/${r.id}`} className="font-semibold text-[#101a3a] hover:underline">{fullName(r)}</Link>
                  <span className="block truncate text-xs text-slate-500">{r.employee_code} · {r.designation?.name ?? "No designation"}{r.department?.name ? ` · ${r.department.name}` : ""}</span>
                </span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- documents
export function EmployeeDocumentsSection({ employee: e, canManage, canAudit, myEmployeeId }) {
  const { notify } = useToast();
  const docs = useHrQuery(() => listEmployeeDocuments(e.id), [e.id]);
  const categories = useHrQuery(() => listDocumentCategories({ activeOnly: false }), []);
  const checklist = useHrQuery(() => documentChecklist(e.id), [e.id, docs.data?.length]);
  const access = useHrQuery(() => (canAudit ? listDocumentAccess((docs.data ?? []).map((d) => d.id)) : Promise.resolve({ data: [], error: null })), [canAudit, docs.data]);
  const [selected, setSelected] = useState(null);
  const [uploading, setUploading] = useState(null);
  const reloadAll = () => { docs.reload(); checklist.reload(); access.reload(); };
  const titleOf = (id) => (docs.data ?? []).find((d) => d.id === id)?.title ?? "Document";
  const missing = (checklist.data ?? []).filter((c) => !c.is_complete);

  return (
    <div className="flex flex-col gap-4">
      <Card title="Documents" actions={canManage && !["exited", "archived"].includes(e.status) && <Button size="sm" onClick={() => setUploading({})}><Upload className="h-4 w-4" aria-hidden="true" />Upload document</Button>}>
        <p className="mb-3 text-xs text-slate-500">Files are kept in private storage and opened through 60-second signed links; every view and download is logged.</p>
        <DataTable caption="Employee documents" rows={docs.data} loading={docs.loading} error={docs.error} onRetry={docs.reload} emptyTitle="No documents" onRowClick={setSelected}
          columns={[
            { key: "title", header: "Document", render: (r) => <span><span className="font-semibold text-[#101a3a]">{r.title}</span><span className="block text-xs text-slate-500">{r.category?.name}{r.category?.is_confidential ? " · confidential" : ""}</span></span> },
            { key: "current_version", header: "Version", render: (r) => `v${r.current_version}` },
            { key: "expiry_date", header: "Expiry", render: (r) => <ExpiryText date={r.expiry_date} /> },
            { key: "verification_status", header: "Verification", render: (r) => <StatusBadge status={r.verification_status} /> },
            { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => {
              const latest = latestVersion(r);
              return (
                <span className="flex gap-1" onClick={(ev) => ev.stopPropagation()} onKeyDown={(ev) => ev.stopPropagation()} role="presentation">
                  <Button size="sm" variant="ghost" disabled={!latest} onClick={() => openVersion(latest, "view", notify)} aria-label={`View ${r.title}`}><Eye className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button size="sm" variant="ghost" disabled={!latest} onClick={() => openVersion(latest, "download", notify)} aria-label={`Download ${r.title}`}><Download className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button size="sm" variant="secondary" onClick={() => setSelected(r)}>{canManage ? "Verify / manage" : "Details"}</Button>
                </span>
              );
            } },
          ]} />
      </Card>
      <Card title="Required documents checklist">
        {checklist.loading && !checklist.data ? <Loading /> : checklist.error ? <InlineError message={checklist.error} /> : !checklist.data?.length ? (
          <p className="text-sm text-slate-600">No required document categories apply to this employee.</p>
        ) : (
          <>
            <p className="mb-2 text-sm text-slate-600">{missing.length ? `${missing.length} of ${checklist.data.length} required documents need attention.` : "All required documents are on file."}</p>
            <ul className="flex flex-col gap-1.5">
              {checklist.data.map((c) => (
                <li key={c.category_code} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm">
                  <span className="font-medium text-[#101a3a]">{c.category_name}{c.expiry_date && <span className="ml-2 text-xs font-normal text-slate-500">expires <ExpiryText date={c.expiry_date} /></span>}</span>
                  <span className="flex items-center gap-2">
                    {c.is_complete ? <Badge tone="green">complete</Badge> : <StatusBadge status={c.document_id ? (c.verification_status === "verified" ? "expired" : c.verification_status) : "missing"} />}
                    {c.document_id && <Button size="sm" variant="ghost" onClick={() => openLatestOf(c.document_id, "view", notify)}>View</Button>}
                    {!c.document_id && canManage && <Button size="sm" variant="secondary" onClick={() => setUploading({ category: c.category_code })}>Upload</Button>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {canAudit && (
        <Card title="Document access history" actions={<FileClock className="h-4 w-4 text-slate-400" aria-hidden="true" />}>
          <DataTable caption="Document access history" rows={access.data} loading={access.loading} error={access.error} onRetry={access.reload} emptyTitle="No views or downloads recorded"
            columns={[
              { key: "accessed_at", header: "When", render: (r) => formatDateTime(r.accessed_at) },
              { key: "document_id", header: "Document", render: (r) => titleOf(r.document_id) },
              { key: "action", header: "Action", render: (r) => <Badge tone={r.action === "download" ? "blue" : "slate"}>{r.action}</Badge> },
              { key: "accessed_by", header: "By", render: (r) => (r.accessor ? `${fullName(r.accessor)} (${r.accessor.employee_code})` : "HR administrator") },
            ]} />
          <p className="mt-2 text-xs text-slate-500">Uploads, verification and archiving are recorded in the HR audit log.</p>
        </Card>
      )}
      {selected && <DocumentDetailModal doc={selected} canManage={canManage} myEmployeeId={myEmployeeId} onClose={() => setSelected(null)} onChanged={reloadAll} />}
      {uploading && <UploadDocumentModal open mode="hr" employeeOptions={[{ value: e.id, label: `${fullName(e)} (${e.employee_code})` }]} preset={{ employee: e.id, category: uploading.category }}
        categories={categories.data} onClose={() => setUploading(null)} onDone={reloadAll} />}
    </div>
  );
}
