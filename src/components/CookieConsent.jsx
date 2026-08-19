import { CompatLink as Link } from "@/components/NextCompat";
import { Cookie, X } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "zyllo-cookie-consent";

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

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
    <div className="fixed inset-x-0 bottom-0 z-[60] p-4 sm:p-6">
      <div className="cookie-pop relative mx-auto max-w-3xl overflow-hidden rounded-2xl border border-white/70 bg-white/95 p-5 shadow-2xl shadow-black/10 backdrop-blur-xl sm:p-6">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#f7941e] to-[#1f4693]"
        />

        <button
          type="button"
          onClick={() => respond("dismissed")}
          aria-label="Dismiss"
          className="absolute right-4 top-4 text-[#676b7a] transition-colors hover:text-[#2b303b]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/70 bg-gradient-to-br from-[#f7941e]/20 to-[#1f4693]/20 shadow-md shadow-[#f7941e]/10">
            <Cookie className="h-5 w-5 text-[#f7941e]" aria-hidden="true" />
          </div>

          <div className="flex-1 pr-6 sm:pr-0">
            <p className="text-sm font-semibold text-[#2b303b]">We use cookies</p>
            <p className="mt-1 text-sm leading-relaxed text-[#676b7a]">
              We use cookies to keep the site running smoothly and understand
              how it&apos;s used. Read our{" "}
              <Link
                href="/privacy"
                className="font-medium text-[#f7941e] underline decoration-[#f7941e]/30 underline-offset-2 transition-colors duration-200 hover:text-[#db7d17] hover:decoration-[#db7d17]/40"
              >
                Privacy Policy
              </Link>{" "}
              to learn more.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => respond("declined")}
              className="rounded-lg border border-[#e7e9ee] bg-white px-4 py-2.5 text-sm font-semibold text-[#676b7a] transition-all duration-200 hover:border-[#2b303b]/20 hover:text-[#2b303b]"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => respond("accepted")}
              className="rounded-lg bg-[#f7941e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#db7d17]"
            >
              Accept All
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes cookiePop {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .cookie-pop {
          animation: cookiePop 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
      `}</style>
    </div>
  );
}
