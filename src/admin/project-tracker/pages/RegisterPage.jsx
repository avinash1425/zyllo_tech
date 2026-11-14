import { useMemo, useState } from "react";
import useLoad from "../useLoad";
import Link from "@/lib/nx/link";
import { AtSign, CalendarClock, DatabaseBackup, Handshake, Server } from "lucide-react";
import PageHeader from "../../PageHeader";
import { listAcrossProjects, listDueItems, listProjects } from "@/lib/api/admin/projectTracker";
import { supabase } from "@/lib/supabase/client";
import { Badge, Banner, Button, Card, DataTable, Spinner } from "../ui";
import { renderValue } from "../cells";
import { SECTIONS } from "../lib/sections";
import * as O from "../lib/options";
import { daysUntil, formatDate, formatDateTime, relativeDays } from "../lib/format";
import { tabForKind } from "./DashboardPage";
import { CompletenessPill } from "./ProjectsPage";

const projectCol = (tab) => ({
  key: "project", label: "Company / Project", sortable: false,
  render: (r) => (r.project ? (
    <div className="min-w-[10rem]">
      <span className="block text-xs text-[#676b7a]">{r.project.company_name || "Unassigned"}</span>
      <Link href={`/admin/project-tracker/projects/${r.project.id}?tab=${tab}`} className="font-medium text-[#1f4693] hover:underline">
        {r.project.name}<span className="ml-1 text-xs font-normal text-[#676b7a]">{r.project.project_code}</span>
      </Link>
    </div>
  ) : "—"),
});

function useSorted(rows, initial) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(() => {
    if (!rows || !sort) return rows || [];
    const d = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a[sort.key] ?? "";
      const y = b[sort.key] ?? "";
      if (x === y) return 0;
      if (x === "") return 1;
      if (y === "") return -1;
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true })) * d;
    });
  }, [rows, sort]);
  return { sorted, sort, onSort: (key) => setSort((s) => ({ key, dir: s?.key === key && s.dir === "asc" ? "desc" : "asc" })) };
}

/** One cross-project table: loads `table` across projects and renders the section's columns. */
function CrossTable({ title, table, sectionKey, tab, q, orderBy, ascending = true, extraCols = [], description }) {
  const { data, error: loadError, loading } = useLoad(() => listAcrossProjects(table, { q, orderBy, ascending }), [table, q, orderBy, ascending]);
  const rows = loading ? null : data || [];
  const error = loadError?.message || "";
  const { sorted, sort, onSort } = useSorted(rows, { key: orderBy, dir: ascending ? "asc" : "desc" });
  const columns = [projectCol(tab), ...SECTIONS[sectionKey].columns.map((c) => ({ ...c, render: (r) => renderValue(c, r) })), ...extraCols];
  return (
    <Card title={`${title}${rows ? ` (${rows.length})` : ""}`}>
      {description && <p className="mb-3 text-sm text-[#676b7a]">{description}</p>}
      {error && <Banner tone="danger" className="mb-3">{error}</Banner>}
      {!rows ? <Spinner /> : <DataTable caption={title} columns={columns} rows={sorted} sort={sort} onSort={onSort} empty={q ? "No matches." : "Nothing recorded yet."} />}
    </Card>
  );
}

function SearchBox({ value, onChange }) {
  const [draft, setDraft] = useState(value);
  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); onChange(draft); }} className="flex w-full gap-2 sm:w-auto">
      <label htmlFor="pt-reg-q" className="sr-only">Search</label>
      <input id="pt-reg-q" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search…"
        className="h-10 w-full rounded-lg border border-[#e7e9ee] bg-white px-3 text-sm outline-none focus:border-[#1f4693]/60 sm:w-64" />
      <Button type="submit" variant="blue">Search</Button>
    </form>
  );
}

