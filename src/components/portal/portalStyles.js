// Employee Portal design tokens (admin side AND employee side).
// Taken from the main admin Dashboard (KpiCard / Card / HeroBanner) and the
// Project Tracker (metric strip, navy table header, chips, buttons), so the
// Employee Portal looks like the rest of the admin. Components: PortalUI.jsx.

/** White card: same border + soft two-layer shadow as the main dashboard. */
export const CARD =
  "min-w-0 rounded-2xl border border-[#e7e9ee] bg-white shadow-[0_1px_2px_rgba(16,26,58,0.04),0_8px_24px_-12px_rgba(16,26,58,0.10)]";
/** Card with inner padding (for simple cards without a Panel header). */
export const CARD_PAD = `${CARD} p-5`;

const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
/** Orange gradient — the main action (same as Project Tracker). */
export const BTN_PRIMARY = `${BTN_BASE} bg-gradient-to-r from-[#f7941e] to-[#f96706] text-white shadow-[0_6px_14px_-6px_rgba(249,103,6,0.6)] hover:shadow-[0_10px_20px_-8px_rgba(249,103,6,0.7)] focus-visible:outline-[#f96706]`;
/** White with blue text — secondary actions. */
export const BTN_SECONDARY = `${BTN_BASE} border border-[#dce6f7] bg-white text-[#1f4693] hover:bg-[#f0f4ff] focus-visible:outline-[#1f4693]`;
/** Navy — strong neutral action (e.g. "Approve" next to a red "Reject"). */
export const BTN_NAVY = `${BTN_BASE} bg-gradient-to-r from-[#1f4693] to-[#2d5fbe] text-white shadow-[0_6px_14px_-6px_rgba(31,70,147,0.6)] hover:opacity-95 focus-visible:outline-[#1f4693]`;
export const BTN_SUCCESS = `${BTN_BASE} bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus-visible:outline-emerald-600`;
export const BTN_DANGER = `${BTN_BASE} bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:outline-red-600`;
/** Quiet red text button (e.g. "Reject", "Remove") before confirming. */
export const BTN_DANGER_SOFT = `${BTN_BASE} border border-red-200 bg-white text-red-700 hover:bg-red-50 focus-visible:outline-red-600`;
/** Small square icon button (table row actions). */
export const ICON_BTN =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#64748b] transition-colors hover:bg-[#f1f4fc] hover:text-[#1f4693] disabled:opacity-50";
export const ICON_BTN_DANGER =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#9aa0ad] transition-colors hover:bg-[#fee2e2] hover:text-[#dc2626] disabled:opacity-50";

/** Text inputs / textareas (Project Tracker look). Pass true for the error state. */
export const INPUT = (err) =>
  `w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-[#2b303b] outline-none transition-colors placeholder:text-[#a3a8b5] focus:border-[#1f4693] focus:ring-2 focus:ring-[#1f4693]/10 ${
    err ? "border-red-400" : "border-[#e3e8f2]"
  }`;
/** Same look, without w-full (size it yourself, e.g. "w-40"). */
export const INPUT_INLINE = (err) => INPUT(err).replace("w-full ", "");
/** Small uppercase field label. */
export const LABEL = "mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-[#8a90a0]";

// ---------------------------------------------------------------- tables (Project Tracker style)
/** Wrapper around a <table>: rounded, scrolls sideways on small screens. */
export const TABLE_WRAP = "overflow-x-auto";
/** <table> classes. */
export const TABLE = "w-full border-collapse text-left text-[13px]";
/** <th> classes: navy header, white uppercase labels. */
export const TH =
  "border-b border-[#2a4fa0] bg-[#1f4693] px-4 py-3 text-[10.5px] font-bold uppercase tracking-[.12em] text-white/90 whitespace-nowrap";
/** Sticky navy header (use inside a scrolling box). */
export const TH_STICKY = `${TH} sticky top-0 z-10`;
/** <tr> classes: zebra rows + soft blue hover. */
export const TR = "border-b border-[#eef1f7] last:border-0 odd:bg-white even:bg-[#f8fafd] transition-colors hover:bg-[#eef4ff]";
/** <td> classes. */
export const TD = "px-4 py-3 align-middle text-[#4a5068]";

// ---------------------------------------------------------------- misc
/** Light, readable chip colours by tone (for <Badge tone="…">). */
export const TONES = {
  blue: "bg-[#eef2fb] text-[#1f4693] ring-[#1f4693]/15",
  navy: "bg-[#1f4693] text-white ring-transparent",
  orange: "bg-[#fff4e6] text-[#c24f05] ring-[#f7941e]/25",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  red: "bg-red-50 text-red-700 ring-red-600/15",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/15",
  teal: "bg-teal-50 text-teal-700 ring-teal-600/15",
  sky: "bg-sky-50 text-sky-700 ring-sky-600/15",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/15",
};

/** Gradients for KPI medallions (logo palette). */
export const ACCENTS = {
  orange: { from: "#f7941e", to: "#f96706", color: "#f96706" },
  blue: { from: "#1f4693", to: "#3b6fd1", color: "#1f4693" },
  teal: { from: "#3089a6", to: "#2bb3c9", color: "#3089a6" },
  green: { from: "#10b981", to: "#059669", color: "#059669" },
  red: { from: "#f87171", to: "#dc2626", color: "#dc2626" },
  violet: { from: "#8b5cf6", to: "#6d28d9", color: "#7c3aed" },
  amber: { from: "#fbbf24", to: "#d97706", color: "#d97706" },
  navy: { from: "#101a3a", to: "#1f4693", color: "#101a3a" },
};
