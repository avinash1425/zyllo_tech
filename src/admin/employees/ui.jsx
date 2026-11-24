// Shared pieces of the admin Employee Management pages (migrations 239–240).
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { listEmployees } from "@/lib/api/admin/employees";
import { EMPLOYMENT_OPTIONS, INPUT } from "./styles";
import { Alert, Avatar as KitAvatar, Badge } from "@/components/portal/PortalUI";

export function AccessBadge({ active }) {
  return active ? (
    <Badge tone="green" dot>
      Active
    </Badge>
  ) : (
    <Badge tone="red" dot>
      Access off
    </Badge>
  );
}

/** Initials avatar (Portal UI kit). */
export function Avatar({ name, size }) {
  return <KitAvatar name={name} size={size} />;
}

/** Message strip: kind "ok" | "err". */
export function Banner({ kind, children }) {
  return (
    <Alert kind={kind === "ok" ? "ok" : "err"} className="mb-4">
      {children}
    </Alert>
  );
}

export function Field({ id, label, error, hint, children, wide }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-[#4a5880]">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-[#9aa0ad]">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/** Employment type as buttons (project rule: no dropdowns). Click again to clear. */
export function EmploymentTypeChoice({ id, value, onChange }) {
  return (
    <div className="sm:col-span-2" role="radiogroup" aria-labelledby={`${id}-label`}>
      <p id={`${id}-label`} className="mb-1 text-xs font-semibold text-[#4a5880]">
        Employment type
      </p>
      <div className="flex flex-wrap gap-1.5">
        {EMPLOYMENT_OPTIONS.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(on ? "" : o.value)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                on ? "border-[#1f4693] bg-[#1f4693] text-white" : "border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Pick the reporting manager from the active employees (search + buttons; no dropdown). */
/**
 * Reporting manager: pick an employee from the portal, OR type a name when the manager
 * has no portal account (migration 250). Picking one clears the other.
 */
export function ManagerPicker({ employeeId, value, onChange, name = "", onNameChange }) {
  const [all, setAll] = useState(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let active = true;
    listEmployees()
      .then((d) => active && setAll(d))
      .catch(() => active && setAll([]));
    return () => {
      active = false;
    };
  }, []);
  const chosen = all?.find((e) => e.id === value);
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (all ?? [])
      .filter((e) => e.is_active && e.id !== employeeId && e.id !== value)
      .filter((e) => !q || [e.full_name, e.employee_code, e.designation].filter(Boolean).some((s) => s.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [all, query, employeeId, value]);

  return (
    <div className="sm:col-span-2">
      <p className="mb-1 text-xs font-semibold text-[#4a5880]">Reporting manager</p>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#dce1ec] bg-[#f9fafc] px-3 py-2 text-sm">
        {value ? (
          <>
            <span className="font-semibold text-[#101a3a]">{chosen?.full_name ?? "Current manager"}</span>
            {chosen && <span className="font-mono text-xs text-[#9aa0ad]">{chosen.employee_code}</span>}
            <span className="flex-1" />
            <button type="button" onClick={() => onChange("")} className="text-xs font-semibold text-red-600 hover:underline">
              Remove
            </button>
          </>
        ) : name.trim() ? (
          <>
            <span className="font-semibold text-[#101a3a]">{name.trim()}</span>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20">
              Not in the portal
            </span>
            <span className="flex-1" />
            <button type="button" onClick={() => onNameChange?.("")} className="text-xs font-semibold text-red-600 hover:underline">
              Remove
            </button>
          </>
        ) : (
          <span className="text-[#9aa0ad]">No reporting manager</span>
        )}
      </div>
      <div className="relative mt-2">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9aa0ad]" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={value ? "Search to change the manager…" : "Search employees to assign…"}
          aria-label="Search reporting manager"
          className={`${INPUT(false)} pl-8`}
        />
      </div>
      {all === null ? (
        <p className="mt-2 text-xs text-[#676b7a]">Loading employees…</p>
      ) : options.length === 0 ? (
        <p className="mt-2 text-xs text-[#676b7a]">No other active employees{query ? " match" : ""}.</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {options.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(e.id);
                  onNameChange?.("");
                  setQuery("");
                }}
                className="rounded-lg border border-[#dce1ec] bg-white px-3 py-1.5 text-left text-xs hover:border-[#1f4693] hover:bg-[#f0f4ff]"
              >
                <span className="font-semibold text-[#101a3a]">{e.full_name}</span>
                <span className="ml-1 text-[#676b7a]">{[e.designation, e.employee_code].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {onNameChange && (
        <div className="mt-3 rounded-lg border border-dashed border-[#dce1ec] bg-white p-3">
          <label htmlFor={`mgr-name-${employeeId ?? "new"}`} className="mb-1 block text-xs font-semibold text-[#4a5880]">
            Manager not in the portal? Type the name
          </label>
          <input
            id={`mgr-name-${employeeId ?? "new"}`}
            value={name}
            maxLength={120}
            onChange={(e) => {
              onNameChange(e.target.value);
              if (e.target.value.trim() && value) onChange("");
            }}
            placeholder="e.g. Ravi Kumar (Team Lead)"
            className={INPUT(false)}
          />
          <p className="mt-1 text-[11px] text-[#9aa0ad]">
            Shown to the employee as their reporting manager. Their daily reports and leave then go to the admin for review.
          </p>
        </div>
      )}
    </div>
  );
}
