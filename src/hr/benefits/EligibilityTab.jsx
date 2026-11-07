// Eligibility rules per plan (employment types, minimum service, grades,
// locations, probation) and an employee eligibility checker that asks the
// server (hr_benefit_eligibility — the same rule the enroll RPC applies).
import { useState } from "react";
import { Pencil } from "lucide-react";
import { useHrQuery } from "@/lib/hr/client";
import { benefitEligibility, eligibilitySummary, listBenefitCategories, listBenefitPlans } from "@/lib/hr/benefits";
import { Badge, Button, Card, DataTable, Field, Input, Select, useToast } from "@/hr/ui";
import { PlanFormModal } from "./PlansTab";
import { today } from "./shared";

function Checker({ employees }) {
  const [employee, setEmployee] = useState("");
  const [on, setOn] = useState(today());
  const q = useHrQuery(() => (employee ? benefitEligibility(employee, on) : Promise.resolve({ data: null })), [employee, on]);
  return (
    <Card title="Check an employee" className="mt-4">
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Employee"><Select placeholder="Choose an employee" value={employee} onChange={(e) => setEmployee(e.target.value)} options={employees ?? []} /></Field>
        <Field label="As of (start date)"><Input type="date" value={on} onChange={(e) => setOn(e.target.value || today())} /></Field>
      </div>
      {employee && (
        <DataTable caption="Eligibility result" rows={q.data} loading={q.loading} error={q.error} onRetry={q.reload} rowKey="benefit_type_id" pageSize={50}
          emptyTitle="No active plans"
          columns={[
            { key: "name", header: "Plan", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "eligible", header: "Result", render: (r) => (r.enrolled ? <Badge tone="blue">enrolled</Badge> : r.eligible ? <Badge tone="green">eligible</Badge> : <Badge tone="red">not eligible</Badge>) },
            { key: "reason", header: "Reason", render: (r) => r.reason ?? "—" },
          ]} />
      )}
    </Card>
  );
}

export default function EligibilityTab({ canManage, org, employees }) {
  const { notify } = useToast();
  const list = useHrQuery(() => listBenefitPlans(), []);
  const cats = useHrQuery(() => listBenefitCategories(), []);
  const [edit, setEdit] = useState(null);
  const lookups = { grades: org?.grades ?? [], locations: org?.locations ?? [], employmentTypes: org?.employmentTypes ?? [] };
  return (
    <>
      <DataTable caption="Eligibility rules" rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload} emptyTitle="No plans yet"
        columns={[
          { key: "name", header: "Plan", sortable: true, render: (r) => <div><p className="font-medium text-[#101a3a]">{r.name}</p>{!r.active && <Badge>inactive</Badge>}</div> },
          { key: "rules", header: "Who is eligible", render: (r) => <p className="max-w-lg text-sm">{eligibilitySummary(r, lookups)}</p> },
          { key: "self_enrollment", header: "Self-enrollment", render: (r) => (r.self_enrollment ? "Employees may request" : "HR enrolls") },
          ...(canManage ? [{ key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => <Button size="sm" variant="ghost" onClick={() => setEdit(r)}><Pencil className="h-4 w-4" aria-hidden="true" />Edit rules</Button> }] : []),
        ]} />
      <Checker employees={employees} />
      {edit && <PlanFormModal plan={edit} section="eligibility" categories={cats.data} org={org} onClose={() => setEdit(null)}
        onSaved={() => { setEdit(null); notify("Eligibility rules saved."); list.reload(); }} />}
    </>
  );
}
