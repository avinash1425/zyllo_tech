"use client";

import { Cookie, Info } from "lucide-react";
import { useEffect, useState } from "react";
import LegalModal from "@/components/LegalModal";
import { PRIVACY_LAST_UPDATED, PRIVACY_SECTIONS } from "@/data/legal-content";
import { getConsent, OPEN_COOKIE_SETTINGS_EVENT, setConsent } from "@/lib/consent";

// Structure referenced directly from gcoman.com's own cookie banner — a
// compact centered pill with a gradient border, not a full-width card.
// "Learn more" opens the Privacy & Cookie Policy modal (same one the footer
// uses) rather than a fake granular-preference panel we don't actually have.
// Accept/Decline control Google Analytics only; the copy says so.
// The footer's "Cookie Settings" link reopens this banner to change a choice.
export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);

  useEffect(() => {
    if (!getConsent()) {
      const timer = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    const reopen = () => setVisible(true);
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, reopen);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, reopen);
  }, []);

  function respond(choice) {
    setConsent(choice);
    setVisible(false);
  }

  // Tell the floating buttons to lift above the banner on small screens.
  useEffect(() => {
    const on = visible && !showPolicy;
    document.documentElement.toggleAttribute("data-zt-cookie", on);
    return () => document.documentElement.removeAttribute("data-zt-cookie");
  }, [visible, showPolicy]);

  if (!visible) return null;

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-3 sm:px-4" style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <div className="zt-cookie-pop pointer-events-auto w-fit max-w-[calc(100vw-1.5rem)] rounded-[28px] bg-gradient-to-r from-[#3089a6] via-[#f96706] to-[#ffb15c] p-[2px] shadow-[0_20px_25px_-5px_rgba(0,0,0,0.10)] lg:rounded-full">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-[26px] bg-white px-4 py-2 lg:rounded-full lg:pr-2">
            <Cookie className="h-4 w-4 shrink-0 text-[#f96706]" aria-hidden="true" />
            <span className="text-center text-xs font-medium text-[#1d2735] lg:whitespace-nowrap">
              We&apos;d like to use optional Google Analytics cookies to understand how our website is used.
            </span>
            <div className="hidden h-4 w-px bg-[#e2e5ea] lg:block" aria-hidden="true" />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowPolicy(true)}
                className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium text-[#6c7889] transition-colors duration-200 hover:bg-[#f4f5f7] hover:text-[#1d2735]"
              >
                <Info className="h-3 w-3" aria-hidden="true" />
                Learn more
              </button>
              <button
                type="button"
                onClick={() => respond("declined")}
                className="inline-flex h-7 items-center whitespace-nowrap rounded-full border border-[#e2e5ea] px-3 text-[11px] font-medium text-[#6c7889] transition-colors duration-200 hover:bg-[#f4f5f7] hover:text-[#1d2735]"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => respond("accepted")}
                className="inline-flex h-7 items-center whitespace-nowrap rounded-full bg-gradient-to-r from-[#f96706] to-[#ffb15c] px-3 text-[11px] font-semibold text-white shadow-sm transition-opacity duration-200 hover:opacity-90"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      </div>

      <LegalModal
        isOpen={showPolicy}
        onClose={() => setShowPolicy(false)}
        title="Privacy & Cookie Policy"
        lastUpdated={PRIVACY_LAST_UPDATED}
        sections={PRIVACY_SECTIONS}
      />

      <style>{`
        @keyframes ztCookiePop {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .zt-cookie-pop {
          animation: ztCookiePop 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .zt-cookie-pop {
            animation: none;
          }
        }
      `}</style>
    </>
  );
}
