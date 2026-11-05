// Salary components (payroll.view to see, payroll.manage to edit,
// payroll.approve to verify). Statutory components are skipped by the
// payroll calculator until verified. No statutory rates are built in.
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDateTime } from "@/lib/hr/client";
import { CALC_TYPES, COMPONENT_CATEGORIES, COMPONENT_KINDS, COMPONENT_TYPES, TAX_TREATMENTS, verifyComponent } from "@/lib/hr/payroll";
import { Badge, Button, Card, ConfirmDialog, useToast } from "@/hr/ui";
import MasterDataEditor from "@/hr/components/MasterDataEditor";

const label = (s) => s.replace(/_/g, " ");

export function StatutoryWarning() {
  return (
    <div role="note" className="mb-4 flex gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <p>
        <strong>Statutory deductions and contributions are not built in.</strong> Provident fund, state insurance, professional tax and income-tax
        withholding are configured as <strong>statutory rules</strong> (Payroll → Statutory) and applied only after a qualified payroll / tax professional's
        validation is recorded. Unverified statutory components are skipped by the calculator and listed on each payroll item.
      </p>
    </div>
  );
}

export default function SalaryComponentsSettings({ canEdit }) {
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const canVerify = hasPermission("payroll.approve");
  const [version, setVersion] = useState(0);
  const [verifying, setVerifying] = useState(null);

  const config = {
    table: "hr_salary_components", title: "Salary components", singular: "salary component", orderBy: "sort_order",
    // Alias so the edit form is pre-filled (the shared editor has no load hook); transform accepts array or text.
    select: "*, eligible_employment_types_text:eligible_employment_types",
    description: "Allowances, deductions and employer contributions. Amounts and percentages are set per employee salary structure (fixed components) or entered per payroll run as adjustments (variable components); the default value is used when a structure leaves the percentage blank.",
    columns: [
      { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs font-bold text-[#1f4693]">{r.code}</span> },
      { key: "name", header: "Name" },
      { key: "kind", header: "Kind", render: (r) => <span className="flex flex-col gap-0.5"><Badge tone={r.kind === "earning" ? "green" : r.kind === "deduction" ? "red" : "violet"}>{label(r.kind)}</Badge><span className="text-[11px] text-slate-500">{r.component_type} · {label(r.category ?? "")}</span></span> },
      { key: "calc_type", header: "Calculation", render: (r) => `${label(r.calc_type)}${r.default_value != null ? ` (default ${Number(r.default_value)})` : ""}` },
      { key: "tax_treatment", header: "Tax treatment", render: (r) => <Badge tone={r.tax_treatment === "not_configured" ? "amber" : "slate"}>{label(r.tax_treatment ?? "not_configured")}</Badge> },
      { key: "eligibility", header: "Eligibility / dates", render: (r) => <span className="text-xs">{r.eligible_employment_types?.length ? r.eligible_employment_types.join(", ") : "all"}{r.effective_from || r.effective_to ? ` · ${r.effective_from ?? "…"} → ${r.effective_to ?? "open"}` : ""}{r.requires_approval ? " · needs approval" : ""}</span> },
      { key: "verification", header: "Verification", render: (r) => (r.requires_verification
        ? <Badge tone="amber">{r.is_statutory ? "statutory · unverified" : "needs verification"}</Badge>
        : r.verified_at ? <span title={formatDateTime(r.verified_at)}><Badge tone="green">verified</Badge></span> : <Badge>not required</Badge>) },
      ...(canVerify ? [{ key: "_verify", header: <span className="sr-only">Verify</span>, render: (r) => r.requires_verification && (
        <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setVerifying(r); }}>Verify</Button>) }] : []),
    ],
    fields: [
      { key: "code", label: "Code", required: true, createOnly: true, uppercase: true, pattern: "^[A-Za-z][A-Za-z0-9_]{1,29}$", patternMessage: "2–30 letters, digits or _; starts with a letter." },
      { key: "name", label: "Name", required: true, pattern: "^.{2,120}$", patternMessage: "2–120 characters." },
      { key: "kind", label: "Kind", type: "select", required: true, placeholder: undefined, options: COMPONENT_KINDS.map((k) => ({ value: k, label: label(k) })) },
      { key: "calc_type", label: "Calculation", type: "select", required: true, placeholder: undefined, options: CALC_TYPES.map((k) => ({ value: k, label: label(k) })) },
      { key: "default_value", label: "Default value", type: "number", min: 0, max: 100000000, step: 0.0001, hint: "Percent for percentage types; otherwise optional." },
      { key: "component_type", label: "Fixed or variable", type: "select", required: true, placeholder: undefined, options: COMPONENT_TYPES.map((k) => ({ value: k, label: k })), hint: "Variable components are entered per payroll run." },
      { key: "category", label: "Category", type: "select", required: true, placeholder: undefined, options: COMPONENT_CATEGORIES.map((k) => ({ value: k, label: label(k) })) },
      { key: "tax_treatment", label: "Tax treatment", type: "select", required: true, placeholder: undefined, options: TAX_TREATMENTS.map((k) => ({ value: k, label: label(k) })), hint: "Leave 'not configured' until confirmed by a tax professional." },
      { key: "tax_note", label: "Tax treatment note / reference", type: "textarea", wide: true },
      { key: "eligible_employment_types_text", label: "Eligible employment types", hint: "Comma-separated codes (e.g. full_time, intern). Blank = everyone." },
      { key: "effective_from", label: "Effective from", type: "date" },
      { key: "effective_to", label: "Effective to", type: "date" },
      { key: "sort_order", label: "Sort order", type: "number", min: 0, max: 1000, required: true },
      { key: "requires_approval", label: "Each payroll entry needs approval by a second payroll user (bonuses, incentives, recoveries, advances)", type: "checkbox" },
      { key: "is_statutory", label: "Statutory component (requires professional verification before use)", type: "checkbox" },
      { key: "statutory_note", label: "Statutory note / legal reference", type: "textarea", wide: true },
      { key: "calculation_note", label: "Calculation method note", type: "textarea", wide: true },
    ],
    defaults: { kind: "earning", calc_type: "fixed", component_type: "fixed", category: "allowance", tax_treatment: "not_configured", sort_order: 10 },
    validate: (v) => (v.effective_from && v.effective_to && v.effective_to < v.effective_from ? { effective_to: "Must be on or after the start date." } : null),
    transform: (v) => {
      const { eligible_employment_types_text: types, ...rest } = v;
      const list = (Array.isArray(types) ? types : String(types ?? "").split(",")).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
      return { ...rest, eligible_employment_types: list.length ? list : null, requires_approval: Boolean(v.requires_approval), is_statutory: Boolean(v.is_statutory) };
    },
  };

  return (
    <Card>
      <StatutoryWarning />
      <p className="mb-3 text-xs text-slate-500">Changing the calculation, default value or kind of a verified statutory component automatically voids its verification.</p>
      <MasterDataEditor key={version} config={config} canEdit={canEdit} />
      <ConfirmDialog open={Boolean(verifying)} onClose={() => setVerifying(null)} title={`Verify ${verifying?.code ?? ""}?`} confirmLabel="Mark verified"
        message="Confirm that a qualified payroll / tax professional has checked this component's calculation and rates. Once verified, the payroll calculator will apply it."
        requireReason={false} reasonLabel="Verification note (who verified, reference)"
        onConfirm={async (note) => {
          const res = await verifyComponent(verifying.id, note);
          if (res.error) return { error: res.error };
          notify(`${verifying.code} marked as verified.`); setVersion((x) => x + 1);
          return {};
        }} />
    </Card>
  );
}
