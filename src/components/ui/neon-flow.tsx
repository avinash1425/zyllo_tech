import { cn } from "@/lib/utils";

interface TubesBackgroundProps {
  children?: React.ReactNode;
  className?: string;
  enableClickInteraction?: boolean;
}

export function TubesBackground({ children, className }: TubesBackgroundProps) {
  return (
    <div className={cn("relative h-full min-h-[400px] w-full overflow-hidden bg-transparent", className)}>
      <style>
        {`
          @keyframes infinityRotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes infinityGlow {
            0%, 100% { opacity: 0.7; }
            50% { opacity: 1; }
          }
          @keyframes infinityDash {
            to { stroke-dashoffset: -320; }
          }
        `}
      </style>

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-[-24%] h-80 w-80 rounded-full bg-primary/25 blur-3xl" />
        <div className="absolute right-[-6%] top-[34%] h-80 w-80 rounded-full bg-[hsl(195,55%,42%,0.2)] blur-3xl" />
      </div>

      <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
        <div className="h-[44%] w-[76%] max-h-[360px] max-w-[920px]" style={{ animation: "infinityRotate 42s linear infinite" }}>
          <svg viewBox="0 0 512 256" className="h-full w-full">
            <defs>
              <linearGradient id="zylloInfinity" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f97316" />
                <stop offset="50%" stopColor="#06b6d4" />
                <stop offset="100%" stopColor="#f97316" />
              </linearGradient>
              <filter id="infinityGlowFilter" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <path
              d="M256 128 C216 76 152 76 120 128 C152 180 216 180 256 128 C296 76 360 76 392 128 C360 180 296 180 256 128"
              fill="none"
              stroke="url(#zylloInfinity)"
              strokeWidth="14"
              strokeLinecap="round"
              filter="url(#infinityGlowFilter)"
              style={{ animation: "infinityGlow 3.6s ease-in-out infinite" }}
            />
            <path
              d="M256 128 C216 76 152 76 120 128 C152 180 216 180 256 128 C296 76 360 76 392 128 C360 180 296 180 256 128"
              fill="none"
              stroke="#ffffffd0"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="34 18"
              style={{ animation: "infinityDash 2.8s linear infinite" }}
            />
          </svg>
        </div>
      </div>

      <div className="relative z-10 h-full w-full pointer-events-none">{children}</div>
    </div>
  );
}

export default TubesBackground;
