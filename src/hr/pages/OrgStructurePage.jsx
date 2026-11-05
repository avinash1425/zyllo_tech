// Org Structure — legal entities, organisation units (department tree),
// reporting hierarchy, managers and direct reports, headcounts and
// drill-down. Built from the Employee Master (authoritative) under RLS:
// HR sees the company, managers see their reporting line.
// Cycles are rejected by the database (departments and reporting lines).
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Building2, ChevronDown, ChevronRight, GitBranch, Network, Users } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { from, fullName, run, useHrQuery } from "@/lib/hr/client";
import { toOptions, useOrg } from "@/lib/hr/org";
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, KpiCard, Loading, Modal, PageHeader, SearchInput, Select, StatusBadge, Tabs, Toolbar } from "@/hr/ui";

const cx = (...c) => c.filter(Boolean).join(" ");

async function loadPeople() {
  return run(from("hr_employees").select("id, employee_code, first_name, last_name, display_name, status, manager_id, department_id, legal_entity_id, designation:hr_designations(name)")
    .not("status", "in", "(exited,archived)").order("first_name").limit(5000));
}

export default function OrgStructurePage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const org = useOrg();
  const people = useHrQuery(loadPeople, []);
  const [tab, setTab] = useState("units");
  const [company, setCompany] = useState("");
  const [dept, setDept] = useState("");
  const [search, setSearch] = useState("");
  const [drill, setDrill] = useState(null);   // { title, employees }

  const model = useMemo(() => build(org.data, people.data ?? [], { company, dept }), [org.data, people.data, company, dept]);

  if ((org.loading && !org.data) || (people.loading && !people.data)) return <Loading />;
  if (org.error || people.error) return <ErrorState message={org.error || people.error} onRetry={() => { org.reload(); people.reload(); }} />;
  const team = !hasPermission("employees.view");

  return (
    <>
      <PageHeader title="Org Structure" description={team ? "Your reporting line, from the Employee Master." : "Companies, organisation units and reporting lines, from the Employee Master."} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="Companies" value={model.entities.length} icon={Building2} tone="navy" />
        <KpiCard label="Organisation units" value={model.units.length} icon={Network} tone="teal" />
        <KpiCard label="Employees in scope" value={model.scoped.length} icon={Users} tone="green" />
        <KpiCard label="Managers" value={model.managers} icon={GitBranch} tone="orange" />
      </div>
      <Toolbar>
        <Select aria-label="Company" className="sm:w-56" placeholder="All companies" value={company} onChange={(e) => { setCompany(e.target.value); setDept(""); }}
          options={[...toOptions(org.data?.legalEntities, "name", "id", { activeOnly: false }), { value: "none", label: "No company assigned" }]} />
        <Select aria-label="Department" className="sm:w-56" placeholder="All departments" value={dept} onChange={(e) => setDept(e.target.value)} options={toOptions(model.unitOptions, "name", "id", { activeOnly: false })} />
        {tab === "reporting" && <SearchInput value={search} onChange={setSearch} placeholder="Find a person…" label="Find a person in the hierarchy" />}
      </Toolbar>
      <Tabs value={tab} onChange={setTab} label="Org structure views" tabs={[
        { value: "units", label: "Units (tree)" }, { value: "table", label: "Units (table)" }, { value: "reporting", label: "Reporting hierarchy" },
        { value: "checks", label: "Hierarchy checks", count: model.issues.length },
      ]} />

      {tab === "units" && (
        <Card padded={false}>
          {!model.roots.length ? <EmptyState title="No organisation units" description="Add departments / units in HR Settings → Departments." /> : (
            <ul className="divide-y divide-slate-100" role="tree" aria-label="Organisation units">
              {model.groups.map((g) => (
                <li key={g.key} role="treeitem" aria-expanded="true" className="px-3 py-2 sm:px-4">
                  <p className="flex flex-wrap items-center gap-2 py-1 text-sm font-extrabold text-[#101a3a]"><Building2 className="h-4 w-4 text-[#f96706]" aria-hidden="true" />{g.name}{g.country && <Badge>{g.country}</Badge>}<span className="text-xs font-semibold text-slate-500">{g.total} employees</span></p>
                  <ul role="group" className="ml-2 border-l border-slate-200 pl-2">
                    {g.units.map((u) => <UnitNode key={u.id} unit={u} onDrill={(x) => setDrill({ title: x.name, employees: x.allEmployees })} />)}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "table" && (
        <DataTable caption="Organisation units" rows={model.units} pageSize={25} emptyTitle="No organisation units"
          onRowClick={(u) => setDrill({ title: u.name, employees: u.allEmployees })}
          columns={[
            { key: "code", header: "Code", sortable: true, render: (u) => <span className="font-mono text-xs font-bold text-[#1f4693]">{u.code}</span> },
            { key: "name", header: "Unit", sortable: true, render: (u) => <span className="font-semibold text-[#101a3a]">{u.name}{!u.active && <Badge className="ml-1">inactive</Badge>}</span> },
            { key: "unit_type", header: "Type", sortable: true, render: (u) => u.unit_type },
            { key: "parent", header: "Parent", sortable: true, sortValue: (u) => u.parentName ?? "", render: (u) => u.parentName ?? "—" },
            { key: "company", header: "Company", sortable: true, sortValue: (u) => u.companyName ?? "", render: (u) => u.companyName ?? "—" },
            { key: "head", header: "Head", render: (u) => u.headName ?? "—" },
            { key: "direct", header: "Direct", sortable: true, sortValue: (u) => u.employees.length, render: (u) => u.employees.length },
            { key: "total", header: "Incl. sub-units", sortable: true, sortValue: (u) => u.allEmployees.length, render: (u) => u.allEmployees.length },
          ]} />
      )}

      {tab === "reporting" && (
        <Card padded={false}>
          {!model.top.length ? <EmptyState title="No employees in scope" /> : (
            <ul role="tree" aria-label="Reporting hierarchy" className="px-2 py-2 sm:px-3">
              {model.top.map((p) => <PersonNode key={p.id} person={p} search={search.trim().toLowerCase()} onOpen={(id) => navigate(`/hr/employees/${id}`)} onDrill={(x) => setDrill({ title: `Reports of ${fullName(x)}`, employees: x.allReports })} />)}
            </ul>
          )}
        </Card>
      )}

      {tab === "checks" && (
        <Card title="Hierarchy validation">
          <p className="mb-3 text-sm text-slate-600">Circular reporting lines and circular unit parents are rejected when saved. These checks list gaps that are allowed but usually need attention.</p>
          {!model.issues.length ? <EmptyState title="No issues found" /> : (
            <ul className="flex flex-col gap-2">
              {model.issues.map((i, n) => (
                <li key={n} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span><span className="font-semibold">{i.title}</span>{i.people?.length ? <span className="block text-xs">{i.people.slice(0, 12).map(fullName).join(", ")}{i.people.length > 12 ? ` and ${i.people.length - 12} more` : ""}</span> : null}</span>
                  {i.people?.length > 0 && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDrill({ title: i.title, employees: i.people })}>View</Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Modal open={Boolean(drill)} onClose={() => setDrill(null)} title={drill ? `${drill.title} · ${drill.employees.length} employee${drill.employees.length === 1 ? "" : "s"}` : ""} size="lg">
        {drill && (
          <DataTable caption={drill.title} rows={drill.employees} pageSize={15} emptyTitle="No employees" onRowClick={(r) => navigate(`/hr/employees/${r.id}`)}
            columns={[
              { key: "name", header: "Employee", sortable: true, sortValue: (r) => fullName(r).toLowerCase(), render: (r) => <span className="font-semibold text-[#101a3a]">{fullName(r)}</span> },
              { key: "employee_code", header: "ID", render: (r) => <span className="font-mono text-xs">{r.employee_code}</span> },
              { key: "designation", header: "Designation", render: (r) => r.designation?.name ?? "—" },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            ]} />
        )}
      </Modal>
    </>
  );
}

function UnitNode({ unit, onDrill, depth = 0 }) {
  const [open, setOpen] = useState(depth < 1);
  const has = unit.children.length > 0;
  return (
    <li role="treeitem" aria-expanded={has ? open : undefined} className="py-0.5">
      <div className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
        {has ? <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? `Collapse ${unit.name}` : `Expand ${unit.name}`} className="rounded p-0.5 text-slate-500 hover:bg-slate-200">{open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}</button> : <span className="w-5" />}
        <span className="font-semibold text-[#101a3a]">{unit.name}</span>
        <Badge tone="blue">{unit.unit_type}</Badge>
        {!unit.active && <Badge>inactive</Badge>}
        {unit.headName && <span className="text-xs text-slate-500">Head: {unit.headName}</span>}
        <button type="button" onClick={() => onDrill(unit)} className="ml-auto rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-[#173a52] hover:bg-orange-100" aria-label={`${unit.allEmployees.length} employees in ${unit.name}; show list`}>
          {unit.employees.length}{has ? ` / ${unit.allEmployees.length}` : ""} <Users className="ml-0.5 inline h-3 w-3" aria-hidden="true" />
        </button>
      </div>
      {has && open && <ul role="group" className="ml-4 border-l border-slate-200 pl-2">{unit.children.map((c) => <UnitNode key={c.id} unit={c} onDrill={onDrill} depth={depth + 1} />)}</ul>}
    </li>
  );
}

function matches(p, s) { return !s || fullName(p).toLowerCase().includes(s) || p.employee_code.toLowerCase().includes(s); }
function subtreeMatches(p, s) { return matches(p, s) || p.reports.some((r) => subtreeMatches(r, s)); }

function PersonNode({ person, search, onOpen, onDrill, depth = 0 }) {
  const [open, setOpen] = useState(depth < 1);
  const has = person.reports.length > 0;
  if (search && !subtreeMatches(person, search)) return null;
  const expanded = search ? true : open;
  return (
    <li role="treeitem" aria-expanded={has ? expanded : undefined} className="py-0.5">
      <div className={cx("flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50", search && matches(person, search) && "bg-orange-50")}>
        {has ? <button type="button" onClick={() => setOpen((o) => !o)} aria-label={expanded ? `Collapse ${fullName(person)}` : `Expand ${fullName(person)}`} className="rounded p-0.5 text-slate-500 hover:bg-slate-200">{expanded ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}</button> : <span className="w-5" />}
        <button type="button" onClick={() => onOpen(person.id)} className="font-semibold text-[#1f4693] hover:underline">{fullName(person)}</button>
        <span className="font-mono text-xs text-slate-500">{person.employee_code}</span>
        {person.designation?.name && <span className="text-xs text-slate-600">{person.designation.name}</span>}
        {has && <button type="button" onClick={() => onDrill(person)} className="ml-auto rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-[#173a52] hover:bg-orange-100" aria-label={`${person.reports.length} direct and ${person.allReports.length} total reports; show list`}>{person.reports.length} direct · {person.allReports.length} total</button>}
      </div>
      {has && expanded && <ul role="group" className="ml-4 border-l border-slate-200 pl-2">{person.reports.map((r) => <PersonNode key={r.id} person={r} search={search} onOpen={onOpen} onDrill={onDrill} depth={depth + 1} />)}</ul>}
    </li>
  );
}

// ---------------------------------------------------------------- model
function build(org, people, { company, dept }) {
  const departments = org?.departments ?? [];
  const entities = org?.legalEntities ?? [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const entityName = (id) => entities.find((x) => x.id === id)?.name;

  // Units tree (guarded against cycles even though the DB rejects them).
  const units = departments.map((d) => ({ ...d, children: [], employees: [], allEmployees: [] }));
  const unitById = new Map(units.map((u) => [u.id, u]));
  for (const u of units) {
    const parent = u.parent_id && unitById.get(u.parent_id);
    if (parent && parent !== u) parent.children.push(u);
    u.parentName = parent?.name ?? null;
    u.companyName = entityName(u.legal_entity_id) ?? null;
    u.headName = u.head_employee_id ? (byId.get(u.head_employee_id) ? fullName(byId.get(u.head_employee_id)) : null) : null;
  }
  const inCompany = (p) => !company || (company === "none" ? !p.legal_entity_id : p.legal_entity_id === company);
  const scopedPeople = people.filter(inCompany);
  for (const p of scopedPeople) unitById.get(p.department_id)?.employees.push(p);
  const collect = (u, seen = new Set()) => {
    if (seen.has(u.id)) return [];
    seen.add(u.id);
    u.allEmployees = [...u.employees, ...u.children.flatMap((c) => collect(c, seen))];
    return u.allEmployees;
  };
  const roots = units.filter((u) => !u.parent_id || !unitById.has(u.parent_id));
  roots.forEach((r) => collect(r));
  units.forEach((u) => { if (!u.allEmployees.length && u.employees.length) collect(u); });

  // Department focus = that unit and its descendants.
  let visibleUnits = units;
  if (dept && unitById.get(dept)) {
    const keep = new Set();
    const walk = (u) => { if (keep.has(u.id)) return; keep.add(u.id); u.children.forEach(walk); };
    walk(unitById.get(dept));
    visibleUnits = units.filter((u) => keep.has(u.id));
  }
  const unitFilter = (u) => !company || (company === "none" ? !u.legal_entity_id || u.allEmployees.length > 0 : u.legal_entity_id === company || u.allEmployees.length > 0);
  const tableUnits = visibleUnits.filter(unitFilter);

  // Group root units under companies for the tree.
  const treeRoots = dept && unitById.get(dept) ? [unitById.get(dept)] : roots.filter(unitFilter);
  const groupsMap = new Map();
  for (const r of treeRoots) {
    const key = r.legal_entity_id ?? "none";
    if (!groupsMap.has(key)) {
      const ent = entities.find((x) => x.id === r.legal_entity_id);
      groupsMap.set(key, { key, name: ent?.name ?? "No company assigned", country: ent?.country, units: [], total: 0 });
    }
    const g = groupsMap.get(key);
    g.units.push(r); g.total += r.allEmployees.length;
  }

  // Reporting hierarchy over people in scope (department focus applies too).
  const deptIds = dept ? new Set(visibleUnits.map((u) => u.id)) : null;
  const scoped = scopedPeople.filter((p) => !deptIds || deptIds.has(p.department_id));
  const nodes = new Map(scoped.map((p) => [p.id, { ...p, reports: [], allReports: [] }]));
  for (const n of nodes.values()) if (n.manager_id && nodes.has(n.manager_id) && n.manager_id !== n.id) nodes.get(n.manager_id).reports.push(n);
  const fill = (n, seen = new Set()) => {
    if (seen.has(n.id)) return [];
    seen.add(n.id);
    n.allReports = n.reports.flatMap((r) => [r, ...fill(r, seen)]);
    return n.allReports;
  };
  const top = [...nodes.values()].filter((n) => !n.manager_id || !nodes.has(n.manager_id));
  top.forEach((t) => fill(t));
  top.sort((a, b) => b.allReports.length - a.allReports.length || fullName(a).localeCompare(fullName(b)));

  // Checks
  const issues = [];
  const noManager = scoped.filter((p) => !p.manager_id);
  if (noManager.length > 1) issues.push({ title: `${noManager.length} employees have no reporting manager`, people: noManager });
  const noDept = scoped.filter((p) => !p.department_id);
  if (noDept.length) issues.push({ title: `${noDept.length} employees have no department`, people: noDept });
  const noCompany = scoped.filter((p) => !p.legal_entity_id);
  if (noCompany.length && entities.length) issues.push({ title: `${noCompany.length} employees have no company / legal entity`, people: noCompany });
  const inactiveWithPeople = units.filter((u) => !u.active && u.employees.length);
  for (const u of inactiveWithPeople) issues.push({ title: `Inactive unit "${u.name}" still has ${u.employees.length} employees`, people: u.employees });
  const unitsNoCompany = units.filter((u) => u.active && !u.legal_entity_id);
  if (unitsNoCompany.length && entities.length) issues.push({ title: `${unitsNoCompany.length} active units are not linked to a company: ${unitsNoCompany.slice(0, 8).map((u) => u.name).join(", ")}` });
  const unitsNoHead = units.filter((u) => u.active && !u.head_employee_id && u.employees.length);
  if (unitsNoHead.length) issues.push({ title: `${unitsNoHead.length} units with employees have no head: ${unitsNoHead.slice(0, 8).map((u) => u.name).join(", ")}` });

  return {
    entities, units: tableUnits, unitOptions: units, roots: treeRoots, groups: [...groupsMap.values()], scoped,
    managers: [...nodes.values()].filter((n) => n.reports.length).length, top, issues,
  };
}
