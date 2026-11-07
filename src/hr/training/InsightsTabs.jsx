// Training dashboard, certificate expiry / renewal tracking and reports
// (CSV). All figures are computed from the caller's RLS-scoped assignments:
// HR sees the company, managers their reporting line.
import { useMemo, useState } from "react";
import { AlertTriangle, Award, CalendarClock, CheckCircle2, ClipboardList, Download, Hourglass, RefreshCcw, ShieldCheck, Timer } from "lucide-react";
import { exportCsv, formatDate, useHrQuery } from "@/lib/hr/client";
import { generateRenewals, listEnrollments, listSessions } from "@/lib/hr/training";
import { EXPIRING_DAYS, certificateState, daysUntil, displayStatus, effectiveDueDate, isOverdueOn, latestCompletions, seatInfo, sessionWhen, summarize } from "@/lib/hr/trainingRules";
import { Button, Card, DataTable, Field, Input, KpiCard, Select, Toolbar, useToast } from "@/hr/ui";
import { AssignmentModalsHost } from "./AssignmentsTab";
import { ActionModal, CertificateBadge, DocButton, TBadge, courseText, empText, today } from "./shared";

// ------------------------------------------------------------------ dashboard
export function DashboardTab({ assignments, onOpen }) {
  const t = today();
  const s = useMemo(() => summarize(assignments.data, t), [assignments.data, t]);
  const upcoming = useHrQuery(() => listSessions(t, null), [t]);
  const loading = assignments.loading && !assignments.data;
  const byCourse = useMemo(() => {
    const m = new Map();
    for (const a of assignments.data ?? []) {
      if (a.status === "cancelled") continue;
      const k = a.course_id;
      const r = m.get(k) ?? { id: k, course: a.course, open: 0, completed: 0, overdue: 0, pending: 0 };
      if (["assigned", "in_progress"].includes(a.status)) r.open += 1;
      if (a.status === "completed" && a.verified_at) r.completed += 1;
      if (a.status === "completed" && !a.verified_at) r.pending += 1;
      if (isOverdueOn(a, t)) r.overdue += 1;
      m.set(k, r);
    }
    return [...m.values()].map((r) => ({ ...r, pct: r.open + r.completed + r.pending ? Math.round((100 * r.completed) / (r.open + r.completed + r.pending)) : null }))
      .sort((a, b) => b.overdue - a.overdue || (a.course?.title ?? "").localeCompare(b.course?.title ?? ""));
  }, [assignments.data, t]);
  const kpis = [
    { label: "Assigned", value: s.assigned, icon: ClipboardList, tone: "navy", go: ["assignments", "open"] },
    { label: "In progress", value: s.in_progress, icon: Hourglass, tone: "teal", go: ["assignments", "open"] },
    { label: "Completed (verified)", value: s.completed, icon: CheckCircle2, tone: "green", go: ["assignments", "completed"] },
    { label: "Overdue", value: s.overdue, hint: s.mandatory_open ? `${s.mandatory_open} open mandatory` : undefined, icon: Timer, tone: "red", go: ["assignments", "overdue"] },
    { label: "Pending verification", value: s.pending_verification, icon: ShieldCheck, tone: "orange", go: ["verification"] },
    { label: `Certificates expiring (${EXPIRING_DAYS}d)`, value: s.expiring, icon: Award, tone: "orange", go: ["certificates"] },
    { label: "Certificates expired", value: s.expired, icon: AlertTriangle, tone: "red", go: ["certificates"] },
    { label: "Upcoming sessions", value: upcoming.data ? upcoming.data.filter((x) => x.status === "scheduled").length : undefined, icon: CalendarClock, tone: "slate", go: ["sessions"] },
  ];
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => <KpiCard key={k.label} label={k.label} value={k.value} hint={k.hint} icon={k.icon} tone={k.tone} loading={loading || (k.label === "Upcoming sessions" && upcoming.loading)} onClick={() => onOpen(...k.go)} />)}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DataTable caption="Completion by course" rows={loading ? null : byCourse} loading={loading} error={assignments.error} onRetry={assignments.reload} pageSize={10}
            emptyTitle="No training assigned yet" emptyDescription="Assign courses or programs to see completion here."
            columns={[
              { key: "course", header: "Course", render: (r) => <div><p className="font-medium text-[#101a3a]">{r.course?.title ?? "—"}</p><p className="text-xs text-slate-500">{r.course?.code}{r.course?.is_mandatory ? " · mandatory" : ""}</p></div> },
              { key: "open", header: "Open" }, { key: "pending", header: "To verify" }, { key: "completed", header: "Completed" },
              { key: "overdue", header: "Overdue", render: (r) => (r.overdue ? <span className="font-semibold text-rose-700">{r.overdue}</span> : 0) },
              { key: "pct", header: "Completion", render: (r) => (r.pct == null ? "—" : (
                <span className="flex items-center gap-2"><span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100"><span className="block h-full bg-emerald-500" style={{ width: `${r.pct}%` }} /></span>{r.pct}%</span>)) },
            ]} />
        </div>
        <Card title="Next sessions" actions={<Button size="sm" variant="ghost" onClick={() => onOpen("sessions")}>All sessions</Button>}>
          {upcoming.error ? <p className="text-sm text-rose-700">{upcoming.error}</p> : !(upcoming.data ?? []).filter((x) => x.status === "scheduled").length ? (
            <p className="text-sm text-slate-500">{upcoming.loading ? "Loading…" : "No upcoming sessions."}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {upcoming.data.filter((x) => x.status === "scheduled").slice(0, 6).map((x) => (
                <li key={x.id} className="py-2 text-sm">
                  <p className="font-medium text-[#101a3a]">{x.course_title}</p>
                  <p className="text-xs text-slate-500">{sessionWhen(x)}{x.venue ? ` · ${x.venue}` : x.meeting_url ? " · online" : ""} · {seatInfo(x.capacity, x.seats_taken).label}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ certificates
export function CertificatesTab({ assignments, canManage, canAssign, canUpload, myEmployeeId, courses, programs, employees }) {
  const { notify } = useToast();
  const [state, setState] = useState("attention");
  const [modal, setModal] = useState(null);
  const [days, setDays] = useState(String(EXPIRING_DAYS));
  const [gen, setGen] = useState(false);
  const t = today();
  const rows = useMemo(() => latestCompletions(assignments.data)
    .filter((a) => a.certificate_expiry || a.certificate_document_id || a.certificate_number)
    .map((a) => ({ ...a, _state: certificateState(a, t) }))
    .filter((a) => state === "all" || (state === "attention" ? ["expired", "expiring"].includes(a._state) : a._state === state))
    .sort((a, b) => (a.certificate_expiry ?? "9999") < (b.certificate_expiry ?? "9999") ? -1 : 1), [assignments.data, state, t]);
  const openRenewal = useMemo(() => {
    const m = new Set();
    for (const a of assignments.data ?? []) if (["assigned", "in_progress"].includes(a.status)) m.add(`${a.employee_id}|${a.course_id}`);
    return m;
  }, [assignments.data]);
  const done = () => { setModal(null); assignments.reload(); };
  return (
    <>
      <Toolbar>
        <Select aria-label="Certificate state" className="sm:w-60" value={state} onChange={(e) => setState(e.target.value)}
          options={[{ value: "attention", label: `Expired or expiring (${EXPIRING_DAYS}d)` }, { value: "expiring", label: "Expiring" }, { value: "expired", label: "Expired" }, { value: "valid", label: "Valid" }, { value: "all", label: "All certificates" }]} />
        {canManage && <Button variant="secondary" onClick={() => setGen(true)}><RefreshCcw className="h-4 w-4" aria-hidden="true" />Assign renewals in bulk</Button>}
      </Toolbar>
      <p className="mb-3 text-sm text-slate-600">The latest completion per employee and course. Expiry = completion (or issue) date + the course validity. Renew to assign recertification.</p>
      <DataTable caption="Certificates and expiry" rows={rows} loading={assignments.loading} error={assignments.error} onRetry={assignments.reload}
        emptyTitle="No certificates here" emptyDescription="Certificates appear once training with a validity period or a certificate is completed."
        columns={[
          { key: "employee", header: "Employee", render: (r) => empText(r.employee) },
          { key: "course", header: "Course", render: (r) => courseText(r.course) },
          { key: "completion_date", header: "Completed", render: (r) => formatDate(r.completion_date) },
          { key: "certificate", header: "Certificate", render: (r) => <span className="flex flex-col text-sm">{r.certificate_number && <span>No. {r.certificate_number}</span>}{r.certificate ? <DocButton doc={r.certificate}>File</DocButton> : !r.certificate_number && <span className="text-slate-400">Not recorded</span>}</span> },
          { key: "certificate_expiry", header: "Expiry", render: (r) => <CertificateBadge row={r} /> },
          { key: "renewal", header: "Renewal", render: (r) => (openRenewal.has(`${r.employee_id}|${r.course_id}`) ? <TBadge value="assigned" /> : "—") },
          ...(canAssign ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => r.employee_id !== myEmployeeId && (
            <span className="flex gap-1">
              {r.verified_at && !openRenewal.has(`${r.employee_id}|${r.course_id}`) && <Button size="sm" variant="secondary" onClick={() => setModal({ type: "renew", row: r })}><RefreshCcw className="h-4 w-4" aria-hidden="true" />Renew</Button>}
              {["passed", "attended"].includes(r.result) && <Button size="sm" variant="ghost" onClick={() => setModal({ type: "certificate", row: r })}><Award className="h-4 w-4" aria-hidden="true" />Edit</Button>}
            </span>) }] : []),
        ]} />
      <AssignmentModalsHost modal={modal} setModal={setModal} done={done} canUpload={canUpload} courses={courses} programs={programs} employees={employees} myEmployeeId={myEmployeeId} />
      {gen && (
        <ActionModal title="Assign renewals in bulk" submitLabel="Assign renewals" onClose={() => setGen(false)}
          onSubmit={async () => {
            if (!(Number(days) >= 0 && Number(days) <= 365)) return { error: "Choose 0 to 365 days." };
            const res = await generateRenewals(days);
            if (res.error) return res;
            notify(`${res.data} renewal assignment(s) created.`); setGen(false); assignments.reload(); return {};
          }}>
          <p className="text-sm text-slate-700">Creates a recertification assignment for every verified certificate that expires within the chosen number of days (or has expired), unless one is already open. Your own certificates are skipped.</p>
          <Field label="Days ahead"><Input type="number" min={0} max={365} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        </ActionModal>
      )}
    </>
  );
}

// ------------------------------------------------------------------ reports
const REPORTS = [
  { value: "assignments", label: "All assignments (detail)" },
  { value: "by_course", label: "Completion by course" },
  { value: "overdue", label: "Overdue training" },
  { value: "certificates", label: "Certificate expiry" },
  { value: "attendance", label: "Session attendance" },
];

export function ReportsTab({ assignments, courses }) {
  const [rep, setRep] = useState("assignments");
  const [f, setF] = useState({ from: "", to: "", course: "" });
  const t = today();
  const sessions = useHrQuery(() => (rep === "attendance" ? listSessions(f.from || null, f.to || null) : Promise.resolve({ data: null })), [rep, f.from, f.to]);
  const enrol = useHrQuery(() => (rep === "attendance" ? listEnrollments() : Promise.resolve({ data: null })), [rep]);
  const inRange = (d) => (!f.from || (d && d >= f.from)) && (!f.to || (d && d <= f.to));
  const base = useMemo(() => (assignments.data ?? []).filter((a) => !f.course || a.course_id === f.course), [assignments.data, f.course]);

  const { cols, rows } = useMemo(() => {
    const emp = (a) => empText(a.employee);
    if (rep === "by_course") {
      const m = new Map();
      for (const a of base) {
        if (a.status === "cancelled") continue;
        const r = m.get(a.course_id) ?? { course: courseText(a.course), mandatory: a.course?.is_mandatory ? "yes" : "no", open: 0, completed: 0, passed: 0, failed: 0, overdue: 0 };
        if (["assigned", "in_progress"].includes(a.status)) r.open += 1;
        if (a.status === "completed" && a.verified_at && inRange(a.completion_date)) { r.completed += 1; if (a.result === "passed") r.passed += 1; if (a.result === "failed") r.failed += 1; }
        if (isOverdueOn(a, t)) r.overdue += 1;
        m.set(a.course_id, r);
      }
      const rows = [...m.values()].map((r) => ({ ...r, completion_pct: r.open + r.completed ? Math.round((1000 * r.completed) / (r.open + r.completed)) / 10 : null }));
      return { rows, cols: [{ key: "course", label: "Course" }, { key: "mandatory", label: "Mandatory" }, { key: "open", label: "Open" }, { key: "completed", label: "Completed" }, { key: "passed", label: "Passed" }, { key: "failed", label: "Failed" }, { key: "overdue", label: "Overdue" }, { key: "completion_pct", label: "Completion %" }] };
    }
    if (rep === "overdue") {
      const rows = base.filter((a) => isOverdueOn(a, t)).map((a) => ({ employee: emp(a), course: courseText(a.course), status: a.status, due_date: a.due_date, days_overdue: -daysUntil(effectiveDueDate(a), t), mandatory: a.course?.is_mandatory ? "yes" : "no" }));
      return { rows, cols: [{ key: "employee", label: "Employee" }, { key: "course", label: "Course" }, { key: "mandatory", label: "Mandatory" }, { key: "status", label: "Status" }, { key: "due_date", label: "Due" }, { key: "days_overdue", label: "Days overdue" }] };
    }
    if (rep === "certificates") {
      const rows = latestCompletions(base).filter((a) => a.certificate_expiry && inRange(a.certificate_expiry))
        .map((a) => ({ employee: emp(a), course: courseText(a.course), completed: a.completion_date, certificate_number: a.certificate_number ?? "", issued_on: a.certificate_issued_on ?? "", expiry: a.certificate_expiry, state: certificateState(a, t), days_left: daysUntil(a.certificate_expiry, t) }))
        .sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
      return { rows, cols: [{ key: "employee", label: "Employee" }, { key: "course", label: "Course" }, { key: "completed", label: "Completed" }, { key: "certificate_number", label: "Certificate no." }, { key: "issued_on", label: "Issued" }, { key: "expiry", label: "Expiry" }, { key: "days_left", label: "Days left" }, { key: "state", label: "State" }] };
    }
    if (rep === "attendance") {
      const byS = new Map((sessions.data ?? []).filter((s) => !f.course || s.course_id === f.course).map((s) => [s.id, s]));
      const rows = (enrol.data ?? []).filter((e) => byS.has(e.session_id)).map((e) => {
        const s = byS.get(e.session_id);
        return { session_date: s.session_date, course: `${s.course_code} · ${s.course_title}`, time: sessionWhen(s).slice(11), venue: s.venue ?? (s.meeting_url ? "online" : ""), trainer: s.trainer_name ?? "", employee: empText(e.employee), status: e.status, marked_at: e.attendance_marked_at ?? "" };
      }).sort((a, b) => (a.session_date < b.session_date ? -1 : 1));
      return { rows, cols: [{ key: "session_date", label: "Date" }, { key: "time", label: "Time" }, { key: "course", label: "Course" }, { key: "venue", label: "Venue" }, { key: "trainer", label: "Trainer" }, { key: "employee", label: "Employee" }, { key: "status", label: "Status" }, { key: "marked_at", label: "Marked at" }] };
    }
    const rows = base.filter((a) => inRange(a.assigned_at?.slice(0, 10))).map((a) => ({
      employee: emp(a), course: courseText(a.course), source: a.source, program: a.program?.title ?? "", assigned: a.assigned_at?.slice(0, 10), due_date: a.due_date ?? "",
      status: displayStatus(a, t), completion_date: a.completion_date ?? "", result: a.result ?? "", score: a.score ?? "", verified: a.verified_at ? "yes" : a.status === "completed" ? "pending" : "",
      completion_source: a.completion_source ?? "", certificate_expiry: a.certificate_expiry ?? "",
    }));
    return { rows, cols: [{ key: "employee", label: "Employee" }, { key: "course", label: "Course" }, { key: "source", label: "Source" }, { key: "program", label: "Program" }, { key: "assigned", label: "Assigned" }, { key: "due_date", label: "Due" }, { key: "status", label: "Status" }, { key: "completion_date", label: "Completed" }, { key: "result", label: "Result" }, { key: "score", label: "Score" }, { key: "verified", label: "Verified" }, { key: "completion_source", label: "Recorded by" }, { key: "certificate_expiry", label: "Certificate expiry" }] };
  }, [rep, base, f.from, f.to, f.course, sessions.data, enrol.data, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = assignments.loading || (rep === "attendance" && (sessions.loading || enrol.loading));
  const error = assignments.error || (rep === "attendance" && (sessions.error || enrol.error)) || null;
  const rangeLabel = { assignments: "Assigned", by_course: "Completed", certificates: "Expiry", attendance: "Session date", overdue: null }[rep];
  return (
    <>
      <Card className="mb-4" title="Report">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Report"><Select value={rep} onChange={(e) => setRep(e.target.value)} options={REPORTS} /></Field>
          <Field label="Course"><Select placeholder="All courses" value={f.course} onChange={(e) => setF((s) => ({ ...s, course: e.target.value }))} options={(courses ?? []).map((c) => ({ value: c.id, label: courseText(c) }))} /></Field>
          {rangeLabel && <Field label={`${rangeLabel} from`}><Input type="date" value={f.from} onChange={(e) => setF((s) => ({ ...s, from: e.target.value }))} /></Field>}
          {rangeLabel && <Field label={`${rangeLabel} to`}><Input type="date" min={f.from || undefined} value={f.to} onChange={(e) => setF((s) => ({ ...s, to: e.target.value }))} /></Field>}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">{rows.length} row(s). Scope follows your access: HR sees everyone, managers their reporting line.</p>
          <Button variant="secondary" disabled={!rows.length || loading} onClick={() => exportCsv(`training-${rep}-${t}`, rows, cols)}><Download className="h-4 w-4" aria-hidden="true" />Export CSV</Button>
        </div>
      </Card>
      <DataTable caption={REPORTS.find((r) => r.value === rep)?.label} rows={loading && !rows.length ? null : rows} loading={loading} error={error} rowKey={(r) => JSON.stringify(r)}
        emptyTitle="No rows" emptyDescription="Change the filters or assign training first."
        columns={cols.map((c) => ({ key: c.key, header: c.label, sortable: true, render: (r) => (c.key === "status" || c.key === "state" ? <TBadge value={r[c.key]} /> : r[c.key] === "" || r[c.key] == null ? "—" : String(r[c.key])) }))} />
    </>
  );
}

