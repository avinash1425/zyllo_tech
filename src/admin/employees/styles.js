// Shared styles of the admin Employee Management pages.
import { EMPLOYMENT_TYPES } from "@/lib/api/employee/profile";

export const CARD = "rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-[0_1px_2px_rgba(16,26,58,0.06)] sm:p-5";
const BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-60";
export const BTN_PRIMARY = `${BTN} bg-gradient-to-r from-[#f7941e] to-[#1f4693] text-white`;
export const BTN_SECONDARY = `${BTN} border border-[#dce1ec] bg-white text-[#2b303b] hover:bg-[#f6f7fb]`;
export const BTN_DANGER = `${BTN} bg-red-600 text-white hover:bg-red-700`;
export const INPUT = (err) =>
  `w-full rounded-lg border bg-white px-3 py-2 text-sm text-[#2b303b] outline-none transition focus:border-[#1f4693] focus:ring-2 focus:ring-[#1f4693]/15 ${
    err ? "border-red-400" : "border-[#dce1ec]"
  }`;
export const EMPLOYMENT_OPTIONS = Object.entries(EMPLOYMENT_TYPES).map(([value, label]) => ({ value, label }));
