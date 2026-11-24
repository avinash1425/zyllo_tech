import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Info,
  Palmtree,
  PartyPopper,
  Pencil,
  Plus,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import PageHeader from "../PageHeader";
import {
  decideLeave,
  deleteHoliday,
  getHolidays,
  getLeaveBalances,
  getLeaveRequests,
  num,
  saveHoliday,
  setLeaveAllowance,
} from "@/lib/api/admin/attendanceLeave";
import { HALF_DAY, LEAVE_STATUS } from "@/lib/api/employee/leave";
import { dayName, formatDate, formatDateTime, todayIst } from "@/employee/attendanceFormat";
import { Alert, Avatar, Badge, Chips, Empty, Panel, TableCard, Tabs } from "@/components/portal/PortalUI";
import {
  BTN_DANGER,
  BTN_DANGER_SOFT,
  BTN_NAVY,
  BTN_PRIMARY,
  BTN_SECONDARY,
  ICON_BTN,
  ICON_BTN_DANGER,
  INPUT,
  INPUT_INLINE,
  LABEL,
  TABLE,
  TABLE_WRAP,
  TD,
  TH,
  TR,
} from "@/components/portal/portalStyles";

const TABS = [
  { key: "requests", label: "Leave requests", icon: ClipboardList },
  { key: "balances", label: "Leave balances", icon: Wallet },
  { key: "holidays", label: "Holidays", icon: PartyPopper },
];
const REQ_FILTERS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];
const STATUS_TONE = { pending: "amber", approved: "green", rejected: "red", cancelled: "slate" };

const NAV_BTN =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#4a5068] transition-colors hover:bg-[#f0f4ff] hover:text-[#1f4693] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4693]";

