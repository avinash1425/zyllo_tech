import { useEffect, useMemo, useState } from "react";
import { Check, Crown, Loader2, Lock, ShieldCheck, Users } from "lucide-react";
import PageHeader from "../PageHeader";
import { getRolesAndPermissions, setRolePermission } from "@/lib/api/admin/rbac";
import { useAccess } from "@/lib/access";
import { Alert, Badge, Panel } from "@/components/portal/PortalUI";

/** Action columns, in this order. A module only shows the actions it has. */
const ACTIONS = [
  { key: "view", label: "View" },
  { key: "create", label: "Create" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" },
  { key: "download", label: "Download" },
  { key: "approve", label: "Approve" },
  { key: "export", label: "Export" },
  { key: "reveal", label: "See passwords" },
];

/** On/off switch (locked for Super Admin or when the viewer cannot edit). */
function Toggle({ on, locked, busy, label, onChange, small = false }) {
  const w = small ? "h-5 w-9" : "h-6 w-11";
  const knob = small ? "h-4 w-4" : "h-5 w-5";
  const shift = on ? (small ? "translate-x-[18px]" : "translate-x-[22px]") : "translate-x-[2px]";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={locked || busy}
      onClick={() => onChange(!on)}
      className={`relative inline-flex ${w} shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693] disabled:cursor-not-allowed ${
        on ? (locked ? "bg-[#1f4693]/55" : "bg-gradient-to-r from-[#1f4693] to-[#2d5fbe]") : "bg-[#dfe3ec]"
      } ${busy ? "opacity-60" : ""}`}
    >
      <span className={`inline-flex ${knob} transform items-center justify-center rounded-full bg-white shadow transition-transform ${shift}`}>
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin text-[#1f4693]" aria-hidden="true" />
        ) : locked ? (
          <Lock className="h-2.5 w-2.5 text-[#9aa0ad]" aria-hidden="true" />
        ) : on ? (
          <Check className="h-3 w-3 text-[#1f4693]" aria-hidden="true" />
        ) : null}
      </span>
    </button>
  );
}

/**
 * Settings -> Roles & Permissions (migrations 259-261). Pick a role, then switch each action of each
 * module on or off (View, Create, Edit, Delete, Download, Approve, Export, See passwords). Changes apply
 * at once and are enforced by the database. Super Admin always has everything.
 */
