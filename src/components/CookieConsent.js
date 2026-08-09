"use client";

import { Cookie, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import LegalModal from "@/components/LegalModal";
import { PRIVACY_LAST_UPDATED, PRIVACY_SECTIONS } from "@/data/legal-content";

const STORAGE_KEY = "zyllo-cookie-consent";

// Structure referenced directly from gcoman.com's own cookie banner — a
// compact centered pill with a gradient border, not a full-width card.
// "Settings" opens the Privacy & Cookie Policy modal (same one the footer
// uses) rather than a fake granular-preference panel we don't actually have.
export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      const timer = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(timer);
    }
  }, []);

  function respond(choice) {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ choice, date: new Date().toISOString() })
    );
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <>
      <div className="cookie-pop fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 px-4">
        <div className="rounded-full bg-gradient-to-r from-[#3089a6] via-[#f96706] to-[#ffb15c] p-[2px] shadow-xl shadow-black/10">
          <div className="flex flex-wrap items-center gap-3 rounded-full bg-white py-2 pl-4 pr-2">
            <Cookie className="h-4 w-4 shrink-0 text-[#f96706]" aria-hidden="true" />
            <span className="whitespace-nowrap text-xs font-medium text-[#1d2735]">
              We use cookies
            </span>
            <div className="h-4 w-px bg-[#e2e5ea]" aria-hidden="true" />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowPolicy(true)}
                className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium text-[#6c7889] transition-colors duration-200 hover:bg-[#f4f5f7] hover:text-[#1d2735]"
              >
                <Settings2 className="h-3 w-3" aria-hidden="true" />
                Settings
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
                Accept All
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

      <style jsx>{`
        @keyframes cookiePop {
          from {
            opacity: 0;
            transform: translate(-50%, 16px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
        .cookie-pop {
          animation: cookiePop 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .cookie-pop {
            animation: none;
            transform: translateX(-50%);
          }
        }
      `}</style>
    </>
  );
}
