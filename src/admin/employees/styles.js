// Shared styles of the admin Employee Portal pages — now the Portal UI kit tokens
// (src/components/portal/portalStyles.js), so every page matches the main admin look.
import { EMPLOYMENT_TYPES } from "@/lib/api/employee/profile";
import { BTN_DANGER, BTN_NAVY, BTN_PRIMARY, BTN_SECONDARY, CARD_PAD, INPUT, INPUT_INLINE } from "@/components/portal/portalStyles";

/** Card WITH padding (kept for older call sites; new code uses <Panel>). */
export const CARD = CARD_PAD;
export { BTN_DANGER, BTN_NAVY, BTN_PRIMARY, BTN_SECONDARY, INPUT, INPUT_INLINE };
export const EMPLOYMENT_OPTIONS = Object.entries(EMPLOYMENT_TYPES).map(([value, label]) => ({ value, label }));
