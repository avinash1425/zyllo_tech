// Training assignments (enrollment / completion tracking) and the
// verification queue. Rows are RLS-scoped: HR (training.view) sees every
// assignment, managers (training.view_team) their reporting line.
import { useMemo, useState } from "react";
import { Award, CheckCircle2, Plus, RefreshCcw, ShieldCheck, XCircle } from "lucide-react";
import { formatDate, useHrQuery } from "@/lib/hr/client";
import { SOURCES, listAssignments } from "@/lib/hr/training";
import { allowedActions, displayStatus } from "@/lib/hr/trainingRules";
import { Button, DataTable, SearchInput, Select, Toolbar } from "@/hr/ui";
import { AssignmentStatus, CertificateBadge, DocButton, TBadge, courseText, dueText, empText, opts, today } from "./shared";
import { AssignModal, CancelDialog, CertificateModal, CompleteModal, RenewModal, ReviewModal } from "./AssignmentModals";

const STATUS_FILTERS = [
  { value: "open", label: "Open (assigned / in progress)" }, { value: "overdue", label: "Overdue" }, { value: "unverified", label: "Pending verification" },
  { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" }, { value: "", label: "All" },
];

export function AssignmentActions({ row, myEmployeeId, canAssign, setModal }) {
  const acts = allowedActions(row, { isSelf: row.employee_id === myEmployeeId, canManage: canAssign && row.employee_id !== myEmployeeId });
  if (!acts.length || row.employee_id === myEmployeeId) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {acts.includes("verify") && <Button size="sm" variant="success" onClick={() => setModal({ type: "review", row })}><ShieldCheck className="h-4 w-4" aria-hidden="true" />Review</Button>}
      {acts.includes("complete") && <Button size="sm" variant="secondary" onClick={() => setModal({ type: "complete", row })}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Complete</Button>}
      {acts.includes("certificate") && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "certificate", row })}><Award className="h-4 w-4" aria-hidden="true" />Certificate</Button>}
      {acts.includes("renew") && row.certificate_expiry && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "renew", row })}><RefreshCcw className="h-4 w-4" aria-hidden="true" />Renew</Button>}
      {acts.includes("cancel") && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "cancel", row })}><XCircle className="h-4 w-4" aria-hidden="true" />Cancel</Button>}
    </span>
  );
}

export function AssignmentModalsHost({ modal, setModal, done, canUpload, courses, programs, employees, myEmployeeId }) {
  if (!modal) return null;
  const close = () => setModal(null);
  const p = { row: modal.row, onClose: close, onDone: done };
  if (modal.type === "assign") return <AssignModal courses={courses} programs={programs} employees={employees} myEmployeeId={myEmployeeId} initial={modal.initial} onClose={close} onDone={done} />;
  if (modal.type === "complete") return <CompleteModal {...p} canUpload={canUpload} />;
  if (modal.type === "review") return <ReviewModal {...p} />;
  if (modal.type === "certificate") return <CertificateModal {...p} canUpload={canUpload} />;
  if (modal.type === "renew") return <RenewModal {...p} />;
  if (modal.type === "cancel") return <CancelDialog {...p} />;
  return null;
}