function Hint({ children }) {
  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-[#676b7a]">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1f4693]/60" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function Loading() {
  return (
    <p className="px-5 py-8 text-center text-sm text-[#676b7a]" role="status">
      Loading…
    </p>
  );
}

function YearNav({ year, setYear }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-[#e3e9f5] bg-white p-1 shadow-sm">
      <button type="button" onClick={() => setYear(year - 1)} className={NAV_BTN} aria-label="Previous year">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="flex min-w-[5rem] items-center justify-center gap-1.5 text-sm font-bold tabular-nums text-[#101a3a]" aria-live="polite">
        <CalendarDays className="h-4 w-4 text-[#f96706]" aria-hidden="true" />
        {year}
      </span>
      <button type="button" onClick={() => setYear(year + 1)} className={NAV_BTN} aria-label="Next year">
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

const dates = (r) =>
  r.start_date === r.end_date ? formatDate(r.start_date) : `${formatDate(r.start_date)} – ${formatDate(r.end_date)}`;

// ---------------------------------------------------------------- requests
function RequestItem({ r, onDone }) {
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const st = LEAVE_STATUS[r.status];
  const b = r.balance;
  const left = b?.allowed == null ? null : Number(b.allowed) - Number(b.approved) - Number(b.pending);

  async function decide(action) {
    if (action === "rejected" && !comment.trim()) return setError("Write a reason for rejecting.");
    setBusy(true);
    setError("");
    const res = await decideLeave(r.id, action, comment);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    onDone();
  }

  return (
    <li className="px-5 py-4 transition-colors hover:bg-[#fafbff]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Avatar name={r.employee?.full_name} />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-[#101a3a]">
            {r.employee?.full_name}{" "}
            <span className="font-mono text-[11px] font-normal text-[#9aa0ad]">{r.employee?.employee_code}</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[#2b303b]">
            <Badge tone="violet">{r.leave_name}</Badge>
            <span>{dates(r)}</span>
            <span className="text-[#c0c5d2]" aria-hidden="true">·</span>
            <span className="font-semibold">
              {num(r.days)} day{Number(r.days) === 1 ? "" : "s"}
              {r.half_day && ` (${HALF_DAY[r.half_day]})`}
            </span>
          </p>
          <p className="mt-2 border-l-2 border-[#f7941e]/50 pl-2.5 text-xs italic text-[#2b303b]">“{r.reason}”</p>
          <p className="mt-1.5 text-[11px] text-[#9aa0ad]">
            Applied {formatDateTime(r.created_at)}
            {r.approver && ` · Manager entered: ${r.approver}`}
          </p>
          {b && b.is_paid && (
            <p className="mt-2 inline-flex flex-wrap items-center gap-x-1 rounded-lg bg-[#f5f8ff] px-2.5 py-1 text-xs text-[#4a5880] ring-1 ring-inset ring-[#dce6f7]">
              {b.name} balance {r.start_date.slice(0, 4)}: {num(b.allowed)} allowed · {num(b.approved)} approved ·{" "}
              {num(b.pending)} pending ·{" "}
              <span className={left < 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>{num(left)} left</span>
            </p>
          )}
          {r.decided_at && (
            <p className="mt-1.5 text-xs text-[#676b7a]">
              {st?.label} by {r.decided_by ?? "—"} on {formatDateTime(r.decided_at)}
              {r.decision_comment && ` · ${r.decision_comment}`}
            </p>
          )}
          {!r.decided_at && r.decision_comment && <p className="mt-1.5 text-xs text-[#676b7a]">{r.decision_comment}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Badge tone={STATUS_TONE[r.status] ?? "slate"} dot>
            {st?.label}
          </Badge>
          {r.status === "pending" && !rejecting && (
            <>
              <button type="button" disabled={busy} onClick={() => decide("approved")} className={`${BTN_NAVY} px-3 py-1.5`}>
                <Check className="h-4 w-4" aria-hidden="true" />
                {busy ? "Saving…" : "Approve"}
              </button>
              <button type="button" disabled={busy} onClick={() => setRejecting(true)} className={`${BTN_DANGER_SOFT} px-3 py-1.5`}>
                <X className="h-4 w-4" aria-hidden="true" />
                Reject
              </button>
            </>
          )}
        </div>
      </div>
      {rejecting && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-red-100 bg-red-50/70 p-3 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className={`${LABEL} text-red-800`}>Reason for rejecting (the employee sees it)</span>
            <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} className={INPUT(!!error)} />
          </label>
          <button type="button" disabled={busy} onClick={() => decide("rejected")} className={BTN_DANGER}>
            {busy ? "Saving…" : "Reject"}
          </button>
          <button type="button" disabled={busy} onClick={() => setRejecting(false)} className={BTN_SECONDARY}>
            Cancel
          </button>
        </div>
      )}
      {error && (
        <Alert kind="err" className="mt-2 py-2 text-xs">
          {error}
        </Alert>
      )}
    </li>
  );
}

function RequestsView({ year }) {
  const [filter, setFilter] = useState("pending");
  const [list, setList] = useState(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    getLeaveRequests(filter, year)
      .then((d) => {
        if (!active) return;
        setList(d);
        setError("");
      })
      .catch(() => active && setError("Could not load leave requests."));
    return () => {
      active = false;
    };
  }, [filter, year, reload]);

  return (
    <Panel
      flush
      icon={ClipboardList}
      title={`Leave applications — ${year}`}
      subtitle="Approving updates the employee’s balance and marks the days as approved leave on both attendance calendars. The employee is notified either way."
    >
      <div className="border-b border-[#eef1f7] bg-[#fafbff] px-5 py-3">
        <Chips
          items={REQ_FILTERS}
          value={filter}
          onChange={(k) => {
            setList(null);
            setFilter(k);
          }}
          label="Filter by status"
        />
      </div>
      {error ? (
        <div className="p-5">
          <Alert kind="err">{error}</Alert>
        </div>
      ) : list === null ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty icon={Palmtree} title={`No ${filter === "all" ? "" : `${filter} `}leave applications in ${year}.`} />
      ) : (
        <ul className="divide-y divide-[#eef1f7]">
          {list.map((r) => (
            <RequestItem key={r.id} r={r} onDone={() => setReload((n) => n + 1)} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- balances
function BalanceCell({ emp, b, year, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!b.is_paid) {
    return (
      <span className="text-xs text-[#676b7a]">
        <span className="font-semibold tabular-nums text-[#2b303b]">{num(b.approved)}</span> taken
        {Number(b.pending) > 0 && ` · ${num(b.pending)} pending`}
      </span>
    );
  }
  const left = Number(b.allowed) - Number(b.approved) - Number(b.pending);

  async function save(days) {
    setBusy(true);
    setError("");
    const r = await setLeaveAllowance(emp.id, year, b.code, days);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setEditing(false);
    onSaved(emp.id, r.balance);
  }

  if (editing) {
    return (
      <div className="flex min-w-[12rem] flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min="0"
            max="366"
            step="0.5"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label={`${b.name} days for ${emp.full_name}`}
            className={`${INPUT_INLINE(!!error)} w-20 px-2 py-1.5`}
          />
          <button type="button" disabled={busy || value === ""} onClick={() => save(Number(value))} className={`${BTN_NAVY} px-2.5 py-1.5 text-xs`}>
            Save
          </button>
          <button type="button" disabled={busy} onClick={() => setEditing(false)} className="px-1 text-xs font-semibold text-[#676b7a] hover:text-[#1f4693] hover:underline">
            Cancel
          </button>
        </div>
        {b.is_custom && (
          <button type="button" disabled={busy} onClick={() => save(null)} className="self-start text-[11px] font-semibold text-[#1f4693] hover:underline">
            Reset to default ({num(b.default)})
          </button>
        )}
        {error && (
          <p role="alert" className="text-[11px] font-medium text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setValue(String(Number(b.allowed)));
        setEditing(true);
      }}
      className="group -mx-2 -my-1 rounded-lg px-2 py-1 text-left transition-colors hover:bg-white hover:shadow-[0_0_0_1px_#dce6f7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693]"
      title="Click to change the yearly days"
    >
      <span className={`block text-sm font-bold tabular-nums ${left < 0 ? "text-red-600" : "text-[#101a3a]"}`}>
        {num(left)} <span className="text-xs font-normal text-[#676b7a]">of {num(b.allowed)} left</span>
        <Pencil size={11} className="ml-1 inline text-[#b0b8cc] group-hover:text-[#1f4693]" aria-hidden="true" />
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-[#9aa0ad]">
        {num(b.approved)} used{Number(b.pending) > 0 && ` · ${num(b.pending)} pending`}
        {b.is_custom && <Badge tone="orange" className="px-1.5 py-0 text-[10px]">custom</Badge>}
      </span>
    </button>
  );
}

function BalancesView({ year }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    getLeaveBalances(year)
      .then((d) => {
        if (!active) return;
        setData(d);
        setError("");
      })
      .catch(() => active && setError("Could not load balances."));
    return () => {
      active = false;
    };
  }, [year]);

  const onSaved = (empId, bal) =>
    setData((d) => ({
      ...d,
      employees: d.employees.map((e) =>
        e.id !== empId ? e : { ...e, balances: e.balances.map((x) => (x.code === bal.code ? bal : x)) },
      ),
    }));

  return (
    <TableCard
      title={`Leave balances — ${year}`}
      count={data?.employees?.length}
      filters={
        <Hint>
          Remaining = yearly days − approved − pending. Click a number to give one employee more or fewer days this year
          (e.g. joined mid-year). Loss of Pay has no limit.
        </Hint>
      }
    >
      {error ? (
        <div className="p-5">
          <Alert kind="err">{error}</Alert>
        </div>
      ) : !data ? (
        <Loading />
      ) : data.employees.length === 0 ? (
        <Empty icon={Users} title="No employees yet." />
      ) : (
        <div className={TABLE_WRAP}>
          <table className={`${TABLE} min-w-[760px]`}>
            <thead>
              <tr>
                <th className={`${TH} align-top`}>Employee</th>
                {data.types.map((t) => (
                  <th key={t.code} className={`${TH} align-top`}>
                    {t.name}
                    {t.is_paid && (
                      <span className="mt-0.5 block text-[10.5px] font-medium normal-case tracking-normal text-white/65">
                        default {num(t.default)} / year
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.employees.map((e) => (
                <tr key={e.id} className={`${TR} align-top`}>
                  <td className={`${TD} align-top`}>
                    <span className="flex items-center gap-2.5">
                      <Avatar name={e.full_name} size="h-8 w-8 text-xs" />
                      <span className="min-w-0">
                        <span className="block font-semibold text-[#101a3a]">{e.full_name}</span>
                        <span className="flex flex-wrap items-center gap-1">
                          <span className="font-mono text-[11px] text-[#9aa0ad]">{e.employee_code}</span>
                          {!e.is_active && (
                            <Badge tone="red" className="px-1.5 py-0 text-[10px]">
                              access off
                            </Badge>
                          )}
                        </span>
                      </span>
                    </span>
                  </td>
                  {e.balances.map((b) => (
                    <td key={b.code} className={`${TD} align-top`}>
                      <BalanceCell emp={e} b={b} year={year} onSaved={onSaved} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  );
}

// ---------------------------------------------------------------- holidays
function HolidayForm({ year, holiday, onSaved, onClose }) {
  const [date, setDate] = useState(holiday?.date ?? "");
  const [name, setName] = useState(holiday?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!date) return setError("Choose a date.");
    if (!name.trim()) return setError("Enter the holiday name.");
    setBusy(true);
    setError("");
    const r = await saveHoliday(holiday?.id, date, name);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onSaved(Number(date.slice(0, 4)) === year ? r.holidays : null);
    onClose();
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid gap-3 rounded-xl border border-[#dce6f7] bg-[#f5f8ff] p-4 sm:grid-cols-[auto_1fr_auto] sm:items-end"
    >
      <label>
        <span className={LABEL}>Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT(!!error && !date)} />
      </label>
      <label>
        <span className={LABEL}>Holiday name</span>
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sankranti" className={INPUT(!!error && !!date && !name.trim())} />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={BTN_PRIMARY}>
          {busy ? "Saving…" : holiday ? "Save" : "Add holiday"}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={BTN_SECONDARY}>
          Cancel
        </button>
      </div>
      {error && (
        <Alert kind="err" className="py-2 text-xs sm:col-span-3">
          {error}
        </Alert>
      )}
    </form>
  );
}

function HolidayRow({ h, year, onSaved }) {
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const past = h.date < todayIst().iso;

  if (mode === "edit") {
    return (
      <tr className="border-b border-[#eef1f7] bg-white last:border-0">
        <td colSpan={4} className="px-4 py-3">
          <HolidayForm year={year} holiday={h} onSaved={onSaved} onClose={() => setMode(null)} />
        </td>
      </tr>
    );
  }
  return (
    <>
      <tr className={TR}>
        <td className={TD}>
          <span className={`whitespace-nowrap font-semibold ${past ? "text-[#9aa0ad]" : "text-[#101a3a]"}`}>{formatDate(h.date)}</span>
        </td>
        <td className={`${TD} text-xs ${past ? "text-[#b0b8cc]" : ""}`}>{dayName(h.date)}</td>
        <td className={TD}>
          <span className="flex flex-wrap items-center gap-2">
            <span className={past ? "text-[#9aa0ad]" : "font-medium text-[#2b303b]"}>{h.name}</span>
            {past && <Badge tone="slate">Past</Badge>}
          </span>
        </td>
        <td className={`${TD} text-right`}>
          <span className="inline-flex items-center gap-1">
            <button type="button" onClick={() => setMode("edit")} className={ICON_BTN} aria-label={`Edit ${h.name}`} title="Edit">
              <Pencil size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setMode(mode === "delete" ? null : "delete")}
              className={ICON_BTN_DANGER}
              aria-label={`Delete ${h.name}`}
              aria-expanded={mode === "delete"}
              title="Delete"
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </span>
        </td>
      </tr>
      {(mode === "delete" || error) && (
        <tr className="border-b border-[#eef1f7] bg-white last:border-0">
          <td colSpan={4} className="px-4 pb-3 pt-1">
            {mode === "delete" && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-100 bg-red-50/70 p-3 text-sm text-red-800">
                <span className="flex-1 font-semibold">Delete {h.name}? Leave covering this day will count it again.</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const r = await deleteHoliday(h.id);
                    setBusy(false);
                    if (!r.ok) return setError(r.message);
                    onSaved(r.holidays);
                  }}
                  className={BTN_DANGER}
                >
                  {busy ? "Deleting…" : "Delete"}
                </button>
                <button type="button" disabled={busy} onClick={() => setMode(null)} className={BTN_SECONDARY}>
                  Cancel
                </button>
              </div>
            )}
            {error && (
              <Alert kind="err" className="mt-2 py-2 text-xs">
                {error}
              </Alert>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function HolidaysView({ year }) {
  const [list, setList] = useState(null);
  const [adding, setAdding] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    getHolidays(year)
      .then((d) => active && setList(d))
      .catch(() => active && setList([]));
    return () => {
      active = false;
    };
  }, [year, reload]);
  const onSaved = (fresh) => (fresh ? setList(fresh) : setReload((n) => n + 1));

  return (
    <TableCard
      title={`Company holidays — ${year}`}
      count={list?.length}
      actions={
        !adding && (
          <button type="button" onClick={() => setAdding(true)} className={BTN_PRIMARY}>
            <Plus size={16} aria-hidden="true" /> Add holiday
          </button>
        )
      }
      filters={
        <div className="flex flex-col gap-3">
          <Hint>
            Employees see these in Leave Management and on their attendance calendar. Holidays are not counted as leave
            days or absent days; adding one re-counts leave already applied for that day.
          </Hint>
          {adding && <HolidayForm year={year} holiday={null} onSaved={onSaved} onClose={() => setAdding(false)} />}
        </div>
      }
    >
      {list === null ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty icon={PartyPopper} title={`No holidays added for ${year}.`} />
      ) : (
        <div className={TABLE_WRAP}>
          <table className={`${TABLE} min-w-[520px]`}>
            <thead>
              <tr>
                <th className={TH}>Date</th>
                <th className={TH}>Day</th>
                <th className={TH}>Holiday</th>
                <th className={`${TH} text-right`}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((h) => (
                <HolidayRow key={h.id} h={h} year={year} onSaved={onSaved} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  );
}

/**
 * Admin: Leave Management — pending applications (approve / reject), leave
 * balances of every employee, and company holidays. Migration 242.
 */
export default function LeaveAdminPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "requests";
  const [year, setYear] = useState(() => todayIst().y);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Leave Management"
        icon={Palmtree}
        subtitle="Approve or reject leave applications, see every employee's leave balance, and manage company holidays."
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          items={TABS}
          value={tab}
          onChange={(k) => setParams(k === "requests" ? {} : { tab: k }, { replace: true })}
          label="Leave views"
        />
        <YearNav year={year} setYear={setYear} />
      </div>
      {tab === "balances" ? <BalancesView year={year} /> : tab === "holidays" ? <HolidaysView year={year} /> : <RequestsView year={year} />}
    </div>
  );
}