function DueTable({ within, kinds }) {
  const { data, error: loadError, loading } = useLoad(() => listDueItems({ within }), [within]);
  const rows = loading ? null : (data || []).filter((d) => !kinds || kinds.includes(d.kind));
  const error = loadError?.message || "";
  const columns = [
    { key: "due_date", label: "Due", render: (d) => {
      const n = daysUntil(d.due_date);
      return <span className={n < 0 ? "font-semibold text-red-700" : n <= 15 ? "font-semibold text-amber-800" : ""}>{formatDate(d.due_date)}<span className="block text-xs">{n < 0 ? `overdue ${-n}d` : relativeDays(d.due_date)}</span></span>;
    } },
    { key: "kind", label: "Type", render: (d) => <Badge value="info" tone="info" label={O.labelOf(O.DUE_KINDS, d.kind)} /> },
    { key: "label", label: "Item" },
    { key: "project_code", label: "Project / Company", render: (d) => (
      <Link href={`/admin/project-tracker/projects/${d.project_id}?tab=${tabForKind(d.kind)}`} className="font-medium text-[#1f4693] hover:underline">
        {d.project_name}<span className="block text-xs font-normal text-[#676b7a]">{d.company_name || "Unassigned"} · {d.project_code}</span>
      </Link>
    ) },
    { key: "auto_renew", label: "Auto renew", render: (d) => (d.auto_renew ? "Yes" : "No") },
  ];
  const { sorted, sort, onSort } = useSorted(rows, { key: "due_date", dir: "asc" });
  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!rows) return <Spinner />;
  return <DataTable caption="Upcoming renewals" columns={columns} rows={sorted} sort={sort} onSort={onSort} rowKey={(d) => `${d.source_table}-${d.record_id}-${d.kind}-${d.due_date}`}
    empty={`Nothing due in the next ${within} days, and nothing overdue.`} />;
}

const HEAD = {
  hosting: { title: "Hosting & Domains", icon: Server, sub: "Hosting environments and domains of all active projects." },
  emails: { title: "Emails & Accounts", icon: AtSign, sub: "Mailboxes and access records of all active projects. Credential references are never shown here." },
  backups: { title: "Backups", icon: DatabaseBackup, sub: "Backup records and backup health of all active projects." },
  renewals: { title: "AMC & Renewals", icon: CalendarClock, sub: "Upcoming expiries and renewals, AMC contracts and the renewal history." },
  handover: { title: "Handover Records", icon: Handshake, sub: "Handover status of every active project." },
};

function HandoverRegister() {
  const { data, error: loadError } = useLoad(async () => {
    const [projects, hos] = await Promise.all([
      listProjects({ pageSize: 100, sort: "name", dir: "asc" }),
      supabase.from("pt_handovers").select("*").is("archived_at", null),
    ]);
    if (hos.error) throw new Error(hos.error.message);
    const byProject = new Map((hos.data || []).map((h) => [h.project_id, h]));
    return projects.rows.map((p) => ({ ...p, ho: byProject.get(p.id) || null }));
  }, []);
  const rows = data || (loadError ? [] : null);
  const error = loadError?.message || "";
  const columns = [
    { key: "project_code", label: "Project", render: (p) => (
      <Link href={`/admin/project-tracker/projects/${p.id}?tab=documents`} className="font-medium text-[#1f4693] hover:underline">
        {p.project_code}<span className="block text-xs font-normal text-[#676b7a]">{p.name}</span>
      </Link>) },
    { key: "status", label: "Project status", render: (p) => <Badge value={p.status} label={O.labelOf(O.PROJECT_STATUS, p.status)} /> },
    { key: "handover_state", label: "Handover section", render: (p) => <Badge value={p.handover_state} label={O.labelOf(O.SECTION_STATE, p.handover_state)} /> },
    { key: "ho_status", label: "Handover status", sortable: false, render: (p) => (p.ho ? <Badge value={p.ho.status} label={O.labelOf(O.HANDOVER_STATUS, p.ho.status)} /> : "Not started") },
    { key: "ho_recipient", label: "Recipient", sortable: false, render: (p) => p.ho?.recipient_name || "—" },
    { key: "ho_date", label: "Handover date", sortable: false, render: (p) => formatDate(p.ho?.handover_date) },
    { key: "ho_done", label: "Completed", sortable: false, render: (p) => (p.ho?.handed_over_at ? formatDateTime(p.ho.handed_over_at) : "—") },
    { key: "completeness_score", label: "Documentation", render: (p) => <CompletenessPill label={p.completeness_label} score={p.completeness_score} /> },
  ];
  const { sorted, sort, onSort } = useSorted(rows, { key: "handover_state", dir: "desc" });
  return (
    <Card title="Handover status by project">
      {error && <Banner tone="danger" className="mb-3">{error}</Banner>}
      {!rows ? <Spinner /> : <DataTable caption="Handover records" columns={columns} rows={sorted} sort={sort} onSort={onSort} empty="No active projects." />}
      <p className="mt-3 text-xs text-[#676b7a]">Showing the first 100 active projects alphabetically. Use All Projects → Attention → Pending handover for the full filtered list.</p>
    </Card>
  );
}

