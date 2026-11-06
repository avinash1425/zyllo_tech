// "Requests" tab of My Payroll & Payslips: everything salary-related the
// employee has asked for, in one place —
//   * payroll queries on a payslip (Payroll module corrections, 170),
//   * salary-related HR requests (Module 10, 180): salary advances,
//     reimbursement claims, salary certificates, bank-detail changes and
//     payroll / benefits questions,
//   * reimbursement claims as Payroll sees them (paid with which run).
// New requests are filed in My HR Requests, which owns the forms, files and
// approval routing; this tab only deep-links there.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Banknote, FileSignature, Landmark, MessageCircleQuestion, Receipt } from "lucide-react";
import { formatDate, formatDateTime, formatMoney, useHrQuery } from "@/lib/hr/client";
import { CORRECTION_CATEGORIES, listMyReimbursements, submitPayrollQuery } from "@/lib/hr/payroll";
import { listMyRequests, listRequestCategories } from "@/lib/hr/requests";
import { RequestStatusBadge, WorkflowBadge } from "@/hr/requests/RequestWidgets";
import { Button, Card, DataTable, Field, InlineError, Input, Modal, Select, StatusBadge, Textarea } from "@/hr/ui";
import { label, period } from "./shared";

const SALARY_CATEGORIES = ["payroll_query", "loan_advance", "reimbursement", "benefits_query"];
/** Module 10 requests that concern pay. Letter / profile subjects are generated server-side (180). */
export function isSalaryRequest(r) {
  if (["salary_advance", "reimbursement"].includes(r.workflow)) return true;
  if (SALARY_CATEGORIES.includes(r.category?.code)) return true;
  if (r.workflow === "hr_letter" && /salary/i.test(r.subject ?? "")) return true;
  if (r.workflow === "profile_change" && /bank/i.test(r.subject ?? "")) return true;
  return false;
}

const ACTIONS = [
  { key: "advance", category: "loan_advance", icon: Banknote, title: "Salary advance", text: "Request an advance under the company policy, repaid from future salary.", to: "/employee/requests?new=advance" },
  { key: "certificate", category: "document_request", icon: FileSignature, title: "Salary certificate", text: "For a loan, visa or rental agreement.", to: "/employee/requests?new=letter&letter=salary_certificate" },
  { key: "reimbursement", category: "reimbursement", icon: Receipt, title: "Reimbursement claim", text: "Business expense with receipt; paid with the next payroll.", to: "/employee/requests?new=reimbursement" },
  { key: "bank", category: "profile_update", icon: Landmark, title: "Change salary bank account", text: "Payroll verifies new account details before paying into them.", to: "/employee/requests?new=profile" },
  { key: "question", category: "payroll_query", icon: MessageCircleQuestion, title: "Ask payroll a question", text: "Salary structure, tax deductions, Form 16 or anything not tied to one payslip.", to: "/employee/requests?new=helpdesk&category=payroll_query" },
];

