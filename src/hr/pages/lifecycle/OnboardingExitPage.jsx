// HRMS Module 4 — Onboarding & Employee Exit. Mounted at /hr/onboarding-exit/*.
// Sections are shown per permission; the server (RLS + RPCs) enforces access.
// Exit case details stay in the existing Exit Management page (/hr/exits/:id).
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarClock, ClipboardCheck, FileCheck2, GraduationCap, Hourglass, KeyRound, LogOut, Receipt, UserPlus, Wallet } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { useHrQuery } from "@/lib/hr/client";
import { lifecycleOverview } from "@/lib/hr/lifecycle";
import { Card, ErrorState, KpiCard, Loading, PageHeader } from "@/hr/ui";
import { SubNav } from "./shared";
import { CLEARANCE_PERMS, EXIT_PERMS, LIFECYCLE_PERMISSIONS, ONBOARDING_PERMS, PROBATION_PERMS, SETTLEMENT_PERMS } from "./permissions";

const OnboardingPages = lazy(() => import("./OnboardingPages.jsx"));
const DocumentVerificationPage = lazy(() => import("./DocumentVerificationPage.jsx"));
const InductionPage = lazy(() => import("./InductionPage.jsx"));
const ProbationPage = lazy(() => import("./ProbationPage.jsx"));
const ResignationsPage = lazy(() => import("./ResignationsPage.jsx"));
const ClearancePage = lazy(() => import("./ClearancePage.jsx"));
const SettlementPages = lazy(() => import("./SettlementPages.jsx"));

const ONB = ONBOARDING_PERMS;
const PROB = PROBATION_PERMS;
const EXIT = EXIT_PERMS;
const CLEAR = CLEARANCE_PERMS;
const PAY = SETTLEMENT_PERMS;

const BASE = "/hr/onboarding-exit";
export const SECTIONS = [
  { path: "", label: "Overview", any: LIFECYCLE_PERMISSIONS, end: true },
  { path: "onboarding", label: "Onboarding", any: ONB, page: OnboardingPages },
  { path: "documents", label: "Document Verification", all: [["onboarding.view", "onboarding.manage"], ["documents.view", "documents.manage"]], page: DocumentVerificationPage },
  { path: "induction", label: "Induction", any: ONB, page: InductionPage },
  { path: "probation", label: "Probation", any: PROB, page: ProbationPage },
  { path: "resignations", label: "Resignations", any: EXIT, page: ResignationsPage },
  { path: "clearance", label: "Clearance", any: CLEAR, page: ClearancePage },
  { path: "settlement", label: "Final Settlement", any: PAY, page: SettlementPages },
];

export function canSee(section, has) {
  if (section.all) return section.all.every((group) => group.some(has));
  return section.any.some(has);
}

function Overview() {
  const navigate = useNavigate();
  const q = useHrQuery(lifecycleOverview, []);
  const d = q.data ?? {};
  const go = (p) => () => navigate(`${BASE}/${p}`);
  const cards = [
    ["onboarding_open", "Open onboarding", UserPlus, "orange", "onboarding"],
    ["joining_next_7_days", "Joining in 7 days", CalendarClock, "teal", "onboarding"],
    ["onboarding_tasks_overdue", "Overdue checklist tasks", AlertTriangle, "red", "onboarding"],
    ["documents_pending_verification", "Documents to verify", FileCheck2, "navy", "documents"],
    ["induction_open", "Open induction items", GraduationCap, "teal", "induction"],
    ["probation_reviews_open", "Probation reviews open", Hourglass, "orange", "probation"],
    ["probation_reviews_overdue", "Probation reviews overdue", AlertTriangle, "red", "probation"],
    ["probation_ending_30_days", "Probation ending in 30 days", CalendarClock, "slate", "probation"],
    ["resignations_under_review", "Resignations under review", LogOut, "orange", "resignations"],
    ["exits_in_clearance", "Exits in clearance", ClipboardCheck, "navy", "clearance"],
    ["access_revocation_failed", "Access revocation failed", KeyRound, "red", "clearance"],
    ["settlements_to_prepare", "Settlements to prepare", Receipt, "teal", "settlement"],
    ["settlements_awaiting_approval", "Settlements awaiting approval", Wallet, "orange", "settlement"],
    ["settlements_awaiting_payment", "Settlements awaiting payment", Wallet, "green", "settlement"],
  ].filter(([k]) => k in d || q.loading);
  return (
    <>
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(([k, l, icon, tone, to]) => (
            <KpiCard key={k} label={l} value={d[k]} icon={icon} loading={q.loading && !q.data}
              tone={k === "access_revocation_failed" && !d[k] ? "slate" : tone} onClick={go(to)} />
          ))}
        </div>
      )}
      <Card className="mt-5" title="How the lifecycle works">
        <ol className="grid grid-cols-1 gap-3 text-sm text-slate-700 sm:grid-cols-2 xl:grid-cols-4">
          <li><strong className="text-[#101a3a]">1. Joining.</strong> Converting a candidate with an accepted offer opens the onboarding case and checklist automatically.</li>
          <li><strong className="text-[#101a3a]">2. Induction &amp; documents.</strong> Owners complete checklist tasks; documents are verified in the existing secure document store.</li>
          <li><strong className="text-[#101a3a]">3. Probation.</strong> Manager feedback, then an HR decision to confirm, extend or end — kept in sync with Employee Management.</li>
          <li><strong className="text-[#101a3a]">4. Exit.</strong> Resignation review, owner-based clearance, payroll-approved settlement and secure access revocation.</li>
        </ol>
      </Card>
    </>
  );
}

export default function OnboardingExitPage() {
  const { hasPermission } = useAuth();
  const visible = SECTIONS.filter((s) => canSee(s, hasPermission));
  return (
    <>
      <PageHeader title="Onboarding & Employee Exit" description="Joining checklists, document verification, induction, probation, resignations, clearance and full & final settlement." />
      <SubNav items={visible.map((s) => ({ to: s.path ? `${BASE}/${s.path}` : BASE, label: s.label, end: s.end }))} />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<Overview />} />
          {visible.filter((s) => s.page).map((s) => { const Page = s.page; return <Route key={s.path} path={`${s.path}/*`} element={<Page />} />; })}
          <Route path="*" element={<Navigate to={BASE} replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
