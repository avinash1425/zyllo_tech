import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Mail, Plus, Send, X, XCircle } from "lucide-react";
import { EMAIL_RE, emailError, emailMyReport, getEmailOptions, getMyReportEmails } from "@/lib/api/employee/reportEmail";
import { formatDateTime } from "./attendanceFormat";
import { Alert, Badge, Panel } from "@/components/portal/PortalUI";
import { BTN_PRIMARY, BTN_SECONDARY, INPUT, LABEL } from "@/components/portal/portalStyles";

/**
 * Daily work report -> "Send by email" (migration 266). The employee types any email or picks people
 * from the portal (sign-in emails); the saved report is emailed exactly as written, from
 * "<name> via Zyllo Tech <info@zyllotech.com>", replies go to the employee.
 * ensureSaved(): saves unsaved changes first (returns false if that failed).
 */
export default function ReportEmailPanel({ date, ensureSaved }) {
  const [to, setTo] = useState([]);
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState("");
  const [options, setOptions] = useState([]);
  const [sent, setSent] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: "", text: "" });

  useEffect(() => {
    let active = true;
    getEmailOptions()
      .then((o) => active && setOptions(o))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const loadSent = useCallback(() => getMyReportEmails(date).then(setSent).catch(() => {}), [date]);
  useEffect(() => {
    loadSent();
  }, [loadSent]);
  // While an email is still "sending", check again every few seconds.
  useEffect(() => {
    if (!sent.some((s) => s.status === "sending")) return undefined;
    const t = setTimeout(loadSent, 3000);
    return () => clearTimeout(t);
  }, [sent, loadSent]);

  function add(email) {
    const e = String(email ?? "").trim().toLowerCase();
    if (!e) return;
    if (!EMAIL_RE.test(e)) return setTypedError("Enter a valid email address, e.g. name@company.com");
    if (to.includes(e)) return setTyped("");
    if (to.length >= 10) return setTypedError("At most 10 email addresses at a time.");
    setTo((x) => [...x, e]);
    setTyped("");
    setTypedError("");
  }

  async function send() {
    if (typed.trim()) {
      if (!EMAIL_RE.test(typed.trim())) return setTypedError("Enter a valid email address, or clear the box.");
    }
    const list = [...new Set([...to, ...(typed.trim() ? [typed.trim().toLowerCase()] : [])])];
    if (!list.length) return setMsg({ kind: "err", text: "Add at least one email address." });
    setBusy(true);
    setMsg({ kind: "", text: "" });
    if (!(await ensureSaved())) {
      setBusy(false);
      return setMsg({ kind: "err", text: "Save the report first (fix the highlighted fields), then send it." });
    }
    const r = await emailMyReport(date, list);
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message });
    setTo([]);
    setTyped("");
    setMsg({ kind: "ok", text: `Sending your report to ${list.join(", ")}…` });
    loadSent();
  }

  const picks = options.filter((o) => !to.includes(String(o.email).toLowerCase()));

  return (
    <Panel icon={Mail} title="Send by email" subtitle="Email this report exactly as written. Replies come back to your email.">
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor="rep-email" className={LABEL}>
            To (type an email and press Add, or pick below)
          </label>
          <div className="flex gap-2">
            <input
              id="rep-email"
              type="email"
              value={typed}
              placeholder="name@company.com"
              onChange={(e) => {
                setTyped(e.target.value);
                if (typedError) setTypedError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  add(typed);
                }
              }}
              className={INPUT(!!typedError)}
              autoComplete="email"
            />
            <button type="button" onClick={() => add(typed)} className={`${BTN_SECONDARY} shrink-0`}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add
            </button>
          </div>
          {typedError && <p className="mt-1 text-xs text-red-600">{typedError}</p>}
        </div>

        {to.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Recipients">
            {to.map((e) => (
              <li key={e} className="inline-flex items-center gap-1 rounded-full bg-[#eef2fb] py-1 pl-3 pr-1 text-xs font-semibold text-[#1f4693]">
                {e}
                <button type="button" onClick={() => setTo((x) => x.filter((y) => y !== e))} className="rounded-full p-0.5 hover:bg-[#1f4693]/10" aria-label={`Remove ${e}`}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {picks.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#9aa0ad]">People in the portal</p>
            <div className="flex flex-wrap gap-1.5">
              {picks.map((o) => (
                <button
                  key={o.email}
                  type="button"
                  onClick={() => add(o.email)}
                  className="rounded-xl border border-[#e3e9f5] bg-[#f8faff] px-3 py-1.5 text-left text-xs font-semibold text-[#2b303b] transition-colors hover:border-[#1f4693]/30 hover:bg-[#eef2fb]"
                  title={o.email}
                >
                  <Plus className="mr-1 inline h-3 w-3 text-[#1f4693]" aria-hidden="true" />
                  {o.name}
                  <span className="block text-[11px] font-normal text-[#9aa0ad]">
                    {o.tag} · {o.email}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {msg.text && <Alert kind={msg.kind === "ok" ? "ok" : "err"}>{msg.text}</Alert>}

        <div>
          <button type="button" disabled={busy} onClick={send} className={BTN_PRIMARY}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {busy ? "Sending…" : "Send email"}
          </button>
        </div>

        {sent.length > 0 && (
          <div className="border-t border-[#eef1f7] pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#9aa0ad]">Sent for this day</p>
            <ul className="flex flex-col gap-1.5">
              {sent.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 text-xs text-[#2b303b]">
                  {s.status === "sent" ? (
                    <Badge tone="green">
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Sent
                    </Badge>
                  ) : s.status === "failed" ? (
                    <Badge tone="red">
                      <XCircle className="h-3 w-3" aria-hidden="true" /> Failed
                    </Badge>
                  ) : (
                    <Badge tone="amber">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Sending
                    </Badge>
                  )}
                  <span className="break-all">{s.recipients.join(", ")}</span>
                  <span className="text-[#9aa0ad]">· {formatDateTime(s.created_at)}</span>
                  {s.status === "failed" && s.error && <span className="w-full text-red-600">Reason: {emailError(s.error)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}
