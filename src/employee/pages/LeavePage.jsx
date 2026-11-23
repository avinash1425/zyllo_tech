import { useEffect, useState } from "react";
import Link from "@/lib/nx/link";
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck, Palmtree, Plane, Search, UserCheck, Users, X } from "lucide-react";
import {
  HALF_DAY,
  LEAVE_STATUS,
  applyLeave,
  cancelLeave,
  getLeaveOverview,
  previewLeaveDays,
  validateLeave,
} from "@/lib/api/employee/leave";
import { dayName, formatDate, todayIst } from "../attendanceFormat";
import { CARD } from "../projectsUi";
import { BTN_PRIMARY, INPUT } from "../reportsUi";
import { getMessageOptions } from "@/lib/api/employee/notifications";

const num = (v) => Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });

export function LeaveStatusChip({ status }) {
  const s = LEAVE_STATUS[status];
  if (!s) return null;
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.chip}`}>{s.label}</span>;
}

/** "07 Dec 2026" or "07 Dec 2026 – 12 Dec 2026" (+ half day). */
export function leaveDates(r) {
  const one = r.start_date === r.end_date;
  const base = one ? formatDate(r.start_date) : `${formatDate(r.start_date)} – ${formatDate(r.end_date)}`;
  return r.half_day ? `${base} (${HALF_DAY[r.half_day]})` : base;
}

// Not shown for now (user asked to hide "Team requests" on 2026-11-23); kept for TeamLeavePage.
export function LeaveTabs({ active, teamSize, waiting }) {
  const tab = (on) =>
    `inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold ${
      on ? "bg-[#1f4693] text-white" : "border border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]"
    }`;
  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/employee/leave" className={tab(active === "mine")}>
        <Plane size={16} aria-hidden="true" /> My leave
      </Link>
      {teamSize > 0 && (
        <Link href="/employee/leave/team" className={tab(active === "team")}>
          <Users size={16} aria-hidden="true" /> Team requests
          {waiting > 0 && <span className="rounded-full bg-[#f7941e] px-1.5 text-[11px] font-bold text-white">{waiting}</span>}
        </Link>
      )}
    </div>
  );
}

function Balances({ balances }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {balances.map((b) => {
        const unlimited = b.allowed == null;
        const left = unlimited ? null : Number(b.allowed) - Number(b.approved) - Number(b.pending);
        return (
          <div key={b.code} className="rounded-2xl border border-[#e7e9ee] bg-white p-4">
            <p className="text-xs font-semibold text-[#4a5880]">{b.name}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-[#101a3a]">
              {unlimited ? "No limit" : num(left)}
              {!unlimited && <span className="ml-1 text-sm font-semibold text-[#9aa0ad]">/ {num(b.allowed)} left</span>}
            </p>
            <p className="mt-1 text-xs text-[#676b7a]">
              Used {num(b.approved)}
              {Number(b.pending) > 0 && <> · Pending {num(b.pending)}</>}
              {!b.is_paid && <> · Unpaid</>}
            </p>
            {!unlimited && Number(b.allowed) > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eef0f5]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#f7941e] to-[#1f4693]"
                  style={{ width: `${Math.min(100, ((Number(b.approved) + Number(b.pending)) / Number(b.allowed)) * 100)}%` }}
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
      <label htmlFor="lv-mgr" className="mb-1 block text-xs font-semibold text-[#4a5880]">
        Reporting manager
      </label>
      {picked ? (
        <div className="flex items-center gap-2 rounded-lg border border-[#1f4693] bg-[#f0f4ff] px-3 py-2 text-sm">
          <UserCheck size={16} className="text-[#1f4693]" aria-hidden="true" />
          <span className="flex-1">
            <span className="font-semibold text-[#101a3a]">{picked.full_name}</span>{" "}
            <span className="text-xs text-[#676b7a]">{picked.designation ?? picked.employee_code} · will be notified</span>
          </span>
          <button
            type="button"
            onClick={() => onChange("", "")}
            className="rounded p-1 text-[#4a5880] hover:bg-white"
            aria-label="Change reporting manager"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9aa0ad]" aria-hidden="true" />
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
            <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Matching colleagues">
              {matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onChange(p.id, p.full_name)}
                  className="rounded-lg border border-[#dce1ec] bg-white px-2.5 py-1.5 text-left text-xs hover:bg-[#f6f7fb]"
                >
                  <span className="font-semibold text-[#2b303b]">{p.full_name}</span>{" "}
                  <span className="text-[#9aa0ad]">{p.designation ?? p.employee_code}</span>
                </button>
              ))}
            </div>
          )}
          {name.trim() && !matches.length && (
            <p className="mt-1 text-xs text-[#676b7a]">Not in the portal — the name will be saved with your request.</p>
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
    setStatus({ kind: "ok", text: `Leave applied (${num(res.request.days)} day(s)). Reporting manager: ${res.request.approver}.` });
    onApplied();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div role="radiogroup" aria-label="Leave type">
        <p className="mb-1 text-xs font-semibold text-[#4a5880]">Leave type</p>
        <div className="flex flex-wrap gap-1.5">
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
                className={`rounded-lg border px-3 py-1.5 text-left text-xs font-semibold ${
                  on ? "border-[#1f4693] bg-[#1f4693] text-white" : "border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]"
                }`}
              >
                {b.name}
                <span className={`ml-1 font-normal ${on ? "text-white/80" : "text-[#9aa0ad]"}`}>{l == null ? "· no limit" : `· ${num(l)} left`}</span>
              </button>
            );
          })}
        </div>
        {errors?.leave_type && <p className="mt-1 text-xs text-red-600">{errors.leave_type}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="lv-start" className="mb-1 block text-xs font-semibold text-[#4a5880]">
            From
          </label>
          <input id="lv-start" type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} className={INPUT(errors?.start_date)} />
          {errors?.start_date && <p className="mt-1 text-xs text-red-600">{errors.start_date}</p>}
        </div>
        <div>
          <label htmlFor="lv-end" className="mb-1 block text-xs font-semibold text-[#4a5880]">
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
        <div role="radiogroup" aria-label="Duration">
          <p className="mb-1 text-xs font-semibold text-[#4a5880]">Duration</p>
          <div className="flex flex-wrap gap-1.5">
            {[{ value: "", label: "Full day" }, ...Object.entries(HALF_DAY).map(([value, label]) => ({ value, label }))].map((o) => (
              <button
                key={o.value || "full"}
                type="button"
                role="radio"
                aria-checked={f.half_day === o.value}
                onClick={() => set("half_day", o.value)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                  f.half_day === o.value ? "border-[#1f4693] bg-[#1f4693] text-white" : "border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {key && (
        <p className={`rounded-lg px-3 py-2 text-sm ${overBalance ? "bg-red-50 text-red-700" : "bg-[#f0f4ff] text-[#1f4693]"}`} aria-live="polite">
          {days == null
            ? "Counting leave days…"
            : days === 0
              ? "These dates are only Sundays or company holidays, so no leave is needed."
              : `${num(days)} leave day(s) (Sundays and company holidays are not counted).${
                  overBalance ? ` You only have ${num(left)} day(s) of ${bal.name} left.` : ""
                }`}
        </p>
      )}
      {f.start_date && f.start_date < today && (
        <p className="text-xs text-[#676b7a]">This leave is in the past. You can apply up to 30 days back (e.g. sick leave).</p>
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
        <label htmlFor="lv-reason" className="mb-1 block text-xs font-semibold text-[#4a5880]">
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

      {status.text && (
        <p
          role={status.kind === "error" ? "alert" : "status"}
          className={`rounded-lg px-3 py-2 text-sm ${status.kind === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}
        >
          {status.text}
        </p>
      )}
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
  const today = todayIst().iso;
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

  if (requests.length === 0) return <p className="py-6 text-center text-sm text-[#676b7a]">No leave requests this year.</p>;
  return (
    <div className="flex flex-col gap-2">
      {message && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-[#eef0f5] text-[11px] font-semibold uppercase tracking-wider text-[#9aa0ad]">
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Dates</th>
              <th className="py-2 pr-3">Days</th>
              <th className="py-2 pr-3">Reason</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => {
              const canCancel = r.status === "pending" || (r.status === "approved" && r.start_date > today);
              return (
                <tr key={r.id} className="border-b border-[#f3f4f8] align-top last:border-0">
                  <td className="py-2.5 pr-3 font-medium text-[#101a3a]">{r.leave_name}</td>
                  <td className="py-2.5 pr-3">{leaveDates(r)}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{num(r.days)}</td>
                  <td className="max-w-[16rem] py-2.5 pr-3 text-[#676b7a]">
                    <span className="line-clamp-2 break-words">{r.reason}</span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <LeaveStatusChip status={r.status} />
                    {r.status === "pending" && r.approver && <p className="mt-1 text-xs text-[#9aa0ad]">Manager: {r.approver}</p>}
                    {["approved", "rejected"].includes(r.status) && (
                      <p className="mt-1 text-xs text-[#676b7a]">
                        By {r.decided_by ?? "manager"}
                        {r.decision_comment ? `: ${r.decision_comment}` : ""}
                      </p>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    {canCancel &&
                      (confirmId === r.id ? (
                        <span className="inline-flex flex-wrap justify-end gap-1">
                          <button type="button" disabled={busy} onClick={() => doCancel(r.id)} className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">
                            {busy ? "Cancelling…" : "Yes, cancel"}
                          </button>
                          <button type="button" onClick={() => setConfirmId(null)} className="rounded-lg border border-[#dce1ec] px-2.5 py-1 text-xs font-semibold">
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirmId(r.id)} className="text-xs font-semibold text-red-600 hover:underline">
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
  if (holidays.length === 0) return <p className="text-sm text-[#676b7a]">No company holidays have been added for {year} yet.</p>;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {holidays.map((h) => {
        const past = h.date < today;
        return (
          <li key={h.date} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${past ? "border-[#f0f2f6] opacity-60" : "border-[#e7e9ee]"}`}>
            <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-teal-50 text-teal-800">
              <span className="text-sm font-bold leading-none">{h.date.slice(8)}</span>
              <span className="text-[10px] font-semibold uppercase">{formatDate(h.date).split(" ")[1]}</span>
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

  const current = data?.year === year ? data : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-base font-bold text-[#101a3a]">Leave balance {year}</h2>
        <button type="button" onClick={() => setYear((y) => y - 1)} className="rounded-lg border border-[#e7e9ee] bg-white p-2 hover:bg-[#f6f7fb]" aria-label="Previous year">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setYear(thisYear)}
          disabled={year === thisYear}
          className="rounded-lg border border-[#e7e9ee] bg-white px-3 py-1.5 text-sm font-semibold hover:bg-[#f6f7fb] disabled:opacity-50"
        >
          This year
        </button>
        <button
          type="button"
          onClick={() => setYear((y) => y + 1)}
          disabled={year > thisYear}
          className="rounded-lg border border-[#e7e9ee] bg-white p-2 hover:bg-[#f6f7fb] disabled:opacity-50"
          aria-label="Next year"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!current && !error && <p className="text-sm text-[#676b7a]">Loading…</p>}

      {current && (
        <>
          <Balances balances={current.balances} />

          <div className="grid gap-4 lg:grid-cols-5">
            <section className={`${CARD} lg:col-span-3`} aria-labelledby="lv-apply">
              <h2 id="lv-apply" className="mb-4 flex items-center gap-2 text-base font-bold text-[#101a3a]">
                <Palmtree className="h-5 w-5 text-[#1f4693]" aria-hidden="true" /> Apply for leave
              </h2>
              <ApplyForm overview={current} onApplied={() => setReload((r) => r + 1)} />
            </section>
            <section className={`${CARD} lg:col-span-2`} aria-labelledby="lv-hol">
              <h2 id="lv-hol" className="mb-3 flex items-center gap-2 text-base font-bold text-[#101a3a]">
                <CalendarDays className="h-5 w-5 text-[#1f4693]" aria-hidden="true" /> Company holidays {year}
              </h2>
              <Holidays holidays={current.holidays} year={year} />
            </section>
          </div>

          <section className={CARD} aria-labelledby="lv-hist">
            <h2 id="lv-hist" className="mb-3 text-base font-bold text-[#101a3a]">
              Leave history & approval status — {year}
            </h2>
            <History requests={current.requests} onChanged={() => setReload((r) => r + 1)} />
          </section>
        </>
      )}
    </div>
  );
}

