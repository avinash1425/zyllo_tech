import { CompatImage as Image } from "@/components/NextCompat";
import { usePathname } from "@/components/NextCompat";
import { useEffect, useRef, useState } from "react";
import {
  Cloud,
  Code2,
  Lightbulb,
  Palette,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TestTube2,
  Wrench,
} from "lucide-react";

const MIN_VISIBLE_MS = 1100;

const STATUS_MESSAGES = [
  "Compiling ideas...",
  "Warming up the AI...",
  "Connecting the backend...",
  "Rendering the experience...",
  "Almost there...",
];

// Same icon set used on the real /services pages — the loader's backdrop is
// literally "what we do", not generic decoration.
const SERVICE_ICONS = [
  { Icon: Lightbulb, x: "12%", y: "18%", color: "#f96706", delay: "0s" },
  { Icon: Code2, x: "85%", y: "14%", color: "#3089a6", delay: "0.4s" },
  { Icon: Smartphone, x: "8%", y: "78%", color: "#3089a6", delay: "0.8s" },
  { Icon: Palette, x: "90%", y: "76%", color: "#f96706", delay: "1.2s" },
  { Icon: Cloud, x: "18%", y: "48%", color: "#3089a6", delay: "1.6s" },
  { Icon: Sparkles, x: "82%", y: "46%", color: "#f96706", delay: "2s" },
  { Icon: Wrench, x: "50%", y: "10%", color: "#3089a6", delay: "0.2s" },
  { Icon: ShieldCheck, x: "50%", y: "88%", color: "#f96706", delay: "0.6s" },
  { Icon: TestTube2, x: "94%", y: "50%", color: "#3089a6", delay: "1s" },
];

function useTypewriter(phrases, active) {
  const [text, setText] = useState("");
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!active) {
      setText("");
      setPhraseIndex(0);
      setIsDeleting(false);
      return;
    }

    const current = phrases[phraseIndex % phrases.length];
    let delay;
    if (!isDeleting && text.length < current.length) {
      delay = 45;
    } else if (!isDeleting && text.length === current.length) {
      delay = 900;
    } else if (isDeleting && text.length > 0) {
      delay = 25;
    } else {
      delay = 10;
    }

    const timeout = setTimeout(() => {
      if (!isDeleting && text.length < current.length) {
        setText(current.slice(0, text.length + 1));
      } else if (!isDeleting && text.length === current.length) {
        setIsDeleting(true);
      } else if (isDeleting && text.length > 0) {
        setText(current.slice(0, text.length - 1));
      } else {
        setIsDeleting(false);
        setPhraseIndex((i) => (i + 1) % phrases.length);
      }
    }, delay);

    return () => clearTimeout(timeout);
  }, [text, isDeleting, phraseIndex, active, phrases]);

  return text;
}

