import { useEffect, useState } from "react";
import Link from "@/lib/nx/link";
import {
  Briefcase,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  HeartPulse,
  Loader2,
  Palmtree,
  PartyPopper,
  Plane,
  Search,
  Sun,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import {
  HALF_DAY,
  LEAVE_STATUS,
  applyLeave,
  cancelLeave,
  getTeamLeave,
  getLeaveOverview,
  previewLeaveDays,
  validateLeave,
} from "@/lib/api/employee/leave";
import { Alert, Avatar, Badge, Chips, Empty, Panel } from "@/components/portal/PortalUI";
import { ACCENTS, BTN_SECONDARY, LABEL, TABLE, TABLE_WRAP, TD, TH, TR } from "@/components/portal/portalStyles";
import { dayName, formatDate, todayIst } from "../attendanceFormat";
import { BTN_PRIMARY, INPUT } from "../reportsUi";
import { getMessageOptions } from "@/lib/api/employee/notifications";
import { useAccess } from "@/lib/access";

const num = (v) => Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });

/** Badge tone per leave status. */
const STATUS_TONE = { manager_review: "amber", pending: "amber", manager_pending: "blue", approved: "green", rejected: "red", cancelled: "slate" };

export function LeaveStatusChip({ status }) {
  const s = LEAVE_STATUS[status];
  if (!s) return null;
  const tone = STATUS_TONE[status];
  if (!tone) return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.chip}`}>{s.label}</span>;
  return (
    <Badge tone={tone} dot>
      {s.label}
    </Badge>
  );
}

/** "07 Dec 2026" or "07 Dec 2026 – 12 Dec 2026" (+ half day). */
export function leaveDates(r) {
  const one = r.start_date === r.end_date;
  const base = one ? formatDate(r.start_date) : `${formatDate(r.start_date)} – ${formatDate(r.end_date)}`;
  return r.half_day ? `${base} (${HALF_DAY[r.half_day]})` : base;
}

// "Team requests" shows only for reporting managers (two-step approval, migration 255).
export function LeaveTabs({ active, teamSize, waiting }) {
  const tab = (on) =>
    `inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-all ${
      on
        ? "bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] text-white shadow-[0_4px_12px_-4px_rgba(31,70,147,0.55)]"
        : "text-[#4a5068] hover:bg-[#f4f7ff] hover:text-[#1f4693]"
    }`;
  return (
    <div className="max-w-full overflow-x-auto">
      <nav aria-label="Leave" className="inline-flex min-w-max gap-1 rounded-xl border border-[#e3e9f5] bg-white p-1 shadow-sm">
        <Link href="/employee/leave" className={tab(active === "mine")} aria-current={active === "mine" ? "page" : undefined}>
          <Plane size={16} aria-hidden="true" /> My leave
        </Link>
        {teamSize > 0 && (
          <Link href="/employee/leave/team" className={tab(active === "team")} aria-current={active === "team" ? "page" : undefined}>
            <Users size={16} aria-hidden="true" /> Team requests
            {waiting > 0 && <span className="min-w-[1.25rem] rounded-full bg-[#f96706] px-1.5 text-center text-[10.5px] font-bold leading-5 text-white">{waiting}</span>}
          </Link>
        )}
      </nav>
    </div>
  );
}

const BALANCE_LOOK = [
  { accent: "orange", icon: Palmtree },
  { accent: "blue", icon: HeartPulse },
  { accent: "teal", icon: Briefcase },
  { accent: "violet", icon: Sun },
  { accent: "green", icon: Plane },
  { accent: "amber", icon: CalendarDays },
];

function Balances({ balances }) {
  return (
    <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-4">
      {balances.map((b, i) => {
        const unlimited = b.allowed == null;
        const left = unlimited ? null : Number(b.allowed) - Number(b.approved) - Number(b.pending);
        const look = BALANCE_LOOK[i % BALANCE_LOOK.length];
        const a = ACCENTS[look.accent];
        const Icon = look.icon;
        return (
          <div
            key={b.code}
            className="relative overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white p-5 pt-6 shadow-[0_1px_2px_rgba(16,26,58,0.04),0_8px_24px_-12px_rgba(16,26,58,0.10)]"
          >
            <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1" style={{ backgroundImage: `linear-gradient(90deg, ${a.from}, ${a.to})` }} />
            <span
              className="flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-[0_6px_14px_-4px_rgba(16,26,58,0.35)]"
              style={{ backgroundImage: `linear-gradient(135deg, ${a.from}, ${a.to})` }}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="mt-4 text-[28px] font-extrabold leading-none tabular-nums tracking-tight text-[#101a3a]">
              {unlimited ? "No limit" : num(left)}
              {!unlimited && <span className="ml-1 text-sm font-semibold tracking-normal text-[#9aa0ad]">/ {num(b.allowed)} left</span>}
            </p>
            <p className="mt-1.5 text-sm font-semibold text-[#2b303b]">{b.name}</p>
            <p className="mt-0.5 text-xs text-[#676b7a]">
              Used {num(b.approved)}
              {Number(b.pending) > 0 && <> · Pending {num(b.pending)}</>}
              {!b.is_paid && <> · Unpaid</>}
            </p>
            {!unlimited && Number(b.allowed) > 0 && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#eef0f5]">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    backgroundImage: `linear-gradient(90deg, ${a.from}, ${a.to})`,
                    width: `${Math.min(100, ((Number(b.approved) + Number(b.pending)) / Number(b.allowed)) * 100)}%`,
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const EMPTY = { leave_type: "", start_date: "", end_date: "", half_day: "", reason: "", manager_id: "", manager_name: "" };

/**
 * Reporting manager: type a name. Matching colleagues are shown as buttons to
 * pick (they get a notification); a name that is not in the list is also fine.
 */
function ManagerField({ id, name, people, error, onChange }) {
  const [focused, setFocused] = useState(false);
  const q = name.trim().toLowerCase();
  const matches = q
    ? people.filter((p) => [p.full_name, p.employee_code, p.designation].some((v) => v?.toLowerCase().includes(q))).slice(0, 6)
    : [];
  const picked = id ? people.find((p) => p.id === id) : null;
  return (
    <div>
      <label htmlFor="lv-mgr" className={LABEL}>
        Reporting manager
      </label>
      <p className="-mt-0.5 mb-2 text-xs text-[#9aa0ad]">Your reporting manager reviews it first, then the admin, then your manager gives the final approval. (Without a manager in the portal, the admin decides.)</p>
      {picked ? (
        <div className="flex items-center gap-3 rounded-xl border border-[#1f4693]/30 bg-[#f4f7ff] px-3 py-2.5 text-sm">
          <Avatar name={picked.full_name} size="h-8 w-8 text-xs" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 font-semibold text-[#101a3a]">
              {picked.full_name}
              <UserCheck size={14} className="text-[#1f4693]" aria-hidden="true" />
            </span>
            <span className="block truncate text-xs text-[#676b7a]">{picked.designation ?? picked.employee_code} · will be informed</span>
          </span>
          <button
            type="button"
            onClick={() => onChange("", "")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#64748b] transition-colors hover:bg-white hover:text-[#1f4693]"
            aria-label="Change reporting manager"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9aa0ad]" aria-hidden="true" />
            <input
              id="lv-mgr"
              value={name}
              maxLength={120}
              autoComplete="off"
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              onChange={(e) => onChange("", e.target.value)}
              placeholder="Type your reporting manager's name"
              aria-invalid={!!error}
              className={`${INPUT(error)} pl-8`}
            />
          </div>
          {focused && matches.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Matching colleagues">
              {matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onChange(p.id, p.full_name)}
                  className="inline-flex items-center gap-2 rounded-full border border-[#e3e9f5] bg-white py-1 pl-1 pr-3 text-left text-xs transition-colors hover:border-[#1f4693]/30 hover:bg-[#eef2fb]"
                >
                  <Avatar name={p.full_name} size="h-6 w-6 text-[10px]" />
                  <span>
                    <span className="font-semibold text-[#2b303b]">{p.full_name}</span>{" "}
                    <span className="text-[#9aa0ad]">{p.designation ?? p.employee_code}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {name.trim() && !matches.length && (
            <p className="mt-1.5 text-xs text-[#676b7a]">Not in the portal — the name will be saved with your request.</p>
          )}
        </>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ApplyForm({ overview, onApplied }) {
  const today = todayIst().iso;
  // Starts with the manager from the profile, if one is set.
  const [f, setF] = useState(() => ({
    ...EMPTY,
    manager_id: overview.manager?.id ?? "",
    manager_name: overview.manager?.full_name ?? "",
  }));
  const [people, setPeople] = useState([]);
  useEffect(() => {
    getMessageOptions()
      .then((o) => setPeople(o?.people ?? []))
      .catch(() => {});
  }, []);
  const [errors, setErrors] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ kind: "", text: "" });
  const [preview, setPreview] = useState({ key: "", days: null });

  const set = (k, v) => {
    setF((x) => {
      const n = { ...x, [k]: v };
      if (k === "start_date" && (!x.end_date || x.end_date < v)) n.end_date = v; // follow start date
      if ((k === "start_date" || k === "end_date") && n.start_date !== n.end_date) n.half_day = "";
      return n;
    });
    setStatus({ kind: "", text: "" });
  };

  const single = f.start_date && f.start_date === f.end_date;
  const key = f.start_date && f.end_date && f.end_date >= f.start_date ? `${f.start_date}|${f.end_date}|${f.half_day}` : "";
  useEffect(() => {
    if (!key) return undefined;
    let active = true;
    const [s, e, h] = key.split("|");
    const id = setTimeout(() => {
      previewLeaveDays(s, e, h)
        .then((days) => active && setPreview({ key, days }))
        .catch(() => {});
    }, 250);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [key]);
  const days = preview.key === key ? preview.days : null;

  const bal = overview.balances.find((b) => b.code === f.leave_type);
  const left = bal && bal.allowed != null ? Number(bal.allowed) - Number(bal.approved) - Number(bal.pending) : null;
  const overBalance = left != null && days != null && days > left;

  async function submit(e) {
    e.preventDefault();
    const v = validateLeave(f);
    setErrors(v);
    if (v) return;
    setBusy(true);
    const res = await applyLeave(f);
    setBusy(false);
    if (!res.ok) return setStatus({ kind: "error", text: res.message });
    setF({ ...EMPTY, manager_id: f.manager_id, manager_name: f.manager_name }); // keep the manager for next time
    setStatus({ kind: "ok", text: `Leave applied (${num(res.request.days)} day(s)) and sent to the admin for approval. Reporting manager informed: ${res.request.approver}.` });
    onApplied();
  }

  const durations = [{ key: "full", label: "Full day" }, ...Object.entries(HALF_DAY).map(([k, label]) => ({ key: k, label }))];

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div role="radiogroup" aria-label="Leave type">
        <p className={LABEL}>Leave type</p>
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          {overview.balances.map((b) => {
            const on = f.leave_type === b.code;
            const l = b.allowed == null ? null : Number(b.allowed) - Number(b.approved) - Number(b.pending);
            return (
              <button
                key={b.code}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set("leave_type", b.code)}
                className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left text-sm font-semibold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693] ${
                  on
                    ? "border-transparent bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] text-white shadow-[0_4px_12px_-4px_rgba(31,70,147,0.55)]"
                    : "border-[#e3e9f5] bg-[#f8faff] text-[#2b303b] hover:border-[#1f4693]/30 hover:bg-[#eef2fb]"
                }`}
              >
                <span className="truncate">{b.name}</span>
                <span className={`shrink-0 text-xs font-medium ${on ? "text-white/80" : "text-[#9aa0ad]"}`}>{l == null ? "no limit" : `${num(l)} left`}</span>
              </button>
            );
          })}
        </div>
        {errors?.leave_type && <p className="mt-1 text-xs text-red-600">{errors.leave_type}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="lv-start" className={LABEL}>
            From
          </label>
          <input id="lv-start" type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} className={INPUT(errors?.start_date)} />
          {errors?.start_date && <p className="mt-1 text-xs text-red-600">{errors.start_date}</p>}
        </div>
        <div>
          <label htmlFor="lv-end" className={LABEL}>
            To
          </label>
          <input
            id="lv-end"
            type="date"
            value={f.end_date}
            min={f.start_date || undefined}
            onChange={(e) => set("end_date", e.target.value)}
            className={INPUT(errors?.end_date)}
          />
          {errors?.end_date && <p className="mt-1 text-xs text-red-600">{errors.end_date}</p>}
        </div>
      </div>

      {single && (
        <div>
          <p className={LABEL} aria-hidden="true">
            Duration
          </p>
          <Chips label="Duration" size="md" items={durations} value={f.half_day || "full"} onChange={(k) => set("half_day", k === "full" ? "" : k)} />
        </div>
      )}

      {key && (
        <p
          className={`flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm ${
            overBalance ? "border-red-200 bg-red-50 text-red-700" : "border-[#dce6f7] bg-[#f5f8ff] text-[#1f4693]"
          }`}
          aria-live="polite"
        >
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {days == null
              ? "Counting leave days…"
              : days === 0
                ? "These dates are only Sundays or company holidays, so no leave is needed."
                : `${num(days)} leave day(s) (Sundays and company holidays are not counted).${
                    overBalance ? ` You only have ${num(left)} day(s) of ${bal.name} left.` : ""
                  }`}
          </span>
        </p>
      )}
      {f.start_date && f.start_date < today && (
        <p className="-mt-2 text-xs text-[#676b7a]">This leave is in the past. You can apply up to 30 days back (e.g. sick leave).</p>
      )}

      <ManagerField
        id={f.manager_id}
        name={f.manager_name}
        people={people}
        error={errors?.manager}
        onChange={(id, name) => {
          setF((x) => ({ ...x, manager_id: id, manager_name: name }));
          setStatus({ kind: "", text: "" });
        }}
      />

      <div>
        <label htmlFor="lv-reason" className={LABEL}>
          Reason
        </label>
        <textarea
          id="lv-reason"
          rows={3}
          maxLength={1000}
          value={f.reason}
          onChange={(e) => set("reason", e.target.value)}
          className={INPUT(errors?.reason)}
        />
        {errors?.reason && <p className="mt-1 text-xs text-red-600">{errors.reason}</p>}
      </div>

      <Alert kind={status.kind === "error" ? "err" : "ok"}>{status.text}</Alert>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={BTN_PRIMARY} disabled={busy}>
          <ClipboardCheck size={16} aria-hidden="true" />
          {busy ? "Applying…" : "Apply for leave"}
        </button>
      </div>
    </form>
  );
}

