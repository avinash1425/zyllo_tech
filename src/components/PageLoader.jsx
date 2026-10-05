import { useEffect, useState } from "react";
import Image from "@/lib/nx/image";

// Branded loader. `inline` = compact (sections), default = route-level.
// The box always reserves its height (no layout jump); the visuals fade in
// only after `delay` ms so ultra-fast loads never flash it.
export default function PageLoader({ inline = false, label = "Loading...", delay = 120 }) {
  const [show, setShow] = useState(delay <= 0);

  useEffect(() => {
    if (delay <= 0) return undefined;
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex w-full items-center justify-center ${inline ? "min-h-[200px]" : "min-h-[60vh]"}`}
    >
      <span className="sr-only">{label}</span>
      {show && (
        <div aria-hidden="true" className="zt-pl-in flex flex-col items-center gap-3">
          <div className="relative flex h-20 w-20 items-center justify-center">
            <span className="zt-pl-glow absolute h-14 w-14 rounded-full bg-gradient-to-r from-[#f96706]/40 to-[#3089a6]/40 blur-xl" />
            <svg viewBox="0 0 100 100" className="zt-pl-spin absolute h-full w-full">
              <defs>
                <linearGradient id="zt-pl-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#f96706" />
                  <stop offset="100%" stopColor="#3089a6" />
                </linearGradient>
              </defs>
              <circle cx="50" cy="50" r="45" fill="none" stroke="#d9dde2" strokeWidth="3" opacity="0.6" />
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="url(#zt-pl-grad)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray="90 193"
              />
            </svg>
            <Image
              src="/zyllo-icon.png"
              alt=""
              width={500}
              height={273}
              className="zt-pl-pulse relative h-8 w-auto"
            />
          </div>
          <p className="text-[15px] font-medium text-[#4a5668]">{label}</p>
        </div>
      )}
      <style>{`
        .zt-pl-in { animation: ztPlIn .25s ease-out both; }
        @keyframes ztPlIn { from { opacity: 0; } to { opacity: 1; } }
        .zt-pl-spin { animation: ztPlSpin 1.4s linear infinite; }
        @keyframes ztPlSpin { to { transform: rotate(360deg); } }
        .zt-pl-pulse { animation: ztPlPulse 2s ease-in-out infinite; }
        @keyframes ztPlPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.1); } }
        .zt-pl-glow { animation: ztPlGlow 2s ease-in-out infinite; }
        @keyframes ztPlGlow { 0%,100% { opacity: .5; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .zt-pl-spin, .zt-pl-pulse, .zt-pl-glow, .zt-pl-in { animation: none; }
        }
      `}</style>
    </div>
  );
}
