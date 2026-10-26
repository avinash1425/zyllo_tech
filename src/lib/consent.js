// Cookie-consent choice shared by the banner (CookieConsent.jsx) and
// Google Analytics (Analytics.jsx). The key is versioned: v1 was recorded
// before GA4 was installed, so moving to v2 asks every visitor again.
export const CONSENT_KEY = "zyllo-cookie-consent-v2";
const LEGACY_KEYS = ["zyllo-cookie-consent"];

export const CONSENT_CHANGE_EVENT = "zt:consent-change";
export const OPEN_COOKIE_SETTINGS_EVENT = "zt:open-cookie-settings";

// "accepted" | "declined" | null (no choice yet, or storage unavailable).
export function getConsent() {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const { choice } = JSON.parse(raw);
    return choice === "accepted" || choice === "declined" ? choice : null;
  } catch {
    return null;
  }
}

export function setConsent(choice) {
  try {
    window.localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ choice, date: new Date().toISOString() })
    );
    LEGACY_KEYS.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage blocked: the choice still applies for this page view.
  }
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: { choice } }));
}

// Reopens the banner so a visitor can change an earlier choice.
export function openCookieSettings() {
  window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT));
}
