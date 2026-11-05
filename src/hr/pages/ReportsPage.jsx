// Module 12 — HR Reports & Analytics.
// * Category analytics (overview, headcount, attendance, leave, payroll, hiring,
//   attrition, performance) from public.hr_report_analytics(): cards, charts and
//   tables share ONE server dataset per section, so they cannot disagree.
// * "All reports": the existing 39 hr_report() templates plus Module 12
//   templates, server-paged through public.hr_report_page() with a status filter.
// * Exports (CSV / Excel / PDF) always go through public.hr_report_export(),
//   which enforces reports.export (+ payroll.export) on the server and audits
//   the download. Filters live in the URL so refresh / share keeps them.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3, Download, FileSpreadsheet, FileText, Info, RefreshCw, RotateCcw, Table2 } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, formatMoney, useHrQuery } from "@/lib/hr/client";
import { toOptions, useEmployeeOptions, useOrg } from "@/lib/hr/org";
import {
  CATEGORIES, RELATED_TEMPLATES, defaultFilters, describeFilters, filtersFromParams, filtersToParams, loadAnalytics, loadExport,
  loadReportPage, validateFilters,
} from "@/lib/hr/reports";
import { analyticsToDoc, downloadDoc, inferType, reportToDoc } from "@/lib/hr/reportExport";
import ReportChart, { formatValue } from "@/hr/components/ReportChart";
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Field, InlineError, Input, Loading, PageHeader, Select, Tabs, useToast } from "@/hr/ui";

// Categories follow the AIMS ERP reference; every template is computed on the
// server from data that exists in this HRMS. `needs` hides templates the
// caller cannot run (the server refuses them anyway).
const SENS = ["employees.view_sensitive"];
const IDENT = ["employees.view_identity"];
const ATT = ["attendance.view", "attendance.view_team"];
const LEAVE = ["leave.view", "leave.view_team", "leave.manage"];
export const REPORT_GROUPS = ["Workforce & headcount", "Diversity & demographics", "Organisation structure", "Deployment", "Compliance & documents",
  "Leave", "Attendance", "Daily work", "Payroll", "Recruitment", "Performance", "Exit management"];
export const REPORTS = [
  { key: "headcount", label: "Headcount by department & type", group: "Workforce & headcount" },
  { key: "workforce_by_company", label: "Headcount by company", group: "Workforce & headcount" },
  { key: "workforce_by_location", label: "Headcount by work location", group: "Workforce & headcount" },
  { key: "workforce_by_grade", label: "Headcount by grade / band", group: "Workforce & headcount" },
  { key: "employment_type_breakdown", label: "Employment type breakdown", group: "Workforce & headcount" },
  { key: "department_distribution", label: "Department distribution", group: "Workforce & headcount" },
  { key: "employee_status", label: "Employee status", group: "Workforce & headcount" },
  { key: "new_joiners", label: "New joiners (incl. later leavers)", group: "Workforce & headcount" },
  { key: "tenure_bands", label: "Employee tenure", group: "Workforce & headcount" },
  { key: "nationality_mix", label: "Nationality mix", group: "Diversity & demographics", needs: SENS },
  { key: "gender_mix", label: "Gender distribution", group: "Diversity & demographics", needs: SENS },
  { key: "age_bands", label: "Age bands", group: "Diversity & demographics", needs: SENS },
  { key: "org_units", label: "Organisation units", group: "Organisation structure" },
  { key: "reporting_lines", label: "Reporting lines", group: "Organisation structure" },
  { key: "deployment_summary", label: "Deployment by client", group: "Deployment" },
  { key: "deployment_roster", label: "Deployment roster", group: "Deployment" },
  { key: "data_completeness", label: "Employee data completeness", group: "Compliance & documents" },
  { key: "document_expiry", label: "Document expiry", group: "Compliance & documents" },
  { key: "identity_expiry", label: "Passport, visa & permit expiry (to end date)", group: "Compliance & documents", needs: IDENT },
  { key: "identity_compliance", label: "Identity compliance (country rules)", group: "Compliance & documents", needs: IDENT },
  { key: "contract_expiry", label: "Contract expiry", group: "Compliance & documents" },
  { key: "probation_due", label: "Probation reviews due", group: "Compliance & documents" },
  { key: "asset_assignment", label: "Asset assignment", group: "Compliance & documents" },
  { key: "leave_balances", label: "Leave balances (year of end date)", group: "Leave", needs: LEAVE },
  { key: "leave_history", label: "Leave history", group: "Leave", needs: LEAVE },
  { key: "upcoming_leave", label: "Upcoming leave (next 30 days)", group: "Leave", needs: LEAVE },
  { key: "attendance_employee", label: "Employee-wise attendance % (max 93 days)", group: "Attendance", needs: ATT },
  { key: "attendance_daily", label: "Daily attendance (max 93 days)", group: "Attendance", needs: ATT },
  { key: "attendance_regularizations", label: "Attendance regularizations", group: "Attendance", needs: ATT },
  { key: "attendance_summary", label: "Attendance summary (status counts)", group: "Attendance", needs: ATT },
  { key: "late_arrivals", label: "Late arrivals", group: "Attendance", needs: ATT },
  { key: "absence", label: "Absence report (max 93 days)", group: "Attendance", needs: ATT },
  { key: "daily_report_compliance", label: "Daily report compliance (max 93 days)", group: "Daily work", needs: ["daily_reports.view", "daily_reports.view_team"] },
  { key: "project_activity", label: "Project-wise employee activity", group: "Daily work" },
  { key: "payroll_summary", label: "Payroll summary (Final / Provisional)", group: "Payroll", needs: ["payroll.view"] },
  { key: "recruitment_pipeline", label: "Recruitment pipeline", group: "Recruitment", needs: ["recruitment.view", "recruitment.manage"] },
  { key: "intern_progress", label: "Intern progress", group: "Recruitment" },
  { key: "performance_summary", label: "Performance summary", group: "Performance" },
  { key: "exit_summary", label: "Exit cases (resignations & exits)", group: "Exit management" },
  { key: "completed_exits", label: "Completed exits (attrition basis)", group: "Exit management" },
];
const REPORT_LABEL = Object.fromEntries(REPORTS.map((r) => [r.key, r.label]));

