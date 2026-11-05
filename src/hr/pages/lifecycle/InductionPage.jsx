// Induction tracker: orientation, policy briefing, IT setup, equipment,
// security acknowledgement and induction sessions across open onboarding
// cases. Tasks are completed on the onboarding case (one source of truth).
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fullName, useHrQuery } from "@/lib/hr/client";
import { INDUCTION_CATEGORIES, TASK_CATEGORIES, listInductionTasks } from "@/lib/hr/lifecycle";
import { Badge, DataTable, SearchInput, Select, StatusBadge, Tabs, Toolbar } from "@/hr/ui";
import { DueDate, isOverdue } from "./shared";

const CATS = TASK_CATEGORIES.filter((c) => INDUCTION_CATEGORIES.includes(c.value));

export default function InductionPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("open");
  const [cat, setCat] = useState("");
  const [search, setSearch] = useState("");
  const q = useHrQuery(() => listInductionTasks({ status }), [status]);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((t) => (!cat || t.category === cat)
      && (status !== "overdue" || isOverdue(t.due_date, t.status))
      && (!s || `${fullName(t.case?.employee)} ${t.case?.employee?.employee_code} ${t.title}`.toLowerCase().includes(s)));
  }, [q.data, cat, search, status]);
  return (
    <>
      <Toolbar>
        <Tabs value={status} onChange={setStatus} label="Induction status" tabs={[{ value: "open", label: "Open" }, { value: "overdue", label: "Overdue" }, { value: "all", label: "All" }]} />
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:justify-end">
          <Select aria-label="Induction item" className="sm:w-56" placeholder="All induction items" value={cat} onChange={(e) => setCat(e.target.value)} options={CATS} />
          <SearchInput value={search} onChange={setSearch} placeholder="Search joiner or item…" />
        </div>
      </Toolbar>
      <DataTable caption="Induction items" rows={rows} loading={q.loading} error={q.error} onRetry={q.reload}
        emptyTitle={status === "overdue" ? "Nothing overdue" : "No induction items"} emptyDescription="Induction items come from onboarding checklists."
        onRowClick={(t) => navigate(`/hr/onboarding-exit/onboarding/${t.case_id}`)}
        columns={[
          { key: "employee", header: "Joiner", render: (t) => <div className="min-w-[9rem]"><p className="font-semibold text-[#101a3a]">{fullName(t.case?.employee)}</p><p className="font-mono text-xs text-slate-500">{t.case?.employee?.employee_code}</p></div> },
          { key: "title", header: "Item", render: (t) => <div className="min-w-[12rem]"><p className="font-medium">{t.title}</p><p className="text-xs text-slate-500">{CATS.find((c) => c.value === t.category)?.label}</p></div> },
          { key: "owner", header: "Responsible", render: (t) => (t.assignee ? fullName(t.assignee) : <span className="capitalize text-slate-500">{t.owner_role}</span>) },
          { key: "due_date", header: "Due", sortable: true, render: (t) => <DueDate value={t.due_date} status={t.status} /> },
          { key: "ack", header: "Acknowledgement", render: (t) => (t.task_kind !== "acknowledgement" ? <span className="text-slate-400">—</span> : t.acknowledged_at ? <Badge tone="green">Acknowledged</Badge> : <Badge tone="violet">Awaiting employee</Badge>) },
          { key: "status", header: "Status", render: (t) => <StatusBadge status={t.status} /> },
        ]} />
    </>
  );
}
