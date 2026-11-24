// Is this a real email address? (migration 267: HR, Manager, Team Lead and Employee must use their own
// real email; Super Admin / Admin may use any.) The database refuses placeholder / test domains; this also
// asks public DNS whether the domain receives mail (MX record), which catches typos like "gmial.com".
// A specific mailbox can only be proven by sending it an email.

const RESERVED = /(^|\.)(example\.(com|net|org)|test|invalid|localhost|local|example|internal|lan|home|corp|localdomain)$/i;
const THROWAWAY = new Set(["mailinator.com", "tempmail.com", "10minutemail.com", "guerrillamail.com", "yopmail.com", "trashmail.com", "fake.com", "test.com", "email.com"]);
const FORMAT = /^[^@\s]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
const cache = new Map();

/** Same rule as the database (ep_email_is_real). */
export function emailLooksReal(email) {
  const e = String(email ?? "").trim().toLowerCase();
  const domain = e.split("@")[1] ?? "";
  return FORMAT.test(e) && !RESERVED.test(domain) && !THROWAWAY.has(domain);
}

/** Does the domain accept email? true / false, or null when it could not be checked (network). */
async function domainReceivesMail(domain) {
  if (cache.has(domain)) return cache.get(domain);
  const ask = async (type) => {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
    });
    if (!r.ok) throw new Error("dns");
    const j = await r.json();
    return j.Status === 0 && Array.isArray(j.Answer) && j.Answer.length > 0;
  };
  try {
    const ok = (await ask("MX")) || (await ask("A")); // no MX: mail goes to the domain's own address
    cache.set(domain, ok);
    return ok;
  } catch {
    return null;
  }
}

/** { ok, message } — message explains why it is not accepted. Unknown (offline DNS) counts as ok. */
export async function checkRealEmail(email) {
  const e = String(email ?? "").trim().toLowerCase();
  if (!emailLooksReal(e)) return { ok: false, message: "Use the person's own real email address (this one cannot receive email)." };
  const ok = await domainReceivesMail(e.split("@")[1]);
  if (ok === false) return { ok: false, message: `The domain “${e.split("@")[1]}” does not receive email. Check the spelling.` };
  return { ok: true, message: "" };
}

export const REAL_EMAIL_ROLES = ["hr", "manager", "team_lead", "employee"];
