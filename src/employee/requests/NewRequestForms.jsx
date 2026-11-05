// Module 10 — Employee Portal request forms. Client checks are for
// convenience only; the server validates every value again.
//   * HR letter, reimbursement (receipt upload), salary advance (policy and
//     eligibility from the server), profile change (incl. bank details),
//     attendance correction (Module 5 workflow via the adapter).
// Each workflow form also edits a returned / draft request (mode "edit").
import { useMemo, useRef, useState } from "react";
import { Banknote, CalendarClock, FileSignature, Lock, MessageCircleQuestion, Receipt, UserCog } from "lucide-react";
import { formatMoney, useHrQuery } from "@/lib/hr/client";
import { getEmployeePrivate } from "@/lib/hr/employees";
import { myBankAccounts } from "@/lib/hr/payroll";
import { businessToday, addDays, zonedIso } from "@/lib/hr/attendance";
import {
  LETTER_TYPES, PROFILE_FIELDS, REIMBURSEMENT_CATEGORIES, REQUEST_FILE_ACCEPT, checkRequestFile, createWorkflowRequest,
  listProjectOptions, requestAttendanceCorrection, requestPolicies, salaryAdvanceEligibility, submitWorkflowRequest,
  updateWorkflowRequest, uploadRequestFile,
} from "@/lib/hr/requestWorkflows";
import { Button, ErrorState, Field, InlineError, Input, Loading, Modal, Select, Textarea, useToast } from "@/hr/ui";

const money = (v, cur) => formatMoney(Number(v || 0), cur || "INR");

/** Save (create or update) a workflow request, upload any new files, then submit. */
async function saveAndSubmit({ mode, requestId, category, details, sensitive, files = [], fileKind = "supporting" }) {
  let id = requestId;
  if (mode === "edit") {
    const u = await updateWorkflowRequest(id, details, sensitive);
    if (u.error) return { error: u.error };
  } else {
    // Draft first when files must be attached before approval starts.
    const c = await createWorkflowRequest(category, details, sensitive, files.length === 0);
    if (c.error) return { error: c.error };
    id = c.data;
    if (!files.length) return { id };
  }
  for (const f of files) {
    const up = await uploadRequestFile(id, fileKind, f);
    if (up.error) return { id, error: `${up.error} Your request was saved as a draft; open it to retry.` };
  }
  const s = await submitWorkflowRequest(id);
  if (s.error) return { id, error: `${s.error}${mode === "edit" ? "" : " Your request was saved as a draft."}` };
  return { id };
}

function FormModal({ title, onClose, busy, onSubmit, submitLabel = "Submit", children, error }) {
  return (
    <Modal open onClose={busy ? undefined : onClose} title={title} size="md"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button loading={busy} onClick={onSubmit}>{submitLabel}</Button></>}>
      <div className="flex flex-col gap-3">{children}<InlineError message={error} /></div>
    </Modal>
  );
}

