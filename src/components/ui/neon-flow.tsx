import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface TubesBackgroundProps {
  children?: React.ReactNode;
  className?: string;
  enableClickInteraction?: boolean;
  orbitSpeed?: number;
  orbitScale?: number;
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
  orbitSpeed = 0.72,
  orbitScale = 1,
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
        const module = await (import(
          /* @vite-ignore */ "https://cdn.jsdelivr.net/npm/threejs-components@0.0.19/build/cursors/tubes1.min.js" as string
        ) as Promise<{ default: (canvas: HTMLCanvasElement, options: unknown) => TubesApp }>);
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
          const a = t * orbitSpeed;
          const cx = rect.width / 2;
          const cy = rect.height / 2;
          const rx = Math.min(rect.width * 0.44, rect.height * 1.35) * orbitScale;
          const ry = Math.min(rect.height * 0.34, rect.width * 0.32) * orbitScale;

          const dispatchOrbitPoint = (angle: number) => {
            // Gerono lemniscate: clear infinity-loop path.
            const x = cx + Math.sin(angle) * rx;
            const y = cy + Math.sin(angle) * Math.cos(angle) * (ry * 2);
            const clientX = rect.left + x;
            const clientY = rect.top + y;

            if (typeof PointerEvent !== "undefined") {
              const evt = new PointerEvent("pointermove", {
                clientX,
                clientY,
                pointerType: "mouse",
                bubbles: true,
              });
              canvas.dispatchEvent(evt);
              window.dispatchEvent(evt);
            } else {
              const evt = new MouseEvent("mousemove", { clientX, clientY, bubbles: true });
              canvas.dispatchEvent(evt);
              window.dispatchEvent(evt);
            }
          };

          dispatchOrbitPoint(a);
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
  }, [orbitScale, orbitSpeed]);

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
