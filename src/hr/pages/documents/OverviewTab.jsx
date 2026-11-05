// Documents overview: counts from real rows (hr_documents_overview), scoped
// by the caller's read rules and the filters.
import { useState } from "react";
import { AlarmClock, BadgeCheck, CalendarX2, FileStack, FileWarning, Hourglass, ListChecks, RotateCcw } from "lucide-react";
import { formatDateTime, useHrQuery } from "@/lib/hr/client";
import { documentsOverview, groupLabel } from "@/lib/hr/documentCenter";
import { Card, EmptyState, ErrorState, KpiCard, StatusBadge } from "@/hr/ui";
import DocumentFilters, { EMPTY_FILTERS } from "./DocumentFilters";

export default function OverviewTab({ employees, categories, onNavigate, canManage }) {
  const [f, setF] = useState(EMPTY_FILTERS);
  const q = useHrQuery(() => documentsOverview({ ...f, archived: false }), [JSON.stringify(f)]);
  const d = q.data;
  const kpi = (label, key, icon, tone, tab, hint) => (
    <KpiCard label={label} value={d?.[key]} icon={icon} tone={tone} loading={q.loading && !d} hint={hint}
      onClick={tab && onNavigate ? () => onNavigate(tab) : undefined} />
  );
  return (
    <>
      <DocumentFilters value={f} onChange={setF} employees={employees} categories={categories} hide={["archived"]} />
      {q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kpi("Total documents", "total", FileStack, "navy", "directory")}
            {kpi("Pending verification", "pending_verification", Hourglass, "orange", canManage ? "verification" : "directory", d?.awaiting_file ? `${d.awaiting_file} awaiting file upload` : undefined)}
            {kpi("Expiring soon", "expiring_soon", AlarmClock, "teal", "expiry", d ? `within ${d.expiring_soon_days} days` : undefined)}
            {kpi("Expired", "expired", CalendarX2, "red", "expiry")}
            {kpi("Pending acknowledgements", "pending_acknowledgements", ListChecks, "slate", d?.pending_acknowledgements == null ? undefined : "acknowledgements", d && d.pending_acknowledgements == null ? "HR only" : "policies + documents")}
            {kpi("Rejected", "rejected", FileWarning, "red", "directory")}
            {kpi("Contract renewals due", "renewals_due", RotateCcw, "teal", "contracts", "renewal date within 30 days")}
            {kpi("Verified", "verified", BadgeCheck, "green", "directory")}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card title="Recently uploaded">
                {!d?.recently_uploaded?.length ? <EmptyState title="Nothing uploaded yet" /> : (
                  <ul className="divide-y divide-slate-100">
                    {d.recently_uploaded.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-[#101a3a]">{r.title} <span className="text-xs font-normal text-slate-500">v{r.current_version}</span></span>
                          <span className="block text-xs text-slate-500">{r.employee_name} ({r.employee_code}) · {r.category_name} · {formatDateTime(r.last_uploaded_at)}</span>
                        </span>
                        <StatusBadge status={r.verification_status} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
            <Card title="By document type">
              {!d || !Object.keys(d.by_group ?? {}).length ? <EmptyState title="No documents" /> : (
                <ul className="flex flex-col gap-2">
                  {Object.entries(d.by_group).sort((a, b) => b[1] - a[1]).map(([g, n]) => (
                    <li key={g} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-slate-700">{groupLabel(g)}</span>
                      <span className="font-bold text-[#101a3a]">{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
