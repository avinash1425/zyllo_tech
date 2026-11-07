// Training Management (HR): dashboard, assignments (enrollment + completion
// tracking), verification queue, sessions (schedule, enrollment, attendance),
// certificates (expiry + renewal), course catalogue, programs, trainers,
// categories and reports (CSV). Uses the training tables of 115 + 207; the
// onboarding "Link induction training" action creates ordinary assignments
// here (source "onboarding").
// training.manage: everything. training.assign_team (managers): assign,
// enroll, mark attendance, record / verify completion for the reporting
// line. training.view / view_team: read.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/hr/platform/auth";
import { useHrQuery } from "@/lib/hr/client";
import { listAssignments, listCourses, listPrograms, listTrainers, listTrainingCategories } from "@/lib/hr/training";
import { isPendingVerification } from "@/lib/hr/trainingRules";
import { useEmployeeOptions } from "@/lib/hr/org";
import { Card, InlineError, PageHeader, Tabs } from "@/hr/ui";
import AssignmentsTab, { AssignmentModalsHost } from "@/hr/training/AssignmentsTab";
import SessionsTab from "@/hr/training/SessionsTab";
import { CategoriesTab, CoursesTab, ProgramsTab, TrainersTab } from "@/hr/training/CatalogTabs";
import { CertificatesTab, DashboardTab, ReportsTab } from "@/hr/training/InsightsTabs";

const TABS = ["dashboard", "assignments", "verification", "sessions", "certificates", "courses", "programs", "trainers", "categories", "reports"];

export default function TrainingPage() {
  const { hasPermission, hr } = useAuth();
  const canManage = hasPermission("training.manage");
  const canAssign = canManage || hasPermission("training.assign_team");
  const canUpload = hasPermission("documents.manage");
  const myEmployeeId = hr?.employee?.id;
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get("tab")) ? params.get("tab") : "dashboard";
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; }, { replace: true });
  const [assignStatus, setAssignStatus] = useState(undefined);
  const [modal, setModal] = useState(null);

  const employees = useEmployeeOptions();
  const categories = useHrQuery(listTrainingCategories, []);
  const courses = useHrQuery(() => listCourses(), []);
  const programs = useHrQuery(listPrograms, []);
  const trainers = useHrQuery(listTrainers, []);
  // All RLS-visible assignments: dashboard, certificates and reports are computed from these.
  const all = useHrQuery(() => listAssignments({ status: "" }), []);
  const pending = (all.data ?? []).filter((a) => isPendingVerification(a) && a.employee_id !== myEmployeeId).length;

  const open = (t, status) => { if (t === "assignments") setAssignStatus(status ?? "open"); setTab(t); };
  const assign = (initial) => setModal({ type: "assign", initial });
  const reloadCatalog = () => { categories.reload(); courses.reload(); programs.reload(); trainers.reload(); };
  const shared = { canManage, canAssign, canUpload, myEmployeeId, courses: courses.data, programs: programs.data, employees: employees.data };

  return (
    <>
      <PageHeader title="Training" description="Courses, programs and sessions; who is assigned what, attendance, completion with verification, certificates and recertification." />
      <Tabs value={tab} onChange={setTab} label="Training sections" tabs={[
        { value: "dashboard", label: "Dashboard" },
        { value: "assignments", label: "Assignments" },
        { value: "verification", label: "Verification", count: all.data ? pending : undefined },
        { value: "sessions", label: "Sessions" },
        { value: "certificates", label: "Certificates" },
        { value: "courses", label: "Courses" },
        { value: "programs", label: "Programs" },
        { value: "trainers", label: "Trainers" },
        { value: "categories", label: "Categories" },
        { value: "reports", label: "Reports" },
      ]} />
      {employees.error && <div className="mb-3"><InlineError message={`Employee list unavailable: ${employees.error}`} /></div>}
      {tab === "dashboard" && <DashboardTab assignments={all} onOpen={open} />}
      {tab === "assignments" && <AssignmentsTab key={`a-${assignStatus ?? ""}`} mode="all" initialStatus={assignStatus} {...shared} onChanged={all.reload} />}
      {tab === "verification" && <AssignmentsTab key="verification" mode="verification" {...shared} onChanged={all.reload} />}
      {tab === "sessions" && <SessionsTab canManage={canManage} canAssign={canAssign} courses={courses.data} trainers={trainers.data} employees={employees.data} myEmployeeId={myEmployeeId} />}
      {tab === "certificates" && <CertificatesTab assignments={all} {...shared} />}
      {tab === "courses" && <CoursesTab courses={courses} categories={categories.data} trainers={trainers.data} canManage={canManage} canAssign={canAssign} onAssign={assign} reload={reloadCatalog} />}
      {tab === "programs" && <ProgramsTab programs={programs} categories={categories.data} courses={courses} canManage={canManage} canAssign={canAssign} onAssign={assign} reload={reloadCatalog} />}
      {tab === "trainers" && <TrainersTab trainers={trainers} employees={employees.data} canManage={canManage} reload={reloadCatalog} />}
      {tab === "categories" && <CategoriesTab categories={categories} courses={courses} canManage={canManage} reload={reloadCatalog} />}
      {tab === "reports" && <ReportsTab assignments={all} courses={courses.data} />}
      <AssignmentModalsHost modal={modal} setModal={setModal} done={() => { setModal(null); all.reload(); }} {...shared} />
      {!canManage && (
        <Card className="mt-4"><p className="text-sm text-slate-600">{canAssign
          ? "Manager view: you can assign, enroll, mark attendance and verify training for your reporting line. The catalogue and sessions are maintained by HR."
          : "Read-only view: you do not have training.manage or training.assign_team."}</p></Card>
      )}
    </>
  );
}
