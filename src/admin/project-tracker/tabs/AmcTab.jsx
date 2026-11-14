import { useCallback, useEffect, useState } from "react";
import { CircleCheck, RefreshCw } from "lucide-react";
import RecordSection from "../RecordSection";
import { Badge, Banner, Button, Card, Checkbox, Modal, TextArea, TextInput, useToast } from "../ui";
import { useProject, useRole } from "../context";
import { completeRenewal, listDueItems, renewAmc, updateRecord } from "@/lib/api/admin/projectTracker";
import { DUE_KINDS, DUE_WINDOWS, labelOf } from "../lib/options";
import { addDaysISO, daysUntil, formatDate, relativeDays, todayISO } from "../lib/format";
import { looksLikeSecret } from "../lib/validation";

export function CompleteRenewalModal({ renewal, onClose, onDone }) {
  const toast = useToast();
  const { email } = useRole();
  const [v, setV] = useState({ completedOn: todayISO(), newExpiry: "", evidence: "", completedBy: email || "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const linked = (renewal.item_type === "domain" || renewal.item_type === "ssl") ? renewal.domain_id : renewal.item_type === "hosting" ? renewal.hosting_id : null;

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!v.completedOn) errs.completedOn = "Enter the completion date.";
    else if (v.completedOn > todayISO()) errs.completedOn = "Cannot be in the future.";
    if (v.newExpiry && v.completedOn && v.newExpiry <= v.completedOn) errs.newExpiry = "Must be after the completion date.";
    if (v.evidence.trim().length < 5) errs.evidence = "Describe the evidence (invoice, receipt or confirmation; at least 5 characters).";
    if (looksLikeSecret(v.evidence)) errs.evidence = "This looks like a secret. Enter a reference instead.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError("");
    try {
      await completeRenewal(renewal.id, { completedOn: v.completedOn, newExpiry: v.newExpiry || null, evidence: v.evidence.trim(), completedBy: v.completedBy.trim() });
      toast.push("Renewal completed.");
      await onDone();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Complete renewal — ${renewal.item_label}`} onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput type="date" label="Completed on" required value={v.completedOn} onChange={(x) => setV({ ...v, completedOn: x })} error={errors.completedOn} />
        <TextInput type="date" label="New expiry date" value={v.newExpiry} onChange={(x) => setV({ ...v, newExpiry: x })} error={errors.newExpiry}
          help={linked ? "Also updates the linked domain / SSL / hosting record." : "Optional."} />
        <TextInput label="Completed by" value={v.completedBy} onChange={(x) => setV({ ...v, completedBy: x })} maxLength={200} />
        <TextArea label="Completion evidence" required full value={v.evidence} onChange={(x) => setV({ ...v, evidence: x })} error={errors.evidence}
          maxLength={2000} help="e.g. invoice number, payment reference, registrar confirmation." />
        {error && <div className="sm:col-span-2"><Banner tone="danger">{error}</Banner></div>}
        <div className="flex justify-end gap-2 border-t border-[#eef0f4] pt-4 sm:col-span-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Complete renewal</Button>
        </div>
      </form>
    </Modal>
  );
}

function RenewAmcModal({ contract, onClose, onDone }) {
  const toast = useToast();
  const start0 = contract.end_date ? addDaysISO(contract.end_date, 1) : todayISO();
  const [v, setV] = useState({ start: start0, end: start0 ? addDaysISO(start0, 364) : "", renewal: "", number: "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!v.start) errs.start = "Required.";
    if (!v.end) errs.end = "Required.";
    if (v.start && v.end && v.end < v.start) errs.end = "End cannot be before start.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError("");
    try {
      await renewAmc(contract.id, { start: v.start, end: v.end, renewalDate: v.renewal || null, contractNumber: v.number.trim() || null });
      toast.push("AMC renewed — the previous contract is kept as history.");
      await onDone();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Renew AMC ${contract.contract_number || ""}`} onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <p className="text-sm text-[#676b7a] sm:col-span-2">Creates a new active contract (copying scope, terms and contacts) and marks this one Renewed.</p>
        <TextInput type="date" label="New start date" required value={v.start} onChange={(x) => setV({ ...v, start: x })} error={errors.start} />
        <TextInput type="date" label="New end date" required value={v.end} onChange={(x) => setV({ ...v, end: x })} error={errors.end} />
        <TextInput type="date" label="Next renewal date" value={v.renewal} onChange={(x) => setV({ ...v, renewal: x })} />
        <TextInput label="New contract number" value={v.number} onChange={(x) => setV({ ...v, number: x })} maxLength={100} />
        {error && <div className="sm:col-span-2"><Banner tone="danger">{error}</Banner></div>}
        <div className="flex justify-end gap-2 border-t border-[#eef0f4] pt-4 sm:col-span-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Renew contract</Button>
        </div>
      </form>
    </Modal>
  );
}