export default function SettingsRolesPage() {
  const { refresh: refreshMyAccess } = useAccess();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [busy, setBusy] = useState(new Set());
  const [roleKey, setRoleKey] = useState("admin");

  useEffect(() => {
    let active = true;
    getRolesAndPermissions()
      .then((d) => active && setData(d))
      .catch(() => active && setError("Could not load roles and permissions. Please refresh the page."));
    return () => {
      active = false;
    };
  }, []);

  const role = data?.roles.find((r) => r.key === roleKey) ?? data?.roles[0];
  // Modules of the role's area: [{ module, label, group, description, actions: {action: perm} }]
  const modules = useMemo(() => {
    if (!data || !role) return [];
    const list = [];
    const byKey = new Map();
    // Every role can get every page (migration 262): admin pages AND Employee Portal features.
    for (const p of data.permissions) {
      let m = byKey.get(p.module);
      if (!m) {
        m = { module: p.module, label: p.label, group: p.group, area: p.area, description: p.description, actions: {} };
        byKey.set(p.module, m);
        list.push(m);
      }
      m.actions[p.action] = p;
    }
    return list;
  }, [data, role]);
  const columns = ACTIONS.filter((a) => modules.some((m) => m.actions[a.key]));
  const areas = [
    { key: "admin", title: "Admin pages" },
    { key: "portal", title: "Employee Portal features" },
  ];

  const locked = !role || role.key === "super_admin" || !data?.can_edit;
  const has = (key) => role?.key === "super_admin" || role?.permissions.includes(key);

  async function setMany(perms, enabled) {
    const todo = perms.filter((p) => has(p.key) !== enabled);
    if (!todo.length) return;
    setBusy((b) => new Set([...b, ...todo.map((p) => p.key)]));
    setMsg({ kind: "", text: "" });
    const done = [];
    let failed = "";
    for (const p of todo) {
      const r = await setRolePermission(role.key, p.key, enabled);
      if (r.ok) done.push(p.key);
      else {
        failed = r.message;
        break;
      }
    }
    setBusy((b) => new Set([...b].filter((k) => !todo.some((p) => p.key === k))));
    if (done.length) {
      setData((d) => ({
        ...d,
        roles: d.roles.map((x) =>
          x.key !== role.key
            ? x
            : { ...x, permissions: enabled ? [...new Set([...x.permissions, ...done])] : x.permissions.filter((k) => !done.includes(k)) },
        ),
      }));
      refreshMyAccess();
    }
    if (failed) setMsg({ kind: "err", text: failed });
    else {
      const first = todo[0];
      setMsg({
        kind: "ok",
        text:
          todo.length === 1
            ? `${role.name}: “${first.label} — ${first.action_label}” ${enabled ? "allowed" : "removed"}.`
            : `${role.name}: all of “${first.label}” ${enabled ? "allowed" : "removed"}.`,
      });
    }
  }

  if (error) return <Alert kind="err">{error}</Alert>;
  if (!data)
    return (
      <p className="flex items-center gap-2 text-sm text-[#676b7a]" role="status">
        <Loader2 className="h-4 w-4 animate-spin text-[#1f4693]" aria-hidden="true" /> Loading…
      </p>
    );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Roles & Permissions"
        icon={ShieldCheck}
        subtitle="Choose a role, then decide exactly what it may do in each module. Changes apply immediately — on screen and in the database."
      />
      {!data.can_edit && <Alert kind="info">You can view the permissions. Only a user with “Roles & Permissions — Change permissions” can change them.</Alert>}
      {msg.text && <Alert kind={msg.kind === "ok" ? "ok" : "err"}>{msg.text}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" role="radiogroup" aria-label="Role">
        {data.roles.map((r) => {
          const on = r.key === role?.key;
          return (
            <button
              key={r.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                setRoleKey(r.key);
                setMsg({ kind: "", text: "" });
              }}
              className={`rounded-2xl border p-4 text-left transition-all ${
                on
                  ? "border-transparent bg-gradient-to-br from-[#1f4693] to-[#2d5fbe] text-white shadow-[0_10px_24px_-12px_rgba(31,70,147,0.7)]"
                  : "border-[#e7e9ee] bg-white shadow-[0_1px_2px_rgba(16,26,58,0.06)] hover:border-[#1f4693]/30"
              }`}
            >
              <span className="flex items-center gap-2">
                {r.key === "super_admin" ? (
                  <Crown className={`h-4 w-4 ${on ? "text-[#ffd9a0]" : "text-[#f96706]"}`} aria-hidden="true" />
                ) : (
                  <ShieldCheck className={`h-4 w-4 ${on ? "text-white" : "text-[#1f4693]"}`} aria-hidden="true" />
                )}
                <span className={`text-sm font-bold ${on ? "text-white" : "text-[#101a3a]"}`}>{r.name}</span>
              </span>
              <span className={`mt-1 block text-xs leading-relaxed ${on ? "text-white/80" : "text-[#676b7a]"}`}>{r.description}</span>
              <span className="mt-3 flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    on ? "bg-white/15 text-white" : r.area === "admin" ? "bg-[#1f4693] text-white" : "bg-teal-50 text-teal-700"
                  }`}
                >
                  {r.area === "admin" ? "Admin area" : "Employee Portal"}
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${on ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"}`}>
                  <Users className="h-3 w-3" aria-hidden="true" /> {r.users}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {role && (
        <Panel
          flush
          icon={ShieldCheck}
          title={`${role.name} — permissions`}
          subtitle={
            role.key === "super_admin"
              ? "Super Admin always has every permission. This cannot be changed."
              : role.key === "employee"
                ? "Applies to everyone with an Employee Portal account."
                : "Any page can be given to any role. Switch each action on or off; “All” turns the whole page on or off."
          }
          action={role.key === "super_admin" && <Badge tone="orange">Full access</Badge>}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="bg-[#1f4693] text-white">
                  <th scope="col" className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider">
                    Module
                  </th>
                  <th scope="col" className="w-16 px-2 py-3 text-center text-[11px] font-bold uppercase tracking-wider">
                    All
                  </th>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" className="w-24 px-2 py-3 text-center text-[11px] font-bold uppercase tracking-wider">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              {areas.map((a) => {
                const inArea = modules.filter((m) => m.area === a.key);
                if (!inArea.length || (role.key === "super_admin" && a.key === "portal")) return null;
                return (
                  <tbody key={a.key}>
                    <tr className="bg-[#101a3a] text-white">
                      <th colSpan={columns.length + 2} scope="rowgroup" className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider">
                        {a.title}
                      </th>
                    </tr>
                    {[...new Set(inArea.map((m) => m.group))].map((g) => (
                      <GroupRows
                        key={g}
                        group={g}
                        modules={inArea.filter((m) => m.group === g)}
                        columns={columns}
                        has={has}
                        locked={locked}
                        busy={busy}
                        onSet={setMany}
                      />
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>
        </Panel>
      )}
      <p className="text-xs text-[#9aa0ad]">
        People get their roles in Settings → Users & Roles. Employee is given automatically to everyone with an Employee Portal account;
        Manager automatically to everyone who is someone's reporting manager.
      </p>
    </div>
  );
}

function GroupRows({ group, modules, columns, has, locked, busy, onSet }) {
  return (
    <>
      <tr className="bg-[#f6f8fc]">
        <th colSpan={columns.length + 2} scope="colgroup" className="px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-[#4a5880]">
          {group}
        </th>
      </tr>
      {modules.map((m) => {
        const perms = Object.values(m.actions);
        const allOn = perms.every((p) => has(p.key));
        const rowBusy = perms.some((p) => busy.has(p.key));
        return (
          <tr key={m.module} className="border-b border-[#eef1f7] align-top last:border-0 hover:bg-[#fafbff]">
            <td className="px-5 py-3">
              <p className="font-semibold text-[#101a3a]">{m.label}</p>
              {m.description && <p className="text-xs text-[#676b7a]">{m.description}</p>}
            </td>
            <td className="px-2 py-3 text-center">
              <Toggle small on={allOn} locked={locked} busy={false} label={`${m.label}: all actions`} onChange={(v) => onSet(perms, v)} />
            </td>
            {columns.map((c) => {
              const p = m.actions[c.key];
              if (!p)
                return (
                  <td key={c.key} className="px-2 py-3 text-center text-[#d3d7e0]" aria-label="Not available">
                    —
                  </td>
                );
              return (
                <td key={c.key} className="px-2 py-3 text-center">
                  <div className="flex flex-col items-center gap-1">
                    <Toggle on={has(p.key)} locked={locked} busy={rowBusy && busy.has(p.key)} label={`${m.label}: ${p.action_label}`} onChange={(v) => onSet([p], v)} />
                    {p.action_label !== c.label && <span className="max-w-[7rem] text-[10.5px] leading-tight text-[#9aa0ad]">{p.action_label}</span>}
                  </div>
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