export default function AssignmentsTab({ mode = "all", initialStatus, canAssign, canUpload, courses, programs, employees, myEmployeeId, onChanged }) {
  const verification = mode === "verification";
  const [f, setF] = useState({ status: verification ? "unverified" : initialStatus ?? "open", course: "", employee: "", source: "", q: "" });
  const [modal, setModal] = useState(null);
  const list = useHrQuery(() => listAssignments({ status: verification ? "unverified" : f.status, course: f.course, employee: f.employee }), [verification, f.status, f.course, f.employee]);
  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return (list.data ?? []).filter((r) => (!f.source || r.source === f.source)
      && (!q || `${empText(r.employee)} ${courseText(r.course)}`.toLowerCase().includes(q)));
  }, [list.data, f.source, f.q]);
  const done = () => { setModal(null); list.reload(); onChanged?.(); };
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <>
      <Toolbar>
        <SearchInput value={f.q} onChange={(q) => setF((s) => ({ ...s, q }))} placeholder="Search employee or course…" />
        {!verification && <Select aria-label="Status" className="sm:w-56" value={f.status} onChange={set("status")} options={STATUS_FILTERS} />}
        <Select aria-label="Course" className="sm:w-56" placeholder="All courses" value={f.course} onChange={set("course")} options={(courses ?? []).map((c) => ({ value: c.id, label: courseText(c) }))} />
        <Select aria-label="Employee" className="sm:w-56" placeholder="All employees" value={f.employee} onChange={set("employee")} options={employees ?? []} />
        {!verification && <Select aria-label="Source" className="sm:w-40" placeholder="Any source" value={f.source} onChange={set("source")} options={opts(SOURCES)} />}
        {canAssign && !verification && <Button onClick={() => setModal({ type: "assign" })}><Plus className="h-4 w-4" aria-hidden="true" />Assign training</Button>}
      </Toolbar>
      {verification && <p className="mb-3 text-sm text-slate-600">Completions submitted by employees with evidence. Verify them, or return them with a reason. You cannot verify your own training.</p>}
      <DataTable caption={verification ? "Completions waiting for verification" : "Training assignments"} rows={rows} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle={verification ? "Nothing to verify" : "No assignments"} emptyDescription={verification ? "Self-reported completions of your team appear here." : "Assign a course or a program to employees."}
        columns={[
          { key: "employee", header: "Employee", sortable: true, sortValue: (r) => empText(r.employee), render: (r) => empText(r.employee) },
          { key: "course", header: "Course", sortable: true, sortValue: (r) => r.course?.title ?? "", render: (r) => (
            <div className="min-w-[10rem]"><p className="font-medium text-[#101a3a]">{r.course?.title}</p>
              <p className="text-xs text-slate-500">{r.course?.code}{r.course?.is_mandatory ? " · mandatory" : ""}{r.program ? ` · ${r.program.title}` : ""}</p></div>) },
          { key: "source", header: "Source", render: (r) => <TBadge value={r.source} /> },
          ...(verification ? [
            { key: "submitted_at", header: "Submitted", sortable: true, render: (r) => formatDate(r.submitted_at ?? r.updated_at) },
            { key: "evidence", header: "Evidence", render: (r) => (
              <div className="max-w-xs text-sm"><p className="whitespace-pre-line">{r.evidence_note ?? "—"}</p>
                {r.evidence && <DocButton doc={r.evidence}>Evidence file</DocButton>} {r.certificate && <DocButton doc={r.certificate}>Certificate</DocButton>}</div>) },
          ] : [
            { key: "assigned_at", header: "Assigned", sortable: true, render: (r) => formatDate(r.assigned_at) },
            { key: "due_date", header: "Due", sortable: true, render: (r) => dueText(r.due_date, ["assigned", "in_progress"].includes(r.status)) },
          ]),
          { key: "status", header: "Status", sortable: true, sortValue: (r) => displayStatus(r, today()), render: (r) => <AssignmentStatus row={r} /> },
          { key: "result", header: "Result", render: (r) => (r.result ? <span className="flex flex-col gap-0.5"><TBadge value={r.result} />{r.score != null && <span className="text-xs text-slate-500">{r.score}%</span>}</span> : "—") },
          ...(!verification ? [{ key: "certificate_expiry", header: "Certificate", render: (r) => (r.status === "completed" ? <span className="flex flex-col">{r.certificate && <DocButton doc={r.certificate}>File</DocButton>}<CertificateBadge row={r} /></span> : "—") }] : []),
          ...(canAssign ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => <AssignmentActions row={r} myEmployeeId={myEmployeeId} canAssign={canAssign} setModal={setModal} /> }] : []),
        ]} />
      <AssignmentModalsHost modal={modal} setModal={setModal} done={done} canUpload={canUpload} courses={courses} programs={programs} employees={employees} myEmployeeId={myEmployeeId} />
    </>
  );
}