function FilePicker({ label, files, setFiles, required, hint }) {
  const ref = useRef(null);
  const [err, setErr] = useState(null);
  function pick(e) {
    const picked = [...(e.target.files ?? [])];
    e.target.value = "";
    for (const f of picked) { const c = checkRequestFile(f); if (c.error) { setErr(`${f.name}: ${c.error}`); return; } }
    setErr(null);
    setFiles((x) => [...x, ...picked].slice(0, 5));
  }
  return (
    <Field label={label} required={required} error={err} hint={hint ?? "PDF, PNG, JPEG or WEBP, up to 10 MB each. Stored privately."}>
      <div className="flex flex-col gap-2">
        <input ref={ref} type="file" multiple accept={REQUEST_FILE_ACCEPT} onChange={pick} className="sr-only" tabIndex={-1} aria-label={label} />
        <div><Button type="button" size="sm" variant="secondary" onClick={() => ref.current?.click()}>Choose file</Button></div>
        {files.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5">
                <span className="truncate">{f.name}</span>
                <Button size="sm" variant="ghost" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}

// ------------------------------------------------------------- HR letter
export function LetterForm({ mode = "new", request, onClose, onDone }) {
  const { notify } = useToast();
  const d = request?.details ?? {};
  const [v, setV] = useState({ letter_type: d.letter_type ?? "", purpose: d.purpose ?? "", addressed_to: d.addressed_to ?? "",
    required_by: d.required_by ?? "", other_letter_name: d.other_letter_name ?? "", additional_details: d.additional_details ?? "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  async function submit() {
    const errs = {};
    if (!v.letter_type) errs.letter_type = "Choose a letter type.";
    if (v.purpose.trim().length < 3) errs.purpose = "Describe the purpose (at least 3 characters).";
    if (v.letter_type === "other" && v.other_letter_name.trim().length < 3) errs.other_letter_name = "Name the letter you need.";
    if (v.required_by && v.required_by < businessToday()) errs.required_by = "The date is in the past.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await saveAndSubmit({ mode, requestId: request?.id, category: "document_request", details: v });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(mode === "edit" ? "Request resubmitted." : "Letter request submitted to HR.");
    onDone(res.id);
  }
  return (
    <FormModal title={mode === "edit" ? "Update letter request" : "Request an HR letter"} onClose={onClose} busy={busy} onSubmit={submit} error={error}
      submitLabel={mode === "edit" ? "Resubmit" : "Submit"}>
      <Field label="Letter type" required error={errors.letter_type}><Select placeholder="Choose a letter" value={v.letter_type} onChange={set("letter_type")} options={LETTER_TYPES} /></Field>
      {v.letter_type === "other" && <Field label="Letter name" required error={errors.other_letter_name}><Input maxLength={120} value={v.other_letter_name} onChange={set("other_letter_name")} /></Field>}
      {v.letter_type === "salary_certificate" && <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />Salary certificates are prepared by Payroll. Your salary details are not shown to HR reviewers.</p>}
      <Field label="Purpose" required error={errors.purpose} hint="e.g. visa application, bank loan, rental agreement"><Textarea rows={3} maxLength={500} value={v.purpose} onChange={set("purpose")} /></Field>
      <Field label="Addressed to" hint="Optional — e.g. the embassy or bank name"><Input maxLength={200} value={v.addressed_to} onChange={set("addressed_to")} /></Field>
      <Field label="Required by" error={errors.required_by}><Input type="date" min={businessToday()} value={v.required_by} onChange={set("required_by")} /></Field>
      <Field label="Other details"><Textarea rows={2} maxLength={2000} value={v.additional_details} onChange={set("additional_details")} /></Field>
    </FormModal>
  );
}

// --------------------------------------------------------- reimbursement
export function ReimbursementForm({ mode = "new", request, onClose, onDone }) {
  const { notify } = useToast();
  const d = request?.details ?? {};
  const policies = useHrQuery(() => requestPolicies(), []);
  const projects = useHrQuery(() => listProjectOptions(), []);
  const currencies = policies.data?.hr_requests?.reimbursement_currencies ?? ["INR"];
  const maxAge = Number(policies.data?.hr_requests?.reimbursement_max_age_days ?? 90);
  const [v, setV] = useState({ category: d.category ?? "", expense_date: d.expense_date ?? "", amount: d.amount ? String(d.amount) : "",
    currency: d.currency ?? "", purpose: d.purpose ?? "", merchant: d.merchant ?? "", project_id: d.project_id ?? "" });
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const hasReceipt = (request?.attachments ?? []).some((a) => a.kind === "receipt" && a.uploaded);
  async function submit() {
    const errs = {};
    const today = businessToday();
    if (!v.category) errs.category = "Choose a category.";
    if (!v.expense_date) errs.expense_date = "Enter the expense date.";
    else if (v.expense_date > today) errs.expense_date = "The date cannot be in the future.";
    else if (v.expense_date < addDays(today, -maxAge)) errs.expense_date = `Expenses older than ${maxAge} days cannot be claimed.`;
    if (!(Number(v.amount) > 0)) errs.amount = "Enter an amount greater than zero.";
    if (v.purpose.trim().length < 3) errs.purpose = "Describe the business purpose.";
    if (!files.length && !hasReceipt) errs.receipt = "Attach the receipt.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await saveAndSubmit({ mode, requestId: request?.id, category: "reimbursement",
      details: { ...v, currency: v.currency || currencies[0] }, files, fileKind: "receipt" });
    setBusy(false);
    if (res.error) {
      if (res.id && mode !== "edit") { notify(res.error, "error"); onDone(res.id, true); } else setError(res.error);
      return;
    }
    notify(mode === "edit" ? "Claim resubmitted." : "Claim submitted to your manager.");
    onDone(res.id);
  }
  return (
    <FormModal title={mode === "edit" ? "Update reimbursement claim" : "Reimbursement claim"} onClose={onClose} busy={busy} onSubmit={submit} error={error}
      submitLabel={mode === "edit" ? "Resubmit" : "Submit claim"}>
      <Field label="Category" required error={errors.category}><Select placeholder="Choose a category" value={v.category} onChange={set("category")} options={REIMBURSEMENT_CATEGORIES} /></Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Expense date" required error={errors.expense_date}><Input type="date" max={businessToday()} value={v.expense_date} onChange={set("expense_date")} /></Field>
        <Field label="Amount" required error={errors.amount}><Input type="number" min="0.01" step="0.01" inputMode="decimal" value={v.amount} onChange={set("amount")} /></Field>
        <Field label="Currency"><Select value={v.currency || currencies[0]} onChange={set("currency")} options={currencies.map((c) => ({ value: c, label: c }))} /></Field>
      </div>
      <Field label="Business purpose" required error={errors.purpose}><Textarea rows={3} maxLength={2000} value={v.purpose} onChange={set("purpose")} /></Field>
      <Field label="Merchant"><Input maxLength={120} value={v.merchant} onChange={set("merchant")} /></Field>
      <Field label="Related project">
        <Select placeholder="None" value={v.project_id} onChange={set("project_id")} options={(projects.data ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))} />
      </Field>
      <FilePicker label={hasReceipt ? "Add another receipt" : "Receipt"} required={!hasReceipt} files={files} setFiles={setFiles} />
      {errors.receipt && <p className="text-xs font-medium text-red-600" role="alert">{errors.receipt}</p>}
      <p className="text-xs text-slate-500">Route: your manager, then Finance. Approved claims are paid with payroll; duplicate claims are refused.</p>
    </FormModal>
  );
}

