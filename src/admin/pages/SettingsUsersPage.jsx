import { useEffect, useMemo, useState } from "react";
import { Crown, KeyRound, Loader2, Lock, Mail, Pencil, RefreshCw, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import PageHeader from "../PageHeader";
import { createUser, getUsers, setUserRoles, validateNewUser } from "@/lib/api/admin/rbac";
import { generatePassword } from "@/lib/api/admin/employees";
import { formatDateTime } from "@/employee/attendanceFormat";
import { useAccess } from "@/lib/access";
import { Alert, Avatar, Badge, Chips, Empty, Panel, SearchBox } from "@/components/portal/PortalUI";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL } from "@/components/portal/portalStyles";
import { checkRealEmail, REAL_EMAIL_ROLES } from "@/lib/emailCheck";
import { ChangeEmailForm, WelcomeBadge } from "../employees/SignInEmailCard";
import { supabase } from "@/lib/supabase/client";

const ROLES = [
  { key: "super_admin", label: "Super Admin", area: "admin", tone: "orange" },
  { key: "admin", label: "Admin", area: "admin", tone: "navy" },
  { key: "hr", label: "HR", area: "admin", tone: "violet" },
  { key: "manager", label: "Manager", area: "portal", tone: "teal" },
  { key: "team_lead", label: "Team Lead", area: "portal", tone: "sky" },
  { key: "employee", label: "Employee", area: "portal", tone: "slate" },
];
const ROLE = Object.fromEntries(ROLES.map((r) => [r.key, r]));
const FILTERS = [
  { key: "all", label: "All" },
  { key: "admin", label: "Admin area" },
  { key: "portal", label: "Employee Portal" },
];

const isAdminArea = (u) => u.roles.some((r) => ROLE[r]?.area === "admin");
// Several roles per person (migration 269): the given roles, plus Employee for an active portal account.
const ORDER = Object.fromEntries(ROLES.map((r, i) => [r.key, i]));
const sortRoles = (keys) => [...new Set(keys)].sort((a, b) => (ORDER[a] ?? 99) - (ORDER[b] ?? 99));
const effective = (u) => sortRoles([...u.roles, ...(u.employee_active ? ["employee"] : [])]);

