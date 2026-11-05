// Module 2 — Employee Management (consolidates the former "Employee Master":
// same tables, RPCs and /hr/employees routes). Summary cards, searchable
// directory with filters + pagination, add / import / export, and the
// employee profile (EmployeeDetail).
import { useState } from "react";
import { Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { Download, Hourglass, Plus, Upload, UserCheck, UserMinus, UserPlus, UserX, X } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { exportCsv, formatDate, fullName, parseCsv, useHrQuery } from "@/lib/hr/client";
import { EMPLOYEE_STATUSES, arrangementLabel, getEmployeeSummary, importEmployees, listEmployees } from "@/lib/hr/employees";
import { toOptions, useEmployeeOptions, useOrg } from "@/lib/hr/org";
import { Badge, Button, DataTable, ErrorState, InlineError, KpiCard, Loading, Modal, PageHeader, SearchInput, Select, StatusBadge, Toolbar, useToast } from "@/hr/ui";
import EmployeeForm, { saveEmployeeAll } from "@/hr/components/EmployeeForm";
import EmployeeDetail from "./EmployeeDetail";

const PAGE_SIZE = 25;

function EmployeeList() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const { notify } = useToast();
  const org = useOrg();
  const managers = useEmployeeOptions();
  // Initial filters may come from the URL (HR Dashboard click-through), e.g. ?status=inactive&department=…
  const [params] = useSearchParams();
  const [f, setF] = useState(() => ({
    search: "", department: params.get("department") ?? "", designation: params.get("designation") ?? "", status: params.get("status") ?? "current", type: params.get("type") ?? "",
    manager: params.get("manager") ?? "", legalEntity: params.get("company") ?? "", location: "", grade: "",
    joinedFrom: params.get("joinedFrom") ?? "", joinedTo: params.get("joinedTo") ?? "",
  }));
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const list = useHrQuery(() => listEmployees({ ...f, page, pageSize: PAGE_SIZE }), [f.search, f.department, f.designation, f.status, f.type, f.manager, f.legalEntity, f.location, f.grade, f.joinedFrom, f.joinedTo, page]);
  // Summary counts follow the caller's RLS scope (HR: everyone; manager: reporting line).
  const summary = useHrQuery(() => getEmployeeSummary({ department: f.department, designation: f.designation, manager: f.manager }), [f.department, f.designation, f.manager, list.count]);
  const setFilter = (k) => (e) => { setPage(1); setF((s) => ({ ...s, [k]: typeof e === "string" ? e : e.target.value })); };
  const showStatus = (status) => { setPage(1); setF((s) => ({ ...s, status })); };
  const designationOptions = toOptions((org.data?.designations ?? []).filter((d) => !f.department || !d.department_id || d.department_id === f.department), "name", "id", { activeOnly: false });
  const sm = summary.data ?? {};
  const sumLoading = summary.loading && !summary.data;
  // Same groups as the HR Dashboard (ACTIVE_STATUSES / INACTIVE_CURRENT_STATUSES).
  const working = (sm.active ?? 0) + (sm.probation ?? 0) + (sm.notice_period ?? 0);
  const inactive = (sm.onboarding ?? 0) + (sm.suspended ?? 0);

  async function doExport() {
    setExporting(true);
    const res = await listEmployees({ ...f, all: true });
    setExporting(false);
    if (res.error) { notify(res.error, "error"); return; }
    exportCsv(`employees-${new Date().toISOString().slice(0, 10)}`, res.data, [
      { label: "Employee ID", key: "employee_code" }, { label: "First name", key: "first_name" }, { label: "Last name", key: "last_name" },
      { label: "Display name", key: "display_name" }, { label: "Company email", key: "company_email" },
      { label: "Company", value: (r) => r.legal_entity?.name }, { label: "Department", value: (r) => r.department?.name },
      { label: "Designation", value: (r) => r.designation?.name }, { label: "Grade", value: (r) => r.grade?.name },
      { label: "Work location", value: (r) => r.location?.name }, { label: "Work arrangement", value: (r) => arrangementLabel(r.work_arrangement) },
      { label: "Contract type", key: "contract_type" }, { label: "Notice period (days)", key: "notice_period_days" },
      { label: "Deployment", key: "deployment_status" }, { label: "Client", key: "deployment_client" }, { label: "Project / job no.", key: "deployment_project_code" },
      { label: "Manager", value: (r) => (r.manager ? `${fullName(r.manager)} (${r.manager.employee_code})` : "") },
      { label: "Employment type", key: "employment_type" }, { label: "Status", key: "status" }, { label: "Joining date", key: "joining_date" },
      { label: "Probation end", key: "probation_end_date" }, { label: "Portal access", value: (r) => (r.portal_access ? "yes" : "no") },
    ]);
    notify(`Exported ${res.data.length} employees.`);
  }

  const columns = [
    { key: "name", header: "Employee", sortable: true, sortValue: (r) => fullName(r).toLowerCase(), render: (r) => (
      <div className="min-w-[12rem]"><p className="font-semibold text-[#101a3a]">{fullName(r)}</p><p className="text-xs text-slate-500">{r.company_email || "No company email"}</p></div>) },
    { key: "employee_code", header: "ID", render: (r) => <span className="font-mono text-xs font-bold text-[#1f4693]">{r.employee_code}</span> },
    { key: "company", header: "Company", render: (r) => r.legal_entity?.name ?? "—" },
    { key: "department", header: "Department", render: (r) => r.department?.name ?? "—" },
    { key: "designation", header: "Designation", render: (r) => r.designation?.name ?? "—" },
    { key: "manager", header: "Manager", render: (r) => (r.manager ? fullName(r.manager) : "—") },
    { key: "employment_type", header: "Type", render: (r) => <Badge tone={r.employment_type === "intern" ? "violet" : "slate"}>{r.employment_type.replace(/_/g, " ")}</Badge> },
    { key: "joining_date", header: "Joined", render: (r) => formatDate(r.joining_date) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "portal", header: "Portal", render: (r) => (r.portal_access ? <Badge tone="green">{r.activated_at ? "active" : "invited"}</Badge> : <Badge>{r.user_id ? "disabled" : "not invited"}</Badge>) },
  ];

  return (
    <>
      <PageHeader title="Employee Management" description="Employee profiles, IDs, departments, designations, reporting lines, employment history and documents."
        actions={<>
          {hasPermission("employees.export") && <Button variant="secondary" onClick={doExport} loading={exporting}><Download className="h-4 w-4" aria-hidden="true" />Export CSV</Button>}
          {hasPermission("employees.import") && hasPermission("employees.create") && <Button variant="secondary" onClick={() => setImporting(true)}><Upload className="h-4 w-4" aria-hidden="true" />Import</Button>}
          {hasPermission("employees.create") && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden="true" />Add employee</Button>}
        </>} />
      <section aria-label="Employee summary" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Active" value={working} hint="incl. probation & notice" icon={UserCheck} tone="green" loading={sumLoading} onClick={() => showStatus("working")} />
        <KpiCard label="Inactive" value={inactive} hint={`${sm.onboarding ?? 0} onboarding · ${sm.suspended ?? 0} suspended`} icon={UserMinus} tone="slate" loading={sumLoading} onClick={() => showStatus("inactive")} />
        <KpiCard label="On probation" value={sm.probation} hint="awaiting confirmation" icon={UserPlus} tone="teal" loading={sumLoading} onClick={() => showStatus("probation")} />
        <KpiCard label="Notice period" value={sm.notice_period} hint="resigned, serving notice" icon={Hourglass} tone="orange" loading={sumLoading} onClick={() => showStatus("notice_period")} />
        <KpiCard label="Exited / archived" value={(sm.exited ?? 0) + (sm.archived ?? 0)} hint={`${sm.total ?? 0} records in your scope`} icon={UserX} tone="navy" loading={sumLoading} onClick={() => showStatus("exited")} />
      </section>
      {summary.error && <div className="mb-3"><InlineError message={`Summary unavailable: ${summary.error}`} /></div>}
      <Toolbar>
        <SearchInput value={f.search} onChange={setFilter("search")} placeholder="Search name, ID or email…" label="Search employees" />
        <Select aria-label="Department" className="sm:w-48" placeholder="All departments" value={f.department} onChange={(e) => { setPage(1); setF((s) => ({ ...s, department: e.target.value, designation: "" })); }} options={toOptions(org.data?.departments, "name", "id", { activeOnly: false })} />
        <Select aria-label="Designation" className="sm:w-48" placeholder="All designations" value={f.designation} onChange={setFilter("designation")} options={designationOptions} />
        <Select aria-label="Status" className="sm:w-44" value={f.status} onChange={setFilter("status")} options={[{ value: "current", label: "Current employees" }, { value: "working", label: "Active (incl. probation & notice)" }, { value: "inactive", label: "Inactive (onboarding / suspended)" }, { value: "", label: "All statuses" }, ...EMPLOYEE_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))]} />
        <Select aria-label="Employment type" className="sm:w-40" placeholder="All types" value={f.type} onChange={setFilter("type")} options={toOptions(org.data?.employmentTypes, "name", "code", { activeOnly: false })} />
        <Select aria-label="Reporting manager" className="sm:w-52" placeholder="Any reporting manager" value={f.manager} onChange={setFilter("manager")} options={managers.data ?? []} />
        <Select aria-label="Company" className="sm:w-48" placeholder="All companies" value={f.legalEntity} onChange={setFilter("legalEntity")} options={[...toOptions(org.data?.legalEntities, "name", "id", { activeOnly: false }), { value: "none", label: "No company assigned" }]} />
        <Select aria-label="Work location" className="sm:w-44" placeholder="All locations" value={f.location} onChange={setFilter("location")} options={toOptions(org.data?.locations, "name", "id", { activeOnly: false })} />
        <Select aria-label="Grade" className="sm:w-40" placeholder="All grades" value={f.grade} onChange={setFilter("grade")} options={toOptions(org.data?.grades, "name", "id", { activeOnly: false })} />
      </Toolbar>
      {(f.joinedFrom || f.joinedTo) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="blue">Joined {f.joinedFrom ? formatDate(f.joinedFrom) : "…"} – {f.joinedTo ? formatDate(f.joinedTo) : "…"}</Badge>
          <Button variant="secondary" size="sm" onClick={() => { setPage(1); setF((s) => ({ ...s, joinedFrom: "", joinedTo: "" })); }}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />Clear joining-date filter
          </Button>
        </div>
      )}
      <DataTable caption="Employees" columns={columns} rows={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
        emptyTitle="No employees match" emptyDescription="Adjust the filters, or add the first employee."
        serverPaging={{ page, pageSize: PAGE_SIZE, total: list.count ?? 0, onPage: setPage }}
        onRowClick={(r) => navigate(`/hr/employees/${r.id}`)} />

      <Modal open={creating} onClose={() => setCreating(false)} title="Add employee" size="xl">
        {org.loading ? <Loading /> : org.error ? <ErrorState message={org.error} onRetry={org.reload} /> : (
          <EmployeeForm isNew org={org.data} managers={managers.data} canSensitive={hasPermission("employees.view_sensitive")}
            canIdentity={hasPermission("employees.view_identity") && hasPermission("employees.edit")} submitLabel="Create employee"
            onCancel={() => setCreating(false)}
            onSubmit={async (v) => {
              const res = await saveEmployeeAll(null, v, {}, { canSensitive: hasPermission("employees.view_sensitive"), canIdentity: hasPermission("employees.view_identity") && hasPermission("employees.edit") });
              if (res.error && !res.data) return res;
              setCreating(false);
              notify(res.error ? res.error : `Employee ${res.data.employee_code} created.`, res.error ? "error" : "success");
              navigate(`/hr/employees/${res.data.id}`);
              return {};
            }} />
        )}
      </Modal>
      <ImportModal open={importing} onClose={() => setImporting(false)} onDone={() => { setImporting(false); list.reload(); managers.reload(); }} />
    </>
  );
}