// -------------------------------------------------------- salary advance
export function SalaryAdvanceForm({ mode = "new", request, onClose, onDone }) {
  const { notify } = useToast();
  const el = useHrQuery(() => salaryAdvanceEligibility(), []);
  const d = request?.details ?? {};
  const [v, setV] = useState({ amount: d.amount ? String(d.amount) : "", repayment_months: d.repayment_months ? String(d.repayment_months) : "", reason: d.reason ?? "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const e = el.data;
  // Editing a returned request: its own amount is excluded from the limit on the server.
  const max = Number(e?.max_permitted ?? 0) + (mode === "edit" ? Number(d.amount ?? 0) : 0);
  const months = useMemo(() => {
    if (!e) return [];
    const out = [];
    for (let m = Number(e.min_repayment_months); m <= Number(e.max_repayment_months); m++) out.push({ value: String(m), label: `${m} month${m === 1 ? "" : "s"}` });
    return out;
  }, [e]);
  const installment = Number(v.amount) > 0 && Number(v.repayment_months) > 0 ? Number(v.amount) / Number(v.repayment_months) : null;
  async function submit() {
    const errs = {};
    if (!(Number(v.amount) > 0)) errs.amount = "Enter the amount.";
    else if (Number(v.amount) > max) errs.amount = `The maximum you can request is ${money(max, e?.currency)}.`;
    if (!v.repayment_months) errs.repayment_months = "Choose a repayment period.";
    if (v.reason.trim().length < 3) errs.reason = "Give a reason.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await saveAndSubmit({ mode, requestId: request?.id, category: "loan_advance", details: v });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(mode === "edit" ? "Advance request resubmitted." : "Salary advance request submitted.");
    onDone(res.id);
  }
  const blocked = e && !e.eligible && mode !== "edit";
  return (
    <FormModal title={mode === "edit" ? "Update salary advance" : "Salary advance request"} onClose={onClose} busy={busy} onSubmit={blocked ? onClose : submit}
      submitLabel={blocked ? "Close" : mode === "edit" ? "Resubmit" : "Submit"} error={error}>
      {el.loading && !e ? <Loading /> : el.error ? <ErrorState message={el.error} onRetry={el.reload} /> : blocked ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-semibold">You cannot request a salary advance right now.</p>
          <ul className="mt-1 list-disc pl-5">{(e.reasons ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm sm:grid-cols-2">
            <p>Maximum you can request: <span className="font-bold">{money(max, e?.currency)}</span></p>
            <p>Outstanding advance balance: <span className="font-bold">{money(e?.outstanding_balance, e?.currency)}</span></p>
          </div>
          <Field label={`Amount (${e?.currency ?? "INR"})`} required error={errors.amount}><Input type="number" min="1" step="0.01" inputMode="decimal" value={v.amount} onChange={set("amount")} /></Field>
          <Field label="Repayment period" required error={errors.repayment_months}><Select placeholder="Choose" value={v.repayment_months} onChange={set("repayment_months")} options={months} /></Field>
          {installment && <p className="text-sm text-slate-700">Proposed repayment: {v.repayment_months} instalments of about <span className="font-semibold">{money(installment, e?.currency)}</span>, starting the month after disbursement.</p>}
          <Field label="Reason" required error={errors.reason}><Textarea rows={3} maxLength={2000} value={v.reason} onChange={set("reason")} /></Field>
          <p className="text-xs text-slate-500">Route: your manager (or HR), then Payroll. After approval you accept the repayment agreement; Finance records the payment. Nothing is deducted from your salary unless the policy allows it and you authorise it.</p>
        </>
      )}
    </FormModal>
  );
}

// -------------------------------------------------------- profile change
export function ProfileChangeForm({ mode = "new", request, employeeId, onClose, onDone }) {
  const { notify } = useToast();
  const cur = useHrQuery(() => getEmployeePrivate(employeeId), [employeeId]);
  const bank = useHrQuery(() => myBankAccounts(), []);
  const prior = Object.fromEntries((request?.profile_changes ?? []).filter((r) => r.group === "contact").map((r) => [r.field, r.proposed ?? ""]));
  const [v, setV] = useState(prior);
  const [reason, setReason] = useState(request?.details?.reason ?? "");
  const [withBank, setWithBank] = useState(false);
  const [b, setB] = useState({ bank_name: "", account_holder: "", account_number: "", confirm: "", ifsc: "", iban: "", swift_code: "", branch: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const primary = (bank.data ?? []).find((x) => x.is_primary);
  const setB_ = (k) => (e) => setB((s) => ({ ...s, [k]: e.target.value }));
  async function submit() {
    const errs = {};
    const contact = {};
    for (const f of PROFILE_FIELDS) {
      if (v[f.key] === undefined) continue;
      const val = String(v[f.key] ?? "").trim();
      if ((cur.data?.[f.key] ?? "") === val && mode !== "edit") continue;
      if (f.type === "tel" && val && !/^[+0-9 ()-]{7,20}$/.test(val)) errs[f.key] = "Enter 7 to 20 digits (spaces, +, - and brackets allowed).";
      if (f.type === "email" && val && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val)) errs[f.key] = "Enter a valid email address.";
      contact[f.key] = val;
    }
    let bankOut = null;
    if (withBank) {
      const acct = b.account_number.replace(/\s/g, "").toUpperCase();
      if (b.bank_name.trim().length < 2) errs.bank_name = "Enter the bank name.";
      if (b.account_holder.trim().length < 2) errs.account_holder = "Enter the account holder.";
      if (!/^[0-9A-Z]{6,34}$/.test(acct)) errs.account_number = "Enter 6 to 34 letters or digits.";
      if (acct !== b.confirm.replace(/\s/g, "").toUpperCase()) errs.confirm = "The account numbers do not match.";
      if (b.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(b.ifsc.trim())) errs.ifsc = "Enter a valid IFSC code.";
      const { confirm, ...rest } = b;
      bankOut = { ...rest, account_number: acct };
    }
    if (!Object.keys(contact).length && !bankOut) errs.form = "Change at least one value.";
    if (reason.trim().length < 3) errs.reason = "Explain the change.";
    setErrors(errs);
    if (Object.keys(errs).length) { if (errs.form) setError(errs.form); return; }
    setBusy(true); setError(null);
    const res = await saveAndSubmit({ mode, requestId: request?.id, category: "profile_update", details: { reason },
      sensitive: { contact, ...(bankOut ? { bank: bankOut } : {}) } });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(mode === "edit" ? "Change request resubmitted." : "Change request submitted. Your profile is updated after approval.");
    onDone(res.id);
  }
  return (
    <FormModal title={mode === "edit" ? "Update profile change request" : "Request a profile change"} onClose={onClose} busy={busy} onSubmit={submit} error={error}
      submitLabel={mode === "edit" ? "Resubmit" : "Submit for review"}>
      {cur.loading && !cur.data ? <Loading /> : (
        <>
          <p className="text-sm text-slate-600">Only the fields you change are sent. HR reviews contact details; Payroll reviews bank details. Nothing changes until it is approved.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {PROFILE_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} error={errors[f.key]} hint={cur.data?.[f.key] ? `Current: ${cur.data[f.key]}` : undefined}>
                <Input type={f.type ?? "text"} maxLength={200} value={v[f.key] ?? ""} placeholder={cur.data?.[f.key] ?? ""}
                  onChange={(e) => setV((s) => ({ ...s, [f.key]: e.target.value }))} />
              </Field>
            ))}
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-[#173a52]">
              <input type="checkbox" checked={withBank} onChange={(e) => setWithBank(e.target.checked)} /> Change my salary bank account
            </label>
            {primary && <p className="mt-1 text-xs text-slate-500">Current: {primary.bank_name} ••••{primary.account_last4}</p>}
            {mode === "edit" && request?.details?.includes_bank && !withBank && <p className="mt-1 text-xs text-amber-700">Re-enter the bank details to keep the bank change in this request.</p>}
            {withBank && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Bank name" required error={errors.bank_name}><Input maxLength={120} value={b.bank_name} onChange={setB_("bank_name")} /></Field>
                <Field label="Account holder" required error={errors.account_holder}><Input maxLength={120} value={b.account_holder} onChange={setB_("account_holder")} /></Field>
                <Field label="Account number" required error={errors.account_number}><Input autoComplete="off" maxLength={40} value={b.account_number} onChange={setB_("account_number")} /></Field>
                <Field label="Confirm account number" required error={errors.confirm}><Input autoComplete="off" maxLength={40} value={b.confirm} onChange={setB_("confirm")} onPaste={(e) => e.preventDefault()} /></Field>
                <Field label="IFSC" error={errors.ifsc}><Input maxLength={11} value={b.ifsc} onChange={setB_("ifsc")} /></Field>
                <Field label="IBAN"><Input maxLength={34} value={b.iban} onChange={setB_("iban")} /></Field>
                <Field label="SWIFT"><Input maxLength={11} value={b.swift_code} onChange={setB_("swift_code")} /></Field>
                <Field label="Branch"><Input maxLength={120} value={b.branch} onChange={setB_("branch")} /></Field>
              </div>
            )}
          </div>
          <Field label="Reason for the change" required error={errors.reason}><Textarea rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </>
      )}
    </FormModal>
  );
}

// -------------------------------------------------- attendance correction
const CORRECTION_TYPES = [
  { value: "missed_punch_in", label: "Missed punch-in" },
  { value: "missed_punch_out", label: "Missed punch-out" },
  { value: "incorrect_time", label: "Incorrect punch time" },
];
export function AttendanceCorrectionForm({ onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ workDate: businessToday(), type: "missed_punch_in", inTime: "", outTime: "", reason: "", evidence: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const needIn = v.type !== "missed_punch_out";
  const needOut = v.type !== "missed_punch_in";
  async function submit() {
    const errs = {};
    if (!v.workDate || v.workDate > businessToday()) errs.workDate = "Choose today or a past date.";
    if (needIn && v.type === "missed_punch_in" && !v.inTime) errs.inTime = "Enter the punch-in time.";
    if (v.type === "missed_punch_out" && !v.outTime) errs.outTime = "Enter the punch-out time.";
    if (v.type === "incorrect_time" && !v.inTime && !v.outTime) errs.inTime = "Enter the corrected time(s).";
    if (v.inTime && v.outTime && v.outTime <= v.inTime) errs.outTime = "Punch-out must be after punch-in.";
    if (v.reason.trim().length < 3) errs.reason = "Give a reason.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError(null);
    const res = await requestAttendanceCorrection({ workDate: v.workDate, type: v.type, reason: v.reason, evidence: v.evidence,
      checkIn: needIn && v.inTime ? zonedIso(v.workDate, v.inTime) : null, checkOut: needOut && v.outTime ? zonedIso(v.workDate, v.outTime) : null });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify("Correction requested. Your manager will review it; attendance changes only after approval.");
    onDone();
  }
  return (
    <FormModal title="Attendance correction" onClose={onClose} busy={busy} onSubmit={submit} error={error}>
      <Field label="Date" required error={errors.workDate}><Input type="date" max={businessToday()} value={v.workDate} onChange={set("workDate")} /></Field>
      <Field label="What needs correcting" required><Select value={v.type} onChange={set("type")} options={CORRECTION_TYPES} /></Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {needIn && <Field label="Correct punch-in" error={errors.inTime}><Input type="time" value={v.inTime} onChange={set("inTime")} /></Field>}
        {needOut && <Field label="Correct punch-out" error={errors.outTime}><Input type="time" value={v.outTime} onChange={set("outTime")} /></Field>}
      </div>
      <Field label="Reason" required error={errors.reason}><Textarea rows={3} maxLength={1000} value={v.reason} onChange={set("reason")} /></Field>
      <Field label="Supporting evidence" hint="e.g. visitor log reference, meeting invite, ticket number"><Input maxLength={1000} value={v.evidence} onChange={set("evidence")} /></Field>
      <p className="text-xs text-slate-500">Handled by Attendance &amp; Time: your original punches are kept and every correction is audited. Track it in My Attendance.</p>
    </FormModal>
  );
}

// ------------------------------------------------------------- chooser
export const REQUEST_TYPES = [
  { key: "helpdesk", label: "HR question", description: "Ask HR anything (confidential grievances included)", icon: MessageCircleQuestion },
  { key: "letter", label: "HR letter", description: "Employment, experience, salary or address letter", icon: FileSignature, category: "document_request" },
  { key: "reimbursement", label: "Reimbursement claim", description: "Business expense with receipt", icon: Receipt, category: "reimbursement" },
  { key: "advance", label: "Salary advance", description: "Under the company policy", icon: Banknote, category: "loan_advance" },
  { key: "profile", label: "Profile change", description: "Phone, address, emergency contact, bank details", icon: UserCog, category: "profile_update" },
  { key: "attendance", label: "Attendance correction", description: "Missed or incorrect punch", icon: CalendarClock },
];
export function RequestTypeChooser({ categories, onPick, onClose }) {
  const active = new Set((categories ?? []).filter((c) => c.active).map((c) => c.code));
  const types = REQUEST_TYPES.filter((t) => !t.category || active.has(t.category));
  return (
    <Modal open onClose={onClose} title="New request" size="md" footer={<Button variant="secondary" onClick={onClose}>Cancel</Button>}>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {types.map((t) => (
          <li key={t.key}>
            <button type="button" onClick={() => onPick(t.key)}
              className="flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-[#f96706] hover:bg-orange-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693]">
              <t.icon className="mt-0.5 h-5 w-5 shrink-0 text-[#f96706]" aria-hidden="true" />
              <span><span className="block text-sm font-semibold text-[#101a3a]">{t.label}</span><span className="block text-xs text-slate-500">{t.description}</span></span>
            </button>
          </li>
        ))}
      </ul>
      {!active.has("loan_advance") && <p className="mt-3 text-xs text-slate-500">Salary advances are not offered until the company policy is enabled.</p>}
    </Modal>
  );
}
