// Shared bits for the Performance & KPI pages (HR /hr/performance and
// Employee Portal /employee/performance).
import { useState } from "react";
import { Star } from "lucide-react";
import { fullName } from "@/lib/hr/client";
import { RATING_LABELS, REVIEW_STATUS_LABELS, label, ratingLabel } from "@/lib/hr/performanceRules";
import { Badge, Button, Field, InlineError, Modal, Select } from "@/hr/ui";

export const todayLocal = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export const opts = (values, fmt = label) => values.map((v) => ({ value: v, label: fmt(v).replace(/^./, (c) => c.toUpperCase()) }));
export const empText = (e) => (e ? `${fullName(e)}${e.employee_code ? ` (${e.employee_code})` : ""}` : "—");
export const one = (v) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

const TONES = {
  draft: "slate", active: "green", closed: "slate",
  not_started: "slate", self_review: "amber", manager_review: "blue", calibration: "violet", finalized: "green",
  agreed: "blue", in_progress: "blue", achieved: "green", missed: "red",
  scheduled: "violet", completed: "green", cancelled: "slate",
  extended: "orange", failed: "red",
  on_track: "green", at_risk: "amber", off_track: "red",
  praise: "green", constructive: "amber", note: "slate",
};
/** Status pill with performance-specific labels/tones. */
export function PerfBadge({ value }) {
  if (!value) return <Badge>—</Badge>;
  return <Badge tone={TONES[value] ?? "slate"}>{REVIEW_STATUS_LABELS[value] ?? label(value)}</Badge>;
}

export function RatingBadge({ rating, showLabel = true }) {
  if (rating === null || rating === undefined || rating === "") return <span className="text-slate-400">—</span>;
  const r = Number(rating);
  const tone = r >= 4 ? "green" : r >= 3 ? "blue" : r >= 2 ? "amber" : "red";
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={tone}><Star className="mr-1 h-3 w-3" aria-hidden="true" />{Number.isInteger(r) ? r : r.toFixed(2)}</Badge>
      {showLabel && <span className="text-xs text-slate-500">{ratingLabel(r)}</span>}
    </span>
  );
}

export const RATING_OPTIONS = [5, 4, 3, 2, 1].map((r) => ({ value: String(r), label: `${r} – ${RATING_LABELS[r]}` }));
export function RatingSelect({ value, onChange, placeholder = "Choose a rating" }) {
  return <Select placeholder={placeholder} value={value ?? ""} onChange={(e) => onChange(e.target.value)} options={RATING_OPTIONS} />;
}

export function ProgressBar({ value, tone = "orange", label: lbl }) {
  const v = value === null || value === undefined ? null : Math.max(0, Math.min(100, Number(value)));
  const colors = { orange: "from-[#f7941e] to-[#f96706]", green: "from-emerald-500 to-emerald-600", red: "from-rose-500 to-rose-600", teal: "from-[#3089a6] to-[#1f6f8a]" };
  return (
    <div className="flex min-w-[7rem] items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v ?? undefined} aria-label={lbl ?? "Progress"}>
        {v !== null && <div className={`h-full rounded-full bg-gradient-to-r ${colors[tone] ?? colors.orange}`} style={{ width: `${v}%` }} />}
      </div>
      <span className="w-10 text-right text-xs font-semibold text-slate-600">{v === null ? "—" : `${Math.round(v)}%`}</span>
    </div>
  );
}

/** Weight total of a goal sheet: green at exactly 100, amber under, red over. */
export function WeightMeter({ total }) {
  const t = Number(total) || 0;
  const tone = Math.abs(t - 100) < 0.005 ? "green" : t > 100 ? "red" : "amber";
  return <Badge tone={tone}>{t}% / 100%</Badge>;
}

/** Modal whose submit returns { error } to stay open with the message. */
export function ActionModal({ title, onClose, submitLabel = "Save", tone = "primary", onSubmit, children, size = "md", hideSubmit = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function go() {
    setBusy(true); setError(null);
    const res = (await onSubmit()) ?? {};
    setBusy(false);
    if (res.error) setError(res.error);
  }
  return (
    <Modal open onClose={busy ? undefined : onClose} title={title} size={size}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>{hideSubmit ? "Close" : "Cancel"}</Button>{!hideSubmit && <Button variant={tone} loading={busy} onClick={go}>{submitLabel}</Button>}</>}>
      <div className="flex flex-col gap-3">{children}<InlineError message={error} /></div>
    </Modal>
  );
}

export function CycleSelect({ cycles, value, onChange, allowAll = false, label: lbl = "Review cycle" }) {
  return (
    <Field label={lbl} className="min-w-[14rem]">
      <Select placeholder={allowAll ? "All cycles" : undefined} value={value} onChange={(e) => onChange(e.target.value)}
        options={(cycles ?? []).map((c) => ({ value: c.id, label: `${c.name} · ${label(c.status)}` }))} />
    </Field>
  );
}

/** Default cycle: the most recent active one, else the most recent. */
export const defaultCycleId = (cycles) => (cycles ?? []).find((c) => c.status === "active")?.id ?? cycles?.[0]?.id ?? "";

/** Read-only text block that keeps line breaks. */
export function TextBlock({ children, empty = "—" }) {
  return children ? <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{children}</p> : <p className="text-sm text-slate-400">{empty}</p>;
}