export default function RegisterPage({ kind }) {
  const head = HEAD[kind];
  const [search, setSearch] = useState({ kind, q: "" });
  const q = search.kind === kind ? search.q : "";
  const setQ = (value) => setSearch({ kind, q: value });
  const [within, setWithin] = useState(30);

  return (
    <div className="space-y-5">
      <PageHeader title={head.title} icon={head.icon} subtitle={head.sub} actions={kind !== "handover" && <SearchBox key={kind} value={q} onChange={setQ} />} />
      {kind === "hosting" && (
        <>
          <CrossTable title="Hosting environments" table="pt_hosting" sectionKey="hosting" tab="hosting" q={q} orderBy="renewal_date" />
          <CrossTable title="Domains & SSL" table="pt_domains" sectionKey="domains" tab="domains" q={q} orderBy="expires_on" />
        </>
      )}
      {kind === "emails" && (
        <>
          <CrossTable title="Email accounts" table="pt_email_accounts" sectionKey="emails" tab="emails" q={q} orderBy="email_address" />
          <CrossTable title="Access records" table="pt_access_records" sectionKey="access" tab="access" q={q} orderBy="service_name"
            description="Only a masked account name and whether a password-manager reference exists. Managers can view a reference from the project's Credentials & Access tab (each view is logged)." />
        </>
      )}
      {kind === "backups" && (
        <>
          <Banner tone="info">“Missing backups” = a Live / Maintenance / Completed project with no completed backup in 35 days. “Verification overdue” = no backup verified in 90 days.</Banner>
          <Card title="Projects needing backup attention">
            <div className="flex flex-wrap gap-2 text-sm">
              <Link className="rounded-lg border border-[#e7e9ee] px-3 py-2 font-semibold text-[#1f4693] hover:bg-[#fafbfc]" href="/admin/project-tracker/projects?flag=missing_backups">Missing backups →</Link>
              <Link className="rounded-lg border border-[#e7e9ee] px-3 py-2 font-semibold text-[#1f4693] hover:bg-[#fafbfc]" href="/admin/project-tracker/projects?flag=backup_verification_overdue">Verification overdue →</Link>
            </div>
          </Card>
          <CrossTable title="Backup records" table="pt_backups" sectionKey="backups" tab="backups" q={q} orderBy="backup_at" ascending={false} />
        </>
      )}
      {kind === "renewals" && (
        <>
          <Card title="Upcoming expiries & renewals" actions={
            <div className="flex flex-wrap gap-1" role="group" aria-label="Window">
              {O.DUE_WINDOWS.map((d) => <Button key={d} size="sm" variant={d === within ? "blue" : "secondary"} aria-pressed={d === within} onClick={() => setWithin(d)}>{d} days</Button>)}
            </div>
          }>
            <DueTable within={within} />
          </Card>
          <CrossTable title="AMC contracts" table="pt_amc_contracts" sectionKey="amc" tab="amc" q={q} orderBy="end_date" />
          <CrossTable title="Renewal records & history" table="pt_renewals" sectionKey="renewals" tab="amc" q={q} orderBy="due_date" />
        </>
      )}
      {kind === "handover" && <HandoverRegister />}
    </div>
  );
}