const TEMPLATE_HEADERS = ["first_name", "last_name", "display_name", "company_email", "department_code", "designation", "manager_code", "manager_email", "employment_type", "joining_date", "work_location", "shift", "contract_start_date", "contract_end_date", "date_of_birth", "gender", "personal_email", "phone"];

function ImportModal({ open, onClose, onDone }) {
  const { notify } = useToast();
  const [rows, setRows] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function reset() { setRows(null); setResult(null); setError(null); }
  async function onFile(e) {
    reset();
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError("File is larger than 2 MB."); return; }
    const parsed = parseCsv(await file.text());
    if (!parsed.length) { setError("No data rows found. The first row must be the header."); return; }
    if (parsed.length > 1000) { setError("Import at most 1000 rows at a time."); return; }
    setRows(parsed);
    setBusy(true);
    const res = await importEmployees(parsed, true);   // server-side validation (dry run)
    setBusy(false);
    if (res.error) setError(res.error); else setResult(res.data);
  }
  async function commit() {
    setBusy(true);
    const res = await importEmployees(rows, false);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    notify(`Imported ${res.data.created} employees.`);
    reset();
    onDone();
  }
  function downloadTemplate() {
    exportCsv("employee-import-template", [], TEMPLATE_HEADERS.map((h) => ({ label: h, key: h })));
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Bulk import employees" size="lg"
      footer={<>
        <Button variant="secondary" onClick={() => { reset(); onClose(); }}>Close</Button>
        <Button onClick={commit} disabled={!result?.ok} loading={busy && Boolean(result)}>Import {result?.rows ?? ""} employees</Button>
      </>}>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-slate-600">Upload a CSV (UTF-8). Dates must be <code>YYYY-MM-DD</code>. Departments are matched by code, managers by employee ID or company email. The file is validated on the server first; the import is all-or-nothing.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={downloadTemplate}><Download className="h-4 w-4" aria-hidden="true" />Download template</Button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm font-semibold text-[#173a52] hover:bg-slate-50">
            <Upload className="h-4 w-4" aria-hidden="true" /> Choose CSV file
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} />
          </label>
        </div>
        {busy && !result && <Loading label="Validating on the server…" />}
        <InlineError message={error} />
        {result && (result.ok
          ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-semibold text-emerald-800">All {result.rows} rows are valid. Nothing has been saved yet.</p>
          : (
            <div>
              <p className="mb-2 font-semibold text-red-700">{result.errors.length} problem(s) found in {result.rows} rows. Fix the file and upload again.</p>
              <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-xs"><thead className="bg-slate-50"><tr><th className="px-3 py-2 text-left">Row</th><th className="px-3 py-2 text-left">Field</th><th className="px-3 py-2 text-left">Problem</th></tr></thead>
                  <tbody>{result.errors.map((er, i) => <tr key={i} className="border-t border-slate-100"><td className="px-3 py-1.5">{er.row + 1}</td><td className="px-3 py-1.5 font-mono">{er.field}</td><td className="px-3 py-1.5">{er.message}</td></tr>)}</tbody></table>
              </div>
              <p className="mt-1 text-xs text-slate-500">Row numbers count the header as row 1.</p>
            </div>
          ))}
      </div>
    </Modal>
  );
}

export default function EmployeesPage() {
  return (
    <Routes>
      <Route index element={<EmployeeList />} />
      <Route path=":id" element={<EmployeeDetail />} />
    </Routes>
  );
}
