import { useEffect, useState } from "react";
import { usePathname } from "@/lib/nx/navigation";
import { CONSENT_CHANGE_EVENT, CONSENT_KEY, getConsent } from "@/lib/consent";

// Google Analytics 4 with Consent Mode v2 ("basic"): gtag.js is not even
// requested until the visitor accepts cookies. Page views come from GA4's
// own config hit plus Enhanced Measurement's history-change page views, so
// nothing here sends page_view itself (sending one too would double count) —
// except once when consent is granted again mid-visit (see below).
const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;
const DISABLE_FLAG = `ga-disable-${MEASUREMENT_ID}`;
const PRODUCTION_HOSTS = ["zyllotech.com", "www.zyllotech.com"];
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

let gtagLoaded = false;
let analyticsGranted = false;
let consentAccepted = false;

// Lovable previews and local dev send nothing. VITE_GA_LOCAL_TEST=true (set
// on the command line, never committed) enables localhost for testing.
function isAllowedHost() {
  const host = window.location.hostname;
  if (PRODUCTION_HOSTS.includes(host)) return import.meta.env.PROD;
  return LOCAL_HOSTS.includes(host) && import.meta.env.VITE_GA_LOCAL_TEST === "true";
}

function isUntrackedPath(pathname) {
  return pathname === "/login" || pathname === "/admin" || pathname.startsWith("/admin/");
}

// Supabase auth emails (invites, password resets) land with tokens in the
// URL (detectSessionInUrl). Never let GA see such a URL; the next navigation
// is tracked once Supabase has cleaned it up.
const AUTH_URL_PARAMS = /[#?&](access_token|refresh_token|token_hash|code|error_description)=/;
function hasAuthParams() {
  return AUTH_URL_PARAMS.test(window.location.search + window.location.hash);
}

// ga-disable stops every hit, including the cookieless pings Consent Mode
// would otherwise still send while analytics_storage is denied.
function updateDisableFlag(pathname) {
  window[DISABLE_FLAG] = !consentAccepted || isUntrackedPath(pathname);
}

// React Router commits a navigation in a transition, so a lazy route such as
// /admin can render seconds after the URL changes — after Enhanced
// Measurement has already sent its history page_view. Flip the flag
// synchronously on every history change instead. Installed before gtag.js,
// so this runs ahead of GA's own history listeners. It only reads the target
// URL; the original call always runs with the same arguments and result.
function watchHistory() {
  for (const method of ["pushState", "replaceState"]) {
    const original = window.history[method];
    window.history[method] = function (...args) {
      try {
        if (args[2] != null) updateDisableFlag(new URL(args[2], window.location.href).pathname);
      } catch {
        // Unparseable URL: leave the flag alone and let the browser decide.
      }
      return original.apply(this, args);
    };
  }
  window.addEventListener("popstate", () => updateDisableFlag(window.location.pathname));
}

function gtag() {
  // gtag.js expects the arguments object itself, not an array.
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments);
}

function loadGtag() {
  gtagLoaded = true;
  analyticsGranted = true;
  watchHistory();
  window.dataLayer = window.dataLayer || [];
  window.gtag = gtag;
  gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  gtag("consent", "update", { analytics_storage: "granted" });
  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);
}

// GA sets _ga and _ga_<container> on the top-level domain; clear every
// variant this host could have written.
function deleteGaCookies() {
  const parts = window.location.hostname.split(".");
  const domains = [""];
  for (let i = 0; i < parts.length - 1; i++) {
    const domain = parts.slice(i).join(".");
    domains.push(`; domain=${domain}`, `; domain=.${domain}`);
  }
  document.cookie.split(";").forEach((cookie) => {
    const name = cookie.split("=")[0].trim();
    if (name !== "_ga" && !name.startsWith("_ga_")) return;
    domains.forEach((domain) => {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
    });
  });
}

export default function Analytics() {
  const pathname = usePathname();
  const [consent, setConsentState] = useState(getConsent);

  useEffect(() => {
    function onChange(event) {
      setConsentState(event.detail?.choice ?? getConsent());
    }
    // Another tab changed the choice.
    function onStorage(event) {
      if (event.key === CONSENT_KEY || event.key === null) setConsentState(getConsent());
    }
    window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!MEASUREMENT_ID || !isAllowedHost()) return;

    consentAccepted = consent === "accepted";
    // The router's pathname can lag the URL (see watchHistory); go by the URL.
    updateDisableFlag(window.location.pathname);

    if (consentAccepted) {
      const tracked = !isUntrackedPath(window.location.pathname);
      if (!gtagLoaded) {
        if (tracked && !hasAuthParams()) loadGtag();
      } else if (!analyticsGranted) {
        // Accepted again after withdrawing in this same visit. No history
        // change will announce the page the visitor is on, so count it here.
        analyticsGranted = true;
        gtag("consent", "update", { analytics_storage: "granted" });
        if (tracked) gtag("event", "page_view");
      }
      return;
    }

    if (gtagLoaded && analyticsGranted) {
      analyticsGranted = false;
      gtag("consent", "update", { analytics_storage: "denied" });
    }
    if (consent === "declined") deleteGaCookies();
  }, [consent, pathname]);

  return null;
}
