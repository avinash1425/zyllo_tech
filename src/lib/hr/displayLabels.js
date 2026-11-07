// Pure display helpers shared by HR pages (no Supabase import, so they can be
// unit-tested with node --test).

const nameOf = (e) => (e ? (e.display_name || `${e.first_name ?? ""} ${e.last_name ?? ""}`).trim() : "");

/** "Name (CODE)", or just the name when the employee code is not available. */
export function personLabel(e) {
  if (!e) return null;
  const name = nameOf(e);
  const code = typeof e.employee_code === "string" ? e.employee_code.trim() : "";
  if (!name) return code || null;
  return code ? `${name} (${code})` : name;
}

const OFFER_RESPONSE = {
  accepted: { label: "Offer accepted", tone: "green" },
  declined: { label: "Offer declined", tone: "red" },
  expired: { label: "Offer expired", tone: "amber" },
  sent: { label: "Awaiting candidate response", tone: "blue" },
};

/**
 * The application stage stays "offered" after the candidate responds (the
 * Hire step requires stage = offered + an accepted offer), so the response is
 * shown next to the stage. An accepted offer wins; otherwise the most recent
 * sent / declined / expired offer (drafts and withdrawn offers are ignored).
 * Returns { label, tone } or null.
 */
export function offerResponseBadge(stage, offers) {
  if (stage !== "offered" || !Array.isArray(offers) || !offers.length) return null;
  const live = offers.filter((o) => o && OFFER_RESPONSE[o.status]);
  if (!live.length) return null;
  if (live.some((o) => o.status === "accepted")) return OFFER_RESPONSE.accepted;   // the offer Hire uses
  const latest = live.reduce((a, b) => (String(b.responded_at ?? b.sent_at ?? b.created_at ?? "") >= String(a.responded_at ?? a.sent_at ?? a.created_at ?? "") ? b : a));
  return OFFER_RESPONSE[latest.status];
}
