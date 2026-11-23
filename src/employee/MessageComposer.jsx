// Write and send a message (notification) to colleagues. Used in the Employee
// Portal (Notifications page) and on the admin side (Employee Messages).
// Who can be messaged is decided by the database (ep_message_options /
// ep_send_message, migration 235). No dropdowns: buttons + a search box.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Search, Send, X } from "lucide-react";
import { getMessageOptions, sendMessage, validateMessage } from "@/lib/api/employee/notifications";

const BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-60";
const BTN_PRIMARY = `${BTN} bg-gradient-to-r from-[#f7941e] to-[#1f4693] text-white`;
const INPUT = (err) =>
  `w-full rounded-lg border bg-white px-3 py-2 text-sm text-[#2b303b] outline-none focus:border-[#1f4693] focus:ring-2 focus:ring-[#1f4693]/15 ${
    err ? "border-red-400" : "border-[#dce1ec]"
  }`;

function Pills({ label, options, value, onChange }) {
  return (
    <div role="radiogroup" aria-label={label}>
      <p className="mb-1 text-xs font-semibold text-[#4a5880]">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                on ? o.onClass ?? "border-[#1f4693] bg-[#1f4693] text-white" : "border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]"
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

const EMPTY = { audience: "people", to: [], title: "", body: "", priority: "normal" };

export default function MessageComposer({ onSent }) {
  const [opts, setOpts] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [m, setM] = useState(EMPTY);
  const [query, setQuery] = useState("");
  const [errors, setErrors] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ kind: "", text: "" });

  useEffect(() => {
    getMessageOptions()
      .then(setOpts)
      .catch(() => setLoadError("Could not load the people list. Please refresh the page."));
  }, []);

  const set = (k, v) => {
    setM((x) => ({ ...x, [k]: v }));
    setStatus({ kind: "", text: "" });
  };

  const people = useMemo(() => opts?.people ?? [], [opts]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = people.filter((p) => !m.to.includes(p.id));
    if (!q) return list.slice(0, 12);
    return list
      .filter((p) => [p.full_name, p.employee_code, p.designation, p.department].some((v) => v?.toLowerCase().includes(q)))
      .slice(0, 12);
  }, [people, query, m.to]);

  if (loadError) return <p role="alert" className="text-sm text-red-700">{loadError}</p>;
  if (!opts) return <p className="text-sm text-[#676b7a]">Loading…</p>;

  const audiences = [
    { value: "people", label: "Specific people" },
    opts.can_team && { value: "team", label: "My team" },
    opts.can_all && { value: "all", label: "Everyone" },
  ].filter(Boolean);
  const teamCount = people.filter((p) => p.is_my_team).length;

  async function send() {
    const v = validateMessage(m);
    setErrors(v);
    if (v) return;
    setBusy(true);
    const res = await sendMessage(m);
    setBusy(false);
    if (!res.ok) return setStatus({ kind: "error", text: res.message });
    setStatus({ kind: "ok", text: `Sent to ${res.recipients} ${res.recipients === 1 ? "person" : "people"}.` });
    setM(EMPTY);
    setQuery("");
    onSent?.();
  }

  return (
    <div className="flex flex-col gap-4">
      <Pills label="Send to" options={audiences} value={m.audience} onChange={(v) => set("audience", v)} />

      {m.audience === "team" && (
        <p className="text-sm text-[#4a5880]">
          Goes to the {teamCount} {teamCount === 1 ? "person" : "people"} who report to you.
        </p>
      )}
      {m.audience === "all" && <p className="text-sm text-[#4a5880]">Goes to all {people.length} active employees.</p>}

      {m.audience === "people" && (
        <div>
          <p className="mb-1 text-xs font-semibold text-[#4a5880]">People</p>
          {m.to.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {m.to.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[#1f4693] py-1 pl-3 pr-1 text-xs font-semibold text-white">
                  {byId.get(id)?.full_name ?? "—"}
                  <button
                    type="button"
                    onClick={() => set("to", m.to.filter((x) => x !== id))}
                    className="rounded-full p-0.5 hover:bg-white/20"
                    aria-label={`Remove ${byId.get(id)?.full_name ?? "person"}`}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9aa0ad]" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, code, designation"
              aria-label="Search people"
              className={`${INPUT(errors?.to)} pl-8`}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {matches.length === 0 ? (
              <span className="text-xs text-[#9aa0ad]">{people.length === 0 ? "No one else to message yet." : "No matches."}</span>
            ) : (
              matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => set("to", [...m.to, p.id])}
                  className="rounded-lg border border-[#dce1ec] bg-white px-2.5 py-1.5 text-left text-xs hover:bg-[#f6f7fb]"
                >
                  <span className="font-semibold text-[#2b303b]">{p.full_name}</span>{" "}
                  <span className="text-[#9aa0ad]">{p.designation ?? p.employee_code}</span>
                </button>
              ))
            )}
          </div>
          {errors?.to && <p className="mt-1 text-xs text-red-600">{errors.to}</p>}
        </div>
      )}

      <div>
        <label htmlFor="mc-title" className="mb-1 block text-xs font-semibold text-[#4a5880]">
          Subject
        </label>
        <input
          id="mc-title"
          value={m.title}
          maxLength={150}
          onChange={(e) => set("title", e.target.value)}
          placeholder="e.g. Team meeting at 3:00 PM today"
          className={INPUT(errors?.title)}
        />
        {errors?.title && <p className="mt-1 text-xs text-red-600">{errors.title}</p>}
      </div>
      <div>
        <label htmlFor="mc-body" className="mb-1 block text-xs font-semibold text-[#4a5880]">
          Message (optional)
        </label>
        <textarea
          id="mc-body"
          rows={4}
          maxLength={2000}
          value={m.body}
          onChange={(e) => set("body", e.target.value)}
          className={INPUT(errors?.body)}
        />
        {errors?.body && <p className="mt-1 text-xs text-red-600">{errors.body}</p>}
      </div>

      <Pills
        label="Priority"
        value={m.priority}
        onChange={(v) => set("priority", v)}
        options={[
          { value: "normal", label: "Normal" },
          { value: "urgent", label: "Urgent", onClass: "border-red-600 bg-red-600 text-white" },
        ]}
      />
      {m.priority === "urgent" && (
        <p className="flex items-start gap-2 text-xs text-red-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          Urgent messages show as a red banner at the top of the portal until the person reads them.
        </p>
      )}

      {status.text && (
        <p
          role={status.kind === "error" ? "alert" : "status"}
          className={`rounded-lg px-3 py-2 text-sm ${status.kind === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}
        >
          {status.text}
        </p>
      )}
      <div>
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={send}>
          <Send size={16} aria-hidden="true" />
          {busy ? "Sending…" : "Send message"}
        </button>
      </div>
    </div>
  );
}
