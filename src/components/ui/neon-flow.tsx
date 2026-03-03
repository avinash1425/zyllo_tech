import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface TubesBackgroundProps {
  children?: React.ReactNode;
  className?: string;
  enableClickInteraction?: boolean;
}

const palettes = [
  { primary: "#f97316", secondary: "#06b6d4", accent: "#fb7185" },
  { primary: "#22c55e", secondary: "#3b82f6", accent: "#f97316" },
  { primary: "#e879f9", secondary: "#14b8a6", accent: "#60a5fa" },
];

export function TubesBackground({
  children,
  className,
  enableClickInteraction = true,
}: TubesBackgroundProps) {
  const [paletteIndex, setPaletteIndex] = useState(0);
  const palette = useMemo(() => palettes[paletteIndex % palettes.length], [paletteIndex]);

  return (
    <div
      className={cn("relative h-full min-h-[400px] w-full overflow-hidden bg-transparent", className)}
      onClick={() => {
        if (!enableClickInteraction) return;
        setPaletteIndex((prev) => prev + 1);
      }}
    >
      <style>
        {`
          @keyframes neonSpin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes pulseGlow {
            0%, 100% { opacity: 0.75; filter: blur(0px); }
            50% { opacity: 1; filter: blur(1.5px); }
          }
          @keyframes travelDash {
            to { stroke-dashoffset: -360; }
          }
        `}
      </style>

      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -left-16 top-[-20%] h-80 w-80 rounded-full blur-3xl"
          style={{ background: `${palette.primary}33` }}
        />
        <div
          className="absolute right-[-4%] top-[30%] h-80 w-80 rounded-full blur-3xl"
          style={{ background: `${palette.secondary}33` }}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className="relative h-[340px] w-[640px] max-w-[92vw] max-h-[52vh]"
          style={{ animation: "neonSpin 36s linear infinite" }}
        >
          <svg viewBox="0 0 512 256" className="h-full w-full">
            <defs>
              <linearGradient id="zylloInfinityGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={palette.primary} />
                <stop offset="50%" stopColor={palette.secondary} />
                <stop offset="100%" stopColor={palette.accent} />
              </linearGradient>
              <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <path
              d="M256 128 C216 76 152 76 120 128 C152 180 216 180 256 128 C296 76 360 76 392 128 C360 180 296 180 256 128"
              fill="none"
              stroke="url(#zylloInfinityGradient)"
              strokeWidth="16"
              strokeLinecap="round"
              filter="url(#softGlow)"
              style={{ animation: "pulseGlow 3.8s ease-in-out infinite" }}
            />
            <path
              d="M256 128 C216 76 152 76 120 128 C152 180 216 180 256 128 C296 76 360 76 392 128 C360 180 296 180 256 128"
              fill="none"
              stroke="#ffffffcc"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="42 26"
              style={{ animation: "travelDash 2.8s linear infinite" }}
            />
          </svg>
        </div>
      </div>

      <div className="relative z-10 h-full w-full pointer-events-none">{children}</div>
    </div>
  );
}

export default TubesBackground;
