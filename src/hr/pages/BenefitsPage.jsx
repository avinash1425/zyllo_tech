// Benefits Management (HR): dashboard, categories, plans, eligibility rules,
// enrollments (+ self-enrollment requests and dependants), claims and
// reports. Requires benefits.view (read-only) or benefits.manage. Plans and
// categories are direct writes allowed by RLS for benefits.manage; every
// workflow step goes through SECURITY DEFINER RPCs (migrations 114 + 208).
// No payroll integration: approved claims never reach payroll.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/hr/platform/auth";
import { useEmployeeOptions, useOrg } from "@/lib/hr/org";
import { Card, InlineError, PageHeader, Tabs } from "@/hr/ui";
import OverviewTab from "@/hr/benefits/OverviewTab";
import CategoriesTab from "@/hr/benefits/CategoriesTab";
import PlansTab from "@/hr/benefits/PlansTab";
import EligibilityTab from "@/hr/benefits/EligibilityTab";
import EnrollmentsTab from "@/hr/benefits/EnrollmentsTab";
import ClaimsTab from "@/hr/benefits/ClaimsTab";
import ReportsTab from "@/hr/benefits/ReportsTab";

const TABS = [
  { value: "overview", label: "Dashboard" }, { value: "plans", label: "Benefit plans" }, { value: "categories", label: "Categories" },
  { value: "eligibility", label: "Eligibility rules" }, { value: "enrollments", label: "Enrollments" }, { value: "claims", label: "Claims" },
  { value: "reports", label: "Reports" },
];

export default function BenefitsPage() {
  const { hasPermission, hr } = useAuth();
  const canManage = hasPermission("benefits.manage");
  const myEmployeeId = hr?.employee?.id;
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get("tab")) ? params.get("tab") : "overview";
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; }, { replace: true });
  const employees = useEmployeeOptions();
  const org = useOrg();
  const [categoriesVersion, setCategoriesVersion] = useState(0);
  return (
    <>
      <PageHeader title="Benefits" description="Benefit plans, eligibility, employee enrollments and benefit claims. Claims are reviewed here and never paid through payroll." />
      <Tabs value={tab} onChange={setTab} label="Benefit sections" tabs={TABS} />
      {employees.error && <div className="mb-3"><InlineError message={`Employee list unavailable: ${employees.error}`} /></div>}
      {tab === "overview" && <OverviewTab onOpen={setTab} />}
      {tab === "plans" && <PlansTab canManage={canManage} org={org.data} categoriesVersion={categoriesVersion} />}
      {tab === "categories" && <CategoriesTab canManage={canManage} onChanged={() => setCategoriesVersion((n) => n + 1)} />}
      {tab === "eligibility" && <EligibilityTab canManage={canManage} org={org.data} employees={employees.data} />}
      {tab === "enrollments" && <EnrollmentsTab canManage={canManage} employees={employees.data} myEmployeeId={myEmployeeId} />}
      {tab === "claims" && <ClaimsTab canManage={canManage} employees={employees.data} myEmployeeId={myEmployeeId} />}
      {tab === "reports" && <ReportsTab />}
      {!canManage && <Card className="mt-4"><p className="text-sm text-slate-600">Read-only view: you do not have benefits.manage.</p></Card>}
    </>
  );
}
