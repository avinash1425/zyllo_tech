// Clearance tracker across exits (HR, IT, assets, finance, handovers, payroll).
// Items are completed on the exit case (/hr/exits/:id) by their owners; the
// server blocks the leaver and anyone without the owner permission.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, fullName, useHrQuery } from "@/lib/hr/client";
import { CLEARANCE_LABELS, canActOnClearance } from "@/lib/hr/exits";
import { listClearanceExits } from "@/lib/hr/lifecycle";
import { Badge, DataTable, SearchInput, StatusBadge, Tabs, Toolbar } from "@/hr/ui";
import { Progress, isOverdue } from "./shared";

export default function ClearancePage() {
  const navigate = useNavigate();
  const { hasPermission, hr } = useAuth();
  const [scope, setScope] = useState("clearance");
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");
  const q = useHrQuery(() => listClearanceExits({ scope }), [scope]);
  const myItems = (x) => (x.items ?? []).filter((i) => i.status === "pending"
    && canActOnClearance(i.item_key, hasPermission, { isLeaver: x.employee_id === hr?.employee?.id, isLineManager: false, onlyOwner: true }));
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((x) => (!mine || myItems(x).length) && (!s || `${fullName(x.employee)} ${x.employee?.employee_code}`.toLowerCase().includes(s)));
  }, [q.data, search, mine]);
  return (
    <>
      <Toolbar>
        <Tabs value={scope} onChange={setScope} label="Clearance scope" tabs={[{ value: "clearance", label: "In clearance / settlement" }, { value: "closed", label: "Closed" }]} />
        <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#173a52]">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="h-4 w-4 rounded text-[#f96706]" />Only exits with items I own
        </label>
        <div className="flex flex-1 sm:justify-end"><SearchInput value={search} onChange={setSearch} placeholder="Search employee…" /></div>
      </Toolbar>
      <DataTable caption="Exit clearance" rows={rows} loading={q.loading} error={q.error} onRetry={q.reload}
        emptyTitle="No exits in clearance" onRowClick={(x) => navigate(`/hr/exits/${x.id}`)}
        columns={[
          { key: "employee", header: "Employee", render: (x) => <div className="min-w-[9rem]"><p className="font-semibold text-[#101a3a]">{fullName(x.employee)}</p><p className="font-mono text-xs text-slate-500">{x.employee?.employee_code}</p></div> },
          { key: "approved_last_working_day", header: "Last working day", sortable: true, render: (x) => formatDate(x.approved_last_working_day) },
          { key: "progress", header: "Clearance", render: (x) => { const it = x.items ?? []; const done = it.filter((i) => i.status !== "pending").length; return <Progress done={done} total={it.length} tone={done === it.length && it.length ? "green" : "orange"} />; } },
          { key: "pending", header: "Pending items", render: (x) => {
            const p = (x.items ?? []).filter((i) => i.status === "pending");
            if (!p.length) return <Badge tone="green">All cleared</Badge>;
            return <div className="flex max-w-[22rem] flex-wrap gap-1">{p.map((i) => <Badge key={i.id} tone={isOverdue(i.due_date, i.status) ? "red" : "amber"}>{CLEARANCE_LABELS[i.item_key] ?? i.item_key}{i.department ? ` · ${i.department}` : ""}</Badge>)}</div>;
          } },
          { key: "access", header: "Sign-in access", render: (x) => (
            x.access_revocation_status === "failed" ? <Badge tone="red"><KeyRound className="mr-1 h-3 w-3" aria-hidden="true" />Revocation failed</Badge>
              : x.access_revocation_status === "exception" ? <Badge tone="orange">Exception</Badge>
              : x.auth_access_revoked_at ? <Badge tone="green">Revoked</Badge>
              : x.access_revocation_status === "not_applicable" ? <Badge>No account</Badge> : <Badge tone="amber">Active</Badge>) },
          { key: "status", header: "Stage", render: (x) => <StatusBadge status={x.status} /> },
        ]} />
    </>
  );
}
