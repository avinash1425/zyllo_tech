import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface TubesBackgroundProps {
  children?: React.ReactNode;
  className?: string;
  enableClickInteraction?: boolean;
}

const randomColors = (count: number) => {
  return new Array(count)
    .fill(0)
    .map(() => "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0"));
};

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
    let orbitRafId = 0;

    const initTubes = async () => {
      if (!canvasRef.current) return;

      try {
        const module = await import(
          /* @vite-ignore */ "https://cdn.jsdelivr.net/npm/threejs-components@0.0.19/build/cursors/tubes1.min.js"
        );
        const TubesCursor = module.default;

        if (!mounted || !canvasRef.current) return;

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

        const runInfinityOrbit = () => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const t = performance.now() / 1000;
          const a = t * 0.88;
          const cx = rect.width / 2;
          const cy = rect.height / 2;
          const rx = Math.min(rect.width * 0.33, rect.height * 0.68);
          const ry = Math.min(rect.height * 0.34, rect.width * 0.27);

          const dispatchOrbitPoint = (angle: number) => {
            // Bernoulli lemniscate gives a cleaner center crossover for infinity.
            const denom = 1 + Math.sin(angle) ** 2;
            const x = cx + (rx * Math.cos(angle)) / denom;
            const y = cy + (ry * Math.sin(angle) * Math.cos(angle) * 2) / denom;
            const clientX = rect.left + x;
            const clientY = rect.top + y;

            const evt = new PointerEvent("pointermove", {
              clientX,
              clientY,
              pointerType: "mouse",
              bubbles: true,
            });
            canvas.dispatchEvent(evt);
            window.dispatchEvent(evt);
          };

          // Multi-phase tracing keeps both lobes and center connection visibly complete.
          for (let i = 0; i < 6; i += 1) {
            dispatchOrbitPoint(a + (i * Math.PI) / 3);
          }
          orbitRafId = requestAnimationFrame(runInfinityOrbit);
        };

        runInfinityOrbit();

        const handleResize = () => {
          // Library handles resize internally; handler reserved for explicit resize hooks.
        };

        window.addEventListener("resize", handleResize);

        cleanup = () => {
          window.removeEventListener("resize", handleResize);
          cancelAnimationFrame(orbitRafId);
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
      cancelAnimationFrame(orbitRafId);
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
      <div className="relative z-10 h-full w-full pointer-events-none">{children}</div>
    </div>
  );
}

export default TubesBackground;
