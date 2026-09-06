const STORAGE_KEY = "zyllo-cookie-consent";

// GA4 property "Zyllotech" → web data stream "Zyllo Tech Website".
const GA_MEASUREMENT_ID = "G-LQYNCZH7K1";

let injected = false;

// Injects GA4 only when the visitor has accepted cookies. Safe to call
// unconditionally (no-op without consent, on decline, or while the
// measurement ID is still the placeholder).
export function initAnalytics() {
  if (injected) return;
  if (typeof window === "undefined") return;
  if (GA_MEASUREMENT_ID === "G-XXXXXXXXXX") return;

  let consent;
  try {
    consent = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return;
  }
  if (consent?.choice !== "accepted") return;

  injected = true;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID);
}
