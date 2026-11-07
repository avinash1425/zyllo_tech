// Pure leave helpers (no Supabase import, unit-tested in tests/leave-rules.test.mjs).

/** hr_leave_types.eligible_gender (migration 203): null = every employee. */
export const GENDER_ELIGIBILITY_OPTIONS = [
  { value: "", label: "Every employee" },
  { value: "female", label: "Female employees only" },
  { value: "male", label: "Male employees only" },
];

export function genderEligibilityLabel(value) {
  if (value === "female") return "female only";
  if (value === "male") return "male only";
  return "all genders";
}

// Event-based leave (maternity / paternity) is granted for a life event, not
// as a yearly allowance, so it is left out of the dashboard "Leave available"
// figure. Identified by its gender setting (203), the codes seeded in 160 or
// the name, so the figure is right before HR has set the gender eligibility.
const SPECIAL_LEAVE_CODES = new Set(["ML", "PL"]);
const SPECIAL_LEAVE_NAME = /\b(maternity|paternity)\b/i;

export function isSpecialLeave(b) {
  if (!b) return false;
  if (b.eligible_gender) return true;
  if (SPECIAL_LEAVE_CODES.has(String(b.code ?? "").toUpperCase())) return true;
  return SPECIAL_LEAVE_NAME.test(String(b.name ?? ""));
}

/**
 * Days of regular paid leave available (hr_my_leave_balances rows): paid
 * types only (unpaid leave is loss of pay, not an allowance), maternity /
 * paternity excluded, a negative balance counts as 0 so it never hides
 * another type's days. Rounded to 2 decimals.
 */
export function generalLeaveAvailable(balances) {
  const total = (balances ?? []).reduce((sum, b) => {
    if (!b || b.paid === false || isSpecialLeave(b)) return sum;
    const avail = Number(b.available ?? 0);
    return sum + (Number.isFinite(avail) && avail > 0 ? avail : 0);
  }, 0);
  return Math.round(total * 100) / 100;
}
