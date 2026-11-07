// Employee enrollments (114 RPCs + 208 changes / dependants) and
// self-enrollment requests. Nobody acts on their own enrollment or request.
import { useMemo, useState } from "react";
import { Download, Plus, UserPlus } from "lucide-react";
import { exportCsv, formatDate, useHrQuery } from "@/lib/hr/client";
import {
  COVERAGE_LEVELS, RELATIONSHIPS, addDependant, benefitBalances, benefitEligibility, decideEnrollmentRequest, enrollBenefit, label, listBenefitHistory,
  listBenefitPlans, listDependants, listEnrollmentRequests, listEnrollments, removeDependant, setEnrollmentStatus, updateEnrollment,
} from "@/lib/hr/benefits";
import {
  Button, Card, ConfirmDialog, DataTable, DescriptionList, ErrorState, Field, Input, Loading, Modal, Select, Textarea, Toolbar, useToast,
} from "@/hr/ui";
import { ActionModal, BenefitTimeline, EnrollmentStatus, LimitBar, RequestStatus, empText, money, today } from "./shared";

const coverageLabel = (v) => COVERAGE_LEVELS.find((c) => c.value === v)?.label ?? label(v);

function EnrollModal({ employees, plans, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ employee: "", plan: "", startDate: today(), coverageLevel: "employee", dependants: 0, policyNumber: "", notes: "", overrideReason: "", employerContribution: "", employeeContribution: "" });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const plan = (plans ?? []).find((p) => p.id === v.plan);
  const el = useHrQuery(() => (v.employee ? benefitEligibility(v.employee, v.startDate || today()) : Promise.resolve({ data: null })), [v.employee, v.startDate]);
  const row = (el.data ?? []).find((r) => r.benefit_type_id === v.plan);
  const ineligible = row && !row.eligible;
  return (
    <ActionModal title="Enroll employee" submitLabel="Enroll" size="md" onClose={onClose}
      onSubmit={async () => {
        if (!v.employee || !v.plan) return { error: "Choose the employee and the plan." };
        if (!v.startDate) return { error: "Choose the start date." };
        if (row?.enrolled) return { error: "The employee is already enrolled in this plan." };
        if (ineligible && v.overrideReason.trim().length < 5) return { error: `${row.reason} Record an override reason (at least 5 characters) to enroll anyway.` };
        const res = await enrollBenefit({ employee: v.employee, plan: v.plan, startDate: v.startDate, coverageLevel: v.coverageLevel, dependants: v.dependants,
          policyNumber: v.policyNumber, notes: v.notes, overrideReason: ineligible ? v.overrideReason : null,
          employerContribution: v.employerContribution, employeeContribution: v.employeeContribution });
        if (res.error) return res;
        notify("Employee enrolled. They were notified."); onDone(); return {};
      }}>
      <Field label="Employee" required><Select placeholder="Choose an employee" value={v.employee} onChange={set("employee")} options={employees ?? []} /></Field>
      <Field label="Plan" required><Select placeholder="Choose a plan" value={v.plan} onChange={set("plan")} options={(plans ?? []).filter((p) => p.active).map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))} /></Field>
      {row && <p className={`rounded-lg px-3 py-2 text-sm ${row.enrolled ? "bg-sky-50 text-sky-800" : row.eligible ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
        {row.enrolled ? "Already enrolled in this plan." : row.eligible ? "Eligible on the start date." : `Not eligible: ${row.reason}`}</p>}
      {ineligible && <Field label="Override reason" required hint="Recorded on the enrollment and in its history"><Textarea value={v.overrideReason} maxLength={1000} onChange={set("overrideReason")} /></Field>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Start date" required><Input type="date" value={v.startDate} onChange={set("startDate")} /></Field>
        <Field label="Coverage"><Select value={v.coverageLevel} onChange={set("coverageLevel")} options={COVERAGE_LEVELS} /></Field>
        {plan?.allows_dependants && <Field label="Dependants" hint="Name them later from the enrollment"><Input type="number" min={0} max={20} value={v.dependants} onChange={set("dependants")} /></Field>}
        <Field label="Policy / member number"><Input value={v.policyNumber} maxLength={60} onChange={set("policyNumber")} /></Field>
        <Field label="Employer contribution (INR)" hint={plan ? `Plan default ${money(plan.employer_contribution)}` : undefined}><Input type="number" min={0} step="0.01" value={v.employerContribution} onChange={set("employerContribution")} /></Field>
        <Field label="Employee contribution (INR)" hint={plan ? `Plan default ${money(plan.employee_contribution)}` : undefined}><Input type="number" min={0} step="0.01" value={v.employeeContribution} onChange={set("employeeContribution")} /></Field>
      </div>
      <Field label="Notes"><Textarea value={v.notes} maxLength={2000} onChange={set("notes")} /></Field>
    </ActionModal>
  );
}

function ChangeModal({ enrollment: x, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ coverageLevel: x.coverage_level, dependants: x.dependants, policyNumber: x.policy_number ?? "", notes: x.notes ?? "",
    employerContribution: x.employer_contribution, employeeContribution: x.employee_contribution, reason: "" });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <ActionModal title={`Change enrollment · ${x.plan?.name ?? ""}`} submitLabel="Save change" size="md" onClose={onClose}
      onSubmit={async () => {
        if (v.reason.trim().length < 3) return { error: "Give a reason for the change." };
        const res = await updateEnrollment(x.id, v);
        if (res.error) return res;
        notify("Enrollment updated. The employee was notified."); onDone(); return {};
      }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Coverage"><Select value={v.coverageLevel} onChange={set("coverageLevel")} options={COVERAGE_LEVELS} /></Field>
        {x.plan?.allows_dependants && <Field label="Dependants (count)"><Input type="number" min={0} max={20} value={v.dependants} onChange={set("dependants")} /></Field>}
        <Field label="Policy / member number"><Input value={v.policyNumber} maxLength={60} onChange={set("policyNumber")} /></Field>
        <Field label="Employer contribution (INR)"><Input type="number" min={0} step="0.01" value={v.employerContribution} onChange={set("employerContribution")} /></Field>
        <Field label="Employee contribution (INR)"><Input type="number" min={0} step="0.01" value={v.employeeContribution} onChange={set("employeeContribution")} /></Field>
      </div>
      <Field label="Notes"><Textarea value={v.notes} maxLength={2000} onChange={set("notes")} /></Field>
      <Field label="Reason for the change" required><Textarea value={v.reason} maxLength={1000} onChange={set("reason")} /></Field>
    </ActionModal>
  );
}

function StatusModal({ enrollment: x, status, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ endDate: status === "ended" ? today() : "", reason: "" });
  const titles = { ended: "End enrollment", cancelled: "Cancel enrollment", suspended: "Suspend enrollment", active: "Reactivate enrollment" };
  return (
    <ActionModal title={`${titles[status]} · ${x.plan?.name ?? ""}`} submitLabel={titles[status]} tone={status === "active" ? "primary" : "danger"} onClose={onClose}
      onSubmit={async () => {
        if (status === "ended" && (!v.endDate || v.endDate < x.start_date)) return { error: `Choose an end date on or after ${formatDate(x.start_date)}.` };
        if (status !== "active" && v.reason.trim().length < 3) return { error: "Give a reason." };
        const res = await setEnrollmentStatus(x.id, status, v.endDate, v.reason);
        if (res.error) return res;
        notify(`Enrollment ${label(status)}.`); onDone(); return {};
      }}>
      {status === "ended" && <Field label="End date" required><Input type="date" min={x.start_date} value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} /></Field>}
      <Field label="Reason" required={status !== "active"}><Textarea value={v.reason} maxLength={1000} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
      <p className="text-xs text-slate-500">
        {status === "ended" ? "Claims for expenses up to the end date can still be submitted and decided." : status === "cancelled" ? "Use cancel for an enrollment made in error. Cancelled enrollments cannot take claims." : status === "suspended" ? "No new claims while suspended. Reactivate to resume." : "The enrollment becomes active again."}
      </p>
    </ActionModal>
  );
}

function Dependants({ enrollment: x, canEdit }) {
  const { notify } = useToast();
  const q = useHrQuery(() => listDependants(x.id), [x.id]);
  const [v, setV] = useState({ fullName: "", relationship: "", dateOfBirth: "" });
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState(null);
  async function add() {
    if (v.fullName.trim().length < 2 || !v.relationship) { notify("Enter the dependant's name and relationship.", "error"); return; }
    setBusy(true);
    const res = await addDependant(x.id, v);
    setBusy(false);
    if (res.error) { notify(res.error, "error"); return; }
    setV({ fullName: "", relationship: "", dateOfBirth: "" }); notify("Dependant added."); q.reload();
  }
  return (
    <section>
      <h3 className="mb-2 text-sm font-bold text-[#101a3a]">Dependants</h3>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : (
        <DataTable caption="Dependants" rows={q.data} pageSize={20} emptyTitle="No named dependants"
          columns={[
            { key: "full_name", header: "Name" },
            { key: "relationship", header: "Relationship", render: (r) => RELATIONSHIPS.find((o) => o.value === r.relationship)?.label ?? r.relationship },
            { key: "date_of_birth", header: "Date of birth", render: (r) => formatDate(r.date_of_birth) },
            ...(canEdit ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => <Button size="sm" variant="ghost" onClick={() => setRemove(r)}>Remove</Button> }] : []),
          ]} />
      )}
      {canEdit && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4 sm:items-end">
          <Field label="Name"><Input value={v.fullName} maxLength={120} onChange={(e) => setV({ ...v, fullName: e.target.value })} /></Field>
          <Field label="Relationship"><Select placeholder="Choose" value={v.relationship} onChange={(e) => setV({ ...v, relationship: e.target.value })} options={RELATIONSHIPS} /></Field>
          <Field label="Date of birth"><Input type="date" max={today()} value={v.dateOfBirth} onChange={(e) => setV({ ...v, dateOfBirth: e.target.value })} /></Field>
          <Button variant="secondary" loading={busy} onClick={add}><Plus className="h-4 w-4" aria-hidden="true" />Add dependant</Button>
        </div>
      )}
      <ConfirmDialog open={Boolean(remove)} onClose={() => setRemove(null)} tone="danger" title="Remove dependant" confirmLabel="Remove"
        message={remove ? `Remove ${remove.full_name} from this enrollment? The change is kept in the history.` : ""} requireReason={false} reasonLabel="Reason (optional)"
        onConfirm={async (reason) => { const res = await removeDependant(remove.id, reason); if (!res.error) { notify("Dependant removed."); q.reload(); } return res; }} />
    </section>
  );
}

function EnrollmentDetail({ enrollment: x, canManage, myEmployeeId, onClose, onChanged }) {
  const [modal, setModal] = useState(null);
  const bal = useHrQuery(() => benefitBalances(x.employee_id), [x.employee_id, x.updated_at]);
  const hist = useHrQuery(() => listBenefitHistory(x.employee_id), [x.employee_id, x.updated_at]);
  const own = x.employee_id === myEmployeeId;
  const open = ["active", "suspended"].includes(x.status);
  const done = () => { setModal(null); onChanged(); };
  const balance = (bal.data ?? []).find((b) => b.enrollment_id === x.id);
  return (
    <>
      <Modal open onClose={onClose} title={`${x.plan?.name ?? "Enrollment"} · ${empText(x.employee)}`} size="lg"
        footer={<>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {canManage && open && !own && <>
            <Button variant="secondary" onClick={() => setModal("change")}>Change</Button>
            {x.status === "active" && <Button variant="secondary" onClick={() => setModal("suspended")}>Suspend</Button>}
            {x.status === "suspended" && <Button variant="secondary" onClick={() => setModal("active")}>Reactivate</Button>}
            <Button variant="secondary" onClick={() => setModal("cancelled")}>Cancel</Button>
            <Button variant="danger" onClick={() => setModal("ended")}>End enrollment</Button>
          </>}
        </>}>
        <div className="flex flex-col gap-5">
          {own && canManage && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This is your own enrollment. Another HR user must change it.</p>}
          <DescriptionList items={[
            { label: "Status", value: <EnrollmentStatus status={x.status} /> },
            { label: "Period", value: `${formatDate(x.start_date)} – ${x.end_date ? formatDate(x.end_date) : "open"}` },
            { label: "Coverage", value: coverageLabel(x.coverage_level) },
            { label: "Dependants", value: String(x.dependants ?? 0) },
            { label: "Policy / member number", value: x.policy_number },
            { label: "Contributions", value: `Employer ${money(x.employer_contribution)} · Employee ${money(x.employee_contribution)}` },
            x.eligibility_override && { label: "Eligibility override", value: x.eligibility_override },
            x.end_reason && { label: "Status reason", value: x.end_reason },
            x.notes && { label: "Notes", value: x.notes },
          ]} />
          {x.plan?.claimable && <section><h3 className="mb-2 text-sm font-bold text-[#101a3a]">Annual limit (current plan year)</h3>{bal.error ? <ErrorState message={bal.error} onRetry={bal.reload} /> : <LimitBar balance={balance} />}</section>}
          {x.plan?.allows_dependants && <Dependants enrollment={x} canEdit={canManage && open && !own} />}
          <section>
            <h3 className="mb-2 text-sm font-bold text-[#101a3a]">History</h3>
            {hist.loading && !hist.data ? <Loading /> : hist.error ? <ErrorState message={hist.error} onRetry={hist.reload} />
              : <BenefitTimeline events={(hist.data ?? []).filter((e) => e.enrollment_id === x.id && !e.claim_id)} />}
          </section>
        </div>
      </Modal>
      {modal === "change" && <ChangeModal enrollment={x} onClose={() => setModal(null)} onDone={done} />}
      {["ended", "cancelled", "suspended", "active"].includes(modal) && <StatusModal enrollment={x} status={modal} onClose={() => setModal(null)} onDone={done} />}
    </>
  );
}

function Requests({ canManage, myEmployeeId, onChanged }) {
  const { notify } = useToast();
  const [status, setStatus] = useState("pending");
  const [modal, setModal] = useState(null);
  const list = useHrQuery(() => listEnrollmentRequests({ status }), [status]);
  const done = () => { setModal(null); list.reload(); onChanged(); };
  return (
    <Card title="Self-enrollment requests" className="mt-5"
      actions={<Select aria-label="Request status" className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}
        options={[{ value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "cancelled", label: "Withdrawn" }, { value: "", label: "All" }]} />}>
      <DataTable caption="Enrollment requests" rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle="No requests" emptyDescription="Employees request plans that allow self-enrollment from their portal."
        columns={[
          { key: "employee", header: "Employee", render: (r) => empText(r.employee) },
          { key: "plan", header: "Plan", render: (r) => r.plan?.name ?? "—" },
          { key: "requested_start_date", header: "Start", render: (r) => formatDate(r.requested_start_date) },
          { key: "coverage_level", header: "Coverage", render: (r) => `${coverageLabel(r.coverage_level)}${r.dependants ? ` · ${r.dependants} dependant(s)` : ""}` },
          { key: "note", header: "Note", render: (r) => <p className="max-w-xs text-sm">{r.note ?? "—"}</p> },
          { key: "status", header: "Status", render: (r) => <div><RequestStatus status={r.status} />{r.decision_note && <p className="mt-1 text-xs text-slate-500">{r.decision_note}</p>}</div> },
          ...(canManage ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => r.status === "pending" && (r.employee_id === myEmployeeId
            ? <span className="text-xs text-slate-500">Your own request</span>
            : <span className="flex gap-1">
                <Button size="sm" variant="success" onClick={() => setModal({ type: "approve", r })}>Approve</Button>
                <Button size="sm" variant="danger" onClick={() => setModal({ type: "reject", r })}>Reject</Button>
              </span>) }] : []),
        ]} />
      <ConfirmDialog open={modal?.type === "approve"} onClose={() => setModal(null)} tone="success" title="Approve enrollment request" confirmLabel="Approve and enroll"
        message={modal?.r ? `Enroll ${empText(modal.r.employee)} in ${modal.r.plan?.name} from ${formatDate(modal.r.requested_start_date < today() ? today() : modal.r.requested_start_date)}? Eligibility is checked again.` : ""}
        requireReason={false} reasonLabel="Note (optional)"
        onConfirm={async (note) => { const res = await decideEnrollmentRequest(modal.r.id, true, note); if (!res.error) { notify("Request approved; employee enrolled."); done(); } return res; }} />
      <ConfirmDialog open={modal?.type === "reject"} onClose={() => setModal(null)} tone="danger" title="Reject enrollment request" confirmLabel="Reject"
        message="The employee is notified with your reason." requireReason reasonLabel="Reason"
        onConfirm={async (note) => { const res = await decideEnrollmentRequest(modal.r.id, false, note); if (!res.error) { notify("Request rejected."); done(); } return res; }} />
    </Card>
  );
}

export default function EnrollmentsTab({ canManage, employees, myEmployeeId }) {
  const [f, setF] = useState({ status: "live", plan: "", employee: "" });
  const [enrolling, setEnrolling] = useState(false);
  const [selected, setSelected] = useState(null);
  const plans = useHrQuery(() => listBenefitPlans(), []);
  const list = useHrQuery(() => listEnrollments(f), [f.status, f.plan, f.employee]);
  const rows = list.data;
  const selectedRow = useMemo(() => (selected ? (rows ?? []).find((r) => r.id === selected) ?? null : null), [rows, selected]);
  function doExport() {
    exportCsv(`benefit-enrollments-${today()}`, rows ?? [], [
      { label: "Employee ID", value: (r) => r.employee?.employee_code }, { label: "Employee", value: (r) => empText(r.employee) },
      { label: "Plan code", value: (r) => r.plan?.code }, { label: "Plan", value: (r) => r.plan?.name }, { label: "Status", key: "status" },
      { label: "Start date", key: "start_date" }, { label: "End date", key: "end_date" }, { label: "Coverage", value: (r) => coverageLabel(r.coverage_level) },
      { label: "Dependants", key: "dependants" }, { label: "Policy number", key: "policy_number" },
      { label: "Employer contribution", value: (r) => Number(r.employer_contribution) }, { label: "Employee contribution", value: (r) => Number(r.employee_contribution) },
      { label: "Eligibility override", key: "eligibility_override" }, { label: "Status reason", key: "end_reason" },
    ]);
  }
  return (
    <>
      <Toolbar>
        <Select aria-label="Employee" className="sm:w-64" placeholder="All employees" value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })} options={employees ?? []} />
        <Select aria-label="Plan" className="sm:w-56" placeholder="All plans" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} options={(plans.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
        <Select aria-label="Enrollment status" className="sm:w-44" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}
          options={[{ value: "live", label: "Active + suspended" }, { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }, { value: "ended", label: "Ended" }, { value: "cancelled", label: "Cancelled" }, { value: "", label: "All (history)" }]} />
        <Button variant="secondary" onClick={doExport} disabled={!rows?.length}><Download className="h-4 w-4" aria-hidden="true" />Export CSV</Button>
        {canManage && <Button onClick={() => setEnrolling(true)}><UserPlus className="h-4 w-4" aria-hidden="true" />Enroll employee</Button>}
      </Toolbar>
      <DataTable caption="Benefit enrollments" rows={rows} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle="No enrollments" emptyDescription={canManage ? "Enroll employees in a plan, or approve their requests below." : undefined}
        onRowClick={(r) => setSelected(r.id)}
        columns={[
          { key: "employee", header: "Employee", render: (r) => empText(r.employee) },
          { key: "plan", header: "Plan", render: (r) => <div><p className="font-medium">{r.plan?.name}</p><p className="text-xs text-slate-500">{r.plan?.code}</p></div> },
          { key: "start_date", header: "Start", sortable: true, render: (r) => formatDate(r.start_date) },
          { key: "end_date", header: "End", render: (r) => formatDate(r.end_date) },
          { key: "coverage_level", header: "Coverage", render: (r) => `${coverageLabel(r.coverage_level)}${r.dependants ? ` · ${r.dependants} dep.` : ""}` },
          { key: "policy_number", header: "Policy no.", render: (r) => r.policy_number ?? "—" },
          { key: "status", header: "Status", render: (r) => <EnrollmentStatus status={r.status} /> },
        ]} />
      <Requests canManage={canManage} myEmployeeId={myEmployeeId} onChanged={list.reload} />
      {enrolling && <EnrollModal employees={employees} plans={plans.data} onClose={() => setEnrolling(false)} onDone={() => { setEnrolling(false); list.reload(); }} />}
      {selectedRow && <EnrollmentDetail enrollment={selectedRow} canManage={canManage} myEmployeeId={myEmployeeId} onClose={() => setSelected(null)} onChanged={list.reload} />}
    </>
  );
}
