import { useEffect, useState } from "react";
import { UserCheck } from "lucide-react";
import { getApproverOptions, setApprover } from "@/lib/api/admin/employees";
import { useAccess } from "@/lib/access";
import { Alert, Badge, Panel } from "@/components/portal/PortalUI";

/**
 * Employee Management -> "Approver (admin side)" (migration 264). Who decides this employee's leave
 * (admin step), attendance corrections and daily reports. Empty = anyone with the permission.
 * Only that person (or a Super Admin) can then decide, and only they get those notifications.
 */
export default function ApproverCard({ emp, onSaved }) {
  const { can } = useAccess();
  const canEdit = can("portal.employees.edit");
  const [options, setOptions] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const current = emp.admin_approver?.user_id ?? null;

  useEffect(() => {
    if (!canEdit) return undefined;
    let active = true;
    getApproverOptions()
      .then((o) => active && setOptions(o))
      .catch(() => active && setOptions([]));
    return () => {
      active = false;
    };
  }, [canEdit]);

  async function choose(userId) {
    if (userId === current || busy) return;
    setBusy(true);
    setMsg({ kind: "", text: "" });
    const r = await setApprover(emp.id, userId);
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message });
    onSaved(r.approver);
    setMsg({
      kind: "ok",
      text: r.approver
        ? `${r.approver.name} now decides ${emp.full_name}'s leave, attendance corrections and daily reports.`
        : `Anyone with the permission can decide ${emp.full_name}'s requests again.`,
    });
  }

  const chip = (key, label, sub, on) => (
    <button
      key={key ?? "anyone"}
      type="button"
      role="radio"
      aria-checked={on}
      disabled={busy || !canEdit}
      onClick={() => choose(key)}
      className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-all disabled:cursor-not-allowed ${
        on
          ? "border-transparent bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] text-white shadow-sm"
          : "border-[#e3e9f5] bg-[#f8faff] text-[#2b303b] hover:border-[#1f4693]/30 hover:bg-[#eef2fb]"
      }`}
    >
      {label}
      {sub && <span className={`block text-[11px] font-normal ${on ? "text-white/75" : "text-[#9aa0ad]"}`}>{sub}</span>}
    </button>
  );

  return (
    <Panel
      icon={UserCheck}
      title="Approver (admin side)"
      subtitle="Who decides this employee's leave, attendance corrections and daily reports"
      action={current ? <Badge tone="blue">{emp.admin_approver.name}</Badge> : <Badge tone="slate">Anyone with permission</Badge>}
    >
      {msg.text && (
        <Alert kind={msg.kind === "ok" ? "ok" : "err"} className="mb-3">
          {msg.text}
        </Alert>
      )}
      {!canEdit ? (
        <p className="text-sm text-[#676b7a]">{current ? `${emp.admin_approver.name} decides this employee's requests.` : "Anyone with the permission decides."}</p>
      ) : options === null ? (
        <p className="text-sm text-[#676b7a]" role="status">
          Loading…
        </p>
      ) : (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Approver">
          {chip(null, "Anyone with permission", "Every admin / HR who may approve", current === null)}
          {options
            .filter((o) => o.user_id !== emp.user_id)
            .map((o) => chip(o.user_id, o.name, o.role, current === o.user_id))}
        </div>
      )}
      <p className="mt-3 text-xs text-[#9aa0ad]">Super Admins can always decide. Nobody can decide their own requests.</p>
    </Panel>
  );
}