function UpcomingCard({ projectId, version }) {
  const [within, setWithin] = useState(30);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    listDueItems({ within })
      .then((all) => active && setRows(all.filter((d) => d.project_id === projectId)))
      .catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, [within, projectId, version]);
  return (
    <Card title="Upcoming expiries & renewals" actions={
      <div className="flex flex-wrap gap-1" role="group" aria-label="Window">
        {DUE_WINDOWS.map((d) => (
          <Button key={d} size="sm" variant={d === within ? "blue" : "secondary"} aria-pressed={d === within} onClick={() => setWithin(d)}>{d} days</Button>
        ))}
      </div>
    }>
      {error && <Banner tone="danger">{error}</Banner>}
      {!rows ? <p className="text-sm text-[#676b7a]">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-[#676b7a]">Nothing expires or renews in the next {within} days (and nothing is overdue).</p>
      ) : (
        <ul className="divide-y divide-[#eef0f4]">
          {rows.map((d) => {
            const n = daysUntil(d.due_date);
            return (
              <li key={`${d.source_table}-${d.record_id}-${d.kind}-${d.due_date}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span><Badge value="info" tone="info" label={labelOf(DUE_KINDS, d.kind)} /> <span className="ml-1 font-medium">{d.label}</span>{d.auto_renew ? <span className="ml-1 text-xs text-[#676b7a]">(auto-renew)</span> : null}</span>
                <span className={n < 0 ? "font-semibold text-red-700" : n <= 15 ? "font-semibold text-amber-800" : "text-[#676b7a]"}>
                  {formatDate(d.due_date)} · {n < 0 ? `overdue ${-n} days` : relativeDays(d.due_date)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default function AmcTab() {
  const { project, readOnly, reloadProject } = useProject();
  const { canEdit } = useRole();
  const toast = useToast();
  const [completing, setCompleting] = useState(null);
  const [renewing, setRenewing] = useState(null);
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const bump = useCallback(async () => { setVersion((n) => n + 1); await reloadProject(); }, [reloadProject]);

  async function setApplicable(on) {
    setSaving(true);
    try {
      await updateRecord("pt_projects", project.id, { amc_applicable: on }, project.updated_at);
      toast.push(on ? "AMC marked applicable." : "AMC marked not applicable.");
      await reloadProject();
    } catch (e) {
      toast.push(e.message, "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card title="AMC applicability">
        <Checkbox label="This project has (or should have) an Annual Maintenance Contract" checked={project.amc_applicable}
          disabled={!canEdit || readOnly || saving} onChange={setApplicable}
          help="When not applicable, AMC is left out of the documentation completeness score. Independent renewals (hosting, domain, SSL, email, subscriptions) are tracked either way." />
      </Card>
      <UpcomingCard projectId={project.id} version={version} />
      <RecordSection key={`amc-${version}`} sectionKey="amc" onChanged={bump}
        description={project.amc_applicable ? "Contract history is kept: renewing creates a new contract linked to the previous one." : "AMC is marked not applicable for this project."}
        rowActions={(r) => [{
          key: "renew", label: "Renew", icon: RefreshCw, hidden: !canEdit || readOnly || !!r.archived_at || !["active", "expired"].includes(r.status),
          onClick: () => setRenewing(r),
        }]} />
      <RecordSection key={`ren-${version}`} sectionKey="renewals" onChanged={bump}
        description="Independent renewals: hosting, domain, SSL, email services, AMC and other subscriptions. Complete a renewal to record evidence and keep its history."
        canEditRow={(r) => r.status !== "completed"}
        rowActions={(r) => [{
          key: "complete", label: "Complete", icon: CircleCheck, hidden: !canEdit || readOnly || !!r.archived_at || r.status !== "upcoming",
          onClick: () => setCompleting(r),
        }]} />
      {completing && <CompleteRenewalModal renewal={completing} onClose={() => setCompleting(null)} onDone={bump} />}
      {renewing && <RenewAmcModal contract={renewing} onClose={() => setRenewing(null)} onDone={bump} />}
    </div>
  );
}
