// Employee Portal — My Benefits: my enrollments (coverage, limit balance),
// plans I'm eligible for (enrollment request where self-enrollment is
// allowed), my claims (new claim with documents, edit / resubmit when
// returned, withdraw), claim status history and my benefit history.
// RLS limits every query to the employee's own records; the server
// re-validates eligibility, enrollment dates and the annual limit.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Gift, HeartPulse, Plus, Receipt } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, useHrQuery } from "@/lib/hr/client";
import {
  COVERAGE_LEVELS, benefitBalances, benefitEligibility, cancelClaim, cancelEnrollmentRequest, claimActions, label, listBenefitHistory, listBenefitPlans,
  listClaimEvents, listEnrollmentRequests, listMyClaims, listMyEnrollments, planYearLabel, removeClaimDocument, requestEnrollment, saveAndSubmitClaim, validateClaim,
} from "@/lib/hr/benefits";
import {
  Badge, Button, Card, ConfirmDialog, DataTable, DescriptionList, EmptyState, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea, useToast,
} from "@/hr/ui";
import {
  ActionModal, BenefitTimeline, ClaimDocuments, ClaimFilePicker, ClaimStatus, EnrollmentStatus, LimitBar, RequestStatus, limitText, money, today,
} from "@/hr/benefits/shared";

const coverageLabel = (v) => COVERAGE_LEVELS.find((c) => c.value === v)?.label ?? label(v);

