// Performance & KPI (HR Operations, /hr/performance). Migrations 106 + 206.
// HR Admin (performance.manage / performance.view): every employee; cycles,
// KPI templates, calibration and finalization. Manager / Team Lead
// (performance.review_team / view_team): their reporting line only — goals,
// manager assessments, meetings and improvement plans. RLS and the RPCs
// enforce the same scoping on the server; nobody acts on their own review.
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/hr/platform/auth";
import { useHrQuery } from "@/lib/hr/client";
import { inReportingLine, listCycles, listPerfEmployees } from "@/lib/hr/performance";
import { InlineError, PageHeader, Tabs } from "@/hr/ui";
import { empText } from "@/hr/performance/shared";
import DashboardTab from "@/hr/performance/DashboardTab";
import CyclesTab from "@/hr/performance/CyclesTab";
import KpisTab from "@/hr/performance/KpisTab";
import GoalsTab from "@/hr/performance/GoalsTab";
import ReviewsTab from "@/hr/performance/ReviewsTab";
import MeetingsTab from "@/hr/performance/MeetingsTab";
import PlansTab from "@/hr/performance/PlansTab";
import HistoryTab from "@/hr/performance/HistoryTab";
import ReportsTab from "@/hr/performance/ReportsTab";

const TABS = [
  { value: "dashboard", label: "Dashboard" },
  { value: "cycles", label: "Review cycles" },
  { value: "kpis", label: "KPI templates" },
  { value: "goals", label: "Goals" },
  { value: "reviews", label: "Reviews" },
  { value: "meetings", label: "Review meetings" },
  { value: "plans", label: "Improvement plans" },
  { value: "history", label: "History" },
  { value: "reports", label: "Reports" },
];

export default function PerformancePage() {
  const { hasPermission, hr } = useAuth();
  const me = hr?.employee?.id ?? null;
  const canManage = hasPermission("performance.manage");
  const canViewAll = canManage || hasPermission("performance.view");
  const canReviewTeam = hasPermission("performance.review_team");
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get("tab")) ? params.get("tab") : "dashboard";
  const setTab = (t, extra) => setParams((p) => {
    const n = new URLSearchParams(p); n.set("tab", t);
    for (const [k, v] of Object.entries(extra ?? {})) { if (v) n.set(k, v); else n.delete(k); }
    return n;
  }, { replace: true });

  const employees = useHrQuery(listPerfEmployees, []);
  const cycles = useHrQuery(listCycles, []);

  const isInMyLine = useCallback((id) => inReportingLine(employees.data, me, id), [employees.data, me]);
  // Employees the caller may set goals for / assess (mirrors hr_private.can_manage_performance_of).
  const canManageEmployee = useCallback((id) => Boolean(id) && id !== me && (canManage || (canReviewTeam && isInMyLine(id))), [me, canManage, canReviewTeam, isInMyLine]);
  const ctx = useMemo(() => {
    const scoped = (employees.data ?? []).filter((e) => e.id !== me && (canViewAll || isInMyLine(e.id)));
    return {
      me, canManage, canViewAll, canReviewTeam, isInMyLine, canManageEmployee,
      employees: employees.data ?? [],
      // Pickers: everyone in scope except the caller (nobody manages their own performance).
      employeeOptions: scoped.map((e) => ({ value: e.id, label: empText(e) })),
      manageableOptions: scoped.filter((e) => canManageEmployee(e.id)).map((e) => ({ value: e.id, label: empText(e) })),
      cycles: cycles.data ?? [], reloadCycles: cycles.reload, cyclesLoading: cycles.loading, cyclesError: cycles.error,
      openTab: setTab,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees.data, cycles.data, cycles.loading, cycles.error, me, canManage, canViewAll, canReviewTeam, isInMyLine, canManageEmployee]);

  return (
    <>
      <PageHeader title="Performance & KPI"
        description={canViewAll
          ? "Review cycles, KPI templates, goals, assessments, calibration, review meetings and improvement plans for every employee."
          : "Goals, assessments, review meetings and improvement plans for your reporting line."} />
      <Tabs value={tab} onChange={(t) => setTab(t)} label="Performance sections" tabs={TABS} />
      {employees.error && <div className="mb-3"><InlineError message={`Employee list unavailable: ${employees.error}`} /></div>}
      {tab === "dashboard" && <DashboardTab ctx={ctx} />}
      {tab === "cycles" && <CyclesTab ctx={ctx} />}
      {tab === "kpis" && <KpisTab ctx={ctx} />}
      {tab === "goals" && <GoalsTab ctx={ctx} />}
      {tab === "reviews" && <ReviewsTab ctx={ctx} />}
      {tab === "meetings" && <MeetingsTab ctx={ctx} />}
      {tab === "plans" && <PlansTab ctx={ctx} />}
      {tab === "history" && <HistoryTab ctx={ctx} initialEmployee={params.get("employee") ?? ""} />}
      {tab === "reports" && <ReportsTab ctx={ctx} />}
    </>
  );
}