function History({ requests, onChanged }) {
  const { can } = useAccess();
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function doCancel(id) {
    setBusy(true);
    const res = await cancelLeave(id);
    setBusy(false);
    setConfirmId(null);
    if (!res.ok) return setMessage(res.message);
    setMessage("");
    onChanged();
  }

  if (requests.length === 0) return <Empty icon={ClipboardList} title="No leave requests this year." />;
  return (
    <div className="flex flex-col">
      <Alert kind="err" className="m-4">
        {message}
      </Alert>
      <div className={TABLE_WRAP}>
        <table className={`${TABLE} min-w-[720px]`}>
          <thead>
            <tr>
              <th className={TH}>Type</th>
              <th className={TH}>Dates</th>
              <th className={TH}>Days</th>
              <th className={TH}>Reason</th>
              <th className={TH}>Status</th>
              <th className={TH}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => {
              // Only while nobody has approved yet (manager review or with the admin) — migrations 254 / 257.
              const canCancel = can("emp.leave.delete") && (r.status === "manager_review" || r.status === "pending");
              return (
                <tr key={r.id} className={TR}>
                  <td className={`${TD} font-semibold text-[#101a3a]`}>{r.leave_name}</td>
                  <td className={`${TD} whitespace-nowrap`}>{leaveDates(r)}</td>
                  <td className={`${TD} font-semibold tabular-nums text-[#101a3a]`}>{num(r.days)}</td>
                  <td className={`${TD} max-w-[16rem] text-[#676b7a]`}>
                    <span className="line-clamp-2 break-words">{r.reason}</span>
                  </td>
                  <td className={TD}>
                    {/* Only the status (user, 2026-11-24): not who approved. A rejection still shows its reason. */}
                    <LeaveStatusChip status={r.status} />
                    {r.status === "rejected" && r.decision_comment && (
                      <p className="mt-1 max-w-[18rem] break-words text-xs text-[#676b7a]">Reason: {r.decision_comment}</p>
                    )}
                  </td>
                  <td className={`${TD} text-right`}>
                    {canCancel &&
                      (confirmId === r.id ? (
                        <span className="inline-flex flex-wrap justify-end gap-1">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => doCancel(r.id)}
                            className="whitespace-nowrap rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:opacity-60"
                          >
                            {busy ? "Cancelling…" : "Yes, cancel"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(null)}
                            className="rounded-lg border border-[#dce6f7] bg-white px-2.5 py-1 text-xs font-semibold text-[#1f4693] transition-colors hover:bg-[#f0f4ff]"
                          >
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmId(r.id)}
                          className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50"
                        >
                          Cancel
                        </button>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Holidays({ holidays, year }) {
  const today = todayIst().iso;
  if (holidays.length === 0) return <Empty icon={PartyPopper} message={`No company holidays have been added for ${year} yet.`} />;
  return (
    <ul className="flex flex-col gap-2">
      {holidays.map((h) => {
        const past = h.date < today;
        return (
          <li
            key={h.date}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
              past ? "border-[#f0f2f6] bg-[#fafbfc] opacity-60" : "border-[#e7e9ee] bg-white hover:border-teal-200 hover:bg-teal-50/40"
            }`}
          >
            <span
              className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl ${
                past ? "bg-slate-100 text-slate-500" : "bg-gradient-to-br from-[#3089a6] to-[#2bb3c9] text-white shadow-[0_6px_14px_-6px_rgba(48,137,166,0.6)]"
              }`}
            >
              <span className="text-sm font-bold leading-none">{h.date.slice(8)}</span>
              <span className="mt-0.5 text-[10px] font-semibold uppercase">{formatDate(h.date).split(" ")[1]}</span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-[#101a3a]">{h.name}</span>
              <span className="text-xs text-[#9aa0ad]">{dayName(h.date)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function LeavePage() {
  const thisYear = todayIst().y;
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    getLeaveOverview(year)
      .then((d) => {
        if (!active) return;
        setData(d);
        setError("");
      })
      .catch(() => active && setError("Could not load your leave. Please refresh the page."));
    return () => {
      active = false;
    };
  }, [year, reload]);

  // Reporting managers also get "Team requests" (requests the admin approved, waiting for them).
  const [team, setTeam] = useState(null);
  useEffect(() => {
    let active = true;
    getTeamLeave()
      .then((t) => active && setTeam(t))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const teamWaiting = team?.requests?.filter((r) => r.status === "manager_review" || r.status === "manager_pending").length ?? 0;
  const { can } = useAccess();
  const isManager = can("team.leave") && ((team?.team_size ?? 0) > 0 || (team?.requests?.length ?? 0) > 0);

  const current = data?.year === year ? data : null;
  const navBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#dce6f7] bg-white text-[#1f4693] transition-colors hover:bg-[#f0f4ff] disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      {isManager && <LeaveTabs active="mine" teamSize={1} waiting={teamWaiting} />}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex flex-1 items-center gap-2 text-base font-bold text-[#101a3a]">
          <span className="h-5 w-1 rounded-full bg-gradient-to-b from-[#f7941e] to-[#f96706]" aria-hidden="true" />
          Leave balance {year}
        </h2>
        <button type="button" onClick={() => setYear((y) => y - 1)} className={navBtn} aria-label="Previous year">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={() => setYear(thisYear)} disabled={year === thisYear} className={`${BTN_SECONDARY} !px-3 !py-1.5`}>
          This year
        </button>
        <button type="button" onClick={() => setYear((y) => y + 1)} disabled={year > thisYear} className={navBtn} aria-label="Next year">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <Alert kind="err">{error}</Alert>
      {!current && !error && (
        <p className="flex items-center gap-2 text-sm text-[#676b7a]">
          <Loader2 className="h-4 w-4 animate-spin text-[#1f4693]" aria-hidden="true" />
          Loading…
        </p>
      )}

      {current && (
        <>
          <Balances balances={current.balances} />

          <div className="grid gap-5 lg:grid-cols-5">
            {can("emp.leave.create") && (
              <Panel icon={Palmtree} title="Apply for leave" subtitle="Sent to the admin for approval" className="lg:col-span-3">
                <ApplyForm overview={current} onApplied={() => setReload((r) => r + 1)} />
              </Panel>
            )}
            <Panel
              icon={CalendarDays}
              title={`Company holidays ${year}`}
              subtitle="Not counted as leave"
              className={can("emp.leave.create") ? "lg:col-span-2" : "lg:col-span-5"}
            >
              <Holidays holidays={current.holidays} year={year} />
            </Panel>
          </div>

          <Panel icon={ClipboardList} title={`Leave history & approval status — ${year}`} flush>
            <History requests={current.requests} onChanged={() => setReload((r) => r + 1)} />
          </Panel>
        </>
      )}
    </div>
  );
}