/** Role buttons: pick ONE OR MORE roles (migration 269; no dropdowns). value = [roleKey, ...]. */
function RoleButtons({ value, onChange, options, disabledKeys = [], lockedKeys = [] }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Roles">
      {options.map((r) => {
        const on = value.includes(r.key) || lockedKeys.includes(r.key);
        const disabled = disabledKeys.includes(r.key) || lockedKeys.includes(r.key);
        return (
          <button
            key={r.key}
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={disabled}
            title={lockedKeys.includes(r.key) ? "Every Employee Portal account is an Employee" : undefined}
            onClick={() => onChange(on ? value.filter((k) => k !== r.key) : sortRoles([...value, r.key]))}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
              on
                ? "border-transparent bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] text-white shadow-sm"
                : "border-[#e3e9f5] bg-[#f8faff] text-[#676b7a] hover:border-[#1f4693]/30 hover:bg-[#eef2fb] hover:text-[#1f4693]"
            }`}
          >
            {r.key === "super_admin" && <Crown className="mr-1 inline h-3 w-3" aria-hidden="true" />}
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

function RoleEditor({ user, iAmSuper, onSaved, onCancel }) {
  // The given roles; "Employee" is always on for an Employee Portal account (migration 269).
  const [roles, setRoles] = useState(sortRoles(user.roles.filter((k) => k !== "employee")));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Employee / Manager / Team Lead only for Employee Portal accounts; Super Admin only by a Super Admin.
  const options = ROLES.filter((r) => r.area !== "portal" || user.employee_code);
  const disabledKeys = iAmSuper ? [] : ["super_admin"];
  const becomesAdmin = user.employee_code && roles.some((r) => ROLE[r]?.area === "admin");
  const lockedKeys = user.employee_code ? ["employee"] : [];

  async function save() {
    setBusy(true);
    setError("");
    if (!user.employee_code && roles.length === 0) {
      setBusy(false);
      return setError("Choose at least one role.");
    }
    if (roles.some((k) => REAL_EMAIL_ROLES.includes(k)) || user.employee_code) {
      const real = await checkRealEmail(user.sign_in);
      if (!real.ok) {
        setBusy(false);
        return setError(`${real.message} HR, Manager, Team Lead and Employee need their own real email; only Super Admin and Admin may use any email.`);
      }
    }
    const r = await setUserRoles(user.user_id, roles.filter((k) => k !== "employee"));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onSaved(r.roles ?? roles);
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-[#dce6f7] bg-white p-4 shadow-sm">
      <span className={LABEL}>Roles (choose one or more)</span>
      <RoleButtons value={roles} onChange={setRoles} options={options} disabledKeys={disabledKeys} lockedKeys={lockedKeys} />
      {user.employee_code && (
        <p className="text-xs text-[#676b7a]">
          <Lock className="mr-1 inline h-3 w-3" aria-hidden="true" />
          Employee is always on for an Employee Portal account. Add Manager, Team Lead, HR or Admin on top of it.
        </p>
      )}
      {!iAmSuper && <p className="text-xs text-[#9aa0ad]">Only a Super Admin can give or remove Super Admin.</p>}
      {becomesAdmin && (
        <Alert kind="warn" className="py-2 text-xs">
          This person can open the admin dashboard too. They switch between their roles with the “Role” button in the top bar, without signing out or punching out.
        </Alert>
      )}
      {error && (
        <Alert kind="err" className="py-2 text-xs">
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={save} className={BTN_PRIMARY}>
          {busy ? "Saving…" : "Save roles"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={BTN_SECONDARY}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddUser({ iAmSuper, onDone, onCancel }) {
  const [f, setF] = useState({ full_name: "", email: "", password: generatePassword(), roles: ["hr"] });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const set = (k, v) => {
    setF((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const errs = validateNewUser(f);
    if (Object.keys(errs).length) return setErrors(errs);
    setBusy(true);
    setError("");
    // Only Super Admin / Admin may use an email that is not a real mailbox (migration 267).
    if (f.roles.some((k) => REAL_EMAIL_ROLES.includes(k))) {
      const real = await checkRealEmail(f.email);
      if (!real.ok) {
        setBusy(false);
        setErrors({ email: real.message });
        return setError(real.message);
      }
    }
    const r = await createUser(f);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    const { data: emailed } = await supabase.rpc("rbac_email_ready");
    setCreated({ ...f, emailed: emailed === true });
  }

  if (created) {
    return (
      created.emailed ? (
      <Panel icon={UserPlus} title="User added" subtitle="The sign-in details were emailed.">
        <Alert kind="ok">
          {created.full_name}'s sign-in email and a one-time password were emailed to <b>{created.email.toLowerCase()}</b>. They must choose
          their own password at the first sign-in. If the mailbox does not exist you will get a notification “Mailbox does not exist”.
        </Alert>
        <button type="button" onClick={onDone} className={`${BTN_PRIMARY} mt-4`}>
          Done
        </button>
      </Panel>
      ) : (
      <Panel icon={UserPlus} title="User added" subtitle="Email is not set up yet — give these sign-in details to the person (the password is shown only now).">
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className={LABEL}>Name</dt>
            <dd className="text-sm font-semibold text-[#101a3a]">{created.full_name}</dd>
          </div>
          <div>
            <dt className={LABEL}>Sign-in ID</dt>
            <dd className="break-all text-sm font-semibold text-[#101a3a]">{created.email.toLowerCase()}</dd>
          </div>
          <div>
            <dt className={LABEL}>Password</dt>
            <dd className="font-mono text-sm font-semibold text-[#101a3a]">{created.password}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-[#676b7a]">Roles: {created.roles.map((k) => ROLE[k]?.label).join(", ")}. They sign in at /login.</p>
        <button type="button" onClick={onDone} className={`${BTN_PRIMARY} mt-4`}>
          Done
        </button>
      </Panel>
      )
    );
  }

  const field = (k, label, props = {}) => (
    <label htmlFor={`nu-${k}`} className="block">
      <span className={LABEL}>{label}</span>
      <input
        id={`nu-${k}`}
        value={f[k]}
        onChange={(e) => set(k, e.target.value)}
        className={`${INPUT(!!errors[k])} ${props.mono ? "font-mono" : ""}`}
        autoComplete="off"
        {...(props.type ? { type: props.type } : {})}
        placeholder={props.placeholder}
      />
      {errors[k] && <span className="mt-1 block text-xs text-red-600">{errors[k]}</span>}
    </label>
  );

  return (
    <Panel icon={UserPlus} title="Add user" subtitle="For people who work in the admin dashboard (Admin, HR). Employees are added in Employee Management.">
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {field("full_name", "Full name", { placeholder: "e.g. Priya Sharma" })}
        {field("email", "Sign-in email", { type: "email", placeholder: "name@company.com" })}
        <p className="-mt-2 text-xs text-[#9aa0ad] sm:col-span-2">HR needs their own real email. Super Admin and Admin may use any email.</p>
        <div className="sm:col-span-2">
          <span className={LABEL}>Temporary password</span>
          <div className="flex gap-2">
            <input value={f.password} onChange={(e) => set("password", e.target.value)} className={`${INPUT(!!errors.password)} font-mono`} aria-label="Temporary password" />
            <button type="button" onClick={() => set("password", generatePassword())} className={`${BTN_SECONDARY} shrink-0 px-3`} title="Generate a new password" aria-label="Generate a new password">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {errors.password && <span className="mt-1 block text-xs text-red-600">{errors.password}</span>}
        </div>
        <div className="sm:col-span-2">
          <span className={LABEL}>Roles (choose one or more)</span>
          <RoleButtons value={f.roles} onChange={(v) => set("roles", v)} options={ROLES.filter((r) => r.area === "admin")} disabledKeys={iAmSuper ? [] : ["super_admin"]} />
          {errors.roles && <span className="mt-1 block text-xs text-red-600">{errors.roles}</span>}
        </div>
        {error && (
          <Alert kind="err" className="sm:col-span-2">
            {error}
          </Alert>
        )}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button type="submit" disabled={busy} className={BTN_PRIMARY}>
            <UserPlus className="h-4 w-4" aria-hidden="true" /> {busy ? "Adding…" : "Add user"}
          </button>
          <button type="button" disabled={busy} onClick={onCancel} className={BTN_SECONDARY}>
            <X className="h-4 w-4" aria-hidden="true" /> Cancel
          </button>
        </div>
      </form>
    </Panel>
  );
}

/** Settings -> Users & Roles (migration 259): who has which role. */
export default function SettingsUsersPage() {
  const { access, can, refresh: refreshMyAccess } = useAccess();
  const iAmSuper = !!access?.is_super_admin;
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");
  const [emailEdit, setEmailEdit] = useState(null);

  useEffect(() => {
    let active = true;
    getUsers()
      .then((d) => active && setUsers(d))
      .catch(() => active && setError("Could not load users. Please refresh the page."));
    return () => {
      active = false;
    };
  }, [reload]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (users ?? [])
      .filter((u) => (filter === "all" ? true : filter === "admin" ? isAdminArea(u) : !!u.employee_code))
      .filter((u) => !needle || [u.full_name, u.sign_in, u.employee_code].some((v) => String(v ?? "").toLowerCase().includes(needle)));
  }, [users, filter, q]);

  const counts = {
    all: users?.length,
    admin: users?.filter(isAdminArea).length,
    portal: users?.filter((u) => u.employee_code).length,
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Users & Roles"
        icon={Users}
        subtitle="Everyone who can sign in, and their roles. What each role may do is set in Roles & Permissions."
        actions={
          !adding && can("settings.users.create") && (
            <button type="button" onClick={() => setAdding(true)} className={BTN_PRIMARY}>
              <UserPlus className="h-4 w-4" aria-hidden="true" /> Add user
            </button>
          )
        }
      />
      {msg && <Alert kind="ok">{msg}</Alert>}
      {adding && (
        <AddUser
          iAmSuper={iAmSuper}
          onCancel={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            setReload((n) => n + 1);
          }}
        />
      )}
      <Panel flush icon={KeyRound} title="Users" subtitle="A person can have several roles and switches between them from the top bar. Click “Edit roles” to change them.">
        <div className="flex flex-col gap-3 border-b border-[#eef1f7] bg-[#fafbff] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <Chips items={FILTERS.map((x) => ({ ...x, count: counts[x.key] }))} value={filter} onChange={setFilter} label="Show" />
          <SearchBox value={q} onChange={setQ} placeholder="Search name, sign-in ID, employee ID…" />
        </div>
        {error ? (
          <div className="p-5">
            <Alert kind="err">{error}</Alert>
          </div>
        ) : !users ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-[#676b7a]" role="status">
            <Loader2 className="h-4 w-4 animate-spin text-[#1f4693]" aria-hidden="true" /> Loading…
          </p>
        ) : shown.length === 0 ? (
          <Empty icon={Users} title="No users found" />
        ) : (
          <ul className="divide-y divide-[#eef1f7]">
            {shown.map((u) => (
              <li key={u.user_id} className="px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Avatar name={u.full_name} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#101a3a]">
                      {u.full_name}
                      {u.employee_code && <span className="font-mono text-[11px] font-normal text-[#9aa0ad]">{u.employee_code}</span>}
                      {u.is_self && <Badge tone="blue">You</Badge>}
                      {u.employee_code && !u.employee_active && <Badge tone="red">Portal access off</Badge>}
                    </p>
                    <p className="truncate text-xs text-[#676b7a]">
                      {u.sign_in}
                      {u.last_sign_in_at ? ` · last sign-in ${formatDateTime(u.last_sign_in_at)}` : " · never signed in"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <WelcomeBadge welcome={u.welcome} />
                      {effective(u).length === 0 && <Badge tone="slate">No role</Badge>}
                      {effective(u).map((k) => (
                        <Badge key={k} tone={ROLE[k]?.tone ?? "slate"}>
                          {k === "super_admin" && <Crown className="h-3 w-3" aria-hidden="true" />}
                          {ROLE[k]?.label ?? k}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {!u.is_self && editing !== u.user_id && can("settings.users.edit") && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(u.user_id);
                        setMsg("");
                      }}
                      className={BTN_SECONDARY}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" /> Edit roles
                    </button>
                  )}
                  {!u.is_self && can("settings.users.edit") && emailEdit !== u.user_id && (
                    <button type="button" onClick={() => setEmailEdit(u.user_id)} className={BTN_SECONDARY}>
                      <Mail className="h-4 w-4" aria-hidden="true" /> Change email
                    </button>
                  )}
                  {u.is_self && (
                    <span className="inline-flex items-center gap-1 text-xs text-[#9aa0ad]">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Your own roles are changed by another Super Admin
                    </span>
                  )}
                </div>
                {!u.is_self && can("settings.users.edit") && (u.welcome?.status === "bounced" || u.welcome?.status === "failed" || emailEdit === u.user_id) && (
                  <div className="mt-3 rounded-xl border border-[#dce6f7] bg-white p-4 shadow-sm">
                    <ChangeEmailForm
                      userId={u.user_id}
                      currentEmail={u.sign_in}
                      needsRealEmail={!!u.employee_code || u.roles.length === 0 || u.roles.some((k) => !["super_admin", "admin"].includes(k))}
                      onDone={() => setReload((n) => n + 1)}
                      onCancel={emailEdit === u.user_id ? () => setEmailEdit(null) : undefined}
                    />
                  </div>
                )}
                {editing === u.user_id && (
                  <RoleEditor
                    user={u}
                    iAmSuper={iAmSuper}
                    onCancel={() => setEditing(null)}
                    onSaved={(roles) => {
                      setUsers((list) => list.map((x) => (x.user_id === u.user_id ? { ...x, roles } : x)));
                      setEditing(null);
                      setMsg(`Roles saved for ${u.full_name}. They apply the next time ${u.full_name} opens a page.`);
                      refreshMyAccess();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
