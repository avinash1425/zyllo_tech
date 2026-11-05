// Resignations: employee-initiated exits by request status
// (Submitted → Under review → Approved / Rejected / Withdrawn). Review and
// decisions happen on the existing exit case page (/hr/exits/:id).
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDate, fullName, useHrQuery } from "@/lib/hr/client";
import { listExits } from "@/lib/hr/exits";
import { resignationStatus } from "@/lib/hr/lifecycle";
import { Badge, DataTable, SearchInput, Tabs, Toolbar } from "@/hr/ui";
import { RESIGNATION_STATUS_LABEL } from "./shared";

const TONE = { submitted: "amber", under_review: "blue", approved: "green", rejected: "red", withdrawn: "slate" };

export default function ResignationsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("under_review");
  const [search, setSearch] = useState("");
  const q = useHrQuery(() => listExits({ scope: "all", type: "resignation" }), []);
  const all = useMemo(() => (q.data ?? []).filter((x) => x.initiated_by === "employee"), [q.data]);
  const counts = useMemo(() => all.reduce((m, x) => { const s = resignationStatus(x); m[s] = (m[s] ?? 0) + 1; return m; }, {}), [all]);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return all.filter((x) => (tab === "all" || resignationStatus(x) === tab || (tab === "under_review" && resignationStatus(x) === "submitted"))
      && (!s || `${fullName(x.employee)} ${x.employee?.employee_code}`.toLowerCase().includes(s)));
  }, [all, tab, search]);
  return (
    <>
      <Toolbar>
        <Tabs value={tab} onChange={setTab} label="Resignation status" tabs={[
          { value: "under_review", label: "Submitted / under review", count: (counts.submitted ?? 0) + (counts.under_review ?? 0) },
          { value: "approved", label: "Approved", count: counts.approved ?? 0 },
          { value: "rejected", label: "Rejected", count: counts.rejected ?? 0 },
          { value: "withdrawn", label: "Withdrawn", count: counts.withdrawn ?? 0 },
          { value: "all", label: "All" },
        ]} />
        <div className="flex flex-1 sm:justify-end"><SearchInput value={search} onChange={setSearch} placeholder="Search employee…" /></div>
      </Toolbar>
      <DataTable caption="Resignations" rows={rows} loading={q.loading} error={q.error} onRetry={q.reload}
        emptyTitle="No resignations" emptyDescription="Employees submit resignations from the Employee Portal (My Resignation)."
        onRowClick={(x) => navigate(`/hr/exits/${x.id}`)}
        columns={[
          { key: "employee", header: "Employee", render: (x) => <div className="min-w-[9rem]"><p className="font-semibold text-[#101a3a]">{fullName(x.employee)}</p><p className="font-mono text-xs text-slate-500">{x.employee?.employee_code}</p></div> },
          { key: "resignation_date", header: "Submitted", sortable: true, render: (x) => formatDate(x.resignation_date ?? x.created_at) },
          { key: "notice", header: "Notice period", render: (x) => (x.notice_period_days != null ? `${x.notice_period_days} days` : "—") },
          { key: "proposed_last_working_day", header: "Proposed LWD", render: (x) => formatDate(x.proposed_last_working_day) },
          { key: "approved_last_working_day", header: "Approved LWD", render: (x) => formatDate(x.approved_last_working_day) },
          { key: "manager", header: "Manager", render: (x) => (x.manager_decision ? <Badge tone={x.manager_decision === "approved" ? "green" : "red"}>{x.manager_decision}</Badge> : x.status === "manager_review" ? <Badge tone="amber">pending</Badge> : "—") },
          { key: "status", header: "Request status", render: (x) => { const s = resignationStatus(x); return <Badge tone={TONE[s]}>{RESIGNATION_STATUS_LABEL[s] ?? s}</Badge>; } },
          { key: "stage", header: "Stage", render: (x) => <span className="text-xs capitalize text-slate-500">{String(x.status).replace(/_/g, " ")}</span> },
        ]} />
    </>
  );
}