// ------------------------------------------------------------ claim form
function ClaimForm({ claim, enrollments, onClose, onDone }) {
  const { notify } = useToast();
  const claimable = enrollments.filter((x) => x.plan?.claimable && ["active", "ended"].includes(x.status));
  const [v, setV] = useState({ enrollment: claim?.enrollment_id ?? (claimable.length === 1 ? claimable[0].id : ""), expenseDate: claim?.expense_date ?? today(),
    amount: claim ? String(claim.amount) : "", description: claim?.description ?? "" });
  const [files, setFiles] = useState([]);
  const [docs, setDocs] = useState(claim?.documents ?? []);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const enr = claimable.find((x) => x.id === v.enrollment);
  const bal = useHrQuery(() => (v.expenseDate ? benefitBalances(null, v.expenseDate) : Promise.resolve({ data: null })), [v.expenseDate]);
  const balance = (bal.data ?? []).find((b) => b.enrollment_id === v.enrollment);
  // When editing, this claim's own pending amount is not part of "available".
  const available = balance?.annual_limit == null ? null
    : Number(balance.available) + (claim?.status === "submitted" ? Number(claim.amount) : 0);
  const needsDoc = enr?.plan ? (enr.plan.claim_requires_document ?? true) : false;
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function go(submit) {
    const errs = validateClaim({ amount: v.amount, expenseDate: v.expenseDate, description: v.description, enrollment: enr, today: today(), available: submit ? available : null });
    if (submit && needsDoc && !files.length && !docs.length) errs.files = "Attach a bill, receipt or certificate.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(submit ? "submit" : "draft"); setError(null);
    const res = await saveAndSubmitClaim({ id: claim?.id ?? null, enrollment: v.enrollment, expenseDate: v.expenseDate, amount: v.amount, description: v.description, files, submit });
    setBusy(null);
    if (res.error) {
      if (res.id && !claim) { notify(res.error, "error"); onDone(); } else setError(res.error);
      return;
    }
    notify(submit ? (claim?.status === "returned" ? "Claim resubmitted to HR." : "Claim submitted to HR.") : "Draft saved.");
    onDone();
  }
  async function removeDoc(d) {
    const res = await removeClaimDocument(d.id);
    if (res.error) { notify(res.error, "error"); return; }
    setDocs((x) => x.filter((y) => y.id !== d.id)); notify("Document removed.");
  }

  if (!claimable.length && !claim) {
    return (
      <ActionModal title="New benefit claim" hideSubmit onClose={onClose}>
        <EmptyState icon={Receipt} title="No claimable benefits" description="You are not enrolled in a plan that accepts claims. See Available plans to request one." />
      </ActionModal>
    );
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title={claim ? `${claim.status === "returned" ? "Update returned claim" : "Edit draft"} ${claim.claim_number}` : "New benefit claim"} size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={Boolean(busy)}>Cancel</Button>
        <Button variant="secondary" loading={busy === "draft"} disabled={Boolean(busy)} onClick={() => go(false)}>Save draft</Button>
        <Button loading={busy === "submit"} disabled={Boolean(busy)} onClick={() => go(true)}>{claim?.status === "returned" ? "Resubmit" : "Submit claim"}</Button>
      </>}>
      <div className="flex flex-col gap-3">
        {claim?.status === "returned" && claim.decision_note && <p className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-900"><strong>HR asked for changes:</strong> {claim.decision_note}</p>}
        <Field label="Benefit" required error={errors.enrollment}>
          <Select placeholder="Choose a benefit" value={v.enrollment} onChange={set("enrollment")}
            options={claimable.map((x) => ({ value: x.id, label: `${x.plan.name}${x.status === "ended" ? ` (ended ${formatDate(x.end_date)})` : ""}` }))} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Expense date" required error={errors.expense_date}><Input type="date" max={today()} min={enr?.start_date} value={v.expenseDate} onChange={set("expenseDate")} /></Field>
          <Field label="Amount (INR)" required error={errors.amount}><Input type="number" min="0.01" step="0.01" inputMode="decimal" value={v.amount} onChange={set("amount")} /></Field>
        </div>
        {enr && (balance ? <LimitBar balance={balance} /> : bal.loading ? null : <p className="text-xs text-slate-500">Annual limit: {limitText(enr.plan.annual_limit)}</p>)}
        <Field label="Description" required error={errors.description} hint="What was the expense for? e.g. certification exam fee, gym membership for March">
          <Textarea rows={3} maxLength={2000} value={v.description} onChange={set("description")} />
        </Field>
        {docs.length > 0 && <div><p className="mb-1 text-sm font-semibold text-[#173a52]">Attached documents</p><ClaimDocuments documents={docs} canRemove onRemove={removeDoc} /></div>}
        <ClaimFilePicker files={files} setFiles={setFiles} required={needsDoc && !docs.length} label={docs.length ? "Add more documents" : "Supporting documents"} />
        {errors.files && <p className="text-xs font-medium text-red-600" role="alert">{errors.files}</p>}
        <p className="text-xs text-slate-500">HR reviews the claim. Approved claims are paid outside payroll; HR records the payment here. Only you and HR benefits staff can see your claims and documents.</p>
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}

function MyClaimDetail({ claim: c, onClose, onEdit, onChanged }) {
  const { notify } = useToast();
  const ev = useHrQuery(() => listClaimEvents(c.id), [c.id, c.updated_at]);
  const [confirm, setConfirm] = useState(false);
  const actions = claimActions(c, { isClaimant: true });
  return (
    <>
      <Modal open onClose={onClose} title={`Claim ${c.claim_number}`} size="lg"
        footer={<>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {actions.includes("cancel") && <Button variant="danger" onClick={() => setConfirm(true)}>Withdraw</Button>}
          {actions.includes("edit") && <Button onClick={onEdit}>{c.status === "returned" ? "Update and resubmit" : "Continue draft"}</Button>}
        </>}>
        <div className="flex flex-col gap-5">
          {c.status === "returned" && <p className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-900">HR returned this claim for changes{c.decision_note ? `: ${c.decision_note}` : "."}</p>}
          {c.status === "approved" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Approved. Payment is made outside payroll; this page shows it once HR records it.</p>}
          <DescriptionList items={[
            { label: "Status", value: <ClaimStatus status={c.status} /> },
            { label: "Benefit", value: c.plan?.name },
            { label: "Plan year", value: planYearLabel(c.plan_year_start) },
            { label: "Expense date", value: formatDate(c.expense_date) },
            { label: "Claimed amount", value: money(c.amount) },
            c.approved_amount != null && { label: "Approved amount", value: money(c.approved_amount) },
            c.submitted_at && { label: "Submitted", value: formatDateTime(c.submitted_at) },
            c.decision_note && c.status !== "returned" && { label: "HR note", value: c.decision_note },
            c.status === "paid_externally" && { label: "Paid", value: `${formatDate(c.paid_on)} · ref ${c.payment_reference}` },
            { label: "Description", value: <span className="whitespace-pre-line">{c.description}</span> },
          ]} />
          <section><h3 className="mb-2 text-sm font-bold text-[#101a3a]">Documents</h3><ClaimDocuments documents={c.documents} /></section>
          <section><h3 className="mb-2 text-sm font-bold text-[#101a3a]">Status history</h3>
            {ev.loading && !ev.data ? <Loading /> : ev.error ? <ErrorState message={ev.error} onRetry={ev.reload} /> : <BenefitTimeline events={ev.data} />}</section>
        </div>
      </Modal>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} tone="danger" title="Withdraw claim" confirmLabel="Withdraw"
        message="The claim is closed and cannot be reopened. You can submit a new claim later." requireReason={false} reasonLabel="Reason (optional)"
        onConfirm={async (reason) => { const res = await cancelClaim(c.id, reason); if (!res.error) { notify("Claim withdrawn."); onChanged(); onClose(); } return res; }} />
    </>
  );
}

// ------------------------------------------------------- enrollment request
function RequestModal({ plan, onClose, onDone }) {
  const { notify } = useToast();
  const [v, setV] = useState({ startDate: today(), coverageLevel: "employee", dependants: 0, note: "" });
  return (
    <ActionModal title={`Request enrollment · ${plan.name}`} submitLabel="Send request" onClose={onClose}
      onSubmit={async () => {
        if (!v.startDate || v.startDate < today()) return { error: "Choose today or a later start date." };
        const res = await requestEnrollment({ plan: plan.benefit_type_id, startDate: v.startDate, coverageLevel: v.coverageLevel, dependants: v.dependants, note: v.note });
        if (res.error) return res;
        notify("Request sent to HR."); onDone(); return {};
      }}>
      <Field label="Preferred start date" required><Input type="date" min={today()} value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} /></Field>
      <Field label="Coverage"><Select value={v.coverageLevel} onChange={(e) => setV({ ...v, coverageLevel: e.target.value })} options={COVERAGE_LEVELS} /></Field>
      {plan.allows_dependants && <Field label="Number of dependants" hint="HR records their details"><Input type="number" min={0} max={20} value={v.dependants} onChange={(e) => setV({ ...v, dependants: e.target.value })} /></Field>}
      <Field label="Note for HR"><Textarea maxLength={1000} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      <p className="text-xs text-slate-500">HR checks your eligibility again and confirms the enrollment.</p>
    </ActionModal>
  );
}