function cellText(v, type) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (type === "money") return formatMoney(v);
  if (type === "pct" || type === "int" || type === "num") return formatValue(v, type);
  if (type === "datetime") return formatDateTime(v);
  if (type === "date" && /^\d{4}-\d{2}-\d{2}/.test(String(v))) return formatDate(String(v).slice(0, 10));
  const s = String(v);
  return /^[a-z]+(_[a-z]+)+$/.test(s) ? s.replace(/_/g, " ") : s;   // raw codes such as full_time
}
const RIGHT = new Set(["int", "num", "money", "pct"]);

function TotalsRow({ columns, totals }) {
  if (!totals || !Object.keys(totals).length) return null;
  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
      <span className="font-bold">Totals (all rows): </span>
      {columns.filter((c) => c.key in totals).map((c) => <span key={c.key} className="mr-4 whitespace-nowrap">{c.label}: <b>{cellText(totals[c.key], c.type)}</b></span>)}
    </div>
  );
}

// ------------------------------------------------------------ filters
function FilterBar({ draft, setDraft, onApply, onReset, showStatus, statusValues, error }) {
  const org = useOrg();
  const people = useEmployeeOptions({ includeInactive: true });
  const set = (k) => (e) => setDraft((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Card className="mb-4">
      <form onSubmit={(e) => { e.preventDefault(); onApply(); }} aria-label="Report filters">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="From"><Input type="date" value={draft.from} onChange={set("from")} max={draft.to || undefined} required /></Field>
          <Field label="To"><Input type="date" value={draft.to} onChange={set("to")} min={draft.from || undefined} required /></Field>
          <Field label="Company"><Select placeholder="All" value={draft.company} onChange={set("company")} options={toOptions(org.data?.legalEntities)} /></Field>
          <Field label="Department"><Select placeholder="All" value={draft.department} onChange={set("department")} options={toOptions(org.data?.departments)} /></Field>
          <Field label="Location"><Select placeholder="All" value={draft.location} onChange={set("location")} options={toOptions(org.data?.locations)} /></Field>
          <Field label="Employment type"><Select placeholder="All" value={draft.type} onChange={set("type")} options={toOptions(org.data?.employmentTypes, "name", "code")} /></Field>
          <Field label="Manager"><Select placeholder="Any" value={draft.manager} onChange={set("manager")} options={people.data ?? []} /></Field>
          <Field label="Employee"><Select placeholder="All" value={draft.employee} onChange={set("employee")} options={people.data ?? []} /></Field>
          {showStatus && (
            <Field label="Status"><Select placeholder="Any" value={draft.status} onChange={set("status")}
              options={[...new Set([...(statusValues ?? []), draft.status].filter(Boolean))].map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} /></Field>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="submit"><BarChart3 className="h-4 w-4" aria-hidden="true" />Apply filters</Button>
          <Button type="button" variant="secondary" onClick={onReset}><RotateCcw className="h-4 w-4" aria-hidden="true" />Reset filters</Button>
          <span className="text-xs text-slate-500">Manager = direct reports of that person (hiring manager for recruitment).</span>
        </div>
        <div className="mt-3"><InlineError message={error} /></div>
      </form>
    </Card>
  );
}

// ------------------------------------------------------------ export buttons
function ExportButtons({ source, reportKey, applied, disabled, payroll }) {
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const org = useOrg();
  const people = useEmployeeOptions({ includeInactive: true });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  // UI hint only — the server refuses exports without reports.export / payroll.export.
  if (!hasPermission("reports.export") || (payroll && !hasPermission("payroll.export"))) return null;
  async function go(format) {
    setBusy(format); setError(null);
    const r = await loadExport(source, reportKey, format, applied);
    if (r.error) { setBusy(null); setError(r.error); return; }
    try {
      const labels = describeFilters(applied, { org: org.data, employees: people.data });
      const doc = source === "report" ? reportToDoc(r.data, labels) : analyticsToDoc(r.data, labels);
      await downloadDoc(doc, format);
      notify(`Exported ${r.data.export?.rows ?? 0} rows (${format.toUpperCase()}). The download was recorded in the audit log.`);
    } catch (e) {
      setError(e.message || "Export failed.");
    }
    setBusy(null);
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => go("csv")} loading={busy === "csv"} disabled={disabled || !!busy}><Download className="h-4 w-4" aria-hidden="true" />CSV</Button>
      <Button size="sm" variant="secondary" onClick={() => go("xlsx")} loading={busy === "xlsx"} disabled={disabled || !!busy}><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />Excel</Button>
      <Button size="sm" variant="secondary" onClick={() => go("pdf")} loading={busy === "pdf"} disabled={disabled || !!busy}><FileText className="h-4 w-4" aria-hidden="true" />PDF</Button>
      {error && <span role="alert" className="text-xs font-medium text-red-700">{error}</span>}
    </div>
  );
}

function ReportMeta({ data, extra }) {
  return (
    <p className="text-sm text-slate-600">
      {formatDate(data.from)} – {formatDate(data.to)} · {data.scope === "team" ? "your team" : "company-wide"}
      {extra ? ` · ${extra}` : ""} · last refreshed {formatDateTime(data.generated_at)}
    </p>
  );
}

// ------------------------------------------------------------ analytics
function Section({ section }) {
  const [view, setView] = useState(section.chart ? "chart" : "table");
  const totals = useMemo(() => {
    const out = {};
    for (const c of section.columns) if (c.total) out[c.key] = section.rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
    return out;
  }, [section]);
  return (
    <Card title={section.title} actions={section.chart && section.rows.length ? (
      <div className="flex gap-1" role="group" aria-label={`${section.title} view`}>
        <Button size="sm" variant={view === "chart" ? "primary" : "secondary"} onClick={() => setView("chart")} aria-pressed={view === "chart"}><BarChart3 className="h-4 w-4" aria-hidden="true" />Chart</Button>
        <Button size="sm" variant={view === "table" ? "primary" : "secondary"} onClick={() => setView("table")} aria-pressed={view === "table"}><Table2 className="h-4 w-4" aria-hidden="true" />Table</Button>
      </div>) : null}>
      {section.note && <p className="mb-3 text-xs text-slate-500">{section.note}</p>}
      {!section.rows.length ? <EmptyState title="No records for these filters" /> : view === "chart" ? <ReportChart section={section} /> : (
        <>
          <DataTable caption={section.title} rows={section.rows.map((r, i) => ({ ...r, __i: i }))} rowKey="__i" pageSize={25}
            columns={section.columns.map((c) => ({ key: c.key, header: c.label, sortable: true, className: RIGHT.has(c.type) ? "text-right tabular-nums" : undefined, render: (r) => cellText(r[c.key], c.type) }))} />
          <TotalsRow columns={section.columns} totals={totals} />
        </>
      )}
    </Card>
  );
}

function KpiCardLite({ card, tone, currency }) {
  const tones = { orange: "border-l-[#f96706]", teal: "border-l-[#1f6f8a]", navy: "border-l-[#101a3a]", green: "border-l-emerald-600", slate: "border-l-slate-500" };
  const value = card.value === null || card.value === undefined ? "—"
    : card.format === "money" ? formatMoney(card.value, currency || "INR") : formatValue(card.value, card.format);
  return (
    <div className={`rounded-2xl border border-l-4 border-slate-200 bg-white p-4 ${tones[tone]}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.label}{card.category ? <Badge className="ml-2 normal-case">{card.category}</Badge> : null}</div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums text-[#101a3a]">{value}</div>
      {card.hint && <div className="mt-0.5 text-xs text-slate-500">{card.hint}</div>}
    </div>
  );
}

const CARD_TONES = ["orange", "navy", "teal", "green", "slate"];
function AnalyticsView({ category, applied, onOpenTemplate }) {
  const key = JSON.stringify(applied);
  const q = useHrQuery(() => loadAnalytics(category, applied), [category, key]);
  const d = q.data;
  if (q.loading && !d) return <Loading label="Calculating report…" />;
  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!d) return null;
  const related = (RELATED_TEMPLATES[category] ?? []).filter((k) => REPORT_LABEL[k]);
  return (
    <section aria-label={d.title} aria-busy={q.loading}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-[#101a3a]">{d.title}</h2>
          <ReportMeta data={d} extra={d.as_of && d.as_of !== d.to ? `as of ${formatDate(d.as_of)}` : null} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={q.reload} loading={q.loading}><RefreshCw className="h-4 w-4" aria-hidden="true" />Refresh</Button>
          {category !== "overview" && <ExportButtons source="analytics" reportKey={category} applied={applied} payroll={category === "payroll"} disabled={!d.sections?.length && !d.cards?.length} />}
        </div>
      </div>
      {d.unavailable?.map((u) => (
        <p key={u.category} className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <b className="capitalize">{u.category}:</b> not available to you. {u.reason}
        </p>
      ))}
      {d.filters_ignored?.length ? <p className="mb-3 text-xs text-slate-500">Filters that do not apply here: {d.filters_ignored.join(", ")}.</p> : null}
      {d.cards?.length ? (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {d.cards.map((c, i) => <KpiCardLite key={`${c.category ?? ""}${c.key}`} card={c} tone={CARD_TONES[i % CARD_TONES.length]} currency={d.currency} />)}
        </div>
      ) : !d.unavailable?.length ? <EmptyState title="No data for these filters" /> : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {d.sections?.map((s) => <Section key={s.key} section={s} />)}
      </div>
      {d.definitions?.length ? (
        <details className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <summary className="cursor-pointer font-bold text-[#101a3a]"><Info className="mr-1 inline h-4 w-4" aria-hidden="true" />How these numbers are calculated</summary>
          <dl className="mt-3 space-y-2">{d.definitions.map((x) => <div key={x.metric}><dt className="font-semibold text-slate-800">{x.metric}</dt><dd className="text-slate-600">{x.formula}</dd></div>)}</dl>
        </details>
      ) : null}
      {related.length ? (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-bold text-[#101a3a]">Detailed records</h3>
          <div className="flex flex-wrap gap-2">{related.map((k) => <Button key={k} size="sm" variant="secondary" onClick={() => onOpenTemplate(k)}>{REPORT_LABEL[k]}</Button>)}</div>
        </div>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------ templates
function TemplatesView({ report, setReport, applied, onStatusValues }) {
  const { hasPermission } = useAuth();
  const available = REPORTS.filter((r) => !r.needs || r.needs.some((p) => hasPermission(p)));
  const [page, setPage] = useState(1);
  const PAGE = 50;
  const key = JSON.stringify(applied);
  useEffect(() => { setPage(1); }, [report, key]);
  const q = useHrQuery(() => (report ? loadReportPage(report, applied, page, PAGE) : Promise.resolve({ data: null, error: null })), [report, key, page]);
  const d = q.data;
  useEffect(() => { onStatusValues(d?.status_values ?? []); }, [d, onStatusValues]);
  const columns = useMemo(() => (d?.columns ?? []).map((c) => ({ ...c, type: inferType(c.key, d?.rows ?? []) })), [d]);
  return (
    <section aria-label="Report templates">
      <Card className="mb-4">
        <Field label="Report">{(fid) => (
          <select id={fid} value={report} onChange={(e) => setReport(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-8 text-sm text-slate-900 outline-none focus:border-[#f96706] focus:ring-4 focus:ring-[#f96706]/15 lg:w-1/2">
            <option value="">Choose a report…</option>
            {REPORT_GROUPS.map((g) => { const items = available.filter((r) => r.group === g); return items.length ? <optgroup key={g} label={g}>{items.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</optgroup> : null; })}
          </select>)}</Field>
      </Card>
      {!report ? <EmptyState title="Choose a report" description="Pick a report template above. The filters apply to it." />
        : q.error ? <ErrorState message={q.error} onRetry={q.reload} />
        : !d ? <Loading /> : (
          <>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-[#101a3a]">{d.title}</h2>
                <ReportMeta data={d} extra={`${d.total} rows`} />
                {d.note && <p className="text-xs text-slate-500">{d.note}</p>}
                {d.filters_ignored?.length ? <p className="text-xs text-slate-500">Filters that do not apply: {d.filters_ignored.join(", ")}.</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={q.reload} loading={q.loading}><RefreshCw className="h-4 w-4" aria-hidden="true" />Refresh</Button>
                <ExportButtons source="report" reportKey={report} applied={applied} payroll={report.startsWith("payroll")} disabled={!d.total} />
              </div>
            </div>
            <DataTable caption={d.title} loading={q.loading} rows={(d.rows ?? []).map((r, i) => ({ ...r, __i: i + (page - 1) * PAGE }))} rowKey="__i"
              serverPaging={{ page, pageSize: PAGE, total: d.total, onPage: setPage }}
              columns={columns.map((c) => ({ key: c.key, header: c.label, className: RIGHT.has(c.type) ? "text-right tabular-nums" : undefined, render: (r) => cellText(r[c.key], c.type) }))}
              emptyTitle="No records for these filters" />
            <TotalsRow columns={columns} totals={d.totals} />
          </>
        )}
    </section>
  );
}

// ------------------------------------------------------------ page
export default function ReportsPage() {
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = CATEGORIES.filter((c) => !c.anyOf || c.anyOf.some((p) => hasPermission(p)));
  const tab = tabs.some((t) => t.key === params.get("tab")) ? params.get("tab") : "overview";
  const report = REPORT_LABEL[params.get("report")] ? params.get("report") : "";
  const applied = useMemo(() => filtersFromParams(params), [params]);
  const [draft, setDraft] = useState(applied);
  const [error, setError] = useState(null);
  const [statusValues, setStatusValues] = useState([]);
  useEffect(() => { setDraft(applied); }, [applied]);

  const push = (f, next = {}) => {
    const t = next.tab ?? tab;
    setParams(filtersToParams(f, { tab: t === "overview" ? "" : t, report: t === "templates" ? (next.report ?? report) : "" }));
  };
  function apply() {
    const msg = validateFilters(draft);
    setError(msg);
    if (!msg) push(draft);
  }
  function reset() { const d = defaultFilters(); setDraft(d); setError(null); push(d); }

  return (
    <>
      <PageHeader title="HR Reports & Analytics" description="Calculated on the server from the records you are authorised to see. Filters apply to cards, charts, tables and exports." />
      <FilterBar draft={draft} setDraft={setDraft} onApply={apply} onReset={reset} showStatus={tab === "templates"} statusValues={statusValues} error={error} />
      <Tabs label="Report categories" tabs={tabs.map((t) => ({ value: t.key, label: t.label }))} value={tab} onChange={(v) => push(applied, { tab: v })} />
      {tab === "templates"
        ? <TemplatesView report={report} setReport={(r) => push(applied, { tab: "templates", report: r })} applied={applied} onStatusValues={setStatusValues} />
        : <AnalyticsView category={tab} applied={{ ...applied, status: "" }} onOpenTemplate={(k) => push(applied, { tab: "templates", report: k })} />}
    </>
  );
}
