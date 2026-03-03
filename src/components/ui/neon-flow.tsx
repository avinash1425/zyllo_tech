import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const randomColors = (count: number) => {
  return new Array(count)
    .fill(0)
    .map(() => "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0"));
};

interface TubesBackgroundProps {
  children?: React.ReactNode;
  className?: string;
  enableClickInteraction?: boolean;
}

type TubesApp = {
  tubes?: {
    setColors?: (colors: string[]) => void;
    setLightsColors?: (colors: string[]) => void;
  };
  destroy?: () => void;
};

export function TubesBackground({
  children,
  className,
  enableClickInteraction = true,
}: TubesBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const tubesRef = useRef<TubesApp | null>(null);

  useEffect(() => {
    let mounted = true;
    let cleanup: (() => void) | undefined;

    const initTubes = async () => {
      if (!canvasRef.current) return;

      try {
        const module = await import(
          /* @vite-ignore */ "https://cdn.jsdelivr.net/npm/threejs-components@0.0.19/build/cursors/tubes1.min.js"
        );
        const TubesCursor = module.default;

        if (!mounted) return;

        const app = TubesCursor(canvasRef.current, {
          tubes: {
            colors: ["#f967fb", "#53bc28", "#6958d5"],
            lights: {
              intensity: 200,
              colors: ["#83f36e", "#fe8a2e", "#ff008a", "#60aed5"],
            },
          },
        }) as TubesApp;

        tubesRef.current = app;
        setIsLoaded(true);

        const handleResize = () => {
          // Library manages its own resizing; listener kept for future custom sizing.
        };

        window.addEventListener("resize", handleResize);

        cleanup = () => {
          window.removeEventListener("resize", handleResize);
          app.destroy?.();
          tubesRef.current = null;
        };
      } catch (error) {
        console.error("Failed to load TubesCursor:", error);
      }
    };

    initTubes();

    return () => {
      mounted = false;
      if (cleanup) cleanup();
    };
  }, []);

  const handleClick = () => {
    if (!enableClickInteraction || !tubesRef.current?.tubes) return;
    const colors = randomColors(3);
    const lightsColors = randomColors(4);
    tubesRef.current.tubes.setColors?.(colors);
    tubesRef.current.tubes.setLightsColors?.(lightsColors);
  };

  return (
    <div
      className={cn(
        "relative w-full h-full min-h-[400px] overflow-hidden bg-background",
        className
      )}
      onClick={handleClick}
    >
      <style>
        {`
          @keyframes infinityPulse {
            0%, 100% { opacity: 0.46; }
            50% { opacity: 0.88; }
          }
          @keyframes infinityDash {
            to { stroke-dashoffset: -280; }
          }
        `}
      </style>

      <canvas
        ref={canvasRef}
        className={cn(
          "absolute inset-0 w-full h-full block",
          !isLoaded && "opacity-0"
        )}
        style={{ touchAction: "none" }}
      />

      {!isLoaded && (
        <div className="absolute inset-0 bg-gradient-to-br from-[hsl(24,95%,50%,0.2)] via-[hsl(215,45%,20%,0.45)] to-[hsl(195,55%,42%,0.25)]" />
      )}

      {/* Always-visible branded infinity guide so the shape is clearly complete */}
      <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
        <svg viewBox="0 0 512 256" className="h-[38%] w-[70%] max-w-[860px]">
          <defs>
            <linearGradient id="infinityStroke" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f97316" />
              <stop offset="50%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#f97316" />
            </linearGradient>
            <filter id="infinityGlow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="2.4" result="blurred" />
              <feMerge>
                <feMergeNode in="blurred" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <path
            d="M256 128 C216 76 152 76 120 128 C152 180 216 180 256 128 C296 76 360 76 392 128 C360 180 296 180 256 128"
            fill="none"
            stroke="url(#infinityStroke)"
            strokeWidth="10"
            strokeLinecap="round"
            filter="url(#infinityGlow)"
            style={{ animation: "infinityPulse 3.2s ease-in-out infinite" }}
          />
          <path
            d="M256 128 C216 76 152 76 120 128 C152 180 216 180 256 128 C296 76 360 76 392 128 C360 180 296 180 256 128"
            fill="none"
            stroke="#ffffffc7"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="28 18"
            style={{ animation: "infinityDash 2.6s linear infinite" }}
          />
        </svg>
      </div>

      <div className="relative z-10 w-full h-full pointer-events-none">{children}</div>
    </div>
  );
}

export default TubesBackground;