function AvailablePlans({ me, onChanged }) {
  const { notify } = useToast();
  const el = useHrQuery(() => benefitEligibility(me), [me]);
  const plans = useHrQuery(() => listBenefitPlans({ activeOnly: true }), []);
  const reqs = useHrQuery(() => listEnrollmentRequests({ employee: me }), [me]);
  const [modal, setModal] = useState(null);
  const [cancel, setCancel] = useState(null);
  const byId = useMemo(() => new Map((plans.data ?? []).map((p) => [p.id, p])), [plans.data]);
  const pendingFor = (planId) => (reqs.data ?? []).find((r) => r.benefit_type_id === planId && r.status === "pending");
  if ((el.loading && !el.data) || (plans.loading && !plans.data)) return <Loading />;
  if (el.error || plans.error) return <ErrorState message={el.error || plans.error} onRetry={() => { el.reload(); plans.reload(); }} />;
  const rows = (el.data ?? []).map((r) => ({ ...r, plan: byId.get(r.benefit_type_id) }));
  return (
    <>
      {!rows.length ? <Card><EmptyState icon={Gift} title="No benefit plans yet" description="Plans offered by Zyllo Tech will appear here." /></Card> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {rows.map((r) => {
            const p = r.plan ?? {};
            const pending = pendingFor(r.benefit_type_id);
            return (
              <Card key={r.benefit_type_id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-[#101a3a]">{r.name}</p>
                    <p className="text-xs text-slate-500">{label(r.category)}{p.provider ? ` · ${p.provider}` : ""}</p>
                  </div>
                  {r.enrolled ? <Badge tone="blue">enrolled</Badge> : pending ? <Badge tone="amber">request pending</Badge> : r.eligible ? <Badge tone="green">eligible</Badge> : <Badge tone="slate">not eligible</Badge>}
                </div>
                {p.description && <p className="mt-2 text-sm text-slate-700">{p.description}</p>}
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                  {p.coverage_amount != null && <><dt>Coverage</dt><dd className="text-[#101a3a]">{money(p.coverage_amount)}</dd></>}
                  {p.claimable && <><dt>Annual claim limit</dt><dd className="text-[#101a3a]">{limitText(p.annual_limit)}</dd></>}
                  {p.employer_contribution_note && <><dt>Employer</dt><dd className="text-[#101a3a]">{p.employer_contribution_note}</dd></>}
                  {p.employee_contribution_note && <><dt>Your contribution</dt><dd className="text-[#101a3a]">{p.employee_contribution_note}</dd></>}
                </dl>
                {!r.eligible && !r.enrolled && r.reason && <p className="mt-2 text-xs text-slate-500">{r.reason}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {!r.enrolled && !pending && r.eligible && p.self_enrollment && <Button size="sm" onClick={() => setModal({ ...r, allows_dependants: p.allows_dependants })}>Request enrollment</Button>}
                  {!r.enrolled && !pending && r.eligible && !p.self_enrollment && <p className="text-xs text-slate-500">HR enrolls eligible employees in this plan. Contact HR if you want to join.</p>}
                  {pending && <Button size="sm" variant="secondary" onClick={() => setCancel(pending)}>Withdraw request</Button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Card title="My enrollment requests" className="mt-4">
        <DataTable caption="My enrollment requests" rows={reqs.data} loading={reqs.loading} error={reqs.error} onRetry={reqs.reload} emptyTitle="No requests yet"
          columns={[
            { key: "plan", header: "Plan", render: (r) => r.plan?.name ?? "—" },
            { key: "requested_start_date", header: "Start", render: (r) => formatDate(r.requested_start_date) },
            { key: "created_at", header: "Requested", render: (r) => formatDate(r.created_at) },
            { key: "status", header: "Status", render: (r) => <RequestStatus status={r.status} /> },
            { key: "decision_note", header: "HR note", render: (r) => r.decision_note ?? "—" },
          ]} />
      </Card>
      {modal && <RequestModal plan={modal} onClose={() => setModal(null)} onDone={() => { setModal(null); reqs.reload(); el.reload(); onChanged(); }} />}
      <ConfirmDialog open={Boolean(cancel)} onClose={() => setCancel(null)} title="Withdraw request" confirmLabel="Withdraw" tone="danger"
        message="Withdraw your enrollment request?" onConfirm={async () => { const res = await cancelEnrollmentRequest(cancel.id); if (!res.error) { notify("Request withdrawn."); reqs.reload(); } return res; }} />
    </>
  );
}

// --------------------------------------------------------------- page
export default function MyBenefitsPage() {
  const { hr } = useAuth();
  const me = hr?.employee?.id;
  const [params] = useSearchParams();
  const [tab, setTab] = useState(() => (["benefits", "eligibility", "claims", "history"].includes(params.get("tab")) ? params.get("tab") : "benefits"));
  const enr = useHrQuery(() => listMyEnrollments(me), [me]);
  const bal = useHrQuery(() => (me ? benefitBalances() : Promise.resolve({ data: [] })), [me]);
  const claims = useHrQuery(() => listMyClaims(me), [me]);
  const hist = useHrQuery(() => (tab === "history" && me ? listBenefitHistory(me) : Promise.resolve({ data: null })), [tab, me]);
  const [modal, setModal] = useState(null);   // { type: "new" | "edit" | "view", claim? }
  const enrollments = enr.data ?? [];
  const live = enrollments.filter((x) => ["active", "suspended"].includes(x.status));
  const past = enrollments.filter((x) => !["active", "suspended"].includes(x.status));
  const openClaims = (claims.data ?? []).filter((c) => ["draft", "submitted", "returned"].includes(c.status)).length;
  const reload = () => { enr.reload(); bal.reload(); claims.reload(); };

  if (!me) return <ErrorState message="Your account is not linked to an employee record." />;

  return (
    <>
      <PageHeader title="My Benefits" description="Your benefit plans, eligibility and claims. Only you and HR benefits staff can see your claims."
        actions={<Button onClick={() => { setTab("claims"); setModal({ type: "new" }); }}><Plus className="h-4 w-4" aria-hidden="true" />New claim</Button>} />
      <Tabs value={tab} onChange={setTab} label="My benefit sections" tabs={[
        { value: "benefits", label: "My benefits", count: enr.data ? live.length : undefined },
        { value: "eligibility", label: "Available plans" },
        { value: "claims", label: "My claims", count: claims.data ? openClaims : undefined },
        { value: "history", label: "History" },
      ]} />

      {tab === "benefits" && (enr.loading && !enr.data ? <Loading /> : enr.error ? <ErrorState message={enr.error} onRetry={enr.reload} /> : (
        <>
          {!live.length ? <Card><EmptyState icon={HeartPulse} title="No active benefits" description="When HR enrolls you in a plan it appears here. See Available plans for what you can join." /></Card> : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {live.map((x) => {
                const b = (bal.data ?? []).find((r) => r.enrollment_id === x.id);
                return (
                  <Card key={x.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div><p className="font-bold text-[#101a3a]">{x.plan?.name}</p><p className="text-xs text-slate-500">{label(x.plan?.category)}{x.plan?.provider ? ` · ${x.plan.provider}` : ""}</p></div>
                      <EnrollmentStatus status={x.status} />
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                      <dt>Since</dt><dd className="text-[#101a3a]">{formatDate(x.start_date)}</dd>
                      <dt>Coverage</dt><dd className="text-[#101a3a]">{coverageLabel(x.coverage_level)}{x.dependants ? ` · ${x.dependants} dependant(s)` : ""}</dd>
                      {x.plan?.coverage_amount != null && <><dt>Sum insured</dt><dd className="text-[#101a3a]">{money(x.plan.coverage_amount)}</dd></>}
                      {x.policy_number && <><dt>Policy / member no.</dt><dd className="text-[#101a3a]">{x.policy_number}</dd></>}
                      {x.plan?.employee_contribution_note && <><dt>Your contribution</dt><dd className="text-[#101a3a]">{x.plan.employee_contribution_note}</dd></>}
                    </dl>
                    {x.plan?.claimable && (
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Plan year {planYearLabel(b?.plan_year_start)}</p>
                        {bal.error ? <p className="text-xs text-red-600">{bal.error}</p> : <LimitBar balance={b} />}
                        {x.status === "active" && <Button size="sm" variant="secondary" className="mt-2" onClick={() => { setTab("claims"); setModal({ type: "new" }); }}><Receipt className="h-4 w-4" aria-hidden="true" />Claim</Button>}
                      </div>
                    )}
                    {x.status === "suspended" && x.end_reason && <p className="mt-2 text-xs text-orange-800">Suspended: {x.end_reason}</p>}
                  </Card>
                );
              })}
            </div>
          )}
          {past.length > 0 && (
            <Card title="Past enrollments" className="mt-4">
              <DataTable caption="Past enrollments" rows={past} pageSize={10}
                columns={[
                  { key: "plan", header: "Plan", render: (r) => r.plan?.name },
                  { key: "start_date", header: "Start", render: (r) => formatDate(r.start_date) },
                  { key: "end_date", header: "End", render: (r) => formatDate(r.end_date) },
                  { key: "status", header: "Status", render: (r) => <EnrollmentStatus status={r.status} /> },
                  { key: "end_reason", header: "Reason", render: (r) => r.end_reason ?? "—" },
                ]} />
            </Card>
          )}
        </>
      ))}

      {tab === "eligibility" && <AvailablePlans me={me} onChanged={reload} />}

      {tab === "claims" && (
        <DataTable caption="My claims" rows={claims.data} loading={claims.loading} error={claims.error} onRetry={claims.reload}
          emptyTitle="No claims yet" emptyDescription="Use New claim to claim an expense against a benefit you are enrolled in."
          onRowClick={(r) => setModal({ type: "view", claim: r })}
          columns={[
            { key: "claim_number", header: "Claim", render: (r) => <span className="font-mono text-xs font-bold text-[#1f4693]">{r.claim_number}</span> },
            { key: "plan", header: "Benefit", render: (r) => r.plan?.name ?? "—" },
            { key: "expense_date", header: "Expense date", render: (r) => formatDate(r.expense_date) },
            { key: "amount", header: "Amount", render: (r) => <div>{money(r.amount)}{r.approved_amount != null && Number(r.approved_amount) !== Number(r.amount) && <p className="text-xs text-slate-500">approved {money(r.approved_amount)}</p>}</div> },
            { key: "documents", header: "Docs", render: (r) => (r.documents ?? []).length },
            { key: "status", header: "Status", render: (r) => <ClaimStatus status={r.status} /> },
            { key: "updated_at", header: "Last update", render: (r) => formatDate(r.updated_at) },
          ]} />
      )}

      {tab === "history" && (hist.loading && !hist.data ? <Loading /> : hist.error ? <ErrorState message={hist.error} onRetry={hist.reload} /> : (
        <Card><BenefitTimeline events={hist.data} showPlan empty="Your benefit history (enrollments, requests and claims) will appear here." /></Card>
      ))}

      {(modal?.type === "new" || modal?.type === "edit") && (enr.data
        ? <ClaimForm claim={modal.claim} enrollments={enrollments} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />
        : <Modal open onClose={() => setModal(null)} title="New benefit claim" size="sm"><Loading /></Modal>)}
      {modal?.type === "view" && <MyClaimDetail claim={modal.claim} onClose={() => setModal(null)} onEdit={() => setModal({ type: "edit", claim: modal.claim })} onChanged={reload} />}
    </>
  );
}
