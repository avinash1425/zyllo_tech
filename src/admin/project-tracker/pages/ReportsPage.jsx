import { useRef, useState } from "react";
import useLoad from "../useLoad";
import { useSearchParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { ChartColumn, FileSpreadsheet, FileText, Printer } from "lucide-react";
import PageHeader from "../../PageHeader";
import { REPORTS } from "../reports";
import { Banner, Button, Card, DataTable, Select, Spinner, useToast } from "../ui";
import { renderValue } from "../cells";
import { exportCSV, exportXLSX, printElement } from "../export";
import { DUE_WINDOWS } from "../lib/options";
import { formatDateTime } from "../lib/format";
import { listCompanyOptions, listProjects } from "@/lib/api/admin/projectTracker";

function ProjectPicker() {
  const navigate = useNavigate();
  const [id, setId] = useState("");
  const { data, error } = useLoad(() => listProjects({ pageSize: 100, sort: "name", dir: "asc", includeArchived: true }), []);
  const projects = data ? data.rows : error ? [] : null;
  if (!projects) return <Spinner />;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="sm:w-96">
        <Select label="Project" value={id} onChange={setId} options={projects.map((p) => ({ value: p.id, label: `${p.project_code} · ${p.name}` }))} />
      </div>
      <Button variant="primary" icon={FileText} disabled={!id} onClick={() => navigate(`/admin/project-tracker/projects/${id}/report`)}>Open report</Button>
    </div>
  );
}

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const key = REPORTS.some((r) => r.key === params.get("r")) ? params.get("r") : REPORTS[1].key;
  const report = REPORTS.find((r) => r.key === key);
  const [within, setWithin] = useState(30);
  const [companyId, setCompanyId] = useState("");
  const { data: companies } = useLoad(() => listCompanyOptions(), []);
  const companyName = (companies || []).find((c) => c.id === companyId)?.company_name;
  const [busy, setBusy] = useState("");
  const printRef = useRef(null);
  const { data, error: loadError, loading } = useLoad(async () => {
    if (report.perProject) return null;
    return { rows: await report.load({ within, companyId: companyId || null }), at: new Date().toISOString() };
  }, [key, within, companyId]);
  const rows = loading ? null : data?.rows || (loadError ? [] : null);
  const generatedAt = data?.at;
  const error = loadError?.message || "";

  const title = `${report.title}${report.windowed ? ` (${within} days)` : ""}${companyName ? ` — ${companyName}` : ""}`;
  const columns = (report.columns || []).map((c) => ({ ...c, sortable: false, render: (r) => renderValue(c, r) }));

  async function run(kind) {
    setBusy(kind);
    try {
      if (kind === "csv") exportCSV(title, { columns: report.columns, rows });
      if (kind === "xlsx") await exportXLSX(title, [{ name: report.title.slice(0, 31), columns: report.columns, rows }]);
      if (kind === "pdf") printElement(printRef.current, title);
    } catch (e) {
      toast.push(e.message || "Export failed.", "danger");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" icon={ChartColumn} subtitle="Registers and status reports across all projects. Exports never include passwords, keys, tokens, recovery codes or credential references." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
        <nav aria-label="Reports" className="lg:col-span-1">
          <ul className="space-y-1">
            {REPORTS.map((r) => (
              <li key={r.key}>
                <button type="button" onClick={() => setParams({ r: r.key })} aria-current={r.key === key ? "page" : undefined}
                  className={`w-full rounded-xl px-3 py-2 text-left text-sm transition-colors ${r.key === key ? "bg-[#101a3a] font-semibold text-white" : "text-[#2b303b] hover:bg-white"}`}>
                  {r.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 lg:col-span-3">
          <Card title={report.title} actions={!report.perProject && <>
            <label className="flex items-center gap-2 text-xs font-medium text-[#676b7a]">Company
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} aria-label="Company"
                className="h-8 max-w-[14rem] rounded-lg border border-[#e7e9ee] bg-white px-2 text-sm">
                <option value="">All companies</option>
                {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </label>
            {report.windowed && (
              <label className="flex items-center gap-2 text-xs font-medium text-[#676b7a]">Window
                <select value={within} onChange={(e) => setWithin(Number(e.target.value))} className="h-8 rounded-lg border border-[#e7e9ee] bg-white px-2 text-sm">
                  {DUE_WINDOWS.map((d) => <option key={d} value={d}>{d} days</option>)}
                </select>
              </label>
            )}
            <Button size="sm" icon={FileText} busy={busy === "csv"} disabled={!rows} onClick={() => run("csv")}>CSV</Button>
            <Button size="sm" icon={FileSpreadsheet} busy={busy === "xlsx"} disabled={!rows} onClick={() => run("xlsx")}>Excel</Button>
            <Button size="sm" icon={Printer} disabled={!rows} onClick={() => run("pdf")}>Print / PDF</Button>
          </>}>
            <p className="mb-3 text-sm text-[#676b7a]">{report.description}</p>
            {report.perProject ? <ProjectPicker /> : (
              <>
                {error && <Banner tone="danger" className="mb-3">{error}</Banner>}
                {!rows ? <Spinner label="Building report…" /> : (
                  <div ref={printRef}>
                    <h1 className="sr-only">{title}</h1>
                    <p className="meta mb-2 text-xs text-[#8a8f9c]">Zyllo Tech · Project Tracker · generated {formatDateTime(generatedAt)} · {rows.length} row{rows.length === 1 ? "" : "s"}</p>
                    <DataTable caption={title} columns={columns} rows={rows} rowKey={(r) => `${r.id || r.record_id}-${r.kind || ""}-${r.due_date || ""}`} empty="No records for this report." />
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
