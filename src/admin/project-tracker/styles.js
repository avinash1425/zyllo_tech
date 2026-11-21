// Shared Project Tracker class names and helpers.
export const INPUT =
  "w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-[#2b303b] outline-none transition-colors focus:border-[#1f4693] focus:ring-2 focus:ring-[#1f4693]/10";
export const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#f7941e] to-[#f96706] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";
export const BTN_SECONDARY =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-[#dce6f7] bg-white px-4 py-2.5 text-sm font-semibold text-[#1f4693] transition-colors hover:bg-[#f0f4ff] disabled:opacity-60";

export function inputClass(error) {
  return `${INPUT} ${error ? "border-red-400" : "border-[#e7e9ee]"}`;
}

/** "10 Dec 2026" from "2026-12-10"; null when empty. */
export function formatDate(value) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** The only progress values allowed: 0, 25, 50, 75, 100. */
export const PROGRESS_STEPS = [0, 25, 50, 75, 100];

const PROGRESS_COLORS = {
  0:   { color: "#c0c4cd", label: "Not started" },
  25:  { color: "#7ba3e0", label: "Started"     },
  50:  { color: "#4a7fd4", label: "Halfway"     },
  75:  { color: "#2d5fbe", label: "Almost done" },
  100: { color: "#1f4693", label: "Done"        },
};

/** Nearest allowed step for any number (older records may hold other values). */
export function snapProgress(value) {
  const n = Math.max(0, Math.min(100, Number(value) || 0));
  return PROGRESS_STEPS.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), 0);
}

/** { color, label } for a progress value. */
export function progressStyle(value) {
  return PROGRESS_COLORS[snapProgress(value)];
}