export default function SalaryRequests({ me, queries }) {
  const navigate = useNavigate();
  const cats = useHrQuery(() => listRequestCategories({ activeOnly: true }), []);
  const active = new Set((cats.data ?? []).map((c) => c.code));
  const actions = ACTIONS.filter((a) => !cats.data || active.has(a.category));
  return (
    <div className="flex flex-col gap-4">
      <Card title="Start a salary-related request">
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {actions.map((a) => (
            <li key={a.key}>
              <button type="button" onClick={() => navigate(a.to)}
                className="flex h-full w-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-[#f96706] hover:bg-orange-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693]">
                <a.icon className="mt-0.5 h-5 w-5 shrink-0 text-[#f96706]" aria-hidden="true" />
                <span><span className="block text-sm font-semibold text-[#101a3a]">{a.title}</span><span className="block text-xs text-slate-500">{a.text}</span></span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">Something wrong on a specific payslip? Use <strong>Query</strong> on that payslip in the Payslips tab so payroll sees the exact period.</p>
      </Card>
      <MyHrSalaryRequests me={me} />
      <MyQueries query={queries} />
      <MyClaims me={me} />
    </div>
  );
}

function MyHrSalaryRequests({ me }) {
  const navigate = useNavigate();
  const q = useHrQuery(async () => {
    const res = await listMyRequests(me);
    return { ...res, data: res.data?.filter(isSalaryRequest) ?? null };
  }, [me]);
  return (
    <Card title="My salary-related HR requests" padded={false}>
      <DataTable caption="My salary-related HR requests" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload}
        emptyTitle="No salary-related requests" emptyDescription="Advances, salary certificates, claims, bank changes and payroll questions you raise appear here."
        onRowClick={(r) => navigate(`/employee/requests/${r.id}`)}
        columns={[
          { key: "subject", header: "Request", render: (r) => <div className="min-w-[12rem]"><p className="font-semibold text-[#101a3a]">{r.subject}</p>
            <p className="mt-0.5 text-xs text-slate-500">{r.workflow && r.workflow !== "helpdesk" ? <WorkflowBadge workflow={r.workflow} /> : r.category?.name}</p></div> },
          { key: "status", header: "Status", render: (r) => <RequestStatusBadge status={r.status} /> },
          { key: "created_at", header: "Raised", render: (r) => formatDate(r.created_at) },
          { key: "last_activity_at", header: "Last update", render: (r) => formatDateTime(r.last_activity_at) },
        ]} />
      <p className="px-4 py-3 text-xs text-slate-500">Open a request to see approvals, files, comments and payments. All your HR requests are in My HR Requests.</p>
    </Card>
  );
}

function MyQueries({ query }) {
  return (
    <Card title="My payroll queries" padded={false}>
      <DataTable caption="My payroll queries" rows={query.data} loading={query.loading} error={query.error} onRetry={query.reload} emptyTitle="No queries"
        emptyDescription="Use the Query button on a payslip if something looks wrong."
        columns={[
          { key: "created_at", header: "Raised", render: (r) => formatDate(r.created_at) },
          { key: "category", header: "About", render: (r) => label(r.category) },
          { key: "description", header: "Details", render: (r) => <span className="line-clamp-2 max-w-xs">{r.description}</span> },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status === "prepared" ? "in_review" : r.status} /> },
          { key: "outcome", header: "Outcome", render: (r) => (r.status === "applied" ? `Correction of ${formatMoney(r.proposed_amount)} in your next payslip` : r.decision_note || "—") },
        ]} />
      <p className="px-4 py-3 text-xs text-slate-500">Approved corrections are paid (or recovered) in the next payroll run. Finalized payslips are never edited.</p>
    </Card>
  );
}

function MyClaims({ me }) {
  const q = useHrQuery(() => listMyReimbursements(me), [me]);
  return (
    <Card title="Reimbursement claims (payroll status)" padded={false}>
      <DataTable caption="My reimbursement claims" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} emptyTitle="No claims yet"
        emptyDescription="Submit a reimbursement claim with its receipt from Start a salary-related request above."
        columns={[
          { key: "claim_date", header: "Date", render: (r) => formatDate(r.claim_date) },
          { key: "category", header: "Category", render: (r) => label(r.category) },
          { key: "amount", header: "Amount", render: (r) => formatMoney(r.amount) },
          { key: "description", header: "Description", render: (r) => <span className="line-clamp-2 max-w-xs">{r.description}</span> },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "decision_note", header: "Note", render: (r) => r.decision_note || "—" },
        ]} />
      <p className="px-4 py-3 text-xs text-slate-500">Your manager and then finance approve claims. Approved claims are paid with the next payroll run and appear on that payslip.</p>
    </Card>
  );
}

export function QueryModal({ slip, onClose, onDone }) {
  const [v, setV] = useState({ category: "", description: "", evidence: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!v.category) { setError("Choose what the query is about."); return; }
    if (v.description.trim().length < 5) { setError("Describe the issue (at least 5 characters)."); return; }
    setBusy(true); setError(null);
    const res = await submitPayrollQuery({ payslipId: slip.id, ...v });
    setBusy(false);
    if (res.error) setError(res.error); else onDone();
  }
  return (
    <Modal open onClose={onClose} title={`Payroll query · ${period(slip)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}>Send query</Button></>}>
      <div className="grid grid-cols-1 gap-3">
        <Field label="About" required><Select placeholder="Choose…" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} options={CORRECTION_CATEGORIES.map((c) => ({ value: c, label: label(c) }))} /></Field>
        <Field label="What looks wrong?" required><Textarea maxLength={2000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <Field label="Supporting evidence" hint="e.g. approved leave or attendance correction reference, or a document name in My Documents."><Input maxLength={1000} value={v.evidence} onChange={(e) => setV({ ...v, evidence: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><InlineError message={error} /></div>
    </Modal>
  );
}
