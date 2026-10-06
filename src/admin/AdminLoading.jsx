import { useEffect, useState } from "react";
import Image from "@/lib/nx/image";

// Branded admin loader: the Zyllo infinity mark at the centre of two
// counter-rotating gradient rings with orbiting dots, a soft pulsing glow and
// a sliding progress bar, on a branded panel. The panel reserves its height at
// once; the visuals fade in after `delay` ms so quick loads never flash it.
// All animation is switched off for prefers-reduced-motion.
// `variant` is accepted for backward compatibility with existing callers.
export default function AdminLoading({ label = "Loading…", delay = 120 }) {
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
      aria-busy="true"
      className="relative isolate flex min-h-[62vh] w-full items-center justify-center overflow-hidden rounded-3xl border border-[#e7e9ee] bg-white shadow-[0_1px_2px_rgba(16,26,58,0.04),0_16px_40px_-24px_rgba(16,26,58,0.25)]"
    >
      <span className="sr-only">{label}</span>

      {/* Soft branded backdrop */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-20 -top-24 h-72 w-72 rounded-full bg-[#f7941e]/15 blur-[90px]" />
        <div className="absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-[#3089a6]/15 blur-[100px]" />
        <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(rgba(23,58,82,0.10)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_72%)]" />
      </div>

      {show && (
        <div aria-hidden="true" className="zt-al-in flex flex-col items-center px-6 text-center">
          <div className="relative flex h-36 w-36 items-center justify-center">
            <span className="zt-al-glow absolute h-24 w-24 rounded-full bg-gradient-to-br from-[#f96706]/45 to-[#3089a6]/45 blur-2xl" />

            {/* Outer ring (clockwise) with an orbiting dot */}
            <svg viewBox="0 0 100 100" className="zt-al-spin absolute h-full w-full">
              <defs>
                <linearGradient id="zt-al-g1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#f96706" />
                  <stop offset="100%" stopColor="#ffb15c" />
                </linearGradient>
                <linearGradient id="zt-al-g2" x1="100%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#3089a6" />
                  <stop offset="100%" stopColor="#1f4693" />
                </linearGradient>
              </defs>
              <circle cx="50" cy="50" r="47" fill="none" stroke="#e7e9ee" strokeWidth="2" />
              <circle cx="50" cy="50" r="47" fill="none" stroke="url(#zt-al-g1)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="110 186" />
              <circle cx="97" cy="50" r="3.2" fill="#f96706" />
            </svg>

            {/* Inner ring (counter-clockwise) with an orbiting dot */}
            <svg viewBox="0 0 100 100" className="zt-al-spin-rev absolute h-[78%] w-[78%]">
              <circle cx="50" cy="50" r="46" fill="none" stroke="#eef0f5" strokeWidth="2" />
              <circle cx="50" cy="50" r="46" fill="none" stroke="url(#zt-al-g2)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="70 219" />
              <circle cx="4" cy="50" r="3" fill="#3089a6" />
            </svg>

            <Image
              src="/zyllo-icon.png"
              alt=""
              width={500}
              height={273}
              className="zt-al-pulse relative h-12 w-auto drop-shadow-[0_6px_14px_rgba(16,26,58,0.25)]"
            />
          </div>

          <p className="mt-5 text-lg font-bold tracking-tight text-[#101a3a]">{label}</p>
          <p className="mt-1 text-[14.5px] text-[#5b6472]">Getting your data ready</p>

          <div className="mt-5 h-1.5 w-56 overflow-hidden rounded-full bg-[#e9ecf2]">
            <span className="zt-al-bar block h-full w-2/5 rounded-full bg-gradient-to-r from-[#f96706] via-[#f7941e] to-[#3089a6]" />
          </div>
        </div>
      )}

      <style>{`
        .zt-al-in { animation: ztAlIn .3s ease-out both; }
        @keyframes ztAlIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .zt-al-spin { animation: ztAlSpin 2.2s linear infinite; }
        .zt-al-spin-rev { animation: ztAlSpinRev 1.8s linear infinite; }
        @keyframes ztAlSpin { to { transform: rotate(360deg); } }
        @keyframes ztAlSpinRev { to { transform: rotate(-360deg); } }
        .zt-al-pulse { animation: ztAlPulse 2s ease-in-out infinite; }
        @keyframes ztAlPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
        .zt-al-glow { animation: ztAlGlow 2.4s ease-in-out infinite; }
        @keyframes ztAlGlow { 0%,100% { opacity: .55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.15); } }
        .zt-al-bar { animation: ztAlBar 1.5s ease-in-out infinite; }
        @keyframes ztAlBar { 0% { transform: translateX(-110%); } 100% { transform: translateX(260%); } }
        @media (prefers-reduced-motion: reduce) {
          .zt-al-in, .zt-al-spin, .zt-al-spin-rev, .zt-al-pulse, .zt-al-glow, .zt-al-bar { animation: none; }
        }
      `}</style>
    </div>
  );
}