export default function PageTransition() {
  const pathname = usePathname();
  const [isVisible, setIsVisible] = useState(false);
  const isFirstRender = useRef(true);
  const hideTimeoutRef = useRef(null);
  const shownAtRef = useRef(0);
  const statusText = useTypewriter(STATUS_MESSAGES, isVisible);

  // Show the overlay as soon as a navigation click happens.
  useEffect(() => {
    function handleClick(e) {
      const link = e.target.closest("a");
      if (!link) return;

      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }
      if (link.target === "_blank") return;

      // Strip any hash/query before comparing so same-page anchor links
      // (e.g. "/services#services-grid" while already on "/services")
      // don't trigger the overlay — pathname alone would never change,
      // leaving it stuck visible.
      const hrefPath = href.split("#")[0].split("?")[0] || "/";
      if (hrefPath === pathname) return;

      shownAtRef.current = Date.now();
      setIsVisible(true);
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [pathname]);

  // Once the new route has actually rendered (pathname changed), keep the
  // overlay up until the minimum display time has elapsed, then hide it.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);

    const elapsed = Date.now() - shownAtRef.current;
    const remaining = Math.max(MIN_VISIBLE_MS - elapsed, 0);

    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, remaining);

    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [pathname]);

  if (!isVisible) return null;

  return (
    <div aria-hidden="true" className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#0b0e17]">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_20%_25%,rgba(249,103,6,0.16),transparent_55%),radial-gradient(circle_at_80%_75%,rgba(48,137,166,0.16),transparent_55%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Service icons — "what we do", floating quietly in the backdrop */}
      {SERVICE_ICONS.map(({ Icon, x, y, color, delay }, i) => (
        <div
          key={i}
          className="loader-service-icon absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border"
          style={{
            left: x,
            top: y,
            borderColor: `${color}33`,
            backgroundColor: `${color}14`,
            animationDelay: delay,
          }}
        >
          <Icon className="h-5 w-5" style={{ color }} aria-hidden="true" />
        </div>
      ))}

      <div className="page-transition-content relative flex flex-col items-center gap-5">
        {/* Icon in a round gradient-ring frame with a shine sweep — no duplicate logo below */}
        <div className="relative flex h-32 w-32 items-center justify-center">
          <div
            aria-hidden="true"
            className="loader-glow absolute h-24 w-24 rounded-full bg-gradient-to-r from-[#f96706]/45 to-[#3089a6]/45 blur-2xl"
          />

          <svg viewBox="0 0 100 100" className="absolute h-full w-full -rotate-90">
            <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="url(#loader-arc-gradient)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="80 209"
              className="loader-arc"
            />
            <defs>
              <linearGradient id="loader-arc-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f96706" />
                <stop offset="100%" stopColor="#3089a6" />
              </linearGradient>
            </defs>
          </svg>

          <div className="relative flex h-[4.5rem] w-[4.5rem] items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.04] backdrop-blur-sm">
            <Image
              src="/zyllo-icon.png"
              alt=""
              width={1130}
              height={660}
              priority
              className="loader-icon-pulse h-11 w-auto drop-shadow-[0_0_16px_rgba(249,103,6,0.55)]"
            />
            <span aria-hidden="true" className="loader-shine absolute inset-0" />
          </div>
        </div>

        <p className="text-xl font-extrabold uppercase tracking-tight">
          <span className="bg-gradient-to-b from-[#ffd9a0] via-[#f96706] to-[#a83e07] bg-clip-text text-transparent">
            Zyllo
          </span>{" "}
          <span className="bg-gradient-to-b from-[#bfe6f2] via-[#3089a6] to-[#173a52] bg-clip-text text-transparent">
            Tech
          </span>
        </p>

        <div className="flex items-center gap-2">
          <span className="loader-dot h-2 w-2 rounded-full bg-[#f96706]" style={{ animationDelay: "0s" }} />
          <span className="loader-dot h-2 w-2 rounded-full bg-[#ffb15c]" style={{ animationDelay: "0.18s" }} />
          <span className="loader-dot h-2 w-2 rounded-full bg-[#3089a6]" style={{ animationDelay: "0.36s" }} />
        </div>

        <p className="flex h-4 items-center text-xs font-medium tracking-wide text-white/45">
          {statusText}
          <span className="typewriter-caret ml-0.5 inline-block h-3.5 w-px bg-white/50" />
        </p>
      </div>

      <style>{`
        .page-transition-content {
          animation: pulseIn 0.4s ease-out;
        }
        @keyframes pulseIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .loader-icon-pulse {
          animation: loaderIconPulse 2.2s ease-in-out infinite;
        }
        @keyframes loaderIconPulse {
          0%,
          100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.08);
          }
        }
        .loader-glow {
          animation: loaderGlowPulse 2.2s ease-in-out infinite;
        }
        @keyframes loaderGlowPulse {
          0%,
          100% {
            opacity: 0.6;
          }
          50% {
            opacity: 1;
          }
        }
        .loader-arc {
          animation: loaderArcSpin 1.6s linear infinite;
          transform-origin: center;
        }
        @keyframes loaderArcSpin {
          to {
            transform: rotate(360deg);
          }
        }
        .loader-shine {
          background: linear-gradient(115deg, transparent 40%, rgba(255, 255, 255, 0.35) 50%, transparent 60%);
          background-size: 250% 250%;
          animation: loaderShineSweep 2.6s ease-in-out infinite;
        }
        @keyframes loaderShineSweep {
          0% {
            background-position: 200% 200%;
          }
          60%,
          100% {
            background-position: -50% -50%;
          }
        }
        .loader-dot {
          animation: loaderDotWave 1.3s ease-in-out infinite;
        }
        @keyframes loaderDotWave {
          0%,
          60%,
          100% {
            transform: scale(0.7);
            opacity: 0.4;
          }
          30% {
            transform: scale(1.3);
            opacity: 1;
          }
        }
        .loader-service-icon {
          animation: loaderServiceFloat 5s ease-in-out infinite;
        }
        @keyframes loaderServiceFloat {
          0%,
          100% {
            transform: translate(-50%, -50%) translateY(0);
            opacity: 0.5;
          }
          50% {
            transform: translate(-50%, -50%) translateY(-10px);
            opacity: 0.85;
          }
        }
        .typewriter-caret {
          animation: caretBlink 0.8s step-end infinite;
        }
        @keyframes caretBlink {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
