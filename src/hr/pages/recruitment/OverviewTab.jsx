// Recruitment overview: KPIs from hr_recruitment_overview() (SECURITY
// INVOKER, so a hiring manager or assigned recruiter sees only their own
// openings) with job / department / recruiter / hiring manager / status /
// date filters, and a per-opening summary. No extra analytics.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Briefcase, CalendarDays, CheckCircle2, ClipboardCheck, FileSignature, Hourglass, ListChecks, UserCheck, Users } from "lucide-react";
import { useHrQuery } from "@/lib/hr/client";
import { toOptions } from "@/lib/hr/org";
import { listOpenings } from "@/lib/hr/recruitment";
import { OPENING_STATUS_LABELS, openingStatusLabel, recruitmentOverview } from "@/lib/hr/recruitmentHiring";
import { Button, DataTable, ErrorState, Field, Input, KpiCard, Select, StatusBadge, Toolbar } from "@/hr/ui";

const EMPTY = { opening: "", department: "", recruiter: "", hiringManager: "", status: "", from: "", to: "" };

export default function OverviewTab({ org, employees, base }) {
  const navigate = useNavigate();
  const [f, setF] = useState(EMPTY);
  const [dateError, setDateError] = useState(null);
  const openings = useHrQuery(() => listOpenings({}), []);
  const q = useHrQuery(() => recruitmentOverview(f), [f.opening, f.department, f.recruiter, f.hiringManager, f.status, f.from, f.to]);
  const set = (k) => (e) => {
    const next = { ...f, [k]: e.target.value };
    if (next.from && next.to && next.to < next.from) { setDateError("The end date is before the start date."); return; }
    setDateError(null);
    setF(next);
  };
  const d = q.data ?? {};
  const go = (path) => () => navigate(`${base}/${path}`);
  const kpis = [
    { label: "Open jobs", value: d.open_jobs, hint: d.open_vacancies != null ? `${d.open_vacancies} vacancies` : undefined, icon: Briefcase, tone: "navy", onClick: go("openings") },
    { label: "Applications", value: d.total_applications, icon: Users, tone: "teal", onClick: go("pipeline") },
    { label: "Under screening", value: d.under_screening, hint: d.on_hold ? `${d.on_hold} on hold` : undefined, icon: ListChecks, tone: "slate", onClick: go("pipeline") },
    { label: "Interviews scheduled", value: d.interviews_scheduled, icon: CalendarDays, tone: "orange", onClick: go("interviews") },
    { label: "Shortlisted", value: d.shortlisted, icon: ClipboardCheck, tone: "teal", onClick: go("pipeline") },
    ...(d.offers_pending !== null && d.offers_pending !== undefined ? [
      { label: "Offers pending", value: d.offers_pending, hint: "draft or issued", icon: Hourglass, tone: "orange", onClick: go("offers") },
      { label: "Offers accepted", value: d.offers_accepted, icon: FileSignature, tone: "green", onClick: go("offers") },
    ] : []),
    { label: "Hired", value: d.hired, icon: UserCheck, tone: "green", onClick: go("pipeline") },
  ];
  const columns = [
    { key: "title", header: "Opening", sortable: true, render: (r) => <span className="font-semibold text-[#101a3a]">{r.title}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "vacancies", header: "Vacancies", sortable: true },
    { key: "applications", header: "Applications", sortable: true },
    { key: "in_process", header: "In process", sortable: true },
    { key: "interviews_scheduled", header: "Interviews", sortable: true },
    { key: "hired", header: "Hired", sortable: true, render: (r) => `${r.hired}/${r.vacancies}` },
  ];
  const filtered = Object.values(f).some(Boolean);
  return (
    <>
      <Toolbar>
        <Select aria-label="Job" className="sm:w-56" placeholder="All jobs" value={f.opening} onChange={set("opening")}
          options={(openings.data ?? []).map((o) => ({ value: o.id, label: `${o.title} (${openingStatusLabel(o.status)})` }))} />
        <Select aria-label="Department" className="sm:w-44" placeholder="All departments" value={f.department} onChange={set("department")} options={toOptions(org?.departments, "name", "id", { activeOnly: false })} />
        <Select aria-label="Recruiter" className="sm:w-48" placeholder="Any recruiter" value={f.recruiter} onChange={set("recruiter")} options={employees ?? []} />
        <Select aria-label="Hiring manager" className="sm:w-48" placeholder="Any hiring manager" value={f.hiringManager} onChange={set("hiringManager")} options={employees ?? []} />
        <Select aria-label="Job status" className="sm:w-36" placeholder="Any status" value={f.status} onChange={set("status")} options={Object.entries(OPENING_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
        <Field label="From" className="sm:w-40"><Input type="date" value={f.from} onChange={set("from")} /></Field>
        <Field label="To" className="sm:w-40"><Input type="date" value={f.to} onChange={set("to")} /></Field>
        {filtered && <Button variant="ghost" onClick={() => { setF(EMPTY); setDateError(null); }}>Clear filters</Button>}
      </Toolbar>
      {dateError && <p className="mb-3 text-sm font-medium text-red-600" role="alert">{dateError}</p>}
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((k) => <KpiCard key={k.label} {...k} loading={q.loading && !q.data} />)}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {d.scope === "assigned" ? "Showing only the openings and candidates assigned to you. " : ""}
            The date filter applies to application dates, interview dates and offer dates.{d.offers_pending == null && q.data ? " Offer figures are visible to recruitment managers only." : ""}
          </p>
          <h2 className="mb-2 mt-6 flex items-center gap-2 text-sm font-bold text-[#101a3a]"><CheckCircle2 className="h-4 w-4 text-[#f96706]" aria-hidden="true" />By opening</h2>
          <DataTable caption="Recruitment by opening" columns={columns} rows={d.by_opening} loading={q.loading && !q.data} pageSize={10}
            emptyTitle="No openings match" emptyDescription={filtered ? "Clear the filters to see every opening." : "Create a job opening to start recruiting."} />
        </>
      )}
    </>
  );
}
